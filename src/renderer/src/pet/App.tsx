import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, MouseEvent as ReactMouseEvent } from 'react'
import Live2DView from './Live2DView'
import type { Live2DHandle } from './live2d-types'
import {
  CHAR_SIZE,
  DEFAULT_CHAT_SIZE,
  MAX_CHAT_IMAGES,
  MIN_CHAT_SIZE,
  type CharacterMood,
  type ChatMessage
} from '../../../shared/types'
import './styles.css'

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const HANDLES: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读不了这张图片'))
    reader.readAsDataURL(file)
  })
}

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
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
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

  const layoutReady = useRef(false)
  useEffect(() => {
    if (!layoutReady.current) {
      layoutReady.current = true
      return
    }
    layoutChat(chatOpen)
  }, [chatOpen])

  const ensureChatOpen = (): void => {
    if (!chatOpenRef.current) setChatOpen(true)
  }

  const closeChat = (): void => {
    if (chatOpenRef.current) setChatOpen(false)
    else layoutChat(false)
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
      window.ling.on('chat:open', () => {
        if (chatOpenRef.current) layoutChat(true)
        else setChatOpen(true)
      }),
      window.ling.on('chat:close', () => closeChat()),
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
  }, [visibleMessages, streaming, chatOpen, pendingImages])

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

  const addFiles = async (files: FileList | File[]): Promise<void> => {
    const list = [...files].filter(isImageFile)
    if (!list.length) return
    const room = MAX_CHAT_IMAGES - pendingImages.length
    if (room <= 0) {
      setError(`一次最多发 ${MAX_CHAT_IMAGES} 张图`)
      return
    }
    try {
      const payloads = await Promise.all(
        list.slice(0, room).map(async (file) => {
          const path = window.ling.getFilePath?.(file) || ''
          if (path) return { path }
          return { dataUrl: await readDataUrl(file) }
        })
      )
      const urls = await window.ling.prepareImages(payloads)
      setPendingImages((prev) => [...prev, ...urls].slice(0, MAX_CHAT_IMAGES))
      setError('')
    } catch (err) {
      setError((err as Error).message || '加不上这张图片')
    }
  }

  const send = (event?: FormEvent): void => {
    event?.preventDefault()
    const text = input.trim()
    if ((!text && !pendingImages.length) || busy) return
    const images = pendingImages
    setInput('')
    setPendingImages([])
    setError('')
    void window.ling.sendMessage(text, images)
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
          className={`chat-panel${dragOver ? ' drag-over' : ''}`}
          data-hit="chat"
          style={{
            width: chatSize.width,
            height: chatSize.height,
            maxHeight: `calc(100% - ${CHAR_SIZE.height + 6}px)`
          }}
          onMouseEnter={() => setIgnore(false)}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragOver(false)
            void addFiles(event.dataTransfer.files)
          }}
          onPaste={(event) => {
            const files = [...event.clipboardData.items]
              .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
              .map((item) => item.getAsFile())
              .filter((file): file is File => Boolean(file))
            if (!files.length) return
            event.preventDefault()
            void addFiles(files)
          }}
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
              onClick={() => setChatOpen(false)}
              aria-label="收起"
            >
              收起
            </button>
          </header>
          <div className="chat-list" ref={listRef}>
            {needKey ? (
              <p className="hint">先在设置里填上接口地址、模型和 API Key，我就能陪你聊天了。</p>
            ) : null}
            {visibleMessages.map((msg) => (
              <div key={`${msg.at}-${msg.role}`} className={`bubble ${msg.role}`}>
                {msg.images?.length ? (
                  <div className="bubble-images">
                    {msg.images.map((src, index) => (
                      <img key={`${msg.at}-${index}`} src={src} alt="" />
                    ))}
                  </div>
                ) : null}
                {msg.content}
              </div>
            ))}
            {streaming ? <div className="bubble assistant streaming">{streaming}</div> : null}
            {toolStatus && busy ? <p className="hint tool">{toolStatus}</p> : null}
            {error ? <p className="hint error">{error}</p> : null}
          </div>
          <form className="chat-input" onSubmit={send}>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files)
                event.target.value = ''
              }}
            />
            {pendingImages.length ? (
              <div className="chat-thumbs">
                {pendingImages.map((src, index) => (
                  <span key={`${src.slice(-24)}-${index}`} className="thumb">
                    <img src={src} alt="" />
                    <button
                      type="button"
                      aria-label="去掉这张图"
                      onClick={() =>
                        setPendingImages((prev) => prev.filter((_, i) => i !== index))
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="chat-row">
              <button
                type="button"
                className="attach"
                disabled={busy || pendingImages.length >= MAX_CHAT_IMAGES}
                onClick={() => fileRef.current?.click()}
              >
                图
              </button>
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={busy ? '灵正在想…' : pendingImages.length ? '配一句，或直接发送' : '和灵说点什么'}
                disabled={busy}
              />
              <button type="submit" disabled={busy || (!input.trim() && !pendingImages.length)}>
                发送
              </button>
            </div>
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
