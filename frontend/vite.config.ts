import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/guide/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  server: {
    proxy: {
      // The FastAPI backend runs on 127.0.0.1:8000 in dev.
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
