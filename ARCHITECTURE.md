# Texas Hold'em Poker - 系统架构文档

| 项目 | 内容 |
|------|------|
| 文档版本 | v1.0 |
| 创建日期 | 2026-06-29 |
| 架构师 | Architect Agent |
| 状态 | 设计完成 |

---

## 1. 技术选型

### 1.1 总体选型

| 层级 | 技术 | 理由 |
|------|------|------|
| 后端运行时 | Node.js 20+ | 事件驱动、单线程模型天然适合 WebSocket 并发；生态成熟；PRD 要求 |
| Web 框架 | Express 4.x | 轻量、稳定、社区最大，足够满足 MVP REST API 需求 |
| 实时通信 | Socket.IO 4.x | 自动降级、断线重连、房间机制、心跳检测，完美匹配需求 |
| 前端 | 原生 HTML5 + CSS3 + ES6 | 零构建依赖、快速迭代、MVP 阶段无需框架 overhead |
| 存储 | 内存（In-Memory） | MVP 快速验证，模块隔离后后续可替换为 Redis/PostgreSQL |
| 测试 | Jest + Node.js 内置 test runner | 核心逻辑（牌型判断、底池计算）需要高覆盖率 |

### 1.2 不引入的依赖（MVP 阶段）

- 不使用 TypeScript（减少编译步骤，快速迭代）
- 不使用前端框架（React/Vue）（原生 JS 足够）
- 不使用 ORM（数据模型简单，直接操作对象）
- 不使用 Redis/PostgreSQL（MVP 阶段内存存储）
- 不使用 JWT（MVP 使用 sessionId + 内存映射，后续可升级）

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
├── package.json             # 项目依赖
├── server.js                # 入口文件：启动 Express + Socket.IO
├── README.md                # 项目说明
│
├── backend/
│   ├── config/
│   │   └── constants.js     # 游戏常量（超时时间、默认盲注等）
│   │
│   ├── domain/              # 领域逻辑层（纯函数，无状态，可独立测试）
│   │   ├── card.js          # Card 类 + 牌面值/花色定义
│   │   ├── deck.js          # Deck 类（生成、洗牌、发牌）
│   │   ├── hand-evaluator.js # 牌型评估引擎（7选5最优牌型）
│   │   └── pot-manager.js   # 底池计算引擎（主池+边池）
│   │
│   ├── services/            # 服务层（有状态，管理游戏生命周期）
│   │   ├── player-manager.js # 玩家/用户管理（游客、注册、连接映射）
│   │   ├── room-manager.js   # 房间管理（创建、加入、准备、开始）
│   │   ├── game-engine.js    # 游戏引擎（状态机、轮次推进、行动处理）
│   │   └── ai-manager.js     # AI 管理器（生成 AI、决策、延迟模拟）
│   │
│   ├── storage/             # 存储层（MVP 内存实现，后续可替换）
│   │   └── memory-store.js  # 内存 Map 存储（players, rooms, games）
│   │
│   ├── routes/              # REST API 路由
│   │   ├── auth.js          # /api/auth/* (register, login, guest)
│   │   └── rooms.js         # /api/rooms/* (list, create, join, detail)
│   │
│   └── socket/              # WebSocket 事件处理器
│       ├── index.js         # Socket.IO 初始化 + 连接管理
│       ├── room-events.js   # 房间相关事件 (room:join, room:leave, ...)
│       ├── game-events.js   # 游戏相关事件 (game:action, ...)
│       └── chat-events.js   # 聊天事件 (chat:message)
│
└── frontend/
    ├── index.html           # 入口页面（SPA 路由，根据 hash 切换视图）
    ├── css/
    │   ├── base.css         # 基础样式、变量、重置
    │   ├── lobby.css        # 大厅页面样式
    │   └── table.css        # 牌桌页面样式
    └── js/
        ├── app.js           # 前端入口：初始化、路由、Socket 连接
        ├── api.js           # HTTP API 封装（fetch 封装）
        ├── socket-client.js # Socket.IO 客户端连接 + 事件监听
        ├── views/
        │   ├── lobby.js     # 大厅视图（房间列表、创建房间、快速开始）
        │   ├── room.js      # 房间视图（座位、准备、聊天）
        │   └── table.js     # 牌桌视图（游戏核心 UI、操作按钮）
        └── components/
            ├── card.js      # 卡牌渲染组件
            ├── seat.js      # 座位组件
            ├── chips.js     # 筹码显示组件
            ├── pot.js       # 底池显示组件
            ├── timer.js     # 倒计时组件
            └── actions.js   # 操作按钮组件（Fold/Check/Call/Raise/All-in）
