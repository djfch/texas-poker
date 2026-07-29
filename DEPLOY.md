# 部署指南

多人联机德州扑克的部署文档。涵盖多实例生产拓扑、环境变量总表，以及
本地直接运行 / PM2 / Docker Compose 三种部署方式。

> 多实例能力（P5a）：配置 `REDIS_URL` 后，服务自动启用 Socket.IO
> redis-adapter（跨实例广播）与房间级 scheduler owner（回合计时器、AI
> 决策的集群仲裁），并强制要求 `STORE_BACKEND=redis`，否则启动即报错，
> 绝不静默退化为脑裂的单实例。

## 1. 多实例拓扑（Docker Compose）

```mermaid
flowchart LR
    Client[浏览器客户端] --> N[nginx :80<br/>ip_hash 粘性会话]
    N --> A1[app 实例 1<br/>node dist/server.js]
    N --> A2[app 实例 2<br/>node dist/server.js]
    A1 --> PG[(postgres:16<br/>用户 / 牌局历史)]
    A2 --> PG
    A1 --> R[(redis:7<br/>运行时状态 + pub/sub)]
    A2 --> R
```

- `nginx`：`deploy/nginx.conf`，对 `/socket.io` 开启 Upgrade 头转发，
  `ip_hash` 保证同一客户端的轮询握手与 WebSocket 升级落在同一实例。
- `app`：同一镜像跑 2 副本（`deploy.replicas: 2`），只暴露内部 3000 端口。
- `postgres` / `redis`：数据卷持久化 + 健康检查，`app` 依赖其健康后启动。

## 2. 环境变量总表

| 变量 | 含义 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `NODE_ENV` | 运行环境 | `development` | 生产设为 `production`，影响缓存与日志格式 |
| `PORT` | HTTP 端口 | `3000` | 容器内固定 3000，由 nginx 对外映射 |
| `HOST` | 监听地址 | `0.0.0.0` | |
| `FRONTEND_DIR` | 前端静态目录 | `frontend` | 相对进程工作目录；生产镜像设为 `frontend-app/dist`（Vue 构建产物），`frontend/` 为旧版回退 |
| `STORE_BACKEND` | 存储后端 | `memory` | `memory` / `postgres` / `redis`；多实例必须 `redis` |
| `DATABASE_URL` | PostgreSQL 连接串 | 空 | `STORE_BACKEND=postgres` 时必需，用户与牌局历史持久化 |
| `REDIS_URL` | Redis 连接串 | 空 | 设置即进入多实例模式（adapter + scheduler owner），且强制 `STORE_BACKEND=redis` |
| `JWT_SECRET` | JWT 签名密钥 | 空 | 生产必须显式设置强密钥，compose 中仅为占位 |
| `JWT_EXPIRES_IN` | 令牌有效期 | `7d` | jsonwebtoken 格式，如 `12h`、`3600` |
| `CORS_ORIGINS` | 跨域白名单 | 空（放开） | 逗号分隔；生产务必设置 |
| `RATE_LIMIT_WINDOW_MS` | 限流窗口 | `900000` | `/api/` 限流窗口毫秒数 |
| `RATE_LIMIT_MAX` | 限流上限 | `100` | 窗口内单 IP 最大请求数 |
| `AI_PROVIDER` | AI 服务商类型 | `openai-compatible` | |
| `AI_BASE_URL` | AI 接口地址 | OpenAI 官方 | 支持 DeepSeek、Moonshot、通义、Groq 等兼容服务 |
| `AI_API_KEY` | AI 密钥 | 空 | 只放服务器，不进 Git |
| `AI_MODEL` | AI 模型 | `gpt-4o-mini` | |
| `AI_TIMEOUT_MS` | AI 超时 | `10000` | |
| `AI_TEMPERATURE` | 采样温度 | `0.4` | 值越高输出越随机 |
| `AI_MAX_TOKENS` | 最大输出 token | `256` | 请求侧实际使用 `max(AI_MAX_TOKENS, 4096)`，低于 4096 会被提升，避免 JSON 截断 |
| `AI_FALLBACK_ENABLED` | AI 规则回退 | `true` | AI 超时/出错时回退规则引擎 |
| `NGINX_PORT` | 对外端口 | `80` | 仅 compose 使用，宿主端口映射 |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | 数据库账号 | `poker` / `poker` / `poker` | 仅 compose 使用，同时拼入 app 的 `DATABASE_URL` |

compose 会自动读取与 `docker-compose.yml` 同级的 `.env` 做变量替换，
把真实值（`JWT_SECRET`、`AI_API_KEY` 等）写在那里即可，不要提交。

## 3. 方式一：本地直接运行（无 Docker）

适合单机部署或开发自验。单实例可用 `memory` 存储；要持久化或多实例，
自行准备 PostgreSQL/Redis 并设置对应环境变量。

```bash
npm ci                 # 含 devDependencies（tsc 构建需要）
npm run build          # tsc → dist/
npm run start:prod     # node dist/server.js

# 指定 Vue 前端产物（默认托管 frontend/ 旧版静态目录）
FRONTEND_DIR=frontend-app/dist npm run start:prod
```

开发模式仍是 `npm start`（tsx 直跑 `server.ts`，免构建）。

## 4. 方式二：PM2（遗留单实例方案）

> 仅适合单实例。多实例部署请使用 Docker Compose（见下节），不要在
> PM2 cluster 模式下直接多开——跨实例广播与计时器仲裁依赖 Redis
> 接线，Compose 拓扑已把环境变量、健康检查与粘性代理全部配好。

```bash
npm ci && npm run build        # 先构建，ecosystem 指向 dist/server.js
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

## 5. 方式三：Docker Compose（推荐，多实例）

```bash
cp .env.example .env           # 填写 JWT_SECRET / AI_API_KEY 等真实值
docker compose up -d --build   # 构建镜像并启动 nginx + app×2 + postgres + redis
docker compose ps              # 查看各服务健康状态
```

首次启动后访问 `http://localhost/`（或 `${NGINX_PORT}` 端口）。

## 6. 扩容与缩容

```bash
# 扩到 4 个 app 实例
docker compose up -d --scale app=4

# nginx 只在启动时解析一次 app 的实例 IP，扩缩容后必须重启它
docker compose restart nginx
```

无需改任何配置：新实例通过同一 `REDIS_URL` 接入广播总线与 scheduler
仲裁，房间状态在 Redis 中共享。

## 7. 健康检查

- 应用：`GET /health` 返回 `{"status":"ok", ...}`，镜像内置
  `HEALTHCHECK` 与 compose `healthcheck` 均已接入。
- 依赖：postgres 用 `pg_isready`，redis 用 `redis-cli ping`。
- 手工验证：

```bash
curl http://localhost/health          # 经 nginx
docker compose exec app wget -qO- http://localhost:3000/health
```

## 8. 日志与排障

```bash
docker compose logs -f app            # 应用日志（所有副本）
docker compose logs -f nginx          # 代理日志
```

- 启动即退出且日志含 `REDIS_URL requires STORE_BACKEND=redis`：
  环境变量组合错误，多实例模式强制 redis 存储。
- 启动即退出且日志含 `Redis is unreachable`：Redis 未就绪或连接串错误，
  服务按设计快速失败（不静默降级为单实例）。

## 9. 注意事项

- 生产环境务必设置 `JWT_SECRET` 与 `CORS_ORIGINS`。
- `AI_API_KEY` 只保存在服务器 `.env` 中，不要提交到 Git。
- 单实例 `memory` 存储重启即丢房间与玩家数据；持久化至少使用
  `STORE_BACKEND=postgres`，多实例使用 `redis`。
