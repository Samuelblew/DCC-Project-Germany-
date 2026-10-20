import { pub } from '../orpc'
import { app } from 'electron'
import path from 'path'
import { existsSync, promises as fs } from 'fs'
import { schemas } from '@dcc/contracts'
import {
  neverthrowParse,
  NotFoundError,
  parseJson,
  readFile,
  writeFile,
  readDirectory,
  ensureDirectory,
  deleteFile
} from '../../utils'
import { createCampaign } from './create-campaign'
import {
  buildBubbleCatalogue,
  formatBubbleCatalogueSource,
  generateMizFromCampaign
} from '@dcc/generate-miz'
import { getScenarios } from '../data/get-scenarios'
import { getTheatre } from '../data/get-theatre'
import { syncDcsPersistenceForAppRuntime } from '../../dcs-persistence'
import { campaignsDir, stateFile } from '../../app-data'
import { validateDcsInstallPath } from '../../dcs-install'
import { detectInstalledMods } from '../../dcs-mods'

const missionStateFileName = 'dcc_state.json'
console.log('stateFile', stateFile)
console.log('campaignsDir', campaignsDir)

const savedGamesVariants = ['DCS', 'DCS.openbeta', 'DCS.openbeta_server', 'DCS_server']

type AppSettings = {
  missionExportPath?: string
  dcsInstallPath?: string
  enableDcsPersistence?: boolean
  aiProvider?: 'openai' | 'anthropic' | 'openrouter'
  aiApiKey?: string
  aiModel?: string
  disableAutoUpdate?: boolean
  lastViewPath?: string
  hasCompletedWelcome?: boolean
}

type MissionStateErrorFactory = {
  FAILED_TO_READ_FILE: (input: { data: { path: string; message: string } }) => unknown
  INVALID_STATE_FILE: (input: { data: { message: string } }) => unknown
  MISSION_ID_MISMATCH: (input: {
    data: {
      expected: string
      received: string
    }
  }) => unknown
  STALE_STATE_FILE: (input: { data: { message: string } }) => unknown
}

function detectMissionExportDirectory() {
  const savedGamesRoot = path.join(app.getPath('home'), 'Saved Games')
  const candidates = savedGamesVariants.map((variant) =>
    path.join(savedGamesRoot, variant, 'Missions')
  )

  return candidates.find((candidate) => existsSync(candidate))
}

function getDefaultMissionExportDirectory() {
  return detectMissionExportDirectory() ?? app.getPath('downloads')
}

function detectDcsInstallPath() {
  const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
    (value): value is string => Boolean(value)
  )

  for (const basePath of programFiles) {
    for (const variant of [
      'DCS World',
      'DCS World OpenBeta',
      'DCS World Server',
      'DCS World OpenBeta Server'
    ]) {
      const candidate = path.join(basePath, 'Eagle Dynamics', variant)
      if (validateDcsInstallPath(candidate).valid) {
        return candidate
      }
    }
  }

  return undefined
}

function resolveMissionExportDirectory(missionExportPath?: string) {
  const configuredPath = missionExportPath?.trim()
  const defaultDirectory = getDefaultMissionExportDirectory()

  if (!configuredPath) {
    return defaultDirectory
  }

  if (path.isAbsolute(configuredPath)) {
    return configuredPath
  }

  // Never resolve against app cwd; treat relative settings as subfolders of the mission export default.
  return path.join(defaultDirectory, configuredPath)
}

function getMissionStateSearchPaths(settings?: AppSettings) {
  const paths: string[] = []
  if (settings?.missionExportPath) {
    const exportDirectory = resolveMissionExportDirectory(settings.missionExportPath)
    paths.push(path.join(exportDirectory, missionStateFileName))
  }
  const savedGamesRoot = path.join(app.getPath('home'), 'Saved Games')
  for (const variant of savedGamesVariants) {
    paths.push(path.join(savedGamesRoot, variant, 'Missions', missionStateFileName))
  }
  return paths
}

