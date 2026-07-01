# 线上部署指南

## 环境要求

- Node.js >= 18.0.0
- npm
- （可选）Docker 20.10+
- （可选）PM2

## 1. 环境变量

复制示例配置并填写真实值：

```bash
cp .env.example .env
```

编辑 `.env`，至少填写：

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# AI 配置（支持所有 OpenAI-compatible 服务商）
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-your-real-key
AI_MODEL=gpt-4o-mini

# 安全
CORS_ORIGINS=https://your-domain.com
```

支持的 AI 服务商示例：

| 服务商 | AI_BASE_URL |
|--------|-------------|
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| Moonshot | `https://api.moonshot.cn/v1` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Groq | `https://api.groq.com/openai/v1` |

## 2. 本地启动

```bash
npm install
npm start
```

## 3. Docker 部署

```bash
# 构建镜像
docker build -t texas-poker .

# 运行（挂载 .env）
docker run -d --name texas-poker -p 3000:3000 --env-file .env texas-poker
```

或使用 docker-compose：

```bash
docker-compose up -d
```

## 4. PM2 部署

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 5. Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name poker.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 6. 健康检查

服务启动后访问：

```bash
curl http://localhost:3000/health
```

## 7. 日志

- 开发模式：`npm start` 直接输出到终端。
- PM2：`pm2 logs texas-poker`。
- Docker：`docker logs texas-poker`。

## 8. 注意事项

- 生产环境务必设置 `CORS_ORIGINS`，不要留空。
- AI API key 只保存在服务器 `.env` 中，不要提交到 Git。
- 当前使用内存存储，重启服务会丢失房间与玩家数据。如需持久化，可替换 `backend/storage/memory-store.js` 为 Redis/PostgreSQL 实现。
