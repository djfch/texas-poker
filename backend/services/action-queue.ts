/**
 * backend/services/action-queue.ts - Per-room serial action queue
 *
 * Serializes all game-state mutations for a room onto a per-room Promise
 * chain (INV1). Concurrent entries - human actions, timeout folds, AI
 * callbacks and hand starts - can never interleave mid-transition: each
 * task runs to completion before the next one starts.
 */

/** Task enqueued for serial execution; the queue awaits its returned promise. */
export type QueuedTask<T> = () => Promise<T>;

/** Enqueue signature exposed to consumers (typed at call sites). */
export type EnqueueFn = <T>(roomId: string, task: QueuedTask<T>) => Promise<T>;

const chains = new Map<string, Promise<void>>(); // roomId -> tail Promise of the room's task chain

/**
 * Run `task` after every previously enqueued task for the same room.
 * The returned promise settles with the task's own result; the stored
 * chain never breaks, even when a task rejects.
 */
function enqueue<T>(roomId: string, task: QueuedTask<T>): Promise<T> {
  const prev = chains.get(roomId) || Promise.resolve();
  const result = prev.then(() => task());
  const tail = result.then(() => undefined, () => undefined);
  chains.set(roomId, tail);
  // Free the room entry once the chain has drained.
  tail.then(() => {
    if (chains.get(roomId) === tail) chains.delete(roomId);
  });
  return result;
}

// Export the same { enqueue } shape the former .js module had.
// A plain `module.exports =` statement is used (not `export =`) for the
// same esbuild-safety reason documented in backend/storage/memory-store.ts.
module.exports = { enqueue };
