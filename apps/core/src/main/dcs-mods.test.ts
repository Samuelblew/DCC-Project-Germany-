import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, test } from 'vitest'

import { detectInstalledMods } from './dcs-mods'

describe('detectInstalledMods', () => {
  test('detects mod folder names and flyable aircraft IDs from entry.lua in Saved Games', () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), 'dcc-mods-test-'))
    try {
      const modDir = path.join(tempHome, 'Saved Games', 'DCS', 'Mods', 'aircraft', 'AH-6J')
      mkdirSync(modDir, { recursive: true })
      writeFileSync(
        path.join(modDir, 'entry.lua'),
        `declare_plugin("AH-6J", { self_ID = "AH-6J" })\nmake_flyable('MH-6J', nil)\nmake_flyable('AH-6J', nil)\n`
      )

      const installed = detectInstalledMods({ homeDir: tempHome })
      expect(installed).toEqual(['AH-6J', 'MH-6J'])
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  test('returns an empty list when no Mods/aircraft directory exists', () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), 'dcc-mods-empty-'))
    try {
      expect(detectInstalledMods({ homeDir: tempHome })).toEqual([])
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })
})