```

---

## 4. 模块依赖关系

```
┌────────────────────────────────────────────────────┐
│                    server.js                        │
│  (Express + Socket.IO 启动，依赖所有模块)              │
└──────────┬──────────────────────────┬──────────────┘
           │                          │
           ▼                          ▼
┌──────────────────┐      ┌──────────────────────┐
│   routes/         │      │     socket/           │
│   auth.js         │      │   index.js           │
│   rooms.js        │      │   room-events.js     │
└────────┬─────────┘      │   game-events.js     │
         │               └──────────┬───────────┘
         │                          │
         ▼                          ▼
┌──────────────────┐      ┌──────────────────────┐
│  services/        │      │    services/         │
│  player-manager.js│      │  room-manager.js     │
│                   │      │  game-engine.js      │
└────────┬─────────┘      │  ai-manager.js       │
         │               └──────────┬───────────┘
         │                          │
         │                          │
         │    ┌─────────────────────┘
         │    │
         ▼    ▼
┌──────────────────┐      ┌──────────────────────┐
│   storage/       │      │     domain/          │
│  memory-store.js  │      │   card.js            │
│                   │      │   deck.js            │
└──────────────────┘      │   hand-evaluator.js  │
                          │   pot-manager.js     │
                          └──────────────────────┘
```

### 依赖规则

1. **domain/** 层不依赖任何其他层（纯函数，独立测试）
2. **storage/** 层不依赖任何其他层（基础数据结构）
3. **services/** 层依赖 domain + storage，services 之间不循环依赖
4. **routes/** 依赖 services + storage
5. **socket/** 依赖 services + storage
6. **frontend/** 独立，只通过 HTTP/WebSocket 与服务端通信

---

## 5. 接口契约

### 5.1 内存存储接口（MemoryStore）

所有存储操作返回 Promise，后续替换为 Redis/PostgreSQL 时无需修改调用方。

```javascript
// storage/memory-store.js
class MemoryStore {
  // === 用户 ===
  async createPlayer(player) → Player
  async getPlayer(id) → Player | null
  async getPlayerBySocket(socketId) → Player | null
  async updatePlayer(id, updates) → Player
  async deletePlayer(id) → void

  // === 房间 ===
  async createRoom(room) → Room
  async getRoom(id) → Room | null
  async updateRoom(id, updates) → Room
  async deleteRoom(id) → void
  async listRooms(filter) → Room[]

  // === 牌局 ===
  async createGame(game) → Game
  async getGame(id) → Game | null
  async updateGame(id, updates) → Game
  async deleteGame(id) → void
}
```

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
```javascript
class PlayerManager {
  createGuest(socketId) → Player              // 创建游客
  register(username, password) → Player       // 注册用户（MVP 后）
  login(username, password) → Player        // 登录（MVP 后）
  getOrCreateGuest(socketId) → Player       // 获取或创建游客
  disconnectPlayer(socketId) → void         // 断线处理
}
```

#### RoomManager
```javascript
class RoomManager {
  createRoom(config, hostId) → Room           // 创建房间
  joinRoom(roomId, playerId, password?) → Room  // 加入房间
  leaveRoom(roomId, playerId) → Room        // 离开房间
  sit(roomId, playerId, position) → Room    // 入座
  stand(roomId, playerId) → Room            // 离座
  ready(roomId, playerId, ready) → Room     // 准备/取消
  startGame(roomId, hostId) → Game          // 房主开始游戏
  listPublicRooms() → Room[]                // 公开房间列表
  fillWithAI(roomId) → Room                 // AI 填充空位
}
```

#### GameEngine
```javascript
class GameEngine {
  constructor(room)                         // 初始化新牌局
  
  // 核心状态机推进
  start() → GameState                       // 开始游戏（发底牌、进入 PRE_FLOP）
  action(position, type, amount?) → GameState  // 处理玩家行动
  
