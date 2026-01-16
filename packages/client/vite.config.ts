import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 4012,
    proxy: {
      '/trpc': {
        target: 'http://localhost:4011',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:4011',
        changeOrigin: true,
      },
    },
  },
})
