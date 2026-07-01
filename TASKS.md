# Texas Hold'em Poker - 开发任务列表

| 项目 | 内容 |
|------|------|
| 文档版本 | v1.0 |
| 创建日期 | 2026-06-29 |
| 架构师 | Architect Agent |
| 任务总数 | 30 |
| 预估总工时 | 4-5 小时（5-10 分钟/任务） |

---

## 任务依赖图

```
基础层 (可并行)
┌─────────────────────────────────────────────────────────────────┐
│  T1  T2  T3  T4  T5  T6  T7  T16                              │
│  项目  常量  Card Deck  牌型  底池  存储  前端基础                 │
│  骨架      实体 实体  评估  计算  Map  HTML/CSS                  │
└─────────────────────────────────────────────────────────────────┘
         │   │   │   │   │        │        │
         ▼   ▼   ▼   ▼   ▼        ▼        ▼
服务层 (部分依赖基础层)
┌─────────────────────────────────────────────────────────────────┐
│  T8  T9  T10a  T10b  T10c  T11  T17  T18  T21  T22  T24  T25  │
│  玩家  房间  游戏  游戏  游戏  AI  API  Socket  卡牌  筹码  座位  计时 │
│  管理  管理  引擎  引擎  引擎  管理  封装  客户端  组件  组件  组件  组件 │
│          初始化  下注轮  结算                              │
└─────────────────────────────────────────────────────────────────┘
         │   │    │    │    │        │    │    │    │    │    │
         ▼   ▼    ▼    ▼    ▼        ▼    ▼    ▼    ▼    ▼    ▼
API层 (依赖服务层)
┌─────────────────────────────────────────────────────────────────┐
│  T12  T13  T14  T15  T19  T20  T23  T26                        │
│  REST  Socket  Socket  Socket  大厅  房间  操作  牌桌              │
│  路由  初始化  房间事件  游戏事件  视图  视图  按钮  视图            │
└─────────────────────────────────────────────────────────────────┘
                              │    │    │    │
                              ▼    ▼    ▼    ▼
入口层
┌─────────────────────────────────────────────────────────────────┐
│  T27  T28  T29  T30                                             │
│  牌型测试  底池测试  引擎测试  前端入口                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 任务详情

### T1: 项目基础设施与入口文件
**优先级**: P0 | **依赖**: 无 | **可并行**: T2-T7, T16

**任务描述**:
创建项目目录结构，初始化 package.json，编写 server.js 骨架，使项目能 `npm start` 运行并监听端口。

**输入文件**:
- 无

**输出文件**:
- `package.json`（express, socket.io 依赖）
- `server.js`（Express 应用 + 静态文件服务 + Socket.IO 监听 + 端口 3000）
- `backend/config/constants.js` 空文件占位
- `backend/domain/` 目录下空文件占位
- `backend/services/` 目录下空文件占位
- `backend/storage/` 目录下空文件占位
- `backend/routes/` 目录下空文件占位
- `backend/socket/` 目录下空文件占位
- `frontend/` 目录及子目录创建

**验收标准**:
- [ ] `npm install` 成功安装所有依赖
- [ ] `node server.js` 启动后，浏览器访问 `http://localhost:3000` 返回 `index.html`（或 404 但服务已运行）
- [ ] Socket.IO 连接可建立（`io()` 成功）
- [ ] 目录结构与 ARCHITECTURE.md 一致

---

### T2: 游戏常量配置
**优先级**: P0 | **依赖**: 无 | **可并行**: T1, T3-T7, T16

**任务描述**:
编写 `backend/config/constants.js`，定义所有游戏硬编码参数，便于后续调整。

**输入文件**:
- 无

**输出文件**:
- `backend/config/constants.js`

**内容要求**:
```javascript
module.exports = {
  MAX_SEATS: 9,
  MIN_PLAYERS: 2,
  DEFAULT_MAX_PLAYERS: 6,
  DEFAULT_SMALL_BLIND: 10,
  DEFAULT_BIG_BLIND: 20,
  DEFAULT_INITIAL_CHIPS: 1000,
  ACTION_TIMEOUT_MS: 30000,
  ACTION_WARNING_MS: 10000,
  DISCONNECT_TIMEOUT_MS: 60000,
  AI_DELAY_MIN_MS: 1000,
  AI_DELAY_MAX_MS: 5000,
  ROOM_ID_LENGTH: 6,
  GUEST_NAMES: ['Ace', 'King', 'Queen', 'Jack', 'Joker', 'Dealer', ...],
  GUEST_AVATARS: ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', ...],
  AI_NAMES: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota'],
  AI_STYLES: ['tight', 'loose', 'balanced'],
  CARD_SUITS: ['hearts', 'diamonds', 'clubs', 'spades'],
  CARD_RANKS: ['2','3','4','5','6','7','8','9','10','J','Q','K','A'],
  RANK_VALUES: { '2':2, '3':3, ... 'A':14 },
  HAND_RANKS: {
    ROYAL_FLUSH: 1, STRAIGHT_FLUSH: 2, FOUR_KIND: 3,
    FULL_HOUSE: 4, FLUSH: 5, STRAIGHT: 6,
    THREE_KIND: 7, TWO_PAIR: 8, ONE_PAIR: 9, HIGH_CARD: 10
  }
};
```

**验收标准**:
- [ ] 所有常量已定义，无遗漏关键值
- [ ] 可通过 `require('./backend/config/constants')` 正确导入
- [ ] 常量值合理（盲注默认 10/20，初始筹码 1000，超时 30 秒）

---

### T3: Card 实体与工具
**优先级**: P0 | **依赖**: 无 | **可并行**: T1, T2, T4-T7, T16

**任务描述**:
实现 `backend/domain/card.js`，定义 Card 类及辅助工具函数。

**输入文件**:
- 无（不依赖 T2，内部自包含 suit/rank 定义）

**输出文件**:
- `backend/domain/card.js`

**接口契约**:
```javascript
class Card {
  constructor(suit, rank) // suit: 'hearts'|'diamonds'|'clubs'|'spades', rank: '2'-'A'
  toString() → 'A♠' 等
  toJSON() → { suit, rank }
  static rankValue(rank) → number  // 2→2, A→14
  static compare(cardA, cardB) → number  // 按 rankValue 比较
}

// 辅助
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
function displayCard(card) → string  // 如 'A♠'
```

**验收标准**:
- [ ] Card 类可创建、toString 正确输出带花色符号的字符串
- [ ] rankValue('A') === 14, rankValue('2') === 2
- [ ] 比较函数返回正确结果（A > K）
- [ ] 有独立的单元测试文件或至少 5 个测试用例在文件中注释验证

---

### T4: Deck 实体（牌组与洗牌）
**优先级**: P0 | **依赖**: T3 | **可并行**: T2, T5-T7, T16

**任务描述**:
实现 `backend/domain/deck.js`，标准52张扑克牌生成、Fisher-Yates洗牌、发牌。

**输入文件**:
- `backend/domain/card.js`（Card 类）

**输出文件**:
- `backend/domain/deck.js`

**接口契约**:
```javascript
class Deck {
  constructor()          // 生成一副新牌（52张，有序）
  shuffle()              // Fisher-Yates 原地洗牌
  deal(n) → Card[]       // 从顶部发 n 张牌，从 deck 移除
  remaining() → number   // 剩余牌数
  peek(n) → Card[]     // 查看顶部 n 张（不移除）
}
```

**验收标准**:
- [ ] 新 Deck 有 52 张牌，无重复
- [ ] shuffle() 后牌序随机变化（可测试多次洗牌结果不同）
- [ ] deal(2) 返回 2 张 Card，剩余 50 张
- [ ] 牌发完后 deal() 返回 [] 或报错（合理处理）
- [ ] 有独立的单元测试或至少 5 个测试用例

---

### T5: HandEvaluator 牌型评估引擎
**优先级**: P0 | **依赖**: T3 | **可并行**: T2, T4, T6, T7, T16

**任务描述**:
实现 `backend/domain/hand-evaluator.js`，从 7 张牌中找出最优 5 张组合，判断牌型并返回可比较的结果。

**输入文件**:
- `backend/domain/card.js`

**输出文件**:
- `backend/domain/hand-evaluator.js`

**接口契约**:
```javascript
const HandEvaluator = {
  // 从 7 张牌中评估最优 5 张
  evaluate(cards: Card[7]) → {
    rank: number,        // 1=皇家同花顺, 2=同花顺, ... 10=高牌
    name: string,        // 'Royal Flush', 'Two Pair', 'High Card' 等
    cards: Card[5],     // 组成牌型的 5 张牌
    kickers: number[]   // 用于平局的踢脚值
    score: number       // 可直接比较的总分
  }
  
  // 比较两手牌
  compare(handA, handB) → -1 | 0 | 1  // handA 小于/等于/大于 handB
  
  // 从 2 张底牌评估起手牌强度（0-100，供 AI 使用）
  holeCardStrength(holeCards: Card[2]) → number
};
```

