# AGENTS.md — 多人联机德州扑克（texas-poker）

> 本文件面向 AI 编码代理，汇总项目架构、命令与约定。文档与产品文档主要使用中文，源码注释主要使用英文，提交代码时请保持这一惯例。

## 1. 项目概览

一款基于浏览器的多人联机德州扑克游戏，已从 MVP 升级为完整产品架构（P1–P5 全部落地）：Vue 3 新前端、后端 TypeScript 化、JWT 认证、PostgreSQL/Redis 持久化、多实例部署。打开网页即可开局，支持创建/加入房间、AI 机器人补位、完整德州扑克规则与实时 WebSocket 对战。

核心特征：

- **服务端权威（Server-Authoritative）**：所有游戏逻辑（发牌、下注、底池计算、摊牌比大小）都在服务端执行，客户端仅做展示与发送动作请求，防止作弊。
- **AI 陪玩**：接入 OpenAI-compatible 大模型（DeepSeek / Moonshot / 通义千问 / Groq 等）；未配置有效 `AI_API_KEY` 或 LLM 调用失败时，自动降级为规则型 AI（`ai-rule-engine.ts`）。
- **纯虚拟筹码**：不涉及真实货币与提现。

## 2. 技术栈

| 层级 | 技术 |
|------|------|
| 后端运行时 | Node.js >= 22，TypeScript（strict）；开发/测试用 tsx 直跑，生产 `tsc` 构建到 `dist/` |
| Web 框架 | Express 4.x |
| 实时通信 | Socket.IO 4.x；多实例时接 `@socket.io/redis-adapter` |
| 认证 | JWT（jsonwebtoken）+ bcryptjs；游客与注册用户统一签发 token |
| 安全中间件 | helmet、cors、express-rate-limit、morgan |
| 前端（新） | Vue 3 + TypeScript + Vite + Pinia + Vue Router + Vant + GSAP（`frontend-app/`） |
| 前端（旧） | 原生 HTML5 + CSS3 + ES6（`frontend/`，回退用，验收后可归档） |
| 存储 | 三实现同一 Storage 契约：内存 Map（默认）/ PostgreSQL（`pg`，用户+牌局历史）/ Redis（`ioredis`，运行时状态），由 `STORE_BACKEND` 切换 |
| 配置 | dotenv + `.env` 环境变量 |
| 测试 | 后端 `node:test` + `node:assert`（tsx 加载）；前端 Vitest + @vue/test-utils |
| 部署 | Docker Compose（nginx + app×2 + postgres + redis）/ PM2（遗留单实例）/ GitHub Actions CI |

刻意**不引入**的依赖：ORM、React、其他 Web 框架。不要擅自引入。

## 3. 构建与运行命令

```bash
npm install            # 后端依赖
cp .env.example .env   # 首次运行前复制环境变量并按需编辑
npm start              # 后端开发模式（tsx 直跑 server.ts，监听 :3000）

npm --prefix frontend-app install   # 前端依赖（首次）
npm run dev:app        # Vue 前端开发服务（Vite，代理 /api 与 /socket.io 到 3000）

npm run build          # 后端 tsc → dist/
npm run build:app      # 前端 vite → frontend-app/dist/
npm run start:prod     # node dist/server.js（需先 build）
```

生产托管 Vue 前端：设置 `FRONTEND_DIR=frontend-app/dist`（Docker 镜像已内置）；默认托管旧版 `frontend/`。

## 4. 测试说明

- 测试与源码**同目录并列**：后端 `backend/**/*.test.ts`（`node:test` + `node:assert`，tsx 加载）；前端 `frontend-app/src/**/*.test.ts`（Vitest）。旧前端遗留 `frontend/js/**/*.test.js` 仍在 `npm test` 中运行。
- 修改任何领域逻辑、服务逻辑或前端可测模块时，必须同步维护对应测试。
- 存储契约测试（`backend/storage/storage-contract.test.ts`）与真实 Redis 用例在本地无 `DATABASE_URL`/`REDIS_URL` 时自动跳过；CI 用 GitHub Actions services 拉起 pg/redis 全量运行。
- 写透持久化回归：`backend/storage/redis-room-flow.test.ts` 用 JSON 往返式假 Redis 验证 room-manager/game-engine 的每个变更路径都显式写回存储。

