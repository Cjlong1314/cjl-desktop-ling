import type { AppSettings, ChatMessage, ToolEvent, UserMemory } from '../shared/types'
import { VISION_MODEL } from '../shared/types'
import { personaPrompt } from './memory'
import { executeTool, parseToolArguments, TOOL_DEFINITIONS, toolLabel } from './tools'

interface ChatParams {
  settings: AppSettings
  memory: UserMemory
  history: ChatMessage[]
  userText?: string
  images?: string[]
  extraInstruction?: string
  allowTools?: boolean
  onDelta?: (text: string) => void
  onTool?: (event: ToolEvent) => void
  signal?: AbortSignal
}

interface ExtractedMemory {
  name?: string | null
  occupation?: string | null
  likes?: string[]
  dislikes?: string[]
  routine?: string[]
  facts?: string[]
}

interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string; detail: 'default' }
}

interface ApiMessage {
  role: string
  content?: string | null | ContentPart[]
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

function supportsVision(model: string): boolean {
  const name = model.toLowerCase()
  return name.includes('m3') || name.includes('vl') || name.includes('vision')
}

function modelForRequest(settings: AppSettings, hasImages: boolean): string {
  if (hasImages && !supportsVision(settings.model)) return VISION_MODEL
  return settings.model
}

function buildMessages(params: ChatParams): ApiMessage[] {
  const messages: ApiMessage[] = [{ role: 'system', content: personaPrompt(params.memory) }]
  for (const item of params.history) {
    const text = item.images?.length
      ? item.content?.trim() || '（附图）'
      : item.content
    messages.push({ role: item.role, content: text })
  }
  const userText = params.userText?.trim()
  const images = (params.images || []).filter((item) => item.startsWith('data:image/'))
  if (userText || images.length) {
    const text = userText || '请看看这张图'
    if (images.length) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text },
          ...images.map((url) => ({
            type: 'image_url' as const,
            image_url: { url, detail: 'default' as const }
          }))
        ]
      })
    } else {
      messages.push({ role: 'user', content: text })
    }
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
  images?: boolean
  signal?: AbortSignal
}): Promise<Response> {
  const body: Record<string, unknown> = {
    model: modelForRequest(options.settings, Boolean(options.images)),
    messages: options.messages,
    stream: options.stream,
    temperature: options.tools ? 0.45 : 0.85,
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
  const hasImages = Boolean(params.images?.length)

  if (!allowTools) {
    const response = await requestCompletion({
      settings,
      messages,
      stream: Boolean(params.onDelta),
      images: hasImages,
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

  for (let round = 0; round < 24; round++) {
    const response = await requestCompletion({
      settings,
      messages,
      stream: false,
      tools: true,
      images: hasImages,
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
          content: JSON.stringify(result).slice(0, 50_000)
        })
      }
      continue
    }

    const text = (message?.content || '').trim()
    if (text && params.onDelta) params.onDelta(text)
    return text
  }

  throw new Error('这件事步骤比较多，我先做到这里。你看一下现在的项目，再说要我继续哪一块。')
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
              '你负责从对话里提取需要写入长期记忆的【用户】信息。只返回 JSON，不要 markdown，不要解释。格式：{"name": null或用户称呼, "occupation": null或用户职业, "likes": [], "dislikes": [], "routine": [], "facts": []}。没有新的长期信息就用空数组或 null。只提取用户明确说过、以后仍会用到的事。不要把用户的职业写成灵的职业。不要提取一次性任务。'
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
      occupation: '',
      likes: [],
      dislikes: [],
      routine: [],
      facts: [],
      selfName: '灵',
      selfOccupation: '',
      updatedAt: new Date().toISOString(),
      shortTermMarkdown: ''
    },
    history: [],
    extraInstruction: '只回复四个字：连接成功。'
  })
  return text
}
