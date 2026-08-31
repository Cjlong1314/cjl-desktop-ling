import { existsSync, readFileSync, watch, watchFile, writeFileSync } from 'fs'
import { dataPath } from './store'

const FILE = 'reminders.json'
const MAX_TIMEOUT = 2_147_000_000

export interface Reminder {
  id: string
  at: number
  text: string
  kind?: 'relative' | 'absolute'
  createdAt?: number
}

let items: Reminder[] = []
let loaded = false
let lastSnap = ''
let watching = false
const timers = new Map<string, NodeJS.Timeout>()
let onFire: ((reminder: Reminder) => void) | null = null

function filePath(): string {
  return dataPath(FILE)
}

function persist(): void {
  lastSnap = JSON.stringify({ items }, null, 2)
  writeFileSync(filePath(), lastSnap, 'utf8')
}

function load(): void {
  if (loaded) return
  loaded = true
  try {
    if (!existsSync(filePath())) {
      lastSnap = JSON.stringify({ items: [] }, null, 2)
      return
    }
    const raw = readFileSync(filePath(), 'utf8')
    lastSnap = raw
    const parsed = JSON.parse(raw) as { items?: Reminder[] }
    items = Array.isArray(parsed.items) ? parsed.items.filter((item) => item.id && item.text && item.at) : []
  } catch {
    items = []
  }
}

function isImmediateAbsolute(reminder: Reminder, now: number): boolean {
  if (reminder.kind === 'relative') return false
  return Math.abs(reminder.at - now) < 15_000
}

function reloadFromDisk(): void {
  let raw = ''
  try {
    raw = existsSync(filePath()) ? readFileSync(filePath(), 'utf8') : ''
  } catch {
    return
  }
  if (raw === lastSnap) return
  const previous = [...items]
  lastSnap = raw
  loaded = false
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  load()
  const now = Date.now()
  const hadFuture = previous.some((item) => item.at > now + 15_000)
  const diskBogus = items.length > 0 && items.every((item) => isImmediateAbsolute(item, now))
  if (diskBogus && hadFuture) {
    items = previous
    persist()
    for (const reminder of items) {
      if (reminder.at > now) arm(reminder)
    }
    return
  }
  for (const reminder of [...items]) {
    if (isImmediateAbsolute(reminder, now)) {
      items = items.filter((item) => item.id !== reminder.id)
      persist()
      continue
    }
    if (reminder.at <= now) fire(reminder.id)
    else arm(reminder)
  }
}

function arm(reminder: Reminder): void {
  const existing = timers.get(reminder.id)
  if (existing) clearTimeout(existing)
  const delay = Math.max(0, reminder.at - Date.now())
  if (delay > MAX_TIMEOUT) {
    timers.set(
      reminder.id,
      setTimeout(() => arm(reminder), MAX_TIMEOUT)
    )
    return
  }
  timers.set(
    reminder.id,
    setTimeout(() => {
      timers.delete(reminder.id)
      fire(reminder.id)
    }, delay)
  )
}

function fire(id: string): void {
  load()
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) return
  const reminder = items[index]
  items.splice(index, 1)
  persist()
  onFire?.(reminder)
}

const CN_COUNT: Record<string, number> = {
  半: 0.5,
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10
}

function parseCount(raw: string): number | null {
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw)
  return CN_COUNT[raw] ?? null
}

function parseClock(text: string): { hour: number; minute: number } | null {
  const hm = text.match(/(\d{1,2})[:：](\d{1,2})/)
  const hOnly = text.match(/(\d{1,2})\s*点(?:(\d{1,2})\s*分?)?/)
  let hour: number | null = null
  let minute = 0
  if (hm) {
    hour = Number(hm[1])
    minute = Number(hm[2])
  } else if (hOnly) {
    hour = Number(hOnly[1])
    minute = hOnly[2] ? Number(hOnly[2]) : 0
  }
  if (hour === null || hour > 23 || minute > 59) return null
  if (/下午|晚上|傍晚|中午/.test(text) && hour > 0 && hour < 12) hour += 12
  if (/凌晨|早上|上午/.test(text) && hour === 12) hour = 0
  return { hour, minute }
}

