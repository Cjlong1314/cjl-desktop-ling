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

type QueuedChat = { id: number; text: string; images: string[] }

const MAX_QUEUE = 8

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
  const isChatWindow = new URLSearchParams(window.location.search).get('mode') === 'chat'
  const live2dRef = useRef<Live2DHandle>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [chatOpen, setChatOpen] = useState(isChatWindow)
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
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([])
  const [queue, setQueue] = useState<QueuedChat[]>([])
  const queueRef = useRef<QueuedChat[]>([])
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
  queueRef.current = queue

  const pumpQueue = (): void => {
    const next = queueRef.current[0]
    if (!next) return
    queueRef.current = queueRef.current.slice(1)
    setQueue(queueRef.current)
    setBusy(true)
    void window.ling.sendMessage(next.text, next.images)
  }

  const visibleMessages = useMemo(() => messages.slice(-30), [messages])

  const layoutChat = (
    open: boolean,
    size = chatSizeRef.current,
    growLeft = true,
    growUp = true,
    persist = false
  ): void => {
    if (isChatWindow) return
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
    if (isChatWindow) return
    if (!layoutReady.current) {
      layoutReady.current = true
      return
    }
    layoutChat(chatOpen)
  }, [chatOpen])

  const ensureChatOpen = (): void => {
    if (isChatWindow) return
    window.ling.openChat()
  }

  const closeChat = (): void => {
    if (isChatWindow) {
      window.ling.hideChat()
      return
    }
    setChatOpen(false)
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
      if (!payload.settings.hasApiKey && isChatWindow) setChatOpen(true)
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
        pumpQueue()
      }),
      window.ling.on('chat:error', (message) => {
        setError(String(message))
        setStreaming('')
        setToolStatus('')
        setBusy(false)
        live2dRef.current?.setMood('idle')
        pumpQueue()
      }),
      window.ling.on('chat:stopped', () => {
        setStreaming('')
        setToolStatus('')
        setBusy(false)
        setError('')
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
        if (!isChatWindow) window.ling.openChat()
      }),
      window.ling.on('chat:close', () => {
        if (isChatWindow) window.ling.hideChat()
      }),
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
  }, [visibleMessages, streaming, chatOpen, pendingImages, queue])

  useEffect(() => {
    if (isChatWindow) return
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
    if (isChatWindow) return
    window.ling.setIgnoreMouse(ignore)
  }

  const onCharacterMouseDown = (event: ReactMouseEvent): void => {
    if (event.button !== 0 || resizingRef.current) return
    dragMoved.current = false
    draggingRef.current = true
    window.ling.dragStart()
  }

  const spawnHeart = (event: ReactMouseEvent): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    const heart = {
      id: Date.now() + Math.random(),
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    }
    setHearts((prev) => [...prev, heart])
    window.setTimeout(() => {
      setHearts((prev) => prev.filter((item) => item.id !== heart.id))
    }, 900)
  }

  const onCharacterClick = (event: ReactMouseEvent): void => {
    if (dragMoved.current) return
    const area = live2dRef.current?.hitAt(event.clientX, event.clientY) ?? 'none'
    live2dRef.current?.pet(area === 'none' ? 'Body' : area)
    if (area === 'Head') {
      spawnHeart(event)
      setMenu(null)
      return
    }
    window.ling.openChat()
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

  const moveQueue = (id: number, dir: -1 | 1): void => {
    setQueue((prev) => {
      const index = prev.findIndex((item) => item.id === id)
      const nextIndex = index + dir
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev
      const next = [...prev]
      const current = next[index]
      const swap = next[nextIndex]
      if (!current || !swap) return prev
      next[index] = swap
      next[nextIndex] = current
      return next
    })
  }

  const send = (event?: FormEvent): void => {
    event?.preventDefault()
    const text = input.trim()
    if (!text && !pendingImages.length) return
    const images = pendingImages
    if (busy) {
      if (queueRef.current.length >= MAX_QUEUE) {
        setError(`最多排队 ${MAX_QUEUE} 句，等灵说完再发`)
        return
      }
      setInput('')
      setPendingImages([])
      setError('')
      setQueue((prev) => [...prev, { id: Date.now() + Math.random(), text, images }])
      return
    }
    setInput('')
    setPendingImages([])
    setError('')
    setBusy(true)
    void window.ling.sendMessage(text, images)
  }

  return (
    <div
      className={`pet-root${isChatWindow ? ' chat-root' : ''}`}
      onMouseLeave={() => {
        if (!isChatWindow && !resizingRef.current) setIgnore(true)
        setMenu(null)
      }}
    >
      {(isChatWindow || chatOpen) ? (
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
              onClick={closeChat}
              aria-label="收起"
            >
              收起
            </button>
          </header>
          <div className="chat-list" ref={listRef}>
            {needKey ? (
              <p className="hint">先在设置里接上对话接口：Cursor 本机登录，或填 API Key。</p>
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
            {queue.length ? (
              <div className="chat-queue">
                <div className="chat-queue-head">排队 {queue.length}</div>
                {queue.map((item, index) => (
                  <div key={item.id} className="chat-queue-item">
                    <span>
                      {item.text || (item.images.length ? '（图片）' : '')}
                    </span>
                    <button
                      type="button"
                      disabled={index === 0}
                      aria-label="上移"
                      onClick={() => moveQueue(item.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index === queue.length - 1}
                      aria-label="下移"
                      onClick={() => moveQueue(item.id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label="去掉"
                      onClick={() => setQueue((prev) => prev.filter((row) => row.id !== item.id))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
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
            <div className="chat-composer">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    send()
                  }
                }}
                placeholder={
                  busy
                    ? '灵在想，下一句会排队'
                    : pendingImages.length
                      ? '配一句，或直接发送'
                      : '和灵说点什么'
                }
                rows={3}
              />
              <div className="chat-toolbar">
                <div className="chat-tools">
                  <button
                    type="button"
                    className="tool-button"
                    aria-label="添加图片"
                    disabled={pendingImages.length >= MAX_CHAT_IMAGES}
                    onClick={() => fileRef.current?.click()}
                  >
                    ▧
                  </button>
                </div>
                <div className="chat-actions">
                  <span className="composer-tip">Enter 发送 · Shift+Enter 换行</span>
                  {busy ? (
                    <button type="button" className="stop" onClick={() => window.ling.stopChat()}>
                      停止
                    </button>
                  ) : (
                    <button type="submit" disabled={!input.trim() && !pendingImages.length}>
                      发送
                    </button>
                  )}
                </div>
              </div>
            </div>
          </form>
        </section>
      ) : null}

      {!isChatWindow ? <div
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
        {hearts.map((heart) => (
          <span key={heart.id} className="pet-heart" style={{ left: heart.x, top: heart.y }}>
            ♥
          </span>
        ))}
      </div> : null}

      {!isChatWindow && menu ? (
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
                window.ling.openChat()
                setMenu(null)
              }}
            >
              打开聊天
            </button>
          </li>
          <li>
            <button type="button" onClick={() => { window.ling.hidePet(); setMenu(null) }}>
              隐藏灵
            </button>
          </li>
          <li>
            <button type="button" onClick={() => { window.ling.openSettings(); setMenu(null) }}>
              设置
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
