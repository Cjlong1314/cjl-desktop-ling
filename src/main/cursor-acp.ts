import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ToolEvent } from '../shared/types'
import {
  agentEnv,
  cursorCliModel,
  findCursorAgent,
  friendlyCursorReply,
  getCursorCliStatus,
  looksLikeCursorQuota,
  CURSOR_QUOTA_ZH,
  resolveAgentLaunch
} from './cursor'
import { getWorkspace } from './workspace'

export class AcpUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcpUnavailableError'
  }
}

interface RpcMsg {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { message?: string; code?: number }
}

interface PromptPart {
  type: 'text' | 'image'
  text?: string
  data?: string
  mimeType?: string
}

type StreamHandlers = {
  onDelta?: (text: string) => void
  onTool?: (event: ToolEvent) => void
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

let child: ChildProcess | null = null
let nextId = 1
let lineBuf = ''
const pending = new Map<number, Pending>()
let sessionId = ''
let startedModel = ''
let startedWorkspace = ''
let seeded = false
let starting: Promise<void> | null = null
let promptText = ''
let handlers: StreamHandlers = {}

function writeLingRules(workspace: string): void {
  const dir = join(workspace, '.cursor', 'rules')
  const file = join(dir, 'ling.mdc')
  const body = `---
description: 灵桌面伙伴
alwaysApply: true
---

你是「灵」，温柔、轻快的桌面虚拟伙伴。
闲聊用两三句直接回答，不要探索仓库、不要改记忆文件、不要复读人设。
用户明确要求做事时再改文件、跑命令；项目写在当前工作目录。
不要说自己是 AI。不要删除用户没要求删的文件。
`
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, body, 'utf8')
  } catch {
    // ignore
  }
}

function send(method: string, params?: Record<string, unknown>): Promise<unknown> {
  if (!child?.stdin) throw new Error('Cursor Agent 还没准备好')
  const id = nextId++
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
  })
}

function respond(id: number | string, result: unknown): void {
  child?.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function permissionResult(params: Record<string, unknown> | undefined): unknown {
  const options = (params?.options as Array<{ optionId?: string; kind?: string }>) || []
  const always = options.find((item) => /allow-always|allow_always/i.test(item.optionId || item.kind || ''))
  const once = options.find((item) => /allow-once|allow_once|allow/i.test(item.optionId || item.kind || ''))
  const optionId = always?.optionId || once?.optionId || options[0]?.optionId || 'allow-always'
  return { outcome: { outcome: 'selected', optionId } }
}

function toolLabelFromUpdate(update: Record<string, unknown>): string {
  const kind = String(update.kind || update.title || '')
  if (/read|readTool/i.test(kind)) return '正在看文件'
  if (/edit|write|delete/i.test(kind)) return '正在改文件'
  if (/execute|shell|terminal|command/i.test(kind)) return '正在运行命令'
  if (/search|grep|glob/i.test(kind)) return '正在搜索'
  if (update.title) return String(update.title)
  return '正在处理…'
}

function handleUpdate(params: Record<string, unknown> | undefined): void {
  const update = (params?.update || params) as Record<string, unknown> | undefined
  if (!update) return
  const kind = String(update.sessionUpdate || update.type || '')
  if (kind === 'agent_message_chunk' || kind === 'agent_message') {
    const content = update.content as { text?: string; type?: string } | undefined
    const text = content?.text || (typeof update.text === 'string' ? update.text : '')
    if (text) {
      const next = promptText + text
      if (looksLikeCursorQuota(text) || looksLikeCursorQuota(next)) {
        if (promptText !== CURSOR_QUOTA_ZH) {
          promptText = CURSOR_QUOTA_ZH
          handlers.onDelta?.(CURSOR_QUOTA_ZH)
        }
        return
      }
      promptText = next
      handlers.onDelta?.(text)
    }
    return
  }
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const status = kind === 'tool_call_update' && /completed|done/i.test(String(update.status || ''))
      ? 'done'
      : 'running'
    handlers.onTool?.({
      name: 'cli',
      label: toolLabelFromUpdate(update),
      status
    })
  }
}

function handleLine(line: string): void {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return
  let msg: RpcMsg
  try {
    msg = JSON.parse(trimmed) as RpcMsg
  } catch {
    return
  }
  if (msg.id != null && (msg.result !== undefined || msg.error)) {
    const waiter = pending.get(Number(msg.id))
    if (!waiter) return
    pending.delete(Number(msg.id))
    if (msg.error) {
      waiter.reject(new Error(friendlyCursorReply(msg.error.message || 'Cursor Agent 出错')))
    }
    else waiter.resolve(msg.result)
    return
  }
  if (msg.method === 'session/update') {
    handleUpdate(msg.params)
    return
  }
  if (msg.method === 'session/request_permission' && msg.id != null) {
    respond(msg.id, permissionResult(msg.params))
    return
  }
  if (msg.method === 'cursor/ask_question' && msg.id != null) {
    respond(msg.id, { outcome: { outcome: 'skipped', reason: '灵先按自己的判断继续' } })
    return
  }
  if (msg.method === 'cursor/create_plan' && msg.id != null) {
    respond(msg.id, { outcome: { outcome: 'accepted' } })
    return
  }
}

