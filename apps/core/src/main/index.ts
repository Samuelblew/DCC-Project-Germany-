import { app, shell, BrowserWindow, ipcMain, Menu, dialog, protocol, net } from 'electron'
import { join, resolve, relative, isAbsolute, basename, dirname } from 'path'
import { pathToFileURL } from 'url'
import { open, stat, readFile as readBinaryFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import log from 'electron-log/main'
import AdmZip from 'adm-zip'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import windowsIcon from '../../resources/icon.ico?asset'
import { rpcHandler } from './api'
import { readFile, parseJson, writeFile } from './utils'
import { enableDcsPersistenceForAppRuntime, findMissionScriptingPath } from './dcs-persistence'
import { registerMissionGeneratorChatHandlers } from './api/mission-generator/chat-handler'
import { stateFile } from './app-data'
import { validateDcsInstallPath } from './dcs-install'
import {
  resolveAppIconPath,
  resolveTheatrePmtilesPath,
  setAppIconPath,
  setTheatrePmtilesPath,
  SUPPORTED_THEATRE_MAP_TILE_NAMES
} from '@dcc/generate-miz'

log.initialize()
log.transports.file.level = 'info'
log.transports.console.level = is.dev ? 'debug' : 'info'
log.errorHandler.startCatching({ showDialog: false })
autoUpdater.logger = log

const actionLog = log.create({ logId: 'actions' })
actionLog.transports.file.fileName = 'actions.log'
actionLog.transports.file.level = 'info'
actionLog.transports.console.level = false

console.log = (...args) => log.info(...args)
console.info = (...args) => log.info(...args)
console.warn = (...args) => log.warn(...args)
console.error = (...args) => log.error(...args)
console.debug = (...args) => log.debug(...args)

console.log('Log file:', log.transports.file.getFile().path)
console.log('Action log file:', actionLog.transports.file.getFile().path)

app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_consoleEvent, level, message, line, sourceId) => {
    if (/^%[oO]$/.test(message.trim())) return

    const location = sourceId ? ` (${sourceId}:${line})` : ''
    const text = `Renderer console: ${message}${location}`

    if (level === 0) {
      log.debug(text)
    } else if (level === 1) {
      log.info(text)
    } else if (level === 2) {
      log.warn(text)
    } else {
      log.error(text)
    }
  })
})

let mainWindow: BrowserWindow | null = null
const rendererProtocol = 'dcc'
const frontendRendererHost = 'frontend'
const gotSingleInstanceLock = app.requestSingleInstanceLock()
const RESTORABLE_PATHS = new Set([
  '/',
  '/mission',
  '/new',
  '/new/scenario',
  '/load',
  '/settings',
  '/mission-generator'
])

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
  })
}

type CampaignActionLogEntry = {
  id: string
  type: string
  coalition: string
  label?: string
  entityType?: string
  entityId?: string
  campaignTime: string
  message: string
  createdAt: string
}

function isCampaignActionLogEntry(value: unknown): value is CampaignActionLogEntry {
  if (value == null || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' &&
    typeof entry.type === 'string' &&
    typeof entry.coalition === 'string' &&
    typeof entry.campaignTime === 'string' &&
    typeof entry.message === 'string' &&
    typeof entry.createdAt === 'string'
  )
}

function formatCampaignActionLogEntry(entry: CampaignActionLogEntry): string {
  const label = entry.label ? ` [${entry.label}]` : ''
  const entity =
    entry.entityType && entry.entityId ? ` (${entry.entityType}:${entry.entityId})` : ''
  return `${entry.createdAt} | campaign=${entry.campaignTime} | ${entry.coalition}/${entry.type}${label}${entity} | ${entry.message}`
}

type DebugBundleCandidate = {
  path: string
  zipPath: string
}

type AppState = {
  activeCampaignId?: string
  settings?: {
    missionExportPath?: string
    dcsInstallPath?: string
  }
}

const savedGamesVariants = ['DCS', 'DCS.openbeta', 'DCS.openbeta_server', 'DCS_server']

