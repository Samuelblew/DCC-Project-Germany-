import { existsSync, readdirSync, readFileSync } from 'fs'
import os from 'os'
import path from 'path'

const SAVED_GAMES_VARIANTS = ['DCS', 'DCS.openbeta', 'DCS.openbeta_server', 'DCS_server']

export type DetectInstalledModsOptions = {
  homeDir?: string
  dcsInstallPath?: string
  missionExportPath?: string
}

/**
 * Scans DCS Saved Games (and optional install/export paths) for installed aircraft mods
 * under `Mods/aircraft`, returning both folder names and flyable aircraft IDs declared in `entry.lua`.
 */
export function detectInstalledMods(options: DetectInstalledModsOptions = {}): string[] {
  const homeDir = options.homeDir ?? os.homedir()
  const savedGamesRoot = path.join(homeDir, 'Saved Games')
  const candidateRoots = new Set<string>()

  for (const variant of SAVED_GAMES_VARIANTS) {
    candidateRoots.add(path.join(savedGamesRoot, variant, 'Mods', 'aircraft'))
  }

  if (options.missionExportPath?.trim()) {
    const resolvedExport = path.resolve(options.missionExportPath.trim())
    // If missionExportPath points to `<Saved Games>/DCS/Missions`, check `<Saved Games>/DCS/Mods/aircraft`
    candidateRoots.add(path.join(path.dirname(resolvedExport), 'Mods', 'aircraft'))
  }

  if (options.dcsInstallPath?.trim()) {
    candidateRoots.add(path.join(options.dcsInstallPath.trim(), 'Mods', 'aircraft'))
  }

  const installed = new Set<string>()

  for (const modsRoot of candidateRoots) {
    if (!existsSync(modsRoot)) continue
    let entries
    try {
      entries = readdirSync(modsRoot, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      installed.add(entry.name)

      const entryLuaPath = path.join(modsRoot, entry.name, 'entry.lua')
      if (!existsSync(entryLuaPath)) continue

      try {
        const luaText = readFileSync(entryLuaPath, 'latin1')
        const selfIdMatch = luaText.match(/self_ID\s*=\s*["']([^"']+)["']/)
        if (selfIdMatch?.[1]) {
          installed.add(selfIdMatch[1])
        }
        for (const flyableMatch of luaText.matchAll(/make_flyable\(\s*["']([^"']+)["']/g)) {
          if (flyableMatch[1]) {
            installed.add(flyableMatch[1])
          }
        }
      } catch {
        // Ignore unreadable entry.lua files
      }
    }
  }

  return [...installed].sort((a, b) => a.localeCompare(b))
}