**算法要点**:
1. 生成 C(7,5) = 21 种 5 张组合
2. 对每种组合评分（同花顺>四条>葫芦>同花>顺子>三条>两对>一对>高牌）
3. 同牌型比较关键牌点数，再比较踢脚
4. 返回最高分的组合

**验收标准**:
- [ ] 皇家同花顺正确识别（如 ♠10J♠Q♠K♠A）
- [ ] 四条、葫芦、同花、顺子、三条、两对、一对、高牌均正确判断
- [ ] 平局比较正确（如两队 KQ 对两队 KJ，前者赢）
- [ ] 从 7 张中选最优 5 张（例如底牌有对子，公共牌无帮助，选底牌对子）
- [ ] 至少 20 个测试用例覆盖所有牌型及边界情况
- [ ] 性能：1000 次评估 < 100ms

---

### T6: PotManager 底池计算引擎
**优先级**: P0 | **依赖**: 无 | **可并行**: T1-T5, T7, T16

**任务描述**:
实现 `backend/domain/pot-manager.js`，处理下注收集和 All-in 产生的边池计算。

**输入文件**:
- 无（纯计算逻辑，不依赖 Card）

**输出文件**:
- `backend/domain/pot-manager.js`

**接口契约**:
```javascript
class PotManager {
  constructor(seats)   // seats: [{ position, totalBet, status, chips }]
  
  addBet(position, amount) → void   // 记录某位置下注金额
  
  // 计算所有底池（主池 + 边池）
  calculatePots() → {
    mainPot: number,
    sidePots: [{ amount: number, eligiblePositions: number[] }]
  }
  
  // 根据胜负结果分配底池
  // winners: [{ position, handScore }]
  distribute(winners) → { position: payoutAmount }
  
  reset() → void  // 新牌局重置
}
```

**算法要点**:
1. 收集所有参与玩家的 totalBet（本局总投入），排除 folded 玩家
2. 按 totalBet 从小到大排序，形成不同"层级"
3. 每个层级差额 × 可参与玩家数 = 该层级底池
4. 总下注 < 层级值的玩家不参与该层级边池
5. 分配时每个边池单独比较 eligiblePositions 内玩家的牌型

**验收标准**:
- [ ] 简单场景：3 人下注各 100，主池 300，正确分配
- [ ] 1 人 All-in（50），其余 2 人继续下注到 200，产生主池 150 + 边池 300
- [ ] 多层 All-in：3 人分别 All-in 50/100/200，正确产生主池+2 边池
- [ ] All-in 玩家只赢得自己能参与的主池
- [ ] 平局时平分对应底池（考虑奇数筹码分配）
- [ ] 至少 10 个测试用例

---

### T7: MemoryStore 内存存储
**优先级**: P0 | **依赖**: 无 | **可并行**: T1-T6, T16

**任务描述**:
实现 `backend/storage/memory-store.js`，提供基于 Map 的内存存储，所有方法返回 Promise。

**输入文件**:
- 无

**输出文件**:
- `backend/storage/memory-store.js`

**接口契约**:
```javascript
class MemoryStore {
  // 用户
  async createPlayer(player) → Player
  async getPlayer(id) → Player | null
  async getPlayerBySocket(socketId) → Player | null
  async updatePlayer(id, updates) → Player
  async deletePlayer(id) → void
  async listPlayers() → Player[]
  
  // 房间
  async createRoom(room) → Room
  async getRoom(id) → Room | null
  async updateRoom(id, updates) → Room
  async deleteRoom(id) → void
  async listRooms(filter?) → Room[]  // filter: { status, isPublic }
  
  // 牌局
  async createGame(game) → Game
  async getGame(id) → Game | null
  async updateGame(id, updates) → Game
  async deleteGame(id) → void
}
```

**数据格式**:
- Player: { id, username, nickname, avatar, chips, isGuest, socketId, isOnline, currentRoom, createdAt, lastLoginAt }
- Room: { id, name, hostId, maxPlayers, smallBlind, bigBlind, initialChips, allowAI, password, status, seats, players, chatHistory, currentGameId, createdAt }
- Seat: { position, playerId, isAI, nickname, avatar, chips, status, isReady, isDealer, isSmallBlind, isBigBlind, holeCards, currentBet, totalBet, isDisconnected }
- Game: { id, roomId, status, dealerPosition, smallBlindPosition, bigBlindPosition, communityCards, pot, sidePots, currentRoundBet, currentPlayerPosition, lastRaisePosition, deck, seats, actions, roundActions, timeoutAt, timer, createdAt, endedAt }

**验收标准**:
- [ ] 所有 CRUD 操作正常工作
- [ ] createPlayer 生成 UUID 作为 ID
- [ ] createRoom 生成 6 位字母数字房间号
- [ ] 不存储重复的键（create 时检查存在性）
- [ ] 返回 Promise，可用 async/await
- [ ] 至少 10 个测试用例

---

### T8: PlayerManager 玩家管理
**优先级**: P0 | **依赖**: T7 | **可并行**: T9, T10a-T10c, T11, T16-T18

**任务描述**:
实现 `backend/services/player-manager.js`，管理游客创建、玩家连接映射。

**输入文件**:
- `backend/storage/memory-store.js`
- `backend/config/constants.js`（GUEST_NAMES, GUEST_AVATARS）

**输出文件**:
- `backend/services/player-manager.js`

**接口契约**:
```javascript
class PlayerManager {
  constructor(store)
  
  createGuest(socketId) → Promise<Player>   // 随机昵称 + 颜色头像
  getOrCreateGuest(socketId) → Promise<Player>
  getPlayerById(id) → Promise<Player | null>
  getPlayerBySocket(socketId) → Promise<Player | null>
  setPlayerSocket(playerId, socketId) → Promise<Player>   // 更新连接
  disconnectPlayer(socketId) → Promise<void>   // 标记离线，不清除数据
  updatePlayer(playerId, updates) → Promise<Player>
}
```

**验收标准**:
- [ ] createGuest 生成随机昵称（如 "Ace"）和颜色头像
- [ ] 同一 socketId 重复调用返回同一玩家（或更新现有）
- [ ] disconnectPlayer 标记玩家 isOnline=false，但保留数据
- [ ] 玩家可通过 socketId 查询
- [ ] 至少 5 个测试用例

---

### T9: RoomManager 房间管理
**优先级**: P0 | **依赖**: T7 | **可并行**: T8, T10a-T10c, T11, T16-T18

**任务描述**:
实现 `backend/services/room-manager.js`，管理房间生命周期（创建、加入、入座、准备、开始）。

**输入文件**:
- `backend/storage/memory-store.js`
- `backend/config/constants.js`（MAX_SEATS, DEFAULT_*, ROOM_ID_LENGTH）

**输出文件**:
- `backend/services/room-manager.js`

**接口契约**:
```javascript
class RoomManager {
  constructor(store)
  
  createRoom(config, hostId) → Promise<Room>   // config: name, maxPlayers, smallBlind, bigBlind, initialChips, allowAI, password
  joinRoom(roomId, playerId, password?) → Promise<Room>
  leaveRoom(roomId, playerId) → Promise<Room>
  sit(roomId, playerId, position) → Promise<Room>   // 入座到指定位置（0-8）
  stand(roomId, playerId) → Promise<Room>   // 离座
  ready(roomId, playerId, isReady) → Promise<Room>   // 准备/取消准备
  canStart(roomId) → Promise<boolean>   // 检查是否满足开始条件
  startGame(roomId, hostId) → Promise<{ room, gameId }>  // 返回 gameId 由 GameEngine 使用
  listPublicRooms() → Promise<Room[]>   // 仅返回 waiting 状态的公开房间
  getRoom(roomId) → Promise<Room | null>
  
  // 内部辅助
  _generateRoomId() → string   // 6位字母数字，不重复
  _createEmptySeats(maxPlayers) → Seat[]  // 9个座位，maxPlayers 限制可用
}
```

**开始条件检查**:
- 至少 MIN_PLAYERS(2) 个已入座且已准备的玩家
- 所有已入座玩家都已准备
- 房主点击"开始"
- 房间状态为 'waiting'

**验收标准**:
- [ ] 创建房间生成 6 位唯一房间号
- [ ] 加入房间检查密码（私密房间）
- [ ] 入座检查位置是否为空且未超过 maxPlayers 限制
- [ ] 离座后座位恢复为 empty
- [ ] ready 切换正确，canStart 判断正确
- [ ] 房主才能开始游戏
- [ ] 公开房间列表不包含私密房间和游戏中房间
- [ ] 至少 10 个测试用例

