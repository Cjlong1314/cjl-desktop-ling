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
    model: await resolveCursorModel(params.apiKey, params.model),
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
