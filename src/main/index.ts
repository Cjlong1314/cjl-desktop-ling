import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  screen,
  shell,
  Tray
} from 'electron'
import { join } from 'path'
import {
  appendHistory,
  appendShortTerm,
  clearMemory,
  greetingInstruction,
  loadHistory,
  loadMemory,
  memoryDir,
  mergeMemory,
  saveMemory
} from './memory'
import { chatCompletion, extractMemoryPatch, testConnection, resetChatSession } from './minimax'
import { loadSettings, saveChatSize, saveSettings } from './store'
import {
  enrichPublicSettings,
  loginCursorCli,
  getCursorCliStatus,
  usesCursorCli,
  stopCursorSdk
} from './cursor'
import { stopCursorAcp } from './cursor-acp'
import {
  CHAR_SIZE,
  DEFAULT_CHAT_SIZE,
  MIN_CHAT_SIZE,
  type AppSettings,
  type ChatImageInput,
  type ChatMessage,
  type UserMemory
} from '../shared/types'
import { prepareImages } from './images'
import {
  scheduleReminder,
  setReminderHandler,
  startReminders,
  type Reminder
} from './reminders'

let petWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
const reminderWindows = new Map<string, BrowserWindow>()
const reminderTexts = new Map<string, string>()
let chatAbort: AbortController | null = null
let lastActivity = Date.now()
let idleTimer: NodeJS.Timeout | null = null
let greeted = false
let dragging = false
let dragOffset = { x: 0, y: 0 }
let dragTimer: NodeJS.Timeout | null = null
let cursorTimer: NodeJS.Timeout | null = null

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

function petBounds(chatOpen = false): { x: number; y: number; width: number; height: number } {
  const { workArea } = screen.getPrimaryDisplay()
  const settings = loadSettings()
  const size = petWindowSize(
    chatOpen,
    settings.chatWidth || DEFAULT_CHAT_SIZE.width,
    settings.chatHeight || DEFAULT_CHAT_SIZE.height
  )
  return {
    ...size,
    x: workArea.x + workArea.width - size.width - 8,
    y: workArea.y + workArea.height - size.height - 8
  }
}

function sanePosition(
  x: number,
  y: number,
  width: number,
  height: number,
  area: Electron.Rectangle
): { x: number; y: number } {
  const visible =
    x > -1000 &&
    y > -1000 &&
    x + width > area.x + 40 &&
    y + height > area.y + 40 &&
    x < area.x + area.width - 40 &&
    y < area.y + area.height - 40
  if (!visible) {
    return {
      x: area.x + area.width - width - 8,
      y: area.y + area.height - height - 8
    }
  }
  return {
    x: Math.min(Math.max(area.x, x), area.x + area.width - width),
    y: Math.min(Math.max(area.y, y), area.y + area.height - height)
  }
}

function applyPetBounds(win: BrowserWindow, width: number, height: number, area: Electron.Rectangle): void {
  const targetW = Math.max(Math.round(width), CHAR_SIZE.width)
  const targetH = Math.max(Math.round(height), CHAR_SIZE.height)
  const cur = win.getBounds()
  const right = cur.x + cur.width
  const bottom = cur.y + cur.height

  win.setResizable(true)
  win.setMinimumSize(1, 1)
  win.setSize(targetW, targetH, false)
  win.setContentSize(targetW, targetH, false)

  const actual = win.getBounds()
  const placed = sanePosition(
    right - actual.width,
    bottom - actual.height,
    actual.width,
    actual.height,
    area
  )
  win.setPosition(placed.x, placed.y, false)
  win.setResizable(false)
  win.setMinimumSize(CHAR_SIZE.width, CHAR_SIZE.height)
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
  const maxChatH = Math.max(MIN_CHAT_SIZE.height, area.height - CHAR_SIZE.height - 24)
  const chatW = Math.min(Math.max(options.width, MIN_CHAT_SIZE.width), area.width - 24)
  const chatH = Math.min(Math.max(options.height, MIN_CHAT_SIZE.height), maxChatH)
  const size = petWindowSize(options.open, chatW, chatH)
  size.width = Math.min(size.width, area.width)
  size.height = Math.min(size.height, area.height)
  applyPetBounds(win, size.width, size.height, area)
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

function showPet(options?: { chat?: boolean }): void {
  if (!petWindow || petWindow.isDestroyed()) {
    petWindow = createPetWindow()
  }
  const win = petWindow
  win.show()
  win.setAlwaysOnTop(true, 'screen-saver')
  if (options && 'chat' in options) {
    sendToPet(options.chat ? 'chat:open' : 'chat:close')
  }
  win.show()
  win.moveTop()
}

function sendToPet(channel: string, payload?: unknown): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send(channel, payload)
  }
}

