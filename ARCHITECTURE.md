# Texas Hold'em Poker - 系统架构文档

| 项目 | 内容 |
|------|------|
| 文档版本 | v2.0（P1–P5 全栈升级后） |
| 创建日期 | 2026-06-29 |
| 最后更新 | 2026-07-29 |
| 状态 | 与实现同步 |

---

## 1. 技术选型

### 1.1 总体选型

| 层级 | 技术 | 理由 |
|------|------|------|
| 后端运行时 | Node.js 22+ / TypeScript（strict，CommonJS 语义） | 事件驱动模型适合 WebSocket 并发；类型系统保障重构安全；tsx 开发直跑，tsc 生产构建 |
| Web 框架 | Express 4.x | 轻量、稳定、社区最大 |
| 实时通信 | Socket.IO 4.x + `@socket.io/redis-adapter`（多实例） | 自动降级、断线重连、房间机制；adapter 跨实例广播 |
| 认证 | JWT（jsonwebtoken）+ bcryptjs | 游客与注册用户统一 token；无原生依赖 |
| 前端 | Vue 3 + TS + Vite + Pinia + Vue Router + Vant + GSAP | 组件化 + 类型安全；赌场风 UI 与动画 |
| 存储 | 三实现同一 Storage 契约：内存 Map / PostgreSQL（pg）/ Redis（ioredis） | `STORE_BACKEND` 切换；内存默认零依赖；pg 落用户+历史；redis 支撑多实例 |
| 测试 | node:test（后端）+ Vitest（前端） | 核心逻辑（牌型、底池、写透）高覆盖 |

### 1.2 不引入的依赖

- 不使用 ORM（手写 SQL 迁移与查询，数据模型简单）
- 不更换 Express（现有中间件链稳定）
- 不引入 React 等第二套前端框架

---

## 2. 系统架构图

### 2.1 整体架构（ASCII）

```
┌─────────────────────────────────────────────────────────────────────┐
│                              客户端层                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  浏览器用户A  │  │  浏览器用户B  │  │  AI机器人    │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                 │                 │                        │
│         └─────────────────┼─────────────────┘                        │
│                           │                                         │
│                    ┌──────┴──────┐                                  │
│                    │  WebSocket  │  (Socket.IO)                       │
│                    └──────┬──────┘                                  │
└─────────────────────────┬─────────────────────────────────────────┘
                          │
┌─────────────────────────┼─────────────────────────────────────────┐
│                         ▼                                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                     Express 服务器层                          │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │  │
│  │  │  REST 路由    │  │  Socket.IO   │  │  静态文件服务 │      │  │
│  │  │  /api/auth    │  │  事件处理器   │  │  /public      │      │  │
│  │  │  /api/rooms   │  │  room:*       │  │  index.html   │      │  │
│  │  └──────┬───────┘  └──────┬───────┘  └───────────────┘      │  │
│  └─────────┼─────────────────┼─────────────────────────────────┘  │
│            │                 │                                      │
│            ▼                 ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                     核心服务层 (Service Layer)              │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │  │
│  │  │ RoomManager  │  │ GameEngine   │  │ AIManager    │      │  │
│  │  │ 房间生命周期  │  │ 游戏状态机   │  │ AI决策逻辑   │      │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │  │
│  └─────────┼─────────────────┼─────────────────┼─────────────┘  │
│            │                 │                 │                 │
│            ▼                 ▼                 ▼                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                     领域逻辑层 (Domain Layer)               │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │  │
│  │  │ Deck/Card    │  │ HandEvaluator│  │ PotManager   │      │  │
│  │  │ 卡牌工具      │  │ 牌型评估引擎 │  │ 底池计算引擎  │      │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │  │
│  └────────────────────────────────────────────────────────────┘  │
│            │                 │                 │                 │
│            ▼                 ▼                 ▼                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                     数据存储层 (Storage Layer)               │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │  │
│  │  │ players: Map │  │ rooms: Map   │  │ games: Map   │      │  │
│  │  │ 玩家内存存储  │  │ 房间内存存储  │  │ 牌局内存存储  │      │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │  │
│  └────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

### 2.2 服务端权威架构（Server-Authoritative）

```
┌──────────────┐         ┌──────────────┐
│   客户端      │  ──▶   │    服务端     │
│  (展示层)     │  ◀──   │  (逻辑+状态)  │
└──────────────┘         └──────────────┘
       │                       │
       │ 1. 用户点击"加注"     │ 2. 验证合法性（是否轮到该玩家？筹码够？）
       │──────────────────────▶│
       │                       │ 3. 更新游戏状态
       │                       │ 4. 计算底池变化
       │                       │ 5. 判断游戏阶段是否推进
       │ 6. 广播新状态          │
       │◀──────────────────────│ 7. 通知所有客户端更新UI
       │                       │
       │ 注：客户端从不信任     │ 注：所有状态以服务端为准
       │ 本地计算结果           │ 防作弊核心
