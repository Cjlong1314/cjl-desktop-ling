import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { DEFAULT_BASE_URL, INTL_BASE_URL } from '../../../shared/types'
import type { PublicSettings } from '../../../shared/types'

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
        <p>桌面伙伴的对话接口和搭话。</p>
      </header>

      <form className="card" onSubmit={saveSettings}>
        <h2>对话接口</h2>
        <label>
          MiniMax API Key
          <input
            type="password"
            value={settings.apiKey}
            onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })}
            placeholder="粘贴你的 API Key"
            autoComplete="off"
          />
        </label>
        <label>
          接口地址
          <select
            value={
              settings.baseUrl === DEFAULT_BASE_URL || settings.baseUrl === INTL_BASE_URL
                ? settings.baseUrl
                : 'custom'
            }
            onChange={(event) => {
              if (event.target.value === 'custom') return
              setSettings({ ...settings, baseUrl: event.target.value })
            }}
          >
            <option value={DEFAULT_BASE_URL}>国内 https://api.minimaxi.com/v1</option>
            <option value={INTL_BASE_URL}>国际 https://api.minimax.io/v1</option>
          </select>
        </label>
        <label>
          自定义地址
          <input
            value={settings.baseUrl}
            onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })}
          />
        </label>
        <label>
          模型
          <input
            value={settings.model}
            onChange={(event) => setSettings({ ...settings, model: event.target.value })}
            placeholder="MiniMax-M2 或 MiniMax-M3"
          />
          <small>发图片时会自动用 MiniMax-M3 看图。</small>
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
