/**
 * Imports a Caucasus SAM template (.miz) into `src/theatres/caucasus-cold-war/iads-network.ts`.
 *
 *   bun packages/data/scripts/import-caucasus-iads.ts [path/to/Caucasus_template.miz]
 *
 * Sites are classified by their unit types, not their group names: the 1988 template names its
 * S-300 batteries `Sa-1`, `Sa-2`, `Sa-3` and `Sa-10`. Ids get a `-CAU-` tag so they never collide
 * with the Sentry Germany ids (`SAM-SA2-1`). The whole terrain is used, Rostov included: DCC maps
 * the Caucasus with the exact DCS projection (src/coordinates/transverse-mercator.ts).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from '../../lua-table/src/index'
import type { AuthoredIadsSite, AuthoredIadsUnit } from '../src/iads/types'
import { objectives } from '../src/theatres/caucasus-cold-war/objectives'

const DEFAULT_TEMPLATE = 'C:/Users/flame/Saved Games/DCS/Missions/Caucasus_template.miz'
const templatePath = process.argv[2] ?? DEFAULT_TEMPLATE

type Family = {
  family: string
  kind: AuthoredIadsSite['kind']
  campaignType?: AuthoredIadsSite['campaignType']
  range?: number
  matches: (types: string[]) => boolean
}

const has = (types: string[], prefix: string) => types.some((type) => type.startsWith(prefix))

/** Checked in order: the S-300 battery also carries search radars. */
const families: Family[] = [
  {
    family: 'SAM-SA10',
    kind: 'sam',
    campaignType: 'SA-10-300',
    range: 75_000,
    matches: (types) => has(types, 'S-300PS')
  },
  {
    // Buk shares the SA-6 slot in campaign logic: same role, same Kub lineage.
    family: 'SAM-SA11',
    kind: 'sam',
    campaignType: 'SA-6',
    range: 35_000,
    matches: (types) => has(types, 'SA-11 Buk')
  },
  {
    family: 'SAM-SA2',
    kind: 'sam',
    campaignType: 'SA-2',
    range: 45_000,
    matches: (types) => types.includes('SNR_75V') || types.includes('S_75M_Volhov')
  },
  {
    family: 'SAM-SA3',
    kind: 'sam',
    campaignType: 'SA-3',
    range: 25_000,
    matches: (types) => types.includes('snr s-125 tr') || types.includes('5p73 s-125 ln')
  },
  {
    family: 'EWR',
    kind: 'ewr',
    matches: (types) => types.every((type) => type === '1L13 EWR' || type === '55G6 EWR')
  }
]

type RawGroup = {
  name: string
  side: 'blue' | 'red'
  category: 'vehicle' | 'static'
  x: number
  y: number
  units: Array<{ type: string; x: number; y: number; heading: number; category?: string }>
}