```

### 2.3 游戏状态流转（State Machine）

```
                    ┌──────────────┐
                    │   WAITING    │  ◀── 等待玩家入座+准备
                    └──────┬───────┘
                           │ 房主点击"开始"
                           ▼
                    ┌──────────────┐
                    │  DEALING     │  ◀── 确定庄家、盲注、发底牌
                    └──────┬───────┘
                           │
                           ▼
      ┌────────────────────────────────────────┐
      │           PRE_FLOP                     │
      │  从小盲位下家(UTG)开始，大盲位最后行动   │
      └──────┬──────────────┬──────────────────┘
             │ 只剩1人未弃牌  │ 下注轮结束
             ▼              ▼
      ┌──────────┐  ┌──────────────┐
      │  SHOWDOWN │  │   FLOP       │  ◀── 发3张公共牌
      │  (直接赢) │  │  从小盲位开始 │
      └─────┬────┘  └──────┬───────┘
             │              │
             │        ┌─────┴─────┐
             │   剩1人 │      轮结束 ▼
             │        ▼      ┌──────────┐
             │   ┌──────────┐│  TURN    │  ◀── 发第4张公共牌
             │   │ SHOWDOWN │└────┬─────┘
             │   │ (直接赢) │     │
             │   └────┬─────┘  ┌──┴──┐
             │        │    剩1人 │ 轮结束▼
             │        │        ▼ ┌─────────┐
             │        │   ┌──────┐│  RIVER  │  ◀── 发第5张公共牌
             │        │   │SHOWDOWN│└───┬────┘
             │        │   │(直接赢)│    │
             │        │   └──┬───┘  ┌─┴─┐
             │        │      │  剩1人 │ 轮结束▼
             │        │      │  ▼ ┌───────────┐
             │        │      │  ┌──────┐│ SHOWDOWN  │  ◀── 亮牌比大小
             │        │      │  │      │└─────┬─────┘
             │        │      │  │      │      │
             └────────┴──────┴──┴──────┴──────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │  POT_DISTRIB  │  ◀── 分配底池
                                   └──────┬───────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │    ENDED     │  ◀── 单局结束
                                   └──────────────┘
                                          │
                                          ▼ (房主选择"再来一局")
                                   ┌──────────────┐
                                   │   NEXT_HAND  │  ◀── 移庄家位，回到 DEALING
                                   └──────────────┘
