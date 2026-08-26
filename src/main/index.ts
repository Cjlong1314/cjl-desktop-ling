import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray
} from 'electron'
import { join } from 'path'
import {
  appendHistory,
  clearMemory,
  greetingInstruction,
  loadHistory,
  loadMemory,
  mergeMemory,
  recentHistory,
  saveMemory
} from './memory'
import { chatCompletion, extractMemoryPatch, testConnection } from './minimax'
import { loadSettings, saveChatSize, saveSettings, toPublicSettings } from './store'
import {
  CHAR_SIZE,
  DEFAULT_CHAT_SIZE,
  MIN_CHAT_SIZE,
  type AppSettings,
  type ChatMessage,
  type UserMemory
} from '../shared/types'

let petWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let chatAbort: AbortController | null = null
let lastActivity = Date.now()
let idleTimer: NodeJS.Timeout | null = null
let greeted = false
let dragging = false
let dragOffset = { x: 0, y: 0 }
let dragTimer: NodeJS.Timeout | null = null

function iconPath(): string {
  return join(__dirname, '../../resources/icon.png')
}

function rendererUrl(file: string): string {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}/${file}`
  }
  return join(__dirname, `../renderer/${file}`)
}

function loadRenderer(win: BrowserWindow, file: string): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(rendererUrl(file))
  } else {
    void win.loadFile(rendererUrl(file))
  }
}

function petWindowSize(chatOpen: boolean, chatWidth: number, chatHeight: number): { width: number; height: number } {
  const padX = 16
  const padTop = 8
  const gap = 6
  return {
    width: Math.round(Math.max(chatOpen ? chatWidth : 0, CHAR_SIZE.width) + padX),
    height: Math.round(padTop + (chatOpen ? chatHeight + gap : 0) + CHAR_SIZE.height)
  }
}

function petBounds(): { x: number; y: number; width: number; height: number } {
  const { workArea } = screen.getPrimaryDisplay()
  const settings = loadSettings()
  const size = petWindowSize(
    true,
    settings.chatWidth || DEFAULT_CHAT_SIZE.width,
    settings.chatHeight || DEFAULT_CHAT_SIZE.height
  )
  return {
    ...size,
    x: workArea.x + workArea.width - size.width - 8,
    y: workArea.y + workArea.height - size.height - 8
  }
}

function layoutPetWindow(
  win: BrowserWindow,
  options: {
    open: boolean
    width: number
    height: number
    growLeft?: boolean
    growUp?: boolean
  }
): void {
  const area = screen.getDisplayMatching(win.getBounds()).workArea
  const chatW = Math.min(Math.max(options.width, MIN_CHAT_SIZE.width), area.width - 24)
  const chatH = Math.min(Math.max(options.height, MIN_CHAT_SIZE.height), area.height - CHAR_SIZE.height - 24)
  const size = petWindowSize(options.open, chatW, chatH)
  size.width = Math.min(size.width, area.width)
  size.height = Math.min(size.height, area.height)
  const cur = win.getBounds()
  let x = options.growLeft ? cur.x + cur.width - size.width : cur.x
  let y = options.growUp ? cur.y + cur.height - size.height : cur.y
  x = Math.min(Math.max(area.x, x), area.x + area.width - size.width)
  y = Math.min(Math.max(area.y, y), area.y + area.height - size.height)
  win.setBounds({ x, y, width: size.width, height: size.height })
}

function createPetWindow(): BrowserWindow {
  const bounds = petBounds()
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: iconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      webSecurity: true
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true, { forward: true })

  win.on('ready-to-show', () => {
    if (!quitting) win.showInactive()
  })

  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      win.hide()
    }
  })

  loadRenderer(win, 'pet.html')
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[pet] ${message} (${sourceId}:${line})`)
  })
  return win
}

function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 680,
    show: false,
    autoHideMenuBar: true,
    title: '灵 · 设置',
    icon: iconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    settingsWindow = null
  })
  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadRenderer(win, 'settings.html')
  return win
}

function showSettings(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    settingsWindow = createSettingsWindow()
    return
  }
  settingsWindow.show()
  settingsWindow.focus()
}

function showPet(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    petWindow = createPetWindow()
    return
  }
  petWindow.show()
  petWindow.setAlwaysOnTop(true, 'screen-saver')
}

function sendToPet(channel: string, payload?: unknown): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send(channel, payload)
  }
}

function sendToSettings(channel: string, payload?: unknown): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send(channel, payload)
  }
}

function markActivity(): void {
  lastActivity = Date.now()
}

function broadcastMemory(memory: UserMemory): void {
  sendToPet('memory:updated', memory)
  sendToSettings('memory:updated', memory)
}

