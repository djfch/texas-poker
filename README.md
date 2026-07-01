# Texas Hold'em Poker

一款基于浏览器的多人联机德州扑克游戏。打开网页即可快速开局，支持创建/加入房间、AI 机器人补位、完整德州扑克规则与实时 WebSocket 对战。

---

## 特性

- **即开即玩**：无需安装客户端，浏览器访问即可游戏；支持游客模式。
- **实时联机**：基于 Socket.IO 实现低延迟双向通信，支持断线重连。
- **房间系统**：创建公开/私密房间，配置人数、盲注、初始筹码与是否允许 AI。
- **AI 陪玩**：接入 OpenAI-compatible 大模型（DeepSeek / Moonshot / 通义千问 / Groq 等），未配置 key 时自动降级为规则型 AI。
- **配置驱动**：AI key、模型、base URL、CORS、限流等全部通过 `.env` 配置。
- **生产就绪**：内置 helmet、cors、限流、健康检查、优雅关闭、Docker / PM2 部署配置。
- **标准规则**：完整四轮下注（Pre-flop / Flop / Turn / River）、摊牌比大小、主池与边池计算。
- **服务端权威**：所有游戏逻辑在服务端执行，客户端仅做展示，防止作弊。
- **模块化架构**：领域层、服务层、存储层、路由与 Socket 事件分层清晰，便于扩展。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端运行时 | Node.js 18+ |
| Web 框架 | Express 4.x |
| 实时通信 | Socket.IO 4.x |
| 前端 | 原生 HTML5 + CSS3 + ES6（零构建依赖） |
| 存储 | 内存 Map（MVP 阶段，可替换为 Redis/PostgreSQL） |
| 配置 | `.env` 环境变量 |
| 部署 | Docker / docker-compose / PM2 |
| 测试 | Node.js 内置 test runner |

---

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- npm

### 安装与启动

```bash
# 克隆项目后进入目录
npm install

# 复制环境变量示例并编辑
cp .env.example .env
# 编辑 .env，填写 AI_API_KEY 等配置

# 启动服务
npm start
```

服务默认监听 `http://localhost:3000`，用浏览器打开该地址即可进入游戏大厅。

### 运行测试

```bash
# 运行所有测试
npm test

# 单独运行牌型评估或底池测试
npm run test:hand
npm run test:pot
```

---

## 项目结构

```
texas-poker/
├── server.js                    # 入口：Express + Socket.IO 启动
├── package.json
├── README.md                    # 本文件
├── DEPLOY.md                    # 线上部署指南
├── .env.example                 # 环境变量示例
├── Dockerfile                   # Docker 镜像
├── docker-compose.yml           # Docker Compose 配置
├── ecosystem.config.js          # PM2 配置
├── ARCHITECTURE.md              # 系统架构文档
├── PRD.md                       # 产品需求文档
├── TASKS.md                     # 开发任务列表
│
├── backend/
│   ├── config/constants.js      # 游戏常量（盲注、超时、AI 名称等）
│   ├── domain/                  # 领域逻辑层（纯函数、可独立测试）
│   ├── storage/                 # 数据存储实现
│   │   └── memory-store.js      # 内存 Map 存储（MVP 阶段）
│   ├── services/                # 服务层（有状态、管理生命周期）
│   │   ├── player-manager.js    # 玩家/游客管理
│   │   ├── room-manager.js      # 房间生命周期
│   │   ├── game-engine.js       # 游戏状态机与核心逻辑
│   │   ├── ai-manager.js        # AI 机器人创建与决策（LLM + 规则降级）
│   │   └── ai-llm-service.js    # 大模型 AI 调用服务
│   ├── routes/                  # REST API
│   │   ├── auth.js              # /api/auth/*
│   │   └── rooms.js             # /api/rooms/*
│   └── socket/                  # WebSocket 事件处理
│       ├── handlers.js          # Socket.IO 初始化与连接管理
│       └── events.js            # 房间与游戏事件处理
│
└── frontend/                    # 前端单页应用
    ├── index.html
    ├── css/
    │   ├── base.css             # 基础样式与变量
    │   ├── lobby.css            # 大厅样式
    │   ├── room.css             # 房间样式
    │   └── table.css            # 牌桌样式
    └── js/
        ├── app.js               # 入口、路由、初始化
        ├── api.js               # HTTP API 封装
        ├── socket-client.js     # Socket.IO 客户端
        ├── views/               # 页面视图
        │   ├── lobby.js
        │   ├── room.js
        │   └── table.js
        └── components/          # UI 组件
            ├── card.js
            ├── seat.js
            ├── chips.js
            ├── pot.js
            ├── timer.js
            └── actions.js
```

