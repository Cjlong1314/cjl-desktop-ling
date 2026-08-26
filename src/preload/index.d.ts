import type { LingAPI } from './index'

declare global {
  interface Window {
    ling: LingAPI
    PIXI: typeof import('pixi.js')
  }
}

export {}