function attach(proc: ChildProcess): void {
  proc.stdout?.setEncoding('utf8')
  proc.stderr?.setEncoding('utf8')
  proc.stdout?.on('data', (chunk: string) => {
    lineBuf += chunk
    const lines = lineBuf.split(/\r?\n/)
    lineBuf = lines.pop() || ''
    for (const line of lines) handleLine(line)
  })
  proc.stderr?.on('data', (chunk: string) => {
    const text = chunk.trim()
    if (text) console.warn('[ling-acp]', text.slice(0, 500))
  })
  proc.on('exit', () => {
    if (child === proc) {
      child = null
      sessionId = ''
      seeded = false
      for (const waiter of pending.values()) waiter.reject(new Error('Cursor Agent 已退出'))
      pending.clear()
    }
  })
}

export function stopCursorAcp(): void {
  const proc = child
  child = null
  sessionId = ''
  seeded = false
  startedModel = ''
  startedWorkspace = ''
  starting = null
  for (const waiter of pending.values()) waiter.reject(new Error('已关闭'))
  pending.clear()
  try {
    proc?.kill()
  } catch {
    // ignore
  }
}

async function boot(model: string, workspace: string): Promise<void> {
  const agentPath = findCursorAgent()
  if (!agentPath) throw new AcpUnavailableError('没有找到 Cursor CLI。请先安装并打开 Cursor 编辑器。')
  const status = await getCursorCliStatus()
  if (!status.loggedIn) throw new AcpUnavailableError('尚未登录 Cursor CLI。请在设置里点「登录 Cursor」。')
  if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true })
  writeLingRules(workspace)

  const launch = resolveAgentLaunch(agentPath)
  const proc = spawn(launch.command, [...launch.prefix, '--model', model, 'acp'], {
    cwd: workspace,
    env: agentEnv(),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child = proc
  nextId = 1
  lineBuf = ''
  attach(proc)

  const ready = Promise.race([
    (async () => {
      await send('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false
        },
        clientInfo: { name: 'ling', version: '1.0.0' }
      })
      try {
        await send('authenticate', { methodId: 'cursor_login' })
      } catch {
        // already logged in
      }
      const created = (await send('session/new', {
        cwd: workspace,
        mcpServers: []
      })) as { sessionId?: string; session_id?: string }
      sessionId = created.sessionId || created.session_id || ''
      if (!sessionId) throw new Error('Cursor Agent 没有返回会话')
      try {
        await send('session/set_mode', { sessionId, modeId: 'agent' })
      } catch {
        // older CLI without set_mode
      }
    })(),
    new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Cursor Agent 启动超时')), 40_000)
    })
  ])

  try {
    await ready
  } catch (error) {
    stopCursorAcp()
    throw new AcpUnavailableError((error as Error).message || 'Cursor Agent 启动失败')
  }
  startedModel = model
  startedWorkspace = workspace
  seeded = false
}

async function ensure(model: string, workspace: string): Promise<void> {
  if (child && startedModel === model && startedWorkspace === workspace && sessionId) return
  if (starting) {
    await starting
    if (child && startedModel === model && startedWorkspace === workspace && sessionId) return
  }
  stopCursorAcp()
  starting = boot(model, workspace)
  try {
    await starting
  } finally {
    starting = null
  }
}

function promptParts(text: string, images?: string[]): PromptPart[] {
  const parts: PromptPart[] = [{ type: 'text', text }]
  for (const src of images || []) {
    const match = src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
    if (!match) continue
    parts.push({ type: 'image', mimeType: match[1], data: match[2] })
  }
  return parts
}

export async function acpChat(params: {
  model: string
  persona?: string
  userText: string
  images?: string[]
  onDelta?: (text: string) => void
  onTool?: (event: ToolEvent) => void
  signal?: AbortSignal
}): Promise<string> {
  const model = cursorCliModel(params.model)
  const workspace = getWorkspace()
  try {
    await ensure(model, workspace)
  } catch (error) {
    if (error instanceof AcpUnavailableError) throw error
    throw new AcpUnavailableError((error as Error).message || 'Cursor Agent 启动失败')
  }

  const needsSeed = !seeded
  const text =
    needsSeed && params.persona
      ? `${params.persona}\n\n${params.userText}`
      : params.userText
  promptText = ''
  handlers = { onDelta: params.onDelta, onTool: params.onTool }

  const onAbort = (): void => {
    void send('session/cancel', { sessionId }).catch(() => undefined)
  }
  if (params.signal?.aborted) {
    onAbort()
    throw new Error('已取消')
  }
  params.signal?.addEventListener('abort', onAbort)

  try {
    const result = (await send('session/prompt', {
      sessionId,
      prompt: promptParts(text, params.images)
    })) as { stopReason?: string }
    if (params.signal?.aborted) throw new Error('已取消')
    if (result?.stopReason === 'cancelled') throw new Error('已取消')
    const out = friendlyCursorReply(promptText.trim())
    if (!out) throw new Error('灵好像走神了，一句也没说出来')
    seeded = true
    return out
  } finally {
    params.signal?.removeEventListener('abort', onAbort)
    handlers = {}
  }
}