命令：

```bash
npm test                       # 后端全量（node --import tsx --test）
npm run test:hand              # 仅牌型评估测试
npm run test:pot               # 仅底池计算测试
node --import tsx --test <文件> # 运行单个后端测试文件
npm run test:app               # 前端 Vitest 全量
```

当前基线：后端 276 个测试（本地 3 个 skip 为 pg/redis 契约用例），前端 142 个测试，全部通过；`npx tsc --noEmit` 零错误。

## 5. 目录结构与模块划分

```
server.ts                       # 入口：Express + Socket.IO、redis-adapter/scheduler 接线、优雅关闭
backend/
├── config/
│   ├── constants.ts            # 全部游戏常量与环境变量（冻结对象）
│   └── security.ts             # helmet/CSP 等安全配置
├── domain/                     # 领域层：纯函数、无状态、可独立测试
│   ├── card.ts                 # Card 实体（suit/rank，A=14）
│   ├── deck.ts                 # Deck（52 张，Fisher-Yates 洗牌）
│   ├── hand-evaluator.ts       # 牌型评估（7 选 5 最优，rank 1-10 越小越强）
│   └── pot-manager.ts          # 底池计算（主池 + 多层边池、分配）
├── storage/                    # 存储层（接口全 async，三实现同一契约）
│   ├── index.ts                # 存储工厂：按 STORE_BACKEND 装配
│   ├── memory-store.ts         # 内存 Map 实现（默认）+ Storage 接口定义
│   ├── postgres-store.ts       # 用户 CRUD + 牌局历史（手写 SQL）
│   ├── redis-store.ts          # players/rooms/games JSON 读写 + TTL + 键规范
│   ├── pg-client.ts            # pg 连接池与迁移执行
│   ├── game-serializer.ts      # 牌局实体序列化/复活（Deck/PotManager 类实例）
│   └── migrations/             # SQL 迁移脚本
├── services/                   # 服务层：有状态，管理生命周期（单例导出）
│   ├── auth-service.ts         # JWT 签发/验证（guest 与 user token）
│   ├── player-manager.ts       # 玩家/游客管理
│   ├── room-manager.ts         # 房间生命周期（每个变更路径写透存储）
│   ├── game-engine.ts          # 游戏状态机（preflop→flop→turn→river→showdown）
│   ├── action-queue.ts         # 每房间动作串行队列
│   ├── ai-manager.ts           # AI 机器人生命周期与决策路由（LLM 优先，规则兜底）
│   ├── ai-llm-service.ts       # 大模型调用（OpenAI-compatible chat/completions）
│   └── ai-rule-engine.ts       # 规则型 AI（独立文件，避免循环依赖）
├── routes/                     # REST API
│   ├── auth.ts                 # /api/auth/*（guest/register/login，均签发 JWT）
│   ├── auth-required.ts        # 认证中间件（Bearer token，兼容 x-player-id）
│   └── rooms.ts                # /api/rooms/*（列表/创建/详情/加入）
└── socket/
    ├── handlers.ts             # Socket.IO 初始化、握手认证、连接/断线管理
    ├── events.ts               # 房间与游戏事件处理
    └── scheduler-owner.ts      # 多实例房间级调度归属（Redis 锁仲裁）
frontend-app/                   # Vue 3 新前端
├── src/views/                  # LobbyView / RoomView / TableView
├── src/components/             # lobby / room / table 组件（单文件 ≤300 行）
├── src/stores/                 # Pinia：player / lobby / room / game
├── src/services/               # api.ts / socket.ts（自动重连 + game:request_state）
├── src/animations/             # GSAP：deal/chips/turn/showdown/allin，三档降级
├── src/types/                  # 与后端事件/负载对齐的类型
└── src/utils/                  # seat-layout / card-asset 等纯函数
frontend/                       # 旧版原生前端（回退用）
deploy/nginx.conf               # 粘性反代（ip_hash + WebSocket 升级）
.github/workflows/ci.yml        # CI：tsc + 后端测试（pg/redis services）+ Vitest + 构建
```

