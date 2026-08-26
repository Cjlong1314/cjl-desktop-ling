import { app, shell } from 'electron'
import { execFile } from 'child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'fs'
import { homedir, tmpdir } from 'os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'path'
import { promisify } from 'util'
import { getWorkspace, remapLegacyPath, setWorkspace } from './workspace'

const execFileAsync = promisify(execFile)

export interface ToolResult {
  ok: boolean
  message: string
  files?: string[]
  pdfs?: string[]
  content?: string
}

const OFFICE_EXT = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'])
const TEXT_EXT = new Set([
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.tsv',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.css',
  '.html',
  '.xml',
  '.yml',
  '.yaml',
  '.ini',
  '.log',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.rs',
  '.go',
  '.sql',
  '.bat',
  '.ps1',
  '.sh',
  '.vue',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.toml',
  '.lock',
  '.jsonc',
  '.scss',
  '.less',
  '.kt',
  '.swift',
  '.php',
  '.rb',
  '.cs',
  '.rtf'
])
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'out', '$recycle.bin', 'system volume information'])
const MAX_READ = 100_000
const MAX_LIST = 200
const MAX_FIND = 80
const MAX_SEARCH = 40

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        '列出某个文件夹里的文件和子文件夹。path 可以是完整路径，或 desktop/documents/downloads/桌面/文档/下载。不传 path 时列出当前工作目录。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件夹路径，默认当前工作目录' },
          extension: { type: 'string', description: '可选扩展名，如 doc、pdf，不带点' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        '读取任意位置的文本文件内容。改文件、总结、翻译前先读。Office 二进制请改用 convert_to_pdf，不要硬读。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件完整路径或文件名' },
          offset: { type: 'number', description: '从第几行开始，从 1 计，可选' },
          limit: { type: 'number', description: '最多读多少行，可选' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '把内容写入任意位置的文件。文件不存在会新建，已存在会覆盖。适合生成新文件或整篇重写。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要写入的文件路径' },
          content: { type: 'string', description: '文件全文' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replace_in_file',
      description: '在已有文件里精确替换一段文字。old_text 必须在文件中独一无二，除非 replace_all 为 true。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_text: { type: 'string' },
          new_text: { type: 'string' },
          replace_all: { type: 'boolean' }
        },
        required: ['path', 'old_text', 'new_text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_files',
      description: '按文件名关键词或通配符查找文件。path 是搜索起点，可以是任意文件夹。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '文件名关键词或 *.pdf、报告.docx' },
          path: { type: 'string', description: '搜索起点，默认当前工作目录' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_in_files',
      description: '在文件夹里搜索文件内容（类似 grep）。适合在代码或文档里找某一段字。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要找的文本' },
          path: { type: 'string', description: '搜索起点文件夹或单个文件，默认当前工作目录' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'copy_file',
      description: '复制文件到新位置。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' }
        },
        required: ['from', 'to']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_directory',
      description: '创建文件夹，中间目录不存在会一并创建。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'convert_to_pdf',
      description:
        '把任意位置的 Word/Excel/PPT 转成 PDF，保存在源文件旁边。可给完整路径，或文件夹 + pattern（如 *.doc*）。需要 Microsoft Office 或 LibreOffice。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '单个文件路径' },
          folder: { type: 'string', description: '文件夹路径或 desktop/documents/downloads' },
          pattern: { type: 'string', description: '如 *.docx' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_path',
      description: '用系统默认程序打开任意文件或文件夹。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_workspace',
      description: '查看当前项目工作目录。run_command 默认在这里执行。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_workspace',
      description: '把当前项目工作目录切到指定文件夹。创建或打开项目后应立刻调用。之后的相对路径和命令都在这里执行。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '项目根目录的完整路径' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        '在工作目录运行本机命令，用来安装依赖、启动检查、初始化项目。例如 npm install、npm run build、python -m venv、git status。必须用非交互参数（-y、--yes）。不要用于删除系统或格式化磁盘。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令' },
          cwd: { type: 'string', description: '可选，工作目录，默认当前 workspace' },
          timeout_seconds: { type: 'number', description: '超时秒数，默认 180，最大 600' }
        },
        required: ['command']
      }
    }
  }
]