function sanitizeZipPathSegment(value: string) {
  const replaced = value.replace(/[<>:"/\\|?*]/g, '_')
  const withoutControlChars = Array.from(replaced, (ch) => (ch.charCodeAt(0) < 32 ? '_' : ch)).join(
    ''
  )
  return withoutControlChars.replace(/\.+$/g, '_') || 'unknown'
}

function detectMissionExportDirectory() {
  const savedGamesRoot = join(app.getPath('home'), 'Saved Games')
  const candidates = savedGamesVariants.map((variant) => join(savedGamesRoot, variant, 'Missions'))
  return candidates.find((candidate) => existsSync(candidate))
}

function getDefaultMissionExportDirectory() {
  return detectMissionExportDirectory() ?? app.getPath('downloads')
}

function resolveMissionExportDirectory(missionExportPath?: string) {
  const configuredPath = missionExportPath?.trim()
  const defaultDirectory = getDefaultMissionExportDirectory()

  if (!configuredPath) {
    return defaultDirectory
  }

  return isAbsolute(configuredPath) ? configuredPath : join(defaultDirectory, configuredPath)
}

async function readAppState(): Promise<AppState> {
  const file = await readFile(stateFile)
  if (file.isErr()) {
    return {}
  }

  const parsed = parseJson(file.value)
  if (parsed.isErr() || parsed.value == null || typeof parsed.value !== 'object') {
    return {}
  }

  return parsed.value as AppState
}

async function addIfFile(candidates: DebugBundleCandidate[], filePath: string, zipPath: string) {
  try {
    const fileStat = await stat(filePath)
    if (fileStat.isFile()) {
      candidates.push({ path: filePath, zipPath })
    }
  } catch {
    // Missing debug artifacts are expected; include only files that exist.
  }
}

async function addDirectoryFiles(
  candidates: DebugBundleCandidate[],
  directory: string,
  zipDirectory: string,
  filter: (fileName: string) => boolean
) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !filter(entry.name)) {
        continue
      }
      candidates.push({
        path: join(directory, entry.name),
        zipPath: `${zipDirectory}/${sanitizeZipPathSegment(entry.name)}`
      })
    }
  } catch {
    // Some DCS variants or log folders will not exist on every machine.
  }
}

async function collectDebugBundleCandidates(): Promise<DebugBundleCandidate[]> {
  const state = await readAppState()
  const candidates: DebugBundleCandidate[] = []

  if (state.activeCampaignId) {
    await addIfFile(
      candidates,
      join(app.getPath('userData'), 'campaigns', `${state.activeCampaignId}.json`),
      `active-campaign/${sanitizeZipPathSegment(state.activeCampaignId)}.json`
    )
  }

  const missionScriptingPath = findMissionScriptingPath(state.settings?.dcsInstallPath ?? null)
  if (missionScriptingPath) {
    await addIfFile(candidates, missionScriptingPath, 'dcs/MissionScripting.lua')
  }

  const savedGamesRoot = join(app.getPath('home'), 'Saved Games')
  const missionDirectories = [
    resolveMissionExportDirectory(state.settings?.missionExportPath),
    ...savedGamesVariants.map((variant) => join(savedGamesRoot, variant, 'Missions'))
  ]

  await Promise.all(
    missionDirectories.map(async (directory, index) => {
      const prefix =
        index === 0
          ? 'mission'
          : `mission-candidates/${sanitizeZipPathSegment(basename(dirname(directory)))}`
      await addIfFile(candidates, join(directory, 'dcc_mission.miz'), `${prefix}/dcc_mission.miz`)
      await addIfFile(candidates, join(directory, 'dcc_state.json'), `${prefix}/dcc_state.json`)
    })
  )

  const logFile = log.transports.file.getFile().path
  const actionLogFile = actionLog.transports.file.getFile().path
  const logDirectories = Array.from(new Set([dirname(logFile), dirname(actionLogFile)]))
  await Promise.all(
    logDirectories.map((directory) =>
      addDirectoryFiles(candidates, directory, 'dcc-logs', (fileName) =>
        fileName.toLowerCase().endsWith('.log')
      )
    )
  )

  await Promise.all(
    savedGamesVariants.map(async (variant) => {
      await addDirectoryFiles(
        candidates,
        join(savedGamesRoot, variant, 'Logs'),
        `dcs-logs/${sanitizeZipPathSegment(variant)}`,
        (fileName) => fileName.toLowerCase().endsWith('.log')
      )
    })
  )

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = candidate.path.toLowerCase()
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

async function createDebugBundle() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const defaultPath = join(app.getPath('downloads'), `dcc-debug-bundle-${timestamp}.zip`)
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save Debug Bundle',
    defaultPath,
    filters: [{ name: 'Zip Archive', extensions: ['zip'] }]
  })

  if (canceled || !filePath) {
    return null
  }

  const candidates = await collectDebugBundleCandidates()
  const zip = new AdmZip()
  const manifest = {
    createdAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    includedFiles: candidates.map((candidate) => ({
      sourcePath: candidate.path,
      zipPath: candidate.zipPath
    }))
  }

  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'))

  for (const candidate of candidates) {
    const data = await readBinaryFile(candidate.path)
    zip.addFile(candidate.zipPath, data)
  }

  zip.writeZip(filePath)
  void shell.showItemInFolder(filePath)
  return filePath
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: rendererProtocol,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])