---

### T10a: GameEngine 初始化与发牌
**优先级**: P0 | **依赖**: T4, T7 | **可并行**: T8, T9, T10b, T10c, T11, T16-T18

**任务描述**:
实现 `backend/services/game-engine.js` 的构造函数和 `start()` 方法，初始化牌局、确定庄家/盲注、发底牌。

**输入文件**:
- `backend/domain/deck.js`（Deck）
- `backend/storage/memory-store.js`
- `backend/config/constants.js`（DEFAULT_BIG_BLIND, DEFAULT_SMALL_BLIND）

**输出文件**:
- `backend/services/game-engine.js`（部分：类定义、constructor、start 方法）

**接口契约（本任务实现）**:
```javascript
class GameEngine {
  constructor(room, store)
  
  // 初始化新牌局
  async start() → GameState
  // 行为：
  // 1. 创建 Game 对象存入 store
  // 2. 根据上一局 dealerPosition 计算新 dealer（顺时针移一位）
  //    首次游戏：dealer = 0 或随机第一个入座玩家
  // 3. 计算 SB/BB 位置（dealer 左1=SB, 左2=BB）
  // 4. 设置座位状态为 'playing'，扣除盲注筹码
  // 5. 生成新 Deck 并洗牌
  // 6. 给每个 playing 座位发 2 张底牌（holeCards）
  // 7. 确定第一个行动玩家（BB 下家，即 dealer 左3）
  // 8. 设置状态为 'preflop'
  // 9. 返回 GameState（不含底牌，底牌通过单独接口发送）
}

// GameState 格式（服务端内部完整状态）
GameState = {
  id, roomId, status, dealerPosition, smallBlindPosition, bigBlindPosition,
  communityCards, pot, sidePots, currentRoundBet, currentPlayerPosition,
  lastRaisePosition, seats: Seat[], actions, roundActions, timeoutAt
}
```

**验收标准**:
- [ ] start() 创建 Game 并持久化到 MemoryStore
- [ ] 庄家位置正确轮转（顺时针移一位）
- [ ] SB/BB 位置正确，自动扣除盲注（SB 先扣，BB 后扣）
- [ ] 每个 playing 座位获得 2 张不同的底牌
- [ ] 剩余牌堆有 52 - 2×players 张
- [ ] 第一个行动玩家是 BB 下家（dealer 左3）
- [ ] 房间状态变为 'playing'
- [ ] 返回的 GameState 中 seats 的 holeCards 为 null（不暴露）

---

### T10b: GameEngine 下注轮处理
**优先级**: P0 | **依赖**: T10a | **可并行**: T10c, T11, T16-T18

**任务描述**:
实现 `backend/services/game-engine.js` 的 `action()` 方法，处理玩家下注、判断轮结束、推进游戏阶段。

**输入文件**:
- `backend/services/game-engine.js`（T10a 部分）
- `backend/config/constants.js`（ACTION_TIMEOUT_MS）

**输出文件**:
- `backend/services/game-engine.js`（追加 action 方法及辅助方法）

**接口契约（本任务实现）**:
```javascript
class GameEngine {
  // ... constructor 和 start() 已在 T10a 实现
  
  // 处理玩家行动
  async action(position, type, amount?) → GameState
  // 行为：
  // 1. 验证当前是否轮到该玩家行动（position === currentPlayerPosition）
  // 2. 验证 action 合法性（通过 getValidActions）
  // 3. 更新座位状态、筹码、currentBet、totalBet
  // 4. 记录 action 到 actions 和 roundActions
  // 5. 检查轮次是否结束（所有未 fold/all-in 玩家都行动且下注平衡）
  // 6. 如果轮结束：推进到下一阶段（preflop→flop→turn→river→showdown）
  // 7. 如果只剩 1 人未 fold：直接跳过到结算
  // 8. 如果所有未 fold 玩家都 all-in：直接发完剩余公共牌并摊牌
  // 9. 确定下一个行动玩家（顺时针下一个未 fold/all-in 且未弃权的玩家）
  // 10. 重置超时计时器
  // 11. 返回 GameState
  
  getValidActions(position) → [{ type, minAmount?, maxAmount? }]
  // 根据当前状态计算该位置可用的行动列表
  // 例如：无人下注时 → [Check, Bet(最小大盲)]
  // 有人下注且未跟注 → [Fold, Call, Raise]
  // 筹码不足 → [Fold, All-in]
  
  _isRoundComplete() → boolean
  // 检查当前轮是否结束：
  // 所有未 fold 且未 all-in 的玩家都已行动
  // 且所有人的 currentBet 等于 currentRoundBet
  // 或只剩 1 人未 fold
  // 或所有未 fold 都 all-in
  
  _advancePhase() → void
  // 推进到下一阶段：
  // preflop → flop（发3张公共牌）
  // flop → turn（发第4张）
  // turn → river（发第5张）
  // river → showdown（摊牌）
  // 每次推进：重置 roundActions，currentRoundBet=0，各座位 currentBet=0
  // 设置第一个行动玩家（小盲位或第一个未 fold 玩家）
  
  _getNextPlayer(startPosition) → number | null
  // 从 startPosition 开始顺时针找下一个需要行动的玩家
  // 跳过 fold/all-in 玩家，如果没有则返回 null（轮结束）
  
  _startTimeout() → void
  // 启动 30 秒计时器，超时自动调用 timeoutFold
  
  _clearTimeout() → void
  // 清除计时器
}
```

**行动逻辑**:
| Action | 处理 |
|--------|------|
| Fold | 座位状态设为 'folded'，currentBet 不变化，已下注保留在底池 |
| Check | 不下注，currentBet 保持（等于 currentRoundBet 时允许） |
| Call | 下注差额 = currentRoundBet - seat.currentBet，从 chips 扣除 |
| Bet | 作为第一个下注者，设置 currentRoundBet = amount，currentBet = amount |
| Raise | 提高 currentRoundBet，amount 必须 >= 2×上一加注量或 currentRoundBet+minRaise |
| All-in | 将所有剩余 chips 推入，currentBet += chips，chips = 0，状态设为 'allin' |

**验收标准**:
- [ ] 验证当前玩家是否轮到行动（错误返回 error）
- [ ] 非法 action 被拒绝（如无法下注时 Bet）
- [ ] 筹码不足时自动降级为 All-in 或拒绝
- [ ] Call 后下注平衡，轮到下一个玩家
- [ ] Raise 后其他玩家需要重新行动
- [ ] 轮结束条件正确（所有未 fold 且未 all-in 玩家都行动且下注平衡）
- [ ] 轮结束后正确推进到下一阶段（发公共牌）
- [ ] 只剩 1 人未 fold 时自动跳过到结算
- [ ] 所有未 fold 都 all-in 时直接发完剩余公共牌并进入 showdown
- [ ] 至少 15 个测试用例

---

### T10c: GameEngine 摊牌与结算
**优先级**: P0 | **依赖**: T5, T6, T10a, T10b | **可并行**: T11, T16-T18

**任务描述**:
实现 `backend/services/game-engine.js` 的 `showdown()` 和结算逻辑，使用 HandEvaluator 和 PotManager 分配底池。

**输入文件**:
- `backend/services/game-engine.js`（T10a, T10b）
- `backend/domain/hand-evaluator.js`
- `backend/domain/pot-manager.js`

**输出文件**:
- `backend/services/game-engine.js`（追加 showdown 方法）

**接口契约（本任务实现）**:
```javascript
class GameEngine {
  // ... 已有方法 ...
  
  // 摊牌 + 分配底池
  async showdown() → GameState
  // 行为：
  // 1. 收集所有未 fold 的座位
  // 2. 对每个座位：用 HandEvaluator.evaluate(2底牌 + 5公共牌) 评估牌型
  // 3. 使用 PotManager 计算主池和边池
  // 4. 对每个池（主池+边池），在 eligiblePositions 中比较牌型，胜者赢该池
  // 5. 更新各座位 chips（加上赢的筹码）
  // 6. 记录 winners 和 payouts
  // 7. 设置状态为 'ended'
  // 8. 返回包含 winners 和 payouts 的 GameState
  
  // 处理只剩 1 人未 fold 的直接获胜
  async _autoWin() → GameState
  // 该玩家赢得整个底池，直接跳到 ended
  
  // 获取某玩家可见的 GameState（用于发送给客户端，隐藏其他玩家底牌）
  getClientState(playerPosition) → GameState
  // 仅该玩家的 seat 有 holeCards，其他为 null
  // 若状态为 'ended' 或 'showdown'，所有底牌可见
  
  // 获取超时弃牌处理
  async timeoutFold(position) → GameState
  // 调用 action(position, 'fold')
  
  // 下一局准备
  async nextHand() → { room, gameId }
  // 重置座位状态为 ready/occupied，扣除破产玩家，更新 dealer
}
```

