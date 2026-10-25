import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { bootStatusPlugin } from './tooling/vite-boot-status.js'

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
// bootStatusPlugin is a dev-only diagnostic route for inspecting the boot file.
// Studio progress itself comes from /api/models in dev and packaged builds.
export default defineConfig({
  plugins: [react(), tailwindcss(), bootStatusPlugin()],
  test: {
    // Browser tests need jsdom's per-window storage, not Node's native global.
    // Older supported Node versions may not expose this flag.
    execArgv: process.allowedNodeEnvironmentFlags.has('--no-experimental-webstorage')
      ? ['--no-experimental-webstorage']
      : [],
  },
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
