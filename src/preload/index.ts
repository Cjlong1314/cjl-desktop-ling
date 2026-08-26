import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, InitPayload, PublicSettings, UserMemory } from '../shared/types'

const ling = {
  init: (): Promise<InitPayload> => ipcRenderer.invoke('app:init'),
  getSettings: (): Promise<PublicSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings): Promise<PublicSettings> =>
    ipcRenderer.invoke('settings:save', settings),
  testSettings: (settings: AppSettings): Promise<string> =>
    ipcRenderer.invoke('settings:test', settings),
  getMemory: (): Promise<UserMemory> => ipcRenderer.invoke('memory:get'),
  saveMemory: (memory: UserMemory): Promise<UserMemory> =>
    ipcRenderer.invoke('memory:save', memory),
  clearMemory: (): Promise<UserMemory> => ipcRenderer.invoke('memory:clear'),
  sendMessage: (text: string): Promise<void> => ipcRenderer.invoke('chat:send', text),
  setIgnoreMouse: (ignore: boolean): void => ipcRenderer.send('pet:ignore-mouse', ignore),
  dragStart: (): void => ipcRenderer.send('pet:drag-start'),
  dragEnd: (): void => ipcRenderer.send('pet:drag-end'),
  openSettings: (): void => ipcRenderer.send('settings:open'),
  hidePet: (): void => ipcRenderer.send('pet:hide'),
  ready: (): void => ipcRenderer.send('pet:ready'),
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
