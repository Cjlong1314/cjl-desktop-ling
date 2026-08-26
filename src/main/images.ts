import { nativeImage } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { MAX_CHAT_IMAGES } from '../shared/types'
import type { ChatImageInput } from '../shared/types'
import { projectDataPath } from './store'

const DIR = 'chat-images'
const MAX_SIDE = 1280
const MAX_BYTES = 8 * 1024 * 1024

function folder(): string {
  const dir = projectDataPath('data', DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function isDataUrl(value: string): boolean {
  return value.startsWith('data:image/')
}

function fromDataUrl(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:image\/[\w+.-]+;base64,(.+)$/i)
  if (!match) throw new Error('不是有效的图片')
  return Buffer.from(match[1], 'base64')
}

export function compressToDataUrl(input: ChatImageInput): string {
  let image = nativeImage.createEmpty()
  if (input.path) {
    image = nativeImage.createFromPath(input.path)
  } else if (input.dataUrl) {
    image = nativeImage.createFromBuffer(fromDataUrl(input.dataUrl))
  }
  if (image.isEmpty()) throw new Error('读不了这张图片')
  const size = image.getSize()
  const longSide = Math.max(size.width, size.height)
  if (longSide > MAX_SIDE) {
    const scale = MAX_SIDE / longSide
    image = image.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale))
    })
  }
  let jpeg = image.toJPEG(82)
  if (jpeg.length > MAX_BYTES) jpeg = image.toJPEG(62)
  if (jpeg.length > MAX_BYTES) throw new Error('图片太大了，换一张小一点的')
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`
}

export function prepareImages(inputs: ChatImageInput[]): string[] {
  return inputs.slice(0, MAX_CHAT_IMAGES).map((item) => compressToDataUrl(item))
}

export function persistMessageImages(at: number, images?: string[]): string[] | undefined {
  if (!images?.length) return undefined
  const names = images.map((item, index) => {
    if (!isDataUrl(item)) return item
    const name = `${at}-${index}.jpg`
    writeFileSync(join(folder(), name), fromDataUrl(item))
    return name
  })
  return names
}

export function hydrateMessageImages(images?: string[]): string[] | undefined {
  if (!images?.length) return undefined
  const urls = images
    .map((item) => {
      if (isDataUrl(item)) return item
      const file = join(folder(), item)
      if (!existsSync(file)) return ''
      return `data:image/jpeg;base64,${readFileSync(file).toString('base64')}`
    })
    .filter(Boolean)
  return urls.length ? urls : undefined
}

export function pruneImageFiles(keepNames: string[]): void {
  const dir = folder()
  const keep = new Set(keepNames)
  for (const name of readdirSync(dir)) {
    if (keep.has(name)) continue
    try {
      unlinkSync(join(dir, name))
    } catch {
      // ignore
    }
  }
}
