export const DEFAULT_BASE_URL = 'https://api.minimaxi.com/v1'
export const INTL_BASE_URL = 'https://api.minimax.io/v1'
export const DEFAULT_MODEL = 'MiniMax-M2'

export const CHAR_SIZE = { width: 180, height: 230 }
export const DEFAULT_CHAT_SIZE = { width: 220, height: 140 }
export const MIN_CHAT_SIZE = { width: 180, height: 100 }

export interface AppSettings {
  apiKey: string
  baseUrl: string
  model: string
  idleChat: boolean
  idleMinutes: number
  chatWidth?: number
  chatHeight?: number
}

export interface PublicSettings {
  hasApiKey: boolean
  apiKey: string
  baseUrl: string
  model: string
  idleChat: boolean
  idleMinutes: number
  chatWidth: number
  chatHeight: number
}

export interface UserMemory {
  name: string
  likes: string[]
  dislikes: string[]
  routine: string[]
  facts: string[]
  updatedAt: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  at: number
}

export interface InitPayload {
  settings: PublicSettings
  memory: UserMemory
  history: ChatMessage[]
}

export type CharacterMood = 'idle' | 'listen' | 'talk'

export interface ToolEvent {
  name: string
  label: string
  status: 'running' | 'done' | 'error'
  detail?: string
}