function parseCalendar(text: string): { year: number | null; month: number; day: number } | null {
  const afterDay = '(?:\\s*[日号]|(?=\\s|$|上午|下午|晚上|早上|凌晨|中午|傍晚|点|[:：]))'
  const cnFull = text.match(new RegExp(`(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})${afterDay}`))
  if (cnFull) return { year: Number(cnFull[1]), month: Number(cnFull[2]), day: Number(cnFull[3]) }
  const cnMd = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/)
  if (cnMd) return { year: null, month: Number(cnMd[1]), day: Number(cnMd[2]) }
  const ymd = text.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/)
  if (ymd) return { year: Number(ymd[1]), month: Number(ymd[2]), day: Number(ymd[3]) }
  const md = text.match(/(?<!\d)(\d{1,2})[./](\d{1,2})(?!\d)/)
  if (md) {
    const month = Number(md[1])
    const day = Number(md[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { year: null, month, day }
  }
  return null
}

function applyYmd(base: Date, year: number, month: number, day: number): Date {
  const at = new Date(base)
  at.setFullYear(year, month - 1, day)
  if (at.getFullYear() !== year || at.getMonth() !== month - 1 || at.getDate() !== day) {
    throw new Error(`看不懂这个日期：${year}年${month}月${day}日`)
  }
  return at
}

function dayOffset(text: string): number | null {
  if (/大后天/.test(text)) return 3
  if (/后天/.test(text)) return 2
  if (/明天/.test(text)) return 1
  if (/今天/.test(text)) return 0
  return null
}

export function parseReminderTime(input: string): Date {
  const now = new Date()
  const text = input.trim()
  if (!text) throw new Error('没有给出提醒时间')
  if (/^(现在|马上|立刻)/.test(text)) return new Date(now.getTime() + 1500)

  const relMin = text.match(/(\d+|[一两二三四五六七八九十半])\s*分钟后/)
  if (relMin) {
    const n = parseCount(relMin[1])
    if (n) return new Date(now.getTime() + n * 60_000)
  }
  const relHour = text.match(/(\d+|[一两二三四五六七八九十半])\s*小时后/)
  if (relHour) {
    const n = parseCount(relHour[1])
    if (n) return new Date(now.getTime() + n * 3600_000)
  }
  const relSec = text.match(/(\d+|[一两二三四五六七八九十半])\s*秒后/)
  if (relSec) {
    const n = parseCount(relSec[1])
    if (n) return new Date(now.getTime() + n * 1000)
  }

  if (/^\d{4}-\d{1,2}-\d{1,2}(?:[ T]\d{1,2}:\d{2})?/.test(text) || /\dT\d/.test(text)) {
    const parsed = Date.parse(text)
    if (!Number.isNaN(parsed)) {
      const at = new Date(parsed)
      if (at.getTime() > now.getTime() + 1000) return at
      throw new Error(`这个时间已经过了：${text}`)
    }
  }

  const calendar = parseCalendar(text)
  const clock = parseClock(text)
  const offset = dayOffset(text)
  const hour = clock?.hour ?? (calendar || offset !== null ? 9 : null)
  const minute = clock?.minute ?? 0
  if (hour === null) throw new Error(`看不懂这个时间：${text}`)

  if (calendar) {
    const year = calendar.year ?? now.getFullYear()
    const at = applyYmd(now, year, calendar.month, calendar.day)
    at.setHours(hour, minute, 0, 0)
    if (calendar.year === null && at.getTime() <= now.getTime() + 1000) {
      at.setFullYear(year + 1)
    }
    if (at.getTime() <= now.getTime() + 1000) {
      throw new Error(`这个时间已经过了：${text}`)
    }
    return at
  }

  const at = new Date(now)
  at.setSeconds(0, 0)
  at.setHours(hour, minute, 0, 0)
  if (offset !== null) {
    at.setDate(at.getDate() + offset)
    if (at.getTime() <= now.getTime() + 1000) {
      throw new Error(`这个时间已经过了：${text}`)
    }
    return at
  }
  if (at.getTime() <= now.getTime() + 1000) at.setDate(at.getDate() + 1)
  return at
}

export function setReminderHandler(handler: (reminder: Reminder) => void): void {
  onFire = handler
}

export function listReminders(): Reminder[] {
  load()
  return [...items].sort((a, b) => a.at - b.at)
}

function isRelativeWhen(when: string): boolean {
  return /分钟后|小时后|秒后|^(现在|马上|立刻)/.test(when.trim())
}

export function scheduleReminder(when: string, text: string): Reminder {
  load()
  const message = text.trim()
  if (!message) throw new Error('没有给出提醒内容')
  const at = parseReminderTime(when)
  const relative = isRelativeWhen(when)
  const delay = at.getTime() - Date.now()
  if (!relative && delay < 15_000) {
    throw new Error(`指定日期不能马上提醒：${when}`)
  }
  const reminder: Reminder = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: at.getTime(),
    text: message.slice(0, 200),
    kind: relative ? 'relative' : 'absolute',
    createdAt: Date.now()
  }
  items.push(reminder)
  persist()
  arm(reminder)
  return reminder
}

export function snoozeReminder(id: string, minutes = 5): Reminder | null {
  load()
  const found = items.find((item) => item.id === id)
  const text = found?.text
  if (found) {
    items = items.filter((item) => item.id !== id)
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    persist()
  }
  if (!text) return null
  return scheduleReminder(`${Math.max(1, minutes)}分钟后`, text)
}

export function dismissReminder(id: string): void {
  load()
  items = items.filter((item) => item.id !== id)
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
  persist()
}

export function startReminders(): void {
  load()
  const now = Date.now()
  for (const reminder of [...items]) {
    if (reminder.at <= now) fire(reminder.id)
    else arm(reminder)
  }
  if (watching) return
  watching = true
  watchFile(filePath(), { interval: 800 }, () => reloadFromDisk())
  try {
    if (!existsSync(filePath())) persist()
    watch(filePath(), () => reloadFromDisk())
  } catch {
    // watchFile 仍在
  }
}

export function tryScheduleFromUserText(text: string): Reminder | null {
  const t = text.trim().replace(/[。！？!?]+$/g, '')
  const rel =
    t.match(
      /^(?:请)?(?:帮我)?(\d+|[一两二三四五六七八九十半])\s*(分钟|小时|秒)后(?:提醒我|叫我|通知我)(.+)$/
    ) ||
    t.match(
      /^(?:请)?(?:帮我)?(?:提醒我|叫我)(\d+|[一两二三四五六七八九十半])\s*(分钟|小时|秒)后(?:去)?(.+)$/
    )
  if (rel) {
    const unit = rel[2] === '小时' ? '小时后' : rel[2] === '秒' ? '秒后' : '分钟后'
    const message = rel[3].trim().replace(/^[，,、\s]+/, '')
    if (!message) return null
    return scheduleReminder(`${rel[1]}${unit}`, message)
  }
  return null
}

export function refreshReminders(): void {
  reloadFromDisk()
}

export function formatReminderTime(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const year =
    date.getFullYear() === new Date().getFullYear() ? '' : `${date.getFullYear()}年`
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
