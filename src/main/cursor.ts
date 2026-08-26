import { net } from 'electron'
import { getWorkspace } from './workspace'

export function isCursorKey(apiKey: string): boolean {
  return apiKey.trim().startsWith('crsr_')
}

export function cursorModelId(model: string): string {
  const raw = model.trim()
  if (!raw) return 'grok-4.6'
  if (/grok[\s-]*4\.6/i.test(raw)) return 'grok-4.6'
  if (/composer/i.test(raw)) return raw
  return raw
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

export async function cursorChat(params: {
  apiKey: string
  model: string
  prompt: string
  onDelta?: (text: string) => void
  signal?: AbortSignal
}): Promise<string> {
  const { Agent } = (await import('@cursor/sdk')) as {
    Agent: {
      create: (options: Record<string, unknown>) => Promise<{
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
      }>
    }
  }

  const agent = await Agent.create({
    apiKey: params.apiKey.trim(),
    model: { id: cursorModelId(params.model) },
    local: { cwd: getWorkspace() }
  })

  try {
    const run = await agent.send(params.prompt)
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
    for await (const event of run.stream()) {
      if (params.signal?.aborted) break
      const piece = textFromEvent(event)
      if (piece) {
        full += piece
        params.onDelta?.(piece)
      }
    }
    const result = await run.wait()
    if (result.status === 'error') {
      throw new Error(result.error?.message || 'Cursor Agent 运行失败')
    }
    return (result.result || full).trim()
  } finally {
    await agent[Symbol.asyncDispose]?.()
  }
}
