import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { ChatMessage, UserMemory } from '../shared/types'
import { dataPath } from './store'

const MEMORY_FILE = 'user-memory.json'
const HISTORY_FILE = 'chat-history.json'
const MAX_HISTORY = 50
export const SHORT_TERM_TURNS = 20

export function emptyMemory(): UserMemory {
  return {
    name: '',
    likes: [],
    dislikes: [],
    routine: [],
    facts: [],
    updatedAt: new Date().toISOString()
  }
}

function uniq(items: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const text = item.trim()
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= 40) break
  }
  return result
}

export function loadMemory(): UserMemory {
  const path = dataPath(MEMORY_FILE)
  if (!existsSync(path)) return emptyMemory()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<UserMemory>
    return {
      name: typeof raw.name === 'string' ? raw.name : '',
      likes: uniq(raw.likes || []),
      dislikes: uniq(raw.dislikes || []),
      routine: uniq(raw.routine || []),
      facts: uniq(raw.facts || []),
      updatedAt: raw.updatedAt || new Date().toISOString()
    }
  } catch {
    return emptyMemory()
  }
}

export function saveMemory(memory: UserMemory): UserMemory {
  const next: UserMemory = {
    name: memory.name?.trim() || '',
    likes: uniq(memory.likes || []),
    dislikes: uniq(memory.dislikes || []),
    routine: uniq(memory.routine || []),
    facts: uniq(memory.facts || []),
    updatedAt: new Date().toISOString()
  }
  writeFileSync(dataPath(MEMORY_FILE), JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function mergeMemory(prev: UserMemory, patch: Partial<UserMemory>): UserMemory {
  return saveMemory({
    name: (patch.name && patch.name.trim()) || prev.name,
    likes: [...prev.likes, ...(patch.likes || [])],
    dislikes: [...prev.dislikes, ...(patch.dislikes || [])],
    routine: [...prev.routine, ...(patch.routine || [])],
    facts: [...prev.facts, ...(patch.facts || [])],
    updatedAt: prev.updatedAt
  })
}

export function clearMemory(): UserMemory {
  return saveMemory(emptyMemory())
}

export function loadHistory(): ChatMessage[] {
  const path = dataPath(HISTORY_FILE)
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as ChatMessage[]
    return Array.isArray(raw) ? raw.slice(-MAX_HISTORY) : []
  } catch {
    return []
  }
}

export function saveHistory(history: ChatMessage[]): ChatMessage[] {
  const next = history.slice(-MAX_HISTORY)
  writeFileSync(dataPath(HISTORY_FILE), JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function appendHistory(message: ChatMessage): ChatMessage[] {
  return saveHistory([...loadHistory(), message])
}

export function recentHistory(history = loadHistory()): ChatMessage[] {
  return history.slice(-SHORT_TERM_TURNS)
}

export function memoryHasContent(memory: UserMemory): boolean {
  return Boolean(
    memory.name ||
      memory.likes.length ||
      memory.dislikes.length ||
      memory.routine.length ||
      memory.facts.length
  )
}

export function formatMemoryForPrompt(memory: UserMemory): string {
  if (!memoryHasContent(memory)) {
    return '你还不太了解这位用户，可以在聊天里慢慢记住对方的称呼和喜好。'
  }
  const lines: string[] = []
  if (memory.name) lines.push(`称呼：${memory.name}`)
  if (memory.likes.length) lines.push(`喜好：${memory.likes.join('、')}`)
  if (memory.dislikes.length) lines.push(`不太喜欢：${memory.dislikes.join('、')}`)
  if (memory.routine.length) lines.push(`作息/习惯：${memory.routine.join('、')}`)
  if (memory.facts.length) lines.push(`其他事实：${memory.facts.join('、')}`)
  return lines.join('\n')
}

export function personaPrompt(memory: UserMemory): string {
  return [
    '你是「灵」，一位温柔、轻快的桌面虚拟伙伴，负责日常陪伴，也能帮用户做一些本机小事。',
    '用口语化的中文交流，像朋友一样说话。',
    '回复简短自然，一般两三句；真正需要讲清楚时可以稍长一点。',
    '先回应情绪，再给帮助或建议。',
    '会记住用户的喜好，但要自然用上，不要每次都说「我记得你喜欢…」。',
    '不要主动说自己是 AI、语言模型或程序。',
    '不说教、不端着，也不要过度卖萌。',
    '',
    '当用户明确要你动手时，调用工具去做，不要只口头教步骤。',
    '你可以像助手一样读写电脑上任意位置的文件，path 用完整路径，或「桌面」「文档」「下载」。',
    '常用工具：list_files、read_file、write_file、replace_in_file、find_files、search_in_files、copy_file、create_directory、convert_to_pdf、open_path。',
    '改已有文件时先 read_file，再 replace_in_file 或 write_file。Word/Excel 不要当文本硬读，用 convert_to_pdf。',
    '不要删除文件，不要写入 C:\\Windows 和 Program Files。做好后用一两句话说明结果和路径。',
    '',
    '你记得的关于用户的事：',
    formatMemoryForPrompt(memory)
  ].join('\n')
}

export function timeOfDayLabel(date = new Date()): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = date.getHours()
  if (hour < 6) return 'night'
  if (hour < 11) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'night'
}

export function greetingInstruction(memory: UserMemory): string {
  const when = {
    morning: '早上',
    afternoon: '下午',
    evening: '傍晚',
    night: '夜里'
  }[timeOfDayLabel()]
  const name = memory.name ? `对方希望被叫作「${memory.name}」` : '你还不知道对方的称呼'
  return `现在是${when}，用户刚打开桌面。请用一两句话打个招呼。${name}。如果记得喜好，可以轻轻带一句，不要罗列档案。`
}
