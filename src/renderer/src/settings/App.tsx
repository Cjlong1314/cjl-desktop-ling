import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { API_PRESETS } from '../../../shared/types'
import type { PublicSettings } from '../../../shared/types'

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function presetIdFor(url: string): string {
  const matched = API_PRESETS.find((item) => normalizeUrl(item.baseUrl) === normalizeUrl(url))
  return matched?.id || 'custom'
}

function SettingsApp(): React.JSX.Element {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.ling.init().then((payload) => {
      setSettings(payload.settings)
    })
  }, [])

  if (!settings) {
    return <main className="page">正在打开设置…</main>
  }

  const presetId = presetIdFor(settings.baseUrl)

  const saveSettings = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setStatus('')
    try {
      const saved = await window.ling.saveSettings({
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        idleChat: settings.idleChat,
        idleMinutes: settings.idleMinutes
      })
      setSettings(saved)
      setStatus('设置已保存')
    } catch (error) {
      setStatus((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const test = async (): Promise<void> => {
    setBusy(true)
    setStatus('正在测试连接…')
    try {
      const text = await window.ling.testSettings({
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        idleChat: settings.idleChat,
        idleMinutes: settings.idleMinutes
      })
      setStatus(text || '连接成功')
    } catch (error) {
      setStatus((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <header>
        <h1>灵</h1>
        <p>用 OpenAI 兼容接口，或 Cursor 控制台的 crsr_ Key。</p>
      </header>

      <form className="card" onSubmit={saveSettings}>
        <h2>对话接口</h2>
        <label>
          预设
          <select
            value={presetId}
            onChange={(event) => {
              const id = event.target.value
              if (id === 'custom') return
              const preset = API_PRESETS.find((item) => item.id === id)
              if (!preset) return
              setSettings({
                ...settings,
                baseUrl: preset.baseUrl,
                model: preset.model
              })
            }}
          >
            {API_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
            <option value="custom">自定义</option>
          </select>
        </label>
        <label>
          API Key
          <input
            type="password"
            value={settings.apiKey}
            onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })}
            placeholder="粘贴服务商提供的 API Key"
            autoComplete="off"
          />
          <small>
            Cursor 控制台的 Key 以 crsr_ 开头，请选预设「Cursor」。xAI / MiniMax / OpenAI 的 Key 不能混用。
          </small>
        </label>
        <label>
          接口地址
          <input
            value={settings.baseUrl}
            onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })}
            placeholder="https://api.openai.com/v1"
          />
          <small>
            普通接口填到 /v1。选 Cursor 时填 https://api.cursor.com/v1（实际走 Cursor Agent，不是 chat/completions）。
          </small>
        </label>
        <label>
          模型
          <input
            value={settings.model}
            onChange={(event) => setSettings({ ...settings, model: event.target.value })}
            placeholder="grok-4.6、MiniMax-M2、gpt-4o-mini"
          />
          <small>发图片时使用你填的模型。仅 MiniMax 在用 M2 时会自动改用 M3 看图。</small>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.idleChat}
            onChange={(event) => setSettings({ ...settings, idleChat: event.target.checked })}
          />
          空闲时主动轻轻搭话
        </label>
        <label>
          空闲多久后搭话（分钟）
          <input
            type="number"
            min={3}
            value={settings.idleMinutes}
            onChange={(event) =>
              setSettings({ ...settings, idleMinutes: Number(event.target.value) })
            }
          />
        </label>
        <div className="actions">
          <button type="submit" disabled={busy}>
            保存设置
          </button>
          <button type="button" disabled={busy} onClick={() => void test()}>
            测试连接
          </button>
        </div>
      </form>

      {status ? <p className="status">{status}</p> : null}
    </main>
  )
}

export default SettingsApp