async function readAndValidateMissionState(filePath: string, errors: MissionStateErrorFactory) {
  const file = await readFile(filePath)
  if (file.isErr()) {
    throw errors.FAILED_TO_READ_FILE({
      data: { path: filePath, message: (file.error as Error).message }
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(file.value)
  } catch (error) {
    throw errors.INVALID_STATE_FILE({
      data: { message: (error as Error).message }
    })
  }

  const schemaParsedState = neverthrowParse(schemas.missionState, parsed)
  if (schemaParsedState.isErr()) {
    throw errors.INVALID_STATE_FILE({ data: { message: schemaParsedState.error.message } })
  }

  const missionState = schemaParsedState.value

  // Validate the state file belongs to the active campaign
  const activeCampaignId = await getActiveCampaignId()
  if (!activeCampaignId) {
    throw errors.MISSION_ID_MISMATCH({
      data: { expected: '(no active campaign)', received: missionState.missionId }
    })
  }
  if (missionState.missionId !== activeCampaignId) {
    throw errors.MISSION_ID_MISMATCH({
      data: { expected: activeCampaignId, received: missionState.missionId }
    })
  }

  // Validate the state file is newer than the campaign file to prevent re-submitting old results
  const campaignPath = getCampaignPath(activeCampaignId)
  try {
    const [stateStat, campaignStat] = await Promise.all([fs.stat(filePath), fs.stat(campaignPath)])
    if (stateStat.mtimeMs < campaignStat.mtimeMs) {
      throw errors.STALE_STATE_FILE({
        data: {
          message: `State file is older than the campaign file. The state file was last modified at ${stateStat.mtime.toISOString()}, but the campaign was saved at ${campaignStat.mtime.toISOString()}. Please fly a new mission and try again.`
        }
      })
    }
  } catch (error) {
    // Re-throw our own errors, ignore filesystem errors (e.g. campaign file missing)
    if (error && typeof error === 'object' && 'defined' in error) {
      throw error
    }
  }

  return missionState
}

// State file structure: { activeCampaignId: string | null, settings?: AppSettings }
async function getState() {
  const file = await readFile(stateFile)
  if (file.isErr()) {
    if (file.error instanceof NotFoundError) {
      return {}
    }
    throw new Error((file.error as Error).message)
  }
  const parsedState = parseJson(file.value)
  if (parsedState.isErr()) {
    return {}
  }
  return parsedState.value as {
    activeCampaignId?: string
    settings?: AppSettings
  }
}

async function saveState(state: { activeCampaignId?: string; settings?: AppSettings }) {
  const current = await getState()
  const result = await writeFile(stateFile, { ...current, ...state })
  if (result.isErr()) {
    throw new Error(result.error.message)
  }
}

async function getActiveCampaignId() {
  const state = await getState()
  return state.activeCampaignId ?? null
}

async function setActiveCampaignId(id: string | null) {
  const state = await getState()
  await saveState({ ...state, activeCampaignId: id ?? undefined })
}

function getCampaignPath(id: string) {
  return path.join(campaignsDir, `${id}.json`)
}

const getActiveCampaign = pub.campaign.getActiveCampaign.handler(async ({ errors }) => {
  const activeCampaignId = await getActiveCampaignId()
  if (!activeCampaignId) {
    return null
  }

  const campaignPath = getCampaignPath(activeCampaignId)
  const file = await readFile(campaignPath)
  if (file.isErr()) {
    if (file.error instanceof NotFoundError) {
      return null
    }
    throw errors.INVALID_APP_STATE({ data: { message: (file.error as Error).message } })
  }
  const parsedState = parseJson(file.value)
  if (parsedState.isErr()) {
    throw errors.INVALID_APP_STATE({ data: { message: parsedState.error.message } })
  }

  const schemaParsedState = neverthrowParse(schemas.campaign.campaign, parsedState.value)
  if (schemaParsedState.isErr()) {
    throw errors.INVALID_APP_STATE({ data: { message: schemaParsedState.error.message } })
  }

  const activeCampaign = {
    ...schemaParsedState.value,
    timeMultiplier: 0
  }

  if (schemaParsedState.value.timeMultiplier !== 0) {
    const writeFileResult = await writeFile(campaignPath, activeCampaign)
    if (writeFileResult.isErr()) {
      throw errors.INVALID_APP_STATE({
        data: { message: `Failed to normalize active campaign: ${writeFileResult.error.message}` }
      })
    }
  }

  return activeCampaign
})

const saveActiveCampaign = pub.campaign.saveActiveCampaign.handler(async ({ errors, input }) => {
  // Ensure campaigns directory exists
  const dirResult = await ensureDirectory(campaignsDir)
  if (dirResult.isErr()) {
    throw errors.FAILED_TO_WRITE_FILE({
      data: { path: campaignsDir, message: dirResult.error.message }
    })
  }

  const campaignToSave = {
    ...input,
    updatedAt: new Date(),
    timeMultiplier: 0
  }

  const campaignPath = getCampaignPath(input.id)
  const writeFileResult = await writeFile(campaignPath, campaignToSave)
  return writeFileResult.match(
    () => undefined,
    (error) => {
      throw errors.FAILED_TO_WRITE_FILE({ data: { path: campaignPath, message: error.message } })
    }
  )
})

const listCampaigns = pub.campaign.listCampaigns.handler(async ({ errors }) => {
  // Ensure campaigns directory exists
  const dirResult = await ensureDirectory(campaignsDir)
  if (dirResult.isErr()) {
    throw errors.FAILED_TO_READ_DIRECTORY({
      data: { path: campaignsDir, message: dirResult.error.message }
    })
  }

  const filesResult = await readDirectory(campaignsDir)
  if (filesResult.isErr()) {
    if (filesResult.error instanceof NotFoundError) {
      return []
    }
    throw errors.FAILED_TO_READ_DIRECTORY({
      data: { path: campaignsDir, message: (filesResult.error as Error).message }
    })
  }

  const jsonFiles = filesResult.value.filter((file) => file.endsWith('.json'))
  const campaigns = await Promise.all(
    jsonFiles.map(async (file) => {
      const campaignPath = path.join(campaignsDir, file)
      const fileResult = await readFile(campaignPath)
      if (fileResult.isErr()) {
        return null
      }
      const parsedResult = parseJson(fileResult.value)
      if (parsedResult.isErr()) {
        return null
      }
      const campaign = parsedResult.value as {
        id: string
        name: string
        createdAt: string | Date
        updatedAt?: string | Date
      }
      return {
        id: campaign.id,
        name: campaign.name,
        createdAt: new Date(campaign.createdAt),
        updatedAt: new Date(campaign.updatedAt ?? campaign.createdAt)
      }
    })
  )

  return campaigns.filter((c) => c !== null)
})

const openCampaign = pub.campaign.openCampaign.handler(async ({ errors, input }) => {
  const campaignPath = getCampaignPath(input.id)
  const file = await readFile(campaignPath)
  if (file.isErr()) {
    throw errors.NOT_FOUND({
      data: { message: `Campaign not found: ${input.id}`, path: campaignPath }
    })
  }
  const parsedState = parseJson(file.value)
  if (parsedState.isErr()) {
    throw errors.INVALID_APP_STATE({ data: { message: parsedState.error.message } })
  }

  const schemaParsedState = neverthrowParse(schemas.campaign.campaign, parsedState.value)
  if (schemaParsedState.isErr()) {
    throw errors.INVALID_APP_STATE({ data: { message: schemaParsedState.error.message } })
  }

  const openedCampaign = {
    ...schemaParsedState.value,
    timeMultiplier: 0
  }

  const writeFileResult = await writeFile(campaignPath, openedCampaign)
  if (writeFileResult.isErr()) {
    throw errors.FAILED_TO_WRITE_FILE({
      data: { path: campaignPath, message: writeFileResult.error.message }
    })
  }

  // Set this campaign as active
  await setActiveCampaignId(input.id)

  return openedCampaign
})

const deleteCampaign = pub.campaign.deleteCampaign.handler(async ({ errors, input }) => {
  const campaignPath = getCampaignPath(input.id)
  const result = await deleteFile(campaignPath)
  if (result.isErr()) {
    if (result.error instanceof NotFoundError) {
      return
    }
    throw errors.FAILED_TO_DELETE_FILE({
      data: { path: campaignPath, message: (result.error as Error).message }
    })
  }
})

const getSettings = pub.campaign.getSettings.handler(async () => {
  const state = await getState()
  return {
    ...(state.settings ?? {}),
    detectedMissionExportPath: detectMissionExportDirectory(),
    detectedDcsInstallPath: detectDcsInstallPath(),
    installedMods: detectInstalledMods({
      dcsInstallPath: state.settings?.dcsInstallPath,
      missionExportPath: state.settings?.missionExportPath
    })
  }
})

const saveSettings = pub.campaign.saveSettings.handler(async ({ input, errors }) => {
  const dcsInstallPath = input.dcsInstallPath?.trim()
  if (dcsInstallPath) {
    const validation = validateDcsInstallPath(dcsInstallPath)
    if (!validation.valid) {
      throw errors.INVALID_DCS_INSTALL_PATH({
        data: {
          path: dcsInstallPath,
          message: validation.message ?? 'Invalid DCS World install folder.'
        }
      })
    }
  }

  const state = await getState()
  const settings = {
    ...(state.settings ?? {}),
    ...input
  }

  await saveState({
    ...state,
    settings
  })

  syncDcsPersistenceForAppRuntime(settings)
})

export const generateMiz = pub.campaign.generateMiz.handler(async ({ input, errors }) => {
  const state = await getState()
  const downloadPath = resolveMissionExportDirectory(state.settings?.missionExportPath)
  const ensureDirectoryResult = await ensureDirectory(downloadPath)
  if (ensureDirectoryResult.isErr()) {
    throw errors.FAILED_TO_WRITE_FILE({
      data: { path: downloadPath, message: ensureDirectoryResult.error.message }
    })
  }

  const mizPath = path.join(downloadPath, 'dcc_mission.miz')
  const scenarios = getScenarios()
  const scenario = scenarios.find((s) => s.id === input.scenarioId)
  if (scenario == null) {
    throw errors.NOT_FOUND({ data: { message: 'Scenario not found', path: 'scenarioId' } })
  }
  const theatre = getTheatre(scenario.theatreName)
  if (theatre == null) {
    throw errors.NOT_FOUND({ data: { message: 'Theatre not found', path: scenario.theatreName } })
  }
  const result = await generateMizFromCampaign(input, theatre, mizPath)
  if (result.isErr()) {
    throw errors.FAILED_TO_WRITE_FILE({ data: { path: mizPath, message: result.error.message } })
  }
  return undefined
})

export const loadMissionState = pub.campaign.loadMissionState.handler(async ({ errors }) => {
  const state = await getState()
  const searchPaths = getMissionStateSearchPaths(state.settings)

  let filePath: string | null = null

  for (const candidate of searchPaths) {
    const file = await readFile(candidate)
    if (file.isOk()) {
      filePath = candidate
      break
    }
    if (file.isErr() && !(file.error instanceof NotFoundError)) {
      throw errors.FAILED_TO_READ_FILE({
        data: { path: candidate, message: (file.error as Error).message }
      })
    }
  }

  if (!filePath) {
    const fallbackPath = searchPaths[0] ?? missionStateFileName
    throw errors.FAILED_TO_READ_FILE({
      data: { path: fallbackPath, message: 'dcc_state.json not found in known locations.' }
    })
  }

  return readAndValidateMissionState(filePath, errors)
})

const bubbleCatalogueFileName = 'dcc_bubble.lua'

/**
 * Replace the file in one step, so the mission script never reads a half-written catalogue.
 * Rename is atomic on one volume; if DCS holds the file open at that instant, fall back to a copy
 * (bubble.lua keeps its last good catalogue when a read fails to parse).
 */
async function writeTextReplacing(filePath: string, contents: string) {
  const tmpPath = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(tmpPath, contents, 'utf-8')
  try {
    await fs.rename(tmpPath, filePath)
  } catch {
    try {
      await fs.copyFile(tmpPath, filePath)
    } finally {
      await fs.unlink(tmpPath).catch(() => undefined)
    }
  }
}

export const saveBubbleCatalogue = pub.campaign.saveBubbleCatalogue.handler(
  async ({ input, errors }) => {
    if (input.campaignParams?.worldMode !== 'bubble') {
      return { written: false }
    }

    const state = await getState()
    const statePath = getMissionStateSearchPaths(state.settings).find((candidate) =>
      existsSync(candidate)
    )
    if (!statePath) {
      return { written: false }
    }

    const scenarios = getScenarios()
    const scenario = scenarios.find((entry) => entry.id === input.scenarioId)
    const theatre = scenario ? getTheatre(scenario.theatreName) : undefined
    if (!theatre) {
      throw errors.FAILED_TO_WRITE_FILE({
        data: { path: statePath, message: 'Theatre for the live bubble catalogue was not found' }
      })
    }

    const source = formatBubbleCatalogueSource(input.id, buildBubbleCatalogue(input, theatre))
    if (source.isErr()) {
      throw errors.FAILED_TO_WRITE_FILE({
        data: { path: statePath, message: source.error.message }
      })
    }

    const cataloguePath = path.join(path.dirname(statePath), bubbleCatalogueFileName)
    try {
      await writeTextReplacing(cataloguePath, source.value)
    } catch (error) {
      throw errors.FAILED_TO_WRITE_FILE({
        data: {
          path: cataloguePath,
          message: error instanceof Error ? error.message : 'Failed to write the bubble catalogue'
        }
      })
    }

    return { written: true }
  }
)

export const loadMissionStateFromFile = pub.campaign.loadMissionStateFromFile.handler(
  async ({ input, errors }) => {
    return readAndValidateMissionState(input.path, errors)
  }
)

export const campaign = {
  getActiveCampaign,
  createCampaign,
  saveActiveCampaign,
  generateMiz,
  loadMissionState,
  loadMissionStateFromFile,
  saveBubbleCatalogue,
  listCampaigns,
  openCampaign,
  deleteCampaign,
  getSettings,
  saveSettings
}
