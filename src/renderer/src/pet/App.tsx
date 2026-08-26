import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, MouseEvent as ReactMouseEvent } from 'react'
import Live2DView from './Live2DView'
import type { Live2DHandle } from './live2d-types'
import {
  DEFAULT_CHAT_SIZE,
  MIN_CHAT_SIZE,
  type CharacterMood,
  type ChatMessage
} from '../../../shared/types'
import './styles.css'

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const HANDLES: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function PetApp(): React.JSX.Element {
  const live2dRef = useRef<Live2DHandle>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatSize, setChatSize] = useState(DEFAULT_CHAT_SIZE)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [error, setError] = useState('')
  const [toolStatus, setToolStatus] = useState('')
  const [needKey, setNeedKey] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const draggingRef = useRef(false)
  const dragMoved = useRef(false)
  const chatOpenRef = useRef(false)
  const chatSizeRef = useRef(DEFAULT_CHAT_SIZE)
  const resizingRef = useRef<{
    dir: ResizeDir
    startX: number
    startY: number
    startW: number
    startH: number
  } | null>(null)

  chatOpenRef.current = chatOpen
  chatSizeRef.current = chatSize

  const visibleMessages = useMemo(() => messages.slice(-30), [messages])

  const layoutChat = (
    open: boolean,
    size = chatSizeRef.current,
    growLeft = true,
    growUp = true,
    persist = false
  ): void => {
    window.ling.layoutPet?.({
      open,
      width: size.width,
      height: size.height,
      growLeft,
      growUp,
      persist
    })
  }

  const ensureChatOpen = (): void => {
    if (!chatOpenRef.current) {
      setChatOpen(true)
      layoutChat(true)
    }
  }

  useEffect(() => {
    void window.ling.init().then((payload) => {
      const size = {
        width: payload.settings.chatWidth || DEFAULT_CHAT_SIZE.width,
        height: payload.settings.chatHeight || DEFAULT_CHAT_SIZE.height
      }
      setChatSize(size)
      chatSizeRef.current = size
      setMessages(payload.history)
      setNeedKey(!payload.settings.hasApiKey)
      if (!payload.settings.hasApiKey) {
        setChatOpen(true)
        layoutChat(true, size)
      }
      window.ling.ready()
    })

    const offs = [
      window.ling.on('chat:user', (msg) => {
        setMessages((prev) => [...prev, msg as ChatMessage])
        ensureChatOpen()
        setError('')
        setBusy(true)
        live2dRef.current?.setMood('listen')
      }),
      window.ling.on('chat:start', () => {
        setBusy(true)
        setStreaming('')
        setToolStatus('')
        ensureChatOpen()
      }),
      window.ling.on('chat:chunk', (piece) => {
        setStreaming((prev) => prev + String(piece))
      }),
      window.ling.on('chat:done', (msg) => {
        setMessages((prev) => [...prev, msg as ChatMessage])
        setStreaming('')
        setToolStatus('')
        setBusy(false)
        live2dRef.current?.setMood('idle')
      }),
      window.ling.on('chat:error', (message) => {
        setError(String(message))
        setStreaming('')
        setToolStatus('')
        setBusy(false)
        live2dRef.current?.setMood('idle')
      }),
      window.ling.on('chat:tool', (event) => {
        const tool = event as { label?: string; status?: string; detail?: string }
        if (tool.status === 'error') {
          setToolStatus(tool.detail || tool.label || '这件事没做成')
          return
        }
        setToolStatus(tool.label || '正在处理…')
      }),
      window.ling.on('chat:need-key', () => {
        setNeedKey(true)
        ensureChatOpen()
        setBusy(false)
      }),
      window.ling.on('chat:open', () => ensureChatOpen()),
      window.ling.on('chat:mood', (mood) => {
        live2dRef.current?.setMood(mood as CharacterMood)
      }),
      window.ling.on('settings:updated', (settings) => {
        const hasKey = Boolean((settings as { hasApiKey?: boolean }).hasApiKey)
        setNeedKey(!hasKey)
      })
    ]

    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [visibleMessages, streaming, chatOpen])

  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      const resizing = resizingRef.current
      if (resizing) {
        window.ling.setIgnoreMouse(false)
        const dx = event.screenX - resizing.startX
        const dy = event.screenY - resizing.startY
        let width = resizing.startW
        let height = resizing.startH
        if (resizing.dir.includes('e')) width = resizing.startW + dx
        if (resizing.dir.includes('w')) width = resizing.startW - dx
        if (resizing.dir.includes('s')) height = resizing.startH + dy
        if (resizing.dir.includes('n')) height = resizing.startH - dy
        width = Math.max(MIN_CHAT_SIZE.width, width)
        height = Math.max(MIN_CHAT_SIZE.height, height)
        const next = { width, height }
        setChatSize(next)
        chatSizeRef.current = next
        layoutChat(
          true,
          next,
          resizing.dir.includes('w'),
          resizing.dir.includes('n')
        )
        return
      }
      const target = event.target as HTMLElement | null
      const hit = Boolean(target?.closest?.('[data-hit]'))
      window.ling.setIgnoreMouse(!hit)
    }
    const onUp = (): void => {
      if (resizingRef.current) {
        layoutChat(true, chatSizeRef.current, true, true, true)
        resizingRef.current = null
      }
      if (draggingRef.current) {
        draggingRef.current = false
        window.ling.dragEnd()
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const setIgnore = (ignore: boolean): void => {
    window.ling.setIgnoreMouse(ignore)
  }

  const onCharacterMouseDown = (event: ReactMouseEvent): void => {
    if (event.button !== 0 || resizingRef.current) return
    dragMoved.current = false
    draggingRef.current = true
    window.ling.dragStart()
  }

  const onCharacterClick = (): void => {
    if (dragMoved.current) return
    const next = !chatOpen
    setChatOpen(next)
    layoutChat(next)
    setMenu(null)
  }

  const onContextMenu = (event: ReactMouseEvent): void => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY })
  }

  const startResize = (dir: ResizeDir, event: ReactMouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    resizingRef.current = {
      dir,
      startX: event.screenX,
      startY: event.screenY,
      startW: chatSizeRef.current.width,
      startH: chatSizeRef.current.height
    }
  }

  const send = (event?: FormEvent): void => {
    event?.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setError('')
    void window.ling.sendMessage(text)
  }

  return (
    <div
      className="pet-root"
      onMouseLeave={() => {
        if (!resizingRef.current) setIgnore(true)
        setMenu(null)
      }}
    >
      {chatOpen ? (
        <section
          className="chat-panel"
          data-hit="chat"
          style={{ width: chatSize.width, height: chatSize.height }}
          onMouseEnter={() => setIgnore(false)}
        >
          {HANDLES.map((dir) => (
            <div
              key={dir}
              className={`resize-handle ${dir}`}
              onMouseDown={(event) => startResize(dir, event)}
            />
          ))}
          <header className="chat-head">
            <div>
              <strong>灵</strong>
              <span>随时可以和我说话</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setChatOpen(false)
                layoutChat(false)
              }}
              aria-label="收起"
            >
              收起
            </button>
          </header>
          <div className="chat-list" ref={listRef}>
            {needKey ? (
              <p className="hint">先在设置里填上 MiniMax API Key，我就能陪你聊天了。</p>
            ) : null}
            {visibleMessages.map((msg) => (
              <div key={`${msg.at}-${msg.role}`} className={`bubble ${msg.role}`}>
                {msg.content}
              </div>
            ))}
            {streaming ? <div className="bubble assistant streaming">{streaming}</div> : null}
            {toolStatus && busy ? <p className="hint tool">{toolStatus}</p> : null}
            {error ? <p className="hint error">{error}</p> : null}
          </div>
          <form className="chat-input" onSubmit={send}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={busy ? '灵正在想…' : '和灵说点什么'}
              disabled={busy}
            />
            <button type="submit" disabled={busy || !input.trim()}>
              发送
            </button>
          </form>
        </section>
      ) : null}

      <div
        className="character-hit"
        data-hit="character"
        onMouseEnter={() => setIgnore(false)}
        onMouseDown={onCharacterMouseDown}
        onMouseMove={() => {
          if (draggingRef.current) dragMoved.current = true
        }}
        onClick={onCharacterClick}
      >
        <Live2DView ref={live2dRef} onContextMenu={onContextMenu} />
      </div>

      {menu ? (
        <ul
          className="ctx-menu"
          data-hit="menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseEnter={() => setIgnore(false)}
        >
          <li>
            <button
              type="button"
              onClick={() => {
                ensureChatOpen()
                setMenu(null)
              }}
            >
              打开聊天
            </button>
          </li>
          <li>
            <button type="button" onClick={() => { window.ling.openSettings(); setMenu(null) }}>
              设置
            </button>
          </li>
          <li>
            <button type="button" onClick={() => { window.ling.hidePet(); setMenu(null) }}>
              隐藏
            </button>
          </li>
          <li>
            <button type="button" onClick={() => window.ling.quit()}>
              退出
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  )
}

export default PetApp
