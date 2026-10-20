import * as fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import superjson from 'superjson'
import { appDataRoot, stateFile } from './app-data'

const BACKUP_FILE_NAME = 'dcs-mission-scripting.backup.lua'
const BACKUP_META_FILE_NAME = 'dcs-mission-scripting.backup.json'

type BackupMeta = {
  missionScriptingPath: string
}

type AppState = {
  settings?: {
    dcsInstallPath?: string
    enableDcsPersistence?: boolean
  }
}

type PersistenceSettings = {
  dcsInstallPath: string | null
  enableDcsPersistence: boolean
}

type PersistenceSettingsInput =
  | AppState['settings']
  | PersistenceSettings
  | {
      dcsInstallPath?: string | null
      enableDcsPersistence?: boolean
    }
  | null

const DEFAULT_ENABLE_DCS_PERSISTENCE = true

let restoreRegistered = false

function getBackupPaths() {
  return {
    backupPath: path.join(appDataRoot, BACKUP_FILE_NAME),
    backupMetaPath: path.join(appDataRoot, BACKUP_META_FILE_NAME)
  }
}

function readBackupMeta(backupMetaPath: string): BackupMeta | null {
  if (!fs.existsSync(backupMetaPath)) {
    return null
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(backupMetaPath, 'utf-8')) as BackupMeta
    if (
      typeof parsed?.missionScriptingPath !== 'string' ||
      parsed.missionScriptingPath.length === 0
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function findMissionScriptingPath(settingsInstallPath: string | null) {
  const candidates: string[] = []
  const explicitPath = process.env.DCS_INSTALL_PATH

  if (settingsInstallPath) {
    candidates.push(settingsInstallPath)
  }

  if (explicitPath) {
    candidates.push(explicitPath)
  }

  const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
    (v): v is string => Boolean(v)
  )

  for (const basePath of programFiles) {
    candidates.push(path.join(basePath, 'Eagle Dynamics', 'DCS World'))
    candidates.push(path.join(basePath, 'Eagle Dynamics', 'DCS World OpenBeta'))
    candidates.push(path.join(basePath, 'Eagle Dynamics', 'DCS World Server'))
    candidates.push(path.join(basePath, 'Eagle Dynamics', 'DCS World OpenBeta Server'))
  }

  for (const installPath of candidates) {
    const missionScriptingPath = path.join(installPath, 'Scripts', 'MissionScripting.lua')
    if (fs.existsSync(missionScriptingPath)) {
      return missionScriptingPath
    }
  }

  return null
}

function normalizePersistenceSettings(settings?: PersistenceSettingsInput): PersistenceSettings {
  const dcsInstallPath = settings?.dcsInstallPath
  const enableDcsPersistence = settings?.enableDcsPersistence

  return {
    dcsInstallPath:
      typeof dcsInstallPath === 'string' && dcsInstallPath.length > 0 ? dcsInstallPath : null,
    enableDcsPersistence:
      typeof enableDcsPersistence === 'boolean'
        ? enableDcsPersistence
        : DEFAULT_ENABLE_DCS_PERSISTENCE
  }
}

function readPersistenceSettingsFromState(stateFilePath: string): PersistenceSettings {
  if (!fs.existsSync(stateFilePath)) {
    return normalizePersistenceSettings()
  }

  try {
    const rawState = fs.readFileSync(stateFilePath, 'utf-8')
    const parsedState = superjson.parse(rawState) as AppState
    return normalizePersistenceSettings(parsedState.settings)
  } catch {
    return normalizePersistenceSettings()
  }
}

function enablePersistenceInMissionScripting(content: string) {
  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)

  const patched = lines.map((line) => {
    const ioPattern = /^\s*sanitizeModule\((['"])io\1\)\s*$/
    const lfsPattern = /^\s*sanitizeModule\((['"])lfs\1\)\s*$/

    if (ioPattern.test(line) || lfsPattern.test(line)) {
      const indent = line.match(/^\s*/)?.[0] ?? ''
      const command = line.trim()
      return `${indent}-- ${command}`
    }

    return line
  })

  return patched.join(lineEnding)
}

function restoreMissionScripting() {
  const { backupPath, backupMetaPath } = getBackupPaths()
  const meta = readBackupMeta(backupMetaPath)

  if (!meta || !fs.existsSync(backupPath)) {
    return
  }

  try {
    const originalContent = fs.readFileSync(backupPath, 'utf-8')
    fs.writeFileSync(meta.missionScriptingPath, originalContent, 'utf-8')
    console.log(`Restored MissionScripting.lua: ${meta.missionScriptingPath}`)
  } catch (error) {
    console.error('Failed to restore MissionScripting.lua:', error)
  } finally {
    try {
      fs.unlinkSync(backupPath)
    } catch {
      // ignore cleanup failures
    }
    try {
      fs.unlinkSync(backupMetaPath)
    } catch {
      // ignore cleanup failures
    }
  }
}

function registerRestoreHook() {
  if (restoreRegistered) {
    return
  }
  restoreRegistered = true
  app.on('will-quit', () => restoreMissionScripting())
}

export function syncDcsPersistenceForAppRuntime(input?: PersistenceSettingsInput) {
  const settings = normalizePersistenceSettings(input)
  if (!settings.enableDcsPersistence) {
    restoreMissionScripting()
    console.log('DCS persistence is disabled in settings.')
    return
  }

  const missionScriptingPath = findMissionScriptingPath(settings.dcsInstallPath)
  if (!missionScriptingPath) {
    restoreMissionScripting()
    console.warn(
      'MissionScripting.lua not found. Configure DCS Install Path in settings or set DCS_INSTALL_PATH.'
    )
    return
  }

  const { backupPath, backupMetaPath } = getBackupPaths()

  try {
    const activeBackup = readBackupMeta(backupMetaPath)
    const isAlreadyManagingTarget =
      activeBackup?.missionScriptingPath === missionScriptingPath && fs.existsSync(backupPath)

    if (!isAlreadyManagingTarget && (activeBackup || fs.existsSync(backupPath))) {
      restoreMissionScripting()
    }

    const currentContent = fs.readFileSync(missionScriptingPath, 'utf-8')
    if (!isAlreadyManagingTarget) {
      fs.writeFileSync(backupPath, currentContent, 'utf-8')
      fs.writeFileSync(
        backupMetaPath,
        JSON.stringify({ missionScriptingPath } satisfies BackupMeta),
        'utf-8'
      )
    }

    const patchedContent = enablePersistenceInMissionScripting(currentContent)
    if (patchedContent !== currentContent) {
      fs.writeFileSync(missionScriptingPath, patchedContent, 'utf-8')
      console.log(`Enabled DCS persistence in MissionScripting.lua: ${missionScriptingPath}`)
    } else {
      console.log(
        `DCS persistence already enabled in MissionScripting.lua: ${missionScriptingPath}`
      )
    }

    registerRestoreHook()
  } catch (error) {
    console.error('Failed to enable DCS persistence:', error)
    restoreMissionScripting()
  }
}

export function enableDcsPersistenceForAppRuntime() {
  // If the previous run ended unexpectedly, revert first.
  restoreMissionScripting()

  const settings = readPersistenceSettingsFromState(stateFile)
  syncDcsPersistenceForAppRuntime(settings)
}
