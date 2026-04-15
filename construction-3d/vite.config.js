import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/models': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  optimizeDeps: {
    exclude: ['@mkkellogg/gaussian-splats-3d']
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          gs3d:  ['@mkkellogg/gaussian-splats-3d'],
          tiles: ['3d-tiles-renderer', 'fflate'],
        }
      }
    }
  }
})