async function speak(options: {
  userText?: string
  extraInstruction?: string
  saveUser?: boolean
}): Promise<void> {
  const settings = loadSettings()
  if (!settings.apiKey) {
    sendToPet('chat:need-key')
    showSettings()
    return
  }

  chatAbort?.abort()
  chatAbort = new AbortController()
  const history = recentHistory()
  sendToPet('chat:start', { mood: options.userText ? 'listen' : 'talk' })

  try {
    let full = ''
    sendToPet('chat:mood', 'talk')
    full = await chatCompletion({
      settings,
      memory: loadMemory(),
      history,
      userText: options.userText,
      extraInstruction: options.extraInstruction,
      allowTools: Boolean(options.userText),
      signal: chatAbort.signal,
      onDelta: (text) => sendToPet('chat:chunk', text),
      onTool: (event) => sendToPet('chat:tool', event)
    })

    if (!full) {
      throw new Error('灵好像走神了，一句也没说出来')
    }

    if (options.saveUser && options.userText) {
      appendHistory({ role: 'user', content: options.userText, at: Date.now() })
    }
    const assistant: ChatMessage = { role: 'assistant', content: full, at: Date.now() }
    appendHistory(assistant)
    sendToPet('chat:done', assistant)
    markActivity()

    if (options.userText) {
      const patch = await extractMemoryPatch(settings, options.userText, full)
      if (patch) {
        const next = mergeMemory(loadMemory(), {
          name: patch.name || '',
          likes: patch.likes || [],
          dislikes: patch.dislikes || [],
          routine: patch.routine || [],
          facts: patch.facts || []
        })
        broadcastMemory(next)
      }
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') return
    sendToPet('chat:error', (error as Error).message || '对话失败')
  } finally {
    sendToPet('chat:mood', 'idle')
  }
}

function setupIdleTimer(): void {
  if (idleTimer) clearInterval(idleTimer)
  idleTimer = setInterval(() => {
    const settings = loadSettings()
    if (!settings.idleChat || !settings.apiKey) return
    if (petWindow && petWindow.isDestroyed()) return
    if (petWindow && !petWindow.isVisible()) return
    const wait = Math.max(3, settings.idleMinutes) * 60 * 1000
    if (Date.now() - lastActivity < wait) return
    markActivity()
    void speak({
      extraInstruction:
        '用户已经一段时间没说话了。用一两句轻轻搭话，可以提到时间或已知喜好，不要连续提问，不要说「你还在吗」这种催促。'
    })
  }, 30_000)
}

function createTray(): void {
  const image = nativeImage.createFromPath(iconPath())
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }))
  tray.setToolTip('灵')
  const menu = Menu.buildFromTemplate([
    { label: '显示灵', click: () => showPet() },
    { label: '打开聊天', click: () => { showPet(); sendToPet('chat:open') } },
    { label: '设置', click: () => showSettings() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => showPet())
}

function registerIpc(): void {
  ipcMain.handle('app:init', () => ({
    settings: toPublicSettings(loadSettings()),
    memory: loadMemory(),
    history: loadHistory()
  }))

  ipcMain.handle('settings:get', () => toPublicSettings(loadSettings()))

  ipcMain.handle('settings:save', (_event, next: AppSettings) => {
    const hadKey = Boolean(loadSettings().apiKey)
    const saved = saveSettings(next)
    setupIdleTimer()
    sendToPet('settings:updated', toPublicSettings(saved))
    if (!hadKey && saved.apiKey) {
      greeted = true
      void speak({ extraInstruction: greetingInstruction(loadMemory()) })
    }
    return toPublicSettings(saved)
  })

  ipcMain.handle('settings:test', async (_event, next: AppSettings) => {
    const merged: AppSettings = {
      ...loadSettings(),
      ...next,
      apiKey: next.apiKey || loadSettings().apiKey
    }
    return testConnection(merged)
  })

  ipcMain.handle('memory:get', () => loadMemory())
  ipcMain.handle('memory:save', (_event, memory: UserMemory) => {
    const saved = saveMemory(memory)
    broadcastMemory(saved)
    return saved
  })
  ipcMain.handle('memory:clear', () => {
    const saved = clearMemory()
    broadcastMemory(saved)
    return saved
  })

  ipcMain.handle('chat:send', async (_event, text: string) => {
    const content = String(text || '').trim()
    if (!content) return
    markActivity()
    sendToPet('chat:user', { role: 'user', content, at: Date.now() } satisfies ChatMessage)
    await speak({ userText: content, saveUser: true })
  })

  ipcMain.on(
    'pet:layout',
    (
      event,
      payload: {
        open: boolean
        width: number
        height: number
        growLeft?: boolean
        growUp?: boolean
        persist?: boolean
      }
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return
      layoutPetWindow(win, payload)
      if (payload.persist && payload.open) {
        saveChatSize(payload.width, payload.height)
      }
    }
  )

  ipcMain.on('pet:ignore-mouse', (event, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setIgnoreMouseEvents(Boolean(ignore), { forward: true })
  })

  ipcMain.on('pet:drag-start', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const cursor = screen.getCursorScreenPoint()
    const [x, y] = win.getPosition()
    dragging = true
    dragOffset = { x: cursor.x - x, y: cursor.y - y }
    if (dragTimer) clearInterval(dragTimer)
    dragTimer = setInterval(() => {
      if (!dragging || !win || win.isDestroyed()) return
      const point = screen.getCursorScreenPoint()
      win.setPosition(point.x - dragOffset.x, point.y - dragOffset.y, false)
    }, 16)
  })

  ipcMain.on('pet:drag-end', () => {
    dragging = false
    if (dragTimer) {
      clearInterval(dragTimer)
      dragTimer = null
    }
  })

  ipcMain.on('settings:open', () => showSettings())
  ipcMain.on('pet:show', () => showPet())
  ipcMain.on('pet:hide', () => petWindow?.hide())
  ipcMain.on('pet:ready', () => {
    const settings = loadSettings()
    if (!settings.apiKey) {
      sendToPet('chat:need-key')
      showSettings()
      return
    }
    if (greeted) return
    greeted = true
    void speak({ extraInstruction: greetingInstruction(loadMemory()) })
  })
  ipcMain.on('app:quit', () => {
    quitting = true
    app.quit()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showPet())

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.cjl.desktop.ling')
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpc()
    createTray()
    petWindow = createPetWindow()
    setupIdleTimer()
    markActivity()
  })

  app.on('before-quit', () => {
    quitting = true
  })

  app.on('window-all-closed', () => {
    if (quitting) app.quit()
  })
}
