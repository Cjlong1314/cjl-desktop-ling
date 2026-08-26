import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dataPath } from './store'

const FILE = 'reminders.json'
const MAX_TIMEOUT = 2_147_000_000

export interface Reminder {
  id: string
  at: number
  text: string
}

let items: Reminder[] = []
let loaded = false
const timers = new Map<string, NodeJS.Timeout>()
let onFire: ((reminder: Reminder) => void) | null = null

function filePath(): string {
  return dataPath(FILE)
}

function persist(): void {
  writeFileSync(filePath(), JSON.stringify({ items }, null, 2), 'utf8')
}

function load(): void {
  if (loaded) return
  loaded = true
  try {
    if (!existsSync(filePath())) return
    const raw = JSON.parse(readFileSync(filePath(), 'utf8')) as { items?: Reminder[] }
    items = Array.isArray(raw.items) ? raw.items.filter((item) => item.id && item.text && item.at) : []
  } catch {
    items = []
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

export function parseReminderTime(input: string): Date {
  const now = new Date()
  const text = input.trim()
  if (!text) throw new Error('没有给出提醒时间')
  if (/^(现在|马上|立刻)/.test(text)) return new Date(now.getTime() + 1500)

  const relMin = text.match(/(\d+)\s*分钟后/)
  if (relMin) return new Date(now.getTime() + Number(relMin[1]) * 60_000)
  const relHour = text.match(/(\d+)\s*小时后/)
  if (relHour) return new Date(now.getTime() + Number(relHour[1]) * 3600_000)
  const relSec = text.match(/(\d+)\s*秒后/)
  if (relSec) return new Date(now.getTime() + Number(relSec[1]) * 1000)

  if (/^\d{4}-\d{2}-\d{2}/.test(text) || text.includes('T')) {
    const parsed = Date.parse(text)
    if (!Number.isNaN(parsed)) return new Date(parsed)
  }

  let hour: number | null = null
  let minute = 0
  const hm = text.match(/(\d{1,2})[:：](\d{1,2})/)
  const hOnly = text.match(/(\d{1,2})\s*点(?:(\d{1,2})\s*分?)?/)
  if (hm) {
    hour = Number(hm[1])
    minute = Number(hm[2])
  } else if (hOnly) {
    hour = Number(hOnly[1])
    minute = hOnly[2] ? Number(hOnly[2]) : 0
  }

  if (hour === null || hour > 23 || minute > 59) {
    throw new Error(`看不懂这个时间：${text}`)
  }
  if (/下午|晚上|傍晚|中午/.test(text) && hour > 0 && hour < 12) hour += 12
  if (/凌晨|早上|上午/.test(text) && hour === 12) hour = 0

  const at = new Date(now)
  at.setSeconds(0, 0)
  at.setHours(hour, minute, 0, 0)
  if (/明天/.test(text)) at.setDate(at.getDate() + 1)
  if (at.getTime() <= now.getTime() + 1000) {
    return new Date(now.getTime() + 1500)
  }
  return at
}

export function setReminderHandler(handler: (reminder: Reminder) => void): void {
  onFire = handler
}

export function listReminders(): Reminder[] {
  load()
  return [...items].sort((a, b) => a.at - b.at)
}

export function scheduleReminder(when: string, text: string): Reminder {
  load()
  const message = text.trim()
  if (!message) throw new Error('没有给出提醒内容')
  const at = parseReminderTime(when)
  const reminder: Reminder = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: at.getTime(),
    text: message.slice(0, 200)
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
}

export function formatReminderTime(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
