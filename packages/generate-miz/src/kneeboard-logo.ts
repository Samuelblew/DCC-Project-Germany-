import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const APP_ICON_RELATIVE = join('apps', 'core', 'resources', 'icon.png')
const PACKAGED_ICON_RELATIVE = join('resources', 'icon.png')

export const KNEEBOARD_LOGO_BOX = {
  x: 64,
  y: 64,
  width: 52,
  height: 52
} as const

let cachedLogoPng: Buffer | undefined
let cachedLogoPath: string | undefined

function findFileUpwards(relativePath: string, startDir: string): string | undefined {
  let dir = startDir
  for (let depth = 0; depth < 12; depth += 1) {
    const candidate = join(dir, relativePath)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

export function setAppIconPath(filePath: string): void {
  process.env.DCC_APP_ICON = filePath
  cachedLogoPng = undefined
  cachedLogoPath = undefined
}

export function resolveAppIconPath(): string | undefined {
  const envPath = process.env.DCC_APP_ICON
  if (envPath && existsSync(envPath)) return envPath

  const resourcesPath = (
    process as NodeJS.Process & {
      resourcesPath?: string
    }
  ).resourcesPath
  if (resourcesPath) {
    const packaged = join(resourcesPath, PACKAGED_ICON_RELATIVE)
    if (existsSync(packaged)) return packaged
    const packagedRoot = join(resourcesPath, 'icon.png')
    if (existsSync(packagedRoot)) return packagedRoot
  }

  const cwdCandidates = [
    join(process.cwd(), APP_ICON_RELATIVE),
    join(process.cwd(), 'resources', 'icon.png'),
    join(process.cwd(), '../core/resources/icon.png')
  ]

  for (const candidate of cwdCandidates) {
    if (existsSync(candidate)) return candidate
  }

  return findFileUpwards(APP_ICON_RELATIVE, dirname(fileURLToPath(import.meta.url)))
}

export async function getKneeboardLogoPng(): Promise<Buffer | undefined> {
  const path = resolveAppIconPath()
  if (!path) return undefined
  if (cachedLogoPng && cachedLogoPath === path) return cachedLogoPng

  const source = await readFile(path)
  cachedLogoPath = path
  cachedLogoPng = await sharp(source)
    .resize(KNEEBOARD_LOGO_BOX.width, KNEEBOARD_LOGO_BOX.height, {
      fit: 'contain',
      position: 'left',
      background: { r: 241, g: 230, b: 210, alpha: 0 }
    })
    .png()
    .toBuffer()

  return cachedLogoPng
}
