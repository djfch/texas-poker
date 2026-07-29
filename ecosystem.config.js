// ⚠️ 遗留单实例方案（legacy single-instance only）。
// 多实例部署请使用 docker-compose（nginx 粘性代理 + app×N + postgres/redis），
// 不要在 PM2 cluster 模式下多开——跨实例广播与计时器仲裁依赖 Compose
// 拓扑中的 Redis 接线与粘性会话。
// 使用前必须先构建：npm run build（产物入口为 dist/server.js）。
module.exports = {
  apps: [{
    name: 'texas-poker',
    script: './dist/server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
    },
    env_file: '.env',
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_memory_restart: '512M',
    autorestart: true,
    restart_delay: 3000,
    max_restarts: 5,
    min_uptime: '10s',
    kill_timeout: 5000,
    listen_timeout: 10000,
  }],
};