```

---

## 3. 目录结构

```
texas-poker/
├── ARCHITECTURE.md          # 本架构文档
├── PRD.md                   # 产品需求文档
├── TASKS.md                 # 开发任务列表
├── package.json             # 后端依赖与脚本
├── tsconfig.json            # 后端 TS 配置（strict、commonjs、outDir dist）
├── server.ts                # 入口：Express + Socket.IO、redis-adapter/scheduler 接线
├── Dockerfile               # 多阶段镜像（前端构建 + 后端 tsc + 运行时）
├── docker-compose.yml       # 生产拓扑：nginx + app×2 + postgres + redis
├── deploy/nginx.conf        # 粘性反代（ip_hash + WebSocket 升级）
├── README.md                # 项目说明
│
├── backend/
│   ├── config/
│   │   ├── constants.ts     # 游戏常量与环境变量（冻结对象）
│   │   └── security.ts      # helmet/CSP 等安全配置
│   │
│   ├── domain/              # 领域逻辑层（纯函数，无状态，可独立测试）
│   │   ├── card.ts          # Card 类 + 牌面值/花色定义
│   │   ├── deck.ts          # Deck 类（生成、洗牌、发牌）
│   │   ├── hand-evaluator.ts # 牌型评估引擎（7选5最优牌型）
│   │   └── pot-manager.ts   # 底池计算引擎（主池+边池）
│   │
│   ├── services/            # 服务层（有状态，管理游戏生命周期，单例导出）
│   │   ├── auth-service.ts  # JWT 签发/验证（guest 与 user token）
│   │   ├── player-manager.ts # 玩家/用户管理（游客、注册、连接映射）
│   │   ├── room-manager.ts   # 房间管理（创建、加入、准备、开始；写透存储）
│   │   ├── game-engine.ts    # 游戏引擎（状态机、轮次推进、行动处理；写透存储）
│   │   ├── action-queue.ts   # 每房间动作串行队列
│   │   ├── ai-manager.ts     # AI 管理器（生成 AI、决策路由）
│   │   ├── ai-llm-service.ts # 大模型调用（OpenAI-compatible）
│   │   └── ai-rule-engine.ts # 规则型 AI（LLM 失败降级）
│   │
│   ├── storage/             # 存储层（三实现同一契约）
│   │   ├── index.ts         # 存储工厂：按 STORE_BACKEND 装配
│   │   ├── memory-store.ts  # 内存 Map 实现（默认）+ Storage 接口定义
│   │   ├── postgres-store.ts # 用户 CRUD + 牌局历史（手写 SQL）
│   │   ├── redis-store.ts   # players/rooms/games JSON + 滑动 TTL
│   │   ├── pg-client.ts     # pg 连接池与迁移执行
│   │   ├── game-serializer.ts # 牌局实体序列化/复活（Deck/PotManager）
│   │   └── migrations/      # SQL 迁移脚本（0001_init.sql）
│   │
│   ├── routes/              # REST API 路由
│   │   ├── auth.ts          # /api/auth/*（guest/register/login，均签发 JWT）
│   │   ├── auth-required.ts # 认证中间件（Bearer token，兼容 x-player-id）
│   │   └── rooms.ts         # /api/rooms/*（list/create/join/detail）
│   │
│   └── socket/              # WebSocket 事件处理器
│       ├── handlers.ts      # Socket.IO 初始化、握手认证、连接/断线管理
│       ├── events.ts        # 房间与游戏事件处理
│       └── scheduler-owner.ts # 多实例房间级调度归属（Redis 锁仲裁）
│
├── frontend-app/            # Vue 3 新前端（Vite + Pinia + Vant + GSAP）
│   └── src/
│       ├── views/           # LobbyView / RoomView / TableView
│       ├── components/      # lobby / room / table 组件
│       ├── stores/          # Pinia：player / lobby / room / game
│       ├── services/        # api.ts / socket.ts（自动重连 + 状态拉取）
│       ├── animations/      # GSAP 动画（三档降级）
│       ├── types/           # 与后端事件/负载对齐的类型
│       └── utils/           # seat-layout / card-asset 等纯函数
└── （旧版原生前端 frontend/ 已移除，历史见 git 记录）
```

---

## 4. 模块依赖关系

```
┌────────────────────────────────────────────────────┐
│                    server.ts                        │
│  (Express + Socket.IO 启动，依赖所有模块)              │
└──────────┬──────────────────────────┬──────────────┘
           │                          │
           ▼                          ▼
┌──────────────────┐      ┌──────────────────────┐
│   routes/         │      │     socket/           │
│   auth.ts         │      │   handlers.ts        │
│   auth-required.ts│      │   events.ts          │
│   rooms.ts        │      │   scheduler-owner.ts │
└────────┬─────────┘      └──────────┬───────────┘
         │                          │
         ▼                          ▼
┌──────────────────┐      ┌──────────────────────┐
│  services/        │      │    services/         │
│  auth-service.ts  │      │  room-manager.ts     │
│  player-manager.ts│      │  game-engine.ts      │
└────────┬─────────┘      │  ai-manager.ts       │
         │               └──────────┬───────────┘
         │                          │
         │    ┌─────────────────────┘
         │    │
         ▼    ▼