**验收标准**:
- [ ] showdown 正确调用 HandEvaluator 比较所有未 fold 玩家的 7 张牌
- [ ] PotManager 正确计算主池和边池
- [ ] 每个边池单独比较，eligiblePositions 内牌型最大者赢该池
- [ ] 平局时平分底池（无小数，向下取整或合理处理）
- [ ] 所有筹码变动正确（赢家增加，其他人不变）
- [ ] 状态最终变为 'ended'
- [ ] 只剩 1 人未 fold 时直接获胜，无需摊牌
- [ ] 返回的 GameState 包含 winners 和 payouts
- [ ] getClientState 正确隐藏其他玩家底牌（未结束时）
- [ ] 至少 10 个测试用例

---

### T11: AIManager AI 管理器
**优先级**: P0 | **依赖**: T5, T8 | **可并行**: T9, T10a-T10c, T16-T18

**任务描述**:
实现 `backend/services/ai-manager.js`，创建 AI 玩家，实现基于规则的决策逻辑。

**输入文件**:
- `backend/domain/hand-evaluator.js`（holeCardStrength 方法）
- `backend/services/player-manager.js`（或至少了解 Player 结构）
- `backend/config/constants.js`（AI_NAMES, AI_STYLES, AI_DELAY_*）

**输出文件**:
- `backend/services/ai-manager.js`

**接口契约**:
```javascript
class AIManager {
  constructor(store, playerManager)
  
  createBot(roomId, style?) → Player
  // 创建 AI 玩家，设置 isAI=true，随机 AI 名称，随机风格
  // 存入 MemoryStore，加入房间，自动入座到空位
  
  removeBot(roomId, position) → void
  // 移除指定位置的 AI，从房间和 store 删除
  
  fillRoomWithAI(roomId) → Player[]
  // 如果房间允许 AI，填充所有空座位到 maxPlayers
  // 返回创建的 AI 列表
  
  // 核心决策逻辑
  decideAction(gameState, botPosition) → { type, amount?, delayMs }
  // 输入：gameState（含公共牌、底池、当前注、手牌）
  // 输出：AI 决定的动作 + 模拟延迟（1-5秒）
  
  // 内部辅助
  _calculateHandScore(holeCards, communityCards) → number  // 0-100
  _calculatePotOdds(currentBet, pot) → number
  _getPositionBonus(position, totalPlayers) → number
  _applyStyleAdjustment(score, style) → number
  _selectAction(effectiveScore, validActions, chips) → { type, amount? }
}
```

**决策规则**:
1. 计算手牌强度（0-100）：无公共牌时用 holeCardStrength，有公共牌时用 HandEvaluator 映射
2. 计算底池赔率 = currentBet / (pot + currentBet)
3. 位置优势：后位（靠近 dealer）+0-15 分
4. 风格偏移：tight -10，loose +10，balanced 0
5. 有效分数 = 手牌强度 + 位置 + 风格
6. 决策：
   - < 30: Fold（或已跟注则 Check）
   - 30-50: Call（赔率合理）或 Check
   - 50-70: Call 或 Raise(minRaise)
   - > 70: Raise 或 All-in（筹码 < 3×BB）

**验收标准**:
- [ ] createBot 生成格式为 "Bot-名字" 的玩家，isAI=true
- [ ] fillRoomWithAI 正确填充到 maxPlayers
- [ ] decideAction 返回有效的 action 类型（在 validActions 中）
- [ ] 决策延迟 1-5 秒随机
- [ ] 不同 AI 风格产生不同倾向（tight 更保守，loose 更激进）
- [ ] AI 全押时返回 All-in 类型
- [ ] 至少 8 个测试用例（不同场景的手牌决策）

---

### T12: REST API 路由
**优先级**: P0 | **依赖**: T8, T9 | **可并行**: T13-T15, T19-T27

**任务描述**:
实现 Express REST API 路由，包括认证和房间相关接口。

**输入文件**:
- `backend/services/player-manager.js`
- `backend/services/room-manager.js`

**输出文件**:
- `backend/routes/auth.js`
- `backend/routes/rooms.js`

**接口契约**:
```javascript
// auth.js
POST /api/auth/guest → { success: true, player: { id, nickname, avatar, isGuest } }
// 创建游客，从 req.body.socketId 或生成新 ID

POST /api/auth/register → { success, player }  // MVP 阶段返回 501 或简单实现
POST /api/auth/login → { success, player }       // MVP 阶段返回 501 或简单实现

// rooms.js
GET /api/rooms → { success: true, rooms: Room[] }
// 调用 roomManager.listPublicRooms()

POST /api/rooms → { success: true, room: Room }
// 请求体：{ name, maxPlayers, smallBlind, bigBlind, initialChips, allowAI, password }
// 从 req.body 或 cookie 获取 playerId（房主）

GET /api/rooms/:id → { success: true, room: Room }
// 返回房间详情（不含底牌等敏感信息）

POST /api/rooms/:id/join → { success: true, room: Room }
// 请求体：{ password? }
// 从 req.body 或 cookie 获取 playerId
```

**验收标准**:
- [ ] 所有路由返回标准 JSON 格式 { success, data, error? }
- [ ] 游客创建返回正确 player 对象
- [ ] 创建房间返回 6 位房间号
- [ ] 公开房间列表不包含私密房间和游戏中房间
- [ ] 加入房间密码验证正确
- [ ] 错误返回 HTTP 400/404 + 错误信息
- [ ] 路由正确挂载到 Express app
- [ ] 至少 10 个 API 测试（可用 curl 或注释测试）

---

### T13: Socket.IO 初始化与连接管理
**优先级**: P0 | **依赖**: T1 | **可并行**: T12, T14, T15, T19-T27

**任务描述**:
实现 `backend/socket/index.js`，初始化 Socket.IO，管理连接和断开，维护 socket→player 映射。

**输入文件**:
- `server.js`（Socket.IO 实例）
- `backend/services/player-manager.js`

**输出文件**:
- `backend/socket/index.js`

**接口契约**:
```javascript
// index.js
function initSocketIO(io, playerManager, roomManager, gameEngine, aiManager)
// 初始化 Socket.IO 事件总线

// 连接处理
io.on('connection', (socket) => {
  // 1. 创建/获取游客玩家（通过 socket.id）
  // 2. 建立 socket ↔ player 映射
  // 3. 将 room-events 和 game-events 注册到 socket
  // 4. 断开时：disconnect 事件处理
})

// 断开处理
// 1. 标记玩家离线（playerManager.disconnectPlayer）
// 2. 如果玩家在房间中，触发 room:leave 逻辑（但保留座位 60 秒）
// 3. 60 秒后若未重连，清空座位，由 AI 填充或空出
// 断线重连：新 socket 连接时检查是否有匹配的 playerId，恢复连接
```

**验收标准**:
- [ ] Socket.IO 正确初始化并与 Express 集成
- [ ] 连接时自动创建/获取游客玩家
- [ ] socket 可发送和接收事件
- [ ] 断开时玩家被标记离线，但保留数据 60 秒
- [ ] 重连时（新 socket，相同 player 信息）可恢复连接
- [ ] 有连接日志输出（console.log）

---

### T14: Socket 房间事件处理器
**优先级**: P0 | **依赖**: T9, T13 | **可并行**: T12, T15, T19-T27

**任务描述**:
实现 `backend/socket/room-events.js`，处理房间相关 WebSocket 事件。

**输入文件**:
- `backend/socket/index.js`（Socket.IO 实例）
- `backend/services/room-manager.js`
- `backend/services/ai-manager.js`（fillRoomWithAI）

**输出文件**:
- `backend/socket/room-events.js`