function registerRendererProtocol() {
  protocol.handle(rendererProtocol, async (request) => {
    const url = new URL(request.url)
    if (url.host !== frontendRendererHost) {
      return new Response('Not found', { status: 404 })
    }

    const rendererRoot = resolve(process.resourcesPath, 'renderer/frontend')
    const requestedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const filePath = resolve(rendererRoot, `.${requestedPath}`)
    const relativePath = relative(rendererRoot, filePath)
    const isSafePath =
      relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))

    if (!isSafePath) {
      return new Response('Bad request', { status: 400 })
    }

    const range = request.headers.get('range')
    if (range) {
      return serveFileRange(filePath, range)
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })
}

async function serveFileRange(filePath: string, rangeHeader: string) {
  const fileStat = await stat(filePath)
  const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/)

  if (!match) {
    return new Response('Bad range', {
      status: 416,
      headers: { 'Content-Range': `bytes */${fileStat.size}` }
    })
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : fileStat.size - 1
  const end = Math.min(requestedEnd, fileStat.size - 1)

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start > end ||
    start >= fileStat.size
  ) {
    return new Response('Range not satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${fileStat.size}` }
    })
  }

  const length = end - start + 1
  const file = await open(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await file.read(buffer, 0, length, start)
    return new Response(buffer.subarray(0, bytesRead), {
      status: 206,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(bytesRead),
        'Content-Range': `bytes ${start}-${start + bytesRead - 1}/${fileStat.size}`,
        'Content-Type': 'application/octet-stream'
      }
    })
  } finally {
    await file.close()
  }
}

async function getLastViewPath() {
  const file = await readFile(stateFile)
  if (file.isErr()) {
    return '/new'
  }

  const parsed = parseJson(file.value)
  if (parsed.isErr()) {
    return '/new'
  }

  const state = parsed.value as { settings?: { lastViewPath?: string } }
  const path = state.settings?.lastViewPath
  if (typeof path === 'string' && RESTORABLE_PATHS.has(path)) {
    return path
  }
  return '/new'
}

async function isAutoUpdateDisabled() {
  const file = await readFile(stateFile)
  if (file.isErr()) {
    return false
  }
  const parsed = parseJson(file.value)
  if (parsed.isErr()) {
    return false
  }
  const state = parsed.value as { settings?: { disableAutoUpdate?: boolean } }
  return state.settings?.disableAutoUpdate === true
}

let updateWindow: BrowserWindow | null = null
let updateWindowReady = false
type UpdateUiState = { status: string; percent?: number; meta?: string }
let pendingUpdateUi: UpdateUiState | null = null

const updateHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0f0e0d; color: #ede6d6; height: 100vh;
    display: flex; align-items: center; justify-content: center;
    -webkit-app-region: drag; user-select: none; }
  .card { width: 100%; padding: 24px 28px; box-sizing: border-box; }
  h1 { margin: 0 0 8px 0; font-size: 14px; color: #ef7f70;
    letter-spacing: 0.08em; text-transform: uppercase; }
  p { margin: 0 0 14px 0; font-size: 13px; color: #c0c0e0; }
  .bar { height: 8px; background: rgba(255,255,255,0.08);
    border-radius: 4px; overflow: hidden; }
  .fill { height: 100%; width: 0%;
    background: linear-gradient(90deg, #ef7f70, #e8b730);
    transition: width 0.2s ease; }
  .meta { margin-top: 8px; font-size: 11px; color: #707090;
    font-variant-numeric: tabular-nums; }
</style></head><body>
  <div class="card">
    <h1>Updating Digital Crew Chief</h1>
    <p id="status">Preparing update...</p>
    <div class="bar"><div class="fill" id="fill"></div></div>
    <div class="meta" id="meta"></div>
  </div>
</body></html>`

function ensureUpdateWindow(): BrowserWindow {
  if (updateWindow && !updateWindow.isDestroyed()) {
    return updateWindow
  }
  updateWindowReady = false
  const win = new BrowserWindow({
    width: 440,
    height: 180,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    alwaysOnTop: true,
    show: false,
    skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(updateHtml)}`)
  win.once('ready-to-show', () => win.show())
  win.webContents.once('did-finish-load', () => {
    updateWindowReady = true
    if (pendingUpdateUi) {
      applyUpdateUi(pendingUpdateUi)
      pendingUpdateUi = null
    }
  })
  win.on('closed', () => {
    updateWindow = null
    updateWindowReady = false
  })
  updateWindow = win
  return win
}

