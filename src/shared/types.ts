export const DEFAULT_BASE_URL = 'https://api.minimaxi.com/v1'
export const INTL_BASE_URL = 'https://api.minimax.io/v1'
export const DEFAULT_MODEL = 'MiniMax-M2'
export const VISION_MODEL = 'MiniMax-M3'
export const MAX_CHAT_IMAGES = 4

export const API_PRESETS = [
  { id: 'minimax-cn', label: 'MiniMax 国内', baseUrl: DEFAULT_BASE_URL, model: 'MiniMax-M2' },
  { id: 'minimax-intl', label: 'MiniMax 国际', baseUrl: INTL_BASE_URL, model: 'MiniMax-M2' },
  { id: 'cursor', label: 'Cursor（crsr_ Key）', baseUrl: 'https://api.cursor.com/v1', model: 'grok-4.6' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'xai', label: 'xAI Grok', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.6' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
] as const

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
  occupation: string
  likes: string[]
  dislikes: string[]
  routine: string[]
  facts: string[]
  selfName: string
  selfOccupation: string
  updatedAt: string
  shortTermMarkdown: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  at: number
  images?: string[]
}

export interface ChatImageInput {
  path?: string
  dataUrl?: string
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