function startCursorBroadcast(): void {
  if (cursorTimer) return
  cursorTimer = setInterval(() => {
    const win = petWindow
    if (!win || win.isDestroyed() || dragging || !win.isVisible()) return
    const cursor = screen.getCursorScreenPoint()
    const bounds = win.getContentBounds()
    win.webContents.send('pet:cursor', {
      x: cursor.x - bounds.x,
      y: cursor.y - bounds.y
    })
  }, 40)
}

function stopCursorBroadcast(): void {
  if (!cursorTimer) return
  clearInterval(cursorTimer)
  cursorTimer = null
}

function closeReminderWindow(id: string): void {
  const win = reminderWindows.get(id)
  if (win && !win.isDestroyed()) win.close()
  reminderWindows.delete(id)
  reminderTexts.delete(id)
}

function showReminderPopup(reminder: Reminder): void {
  reminderTexts.set(reminder.id, reminder.text)
  const { workArea } = screen.getPrimaryDisplay()
  const width = 400
  const height = 230
  const offset = reminderWindows.size * 18
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + workArea.width - width - 20 - offset),
    y: Math.round(workArea.y + workArea.height - height - 20 - offset),
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
      nodeIntegration: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  reminderWindows.set(reminder.id, win)
  win.on('closed', () => {
    reminderWindows.delete(reminder.id)
  })
  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.webContents.send('reminder:payload', { id: reminder.id, text: reminder.text })
    win.show()
    win.moveTop()
  })
  loadRenderer(win, 'reminder.html')
  try {
    shell.beep()
  } catch {
    // ignore
  }
  if (Notification.isSupported()) {
    const note = new Notification({
      title: '灵',
      body: reminder.text,
      icon: iconPath(),
      silent: false
    })
    note.on('click', () => {
      if (!win.isDestroyed()) {
        win.show()
        win.moveTop()
      }
      showPet({ chat: true })
    })
    note.show()
  }
}

function fireReminder(reminder: Reminder): void {
  showPet({ chat: true })
  showReminderPopup(reminder)
  const assistant: ChatMessage = {
    role: 'assistant',
    content: `⏰ ${reminder.text}`,
    at: Date.now()
  }
  appendHistory(assistant)
  sendToPet('chat:done', assistant)
}

function sendToSettings(channel: string, payload?: unknown): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send(channel, payload)
  }
}

function markActivity(): void {
  lastActivity = Date.now()
}

function resetAllChatSessions(): void {
  resetChatSession()
  stopCursorAcp()
  void stopCursorSdk()
}

function broadcastMemory(memory: UserMemory): void {
  sendToPet('memory:updated', memory)
  sendToSettings('memory:updated', memory)
}

