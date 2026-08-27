import type { CharacterMood } from '../../../shared/types'

export type HitArea = 'Head' | 'Body' | 'none'

export interface Live2DHandle {
  setMood: (mood: CharacterMood) => void
  hitAt: (clientX: number, clientY: number) => HitArea
  pet: (area: HitArea) => void
}
