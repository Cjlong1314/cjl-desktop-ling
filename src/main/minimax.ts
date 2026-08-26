import type { AppSettings, ChatMessage, UserMemory } from '../shared/types'
import { personaPrompt } from './memory'

interface ChatParams {
  settings: AppSettings
  memory: UserMemory
  history: ChatMessage[]
  userText?: string
  extraInstruction?: string
  onDelta?: (text: string) => void
  signal?: AbortSignal
}

interface ExtractedMemory {
  name?: string | null
  likes?: string[]
  dislikes?: string[]
  routine?: string[]
  facts?: string[]
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

function buildMessages(params: ChatParams): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: personaPrompt(params.memory) }
  ]
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

export async function chatCompletion(params: ChatParams): Promise<string> {
  const { settings } = params
  if (!settings.apiKey) {
    throw new Error('还没有填写 MiniMax API Key')
  }

  const response = await fetch(`${apiRoot(settings.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: settings.model,
      messages: buildMessages(params),
      stream: Boolean(params.onDelta),
      temperature: 0.85,
      top_p: 0.9,
      reasoning_split: true
    }),
    signal: params.signal
  })

  if (!response.ok) {
    throw new Error(await readError(response))
  }

  if (!params.onDelta) {
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return (data.choices?.[0]?.message?.content || '').trim()
  }

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
          params.onDelta(piece)
        }
      } catch {
        // ignore malformed sse leftovers
      }
    }
  }

  return full.trim()
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