---

## 接口概览

### REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/guest` | 创建游客 |
| POST | `/api/auth/register` | 注册（MVP 后完善） |
| POST | `/api/auth/login` | 登录（MVP 后完善） |
| GET  | `/api/rooms` | 公开房间列表 |
| POST | `/api/rooms` | 创建房间 |
| GET  | `/api/rooms/:id` | 房间详情 |
| POST | `/api/rooms/:id/join` | 加入房间 |

### WebSocket 事件（客户端 → 服务端）

| 事件 | 说明 |
|------|------|
| `room:join` | 加入房间 |
| `room:leave` | 离开房间 |
| `room:ready` | 准备/取消准备 |
| `room:start` | 房主开始游戏 |
| `seat:sit` | 入座 |
| `seat:stand` | 离座 |
| `game:action` | 执行游戏动作（Fold/Check/Call/Bet/Raise/All-in） |
| `chat:message` | 发送聊天消息 |

### WebSocket 事件（服务端 → 客户端）

| 事件 | 说明 |
|------|------|
| `room:state` | 房间状态更新 |
| `player:joined` / `player:left` / `player:ready` | 玩家状态变化 |
| `game:started` | 游戏开始 |
| `game:dealt` | 发放底牌（仅本人可见） |
| `game:community` | 发放公共牌 |
| `game:turn` | 轮到某位玩家行动 |
| `game:action` | 玩家动作通知 |
| `game:pot` | 底池更新 |
| `game:showdown` | 摊牌结果 |
| `game:ended` | 牌局结束与结算 |
| `chat:message` | 聊天消息 |
| `error` | 错误通知 |

---

## 游戏规则摘要

1. **座位**：每桌 2–9 人，支持 AI 补位。
2. **盲注**：庄家（Dealer）左侧第一位下小盲注，第二位下大盲注。
3. **发牌**：每位玩家获得 2 张底牌，桌面发出 5 张公共牌。
4. **下注轮**：Pre-flop → Flop → Turn → River。
5. **行动**：Fold（弃牌）/ Check（过牌）/ Call（跟注）/ Bet（下注）/ Raise（加注）/ All-in（全押）。
6. **比牌**：从 7 张牌中选最优 5 张，按牌型大小决定胜负。
7. **底池**：支持主池与多层边池，All-in 玩家只能赢得自己参与的主池/边池。

牌型从大到小：皇家同花顺 > 同花顺 > 四条 > 葫芦 > 同花 > 顺子 > 三条 > 两对 > 一对 > 高牌。

---

## 开发与测试

```bash
# 开发模式启动
node server.js

# 运行核心逻辑测试
npm test
```

核心领域逻辑（`backend/domain/`）已覆盖：Card、Deck、牌型评估与底池计算。

---

## 当前阶段

本项目处于 **MVP 阶段**，已实现：

- 游客模式与基础玩家管理
- 房间创建、加入、入座、准备、开始
- 完整德州扑克游戏流程
- AI 机器人补位与决策
- 实时 WebSocket 状态同步

后续计划：注册用户/登录、历史记录、聊天、排行榜、移动端适配、锦标赛模式等。

---

## 许可证

MIT