**事件处理**:
```javascript
// 注册到 socket
socket.on('room:join', ({ roomId, password }) => {
  // 1. 调用 roomManager.joinRoom
  // 2. 如果允许 AI，填充 AI
  // 3. socket.join(roomId) 加入 Socket.IO 房间
  // 4. 广播 'player:joined' 给房间内所有人
  // 5. 发送 'room:state' 给加入者
})

socket.on('room:leave', () => {
  // 1. 获取玩家当前房间
  // 2. 调用 roomManager.leaveRoom
  // 3. socket.leave(roomId)
  // 4. 广播 'player:left'
})

socket.on('seat:sit', ({ position }) => {
  // 1. 调用 roomManager.sit
  // 2. 广播 'room:state' 或 'player:joined'
})

socket.on('seat:stand', () => {
  // 1. 调用 roomManager.stand
  // 2. 广播更新
})

socket.on('room:ready', ({ ready }) => {
  // 1. 调用 roomManager.ready
  // 2. 广播 'player:ready'
})

socket.on('room:start', () => {
  // 1. 验证是否房主
  // 2. 调用 roomManager.canStart
  // 3. 如果可开始：
  //    a. 调用 roomManager.startGame 获取 gameId
  //    b. 调用 gameEngine.start() 初始化游戏
  //    c. 广播 'game:started'
  //    d. 给每个玩家发送 'game:dealt'（仅含该玩家的底牌）
  //    e. 广播 'game:turn'（当前行动玩家）
  // 4. 如果不可开始，发送 error
})
```

**广播机制**:
- 使用 `io.to(roomId).emit('event', payload)` 广播给房间内所有 socket
- 使用 `socket.emit('event', payload)` 发送给特定客户端

**验收标准**:
- [ ] room:join 正确加入房间，触发广播
- [ ] room:leave 正确离开，广播 player:left
- [ ] seat:sit/stand 正确更新座位状态并广播
- [ ] room:ready 切换准备状态并广播
- [ ] room:start 只有房主能触发，检查开始条件
- [ ] 开始游戏后广播 game:started 和 game:dealt（各玩家收到自己的底牌）
- [ ] 错误处理：发送 'error' 事件给请求者
- [ ] 至少 8 个场景测试

---

### T15: Socket 游戏事件处理器
**优先级**: P0 | **依赖**: T10b, T10c, T11, T13 | **可并行**: T12, T14, T19-T27

**任务描述**:
实现 `backend/socket/game-events.js`，处理游戏动作和 AI 自动行动。

**输入文件**:
- `backend/socket/index.js`
- `backend/services/game-engine.js`
- `backend/services/ai-manager.js`

**输出文件**:
- `backend/socket/game-events.js`

**事件处理**:
```javascript
socket.on('game:action', ({ type, amount }) => {
  // 1. 获取玩家所在房间和游戏
  // 2. 验证是否轮到该玩家行动（通过 gameEngine.isPlayerTurn）
  // 3. 验证 action 合法性（通过 gameEngine.getValidActions）
  // 4. 调用 gameEngine.action(position, type, amount)
  // 5. 广播 'game:action' 给所有人（含位置、类型、金额）
  // 6. 广播更新后的 'game:pot'（底池信息）
  // 7. 如果游戏状态变化：
  //    a. 进入 flop/turn/river：广播 'game:community'（公共牌）
  //    b. 进入 showdown：广播 'game:showdown'（结果）
  //    c. 进入 ended：广播 'game:ended'（赢家和分配）
  // 8. 如果游戏继续：广播 'game:turn'（下一个行动玩家）
  // 9. 如果轮到 AI 行动：调用 aiManager.decideAction，延迟后自动执行
})

socket.on('game:request_state', () => {
  // 用于断线重连，发送完整游戏状态
  // 1. 获取玩家所在房间和游戏
  // 2. 调用 gameEngine.getClientState(playerPosition)
  // 3. 发送 'game:state' 给请求者
})
```

**AI 行动触发**:
- 当 game:turn 广播后，检查当前行动玩家是否为 AI
- 如果是 AI：调用 `aiManager.decideAction`，在 delayMs 后自动调用 `gameEngine.action`
- 广播 AI 的行动（与其他玩家一样）

**超时处理**:
- GameEngine 内部启动 30 秒计时器
- 超时自动调用 `timeoutFold(position)`
- 广播超时 Fold  action

**验收标准**:
- [ ] game:action 验证玩家轮次和合法性
- [ ] 合法 action 正确执行并广播 game:action 和 game:pot
- [ ] 轮次结束后自动推进并广播 game:community（公共牌）
- [ ] 摊牌时广播 game:showdown 含各玩家牌型
- [ ] 结算时广播 game:ended 含赢家和分配
- [ ] AI 自动行动，延迟 1-5 秒
- [ ] 超时自动 Fold 并广播
- [ ] 断线重连可请求完整游戏状态
- [ ] 至少 10 个场景测试

---

### T16: 前端 HTML 入口与基础样式
**优先级**: P0 | **依赖**: 无 | **可并行**: T1-T15, T17-T27

**任务描述**:
实现前端 HTML 骨架和 CSS 基础样式，支持 SPA 路由切换（通过 hash）。

**输入文件**:
- 无

**输出文件**:
- `frontend/index.html`
- `frontend/css/base.css`
- `frontend/css/lobby.css`（空或基础）
- `frontend/css/table.css`（空或基础）

**index.html 要求**:
- 单页应用结构：一个 `<div id="app">` 容器
- 包含三个视图容器：`<div id="lobby-view">`, `<div id="room-view">`, `<div id="table-view">`（初始隐藏）
- 引入 Socket.IO 客户端库（CDN 或本地）
- 引入 CSS 和 JS 文件（按顺序）
- 基础结构：header（用户信息）+ main（视图区）+ 无 footer（游戏专注）

**base.css 要求**:
- CSS 变量定义：主色、背景色、牌桌绿、筹码金、错误红等
- 重置样式（* margin padding box-sizing）
- 基础排版、按钮样式、输入框样式
- 响应式基础（min-width, 防止过小）
- 动画定义：闪烁（行动指示）、渐变（发牌）

**验收标准**:
- [ ] 打开 index.html 显示正确的基础布局
- [ ] CSS 变量已定义，颜色合理（牌桌背景绿色 #0d5c3b）
- [ ] 按钮有悬停效果
- [ ] 视图容器默认隐藏，通过 JS 切换
- [ ] 在浏览器中打开视觉效果正常（无严重错位）

---

### T17: 前端 API 封装
**优先级**: P0 | **依赖**: T16 | **可并行**: T18-T27

**任务描述**:
实现 `frontend/js/api.js`，封装所有 HTTP API 调用。

**输入文件**:
- REST API 定义（来自 T12）

**输出文件**:
- `frontend/js/api.js`

**接口契约**:
```javascript
const API = {
  baseUrl: '/api',
  
  async request(method, path, body?) → Promise<{ success, data, error }>
  // 封装 fetch，处理 JSON，统一错误格式
  
  // 认证
  async createGuest() → Promise<{ player }>
  async register(username, password) → Promise<{ player }>  // MVP后
  async login(username, password) → Promise<{ player }>      // MVP后
  
  // 房间
  async getRooms() → Promise<{ rooms }>
  async createRoom(config) → Promise<{ room }>
  async getRoom(roomId) → Promise<{ room }>
  async joinRoom(roomId, password?) → Promise<{ room }>
};
```

**验收标准**:
- [ ] 封装 fetch 处理 JSON 解析和错误
- [ ] 所有 API 方法可用
- [ ] 错误处理返回 { success: false, error: message }
- [ ] 成功返回 { success: true, data: ... }
- [ ] 在浏览器控制台可测试（如 `API.createGuest()`）

---

### T18: 前端 Socket 客户端
**优先级**: P0 | **依赖**: T16 | **可并行**: T17, T19-T27

**任务描述**:
实现 `frontend/js/socket-client.js`，管理 Socket.IO 连接、事件监听和发送。

**输入文件**:
- WebSocket 事件定义（来自 T13-T15）

**输出文件**:
- `frontend/js/socket-client.js`

**接口契约**:
```javascript
const SocketClient = {
  socket: null,
  
  connect() → void
  // 连接 io()，设置事件监听
  
  disconnect() → void
  
  // 事件发送
  emit(event, payload) → void
  joinRoom(roomId, password?) → void    // emit 'room:join'
  leaveRoom() → void                    // emit 'room:leave'
  sit(position) → void                  // emit 'seat:sit'
  stand() → void                        // emit 'seat:stand'
  ready(isReady) → void                 // emit 'room:ready'
  startGame() → void                    // emit 'room:start'
  gameAction(type, amount?) → void      // emit 'game:action'
  sendChat(text) → void                 // emit 'chat:message'
  requestGameState() → void             // emit 'game:request_state'
  
  // 事件监听注册（订阅模式）
  on(event, callback) → void
  off(event, callback) → void
  
  // 内部事件处理
  _handleConnect() → void
  _handleDisconnect() → void
  _handleError({ code, message }) → void
};
```

**事件监听**:
- 连接成功后自动创建游客（通过 API.createGuest，然后发送 socket 标识）
- 所有服务端事件通过 `on()` 注册回调，由各视图组件订阅

