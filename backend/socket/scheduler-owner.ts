/**
 * backend/socket/scheduler-owner.ts - Room-level scheduler ownership (P5a)
 *
 * In a multi-instance deployment (REDIS_URL configured) exactly one
 * instance may run a room's scheduling side effects (turn timeout timers
 * and AI decisions); the state itself already lives in the shared store.
 * Ownership is a Redis lock:
 *
 *   SET poker:lock:room:{roomId} {instanceId} NX PX 30000
 *
 * Ownership state machine, per room, from one instance's perspective:
 *
 *   claim()
 *     ├─ lock free            → acquire, become owner (true)
 *     ├─ lock held by me      → renew TTL, stay owner (true)
 *     └─ lock held by other   → stay non-owner (false)
 *
 *   scheduling point (hand start / action success / AI turn), handled in
 *   socket/handlers.ts:
 *     ├─ owner instance       → schedule locally (turn timer + AI)
 *     └─ non-owner instance   → publish a turn signal on poker:sched;
 *                               the owner receives it, re-claims (renew,
 *                               or takeover-acquire once a dead owner's
 *                               lock has expired) and schedules locally
 *                               against the shared game state.
 *
 *   owner crash:
 *     The lock expires after lockTtlMs. The next scheduling point (or
 *     turn signal) lets a surviving instance claim and rebuild the turn
 *     timeout with deadline = now + full action duration. Simplified
 *     semantics: the remaining countdown of the interrupted turn is reset
 *     to a full timeout (documented, accepted).
 *
 * The class is inert until the server startup wires it in; the
 * single-instance path (no REDIS_URL) never constructs it, so
 * single-instance scheduling behaviour is byte-identical to before.
 */

/** Redis command surface used by the owner (satisfied by ioredis). */
export interface SchedulerCommandClient {
  set(...args: any[]): Promise<any>;
  get(key: string): Promise<string | null>;
  pexpire(key: string, ms: number): Promise<any>;
  publish(channel: string, message: string): Promise<any>;
  eval(script: string, numKeys: number, ...args: any[]): Promise<any>;
}

/** Redis subscriber surface (a dedicated client in subscriber mode). */
export interface SchedulerSubscriber {
  subscribe(channel: string): Promise<any>;
  on(event: string, listener: (...args: any[]) => void): any;
}

/** Cross-instance signal describing one freshly broadcast turn. */
export interface TurnSignal {
  roomId: string;
  seatPosition: number;
  playerId: string;
  /** Client-visible deadline computed by the broadcasting instance. */
  timeoutAt: number;
}

export interface SchedulerOwnerOptions {
  client: SchedulerCommandClient;
  subscriber?: SchedulerSubscriber;
  instanceId?: string;
  /** Lock TTL; ownership lapses this long after the last renew. */
  lockTtlMs?: number;
  /** TTL for the shared turn snapshot used by mid-turn reconnects. */
  turnSnapshotTtlMs?: number;
}

export const SCHEDULER_LOCK_KEY = (roomId: string): string => `poker:lock:room:${roomId}`;
export const SCHEDULER_CHANNEL = 'poker:sched';
export const TURN_SNAPSHOT_KEY = (roomId: string): string => `poker:turn:${roomId}`;

const DEFAULT_LOCK_TTL_MS = 30000;
const DEFAULT_SNAPSHOT_TTL_MS = 120000;

// Atomic acquire-or-renew: SET NX, else PEXPIRE only when the lock is
// still held by this instance. A single script round-trip — there is no
// window in which a competing acquire can slip between the ownership
// check and the renewal (a non-atomic NX/GET/PEXPIRE sequence could
// renew a lock just stolen by another instance and produce two owners).
const CLAIM_SCRIPT = `
if redis.call('set', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX') then return 1 end
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

export class SchedulerOwner {
  readonly instanceId: string;
  private client: SchedulerCommandClient;
  private subscriber: SchedulerSubscriber | null;
  private lockTtlMs: number;
  private snapshotTtlMs: number;
  private turnSignalHandler: ((roomId: string, turn: TurnSignal) => void) | null = null;

  constructor(options: SchedulerOwnerOptions) {
    this.client = options.client;
    this.subscriber = options.subscriber || null;
    this.instanceId = options.instanceId ||
      `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    this.lockTtlMs = options.lockTtlMs || DEFAULT_LOCK_TTL_MS;
    this.snapshotTtlMs = options.turnSnapshotTtlMs || DEFAULT_SNAPSHOT_TTL_MS;

    if (this.subscriber) {
      this.subscriber.on('message', (channel: string, raw: string) => {
        if (channel !== SCHEDULER_CHANNEL || !this.turnSignalHandler) return;
        let turn: TurnSignal;
        try {
          turn = JSON.parse(raw);
        } catch {
          return; // malformed signal: ignore
        }
        if (turn && typeof turn.roomId === 'string' && typeof turn.timeoutAt === 'number') {
          this.turnSignalHandler(turn.roomId, turn);
        }
      });
    }
  }

  /** Subscribe the signal bus. Call once at startup. */
  async start(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.subscribe(SCHEDULER_CHANNEL);
    }
  }

  /**
   * Acquire the room lock, or renew it when this instance already holds
   * it. Atomic via CLAIM_SCRIPT: a competing instance can only acquire
   * the lock between two claims, in which case this claim simply fails —
   * never two owners scheduling the same turn.
   */
  async claim(roomId: string): Promise<boolean> {
    const result = await this.client.eval(
      CLAIM_SCRIPT,
      1,
      SCHEDULER_LOCK_KEY(roomId),
      this.instanceId,
      this.lockTtlMs
    );
    return Number(result) === 1;
  }

  /** Publish a turn signal so the room's owner can schedule it. */
  async notifyTurn(roomId: string, turn: Omit<TurnSignal, 'roomId'>): Promise<void> {
    const signal: TurnSignal = { roomId, ...turn };
    await this.client.publish(SCHEDULER_CHANNEL, JSON.stringify(signal));
  }

  /** Register the handler invoked for every turn signal on the bus. */
  onTurnSignal(handler: (roomId: string, turn: TurnSignal) => void): void {
    this.turnSignalHandler = handler;
  }

  /**
   * Persist the current turn's public deadline so a player re-syncing on
   * an instance that does not hold the local timer can still be re-sent
   * the original countdown (see _resendTurnToPlayer in handlers.ts).
   */
  async writeTurnSnapshot(roomId: string, snapshot: Omit<TurnSignal, 'roomId'>): Promise<void> {
    await this.client.set(
      TURN_SNAPSHOT_KEY(roomId),
      JSON.stringify({ roomId, ...snapshot }),
      'PX',
      this.snapshotTtlMs
    );
  }

  async readTurnSnapshot(roomId: string): Promise<TurnSignal | null> {
    const raw = await this.client.get(TURN_SNAPSHOT_KEY(roomId));
    if (!raw) return null;
    try {
      const snap = JSON.parse(raw);
      return snap && typeof snap.playerId === 'string' ? snap : null;
    } catch {
      return null;
    }
  }
}
