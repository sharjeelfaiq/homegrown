import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { bootStatusPlugin } from './vite-boot-status.js'

// https://vite.dev/config/
//
// No dev-server proxy anymore -- frontend and backend are separate origins
// (Vercel + the RunPod pod's proxy domain), and every API/media call in
// src/api.ts already goes through an absolute VITE_BACKEND_URL instead of a
// relative path, so a same-origin proxy would just be dead config. For local
// dev, set VITE_BACKEND_URL in frontend/.env.local to wherever your backend
// is actually running (e.g. http://127.0.0.1:8000).
//
// bootStatusPlugin is NOT a reinstatement of that proxy -- do not delete it as
// such. It proxies nothing: it reads backend/storage/boot_status.json off disk
// and serves it, because during startup the backend has no port bound to proxy
// TO. See vite-boot-status.ts.
export default defineConfig({
  plugins: [react(), bootStatusPlugin()],
  server: {
    host: true, // bind to all network interfaces, not just localhost -- lets you reach the dev server via the machine's LAN IP (e.g. from another device)
  },
})
