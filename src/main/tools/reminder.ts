import {
  dismissReminder,
  formatReminderTime,
  listReminders,
  parseReminderTime,
  scheduleReminder,
  type Reminder
} from '../reminders'

export const REMINDER_TOOL_FAIL = '定时任务提醒工具调用失败'

export type ReminderToolAction = 'schedule' | 'list' | 'cancel'

export type ReminderToolRequest = {
  action: ReminderToolAction
  when?: string
  message?: string
  id?: string
}

export type ReminderToolResult = {
  ok: boolean
  message: string
  reminder?: Reminder
}

const COUNT = '(\\d+|[一两二三四五六七八九十半])'
const UNIT = '(分钟|小时|秒)'

export function isReminderIntent(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /提醒|叫我|闹钟|定时任务|到点.{0,6}(叫|提醒)|稍后.{0,4}记得/.test(t)
}

export function parseReminderRequest(text: string): ReminderToolRequest | null {
  const t = text.trim().replace(/[。！？!?]+$/g, '')
  if (!t) return null

  if (/^(?:看看|查看|列出|有哪些|我有什么)?(?:的)?(?:定时)?(?:任务)?提醒/.test(t) && !/设|设置|叫我|提醒我/.test(t)) {
    return { action: 'list' }
  }
  if (/^(?:把)?(?:提醒|定时任务)(?:都)?(?:取消|删掉|关掉)/.test(t) || /^取消(?:所有)?提醒/.test(t)) {
    const rest = t.replace(/^(?:请)?(?:帮我)?(?:把)?(?:所有)?(?:提醒|定时任务)(?:都)?(?:取消|删掉|关掉)/, '').trim()
    return { action: 'cancel', message: rest || undefined }
  }
  if (/^取消提醒/.test(t)) {
    return { action: 'cancel', message: t.replace(/^取消提醒/, '').trim() || undefined }
  }

  const rel =
    t.match(new RegExp(`^(?:请)?(?:帮我)?${COUNT}\\s*${UNIT}后(?:提醒我|叫我|通知我)(.+)$`)) ||
    t.match(new RegExp(`^(?:请)?(?:帮我)?(?:提醒我|叫我)${COUNT}\\s*${UNIT}后(?:去)?(.+)$`))
  if (rel) {
    const unit = rel[2] === '小时' ? '小时后' : rel[2] === '秒' ? '秒后' : '分钟后'
    const message = rel[3].trim().replace(/^[，,、\s]+/, '')
    if (message) return { action: 'schedule', when: `${rel[1]}${unit}`, message }
  }

  const clock = t.match(
    /^(?:请)?(?:帮我)?(?:在)?(.+?)(?:的时候)?(?:提醒我|叫我)(.+)$/
  )
  if (clock) {
    const when = clock[1].trim()
    const message = clock[2].trim().replace(/^[，,、\s]+/, '')
    try {
      parseReminderTime(when)
      if (message) return { action: 'schedule', when, message }
    } catch {
      // not a time phrase
    }
  }
  return null
}

function fallbackParse(text: string): ReminderToolRequest | null {
  const t = text.trim()
  const rel = t.match(new RegExp(`${COUNT}\\s*${UNIT}后`))
  if (rel) {
    const unit = rel[2] === '小时' ? '小时后' : rel[2] === '秒' ? '秒后' : '分钟后'
    const message = t
      .replace(rel[0], '')
      .replace(/^(?:请)?(?:帮我)?/, '')
      .replace(/提醒我|叫我|通知我/g, '')
      .replace(/[，,。、\s]+/g, ' ')
      .trim()
    if (message) return { action: 'schedule', when: `${rel[1]}${unit}`, message }
  }
  const datePart =
    t.match(/(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号]/)?.[0] ||
    t.match(/\d{4}[./-]\d{1,2}[./-]\d{1,2}/)?.[0] ||
    t.match(/\d{1,2}[./]\d{1,2}/)?.[0] ||
    ''
  const period = t.match(/大后天|后天|明天|今天|下午|晚上|早上|上午|傍晚|中午|凌晨/)?.[0] || ''
  const hm = t.match(/(\d{1,2}[:：]\d{1,2}|\d{1,2}\s*点(?:\d{1,2}\s*分?)?)/)
  if (hm || datePart) {
    const when = `${datePart}${period}${hm?.[0] || ''}`.trim()
    const message = t
      .replace(datePart, '')
      .replace(period, '')
      .replace(hm?.[0] || '', '')
      .replace(/提醒我|叫我|通知我|请|帮我|的时候/g, '')
      .replace(/[，,。、\s]+/g, ' ')
      .trim()
    if (when && message) return { action: 'schedule', when, message }
  }
  return null
}

export function runReminderTool(req: ReminderToolRequest): ReminderToolResult {
  try {
    if (req.action === 'list') {
      const items = listReminders()
      if (!items.length) return { ok: true, message: '现在没有未到点的定时任务。' }
      const lines = items.map((item) => `${formatReminderTime(item.at)}「${item.text}」`)
      return { ok: true, message: `未到点的定时任务：\n${lines.join('\n')}` }
    }
    if (req.action === 'cancel') {
      const items = listReminders()
      if (!items.length) return { ok: false, message: REMINDER_TOOL_FAIL }
      const key = (req.id || req.message || '').trim()
      const target = key
        ? items.find((item) => item.id === key || item.text.includes(key))
        : items[items.length - 1]
      if (!target) return { ok: false, message: REMINDER_TOOL_FAIL }
      dismissReminder(target.id)
      return { ok: true, message: `已取消定时任务：${formatReminderTime(target.at)}「${target.text}」` }
    }
    const when = (req.when || '').trim()
    const message = (req.message || '').trim()
    if (!when || !message) return { ok: false, message: REMINDER_TOOL_FAIL }
    const reminder = scheduleReminder(when, message)
    return {
      ok: true,
      message: `已设定时任务：${formatReminderTime(reminder.at)}「${reminder.text}」。到点会弹出置顶窗口。`,
      reminder
    }
  } catch {
    return { ok: false, message: REMINDER_TOOL_FAIL }
  }
}

export function runReminderToolFromChat(text: string): ReminderToolResult & { fallback?: boolean } {
  const official = parseReminderRequest(text)
  if (official) {
    const result = runReminderTool(official)
    if (result.ok) return result
  }
  return { ok: false, message: REMINDER_TOOL_FAIL }
}

export function tryReminderFallback(text: string): ReminderToolResult {
  const parsed = fallbackParse(text)
  if (!parsed) return { ok: false, message: REMINDER_TOOL_FAIL }
  return runReminderTool(parsed)
}