┌──────────────────┐      ┌──────────────────────┐
│   storage/       │      │     domain/          │
│  index.ts（工厂）  │      │   card.ts            │
│  memory-store.ts  │      │   deck.ts            │
│  postgres-store.ts│      │   hand-evaluator.ts  │
│  redis-store.ts   │      │   pot-manager.ts     │
└──────────────────┘      └──────────────────────┘
```

### 依赖规则

1. **domain/** 层不依赖任何其他层（纯函数，独立测试）
2. **storage/** 层只依赖 domain（game-serializer 复活类实例）与 config
3. **services/** 层依赖 domain + storage，services 之间不循环依赖
4. **routes/** 依赖 services + storage
5. **socket/** 依赖 services + storage
6. **frontend-app/** 与 **frontend/** 独立，只通过 HTTP/WebSocket 与服务端通信

---

## 5. 接口契约

### 5.1 存储接口（Storage 契约）

接口定义在 `backend/storage/memory-store.ts`，三个实现（memory / postgres / redis）共享同一契约，由 `backend/storage/index.ts` 按 `STORE_BACKEND` 装配；所有方法返回 Promise，同一套契约测试（`storage-contract.test.ts`）对三实现全部运行。

```typescript
// backend/storage/memory-store.ts — Storage 接口（节选）
interface Storage {
  // === 玩家 ===
  createPlayer(player) / getPlayer(id) / getPlayerBySocket(socketId)
  updatePlayer(id, updates) / deletePlayer(id) / listPlayers()

  // === Socket 链接 ===
  linkSocket(socketId, playerId) / unlinkSocket(socketId)
  getPlayerIdBySocket(socketId) / getSocketByPlayerId(playerId)

  // === 房间 ===
  createRoom(room) / getRoom(id) / updateRoom(id, updates)
  deleteRoom(id) / listRooms(filter)

  // === 牌局 ===
  createGame(game) / getGame(roomId) / updateGame(roomId, updates) / deleteGame(roomId)
}
```

**写透语义（关键约束）**：内存实现返回 live 对象（直接改即生效）；redis 实现每次读返回 JSON 反序列化的新副本。因此服务层对 room/player/game 的任何变更后必须显式调用 `updateRoom/updatePlayer/updateGame` 写回；循环内多次变更需每轮重读最新快照。牌局实体含类实例（Deck/PotManager），由 `game-serializer.ts` 负责序列化与复活。

**Redis 键规范与 TTL**（`backend/storage/redis-store.ts`）：

| 键 | 内容 | 备注 |
|----|------|------|
| `poker:player:{id}` | 玩家 JSON | 滑动 TTL，每次写刷新 |
| `poker:room:{id}` | 房间 JSON | 同上 |
| `poker:game:{roomId}` | 牌局 JSON（序列化后） | 同上 |
| `poker:socket:{socketId}` / `poker:socket_by_player:{playerId}` | 双向 socket 链接 | 字符串键 |
| `poker:lock:room:{roomId}` | 房间调度归属锁 | 30s TTL，Lua 原子抢/续锁（scheduler-owner） |
| `poker:sched` | 调度信号 pub/sub 频道 | 非 owner 实例通知 owner |

### 5.2 领域层接口

#### Card / Deck
```javascript
// Card: { suit: 'hearts'|'diamonds'|'clubs'|'spades', rank: '2'...'A' }
// rankValue: 2→2, 3→3, ..., 10→10, J→11, Q→12, K→13, A→14

class Deck {
  constructor()          // 生成一副标准52张牌
  shuffle()              // Fisher-Yates 洗牌
  deal(n) → Card[]       // 发 n 张牌
  remaining() → number   // 剩余牌数
}
```

#### HandEvaluator
```javascript
// 输入：7张牌（2张底牌 + 5张公共牌）
// 输出：{ rank: 1-10, name: 'Royal Flush', cards: Card[5], kickers: number[] }
// rank: 1=皇家同花顺, 2=同花顺, 3=四条, 4=葫芦, 5=同花, 6=顺子, 7=三条, 8=两对, 9=一对, 10=高牌

HandEvaluator.evaluate(cards: Card[7]) → HandResult
HandEvaluator.compare(handA: HandResult, handB: HandResult) → -1 | 0 | 1
```

#### PotManager
```javascript
class PotManager {
  constructor(players)     // players: [{ position, chipsInFront, status, totalBet }]
  
  addBet(position, amount) → void
  
  // 返回：{ mainPot, sidePots: [{ amount, eligiblePlayers: number[] }] }
  calculatePots() → Pots
  
