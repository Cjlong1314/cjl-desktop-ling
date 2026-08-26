import type { CharacterMood } from '../../../shared/types'

export interface Live2DHandle {
  setMood: (mood: CharacterMood) => void
}