export function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    list_files: '正在查看文件…',
    read_file: '正在读文件…',
    write_file: '正在写文件…',
    replace_in_file: '正在改文件…',
    find_files: '正在查找文件…',
    search_in_files: '正在搜索内容…',
    copy_file: '正在复制文件…',
    create_directory: '正在创建文件夹…',
    convert_to_pdf: '正在转换成 PDF…',
    open_path: '正在打开…',
    get_workspace: '正在查看工作目录…',
    set_workspace: '正在切换工作目录…',
    run_command: '正在运行命令…'
  }
  return labels[name] || '正在处理…'
}

function aliasPath(input: string): string {
  const text = input.trim().replace(/^["']|["']$/g, '')
  const map: Record<string, string> = {
    desktop: app.getPath('desktop'),
    桌面: app.getPath('desktop'),
    documents: app.getPath('documents'),
    文档: app.getPath('documents'),
    downloads: app.getPath('downloads'),
    下载: app.getPath('downloads'),
    home: homedir(),
    '~': homedir()
  }
  const key = text.toLowerCase()
  if (map[text] || map[key]) return map[text] || map[key]
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2))
  return text.replace(/%([^%]+)%/g, (_all, name: string) => process.env[name] || _all)
}

function resolvePath(input: string, mustExist = false): string | null {
  const raw = aliasPath(input)
  if (!raw) return null
  const candidates = isAbsolute(raw)
    ? [resolve(raw)]
    : [
        join(getWorkspace(), raw),
        resolve(raw),
        join(app.getPath('desktop'), raw),
        join(app.getPath('documents'), raw),
        join(app.getPath('downloads'), raw),
        join(homedir(), raw)
      ]
  for (const item of candidates) {
    const mapped = remapLegacyPath(item)
    if (!mustExist || existsSync(mapped)) return mapped
  }
  return mustExist ? null : remapLegacyPath(resolve(isAbsolute(raw) ? raw : join(getWorkspace(), raw)))
}

function isProtectedWrite(target: string): boolean {
  const resolved = resolve(target).toLowerCase()
  const blocked = ['\\windows\\', '\\program files\\', '\\program files (x86)\\']
  if (/^[a-z]:\\windows($|\\)/i.test(resolved)) return true
  return blocked.some((item) => resolved.includes(item))
}

function matchName(name: string, pattern: string): boolean {
  const raw = pattern.trim()
  if (!raw || raw === '*') return true
  if (!raw.includes('*') && !raw.includes('?')) {
    return name.toLowerCase().includes(raw.toLowerCase())
  }
  const escaped = raw.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i').test(name)
}

function isTextFile(file: string, sample: Buffer): boolean {
  const ext = extname(file).toLowerCase()
  if (TEXT_EXT.has(ext)) return true
  if (OFFICE_EXT.has(ext) || ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.exe', '.dll'].includes(ext)) {
    return false
  }
  return !sample.includes(0)
}

function walkFiles(root: string, depth: number, acc: string[]): void {
  if (acc.length >= MAX_FIND || depth < 0 || !existsSync(root)) return
  let entries: string[] = []
  try {
    entries = readdirSync(root)
  } catch {
    return
  }
  for (const name of entries) {
    if (acc.length >= MAX_FIND) return
    if (name.startsWith('~$') || SKIP_DIR.has(name.toLowerCase())) continue
    const full = join(root, name)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) walkFiles(full, depth - 1, acc)
    else acc.push(full)
  }
}