  // 根据牌型结果分配
  // winners: [{ position, handRank }]
  distribute(winners: Winner[]) → { position: payout }
}
```

### 5.3 服务层接口

#### PlayerManager
```typescript
class PlayerManager {
  createGuest(socketId) → Player              // 创建游客
  register(username, password) → AuthResult   // 注册（bcrypt 哈希）
  login(username, password) → AuthResult      // 登录（防 timing attack）
  getOrCreateGuest(socketId) → Player          // 获取或创建游客
  setPlayerSocket(playerId, socketId) → Player // 重绑 socket（重连）
  disconnectPlayer(playerId) → Player          // 断线处理
  updateNickname(playerId, nickname) → Result  // 改昵称
}
```

#### RoomManager
```typescript
class RoomManager {
  createRoom(hostId, config) → Room             // 创建房间（房主自动加入）
  joinRoom(roomId, playerId, password?) → Result  // 加入房间
  leaveRoom(roomId, playerId) → Result          // 离开（含离房结算）
  sit(roomId, playerId, position) → Result      // 入座
  stand(roomId, playerId) → Result              // 离座
  ready(roomId, playerId, isReady) → Result     // 准备/取消
  borrowChips(roomId, playerId) → Result        // 破产后借一份初始筹码
  startGame(roomId, hostId) → Result            // 房主开始游戏
  listPublicRooms() → Room[]                    // 公开房间列表
  fillRoomWithAI(roomId, aiManager) → Bot[]     // AI 填充空位（每轮重读快照）
  addAI / removeAI(roomId, ...) → Result        // 单个 AI 增减
}
// 所有变更路径经 _persistRoom/_persistPlayer 写透存储（写失败记日志并抛出）
```

#### GameEngine
```typescript
class GameEngine {
  // 每房间动作经 action-queue 串行（公开方法包一层队列，_前缀为实现）
  startGame(roomId) → Result                    // 发底牌、盲注、进入 preflop
  handleAction(roomId, playerId, action, amount?) → Result  // 处理玩家行动（自动推进轮次/摊牌/结算）
  nextHand(roomId) → Result                     // 下一局（移庄家位）

  // 查询
  getGameState(roomId, playerId) → GameState    // 脱敏状态（他人底牌 null）
  getPrivateDeals(roomId) → PrivateDeal[]       // 按玩家分发的底牌
  getValidActions(roomId, playerId) → Action[]  // 当前合法动作
  isPlayerTurn(roomId, playerId) → boolean
  getAIDecisionContext(roomId, playerId) → Context  // AI 决策上下文（不泄露他人底牌）

  // 超时/断线
  timeoutFold(roomId, seatPosition) → Result    // 超时弃牌
  playerDisconnect(roomId, playerId) → Result   // 断线处理
}
```

#### AIManager
```typescript
class AIManager {
  createBot(roomId, position, style?) → Player  // 创建 AI 玩家（唯一昵称 Bot-*）
  removeBot(roomId, position) → boolean         // 移除 AI
  fillRoomWithAI(roomId) → Player[]             // 填满空位（每轮重读快照）
  decide(gameState, playerId) → Decision        // LLM 优先，失败降级规则
  decideWithRules(gameState, playerId) → Decision
}

