import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  DEFAULT_BASE_URL,
  DEFAULT_CHAT_SIZE,
  DEFAULT_MODEL,
  type AppSettings,
  type PublicSettings
} from '../shared/types'

const SETTINGS_FILE = 'settings.json'
const KEY_FILE = 'api-key.bin'

interface PersistedSettings {
  baseUrl: string
  model: string
  idleChat: boolean
  idleMinutes: number
  keyEncrypted: boolean
  chatWidth: number
  chatHeight: number
}

const defaults: PersistedSettings = {
  baseUrl: DEFAULT_BASE_URL,
  model: DEFAULT_MODEL,
  idleChat: false,
  idleMinutes: 15,
  keyEncrypted: true,
  chatWidth: DEFAULT_CHAT_SIZE.width,
  chatHeight: DEFAULT_CHAT_SIZE.height
}

function userDir(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function readJson<T>(file: string, fallback: T): T {
  const path = join(userDir(), file)
  if (!existsSync(path)) return fallback
  try {
    return { ...fallback, ...JSON.parse(readFileSync(path, 'utf8')) }
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown): void {
  writeFileSync(join(userDir(), file), JSON.stringify(data, null, 2), 'utf8')
}

function readApiKey(meta: PersistedSettings): string {
  const path = join(userDir(), KEY_FILE)
  if (!existsSync(path)) return ''
  try {
    const raw = readFileSync(path)
    if (!raw.length) return ''
    if (meta.keyEncrypted && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(raw)
    }
    return raw.toString('utf8')
  } catch {
    return ''
  }
}

function writeApiKey(apiKey: string): boolean {
  const path = join(userDir(), KEY_FILE)
  if (!apiKey) {
    writeFileSync(path, Buffer.alloc(0))
    return true
  }
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(path, safeStorage.encryptString(apiKey))
    return true
  }
  writeFileSync(path, Buffer.from(apiKey, 'utf8'))
  return false
}

export function loadSettings(): AppSettings {
  const meta = readJson<PersistedSettings>(SETTINGS_FILE, defaults)
  return {
    apiKey: readApiKey(meta),
    baseUrl: meta.baseUrl || DEFAULT_BASE_URL,
    model: meta.model || DEFAULT_MODEL,
    idleChat: Boolean(meta.idleChat),
    idleMinutes: Number(meta.idleMinutes) || 15,
    chatWidth: Number(meta.chatWidth) || DEFAULT_CHAT_SIZE.width,
    chatHeight: Number(meta.chatHeight) || DEFAULT_CHAT_SIZE.height
  }
}

export function saveSettings(next: AppSettings): AppSettings {
  const prev = readJson<PersistedSettings>(SETTINGS_FILE, defaults)
  const keyEncrypted = writeApiKey(next.apiKey.trim())
  const meta: PersistedSettings = {
    baseUrl: next.baseUrl.trim() || DEFAULT_BASE_URL,
    model: next.model.trim() || DEFAULT_MODEL,
    idleChat: Boolean(next.idleChat),
    idleMinutes: Math.max(3, Number(next.idleMinutes) || 15),
    keyEncrypted,
    chatWidth: Number(next.chatWidth) || prev.chatWidth || DEFAULT_CHAT_SIZE.width,
    chatHeight: Number(next.chatHeight) || prev.chatHeight || DEFAULT_CHAT_SIZE.height
  }
  writeJson(SETTINGS_FILE, meta)
  return loadSettings()
}

export function saveChatSize(width: number, height: number): void {
  const prev = readJson<PersistedSettings>(SETTINGS_FILE, defaults)
  writeJson(SETTINGS_FILE, {
    ...prev,
    chatWidth: Math.round(width),
    chatHeight: Math.round(height)
  })
}

export function toPublicSettings(settings: AppSettings): PublicSettings {
  return {
    hasApiKey: Boolean(settings.apiKey),
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
    idleChat: settings.idleChat,
    idleMinutes: settings.idleMinutes,
    chatWidth: settings.chatWidth || DEFAULT_CHAT_SIZE.width,
    chatHeight: settings.chatHeight || DEFAULT_CHAT_SIZE.height
  }
}

export function dataPath(file: string): string {
  return join(userDir(), file)
}