function applyUpdateUi(state: UpdateUiState) {
  if (!updateWindow || updateWindow.isDestroyed()) return
  const percentJs = state.percent == null ? "'0%'" : `(${state.percent}) + '%'`
  const js = `(function(){
    var s=document.getElementById('status'); if(s) s.textContent=${JSON.stringify(state.status)};
    var f=document.getElementById('fill'); if(f) f.style.width=${percentJs};
    var m=document.getElementById('meta'); if(m) m.textContent=${JSON.stringify(state.meta ?? '')};
  })();`
  updateWindow.webContents.executeJavaScript(js, true).catch(() => {})
}

function setUpdateUi(state: UpdateUiState) {
  if (!updateWindow || updateWindow.isDestroyed()) return
  if (!updateWindowReady) {
    pendingUpdateUi = state
    return
  }
  applyUpdateUi(state)
}

function startAutoUpdate() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for app update.')
  })
  autoUpdater.on('update-not-available', (info) => {
    console.log('No app update available:', info.version)
  })
  autoUpdater.on('update-available', (info) => {
    console.log('App update available:', info.version)
    ensureUpdateWindow()
    setUpdateUi({ status: `Downloading version ${info.version}...`, percent: 0 })
  })
  autoUpdater.on('download-progress', (p) => {
    const pct = Math.round(p.percent)
    const transferred = (p.transferred / 1024 / 1024).toFixed(1)
    const total = (p.total / 1024 / 1024).toFixed(1)
    console.log(`App update download progress: ${pct}% (${transferred} MB / ${total} MB)`)
    setUpdateUi({
      status: 'Downloading update...',
      percent: pct,
      meta: `${transferred} MB / ${total} MB · ${pct}%`
    })
  })
  autoUpdater.on('update-downloaded', () => {
    console.log('App update downloaded; restarting to install.')
    setUpdateUi({ status: 'Installing update...', percent: 100, meta: 'Restarting to apply.' })
    setTimeout(() => autoUpdater.quitAndInstall(), 800)
  })
  autoUpdater.on('error', (error) => {
    console.error('Auto-update error:', error)
    if (updateWindow && !updateWindow.isDestroyed()) {
      updateWindow.close()
    }
  })

  autoUpdater.checkForUpdates().catch((error) => {
    console.error('Auto-update check failed:', error)
  })
}

async function setLastViewPath(pathname: string) {
  if (!RESTORABLE_PATHS.has(pathname)) {
    return
  }

  let current: Record<string, unknown> = {}
  const file = await readFile(stateFile)
  if (file.isOk()) {
    const parsed = parseJson(file.value)
    if (parsed.isOk() && parsed.value != null && typeof parsed.value === 'object') {
      current = parsed.value as Record<string, unknown>
    }
  }

  const settings =
    current.settings != null && typeof current.settings === 'object'
      ? (current.settings as Record<string, unknown>)
      : {}

  await writeFile(stateFile, {
    ...current,
    settings: {
      ...settings,
      lastViewPath: pathname
    }
  })
}

function getPathFromUrl(url: string) {
  try {
    const parsed = new URL(url)
    const hash = parsed.hash
    if (!hash) {
      return '/'
    }
    const rawPath = hash.startsWith('#') ? hash.slice(1) : hash
    const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
    return RESTORABLE_PATHS.has(normalizedPath) ? normalizedPath : null
  } catch {
    return null
  }
}

function withHashPath(baseUrl: string, path: string) {
  const safePath = RESTORABLE_PATHS.has(path) ? path : '/'
  return `${baseUrl}#${safePath}`
}

function createApplicationMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Dev',
      submenu: [
        {
          label: 'Show Chrome DevTools',
          accelerator: 'F12',
          click: () => {
            mainWindow?.webContents.openDevTools({ mode: 'detach' })
          }
        }
      ]
    }
  ])
}