**验收标准**:
- [ ] connect() 成功建立 Socket.IO 连接
- [ ] 可发送和接收事件
- [ ] on()/off() 订阅模式工作正常
- [ ] 断线时触发 disconnect 回调
- [ ] 重连逻辑（自动尝试重连）
- [ ] 在浏览器控制台可测试（如 `SocketClient.emit('room:join', { roomId: 'ABC123' })`）

---

### T19: 前端大厅视图
**优先级**: P0 | **依赖**: T16, T17 | **可并行**: T20-T27

**任务描述**:
实现 `frontend/js/views/lobby.js`，渲染大厅界面（房间列表、快速开始、创建房间）。

**输入文件**:
- `frontend/js/api.js`
- `frontend/js/socket-client.js`

**输出文件**:
- `frontend/js/views/lobby.js`
- `frontend/css/lobby.css`（补充样式）

**界面要求**:
```
┌─────────────────────────────────────────┐
│  [头像] 昵称: Guest-Ace    筹码: 1000  │  ← 顶部用户信息
├─────────────────────────────────────────┤
│                                         │
│  [公开房间列表]        [创建房间]        │
│  ┌─────────┐                           │
│  │ Room#1  │  6/6  10/20  游戏中       │
│  │ Room#2  │  3/6  10/20  等待中 [加入]│
│  │ ...     │                           │
│  └─────────┘                           │
│                                         │
│  [快速开始]  [输入房间号加入]           │
│                                         │
└─────────────────────────────────────────┘
```

**功能**:
- 显示当前用户信息（昵称、头像、筹码）
- 加载并显示公开房间列表（定时刷新或 Socket 推送）
- 点击房间加入（公开房间直接加入，私密房间弹密码输入）
- 快速开始：自动匹配一个有空位的等待中房间
- 创建房间：弹出模态框，设置名称、人数、盲注、密码、是否允许 AI
- 加入成功后切换到 room-view

**验收标准**:
- [ ] 页面加载时显示用户信息（游客自动生成）
- [ ] 房间列表正确显示（房间号、人数、盲注、状态）
- [ ] 点击房间加入成功，切换到房间视图
- [ ] 快速开始能匹配到可用房间
- [ ] 创建房间弹出模态框，提交后创建并进入
- [ ] 样式美观，布局正确
- [ ] 至少 5 个场景测试

---

### T20: 前端房间视图
**优先级**: P0 | **依赖**: T16, T18 | **可并行**: T19, T21-T27

**任务描述**:
实现 `frontend/js/views/room.js`，渲染房间等待界面（座位、准备、房主开始）。

**输入文件**:
- `frontend/js/socket-client.js`
- `frontend/js/components/seat.js`（T24，可先使用简单占位）

**输出文件**:
- `frontend/js/views/room.js`

**界面要求**:
```
┌─────────────────────────────────────────┐
│  房间: Texas Room  #  盲注: 10/20        │
├─────────────────────────────────────────┤
│                                         │
│   [座位1]  [座位2]  [座位3]             │
│   玩家A    空位      Bot-Alpha          │
│   [已准备] [入座]    [AI]               │
│                                         │
│   [座位4]  [座位5]  [座位6]             │
│   空位     我        空位               │
│   [入座]   [准备]   [入座]              │
│                                         │
│  房主: 玩家A                             │
│  [开始游戏]（仅房主可见，所有人准备后启用）│
│                                         │
└─────────────────────────────────────────┘
```

**功能**:
- 显示房间信息（名称、房间号、盲注、人数）
- 渲染 9 个座位（或 maxPlayers 限制），显示占用状态
- 空位显示"入座"按钮，点击后入座
- 已入座显示玩家昵称、头像、准备状态
- 显示"准备"按钮（入座后）
- 房主显示"开始游戏"按钮（所有人准备后启用）
- 监听 Socket 事件更新房间状态
- 离开房间按钮（返回大厅）

**验收标准**:
- [ ] 正确渲染所有座位和玩家状态
- [ ] 点击空位入座成功，广播更新
- [ ] 准备按钮切换状态
- [ ] 房主开始按钮在所有人准备后启用
- [ ] 开始游戏后切换到 table-view
- [ ] 离开房间返回大厅
- [ ] 至少 5 个场景测试

---

### T21: 前端卡牌组件
**优先级**: P0 | **依赖**: T16 | **可并行**: T19, T20, T22-T27

**任务描述**:
实现 `frontend/js/components/card.js`，渲染扑克牌 HTML。

**输入文件**:
- 无（纯 UI 组件）

**输出文件**:
- `frontend/js/components/card.js`
- `frontend/css/table.css`（补充卡牌样式）

**接口契约**:
```javascript
const CardComponent = {
  // 渲染单张牌
  render(card, options?) → HTMLElement
  // card: { suit, rank } 或 null（背面）
  // options: { small?, hidden? }
  // 返回 div 元素，可直接插入 DOM
  
  // 渲染一组牌
  renderCards(cards, options?) → HTMLElement
  // 返回包含多张牌的容器 div
  
  // 花色颜色
  getSuitColor(suit) → 'red' | 'black'
  // hearts/diamonds = red, clubs/spades = black
};
```

**视觉要求**:
- 扑克牌样式：白色背景，圆角，黑色边框
- 左上角：rank + 花色符号（红色 hearts/diamonds，黑色 clubs/spades）
- 中央大花色符号
- 背面：蓝色花纹（CSS 背景图案）
- 支持小尺寸（座位前显示）和正常尺寸（手牌）
- 支持动画：发牌时从中央飞到目标位置（CSS transition）

**验收标准**:
- [ ] 单张牌渲染正确，花色颜色正确
- [ ] 背面样式美观
- [ ] 小尺寸模式适用于座位前显示
- [ ] 动画效果流畅（CSS transform/transition）
- [ ] 在浏览器中视觉正常
- [ ] 至少 3 个测试场景

---

### T22: 前端筹码与底池组件
**优先级**: P0 | **依赖**: T16 | **可并行**: T19-T21, T23-T27

**任务描述**:
实现 `frontend/js/components/chips.js` 和 `frontend/js/components/pot.js`，渲染筹码和底池显示。

**输入文件**:
- 无

**输出文件**:
- `frontend/js/components/chips.js`
- `frontend/js/components/pot.js`

**接口契约**:
```javascript
const ChipsComponent = {
  // 渲染筹码堆（单个玩家的下注）
  render(amount, position?) → HTMLElement
  // position: 座位位置，用于定位
  // 金额小：1-2个筹码图标
  // 金额大：多个筹码堆叠，带金额文字
  
  // 筹码颜色映射
  getChipColor(amount) → string
  // 小金额：白色，中等：红色，大金额：绿色，极大：黑色
};

const PotComponent = {
  // 渲染中央底池
  render(mainPot, sidePots?) → HTMLElement
  // mainPot: 主池金额
  // sidePots: [{ amount, name }]
  // 显示"底池: $500"，有边池时显示"主池: $300 | 边池1: $200"
  
  // 更新动画
  update(newAmount) → void
  // 数字跳动动画
};
```

**视觉要求**:
- 筹码：圆形 CSS 样式，带金额文字
- 底池：中央大字体显示，金色
- 边池：在主池下方小字显示

**验收标准**:
- [ ] 筹码渲染正确，金额与图标数量对应
- [ ] 底池显示正确金额
- [ ] 边池显示正确（如果有）
- [ ] 动画效果流畅
- [ ] 在浏览器中视觉正常

---

### T23: 前端操作按钮组件
**优先级**: P0 | **依赖**: T16 | **可并行**: T19-T22, T24-T27

**任务描述**:
实现 `frontend/js/components/actions.js`，渲染玩家行动按钮（Fold/Check/Call/Raise/All-in）。

**输入文件**:
- 无

**输出文件**:
- `frontend/js/components/actions.js`
- `frontend/css/table.css`（补充按钮样式）

**接口契约**:
```javascript
const ActionsComponent = {
  // 渲染操作按钮区
  render(validActions, currentBet, myChips, pot) → HTMLElement
  // validActions: [{ type, minAmount?, maxAmount? }]
  // 根据可用行动渲染对应的按钮
  
  // 按钮类型：
  // Fold: 红色，放弃本局
  // Check: 灰色，过牌
  // Call: 蓝色，跟注 $X
  // Bet: 绿色，下注（带输入框）
  // Raise: 橙色，加注（带输入框和快捷按钮）
  // All-in: 紫色，全押 $X
  
  // 事件：点击按钮后调用 onAction(type, amount)
  
  onAction: null,  // 外部设置的回调函数
  
  // 隐藏/显示
  hide() → void
  show() → void
  
  // 更新按钮状态（根据新的 validActions）
  update(validActions) → void
};
```

