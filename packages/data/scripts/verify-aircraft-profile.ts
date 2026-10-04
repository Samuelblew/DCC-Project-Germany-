/**
 * Checks aircraft profiles against the installed DCS modules and records what each module offers.
 *
 *   bun scripts/verify-aircraft-profile.ts "D:/DCS/DCS World" [aircraft name ...] [--write]
 *
 * For each profile (all of them when no name is given) it reads:
 *   - the module's definition Lua (full-fidelity modules): every store CLSID it knows, its
 *     `Failures` list and its `panelRadio` preset radios;
 *   - the mission editor payloads (`UnitPayloads`) and the missions bundled with the module: which
 *     store was seen on which station. Flaming Cliffs modules keep their pylon tables in binaries,
 *     so for them this is the only source.
 * It prints what the profile uses that the module does not have, and what the module supports.
 * With --write it saves the findings to src/aircraft-profiles/module-snapshots.ts, which the
 * generic profile test checks every profile against without needing DCS installed.
 *
 *   bun scripts/verify-aircraft-profile.ts "D:/DCS/DCS World" <aircraft name ...> --inspect
 *
 * Lists what a module offers before it has a profile: each store CLSID, the stations it was seen
 * on and the editor payloads that carry it (whose names tell what the store is).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

import { aircraftProfiles, type AircraftProfile } from '../src/aircraft-profiles'
import type { ModuleSnapshot } from '../src/aircraft-profiles/module-snapshot-types'

const args = process.argv.slice(2)
const write = args.includes('--write')
const inspectOnly = args.includes('--inspect')
const [dcsRoot, ...names] = args.filter((arg) => !arg.startsWith('--'))
if (!dcsRoot || !existsSync(dcsRoot) || (inspectOnly && names.length === 0)) {
  console.error(
    'usage: verify-aircraft-profile <dcs root> [aircraft name ...] [--write]\n' +
      '       verify-aircraft-profile <dcs root> <aircraft name ...> --inspect'
  )
  process.exit(1)
}

const profiles = names.length
  ? aircraftProfiles.filter((profile) => names.includes(profile.aircraftName))
  : aircraftProfiles
if (!inspectOnly && profiles.length === 0) {
  console.error(`No profile named ${names.join(', ')}`)
  process.exit(1)
}

const moduleRoots = [join(dcsRoot, 'Mods', 'aircraft'), join(dcsRoot, 'CoreMods', 'aircraft')]
const moduleDirs = moduleRoots
  .filter((root) => existsSync(root))
  .flatMap((root) => readdirSync(root).map((name) => join(root, name)))
  .filter((dir) => statSync(dir).isDirectory())

/** Lua sources can carry stray single-byte text in comments; latin1 never fails to decode. */
function readLua(path: string) {
  return readFileSync(path, 'latin1')
}

function filesIn(dir: string, extension: string, recursive: boolean): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return recursive ? filesIn(path, extension, true) : []
    return entry.name.toLowerCase().endsWith(extension) ? [path] : []
  })
}

/** The `{ ... }` table that opens at or after `from`, skipping strings and comments. */
function tableAt(text: string, from: number): string | undefined {
  const open = text.indexOf('{', from)
  if (open < 0) return undefined
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i)
      i = end < 0 ? text.length : end
      continue
    }
    if (c === '"' || c === "'") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return text.slice(open, i + 1)
  }
  return undefined
}

function tableNamed(text: string, key: string) {
  const at = text.search(new RegExp(`\\b${key}\\s*=\\s*\\{`))
  return at < 0 ? undefined : tableAt(text, at)
}

function quoted(name: string) {
  return new RegExp(`["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`)
}

type RadioInfo = ModuleSnapshot['radios'][number]

