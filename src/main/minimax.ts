import type { AppSettings, ChatMessage, ToolEvent, UserMemory } from '../shared/types'
import { personaPrompt } from './memory'
import { executeTool, parseToolArguments, TOOL_DEFINITIONS, toolLabel } from './tools'

interface ChatParams {
  settings: AppSettings
  memory: UserMemory
  history: ChatMessage[]
  userText?: string
  extraInstruction?: string
  allowTools?: boolean
  onDelta?: (text: string) => void
  onTool?: (event: ToolEvent) => void
  signal?: AbortSignal
}

interface ExtractedMemory {
  name?: string | null
  likes?: string[]
  dislikes?: string[]
  routine?: string[]
  facts?: string[]
}

interface ApiMessage {
  role: string
  content?: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

interface ToolCall {
  id?: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}

function apiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: { message?: string }; message?: string }
    return data.error?.message || data.message || `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

function buildMessages(params: ChatParams): ApiMessage[] {
  const messages: ApiMessage[] = [{ role: 'system', content: personaPrompt(params.memory) }]
  for (const item of params.history) {
    messages.push({ role: item.role, content: item.content })
  }
  const userText = params.userText?.trim()
  if (userText) {
    messages.push({ role: 'user', content: userText })
  } else if (params.extraInstruction) {
    messages.push({ role: 'user', content: params.extraInstruction })
  } else {
    messages.push({ role: 'user', content: '你好' })
  }
  return messages
}

async function requestCompletion(options: {
  settings: AppSettings
  messages: ApiMessage[]
  stream: boolean
  tools?: boolean
  signal?: AbortSignal
}): Promise<Response> {
  const body: Record<string, unknown> = {
    model: options.settings.model,
    messages: options.messages,
    stream: options.stream,
    temperature: 0.85,
    top_p: 0.9,
    reasoning_split: true
  }
  if (options.tools) {
    body.tools = TOOL_DEFINITIONS
    body.tool_choice = 'auto'
  }
  const response = await fetch(`${apiRoot(options.settings.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.settings.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: options.signal
  })
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return response
}

async function readStream(response: Response, onDelta?: (text: string) => void): Promise<string> {
  if (!response.body) {
    throw new Error('接口没有返回内容')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n')
    buffer = chunks.pop() || ''
    for (const line of chunks) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string | null } }>
        }
        const piece = json.choices?.[0]?.delta?.content
        if (piece) {
          full += piece
          onDelta?.(piece)
        }
      } catch {
        // ignore malformed sse leftovers
      }
    }
  }
  return full.trim()
}

export async function chatCompletion(params: ChatParams): Promise<string> {
  const { settings } = params
  if (!settings.apiKey) {
    throw new Error('还没有填写 MiniMax API Key')
  }

  const messages = buildMessages(params)
  const allowTools = Boolean(params.allowTools && params.userText)

  if (!allowTools) {
    const response = await requestCompletion({
      settings,
      messages,
      stream: Boolean(params.onDelta),
      signal: params.signal
    })
    if (!params.onDelta) {
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      return (data.choices?.[0]?.message?.content || '').trim()
    }
    return readStream(response, params.onDelta)
  }

  for (let round = 0; round < 8; round++) {
    const response = await requestCompletion({
      settings,
      messages,
      stream: false,
      tools: true,
      signal: params.signal
    })
    const data = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string
        message?: { content?: string | null; tool_calls?: ToolCall[] }
      }>
    }
    const message = data.choices?.[0]?.message
    const calls = (message?.tool_calls || []).filter((item) => item.function?.name)
    if (calls.length) {
        messages.push({
          role: 'assistant',
          content: message?.content || '',
          tool_calls: calls.map((item) => ({
            ...item,
            type: item.type || 'function'
          }))
        })
      for (const [index, call] of calls.entries()) {
        const name = call.function?.name || 'unknown'
        const label = toolLabel(name)
        params.onTool?.({ name, label, status: 'running' })
        const result = await executeTool(name, parseToolArguments(call.function?.arguments))
        params.onTool?.({
          name,
          label: result.ok ? result.message : label,
          status: result.ok ? 'done' : 'error',
          detail: result.message
        })
        messages.push({
          role: 'tool',
          tool_call_id: call.id || `call_${index}`,
          content: JSON.stringify(result)
        })
      }
      continue
    }

    const text = (message?.content || '').trim()
    if (text && params.onDelta) params.onDelta(text)
    return text
  }

  throw new Error('这件事步骤有点多，先停一下，你再具体说一次？')
}

export async function extractMemoryPatch(
  settings: AppSettings,
  userText: string,
  assistantText: string
): Promise<ExtractedMemory | null> {
  if (!settings.apiKey) return null
  try {
    const response = await fetch(`${apiRoot(settings.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.1,
        reasoning_split: true,
        messages: [
          {
            role: 'system',
            content:
              '你负责从对话里提取需要长期记住的用户信息。只返回 JSON，不要 markdown，不要解释。格式：{"name": null或称呼字符串, "likes": [], "dislikes": [], "routine": [], "facts": []}。没有新信息就用空数组或 null。只提取用户明确说过的事，不要猜测，不要提取助手自己的话。'
          },
          {
            role: 'user',
            content: `用户：${userText}\n灵：${assistantText}`
          }
        ]
      })
    })
    if (!response.ok) return null
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = data.choices?.[0]?.message?.content || ''
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    return JSON.parse(match[0]) as ExtractedMemory
  } catch {
    return null
  }
}

export async function testConnection(settings: AppSettings): Promise<string> {
  const text = await chatCompletion({
    settings,
    memory: {
      name: '',
      likes: [],
      dislikes: [],
      routine: [],
      facts: [],
      updatedAt: new Date().toISOString()
    },
    history: [],
    extraInstruction: '只回复四个字：连接成功。'
  })
  return text
}
