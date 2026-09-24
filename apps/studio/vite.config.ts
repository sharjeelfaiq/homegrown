import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { bootStatusPlugin } from './vite-boot-status.js'

// https://vite.dev/config/
//
// The dev proxy is back, for one reason: reaching the app from another device.
// Proxying keeps every request same-origin against the dev server, which works
// from any machine with no per-device configuration.
//
// /audio and /refs are proxied as well as /api because mediaUrl() resolves
// against the same base -- miss them and the API works while playback silently
// 404s.
//
// bootStatusPlugin is unrelated to the proxy -- it proxies nothing, reading
// services/voice-api/storage/boot_status.json off disk instead, because during startup
// the backend has no bound port to proxy TO. See vite-boot-status.ts.
export default defineConfig({
  plugins: [react(), tailwindcss(), bootStatusPlugin()],
  server: {
    host: true, // bind to all network interfaces, not just localhost -- lets you reach the dev server via the machine's LAN IP (e.g. from another device)
    proxy: {
      // The backend is loopback-only from Vite's point of view; the browser
      // never talks to :8000 directly, which is what makes a visiting device
      // work without knowing this machine's address.
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/audio': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/refs': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
