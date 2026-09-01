export const DEFAULT_BASE_URL = 'https://api.minimaxi.com/v1'
export const INTL_BASE_URL = 'https://api.minimax.io/v1'
export const DEFAULT_MODEL = 'MiniMax-M2'
export const VISION_MODEL = 'MiniMax-M3'
export const MAX_CHAT_IMAGES = 4

export const API_PRESETS = [
  { id: 'minimax-cn', label: 'MiniMax 国内', baseUrl: DEFAULT_BASE_URL, model: 'MiniMax-M2' },
  { id: 'minimax-intl', label: 'MiniMax 国际', baseUrl: INTL_BASE_URL, model: 'MiniMax-M2' },
  { id: 'cursor', label: 'Cursor（本机登录 / Key）', baseUrl: 'https://api.cursor.com/v1', model: 'cursor-grok-4.6-high-fast' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'xai', label: 'xAI Grok', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.6' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
] as const

const MINIMAX_MODELS = [
  { id: 'MiniMax-M3', label: 'MiniMax-M3（最新，可识图）' },
  { id: 'MiniMax-M2.7', label: 'MiniMax-M2.7' },
  { id: 'MiniMax-M2.7-highspeed', label: 'MiniMax-M2.7-highspeed（更快）' },
  { id: 'MiniMax-M2.5', label: 'MiniMax-M2.5' },
  { id: 'MiniMax-M2.5-highspeed', label: 'MiniMax-M2.5-highspeed（更快）' },
  { id: 'MiniMax-M2.1', label: 'MiniMax-M2.1' },
  { id: 'MiniMax-M2', label: 'MiniMax-M2' }
]

export const PRESET_MODELS: Record<string, Array<{ id: string; label: string }>> = {
  'minimax-cn': MINIMAX_MODELS,
  'minimax-intl': MINIMAX_MODELS,
    cursor: [
    { id: 'cursor-grok-4.6-high-fast', label: 'Grok 4.6 High Fast' },
    { id: 'cursor-grok-4.6-high', label: 'Grok 4.6 High' },
    { id: 'composer-2.5', label: 'Composer 2.5' },
    { id: 'auto', label: 'Auto' }
  ],
  openai: [
    { id: 'gpt-4o-mini', label: 'gpt-4o-mini（便宜，默认识图）' },
    { id: 'gpt-4o', label: 'gpt-4o' },
    { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
    { id: 'gpt-4.1', label: 'gpt-4.1' }
  ],
  xai: [
    { id: 'grok-4.6', label: 'grok-4.6' },
    { id: 'grok-4', label: 'grok-4' },
    { id: 'grok-3', label: 'grok-3' },
    { id: 'grok-3-mini', label: 'grok-3-mini' }
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'deepseek-chat' },
    { id: 'deepseek-reasoner', label: 'deepseek-reasoner（推理）' }
  ]
}

export function modelsForPreset(presetId: string): Array<{ id: string; label: string }> {
  return PRESET_MODELS[presetId] || []
}

export const CHAR_SIZE = { width: 180, height: 230 }
// 聊天窗口采用接近微信的方形比例；用户手动调整后会继续记住自己的尺寸。
export const DEFAULT_CHAT_SIZE = { width: 600, height: 600 }
export const MIN_CHAT_SIZE = { width: 180, height: 100 }

export interface AppSettings {
  apiKey: string
  baseUrl: string
  model: string
  idleChat: boolean
  idleMinutes: number
  chatWidth?: number
  chatHeight?: number
  cursorCli?: boolean
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
  cursorCli: boolean
  cursorCliLoggedIn: boolean
  cursorCliAccount: string
  cursorAgentFound: boolean
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
