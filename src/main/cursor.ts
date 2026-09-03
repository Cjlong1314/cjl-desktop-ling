import { spawn } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { net } from 'electron'
import type { AppSettings, PublicSettings, ToolEvent } from '../shared/types'
import { toPublicSettings } from './store'
import { getWorkspace } from './workspace'

export function isCursorKey(apiKey: string): boolean {
  return apiKey.trim().startsWith('crsr_')
}

export function usesCursorCli(settings: { cursorCli?: boolean }): boolean {
  return Boolean(settings.cursorCli)
}

export const CURSOR_QUOTA_ZH =
  'Cursor 额度用完了，我这边暂时接不上。等额度刷新，或打开设置关掉 Cursor CLI、改用 MiniMax。'

export function looksLikeCursorQuota(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return false
  if (/upgrade your plan to continue/i.test(t)) return true
  if (/upgrade your plan/i.test(t) && /continue/i.test(t)) return true
  if (/out of (usage|credits|quota|requests)/i.test(t)) return true
  if (/\b(usage|spend|request) limit\b/i.test(t) && /upgrade|exceed|reached|hit/i.test(t)) return true
  if (/you('ve| have) hit your (usage )?limit/i.test(t)) return true
  if (/free plan.*limit/i.test(t)) return true
  return false
}

export function friendlyCursorReply(text: string): string {
  return looksLikeCursorQuota(text) ? CURSOR_QUOTA_ZH : text
}

export function cursorModelId(model: string): string {
  const raw = model.trim()
  if (!raw) return 'grok-4.6'
  if (/cursor-grok-4\.6/i.test(raw) || /grok[\s-]*4\.6/i.test(raw)) return 'grok-4.6'
  if (/composer/i.test(raw)) return raw
  return raw
}

type ModelParam = { id: string; value: string }

function grok46High(): { id: string; params: ModelParam[] } {
  return {
    id: 'grok-4.6',
    params: [
      { id: 'fast', value: 'false' },
      { id: 'effort', value: 'high' }
    ]
  }
}

async function resolveCursorModel(
  apiKey: string,
  model: string
): Promise<{ id: string; params?: ModelParam[] }> {
  const requested = cursorModelId(model)
  const fallback = /grok-4\.6/i.test(requested) ? grok46High() : { id: requested }
  try {
    const { Cursor } = (await import('@cursor/sdk')) as {
      Cursor: {
        models: {
          list: (options: { apiKey: string }) => Promise<
            Array<{
              id: string
              displayName?: string
              variants?: Array<{ displayName?: string; params?: ModelParam[]; isDefault?: boolean }>
            }>
          >
        }
      }
    }
    const models = await Cursor.models.list({ apiKey: apiKey.trim() })
    const found = models.find(
      (item) =>
        item.id === requested ||
        /grok\s*4\.6/i.test(item.displayName || '') ||
        /grok-4\.6/i.test(item.id)
    )
    if (!found) return fallback
    const variants = found.variants || []
    const high =
      variants.find(
        (item) => /high/i.test(item.displayName || '') && !/fast/i.test(item.displayName || '')
      ) || variants.find((item) => /high/i.test(item.displayName || ''))
    if (high?.params?.length) {
      const params = high.params.map((item) =>
        item.id === 'fast' ? { id: 'fast', value: 'false' } : item
      )
      if (!params.some((item) => item.id === 'fast')) {
        params.push({ id: 'fast', value: 'false' })
      }
      return { id: found.id, params }
    }
    if (/grok-4\.6/i.test(found.id)) return grok46High()
    return { id: found.id }
  } catch {
    return fallback
  }
}

export async function testCursorKey(apiKey: string): Promise<string> {
  const response = await net.fetch('https://api.cursor.com/v1/me', {
    headers: { Authorization: `Bearer ${apiKey.trim()}` }
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(body.slice(0, 400) || `Cursor 接口 HTTP ${response.status}`)
  }
  return '连接成功'
}

function textFromEvent(event: unknown): string {
  const item = event as {
    type?: string
    message?: { content?: Array<{ type?: string; text?: string }> }
  }
  if (item.type !== 'assistant' || !item.message?.content) return ''
  return item.message.content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text || '')
    .join('')
}

type SdkAgent = {
  send: (prompt: string) => Promise<{
    stream: () => AsyncIterable<unknown>
    wait: () => Promise<{
      status?: string
      result?: string
      error?: { message?: string }
    }>
    cancel?: () => Promise<void>
  }>
  [Symbol.asyncDispose]?: () => Promise<void>
}

let sdkAgent: SdkAgent | null = null
let sdkKey = ''
let sdkSeeded = false
let sdkStarting: Promise<void> | null = null

export async function stopCursorSdk(): Promise<void> {
  const agent = sdkAgent
  sdkAgent = null
  sdkKey = ''
  sdkSeeded = false
  sdkStarting = null
  try {
    await agent?.[Symbol.asyncDispose]?.()
  } catch {
    // ignore
  }
}

async function ensureSdkAgent(apiKey: string, model: string): Promise<SdkAgent> {
  const workspace = getWorkspace()
  const key = `${apiKey.trim()}::${model}::${workspace}`
  if (sdkAgent && sdkKey === key) return sdkAgent
  if (sdkStarting) {
    await sdkStarting
    if (sdkAgent && sdkKey === key) return sdkAgent
  }
  const start = (async () => {
    const previous = sdkAgent
    sdkAgent = null
    sdkKey = ''
    sdkSeeded = false
    try {
      await previous?.[Symbol.asyncDispose]?.()
    } catch {
      // ignore
    }
    const { Agent } = (await import('@cursor/sdk')) as {
      Agent: { create: (options: Record<string, unknown>) => Promise<SdkAgent> }
    }
    sdkAgent = await Agent.create({
      apiKey: apiKey.trim(),
      model: await resolveCursorModel(apiKey, model),
      local: { cwd: workspace }
    })
    sdkKey = key
    sdkSeeded = false
  })()
  sdkStarting = start
  try {
    await start
  } finally {
    if (sdkStarting === start) sdkStarting = null
  }
  if (!sdkAgent) throw new Error('Cursor Agent 启动失败')
  return sdkAgent
}

export async function cursorChat(params: {
  apiKey: string
  model: string
  prompt?: string
  persona?: string
  userText?: string
  onDelta?: (text: string) => void
  signal?: AbortSignal
}): Promise<string> {
  const userText = params.userText?.trim() || params.prompt?.trim() || '你好'
  const agent = await ensureSdkAgent(params.apiKey, params.model)
  const prompt =
    !sdkSeeded && params.persona ? `${params.persona}\n\n${userText}` : userText
  const run = await agent.send(prompt)
  let full = ''
  const abort = async (): Promise<void> => {
    try {
      await run.cancel?.()
    } catch {
      // ignore
    }
  }
  if (params.signal?.aborted) {
    await abort()
    throw new Error('已取消')
  }
  params.signal?.addEventListener('abort', () => {
    void abort()
  })
  try {
    for await (const event of run.stream()) {
      if (params.signal?.aborted) break
      const piece = textFromEvent(event)
      if (piece) {
        const next = full + piece
        if (looksLikeCursorQuota(piece) || looksLikeCursorQuota(next)) {
          if (full !== CURSOR_QUOTA_ZH) {
            full = CURSOR_QUOTA_ZH
            params.onDelta?.(CURSOR_QUOTA_ZH)
          }
          continue
        }
        full += piece
        params.onDelta?.(piece)
      }
    }
    const result = await run.wait()
    if (result.status === 'error') {
      throw new Error(friendlyCursorReply(result.error?.message || 'Cursor Agent 运行失败'))
    }
    const text = friendlyCursorReply((result.result || full).trim())
    if (!text) throw new Error('灵好像走神了，一句也没说出来')
    sdkSeeded = true
    return text
  } finally {
    params.signal?.removeEventListener('abort', abort)
  }
}

export function findCursorAgent(): string | null {
  const pathDirs = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')
  const names =
    process.platform === 'win32'
      ? ['agent.cmd', 'cursor-agent.cmd', 'agent.exe', 'cursor-agent.exe']
      : ['agent', 'cursor-agent']
  for (const dir of pathDirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  const versions = join(
    process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'),
    'Cursor',
    'User',
    'globalStorage',
    'anysphere.cursor-agent-worker',
    'agent-cli',
    '.local',
    'share',
    'cursor-agent',
    'versions'
  )
  if (!existsSync(versions)) return null
  const dirs = readdirSync(versions).sort().reverse()
  for (const dir of dirs) {
    const cmd = join(
      versions,
      dir,
      process.platform === 'win32' ? 'cursor-agent.cmd' : 'cursor-agent'
    )
    if (existsSync(cmd)) return cmd
  }
  return null
}

export interface CursorCliStatus {
  loggedIn: boolean
  account: string
  agentPath: string | null
}

let cliStatusCache: { at: number; value: CursorCliStatus } | null = null

export async function getCursorCliStatus(force = false): Promise<CursorCliStatus> {
  const agentPath = findCursorAgent()
  if (!agentPath) {
    return { loggedIn: false, account: '', agentPath: null }
  }
  if (!force && cliStatusCache && Date.now() - cliStatusCache.at < 15_000) {
    return { ...cliStatusCache.value, agentPath }
  }
  try {
    const { stdout } = await runAgent(agentPath, ['status', '--format', 'json'], { timeout: 20_000 })
    const json = JSON.parse(extractJson(stdout) || '{}') as {
      isAuthenticated?: boolean
      status?: string
      email?: string
      userEmail?: string
      account?: string
      userInfo?: { email?: string; firstName?: string }
    }
    const loggedIn = Boolean(json.isAuthenticated) || json.status === 'authenticated'
    const account = json.userInfo?.email || json.email || json.userEmail || json.account || ''
    const value = { loggedIn, account, agentPath }
    cliStatusCache = { at: Date.now(), value }
    return value
  } catch {
    const value = { loggedIn: false, account: '', agentPath }
    cliStatusCache = { at: Date.now(), value }
    return value
  }
}

export async function loginCursorCli(): Promise<CursorCliStatus> {
  const agentPath = findCursorAgent()
  if (!agentPath) {
    throw new Error('没有找到 Cursor CLI。请先安装并打开 Cursor 编辑器。')
  }
  await runAgent(agentPath, ['login'], { timeout: 5 * 60_000 })
  cliStatusCache = null
  const status = await getCursorCliStatus(true)
  if (!status.loggedIn) {
    throw new Error('登录没有完成。请在弹出的浏览器里用和 IDE 同一个 Cursor 账号登录。')
  }
  return status
}

export async function enrichPublicSettings(settings: AppSettings): Promise<PublicSettings> {
  const base = toPublicSettings(settings)
  const agentPath = findCursorAgent()
  if (!settings.cursorCli) {
    return {
      ...base,
      cursorAgentFound: Boolean(agentPath),
      cursorCliLoggedIn: false,
      cursorCliAccount: '',
      hasApiKey: Boolean(settings.apiKey)
    }
  }
  const status = await getCursorCliStatus()
  const loggedIn = status.loggedIn
  return {
    ...base,
    cursorAgentFound: Boolean(status.agentPath || agentPath),
    cursorCliLoggedIn: loggedIn,
    cursorCliAccount: status.account,
    hasApiKey: loggedIn
  }
}

export async function testCursorCli(): Promise<string> {
  const status = await getCursorCliStatus(true)
  if (!status.agentPath) {
    throw new Error('没有找到 Cursor CLI。请先安装并打开 Cursor 编辑器。')
  }
  if (!status.loggedIn) {
    throw new Error('尚未登录。请先点「登录 Cursor」，用和 IDE 同一个账号。')
  }
  return status.account ? `已登录 ${status.account}，将使用 IDE 额度` : '已登录 Cursor，将使用 IDE 额度'
}

export function cursorCliModel(model: string): string {
  const raw = model.trim() || 'cursor-grok-4.6-high-fast'
  const id = raw.replace(/\s*\[.*\]\s*$/, '')
  if (/cursor-grok-4\.6-high-fast/i.test(id)) return 'cursor-grok-4.6-high-fast'
  if (/cursor-grok-4\.6-high$/i.test(id)) return 'cursor-grok-4.6-high'
  if (/grok[\s-]*4\.6/i.test(raw) || /cursor-grok-4\.6/i.test(raw)) {
    if (/fast\s*=\s*false/i.test(raw)) return 'cursor-grok-4.6-high'
    return 'cursor-grok-4.6-high-fast'
  }
  return id
}

let printSessionId = ''

export async function cursorCliChat(params: {
  model: string
  prompt?: string
  persona?: string
  userText?: string
  images?: string[]
  onDelta?: (text: string) => void
  onTool?: (event: ToolEvent) => void
  signal?: AbortSignal
}): Promise<string> {
  const userText = params.userText?.trim() || params.prompt?.trim() || '你好'
  const { acpChat, AcpUnavailableError } = await import('./cursor-acp')
  try {
    return await acpChat({
      model: params.model,
      persona: params.persona,
      userText,
      images: params.images,
      onDelta: params.onDelta,
      onTool: params.onTool,
      signal: params.signal
    })
  } catch (error) {
    if (!(error instanceof AcpUnavailableError)) throw error
    console.warn('[ling] ACP 不可用，回退到一次性 CLI', error.message)
    return printCliChat({
      ...params,
      userText,
      resume: Boolean(printSessionId)
    })
  }
}

async function printCliChat(params: {
  model: string
  persona?: string
  userText: string
  images?: string[]
  resume?: boolean
  onDelta?: (text: string) => void
  onTool?: (event: ToolEvent) => void
  signal?: AbortSignal
}): Promise<string> {
  const agentPath = findCursorAgent()
  if (!agentPath) {
    throw new Error('没有找到 Cursor CLI。请先安装并打开 Cursor 编辑器。')
  }
  const status = await getCursorCliStatus()
  if (!status.loggedIn) {
    throw new Error('尚未登录 Cursor CLI。请在设置里点「登录 Cursor」。')
  }
  const prompt =
    params.resume || !params.persona ? params.userText : `${params.persona}\n\n用户：${params.userText}`
  const args = [
    '-p',
    '--trust',
    '--force',
    '--mode',
    'agent',
    '--output-format',
    'stream-json',
    '--stream-partial-output',
    '--model',
    cursorCliModel(params.model),
    '--workspace',
    getWorkspace()
  ]
  if (params.resume && printSessionId) args.push('--resume', printSessionId)
  args.push('--', prompt)
  let streamed = ''
  let resultText = ''
  const { code, stderr } = await runAgent(agentPath, args, {
    cwd: getWorkspace(),
    signal: params.signal,
    timeout: 8 * 60_000,
    onLine: (line) => {
      const piece = textFromCliLine(line)
      if (piece.sessionId) printSessionId = piece.sessionId
      if (piece.tool) params.onTool?.(piece.tool)
      if (piece.delta && !isReplacementGarbage(piece.delta)) {
        const applied = applyCliDelta(streamed, piece.delta)
        if (looksLikeCursorQuota(applied.next) || looksLikeCursorQuota(applied.emit)) {
          if (streamed !== CURSOR_QUOTA_ZH) {
            streamed = CURSOR_QUOTA_ZH
            params.onDelta?.(CURSOR_QUOTA_ZH)
          }
        } else {
          streamed = applied.next
          if (applied.emit) params.onDelta?.(applied.emit)
        }
      }
      if (piece.result && !isReplacementGarbage(piece.result)) {
        resultText = friendlyCursorReply(piece.result)
      }
    }
  })
  if (code !== 0 && !streamed && !resultText) {
    printSessionId = ''
    throw new Error(friendlyCursorReply(stderr.slice(0, 400) || `Cursor CLI 退出码 ${code}`))
  }
  return friendlyCursorReply((streamed || resultText).trim())
}

function extractJson(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return ''
  return text.slice(start, end + 1)
}

function applyCliDelta(streamed: string, incoming: string): { next: string; emit: string } {
  if (!incoming) return { next: streamed, emit: '' }
  if (!streamed) return { next: incoming, emit: incoming }
  if (incoming === streamed) return { next: streamed, emit: '' }
  if (incoming.startsWith(streamed)) {
    return { next: incoming, emit: incoming.slice(streamed.length) }
  }
  if (streamed.startsWith(incoming)) return { next: streamed, emit: '' }
  return { next: streamed + incoming, emit: incoming }
}

function isReplacementGarbage(text: string): boolean {
  const bad = (text.match(/\uFFFD/g) || []).length
  return bad > 0 && bad / Math.max(text.length, 1) >= 0.4
}

function cliToolLabel(toolCall: Record<string, unknown> | undefined): string {
  if (!toolCall) return '正在处理…'
  if (toolCall.readToolCall) return '正在看文件'
  if (toolCall.writeToolCall || toolCall.editToolCall) return '正在改文件'
  if (toolCall.shellToolCall || toolCall.bashToolCall) return '正在运行命令'
  if (toolCall.grepToolCall || toolCall.globToolCall) return '正在搜索'
  return '正在调用工具'
}

function textFromCliLine(line: string): {
  delta?: string
  result?: string
  tool?: ToolEvent
  sessionId?: string
} {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return {}
  try {
    const event = JSON.parse(trimmed) as {
      type?: string
      subtype?: string
      text?: string
      result?: string
      timestamp_ms?: number
      model_call_id?: string
      session_id?: string
      delta?: { text?: string; content?: string }
      message?: { content?: Array<{ type?: string; text?: string }> }
      tool_call?: Record<string, unknown>
    }
    if (event.subtype === 'thinking') return {}
    if ((event.type === 'system' || event.subtype === 'init') && event.session_id) {
      return { sessionId: event.session_id }
    }
    if (event.type === 'tool_call' || event.type === 'tool') {
      const label = cliToolLabel(event.tool_call)
      if (event.subtype === 'completed') return { tool: { name: 'cli', label, status: 'done' } }
      return { tool: { name: 'cli', label, status: 'running' } }
    }
    if (event.type === 'result' && event.result) return { result: event.result }
    if (typeof event.delta?.text === 'string') return { delta: event.delta.text }
    if (typeof event.delta?.content === 'string') return { delta: event.delta.content }
    if (event.type === 'assistant' && event.message?.content) {
      // stream-partial-output also emits duplicate flushes; only timestamped deltas are new text
      if (event.model_call_id) return {}
      if (event.timestamp_ms == null) return {}
      const text = event.message.content
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text || '')
        .join('')
      if (text) return { delta: text }
    }
    if ((event.type === 'text' || event.type === 'assistant') && event.text) {
      return { delta: event.text }
    }
  } catch {
    // ignore non-json leftovers
  }
  return {}
}

export function resolveAgentLaunch(agentPath: string): { command: string; prefix: string[] } {
  if (process.platform === 'win32' && /\.cmd$/i.test(agentPath)) {
    const dir = dirname(agentPath)
    const node = join(dir, 'node.exe')
    const script = join(dir, 'index.js')
    if (existsSync(node) && existsSync(script)) {
      return { command: node, prefix: [script] }
    }
  }
  return { command: agentPath, prefix: [] }
}

export function agentEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.CURSOR_API_KEY
  env.CURSOR_INVOKED_AS = env.CURSOR_INVOKED_AS || 'cursor-agent'
  return env
}

function runAgent(
  agentPath: string,
  args: string[],
  options: {
    cwd?: string
    signal?: AbortSignal
    timeout?: number
    onLine?: (line: string) => void
  } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const launch = resolveAgentLaunch(agentPath)
    const child = spawn(launch.command, [...launch.prefix, ...args], {
      cwd: options.cwd,
      env: agentEnv(),
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    let lineBuf = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Cursor CLI 超时'))
    }, options.timeout || 30_000)
    const onAbort = (): void => {
      child.kill()
    }
    options.signal?.addEventListener('abort', onAbort)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      if (!options.onLine) return
      lineBuf += chunk
      const lines = lineBuf.split(/\r?\n/)
      lineBuf = lines.pop() || ''
      for (const line of lines) options.onLine(line)
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (options.onLine && lineBuf.trim()) options.onLine(lineBuf)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}
