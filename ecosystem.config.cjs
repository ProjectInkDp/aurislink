// pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'AurisLink',
      script: 'npm',
      args: ['run', 'start'],
      cwd: __dirname,
      restart_delay: 3000,
      max_restarts: 10,
      autorestart: true,
    }
  ]
}
