import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ChatMessage, UserMemory } from '../shared/types'
import { hydrateMessageImages, persistMessageImages, pruneImageFiles } from './images'
import { dataPath, legacyUserDataPath, projectDataPath } from './store'
import { getWorkspace } from './workspace'

const JSON_MEMORY_FILE = 'user-memory.json'
const HISTORY_FILE = 'chat-history.json'
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000
const SHORT_TERM_KEEP_DAYS = 14
const SHORT_TERM_MAX_CHARS = 80_000
const TURN_CLIP = 800

export function emptyMemory(): UserMemory {
  return {
    name: '',
    occupation: '',
    likes: [],
    dislikes: [],
    routine: [],
    facts: [],
    selfName: '灵',
    selfOccupation: '',
    updatedAt: new Date().toISOString(),
    shortTermMarkdown: ''
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

function clip(text: string, max = TURN_CLIP): string {
  const value = text.replace(/\s+\n/g, '\n').trim()
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}

export function dayKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function recentDayKeys(days: number): string[] {
  const keys: string[] = []
  for (let i = 0; i < days; i++) {
    const date = new Date()
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() - i)
    keys.push(dayKey(date))
  }
  return keys
}

function longTermPath(): string {
  return projectDataPath('memory', 'long-term.md')
}

function shortTermDir(): string {
  return projectDataPath('memory', 'short-term')
}

function shortTermPath(key: string): string {
  return join(shortTermDir(), `${key}.md`)
}

function ensureMemoryDirs(): void {
  mkdirSync(projectDataPath('memory'), { recursive: true })
  mkdirSync(shortTermDir(), { recursive: true })
}

function readText(file: string): string {
  if (!existsSync(file)) return ''
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function parseSection(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = markdown.match(new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i'))
  return match ? match[1].trim() : ''
}

function parseList(section: string): string[] {
  return uniq(
    section
      .split('\n')
      .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
      .filter(Boolean)
  )
}

function parseLine(section: string): string {
  return (
    section
      .split('\n')
      .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
      .find((line) => line && line !== '（还不知道）' && line !== '（暂无）') || ''
  )
}

function parseSub(block: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = block.match(new RegExp(`###\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|$)`, 'i'))
  return match ? match[1].trim() : ''
}

function serializeLongTerm(memory: UserMemory): string {
  const list = (items: string[]): string =>
    items.length ? items.map((item) => `- ${item}`).join('\n') : '（暂无）'
  const line = (value: string, empty = '（暂无）'): string => value.trim() || empty
  return [
    '# 长期记忆',
    '',
    `> 更新：${memory.updatedAt}`,
    '',
    '## 用户',
    '',
    '### 称呼',
    '',
    line(memory.name, '（还不知道）'),
    '',
    '### 职业',
    '',
    line(memory.occupation),
    '',
    '### 喜好',
    '',
    list(memory.likes),
    '',
    '### 不太喜欢',
    '',
    list(memory.dislikes),
    '',
    '### 作息与习惯',
    '',
    list(memory.routine),
    '',
    '### 其他事实',
    '',
    list(memory.facts),
    '',
    '## 灵',
    '',
    '### 称呼',
    '',
    line(memory.selfName, '灵'),
    '',
    '### 职业',
    '',
    line(memory.selfOccupation),
    ''
  ].join('\n')
}

function parseLongTerm(markdown: string): UserMemory {
  const userBlock = parseSection(markdown, '用户')
  const selfBlock = parseSection(markdown, '灵')
  const updated = markdown.match(/更新：\s*(\S+)/)?.[1]
  const fromOldFacts = parseList(parseSection(markdown, '长期事实')).filter((item) => item !== '（暂无）')
  const occupationFromFacts = fromOldFacts.find((item) => /^职业[:：]/.test(item))
  const facts = userBlock
    ? parseList(parseSub(userBlock, '其他事实')).filter((item) => item !== '（暂无）')
    : fromOldFacts.filter((item) => !/^职业[:：]/.test(item))
  return {
    name: parseLine(userBlock ? parseSub(userBlock, '称呼') : parseSection(markdown, '称呼')),
    occupation:
      parseLine(userBlock ? parseSub(userBlock, '职业') : '') ||
      (occupationFromFacts ? occupationFromFacts.replace(/^职业[:：]\s*/, '') : ''),
    likes: parseList(userBlock ? parseSub(userBlock, '喜好') : parseSection(markdown, '喜好')).filter(
      (item) => item !== '（暂无）'
    ),
    dislikes: parseList(
      userBlock ? parseSub(userBlock, '不太喜欢') : parseSection(markdown, '不太喜欢')
    ).filter((item) => item !== '（暂无）'),
    routine: parseList(
      userBlock ? parseSub(userBlock, '作息与习惯') : parseSection(markdown, '作息与习惯')
    ).filter((item) => item !== '（暂无）'),
    facts,
    selfName: parseLine(selfBlock ? parseSub(selfBlock, '称呼') : '') || '灵',
    selfOccupation: parseLine(selfBlock ? parseSub(selfBlock, '职业') : ''),
    updatedAt: updated || new Date().toISOString(),
    shortTermMarkdown: ''
  }
}

function loadJsonMemory(): UserMemory | null {
  const path = dataPath(JSON_MEMORY_FILE)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<UserMemory>
    return {
      name: typeof raw.name === 'string' ? raw.name : '',
      occupation: typeof raw.occupation === 'string' ? raw.occupation : '',
      likes: uniq(raw.likes || []),
      dislikes: uniq(raw.dislikes || []),
      routine: uniq(raw.routine || []),
      facts: uniq(raw.facts || []),
      selfName: typeof raw.selfName === 'string' && raw.selfName.trim() ? raw.selfName : '灵',
      selfOccupation: typeof raw.selfOccupation === 'string' ? raw.selfOccupation : '',
      updatedAt: raw.updatedAt || new Date().toISOString(),
      shortTermMarkdown: ''
    }
  } catch {
    return null
  }
}

function migrateHistoryToShortTerm(): void {
  const path = dataPath(HISTORY_FILE)
  if (!existsSync(path)) return
  const existing = readdirSync(shortTermDir()).some((name) => name.endsWith('.md'))
  if (existing) return
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as ChatMessage[]
    if (!Array.isArray(raw)) return
    const groups = new Map<string, ChatMessage[]>()
    const since = Date.now() - TWO_DAYS_MS
    for (const item of raw) {
      const at = Number(item.at) || 0
      if (at < since) continue
      const key = dayKey(new Date(at))
      const list = groups.get(key) || []
      list.push({ ...item, at })
      groups.set(key, list)
    }
    for (const [key, messages] of groups) {
      const blocks = messages.map((item) => {
        const time = new Date(item.at).toTimeString().slice(0, 5)
        const who = item.role === 'user' ? '用户' : '灵'
        const extra = item.images?.length ? '（附图）' : ''
        return `## ${time}\n\n${who}：${clip(String(item.content || ''))}${extra}`
      })
      writeFileSync(
        shortTermPath(key),
        [`# ${key} 短期记忆`, '', ...blocks].join('\n\n') + '\n',
        'utf8'
      )
    }
  } catch {
    // ignore broken history
  }
}

function pruneOldShortTerm(): void {
  if (!existsSync(shortTermDir())) return
  const keep = new Set(recentDayKeys(SHORT_TERM_KEEP_DAYS))
  for (const name of readdirSync(shortTermDir())) {
    const key = name.replace(/\.md$/i, '')
    if (keep.has(key)) continue
    try {
      unlinkSync(join(shortTermDir(), name))
    } catch {
      // ignore
    }
  }
}

function migrateFromUserData(): void {
  const oldDir = legacyUserDataPath('memory')
  if (!existsSync(oldDir)) return
  const oldLong = join(oldDir, 'long-term.md')
  if (!existsSync(longTermPath()) && existsSync(oldLong)) {
    copyFileSync(oldLong, longTermPath())
  }
  const oldShort = join(oldDir, 'short-term')
  if (!existsSync(oldShort)) return
  mkdirSync(shortTermDir(), { recursive: true })
  for (const name of readdirSync(oldShort)) {
    const dest = join(shortTermDir(), name)
    if (!existsSync(dest)) copyFileSync(join(oldShort, name), dest)
  }
}

function migrateIfNeeded(): void {
  ensureMemoryDirs()
  migrateFromUserData()
  if (!existsSync(longTermPath())) {
    const fromJson = loadJsonMemory()
    if (fromJson && (fromJson.name || fromJson.likes.length || fromJson.facts.length)) {
      writeFileSync(longTermPath(), serializeLongTerm(fromJson), 'utf8')
    }
  }
  migrateHistoryToShortTerm()
  pruneOldShortTerm()
}

export function memoryDir(): string {
  ensureMemoryDirs()
  return projectDataPath('memory')
}

export function loadRecentShortTermMarkdown(days = 2): string {
  ensureMemoryDirs()
  const parts: string[] = []
  for (const key of [...recentDayKeys(days)].reverse()) {
    const body = readText(shortTermPath(key)).trim()
    if (!body) continue
    parts.push(body.startsWith('#') ? body : `# ${key} 短期记忆\n\n${body}`)
  }
  return parts.join('\n\n')
}

export function saveShortTermMarkdown(text: string): void {
  ensureMemoryDirs()
  const raw = text.replace(/\r\n/g, '\n').trim()
  const matches = [...raw.matchAll(/^#\s+(\d{4}-\d{2}-\d{2})[^\n]*/gm)]
  if (!raw) {
    for (const key of recentDayKeys(2)) {
      writeFileSync(shortTermPath(key), '', 'utf8')
    }
    return
  }
  if (!matches.length) {
    writeFileSync(shortTermPath(dayKey()), `# ${dayKey()} 短期记忆\n\n${raw}\n`, 'utf8')
    return
  }
  const written = new Set<string>()
  matches.forEach((match, index) => {
    const key = match[1]
    const start = (match.index || 0) + match[0].length
    const end = index + 1 < matches.length ? matches[index + 1].index || raw.length : raw.length
    const body = raw.slice(start, end).trim()
    writeFileSync(shortTermPath(key), `# ${key} 短期记忆\n\n${body}\n`, 'utf8')
    written.add(key)
  })
  for (const key of recentDayKeys(2)) {
    if (!written.has(key) && existsSync(shortTermPath(key))) {
      writeFileSync(shortTermPath(key), '', 'utf8')
    }
  }
}

export function appendShortTerm(userText: string, assistantText: string, hasImages = false): void {
  ensureMemoryDirs()
  const key = dayKey()
  const time = new Date().toTimeString().slice(0, 5)
  const extra = hasImages ? '（附图）' : ''
  const block = `## ${time}\n\n用户：${clip(userText)}${extra}\n\n灵：${clip(assistantText)}`
  const current = readText(shortTermPath(key)).trim()
  const next = current ? `${current}\n\n${block}\n` : `# ${key} 短期记忆\n\n${block}\n`
  writeFileSync(
    shortTermPath(key),
    next.length > SHORT_TERM_MAX_CHARS ? next.slice(-SHORT_TERM_MAX_CHARS) : next,
    'utf8'
  )
  pruneOldShortTerm()
}

export function loadMemory(): UserMemory {
  migrateIfNeeded()
  const markdown = readText(longTermPath())
  const parsed = markdown.trim() ? parseLongTerm(markdown) : emptyMemory()
  if (!markdown.trim()) {
    const fromJson = loadJsonMemory()
    if (fromJson) {
      parsed.name = fromJson.name
      parsed.occupation = fromJson.occupation
      parsed.likes = fromJson.likes
      parsed.dislikes = fromJson.dislikes
      parsed.routine = fromJson.routine
      parsed.facts = fromJson.facts
      parsed.selfName = fromJson.selfName || '灵'
      parsed.selfOccupation = fromJson.selfOccupation
      parsed.updatedAt = fromJson.updatedAt
    }
  }
  parsed.shortTermMarkdown = loadRecentShortTermMarkdown()
  return parsed
}

export function saveMemory(memory: UserMemory, writeShortTerm = true): UserMemory {
  ensureMemoryDirs()
  const next: UserMemory = {
    name: memory.name?.trim() || '',
    occupation: memory.occupation?.trim() || '',
    likes: uniq(memory.likes || []),
    dislikes: uniq(memory.dislikes || []),
    routine: uniq(memory.routine || []),
    facts: uniq(memory.facts || []),
    selfName: memory.selfName?.trim() || '灵',
    selfOccupation: memory.selfOccupation?.trim() || '',
    updatedAt: new Date().toISOString(),
    shortTermMarkdown: ''
  }
  writeFileSync(longTermPath(), serializeLongTerm(next), 'utf8')
  if (writeShortTerm && typeof memory.shortTermMarkdown === 'string') {
    saveShortTermMarkdown(memory.shortTermMarkdown)
  }
  next.shortTermMarkdown = loadRecentShortTermMarkdown()
  return next
}

export function mergeMemory(prev: UserMemory, patch: Partial<UserMemory>): UserMemory {
  return saveMemory(
    {
      name: (patch.name && patch.name.trim()) || prev.name,
      occupation: (patch.occupation && patch.occupation.trim()) || prev.occupation,
      likes: [...prev.likes, ...(patch.likes || [])],
      dislikes: [...prev.dislikes, ...(patch.dislikes || [])],
      routine: [...prev.routine, ...(patch.routine || [])],
      facts: [...prev.facts, ...(patch.facts || [])],
      selfName: prev.selfName || '灵',
      selfOccupation: prev.selfOccupation,
      updatedAt: prev.updatedAt,
      shortTermMarkdown: prev.shortTermMarkdown
    },
    false
  )
}

export function clearMemory(): UserMemory {
  ensureMemoryDirs()
  if (existsSync(shortTermDir())) {
    for (const name of readdirSync(shortTermDir())) {
      try {
        unlinkSync(join(shortTermDir(), name))
      } catch {
        // ignore
      }
    }
  }
  const empty = emptyMemory()
  writeFileSync(longTermPath(), serializeLongTerm(empty), 'utf8')
  return empty
}

export function loadHistory(): ChatMessage[] {
  const path = dataPath(HISTORY_FILE)
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as ChatMessage[]
    const since = Date.now() - TWO_DAYS_MS
    return Array.isArray(raw)
      ? raw
          .filter((item) => Number(item.at) >= since)
          .map((item) => ({
            role: item.role,
            content: String(item.content || ''),
            at: Number(item.at) || Date.now(),
            images: hydrateMessageImages(item.images)
          }))
      : []
  } catch {
    return []
  }
}

export function saveHistory(history: ChatMessage[]): ChatMessage[] {
  const since = Date.now() - TWO_DAYS_MS
  const next = history.filter((item) => item.at >= since)
  const disk = next.map((item) => ({
    role: item.role,
    content: item.content,
    at: item.at,
    images: persistMessageImages(item.at, item.images)
  }))
  writeFileSync(dataPath(HISTORY_FILE), JSON.stringify(disk, null, 2), 'utf8')
  pruneImageFiles(disk.flatMap((item) => item.images || []))
  return next
}

export function appendHistory(message: ChatMessage): ChatMessage[] {
  return saveHistory([...loadHistory(), message])
}

export function memoryHasContent(memory: UserMemory): boolean {
  return Boolean(
    memory.name ||
      memory.occupation ||
      memory.likes.length ||
      memory.dislikes.length ||
      memory.routine.length ||
      memory.facts.length ||
      memory.selfOccupation
  )
}

export function formatMemoryForPrompt(memory: UserMemory): string {
  const self = memory.selfName || '灵'
  const lines = [
    '用户：',
    memory.name ? `- 称呼：${memory.name}` : '- 称呼：还不知道',
    memory.occupation ? `- 职业：${memory.occupation}` : '- 职业：还不知道',
    memory.likes.length ? `- 喜好：${memory.likes.join('、')}` : '- 喜好：暂无',
    memory.dislikes.length ? `- 不太喜欢：${memory.dislikes.join('、')}` : '- 不太喜欢：暂无',
    memory.routine.length ? `- 作息/习惯：${memory.routine.join('、')}` : '- 作息/习惯：暂无',
    memory.facts.length ? `- 其他事实：${memory.facts.join('、')}` : '- 其他事实：暂无',
    '',
    `${self}：`,
    `- 称呼：${self}`,
    memory.selfOccupation ? `- 职业：${memory.selfOccupation}` : '- 职业：暂无'
  ]
  return lines.join('\n')
}

export function personaPrompt(memory: UserMemory): string {
  const workspace = getWorkspace()
  const self = memory.selfName || '灵'
  const longTerm = formatMemoryForPrompt(memory)
  const shortTerm = (memory.shortTermMarkdown || '').trim() || '（近两天还没有短期记忆）'
  return [
    `你是「${self}」，一位温柔、轻快的桌面虚拟伙伴。`,
    `核心原则：用户说出需求，你就动手去完成。能做的立刻用工具做，不要只给步骤或让用户自己去点。做不到就说明卡在哪、还缺什么，然后换办法继续试。`,
    `当前这一轮只完成用户刚刚说的那件事。长期记忆、短期记忆和「刚才的对话」都是背景：不要把更早的旧任务（例如开会、写报告、开软件）重新做一遍。但用户问「刚才说了什么」「我叫什么」「你是谁」时，必须按对话记录和记忆回答，不要说这一轮没说话。`,
    `你的称呼是「${self}」。你的职业是${memory.selfOccupation || '暂无'}。不要把用户的职业、身份说成你自己的。对外始终自称「${self}」，不要自称 Cursor 编程助手。用户问你是什么模型时，只说当前底层模型，不要编造成别的产品。`,
    '会记住用户的喜好，自然用上。不要主动说自己是 AI。不要删除用户没要求删的文件，不要写入 C:\\Windows 和 Program Files。',
    '',
    `现在时间：${nowLabel()}`,
    `当前工作目录：${workspace}`,
    '生成的项目、脚本和文件一律写在当前工作目录（本仓库下的 LingProjects）里，不要写到 D:\\LingProjects 或文档\\LingProjects。',
    '有现成工具就用现成工具：定时提醒用 schedule_reminder；打开文件用 open_path；转 PDF 用 convert_to_pdf。不要为这些事再写 PowerShell 弹窗，也不要 Start-Sleep 干等到点。',
    '没有现成工具时，用 list_files / read_file / write_file / replace_in_file / run_command 自己试。做项目：1）用户指定了路径就 set_workspace，否则在当前工作目录建目录并 set_workspace。2）写代码和配置。3）run_command 安装、构建或运行（必须非交互，如 npm create 加 --yes）。4）失败就读报错、改文件、再跑。5）用两三句话告诉用户结果和路径。',
    '工具：schedule_reminder、get_workspace、set_workspace、run_command、list_files、read_file、write_file、replace_in_file、find_files、search_in_files、copy_file、create_directory、convert_to_pdf、open_path。相对路径默认相对工作目录。',
    '闲聊保持两三句。一旦是可执行需求，先做事再简短汇报，不要长篇解释理论。',
    '用户可能发图片。请直接看图回答，不要说自己看不见。截图里的文字、报错、界面都要认真看。',
    '记忆已写入本地 markdown。下面的长期记忆和近两天短期记忆就是背景上下文，请当作已知，不要整段复读，更不要回头去做里面的旧任务。',
    '',
    '## 长期记忆',
    longTerm,
    '',
    '## 近两天短期记忆',
    shortTerm
  ].join('\n')
}

function nowLabel(): string {
  const date = new Date()
  const week = '日一二三四五六'[date.getDay()]
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} 星期${week}`
}

export function timeOfDayLabel(date = new Date()): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = date.getHours()
  if (hour < 6) return 'night'
  if (hour < 11) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'night'
}

export function formatRecentHistory(history: ChatMessage[], limit = 30): string {
  const slice = history.slice(-limit).filter((item) => item.content?.trim())
  if (!slice.length) return ''
  return [
    '## 聊天窗口（跨模型共用的唯一会话。只作背景，不要逐条重答旧问题。）',
    ...slice.map((item) => {
      const who = item.role === 'user' ? '用户' : '灵'
      const text = item.content.trim().slice(0, 2000)
      return `${who}：${text}`
    }),
    '用户问「刚才说了什么」时，必须按上面整段记录回答，包括其他模型说过的话。'
  ].join('\n')
}

export function withWindowTranscript(history: ChatMessage[], latest: string): string {
  const recent = formatRecentHistory(history)
  return recent ? `${recent}\n\n用户最新一句：${latest}` : latest
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