  // 内部流转（根据 action 结果自动调用）
  dealFlop() → GameState                    // 发 Flop
  dealTurn() → GameState                    // 发 Turn
  dealRiver() → GameState                   // 发 River
  showdown() → GameState                    // 摊牌
  distributePot() → GameState               // 分配底池
  nextHand() → GameState                    // 下一局
  
  // 查询
  getState() → GameState                    // 获取完整状态（用于广播）
  getCurrentPlayer() → number               // 当前行动玩家位置
  getValidActions(position) → Action[]      // 某玩家当前可用的行动列表
  isPlayerTurn(position) → boolean          // 是否轮到该玩家
  
  // 断线处理
  timeoutFold(position) → GameState         // 超时弃牌
  playerDisconnect(position) → GameState   // 玩家断线（自动 fold）
}
```

#### AIManager
```javascript
class AIManager {
  createBot(roomId, style?) → Player        // 创建 AI 玩家
  decideAction(gameState, botPosition) → { type, amount?, delayMs }  // AI 决策
  removeBot(roomId, position) → void       // 移除 AI
}

// AI 决策策略（基于规则）
// 输入：gameState（公共牌、底池、手牌强度、位置、筹码）
// 输出：action 类型 + 金额 + 模拟延迟
// 策略：
//   - 手牌强度评分（0-100）
//   - 底池赔率
//   - 位置因素（后位更有利）
//   - 风格偏移（保守/激进/平衡）
//   - 筹码深度
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

| 方法 | 路径 | 请求体 | 响应 | 说明 |
|------|------|--------|------|------|
| POST | `/api/auth/guest` | `{}` | `{ player }` | 创建游客 |
| POST | `/api/auth/register` | `{ username, password }` | `{ player }` | 注册（MVP后） |
| POST | `/api/auth/login` | `{ username, password }` | `{ player }` | 登录（MVP后） |
| GET | `/api/rooms` | - | `{ rooms: Room[] }` | 公开房间列表 |
| POST | `/api/rooms` | `{ name, maxPlayers, smallBlind, bigBlind, initialChips, allowAI, password? }` | `{ room }` | 创建房间 |
| GET | `/api/rooms/:id` | - | `{ room }` | 房间详情 |
| POST | `/api/rooms/:id/join` | `{ password? }` | `{ room }` | 加入房间 |
| GET | `/api/user/profile` | - | `{ player }` | 获取当前用户信息（通过 cookie/session） |
| GET | `/api/user/history` | - | `{ games: Game[] }` | 游戏历史（MVP后） |

---

## 6. 数据模型（内存存储格式）

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

// Room (内存对象)
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
  seats: Seat[],        // 9个座位（位置 0-8）
  players: string[],    // 加入房间的玩家 ID（不一定入座）
  chatHistory: ChatMessage[],
  currentGameId: string | null,
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

## 9. 扩展性设计

### 9.1 存储层可替换

```javascript
// 当前：MemoryStore
// 未来：RedisStore（实现相同接口）
// 未来：PostgresStore（实现相同接口）
// 只需修改 new MemoryStore() 为 new RedisStore()，无需改其他代码
```

### 9.2 游戏逻辑模块化

- `GameEngine` 不依赖具体 UI，任何 Poker 变体可继承或替换
- `HandEvaluator` 纯函数，可被任何模式复用
- `PotManager` 独立于具体游戏类型，适用于任何下注类游戏

### 9.3 AI 策略可插拔

```javascript
// 当前：RuleBasedAI（基于规则）
// 未来：MLBasedAI（机器学习）
// 只需替换 AIManager 内部实现，接口不变
```

---

## 10. MVP 阶段取舍

| 范围 | 包含 | 不包含 |
|------|------|--------|
| 用户系统 | 游客模式（自动生成昵称） | 注册/登录、JWT、密码加密 |
| 房间系统 | 创建、加入、公开/私密、AI填充 | 历史记录、回放 |
| 游戏系统 | 完整德州扑克规则、底池、边池 |  tournaments、多桌 |
| 实时通信 | WebSocket、断线重连 | WSS (TLS)（开发环境用 WS） |
| 前端 | 大厅、房间、牌桌 | 移动端适配、聊天、排行榜 |
| 部署 | Node.js 直接运行 | Docker、Nginx、水平扩展 |
| AI | 基于规则的简单策略 | 机器学习、复杂策略 |

---

*文档结束*
