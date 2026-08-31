import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppSettings,
  ChatImageInput,
  InitPayload,
  PublicSettings,
  UserMemory
} from '../shared/types'

const ling = {
  init: (): Promise<InitPayload> => ipcRenderer.invoke('app:init'),
  getSettings: (): Promise<PublicSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings): Promise<PublicSettings> =>
    ipcRenderer.invoke('settings:save', settings),
  testSettings: (settings: AppSettings): Promise<string> =>
    ipcRenderer.invoke('settings:test', settings),
  cursorCliLogin: (): Promise<{ loggedIn: boolean; account: string }> =>
    ipcRenderer.invoke('cursor:cli-login'),
  cursorCliStatus: (): Promise<{
    loggedIn: boolean
    account: string
    agentPath: string | null
  }> => ipcRenderer.invoke('cursor:cli-status'),
  getMemory: (): Promise<UserMemory> => ipcRenderer.invoke('memory:get'),
  saveMemory: (memory: UserMemory): Promise<UserMemory> =>
    ipcRenderer.invoke('memory:save', memory),
  clearMemory: (): Promise<UserMemory> => ipcRenderer.invoke('memory:clear'),
  openMemoryFolder: (): Promise<void> => ipcRenderer.invoke('memory:open-folder'),
  sendMessage: (text: string, images?: string[]): Promise<void> =>
    ipcRenderer.invoke('chat:send', { text, images }),
  stopChat: (): void => ipcRenderer.send('chat:stop'),
  prepareImages: (items: ChatImageInput[]): Promise<string[]> =>
    ipcRenderer.invoke('images:prepare', items),
  getFilePath: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return (file as File & { path?: string }).path || ''
    }
  },
  setIgnoreMouse: (ignore: boolean): void => ipcRenderer.send('pet:ignore-mouse', ignore),
  dragStart: (): void => ipcRenderer.send('pet:drag-start'),
  dragEnd: (): void => ipcRenderer.send('pet:drag-end'),
  openSettings: (): void => ipcRenderer.send('settings:open'),
  hidePet: (): void => ipcRenderer.send('pet:hide'),
  ready: (): void => ipcRenderer.send('pet:ready'),
  dismissReminder: (id: string): void => ipcRenderer.send('reminder:dismiss', id),
  snoozeReminder: (id: string, minutes = 5): void => ipcRenderer.send('reminder:snooze', id, minutes),
  layoutPet: (payload: {
    open: boolean
    width: number
    height: number
    growLeft?: boolean
    growUp?: boolean
    persist?: boolean
  }): void => ipcRenderer.send('pet:layout', payload),
  quit: (): void => ipcRenderer.send('app:quit'),
  on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
      listener(...args)
    }
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
}

contextBridge.exposeInMainWorld('ling', ling)

export type LingAPI = typeof ling
