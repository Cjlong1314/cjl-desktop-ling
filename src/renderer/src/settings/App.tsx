import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { API_PRESETS, modelsForPreset } from '../../../shared/types'
import type { PublicSettings } from '../../../shared/types'

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function presetIdFor(url: string): string {
  const matched = API_PRESETS.find((item) => normalizeUrl(item.baseUrl) === normalizeUrl(url))
  return matched?.id || 'custom'
}

function modelHint(presetId: string, cursorCli: boolean): string {
  if (presetId === 'cursor' && cursorCli) {
    return '本机登录走 IDE 额度，并保持同一条 Agent 会话（和编辑器 Agent 一样）。Grok 4.6 用 cursor-grok-4.6-high-fast。'
  }
  if (presetId === 'cursor') {
    return '控制台 crsr_ Key 走单独额度。Grok 4.6 会按 High 调用（Fast 已关闭）。'
  }
  if (presetId === 'minimax-cn' || presetId === 'minimax-intl') {
    return '可从列表选官方模型，名单没有的可以自己填。发图片建议 MiniMax-M3；若填 M2，会自动改用 M3 看图。'
  }
  return '可从当前服务商的列表里选，也可以自己填写模型名。'
}

function SettingsApp(): React.JSX.Element {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [customModel, setCustomModel] = useState(false)

  useEffect(() => {
    void window.ling.init().then((payload) => {
      setSettings(payload.settings)
    })
  }, [])

  if (!settings) {
    return <main className="page">正在打开设置…</main>
  }

  const presetId = presetIdFor(settings.baseUrl)
  const models = modelsForPreset(presetId)
  const modelListed = models.some((item) => item.id === settings.model)
  const usingCustom = models.length === 0 || customModel || !modelListed

  const payload = {
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
    idleChat: settings.idleChat,
    idleMinutes: settings.idleMinutes,
    cursorCli: Boolean(settings.cursorCli)
  }

  const saveSettings = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setStatus('')
    try {
      const saved = await window.ling.saveSettings(payload)
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
      const text = await window.ling.testSettings(payload)
      setStatus(text || '连接成功')
    } catch (error) {
      setStatus((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const loginCursor = async (): Promise<void> => {
    setBusy(true)
    setStatus('请在浏览器里用和 IDE 同一个 Cursor 账号登录…')
    try {
      const result = await window.ling.cursorCliLogin()
      const saved = await window.ling.saveSettings({ ...payload, cursorCli: true })
      setSettings({
        ...saved,
        cursorCli: true,
        cursorCliLoggedIn: result.loggedIn,
        cursorCliAccount: result.account
      })
      setStatus(result.account ? `已登录 ${result.account}，将使用 IDE 额度` : '已登录，将使用 IDE 额度')
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
        <p>OpenAI 兼容接口、Cursor 本机登录（IDE 额度），或控制台 crsr_ Key。</p>
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
                model: preset.model,
                cursorCli: id === 'cursor' ? settings.cursorCli : false
              })
              setCustomModel(false)
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
        {presetId === 'cursor' ? (
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(settings.cursorCli)}
              onChange={(event) =>
                setSettings({ ...settings, cursorCli: event.target.checked })
              }
            />
            使用本机 Cursor 登录（走 IDE 额度，可用 High Fast）
          </label>
        ) : null}
        {presetId === 'cursor' && settings.cursorCli ? (
          <div className="cli-box">
            <p>
              {settings.cursorCliLoggedIn
                ? `已登录${settings.cursorCliAccount ? `（${settings.cursorCliAccount}）` : ''}，聊天会走 IDE 这笔额度。`
                : settings.cursorAgentFound
                  ? '尚未登录 Cursor CLI。点下面按钮，用和编辑器同一个账号登录。'
                  : '没有找到 Cursor CLI。请先打开一次 Cursor 编辑器后再试。'}
            </p>
            <button type="button" disabled={busy} onClick={() => void loginCursor()}>
              登录 Cursor
            </button>
            <small>不要填 crsr_ 控制台 Key，那是另一笔额度。</small>
          </div>
        ) : (
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
              Cursor 控制台的 Key 以 crsr_ 开头，请选预设「Cursor」并关掉上面的本机登录。xAI / MiniMax / OpenAI 的 Key 不能混用。
            </small>
          </label>
        )}
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
          <span className="field-head">
            模型
            <span className="mode-switch">
              <button
                type="button"
                className={usingCustom ? '' : 'active'}
                disabled={!models.length}
                onClick={() => {
                  const presetModel = API_PRESETS.find((item) => item.id === presetId)?.model
                  const fallback =
                    models.find((item) => item.id === presetModel)?.id || models[0]?.id
                  setCustomModel(false)
                  if (!modelListed && fallback) {
                    setSettings({ ...settings, model: fallback })
                  }
                }}
              >
                可选模型
              </button>
              <button
                type="button"
                className={usingCustom ? 'active' : ''}
                onClick={() => setCustomModel(true)}
              >
                自己填写
              </button>
            </span>
          </span>
          {usingCustom ? (
            <input
              value={settings.model}
              onChange={(event) => setSettings({ ...settings, model: event.target.value })}
              placeholder="例如 MiniMax-M3、grok-4.6、gpt-4o-mini"
            />
          ) : (
            <select
              value={settings.model}
              onChange={(event) => {
                setCustomModel(false)
                setSettings({ ...settings, model: event.target.value })
              }}
            >
              {models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
          <small>{modelHint(presetId, Boolean(settings.cursorCli))}</small>
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
