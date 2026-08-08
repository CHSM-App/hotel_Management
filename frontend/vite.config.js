import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
  },
  build: {
    outDir: '../backend/src/public',  // build SPA into the backend web root (served by express.static)
    emptyOutDir: true,
  },
})