### 分层依赖规则（必须遵守）

1. `domain/` 不依赖任何其他层（纯函数，唯一例外是 `config/constants`）。
2. `storage/` 只依赖 `domain/`（game-serializer 复活类实例）与 `config/`。
3. `services/` 依赖 `domain/` + `storage/`，服务之间不得循环依赖。
4. `routes/` 与 `socket/` 依赖 `services/` + `storage/`。
5. `frontend-app/` 与 `frontend/` 完全独立，只通过 HTTP/WebSocket 与服务端通信。

## 6. 代码风格约定

- 后端 TypeScript 保持 **CommonJS 语义**（`require` / `module.exports`，tsconfig `module: commonjs`）；服务层单例以 `module.exports = new Xxx()` 导出，同时 `export type` 提供类型。
- 每个源文件以 JSDoc 风格块注释开头，注明文件路径与职责，例如 `/** backend/domain/card.ts - Card Entity ... */`。
- 源码注释用英文；产品/架构文档（README.md、ARCHITECTURE.md 等）用中文；新增文档请跟随所在文档的语言。
- 所有可调参数集中在 `backend/config/constants.ts`（冻结对象），不要在业务代码中散落魔法数字；环境变量也在此处统一读取。
- 前端组件用 Vue 3 `<script setup lang="ts">`；状态放 Pinia store；与后端交互只经 `src/services/`；类型对照 `backend/socket/events.ts` 维护在 `src/types/`。
- 存储层所有方法返回 Promise；**写透纪律**：内存 store 返回 live 对象，redis store 返回 JSON 副本——任何对 room/player/game 的变更后必须显式调用 `updateRoom/updatePlayer/updateGame` 写回，循环内多次变更需每轮重读最新快照。

## 7. 安全注意事项

- **`.env` 严禁提交**（已在 `.gitignore` 中）；密钥只通过环境变量注入，示例值放在 `.env.example`。
- `JWT_SECRET` 生产必须显式设置强密钥；密码用 bcryptjs 哈希，登录防 timing attack。
- REST API 统一挂在 `/api/` 下并受 express-rate-limit 限流保护（默认 15 分钟 100 次）。
- helmet 的 CSP 等选项集中在 `backend/config/security.ts`，修改安全头时改这里而不是 `server.ts`。
- CORS 白名单由 `CORS_ORIGINS`（逗号分隔）控制；生产环境必须显式配置，留空等同于放开（仅限开发）。
- 服务端权威原则不可破坏：客户端只能发送动作请求（`game:action` 等），任何游戏状态计算结果都不允许信任客户端上报。
- 底牌只发给对应玩家的 socket；摊牌或全员 all-in 前，其他玩家收到的底牌必须为 null。AI 决策上下文同样不泄露其他玩家底牌。
- 30 秒行动超时自动弃牌；断线保留窗口 60 秒（`DISCONNECT_TIMEOUT_MS`）。

## 8. 关键运行时行为