**视觉要求**:
- 按钮水平排列，底部固定区域
- 当前不可用的按钮隐藏（而非禁用）
- Raise 时显示滑块或快捷按钮（最小加注、2×、全押）
- 按钮有悬停和点击效果
- 我的回合时显示，非我的回合隐藏

**验收标准**:
- [ ] 根据 validActions 正确显示可用按钮
- [ ] 无人下注时显示 Check 和 Bet
- [ ] 有人下注时显示 Fold、Call、Raise
- [ ] 筹码不足时显示 All-in 替代 Call/Raise
- [ ] Raise 时支持输入金额和快捷选择
- [ ] 点击按钮触发正确的事件回调
- [ ] 非我的回合时隐藏
- [ ] 至少 5 个场景测试

---

### T24: 前端座位组件
**优先级**: P0 | **依赖**: T16, T21 | **可并行**: T19-T20, T22-T23, T25-T27

**任务描述**:
实现 `frontend/js/components/seat.js`，渲染单个座位及其状态。

**输入文件**:
- `frontend/js/components/card.js`（T21）

**输出文件**:
- `frontend/js/components/seat.js`

**接口契约**:
```javascript
const SeatComponent = {
  // 渲染单个座位
  render(seat, options) → HTMLElement
  // seat: { position, playerId, isAI, nickname, avatar, chips, status, isDealer, isSmallBlind, isBigBlind, holeCards, currentBet, totalBet }
  // options: { isMe?, isCurrentTurn?, showCards? }
  // 返回座位 DOM 元素
  
  // 状态样式：
  // empty: 灰色边框，显示"空位"
  // occupied/ready: 显示头像、昵称、筹码
  // playing: 正常，可能显示底牌（如果是 isMe 或 showCards）
  // folded: 灰色遮罩，半透明
  // allin: 红色边框，"All-in" 标签
  // left: 灰色，"已离开"
  
  // 标记显示：
  // Dealer: D 圆形标记
  // Small Blind: SB 标记
  // Big Blind: BB 标记
  // Current Turn: 高亮边框 + 闪烁动画
  // Winner: 金色皇冠
  
  // 更新座位状态（不重新渲染整个座位）
  update(seat, options) → void
};
```

**视觉要求**:
- 座位为圆形或椭圆形区域
- 头像：圆形，纯色背景 + 首字母
- 昵称：头像下方
- 筹码：昵称下方小字
- 当前下注：座位前方显示筹码（用 ChipsComponent）
- 底牌：座位前方显示（2 张 CardComponent，如果是自己则正面，否则背面）
- 状态变化时动画过渡

**验收标准**:
- [ ] 空位显示"空位"和入座按钮
- [ ] 有人座位显示头像、昵称、筹码
- [ ] 当前行动玩家高亮闪烁
- [ ] 弃牌玩家半透明遮罩
- [ ] All-in 玩家红色标签
- [ ] 庄家/盲注标记正确显示
- [ ] 自己的底牌正面显示，其他人背面
- [ ] 结算时所有人底牌可见
- [ ] 在浏览器中视觉正常
- [ ] 至少 5 个场景测试

---

### T25: 前端倒计时组件
**优先级**: P1 | **依赖**: T16 | **可并行**: T19-T24, T26-T27

**任务描述**:
实现 `frontend/js/components/timer.js`，渲染玩家行动倒计时。

**输入文件**:
- 无

**输出文件**:
- `frontend/js/components/timer.js`

**接口契约**:
```javascript
const TimerComponent = {
  // 渲染倒计时
  render(durationMs, warningMs?) → HTMLElement
  // durationMs: 总时长（30000）
  // warningMs: 警告阈值（10000）
  
  // 开始倒计时
  start(endTime) → void
  // endTime: 截止时间戳
  
  // 停止倒计时
  stop() → void
  
  // 更新显示（内部 setInterval）
  // 正常：绿色/蓝色
  // 警告（<10秒）：红色，闪烁
  // 结束：自动停止
};
```

**视觉要求**:
- 圆形进度条或数字倒计时
- 放在当前行动玩家座位旁边
- 最后 10 秒变红并闪烁

**验收标准**:
- [ ] 倒计时正确显示剩余秒数
- [ ] 最后 10 秒变红闪烁
- [ ] 结束自动停止
- [ ] 可被 start/stop 控制
- [ ] 在浏览器中视觉正常

---

### T26: 前端牌桌视图
**优先级**: P0 | **依赖**: T16, T21-T25 | **可并行**: T27

**任务描述**:
实现 `frontend/js/views/table.js`，整合所有组件渲染牌桌游戏界面。

**输入文件**:
- `frontend/js/components/card.js`
- `frontend/js/components/chips.js`
- `frontend/js/components/pot.js`
- `frontend/js/components/seat.js`
- `frontend/js/components/actions.js`
- `frontend/js/components/timer.js`
- `frontend/js/socket-client.js`

**输出文件**:
- `frontend/js/views/table.js`
- `frontend/css/table.css`（最终样式完善）

**界面布局**:
```
┌─────────────────────────────────────────┐
│  房间: Texas Room  #  盲注: 10/20  [离开]│
├─────────────────────────────────────────┤
│                                         │
│    [座位6]        [座位5]        [座位4]│
│      Bot-A        玩家B           空位   │
│                                         │
│              ┌─────────┐               │
│   [座位7]    │ 公共牌  │    [座位3]    │
│    玩家C     │ ♠A ♥K ♦Q │    空位     │
│              │  ♣J ♥10  │               │
│              │         │               │
│   [座位8]    │  底池:  │    [座位2]    │
│    空位      │  $500   │    玩家D(我)  │
│              └─────────┘               │
│                                         │
│    [座位9]         [庄家]       [座位1] │
│    空位          (D标记)        玩家E   │
│                               [SB标记]  │
│                                         │
├─────────────────────────────────────────┤
│  我的底牌: ♠K ♥K    筹码: $950          │
│                                         │
│  [Fold]  [Check]  [Call $20]  [Raise ▼] │
│                              [$40/$80/$120]
└─────────────────────────────────────────┘
```

**功能**:
- 渲染 9 个座位（环形布局，中央是公共牌和底池）
- 渲染公共牌区（0-5 张 CardComponent）
- 渲染底池（PotComponent）
- 渲染自己的信息（底牌、筹码）
- 渲染操作按钮（ActionsComponent，仅当前回合显示）
- 监听所有游戏事件并更新界面：
  - `game:started`：初始化牌桌，显示座位
  - `game:dealt`：显示自己的底牌
  - `game:community`：显示公共牌（动画发牌）
  - `game:turn`：高亮当前玩家，显示倒计时
  - `game:action`：更新座位下注和状态
  - `game:pot`：更新底池显示
  - `game:showdown`：显示所有底牌和牌型
  - `game:ended`：显示赢家和筹码变动，显示"再来一局"按钮
- 支持离开房间（返回大厅）

**验收标准**:
- [ ] 牌桌布局正确，9 个座位环绕中央
- [ ] 游戏开始时正确显示所有座位和玩家
- [ ] 发底牌动画（仅自己可见）
- [ ] 公共牌逐张显示（flop 3 张同时，turn/river 单张）
- [ ] 当前行动玩家高亮 + 倒计时
- [ ] 操作按钮在自己的回合正确显示
- [ ] 下注动作更新座位前方筹码
- [ ] 底池实时更新
- [ ] 弃牌玩家半透明
- [ ] All-in 玩家红色标记
- [ ] 摊牌时显示所有底牌和牌型名称
- [ ] 结算时显示赢家和筹码分配
- [ ] 在浏览器中整体视觉正常，无明显错位
- [ ] 至少 10 个场景测试

---

### T27: 前端入口与路由整合
**优先级**: P0 | **依赖**: T17-T20, T26 | **可并行**: T28-T29

**任务描述**:
实现 `frontend/js/app.js`，整合所有模块，实现 SPA 路由和视图切换。

**输入文件**:
- `frontend/js/api.js`
- `frontend/js/socket-client.js`
- `frontend/js/views/lobby.js`
- `frontend/js/views/room.js`
- `frontend/js/views/table.js`

**输出文件**:
- `frontend/js/app.js`

**接口契约**:
```javascript
const App = {
  // 初始化
  init() → void
  // 1. 连接 Socket.IO
  // 2. 创建/获取游客身份
  // 3. 设置路由监听（hashchange）
  // 4. 切换到默认视图（lobby）
  
  // 路由切换
  navigate(view, params?) → void
  // view: 'lobby' | 'room' | 'table'
  // params: { roomId? }
  // 切换 hash 并显示对应视图
  
  // 视图管理
  showLobby() → void
  showRoom(roomId) → void
  showTable(roomId) → void
  
  // 全局状态
  player: null,     // 当前玩家信息
  currentRoom: null, // 当前房间 ID
  currentView: null, // 当前视图名
  
  // 错误处理
  showError(message) → void
  showMessage(message) → void
};

// 启动
document.addEventListener('DOMContentLoaded', () => App.init());
```