async function speak(options: {
  userText?: string
  images?: string[]
  extraInstruction?: string
  saveUser?: boolean
}): Promise<void> {
  const settings = loadSettings()
  if (usesCursorCli(settings)) {
    const status = await getCursorCliStatus()
    if (!status.loggedIn) {
      sendToPet('chat:need-key')
      showSettings()
      return
    }
  } else if (!settings.apiKey) {
    sendToPet('chat:need-key')
    showSettings()
    return
  }

  chatAbort?.abort()
  chatAbort = new AbortController()
  sendToPet('chat:start', { mood: options.userText ? 'listen' : 'talk' })

  try {
    let full = ''
    sendToPet('chat:mood', 'talk')
    full = await chatCompletion({
      settings,
      memory: loadMemory(),
      history: loadHistory(),
      userText: options.userText,
      images: options.images,
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
      appendHistory({
        role: 'user',
        content: options.userText,
        at: Date.now(),
        images: options.images
      })
    }
    const assistant: ChatMessage = { role: 'assistant', content: full, at: Date.now() }
    appendHistory(assistant)
    sendToPet('chat:done', assistant)
    markActivity()

    if (options.userText) {
      appendShortTerm(options.userText, full, Boolean(options.images?.length))
      const patch = await extractMemoryPatch(settings, options.userText, full)
      if (patch) {
        mergeMemory(loadMemory(), {
          name: patch.name || '',
          occupation: patch.occupation || '',
          likes: patch.likes || [],
          dislikes: patch.dislikes || [],
          routine: patch.routine || [],
          facts: patch.facts || []
        })
      }
      broadcastMemory(loadMemory())
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
    if (!settings.idleChat) return
    if (!settings.cursorCli && !settings.apiKey) return
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
    { label: '打开聊天', click: () => showPet({ chat: true }) },
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
  tray.on('double-click', () => showPet({ chat: true }))
}

function registerIpc(): void {
  ipcMain.handle('app:init', async () => ({
    settings: await enrichPublicSettings(loadSettings()),
    memory: loadMemory(),
    history: loadHistory()
  }))

  ipcMain.handle('settings:get', () => enrichPublicSettings(loadSettings()))

  ipcMain.handle('settings:save', async (_event, next: AppSettings) => {
    const previous = loadSettings()
    const saved = saveSettings(next)
    setupIdleTimer()
    if (
      previous.apiKey !== saved.apiKey ||
      previous.baseUrl !== saved.baseUrl ||
      previous.model !== saved.model ||
      Boolean(previous.cursorCli) !== Boolean(saved.cursorCli)
    ) {
      resetAllChatSessions()
    }
    const publicSettings = await enrichPublicSettings(saved)
    sendToPet('settings:updated', publicSettings)
    const becameReady =
      (!previous.apiKey && !previous.cursorCli && (saved.apiKey || saved.cursorCli)) ||
      (!previous.cursorCli && saved.cursorCli && publicSettings.cursorCliLoggedIn)
    if (becameReady && publicSettings.hasApiKey && loadHistory().length === 0) {
      greeted = true
      void speak({ extraInstruction: greetingInstruction(loadMemory()) })
    }
    return publicSettings
  })

  ipcMain.handle('settings:test', async (_event, next: AppSettings) => {
    const merged: AppSettings = {
      ...loadSettings(),
      ...next,
      apiKey: next.apiKey || loadSettings().apiKey,
      cursorCli: Boolean(next.cursorCli)
    }
    try {
      return await testConnection(merged)
    } catch (error) {
      throw new Error((error as Error).message || '测试连接失败')
    }
  })

  ipcMain.handle('memory:get', () => loadMemory())
  ipcMain.handle('memory:save', (_event, memory: UserMemory) => {
    const saved = saveMemory(memory)
    broadcastMemory(saved)
    return saved
  })
  ipcMain.handle('memory:clear', () => {
    const saved = clearMemory()
    resetAllChatSessions()
    broadcastMemory(saved)
    return saved
  })
  ipcMain.handle('memory:open-folder', async () => {
    const err = await shell.openPath(memoryDir())
    if (err) throw new Error(err)
  })

  ipcMain.handle('images:prepare', (_event, items: ChatImageInput[]) => {
    return prepareImages(Array.isArray(items) ? items : [])
  })

  ipcMain.handle('chat:send', async (_event, payload: string | { text?: string; images?: string[] }) => {
    const text = (typeof payload === 'string' ? payload : String(payload?.text || '')).trim()
    const images = typeof payload === 'string' ? [] : (payload?.images || []).filter(Boolean)
    if (!text && !images.length) return
    const content = text || '请看看这张图'
    markActivity()
    sendToPet('chat:user', {
      role: 'user',
      content,
      at: Date.now(),
      images: images.length ? images : undefined
    } satisfies ChatMessage)
    await speak({ userText: content, images: images.length ? images : undefined, saveUser: true })
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
  ipcMain.on('reminder:dismiss', (_event, id: string) => {
    closeReminderWindow(String(id || ''))
  })
  ipcMain.on('reminder:snooze', (_event, id: string, minutes: number) => {
    const key = String(id || '')
    const text = reminderTexts.get(key) || ''
    closeReminderWindow(key)
    if (text) scheduleReminder(`${Math.max(1, Number(minutes) || 5)}分钟后`, text)
  })
  ipcMain.handle('cursor:cli-status', () => getCursorCliStatus(true))
  ipcMain.handle('cursor:cli-login', () => loginCursorCli())

  ipcMain.on('pet:ready', () => {
    void (async () => {
      const settings = loadSettings()
      if (usesCursorCli(settings)) {
        const status = await getCursorCliStatus()
        if (!status.loggedIn) {
          sendToPet('chat:need-key')
          showSettings()
          return
        }
      } else if (!settings.apiKey) {
        sendToPet('chat:need-key')
        showSettings()
        return
      }
      if (greeted) return
      greeted = true
      void speak({ extraInstruction: greetingInstruction(loadMemory()) })
    })()
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
    startCursorBroadcast()
    setReminderHandler(fireReminder)
    startReminders()
    setupIdleTimer()
    markActivity()
  })

  app.on('before-quit', () => {
    quitting = true
    stopCursorBroadcast()
    resetAllChatSessions()
  })

  app.on('window-all-closed', () => {
    if (quitting) app.quit()
  })
}
