import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  envDir: process.env.CLUTCH_VITE_ENV_DIR || undefined,
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    /**
     * Домены туннелей, через которые игру открывают на телефоне. На Host не из этого списка Vite
     * отвечает «Blocked request», и выглядит это как поломка туннеля, а не как его настройка.
     * Поэтому здесь сразу все живые варианты: ngrok выдаёт и `.ngrok-free.app`, и `.ngrok-free.dev`
     * (смена аккаунта домен меняет), Cloudflare Tunnel — `.trycloudflare.com`.
     * Свой домен добавляется без правки файла: CLUTCH_DEV_ALLOWED_HOSTS через запятую.
     */
    allowedHosts: [
      '.ngrok-free.app',
      '.ngrok-free.dev',
      '.ngrok.app',
      '.ngrok.io',
      '.trycloudflare.com',
      ...(process.env.CLUTCH_DEV_ALLOWED_HOSTS ?? '')
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean),
    ],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});