**路由规则**:
- `#/` → 大厅（lobby）
- `#/room/:id` → 房间等待页（room）
- `#/table/:id` → 牌桌游戏页（table）
- 非法路由 → 重定向到 #/

**视图切换逻辑**:
- lobby → room：加入房间后切换
- room → table：游戏开始后切换
- table → room：单局结束后选择"再来一局"或房主结束
- 任何 → lobby：点击离开/退出

**验收标准**:
- [ ] 页面加载后自动进入大厅
- [ ] URL hash 变化正确切换视图
- [ ] 加入房间后切换到 room-view
- [ ] 游戏开始后切换到 table-view
- [ ] 离开房间返回 lobby-view
- [ ] 游客身份自动创建并显示
- [ ] 全局错误显示（toast 或 alert）
- [ ] 刷新页面后恢复状态（通过重新连接 Socket 和请求状态）
- [ ] 在浏览器中完整流程可运行

---

### T28: HandEvaluator 单元测试
**优先级**: P1 | **依赖**: T5 | **可并行**: T6, T27, T29

**任务描述**:
编写 `backend/domain/hand-evaluator.test.js`（或内联测试），覆盖所有牌型和边界情况。

**输入文件**:
- `backend/domain/card.js`
- `backend/domain/hand-evaluator.js`

**输出文件**:
- `backend/domain/hand-evaluator.test.js`

**测试用例要求**:
| 编号 | 描述 | 输入（7张牌） | 期望结果 |
|------|------|--------------|----------|
| 1 | 皇家同花顺 | ♠10 ♠J ♠Q ♠K ♠A + 任意2张 | rank=1, name='Royal Flush' |
| 2 | 同花顺 | ♥5 ♥6 ♥7 ♥8 ♥9 + 任意2张 | rank=2 |
| 3 | 四条 | A♠ A♥ A♦ A♣ K♠ + 任意2张 | rank=3 |
| 4 | 葫芦 | Q♠ Q♥ Q♦ 8♣ 8♥ + 任意2张 | rank=4 |
| 5 | 同花 | ♦2 ♦5 ♦7 ♦J ♦K + 任意2张 | rank=5 |
| 6 | 顺子 | 5♠ 6♥ 7♦ 8♣ 9♠ + 任意2张 | rank=6 |
| 7 | 三条 | 7♠ 7♥ 7♦ K♣ 2♠ + 任意2张 | rank=7 |
| 8 | 两对 | J♠ J♥ 5♦ 5♣ A♠ + 任意2张 | rank=8 |
| 9 | 一对 | 10♠ 10♥ K♦ 7♣ 3♠ + 任意2张 | rank=9 |
| 10 | 高牌 | A♠ K♦ 10♥ 7♣ 2♠ + 任意2张 | rank=10 |
| 11 | 7选5最优 | 底牌 ♠A ♥A，公共 ♠K ♥K ♦Q ♣J ♥10 | 选两对 AAKK |
| 12 | 平局 | 同牌型同踢脚 | compare=0 |
| 13 | 踢脚决胜 | 一对 A♠A♥K♦Q♣J♠  vs 一对 A♠A♥Q♦J♣10♠ | 前者赢 |
| 14 | 同花顺 vs 四条 | 同花顺 vs 四条 | 同花顺赢 |
| 15 | 边缘顺子 | A♠ 2♥ 3♦ 4♣ 5♠ | 顺子（A 作 1）|
| 16 | 边缘顺子2 | 10♠ J♥ Q♦ K♣ A♠ | 顺子（A 作 14）|
| 17 | 性能测试 | 随机 1000 次评估 | < 100ms |

**验收标准**:
- [ ] 所有 17+ 个测试用例通过
- [ ] 测试文件可独立运行（`node hand-evaluator.test.js`）
- [ ] 失败时输出清晰的错误信息（预期 vs 实际）
- [ ] 覆盖所有 10 种牌型

---

### T29: PotManager 单元测试
**优先级**: P1 | **依赖**: T6 | **可并行**: T5, T27-T28

**任务描述**:
编写 `backend/domain/pot-manager.test.js`（或内联测试），覆盖各种底池和边池场景。

**输入文件**:
- `backend/domain/pot-manager.js`

**输出文件**:
- `backend/domain/pot-manager.test.js`

**测试用例要求**:
| 编号 | 描述 | 场景 | 期望结果 |
|------|------|------|----------|
| 1 | 简单底池 | 3人各下注100 | 主池=300 |
| 2 | 1人All-in | A:50, B:100, C:100 | 主池=150, 边池=200 |
| 3 | 2人All-in | A:50, B:100, C:200 | 主池=150, 边池1=150, 边池2=300 |
| 4 | 多人All-in | 4人分别 50/100/200/200 | 主池=200, 边池1=300, 边池2=400 |
| 5 | 有人Fold | A:50(fold), B:100, C:100 | 主池=200（A不参与） |
| 6 | 平局分配 | 2人平分100 | 各得50 |
| 7 | 奇数分配 | 3人平分100 | 33/33/34 或合理分配 |
| 8 | 多层边池赢家 | A赢主池，B赢边池1 | A得主池，B得边池1 |
| 9 | 筹码不足 | 某玩家只有30，需跟注100 | 自动All-in 30 |
| 10 | 边池资格 | 只投入50的玩家只能争主池 | 正确 eligiblePositions |

**验收标准**:
- [ ] 所有 10+ 个测试用例通过
- [ ] 测试文件可独立运行
- [ ] 失败时输出清晰的错误信息
- [ ] 覆盖多层边池和 All-in 场景

---

### T30: 游戏引擎集成测试与最终整合
**优先级**: P0 | **依赖**: T10c, T14, T15, T27 | **可并行**: 无（最终任务）

**任务描述**:
编写完整牌局流程测试，确保所有后端模块协同工作，修复任何集成问题。

**输入文件**:
- 所有后端模块
- 前端基础文件

**输出文件**:
- `backend/test/integration.test.js`（或 inline 测试）
- `server.js`（最终整合，确保所有路由和 Socket 事件正确挂载）
- `README.md`（项目说明和运行指南）

**测试场景**:
1. **完整牌局**：2 人（1 真人 + 1 AI）
   - 创建房间 → 入座 → 准备 → 开始
   - Pre-flop：AI 自动行动，玩家 Call
   - Flop：AI Check，玩家 Bet，AI Call
   - Turn：AI Check，玩家 Check
   - River：AI Bet，玩家 Call
   - Showdown：比较牌型，分配底池
   - 验证筹码变动正确

2. **All-in 场景**：3 人，其中 1 人 All-in
   - 验证边池产生和分配

3. **断线场景**：玩家行动中断开，超时 Fold

4. **前端联调**：浏览器访问，完整流程可玩

**验收标准**:
- [ ] 完整牌局流程在 Node.js 测试中通过
- [ ] 所有模块正确导入 server.js
- [ ] `npm start` 启动后，浏览器可访问并玩一局完整游戏
- [ ] AI 自动填充并自动行动
- [ ] 底池计算正确
- [ ] 牌型判断正确
- [ ] 状态流转正确（无死锁、无跳过）
- [ ] 错误处理完善（不崩溃）
- [ ] README.md 包含运行说明

---

## 任务并行建议

### 第一波（无依赖，可全部并行）
T1, T2, T3, T4, T5, T6, T7, T16

### 第二波（依赖第一波）
T8, T9, T10a, T10b, T10c, T11, T17, T18, T19, T20, T21, T22, T23, T24, T25

### 第三波（依赖第二波）
T12, T13, T14, T15, T26, T27, T28, T29

### 第四波（最终整合）
T30

### 推荐并行分组（4组 Agent 同时工作）

| 组 | 负责模块 | 任务 |
|---|--------|------|
| **A 后端领域** | 游戏核心逻辑 | T3, T4, T5, T6, T28, T29 |
| **B 后端服务** | 服务层 + API | T7, T8, T9, T10a, T10b, T10c, T11, T12, T13, T14, T15 |
| **C 前端基础** | UI 组件 + 通信 | T16, T17, T18, T21, T22, T23, T24, T25 |
| **D 前端视图** | 页面整合 + 联调 | T19, T20, T26, T27, T30 |

**注意**：T1（基础设施）和 T2（常量）应由第一个开始的 Agent 完成，其他 Agent 等待或假设存在。

---

*文档结束*