// 决策链路：game-engine → ai-manager → ai-llm-service（LLM）
//            → 失败时 ai-rule-engine（规则降级，AI_FALLBACK_ENABLED）
// LLM 非法返回最多重试 2 次，仍失败自动弃牌；原始返回全量打日志
```

### 5.4 WebSocket 事件契约

#### 客户端 → 服务端

| 事件 | Payload | 发送者 | 服务端行为 |
|------|---------|--------|------------|
| `room:join` | `{ roomId, password? }` | 任何玩家 | 加入房间，广播 room:state |
| `room:leave` | `{}` | 已加入房间的玩家 | 离开房间，广播 |
| `room:ready` | `{ ready: boolean }` | 已入座玩家 | 切换准备状态 |
| `room:start` | `{}` | 房主 | 检查条件后启动游戏 |
| `seat:sit` | `{ position }` | 已加入房间的玩家 | 入座到指定位置 |
| `seat:stand` | `{}` | 已入座玩家 | 离座 |
| `game:action` | `{ type, amount? }` | 当前行动玩家 | 验证后执行，广播 |
| `chat:message` | `{ text }` | 任何玩家 | 广播给房间内其他玩家 |

另有：`room:borrow_chips`（借筹码）、`room:add_ai` / `room:remove_ai`（AI 增减）、`player:update_nickname`（改昵称）、`game:request_state`（重连后拉取完整状态）。完整事件表见 `backend/socket/events.ts` 与 `frontend-app/src/types/events.ts`。

#### 服务端 → 客户端

| 事件 | Payload | 触发时机 | 接收者 |
|------|---------|----------|--------|
| `room:state` | `Room` | 房间状态变化 | 房间内所有玩家 |
| `player:joined` | `{ seat }` | 玩家入座 | 房间内所有玩家 |
| `player:left` | `{ position }` | 玩家离开/离座 | 房间内所有玩家 |
| `player:ready` | `{ position, ready }` | 准备状态变化 | 房间内所有玩家 |
| `game:started` | `{ gameId, dealer, sb, bb }` | 游戏开始 | 房间内所有玩家 |
| `game:dealt` | `{ cards: Card[], position }` | 发底牌 | 仅发给对应玩家 |
| `game:community` | `{ cards: Card[], round }` | 发公共牌 | 房间内所有玩家 |
| `game:turn` | `{ position, timeoutAt }` | 轮到某玩家 | 房间内所有玩家 |
| `game:action` | `{ position, type, amount }` | 玩家行动 | 房间内所有玩家 |
| `game:pot` | `{ mainPot, sidePots }` | 底池变化 | 房间内所有玩家 |
| `game:showdown` | `{ results: [{ position, cards, handName }] }` | 摊牌 | 房间内所有玩家 |
| `game:ended` | `{ winners: [{ position, payout }], nextHandDelay }` | 牌局结束 | 房间内所有玩家 |
| `game:state` | `GameState` | 完整游戏状态（重连用） | 请求者 |
| `chat:message` | `{ from, text, timestamp }` | 聊天消息 | 房间内所有玩家 |
| `error` | `{ code, message }` | 任何错误 | 请求者 |
| `connect` | - | Socket 连接成功 | 连接者 |
| `disconnect` | - | Socket 断开 | 连接者 |

### 5.5 REST API 契约

认证：三个 auth 端点均返回 `{ player, token }`（JWT）；后续请求以 `Authorization: Bearer <token>` 携带，兼容期仍支持 `x-player-id` 头（`auth-required.ts` 中间件）。

| 方法 | 路径 | 请求体 | 响应 | 说明 |
|------|------|--------|------|------|
| POST | `/api/auth/guest` | `{ nickname? }` | `{ player, token }` | 创建游客（guest JWT） |
| POST | `/api/auth/register` | `{ username, password }` | `{ player, token }` | 注册（用户名唯一，bcrypt 哈希，user JWT） |
| POST | `/api/auth/login` | `{ username, password }` | `{ player, token }` | 登录（防 timing attack） |
| GET | `/api/rooms` | - | `{ rooms: Room[] }` | 公开房间列表 |
| POST | `/api/rooms` | `{ name, maxPlayers, smallBlind, bigBlind, initialChips, allowAI, password? }` | `{ room }` | 创建房间 |
| GET | `/api/rooms/:id` | - | `{ room }` | 房间详情 |
| POST | `/api/rooms/:id/join` | `{ password? }` | `{ room }` | 加入房间 |

---

## 6. 数据模型（存储对象格式）

下列对象同时是内存 store 的 live 对象形态与 redis store 的 JSON 文档形态（牌局中的 Deck/PotManager 类实例由 game-serializer 序列化/复活）；postgres 另有 users、hand_history 两张表（见 `migrations/0001_init.sql`）。

```javascript
// Player (内存对象)
{
  id: string,          // UUID 或 socketId（游客）
  username: string,     // 用户名（游客为 null）
  nickname: string,     // 显示昵称
  avatar: string,       // 头像 URL 或颜色代码
  chips: number,       // 总筹码余额
  isGuest: boolean,     // 是否游客
  socketId: string,     // 当前 Socket.IO 连接 ID
  isOnline: boolean,    // 是否在线
  currentRoom: string,  // 当前所在房间 ID
  createdAt: number,   // 时间戳
  lastLoginAt: number   // 时间戳
}

// Room (存储对象)
{
  id: string,          // 6位房间号
  name: string,
  hostId: string,       // 房主 playerId
  maxPlayers: number,   // 2-9
  smallBlind: number,
  bigBlind: number,
  initialChips: number,
  allowAI: boolean,
  password: string | null,
  status: 'waiting' | 'playing' | 'ended',
  seats: (string | null)[],  // 9 个座位，存 playerId 或 null
  players: RoomPlayer[],     // 房间成员（含未入座）：{ playerId, nickname, seatPosition, isReady, chips, buyInTotal, borrowCount, isAI }
  chatHistory: ChatMessage[],
  currentGameId: string | null,
  dealerPosition: number | null,
  awaitingNextHandReady: boolean,
  createdAt: number
}