function parseRadios(definition: string): RadioInfo[] {
  const panel = tableNamed(definition, 'panelRadio')
  if (!panel) return []
  const radios: RadioInfo[] = []
  const entry = /\[\s*\d+\s*\]\s*=\s*\{/g
  let match
  while ((match = entry.exec(panel.slice(1)))) {
    const body = tableAt(panel, match.index + 1)
    if (!body) break
    const name = body.match(/name\s*=\s*_?\(?\s*"([^"]+)"/)?.[1] ?? '?'
    const rangeTable = tableNamed(body, 'range') ?? ''
    const bands = [...rangeTable.matchAll(/min\s*=\s*([\d.]+)\s*,\s*max\s*=\s*([\d.]+)/g)].map(
      (band) => [Number(band[1]), Number(band[2])] as [number, number]
    )
    const channels = (tableNamed(body, 'channels') ?? '').match(/\[\s*\d+\s*\]\s*=\s*\{/g)
    radios.push({ name, bands, channels: channels?.length ?? 0 })
    entry.lastIndex = match.index + body.length
  }
  return radios
}

type Observed = Map<string, Set<number>>

function observe(observed: Observed, clsid: string, station: number) {
  const stations = observed.get(clsid) ?? new Set<number>()
  stations.add(station)
  observed.set(clsid, stations)
}

/** Editor payload names (`"FAB-250*4,UB-13*2,..."`) carrying each CLSID. */
type PayloadNames = Map<string, Set<string>>

function withoutComments(lua: string) {
  return lua.replace(/--[^\n]*/g, '')
}

/**
 * Definitions that list each pylon's launchers, `pylon(n, type, x, y, z, { options }, { { CLSID
 * = ... }, ... })`, say outright which store goes on which station.
 */
function readDefinitionPylons(definition: string, observed: Observed) {
  const pylons = [...definition.matchAll(/\bpylon\(\s*(\d+)\s*,/g)]
  const locals = new Map(
    [...definition.matchAll(/local\s+(\w+)\s*=\s*["']([^"'\s]+)["']/g)].map(
      (match) => [match[1]!, match[2]!] as const
    )
  )
  pylons.forEach((match, index) => {
    const end = pylons[index + 1]?.index ?? definition.length
    const options = tableAt(definition, match.index)
    if (!options) return
    const optionsAt = definition.indexOf(options, match.index)
    const launchers = options.includes('CLSID')
      ? options
      : tableAt(definition, optionsAt + options.length)
    if (!launchers || definition.indexOf(launchers, optionsAt) >= end) return
    for (const value of withoutComments(launchers).matchAll(
      /CLSID\s*=\s*(?:["']([^"']+)["']|(\w+))/g
    )) {
      const clsid = value[1] ?? locals.get(value[2]!)
      if (clsid) observe(observed, clsid, Number(match[1]))
    }
  })
}

/**
 * Mission editor payload files: `{ ["CLSID"] = ..., ["num"] = n }` in either order, the CLSID
 * written out or held in a local declared at the top of the file.
 */
function readPayloads(
  path: string,
  aircraftName: string,
  observed: Observed,
  payloadNames: PayloadNames
) {
  const text = readLua(path)
  const header = new RegExp(
    `unitPayloads\\s*=\\s*\\{\\s*\\["name"\\]\\s*=\\s*${quoted(aircraftName).source}`
  )
  if (!header.test(text)) return false
  const locals = new Map(
    [...text.matchAll(/local\s+(\w+)\s*=\s*"([^"]+)"/g)].map(
      (match) => [match[1]!, match[2]!] as const
    )
  )
  const pylonsIn = (block: string) =>
    [...block.matchAll(/\{((?:[^{}"]|"[^"]*")*\["CLSID"\](?:[^{}"]|"[^"]*")*)\}/g)].flatMap(
      (pylon) => {
        const value = pylon[1]!.match(/\["CLSID"\]\s*=\s*(?:"([^"]+)"|(\w+))/)
        const clsid = value?.[1] ?? locals.get(value?.[2] ?? '')
        const num = pylon[1]!.match(/\["num"\]\s*=\s*(\d+)/)?.[1]
        return clsid && num ? [{ clsid, num: Number(num) }] : []
      }
    )
  for (const { clsid, num } of pylonsIn(text)) observe(observed, clsid, num)
  for (const payload of text.matchAll(/\["name"\]\s*=\s*"([^"]+)",\s*\["pylons"\]/g)) {
    const block = tableAt(text, payload.index + payload[0].length) ?? ''
    for (const { clsid } of pylonsIn(block)) {
      payloadNames.set(clsid, (payloadNames.get(clsid) ?? new Set()).add(payload[1]!))
    }
  }
  return true
}

/** Each table's span in a mission file, to find the unit table around a type key. */
function tableSpans(text: string) {
  const spans: Array<[number, number]> = []
  const stack: number[] = []
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') stack.push(i)
    else if (c === '}') spans.push([stack.pop()!, i])
  }
  return spans
}

/** Pylons of every unit of this type in a bundled mission, keyed `[station] = { CLSID }`. */
function readMission(path: string, aircraftName: string, observed: Observed) {
  const unzip = Bun.spawnSync(['tar', '-xOf', path, 'mission'])
  if (unzip.exitCode !== 0) return false
  const text = unzip.stdout.toString()
  const marker = `["type"] = "${aircraftName}"`
  if (!text.includes(marker)) return false
  const spans = tableSpans(text)
  for (let at = text.indexOf(marker); at >= 0; at = text.indexOf(marker, at + 1)) {
    let unit: [number, number] | undefined
    for (const span of spans) {
      if (span[0] < at && span[1] > at && (!unit || span[0] > unit[0])) unit = span
    }
    if (!unit) continue
    const body = text.slice(unit[0], unit[1])
    const pylonsAt = body.indexOf('["pylons"]')
    if (pylonsAt < 0) continue
    const block = tableAt(body, pylonsAt) ?? ''
    for (const pylon of block.matchAll(/\[(\d+)\]\s*=\s*\{\s*\["CLSID"\]\s*=\s*"([^"]+)"/g)) {
      observe(observed, pylon[2]!, Number(pylon[1]))
    }
  }
  return true
}

function readModule(name: string) {
  const sources: string[] = []
  const entryDirs = moduleDirs.filter((dir) => {
    const entry = join(dir, 'entry.lua')
    return existsSync(entry) && quoted(name).test(readLua(entry))
  })
  // Classic FC modules use MAC_flyable. The later F-5E / F-86 / MiG-15 FC packs use make_flyable
  // with a dedicated FM, but they are still Flaming Cliffs (type names end in _FC).
  const flamingCliffs =
    name.endsWith('_FC') ||
    entryDirs.some((dir) =>
      new RegExp(`MAC_flyable\\(\\s*${quoted(name).source}`).test(readLua(join(dir, 'entry.lua')))
    )

  const definitionPath = moduleDirs
    .flatMap((dir) => filesIn(dir, '.lua', false))
    .find((path) => {
      const text = readLua(path)
      return (
        /\bPylons\s*=\s*\{/.test(text) &&
        new RegExp(`\\bName\\s*=\\s*${quoted(name).source}`).test(text)
      )
    })
  const definition = definitionPath ? readLua(definitionPath) : ''
  if (definitionPath) sources.push(definitionPath)

  const known = new Set<string>()
  for (const match of definition.matchAll(/["'](\{[^"'\s]+\})["']/g)) known.add(match[1]!)
  // Old payloads name stores by CLSIDs the module now swaps for its own: ["{old}"] = New_CLSID.
  const locals = new Map(
    [...definition.matchAll(/local\s+(\w+)\s*=\s*["'](\{[^"'\s]+\})["']/g)].map(
      (match) => [match[1]!, match[2]!] as const
    )
  )
  const replacements = new Map(
    [...definition.matchAll(/\[\s*["'](\{[^"'\s]+\})["']\s*\]\s*=\s*(\w+)/g)].flatMap((match) => {
      const replacement = locals.get(match[2]!)
      return replacement ? [[match[1]!, replacement] as const] : []
    })
  )

  // The definition's own list plus the failures cockpit devices declare (Failure_name = "...").
  const failures = new Set(
    [
      ...withoutComments(tableNamed(definition, 'Failures') ?? '').matchAll(
        /\bid\s*=\s*["']([^"']+)["']/g
      )
    ].map((match) => match[1]!)
  )
  for (const dir of entryDirs) {
    for (const path of filesIn(join(dir, 'Cockpit'), '.lua', true)) {
      for (const match of readLua(path).matchAll(/Failure_name\s*=\s*["']([^"']+)["']/g)) {
        failures.add(match[1]!)
      }
    }
  }
  const radios = parseRadios(definition)

  const observed: Observed = new Map()
  const payloadNames: PayloadNames = new Map()
  const payloadFiles = [
    ...filesIn(join(dcsRoot!, 'MissionEditor', 'data', 'scripts', 'UnitPayloads'), '.lua', false),
    ...moduleDirs.flatMap((dir) => filesIn(join(dir, 'UnitPayloads'), '.lua', false))
  ]
  readDefinitionPylons(definition, observed)
  for (const path of payloadFiles) {
    if (readPayloads(path, name, observed, payloadNames)) sources.push(path)
  }
  let missions = 0
  for (const dir of entryDirs) {
    for (const path of filesIn(join(dir, 'Missions'), '.miz', true)) {
      if (readMission(path, name, observed)) missions++
    }
  }
  if (missions > 0) sources.push(`${missions} bundled missions`)
  for (const [old, replacement] of replacements) {
    for (const station of observed.get(old) ?? []) observe(observed, replacement, station)
  }
  for (const clsid of observed.keys()) known.add(clsid)

  const snapshot: ModuleSnapshot = {
    fidelity: flamingCliffs ? 'flamingCliffs' : 'full',
    sources: sources.map((source) =>
      isAbsolute(source) ? relative(dcsRoot!, source).replaceAll('\\', '/') : source
    ),
    clsids: [...known].sort(),
    observedStations: Object.fromEntries(
      [...observed]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([clsid, stations]) => [clsid, [...stations].sort((a, b) => a - b)])
    ),
    failures: [...failures].sort(),
    radios
  }
  return { snapshot, payloadNames, found: entryDirs.length > 0 || definitionPath !== undefined }
}

type ModuleInfo = ReturnType<typeof readModule>

function supportSummary({ snapshot }: ModuleInfo) {
  const { radios, failures, clsids, observedStations } = snapshot
  const stations = [...new Set(Object.values(observedStations).flat())].sort((a, b) => a - b)
  return (
    `supports: ${radios.length ? `preset radios (${radios.map((r) => `${r.name} ${r.channels} ch`).join(', ')})` : 'no preset radios'}, ` +
    `${failures.length ? `${failures.length} failures` : 'no programmable failures'}, ` +
    `${clsids.length} stores known, stations seen ${stations.join(', ') || 'none'}`
  )
}

function checkProfile(profile: AircraftProfile, module: ModuleInfo) {
  const { snapshot } = module
  const known = new Set(snapshot.clsids)
  const failures = new Set(snapshot.failures)
  const radios = snapshot.radios
  const report: string[] = []
  const problem = (line: string) => report.push(`  ✗ ${line}`)
  const note = (line: string) => report.push(`  · ${line}`)
  if (!module.found) problem('module not found in this DCS install')
  if (snapshot.fidelity !== profile.fidelity) {
    problem(`profile says ${profile.fidelity}, module is ${snapshot.fidelity}`)
  }
  for (const weapon of profile.weapons) {
    if (!known.has(weapon.id)) {
      problem(`${weapon.name}: CLSID ${weapon.id} unknown to the module`)
      continue
    }
    const seen = snapshot.observedStations[weapon.id] ?? []
    const unseen = weapon.stations.filter((num) => !seen.includes(num))
    if (unseen.length > 0) {
      const line = `${weapon.name}: never seen on station ${unseen.join(', ')} (seen on ${seen.join(', ') || 'none'})`
      if (snapshot.fidelity === 'flamingCliffs') problem(line)
      else note(line)
    }
  }
  for (const failure of profile.minorFailures) {
    if (!failures.has(failure.id)) problem(`failure ${failure.id} not in the module`)
  }
  profile.radios?.comms.forEach((radio, index) => {
    const moduleRadio = radios[radio.missionRadio - 1]
    if (!moduleRadio) return problem(`${radio.name}: module has no Radio[${radio.missionRadio}]`)
    if (radio.channels > moduleRadio.channels) {
      problem(`${radio.name}: ${radio.channels} channels, module has ${moduleRadio.channels}`)
    }
    for (const [min, max] of radio.bands) {
      if (!moduleRadio.bands.some(([low, high]) => min >= low && max <= high)) {
        problem(`${radio.name} band ${index}: ${min}-${max} MHz outside the module's bands`)
      }
    }
  })
  if (profile.radios && radios.length === 0) problem('profile programs radios the module lacks')

  note(supportSummary(module))
  return report
}

if (inspectOnly) {
  for (const name of names) {
    const module = readModule(name)
    console.log(`${name} (${module.found ? module.snapshot.fidelity : 'not installed'})`)
    for (const source of module.snapshot.sources) console.log(`  from ${source}`)
    console.log(`  ${supportSummary(module)}`)
    for (const [clsid, stations] of Object.entries(module.snapshot.observedStations)) {
      const payloads = [...(module.payloadNames.get(clsid) ?? [])]
      console.log(`  ${clsid}  stations ${stations.join(', ')}`)
      if (payloads.length) console.log(`      in: ${payloads.slice(0, 4).join(' | ')}`)
    }
  }
  process.exit(0)
}

const snapshotPath = join(import.meta.dir, '..', 'src', 'aircraft-profiles', 'module-snapshots.ts')
const existing: Record<string, ModuleSnapshot> = existsSync(snapshotPath)
  ? (await import(snapshotPath)).moduleSnapshots
  : {}
const snapshots = { ...existing }
let problems = 0
for (const profile of profiles) {
  const module = readModule(profile.aircraftName)
  const { snapshot } = module
  const report = checkProfile(profile, module)
  snapshots[profile.aircraftName] = snapshot
  problems += report.filter((line) => line.includes('✗')).length
  console.log(`${profile.aircraftName} (${snapshot.fidelity})`)
  for (const line of report) console.log(line)
}

if (write) {
  const sorted = Object.fromEntries(
    Object.entries(snapshots).sort(([a], [b]) => a.localeCompare(b))
  )
  writeFileSync(
    snapshotPath,
    [
      '// Generated by scripts/verify-aircraft-profile.ts from the installed DCS modules.',
      '// Re-run it with --write after adding an aircraft profile or updating DCS.',
      "import type { ModuleSnapshot } from './module-snapshot-types'",
      '',
      `export const moduleSnapshots: Record<string, ModuleSnapshot> = ${JSON.stringify(sorted, null, 2)}`,
      ''
    ].join('\n')
  )
  Bun.spawnSync(['bunx', 'prettier', '--write', snapshotPath], {
    stdout: 'ignore',
    stderr: 'ignore'
  })
  console.log(`Wrote ${relative(process.cwd(), snapshotPath)}`)
}
process.exit(problems > 0 ? 1 : 0)
