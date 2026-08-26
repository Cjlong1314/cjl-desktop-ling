import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve('src/renderer'),
    publicDir: resolve('src/renderer/public'),
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    optimizeDeps: {
      include: ['pixi.js', '@pixi/unsafe-eval', 'pixi-live2d-display/cubism4']
    },
    build: {
      rollupOptions: {
        input: {
          pet: resolve('src/renderer/pet.html'),
          settings: resolve('src/renderer/settings.html'),
          reminder: resolve('src/renderer/reminder.html')
        }
      }
    }
  }
})