function listEntries(dir: string, extension?: string): { files: string[]; dirs: string[] } {
  const files: string[] = []
  const dirs: string[] = []
  if (!existsSync(dir)) return { files, dirs }
  const ext = extension ? `.${extension.replace(/^\./, '').toLowerCase()}` : ''
  for (const name of readdirSync(dir)) {
    if (name.startsWith('~$')) continue
    const full = join(dir, name)
    try {
      const stat = statSync(full)
      if (stat.isDirectory()) {
        dirs.push(full)
        continue
      }
      if (!stat.isFile()) continue
      const current = extname(full).toLowerCase()
      if (!ext || current === ext || (ext === '.doc' && (current === '.doc' || current === '.docx'))) {
        files.push(full)
      }
    } catch {
      continue
    }
    if (files.length + dirs.length >= MAX_LIST) break
  }
  return { files, dirs }
}

function collectTargets(pathValue?: string, folder?: string, pattern?: string): string[] {
  if (pathValue) {
    const found = resolvePath(pathValue, true)
    return found ? [found] : []
  }
  const dir = resolvePath(folder || 'desktop', true)
  if (!dir) return []
  const { files } = listEntries(dir)
  return files.filter((full) => {
    const name = basename(full)
    const ext = extname(full).toLowerCase()
    if (pattern) return matchName(name, pattern)
    return OFFICE_EXT.has(ext)
  })
}

async function convertOne(input: string): Promise<string> {
  const output = join(dirname(input), `${basename(input, extname(input))}.pdf`)
  const soffice = [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
  ].find((item) => existsSync(item))
  if (soffice) {
    await execFileAsync(
      soffice,
      ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dirname(input), input],
      { timeout: 120000, windowsHide: true }
    )
    if (existsSync(output)) return output
  }
  const scriptDir = mkdtempSync(join(tmpdir(), 'ling-pdf-'))
  const script = join(scriptDir, 'convert.ps1')
  writeFileSync(script, officeScript(), 'utf8')
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-InputPath', input, '-OutputPath', output],
    { timeout: 120000, windowsHide: true }
  )
  if (!existsSync(output)) throw new Error(`没有生成 PDF：${basename(input)}`)
  return output
}

function officeScript(): string {
  return `
param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$ext = [IO.Path]::GetExtension($InputPath).ToLowerInvariant()
if ($ext -in @('.doc', '.docx')) {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  try {
    $doc = $word.Documents.Open($InputPath, $false, $true)
    $doc.ExportAsFixedFormat($OutputPath, 17)
    $doc.Close($false)
  } finally { $word.Quit() }
} elseif ($ext -in @('.xls', '.xlsx')) {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  try {
    $wb = $excel.Workbooks.Open($InputPath)
    $wb.ExportAsFixedFormat(0, $OutputPath)
    $wb.Close($false)
  } finally { $excel.Quit() }
} elseif ($ext -in @('.ppt', '.pptx')) {
  $ppt = New-Object -ComObject PowerPoint.Application
  try {
    $pres = $ppt.Presentations.Open($InputPath, $true, $false, $false)
    $pres.SaveAs($OutputPath, 32)
    $pres.Close()
  } finally { $ppt.Quit() }
} else { throw "暂不支持这种文件：$ext" }
`.trim()
}

function isDangerousCommand(command: string): boolean {
  const text = command.toLowerCase().replace(/\s+/g, ' ')
  return [
    /format [a-z]:/,
    /rd \/s/,
    /rmdir \/s/,
    /del \/s \/q [a-z]:\\/,
    /remove-item[\s\S]*-recurse[\s\S]*(windows|system32|program files)/,
    /\bshutdown\b/,
    /stop-computer/,
    /restart-computer/,
    /cipher \/w/,
    /\bbcdedit\b/,
    /\bdiskpart\b/,
    /reg delete hklm/,
    /git push[\s\S]*--force/,
    /git config /
  ].some((pattern) => pattern.test(text))
}