- **AI 决策链路**：`game-engine` → `ai-manager` → `ai-llm-service`（LLM）→ 失败时 `ai-rule-engine`（规则降级，受 `AI_FALLBACK_ENABLED` 控制）。LLM 返回非法 JSON/非法动作最多重试 2 次，仍失败则自动弃牌以免卡住牌局。每次 LLM 原始返回都会完整打印到日志（`[AI-LLM] Raw response ...`）。
- **断线重连**：前端 Socket.IO 自动重连（最多 5 次）；重连后以原 `playerId` 重新绑定新 `socketId`，客户端发 `game:request_state` 拉取完整状态。
- **存储语义**：`memory`（默认）进程重启即丢运行时状态；`redis` 后端运行时状态在 Redis 中，进程重启可恢复；`postgres` 负责用户与牌局历史（结算写历史失败只记日志不炸牌局）。
- **多实例模式**：设置 `REDIS_URL` 即启用——Socket.IO redis-adapter 跨实例广播 + 房间级 scheduler owner（Redis 锁 `poker:lock:room:{roomId}`，30s TTL）仲裁回合计时器与 AI 调度；强制 `STORE_BACKEND=redis`，Redis 不可达启动 fail-fast。已知边界：AI 回合活性依赖调度点接管；跨实例动作互斥未覆盖（依赖 nginx ip_hash 粘性会话）。
- **优雅关闭**：`SIGTERM`/`SIGINT` 时先关 Socket.IO 再关 HTTP server。

## 9. 环境变量

全部配置见 `.env.example` 与 `backend/config/constants.ts`。关键项：

| 变量 | 默认 | 说明 |
|------|------|------|
| `NODE_ENV` / `PORT` / `HOST` | development / 3000 / 0.0.0.0 | 运行环境与监听地址 |
| `FRONTEND_DIR` | frontend | 静态前端目录；生产设为 `frontend-app/dist` |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | 空（dev 内置不安全回退）/ 7d | JWT 签名密钥与有效期；生产必须显式设置 |
| `AI_PROVIDER` / `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | openai-compatible / OpenAI / 空 / gpt-4o-mini | LLM 接入；无有效 key 时自动用规则 AI |
| `AI_TIMEOUT_MS` / `AI_TEMPERATURE` / `AI_MAX_TOKENS` / `AI_FALLBACK_ENABLED` | 10000 / 0.4 / 4096（请求侧下限）/ true | AI 行为调参 |
| `CORS_ORIGINS` | 空（放开，仅开发） | 逗号分隔白名单 |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | 900000 / 100 | REST API 限流 |
| `STORE_BACKEND` / `DATABASE_URL` / `REDIS_URL` | memory / 空 / 空 | 存储后端：memory（默认）/ postgres（需 DATABASE_URL）/ redis（需 REDIS_URL）；设置 REDIS_URL 即多实例模式，必须 STORE_BACKEND=redis，否则启动 fail-fast |

## 10. 部署

- **本地直跑**：`npm ci && npm run build && npm run start:prod`（或开发模式 `npm start`）。
- **Docker Compose（推荐，多实例）**：`docker compose up -d --build` 起 nginx（ip_hash 粘性）+ app×2 + postgres + redis；扩容 `--scale app=N` 后需 `docker compose restart nginx`。
- **PM2**：`ecosystem.config.js` 为遗留单实例方案（fork 模式，入口 `dist/server.js`，需先 build）。
- **CI**：`.github/workflows/ci.yml` 在 push/PR 时跑 tsc、后端测试（pg/redis services）、前端 Vitest、双端构建。
- 健康检查端点：`GET /health` → `{ status: 'ok', timestamp }`。
- 更详细的部署步骤见 `DEPLOY.md`。

## 11. 参考文档

- `README.md` — 项目说明、接口概览（REST 与 WebSocket 事件表）、AI 决策协议、多实例边界、游戏规则摘要。
- `ARCHITECTURE.md` — 系统架构、状态机、接口契约、数据模型、关键算法（牌型评估、边池计算）。
- `PRD.md` — 产品需求文档。
- `TASKS.md` — 开发任务列表。
- `DEPLOY.md` — 线上部署指南（多实例拓扑、环境变量总表、扩容步骤）。

以上文档使用中文维护；修改架构或接口契约时，请同步更新对应文档。
