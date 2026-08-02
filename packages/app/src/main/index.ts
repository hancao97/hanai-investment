import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { ensureDataDirs } from './paths'
import { getDb, kvGet } from './db'
import { registerIpc } from './ipc'
import { importBundledPersonas } from './personas'
import { syncMasterIfNeeded } from './master'
import { codex } from './codex'
import { recoverInterruptedJudgements, setJudgementEmitter } from './judgements'
import type { StreamEvent } from '../shared/types'

if (process.env.ELECTRON_RENDERER_URL) {
  // 仅开发模式：暴露 CDP 便于调试
  app.commandLine.appendSwitch('remote-debugging-port', '9223')
}

let mainWindow: BrowserWindow | null = null

function isExternalWebUrl(url: string, currentUrl?: string): boolean {
  try {
    const target = new URL(url)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false
    if (!currentUrl) return true

    const current = new URL(currentUrl)
    return current.protocol !== 'http:' && current.protocol !== 'https:'
      ? true
      : target.origin !== current.origin
  } catch {
    return false
  }
}

function openExternal(url: string): void {
  if (isExternalWebUrl(url)) void shell.openExternal(url)
}

function sendStream(e: StreamEvent): void {
  mainWindow?.webContents.send('hanai:stream', e)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    title: 'Hanai Investment',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0b0e14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!mainWindow || !isExternalWebUrl(url, mainWindow.webContents.getURL())) return
    event.preventDefault()
    openExternal(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // APP-001: 初始化数据目录（不覆盖已有数据）
  ensureDataDirs()
  getDb()
  codex.setModel(kvGet('codex.selectedModel') || null)
  importBundledPersonas()
  recoverInterruptedJudgements()

  registerIpc()
  setJudgementEmitter(sendStream)
  codex.setStateListener((state) => sendStream({ type: 'codex-state', state }))

  createWindow()

  // APP-002: Codex 与主数据同步失败不阻塞应用启动
  void codex.start()
  const trySync = (attempt: number): void => {
    syncMasterIfNeeded()
      .then((r) => console.log(`[master] 同步完成: ${r.count} 只证券`))
      .catch((e) => {
        console.error(`[master] 同步失败(第${attempt}次):`, e instanceof Error ? e.message : e)
        if (attempt < 5) setTimeout(() => trySync(attempt + 1), 60_000 * attempt)
      })
  }
  trySync(1)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