async function runCommand(command: string, cwd: string, timeoutSeconds: number): Promise<ToolResult> {
  if (isDangerousCommand(command)) {
    return { ok: false, message: '这条命令太危险，我不会执行。' }
  }
  if (isProtectedWrite(cwd)) {
    return { ok: false, message: '不能在系统目录里执行命令' }
  }
  if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true })
  const timeout = Math.min(Math.max(timeoutSeconds, 15), 600) * 1000
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      {
        cwd,
        timeout,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, CI: 'true', npm_config_yes: 'true' }
      }
    )
    const output = `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim().slice(0, 40_000)
    return { ok: true, message: `命令完成（${cwd}）`, content: output || '(没有输出)' }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    const output = `${err.stdout || ''}\n${err.stderr || err.message || ''}`.trim().slice(0, 40_000)
    return { ok: false, message: '命令执行失败', content: output }
  }
}

function grepFile(file: string, query: string): string[] {
  try {
    const buf = readFileSync(file)
    if (!isTextFile(file, buf.subarray(0, 8000))) return []
    const lines = buf.toString('utf8').split(/\r?\n/)
    const hits: string[] = []
    const needle = query.toLowerCase()
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(needle)) {
        hits.push(`${file}:${index + 1}:${line.trim().slice(0, 200)}`)
      }
    })
    return hits
  } catch {
    return []
  }
}

export async function executeTool(name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>
  const str = (key: string, keepPad = false): string => {
    const value = String(args[key] ?? '')
    return keepPad ? value : value.trim()
  }
  const num = (key: string): number | undefined => {
    const value = args[key]
    return typeof value === 'number' ? value : undefined
  }

  try {
    if (name === 'list_files') {
      const dir = resolvePath(str('path') || getWorkspace(), true)
      if (!dir) return { ok: false, message: '找不到这个文件夹' }
      const listed = listEntries(dir, str('extension') || undefined)
      const names = [
        ...listed.dirs.map((item) => `${basename(item)}/`),
        ...listed.files.map((item) => basename(item))
      ]
      return {
        ok: true,
        message: names.length ? `${dir} 里有 ${names.length} 项` : `${dir} 是空的`,
        files: [...listed.dirs, ...listed.files]
      }
    }

    if (name === 'read_file') {
      const file = resolvePath(str('path'), true)
      if (!file) return { ok: false, message: '找不到这个文件' }
      if (!statSync(file).isFile()) return { ok: false, message: '这是文件夹，请用 list_files' }
      const buf = readFileSync(file)
      if (!isTextFile(file, buf.subarray(0, 8000))) {
        return { ok: false, message: `${basename(file)} 不是文本文件。Word/Excel 请用 convert_to_pdf 或告诉我要怎么处理。` }
      }
      const lines = buf.toString('utf8').split(/\r?\n/)
      const offset = Math.max(1, num('offset') || 1)
      const limit = Math.max(1, num('limit') || lines.length)
      const slice = lines.slice(offset - 1, offset - 1 + limit)
      let content = slice.map((line, index) => `${offset + index}|${line}`).join('\n')
      if (content.length > MAX_READ) content = content.slice(0, MAX_READ) + '\n…(已截断)'
      return { ok: true, message: `已读取 ${file}`, content, files: [file] }
    }

    if (name === 'write_file') {
      const file = resolvePath(str('path'), false)
      if (!file) return { ok: false, message: '路径无效' }
      if (isProtectedWrite(file)) return { ok: false, message: '系统目录不能写入' }
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, str('content', true), 'utf8')
      return { ok: true, message: `已写入 ${file}`, files: [file] }
    }

    if (name === 'replace_in_file') {
      const file = resolvePath(str('path'), true)
      if (!file) return { ok: false, message: '找不到这个文件' }
      if (isProtectedWrite(file)) return { ok: false, message: '系统目录不能修改' }
      const oldText = String(args.old_text ?? '')
      const newText = String(args.new_text ?? '')
      const current = readFileSync(file, 'utf8')
      if (!current.includes(oldText)) return { ok: false, message: '文件里找不到要替换的原文，请先 read_file' }
      const next = args.replace_all ? current.split(oldText).join(newText) : current.replace(oldText, newText)
      writeFileSync(file, next, 'utf8')
      return { ok: true, message: `已更新 ${file}`, files: [file] }
    }

    if (name === 'find_files') {
      const query = str('query')
      if (!query) return { ok: false, message: '没有给出要找的文件名' }
      const root = resolvePath(str('path') || getWorkspace(), true) || getWorkspace()
      const found: string[] = []
      walkFiles(root, 6, found)
      const files = found.filter((item) => matchName(basename(item), query)).slice(0, MAX_FIND)
      return {
        ok: true,
        message: files.length ? `找到 ${files.length} 个文件` : '没有找到匹配的文件',
        files
      }
    }

    if (name === 'search_in_files') {
      const query = str('query')
      const start = resolvePath(str('path') || getWorkspace(), true)
      if (!query || !start) return { ok: false, message: '需要搜索词' }
      const hits: string[] = []
      const files = statSync(start).isFile() ? [start] : []
      if (!files.length) walkFiles(start, 5, files)
      for (const file of files) {
        if (hits.length >= MAX_SEARCH) break
        hits.push(...grepFile(file, query))
      }
      return {
        ok: true,
        message: hits.length ? `找到 ${Math.min(hits.length, MAX_SEARCH)} 处` : '没有搜到',
        files: hits.slice(0, MAX_SEARCH)
      }
    }

    if (name === 'copy_file') {
      const from = resolvePath(str('from'), true)
      const to = resolvePath(str('to'), false)
      if (!from || !to) return { ok: false, message: '源路径或目标路径无效' }
      if (isProtectedWrite(to)) return { ok: false, message: '系统目录不能写入' }
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(from, to)
      return { ok: true, message: `已复制到 ${to}`, files: [to] }
    }

    if (name === 'create_directory') {
      const dir = resolvePath(str('path'), false)
      if (!dir) return { ok: false, message: '路径无效' }
      if (isProtectedWrite(dir)) return { ok: false, message: '系统目录不能创建' }
      mkdirSync(dir, { recursive: true })
      return { ok: true, message: `已创建 ${dir}`, files: [dir] }
    }

    if (name === 'convert_to_pdf') {
      const targets = collectTargets(str('path') || undefined, str('folder') || undefined, str('pattern') || undefined)
        .filter((item) => OFFICE_EXT.has(extname(item).toLowerCase()))
      if (!targets.length) return { ok: false, message: '没有找到可以转换的 Word / Excel / PPT 文件' }
      const pdfs: string[] = []
      const errors: string[] = []
      for (const file of targets) {
        try {
          pdfs.push(await convertOne(file))
        } catch (error) {
          errors.push(`${basename(file)}：${(error as Error).message}`)
        }
      }
      if (!pdfs.length) return { ok: false, message: errors.join('；') || '转换失败' }
      return {
        ok: true,
        message: `已生成 ${pdfs.length} 个 PDF` + (errors.length ? `，失败：${errors.join('；')}` : ''),
        pdfs,
        files: targets
      }
    }

    if (name === 'open_path') {
      const target = resolvePath(str('path'), true)
      if (!target) return { ok: false, message: '找不到要打开的文件或文件夹' }
      const err = await shell.openPath(target)
      if (err) return { ok: false, message: err }
      return { ok: true, message: `已打开 ${target}`, files: [target] }
    }

    if (name === 'get_workspace') {
      const dir = getWorkspace()
      return { ok: true, message: `当前工作目录：${dir}`, files: [dir] }
    }

    if (name === 'set_workspace') {
      const dir = resolvePath(str('path'), false)
      if (!dir) return { ok: false, message: '路径无效' }
      const saved = setWorkspace(dir)
      return { ok: true, message: `工作目录已切换到 ${saved}`, files: [saved] }
    }

    if (name === 'run_command') {
      const command = str('command')
      if (!command) return { ok: false, message: '没有给出要运行的命令' }
      const cwd = str('cwd') ? resolvePath(str('cwd'), false) || getWorkspace() : getWorkspace()
      return runCommand(command, cwd, num('timeout_seconds') || 180)
    }

    return { ok: false, message: `还不会做这个操作：${name}` }
  } catch (error) {
    return { ok: false, message: (error as Error).message || '操作失败' }
  }
}

export function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}