// Seat (内存对象)
{
  position: number,     // 0-8
  playerId: string | null,
  isAI: boolean,
  nickname: string,
  avatar: string,
  chips: number,         // 本局剩余筹码
  status: 'empty' | 'occupied' | 'ready' | 'playing' | 'folded' | 'allin' | 'left',
  isReady: boolean,     // 是否准备
  isDealer: boolean,
  isSmallBlind: boolean,
  isBigBlind: boolean,
  holeCards: Card[] | null,  // 仅该座位玩家可见（服务端控制）
  currentBet: number,    // 当前轮下注额
  totalBet: number,     // 本局总下注额
  isDisconnected: boolean  // 是否断线
}

// Game (内存对象)
{
  id: string,           // UUID
  roomId: string,
  status: 'dealing' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'ended',
  dealerPosition: number,
  smallBlindPosition: number,
  bigBlindPosition: number,
  communityCards: Card[],
  pot: number,          // 主池金额
  sidePots: [{ amount: number, eligiblePositions: number[] }],
  currentRoundBet: number,  // 当前轮最高下注
  currentPlayerPosition: number | null,  // 当前行动玩家
  lastRaisePosition: number,           // 最后加注者位置（用于判断轮结束）
  deck: Deck,          // 剩余牌堆
  seats: Seat[],       // 参与本局的座位状态（引用 Room.seats 的副本）
  actions: Action[],     // 本局所有动作记录
  roundActions: Action[], // 当前轮动作
  timeoutAt: number | null,  // 当前行动截止时间
  timer: Timer | null,  // 超时计时器引用
  createdAt: number,
  endedAt: number | null
}

// Action (内存对象)
{
  id: string,
  gameId: string,
  position: number,
  type: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin',
  amount: number,
  round: 'preflop' | 'flop' | 'turn' | 'river',
  timestamp: number
}

// ChatMessage (内存对象)
{
  from: string,         // 发送者昵称
  text: string,
  timestamp: number
}
```

---

## 7. 关键算法设计

### 7.1 牌型评估（HandEvaluator）

```
算法：从7张牌中找出最优5张组合

步骤：
1. 生成 C(7,5) = 21 种 5 张牌组合
2. 对每种组合评分：
   a. 检查是否为同花顺/皇家同花顺（同花色 + 连续）
   b. 检查是否为四条（4张同点数）
   c. 检查是否为葫芦（3+2）
   d. 检查是否为同花（5张同花色）
   e. 检查是否为顺子（5张连续）
   f. 检查是否为三条（3张同点数）
   g. 检查是否为两对（2+2）
   h. 检查是否为一对（2张同点数）
   i. 高牌（取最大5张）
3. 返回评分最高的组合

评分编码：rank * 1000000 + 关键牌点数 * 10000 + 踢脚
这样可以直接用整数比较大小
```

### 7.2 底池计算（SidePot）

```
算法：处理 All-in 产生的多层边池

步骤：
1. 收集所有参与玩家的 totalBet（本局总投入）
2. 按 totalBet 从小到大排序
3. 对于每个"层级"（不同 totalBet 值）：
   a. 该层级可参与玩家 = totalBet >= 该层级值 且 未 fold 的玩家
   b. 该层级底池 = 层级差额 * 可参与玩家数
   c. 累加到对应玩家的边池
4. 所有层级处理完后，得到主池 + 多个边池

分配时：
- 每个边池单独用 eligiblePositions 内的玩家比较牌型
- 牌型最大者赢得该边池全部（平局则平分）
```

### 7.3 AI 决策策略（简单规则）

```
算法：基于手牌强度和位置做决策

输入：
  - holeCards: 2张底牌
  - communityCards: 0-5张公共牌
  - pot: 底池大小
  - currentBet: 当前需跟注额
  - chips: 剩余筹码
  - position: 座位位置（0-8）
  - style: 'tight' | 'loose' | 'balanced'

步骤：
1. 计算手牌强度 score（0-100）：
   - 无公共牌：基于起手牌表（AA=100, 72o=0）
   - 有公共牌：HandEvaluator 评估后映射到 0-100
2. 计算底池赔率 potOdds = currentBet / (pot + currentBet)
3. 计算位置优势 positionBonus = 后位加分（0-15）
4. 计算风格偏移 styleAdjustment（保守-10，激进+10，平衡0）
5. 有效分数 = score + positionBonus + styleAdjustment
6. 决策：
   - 有效分数 < 30: Fold（除非已跟注到当前最高，则 Check）
   - 有效分数 30-50: Call（如果赔率合理）或 Check
   - 有效分数 50-70: Call 或 Raise（minRaise）
   - 有效分数 > 70: Raise 或 All-in（如果筹码少）