function extract(miz: string) {
  const dir = mkdtempSync(join(tmpdir(), 'dcc-caucasus-iads-'))
  try {
    const entries = ['mission', 'l10n/DEFAULT/dictionary']
    if (process.platform === 'win32') {
      // System32 tar is bsdtar, which reads zip. A Git Bash GNU tar earlier on PATH does not.
      const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
      execFileSync(tar, ['-xf', miz, '-C', dir, ...entries])
    } else {
      execFileSync('unzip', ['-q', miz, ...entries, '-d', dir])
    }
    return {
      mission: readFileSync(join(dir, 'mission'), 'utf8'),
      dictionary: readFileSync(join(dir, 'l10n/DEFAULT/dictionary'), 'utf8')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const luaOptions = {
  booleanKeys: true,
  mixedKeyTypes: true,
  nonPositiveIntegerKeys: true,
  sparseArray: true
}

function parseLuaAssignment(text: string, variable: string): Record<string, unknown> {
  const result = parse(text.replace(new RegExp(`^\\s*${variable}\\s*=\\s*`), ''), luaOptions)
  if (result.isErr()) throw result.error
  return result.value as Record<string, unknown>
}

function list<T>(value: unknown): T[] {
  if (value == null) return []
  return (Array.isArray(value) ? value : Object.values(value)).filter(Boolean) as T[]
}

function readGroups(miz: string): RawGroup[] {
  const { mission: missionText, dictionary: dictionaryText } = extract(miz)
  const mission = parseLuaAssignment(missionText, 'mission') as {
    coalition: Record<string, { country?: unknown }>
  }
  const dictionary = parseLuaAssignment(dictionaryText, 'dictionary') as Record<string, string>
  const resolveName = (name: string) => dictionary[name] ?? name

  const groups: RawGroup[] = []
  for (const side of ['blue', 'red'] as const) {
    for (const country of list<Record<string, { group?: unknown }>>(
      mission.coalition[side]?.country
    )) {
      for (const category of ['vehicle', 'static'] as const) {
        for (const group of list<{
          name: string
          x: number
          y: number
          units: unknown
        }>(country[category]?.group)) {
          groups.push({
            name: resolveName(group.name),
            side,
            category,
            x: group.x,
            y: group.y,
            units: list(group.units)
          })
        }
      }
    }
  }
  return groups
}

function nearestObjective(x: number, y: number) {
  let best = objectives[0]!
  let bestDistance = Number.POSITIVE_INFINITY
  for (const objective of objectives) {
    const distance = Math.hypot(objective.position.x - x, objective.position.y - y)
    if (distance < bestDistance) {
      best = objective
      bestDistance = distance
    }
  }
  return best.name
}

/** Natural order, so `Sa-2-2` comes before `Sa-2-10` and numbering stays stable on re-import. */
function byName(left: RawGroup, right: RawGroup) {
  return left.name.localeCompare(right.name, 'en', { numeric: true })
}

const round = (value: number) => Math.round(value * 1000) / 1000

function buildSites(groups: RawGroup[]) {
  const sites: AuthoredIadsSite[] = []
  const skipped: string[] = []
  const counters = new Map<string, number>()
  const nextId = (prefix: string) => {
    const count = (counters.get(prefix) ?? 0) + 1
    counters.set(prefix, count)
    return `${prefix}-CAU-${count}`
  }

  for (const group of [...groups].sort(byName)) {
    const coalition = group.side === 'blue' ? 'player' : 'opponent'
    const types = group.units.map((unit) => unit.type)

    if (group.category === 'static') {
      const unit = group.units[0]
      if (!unit || (unit.category !== 'Planes' && unit.category !== 'Helicopters')) {
        skipped.push(`${group.name} (static that is not an aircraft)`)
        continue
      }
      const id = nextId(`Static ${unit.type}`)
      sites.push({
        id,
        kind: 'airbase',
        coalition,
        objectiveId: nearestObjective(unit.x, unit.y),
        x: round(unit.x),
        y: round(unit.y),
        units: [
          {
            name: id,
            type: unit.type,
            x: round(unit.x),
            y: round(unit.y),
            heading: round(unit.heading),
            category: unit.category
          }
        ]
      })
      continue
    }

    const family = families.find((candidate) => candidate.matches(types))
    if (!family) {
      skipped.push(`${group.name} (${types.join(', ')})`)
      continue
    }
    const id = nextId(family.family)
    const x = group.units.reduce((sum, unit) => sum + unit.x, 0) / group.units.length
    const y = group.units.reduce((sum, unit) => sum + unit.y, 0) / group.units.length
    const units: AuthoredIadsUnit[] = group.units.map((unit, index) => ({
      name: `${id}-${index + 1}`,
      type: unit.type,
      x: round(unit.x),
      y: round(unit.y),
      heading: round(unit.heading)
    }))
    sites.push({
      id,
      kind: family.kind,
      coalition,
      objectiveId: nearestObjective(x, y),
      x: round(x),
      y: round(y),
      ...(family.range != null ? { range: family.range } : {}),
      ...(family.campaignType ? { campaignType: family.campaignType } : {}),
      units
    })
  }
  return { sites, skipped }
}

function literal(value: unknown): string {
  if (typeof value === 'string') return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`
  if (value && typeof value === 'object') {
    return `{ ${Object.entries(value)
      .map(([key, entry]) => `${key}: ${literal(entry)}`)
      .join(', ')} }`
  }
  return String(value)
}

const { sites, skipped } = buildSites(readGroups(templatePath))
sites.sort((left, right) => left.kind.localeCompare(right.kind) || byName(
  { name: left.id } as RawGroup,
  { name: right.id } as RawGroup
))

const output = `// Generated by scripts/import-caucasus-iads.ts from the Caucasus 1988 SAM template. Do not edit.
import type { AuthoredIadsSite } from '../../iads/types'

function site(value: AuthoredIadsSite) {
  return value
}

export const caucasusIadsSites = [
${sites.map((entry) => `  site(${literal(entry)})`).join(',\n')}
]
`

const outputPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/theatres/caucasus-cold-war/iads-network.ts'
)
writeFileSync(outputPath, output)

const counts: Record<string, number> = {}
for (const entry of sites) {
  const key = entry.kind === 'sam' ? entry.id.replace(/-CAU-\d+$/, '') : entry.kind
  counts[key] = (counts[key] ?? 0) + 1
}
console.log('Wrote', outputPath)
console.log('Sites', sites.length, counts)
console.log('Skipped', skipped.length)
for (const line of skipped) console.log('  -', line)
