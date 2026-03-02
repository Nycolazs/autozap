module.exports = {
  apps: [
    {
      name: 'autozap-api',
      script: './server.js',
      cwd: process.env.AUTOZAP_APP_DIR || '/opt/autozap',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '3000',
        TRUST_PROXY: '1',
        FRONTEND_REQUIRE_DESKTOP: '0',
        FIREBASE_WEBHOOK_QUEUE_ENABLED: '0',
      },
    },
  ],
};