async function createWindow(): Promise<void> {
  console.log('createWindow')
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1350,
    height: 1005,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    ...(process.platform === 'linux'
      ? { icon }
      : process.platform === 'win32'
        ? { icon: windowsIcon }
        : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-change', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-change', false)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const persistPathFromUrl = (url: string) => {
    const path = getPathFromUrl(url)
    if (!path) {
      return
    }
    void setLastViewPath(path).catch((error) => {
      console.error('Failed to persist last view path:', error)
    })
  }

  mainWindow.webContents.on('did-navigate', (_event, url) => {
    persistPathFromUrl(url)
  })
  mainWindow.webContents.on('did-navigate-in-page', (_event, url) => {
    persistPathFromUrl(url)
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  const startupPath = await getLastViewPath()
  const FRONTEND_URL = process.env.FRONTEND_URL
  if (is.dev && FRONTEND_URL) {
    await mainWindow.loadURL(withHashPath(FRONTEND_URL, startupPath))
  } else {
    await mainWindow.loadURL(
      withHashPath(`${rendererProtocol}://${frontendRendererHost}/index.html`, startupPath)
    )
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  if (!gotSingleInstanceLock) {
    return
  }

  console.log('whenReady')
  for (const theatreName of SUPPORTED_THEATRE_MAP_TILE_NAMES) {
    const kneeboardMapTilesPath = resolveTheatrePmtilesPath(theatreName)
    if (kneeboardMapTilesPath) {
      setTheatrePmtilesPath(theatreName, kneeboardMapTilesPath)
      log.info(`${theatreName} kneeboard map tiles:`, kneeboardMapTilesPath)
    } else {
      log.warn(
        `${theatreName} map tiles not found; kneeboard route maps for this theatre will omit lakes, coastlines, and rivers.`
      )
    }
  }

  const appIconPath = resolveAppIconPath()
  if (appIconPath) {
    setAppIconPath(appIconPath)
    log.info('Kneeboard app icon:', appIconPath)
  } else {
    log.warn('App icon not found; kneeboard header will omit the logo.')
  }
  registerRendererProtocol()
  enableDcsPersistenceForAppRuntime()
  // Set app user model id for windows
  electronApp.setAppUserModelId('at.digitalcrewchief.app')

  Menu.setApplicationMenu(createApplicationMenu())

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('start-orpc-server', async (event) => {
    const [serverPort] = event.ports
    rpcHandler.upgrade(serverPort)
    serverPort.start()
  })

  ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    })
    if (canceled) {
      return null
    } else {
      return filePaths[0]
    }
  })
  ipcMain.handle('dialog:openDcsInstallDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    })
    if (canceled) {
      return null
    }

    const selectedPath = filePaths[0]
    const validation = validateDcsInstallPath(selectedPath)
    if (!validation.valid) {
      return {
        path: selectedPath,
        valid: false,
        message: validation.message ?? 'Invalid DCS World install folder.'
      }
    }

    return {
      path: selectedPath,
      valid: true,
      message: null
    }
  })
  ipcMain.handle('dialog:openMissionStateFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select Mission State',
      defaultPath: 'dcc_state.json',
      properties: ['openFile'],
      filters: [
        { name: 'DCC Mission State', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (canceled) {
      return null
    }
    return filePaths[0] ?? null
  })

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.on('campaign:log-action', (_event, entry: unknown) => {
    if (!isCampaignActionLogEntry(entry)) {
      console.warn('Ignored invalid campaign action log entry.')
      return
    }
    actionLog.info(formatCampaignActionLogEntry(entry))
  })
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
  })
  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
      return
    }
    mainWindow.maximize()
  })
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle('devtools:open', () => {
    mainWindow?.webContents.openDevTools({ mode: 'detach' })
  })
  ipcMain.handle('debug:createBundle', () => createDebugBundle())
  ipcMain.handle('app:openUserData', () => {
    const userDataPath = app.getPath('userData')
    void shell.openPath(userDataPath)
  })
  ipcMain.handle('window:close', () => {
    mainWindow?.close()
  })

  registerMissionGeneratorChatHandlers(ipcMain, () => mainWindow)

  void createWindow()

  if (!is.dev && process.platform === 'win32') {
    void isAutoUpdateDisabled().then((disabled) => {
      if (disabled) {
        console.log('Auto-update disabled in settings; skipping update check.')
        return
      }
      // Local builds are packaged without a publish feed so they never replace themselves with a release.
      if (!existsSync(join(process.resourcesPath, 'app-update.yml'))) {
        console.log('No update feed in this build; skipping update check.')
        return
      }
      startAutoUpdate()
    })
  }

  app.on('activate', function () {
    console.log('activate')
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