7. 添加 1-5 秒随机延迟模拟真人思考
```

---

## 8. 安全与防作弊设计

| 机制 | 实现方式 |
|------|----------|
| 服务端权威 | 所有游戏逻辑在服务端执行，客户端只发动作请求，不发送计算结果 |
| 状态验证 | 每次 action 服务端验证：是否轮到该玩家、筹码是否足够、动作是否合法 |
| 序列号防重放 | 每个 WebSocket 消息带递增序列号，服务端拒绝重复/乱序消息 |
| 超时保护 | 30 秒行动限时，超时自动 Fold，防止挂机 |
| 断线处理 | 60 秒内重连保留座位，超时空出座位由 AI 填充或空出 |
| 底牌隐私 | 底牌只发送给对应玩家的 socket，其他玩家收到 null |
| 虚拟筹码 | 纯虚拟筹码，不涉及真实货币，不涉及提现 |

---

## 9. 多实例架构（P5）

### 9.1 拓扑

```
客户端 ──▶ nginx（ip_hash 粘性）─┬─▶ app 实例 1 ─┬─▶ PostgreSQL（用户/历史）
                             └─▶ app 实例 2 ─┴─▶ Redis（运行时状态 + pub/sub + 锁）
```

设置 `REDIS_URL` 即启用多实例模式，并强制 `STORE_BACKEND=redis`（否则启动 fail-fast）：

- **跨实例广播**：Socket.IO 接 `@socket.io/redis-adapter`，房间广播触达所有实例的客户端。
- **调度归属（scheduler-owner）**：每房间的回合计时器与 AI 决策由抢到 `poker:lock:room:{roomId}`（30s TTL，Lua 原子抢/续锁）的实例独占；其他实例通过 `poker:sched` 频道通知 owner。owner 宕机后锁到期，下一个调度点由存活实例接管（倒计时按完整时长重建，已接受的简化语义）。断线保留计时器（60s）始终归连接所在实例。
- **写透持久化（P5c）**：room-manager/game-engine 每个变更路径显式写回存储，任意实例重读即得最新状态；进程重启（Redis 未重启）后房间可恢复。
- **故障语义**：启动时 Redis 不可达直接失败；运行期中断则无限退避重连，恢复后自愈。

已知边界：AI 回合活性依赖调度点接管；跨实例动作互斥未覆盖（依赖 nginx 粘性会话收敛）。

### 9.2 存储层可替换（已实现）

```typescript
// backend/storage/index.ts — 按 STORE_BACKEND 装配：
// memory（默认，零依赖）/ postgres（用户+历史）/ redis（运行时状态）
// 三实现同一契约，调用方零改动；契约测试对三实现全部运行
```

### 9.3 游戏逻辑模块化

- `GameEngine` 不依赖具体 UI，任何 Poker 变体可继承或替换
- `HandEvaluator` 纯函数，可被任何模式复用
- `PotManager` 独立于具体游戏类型，适用于任何下注类游戏

### 9.4 AI 策略可插拔

```typescript
// 当前：LLM（OpenAI-compatible）优先，ai-rule-engine 规则降级
// ai-manager 路由决策，接口不变，可替换为任意策略实现
```

---

## 10. 当前能力与边界

| 范围 | 已实现 | 未实现/后续 |
|------|------|--------|
| 用户系统 | 游客模式 + 注册/登录（JWT + bcrypt） | 第三方登录、找回密码 |
| 房间系统 | 创建、加入、公开/私密、AI 填充、借筹码、离房结算 | 回放 |
| 游戏系统 | 完整德州扑克规则、底池、边池、牌局历史入库（postgres） | tournaments、多桌 |
| 实时通信 | WebSocket、断线重连、跨实例广播 | — |
| 前端 | Vue 3 新前端（手机竖屏 + 桌面宽屏、GSAP 动画三档降级）、聊天 | 排行榜 |
| 部署 | Docker Compose 多实例、CI、nginx 粘性代理、健康检查 | 自动扩缩容 |
| AI | LLM 决策 + 规则降级、风格化、决策日志 | 机器学习策略 |

---

*文档结束*
