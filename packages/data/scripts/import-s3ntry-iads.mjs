import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const text = readFileSync(process.argv[2], 'utf8')
const blueStart = text.indexOf('["blue"] = ', text.indexOf('["coalition"] = '))
const neutralStart = text.indexOf('["neutrals"] = ', blueStart)
const redStart = text.indexOf('["red"] = ', neutralStart)
const coalitionEnd = text.indexOf('-- end of ["coalition"]', redStart)

const objectives = [
  ['Ramstein', -498857.6875, -933510.6875],
  ['Spangdahlem', -426028.21875, -986801.0625],
  ['Hahn', -436889.46875, -947583.875],
  ['Bitburg', -428053.96875, -997282.6875],
  ['Sembach', -494129.46875, -913120.625],
  ['Zweibrucken', -522124.03125, -954430.0625],
  ['Pferdsfeld', -452328.9375, -927059.625],
  ['Mendig', -392153.28125, -935225.375],
  ['Wiesbaden', -440158.5625, -871687.125],
  ['Frankfurt', -443683.84375, -851538.6875],
  ['Fulda', -401142.09375, -768015.8125],
  ['Fritzlar', -333799.96875, -782950.9375]
]

const ranges = {
  'BSAM-HAWK': 47_400,
  'BSAM-PATRIOT': 100_000,
  'BSAM-ROLAND': 8_000,
  'BSAM-RAPIER': 6_800,
  'BSAM-SHORAD': 4_500,
  'SAM-SA2': 45_000,
  'SAM-SA3': 25_000,
  'SAM-SA5': 200_000,
  'SAM-SA6': 35_500,
  'SAM-SA8': 10_300
}

const campaignTypes = {
  'BSAM-HAWK': 'Hawk',
  'BSAM-PATRIOT': 'SA-10-300',
  'BSAM-ROLAND': 'Roland',
  'BSAM-RAPIER': 'Roland',
  'BSAM-SHORAD': 'Roland',
  'SAM-SA2': 'SA-2',
  'SAM-SA3': 'SA-3',
  'SAM-SA5': 'SA-5',
  'SAM-SA6': 'SA-6',
  'SAM-SA8': 'Roland'
}

function lastMatch(window, pattern) {
  let found
  for (const match of window.matchAll(pattern)) found = match
  return found
}

function coalitionAt(index) {
  if (index >= redStart) return 'opponent'
  if (index >= neutralStart) return 'neutral'
  if (index >= blueStart) return 'player'
  return 'neutral'
}

function familyOf(id) {
  return id.replace(/-\d+$/, '')
}

function kindOf(id, category) {
  if (category === 'Planes' || category === 'Helicopters') return 'airbase'
  if (/^(BSAM|SAM)-/.test(id)) return 'sam'
  if (/^(BEWR|EWR)-/.test(id)) return 'ewr'
  if (id.includes('Command')) return 'hq'
  if (id.startsWith('AAA-')) return 'aaa'
  if (id.startsWith('SPT-')) return 'support'
  return null
}

const raw = []
const aircraftOccupancy = new Set()
const namePattern = /\["name"\] = "([^"]+)"/g
let match
while ((match = namePattern.exec(text))) {
  const index = match.index
  if (index < blueStart || index > coalitionEnd) continue
  const coalition = coalitionAt(index)
  if (coalition === 'neutral') continue
  const before = text.slice(Math.max(blueStart, index - 500), index)
  const after = text.slice(index, index + 160)
  const typeMatch = lastMatch(before, /\["type"\] = "([^"]+)"/g)
  const xMatch = lastMatch(before, /\["x"\] = (-?[\d.]+)/g)
  const yMatch = lastMatch(before, /\["y"\] = (-?[\d.]+)/g)
  const headingMatch =
    after.match(/\["heading"\] = (-?[\d.]+)/) ?? lastMatch(before, /\["heading"\] = (-?[\d.]+)/g)
  const categoryMatch = lastMatch(before, /\["category"\] = "([^"]+)"/g)
  if (!typeMatch || !xMatch || !yMatch || !headingMatch) continue
  const name = match[1]
  const category = categoryMatch?.[1]
  const numberedUnit = /-\d+-\d+$/.test(name)
  const aircraft = category === 'Planes' || category === 'Helicopters'
  const commandUnit =
    name.includes('Command') &&
    typeMatch[1].includes('Command') &&
    (numberedUnit || !/-\d+$/.test(name))
  if (!numberedUnit && !aircraft && !commandUnit) continue
  const id = aircraft ? name : name.replace(/-\d+$/, '')
  if (!kindOf(id, aircraft ? category : undefined)) continue
  if (aircraft) {
    const occupancy = `${typeMatch[1]}:${Math.round(Number(xMatch[1]) * 1000)}:${Math.round(Number(yMatch[1]) * 1000)}`
    if (aircraftOccupancy.has(occupancy)) continue
    aircraftOccupancy.add(occupancy)
  }
  raw.push({
    id,
    name,
    coalition,
    type: typeMatch[1],
    category,
    x: Number(xMatch[1]),
    y: Number(yMatch[1]),
    heading: Number(headingMatch[1])
  })
}

const groups = new Map()
for (const unit of raw) {
  const key = `${unit.coalition}:${unit.id}`
  const group = groups.get(key) ?? []
  if (group.some((entry) => entry.name === unit.name)) continue
  group.push(unit)
  groups.set(key, group)
}

function nearestObjective(x, y) {
  let best = objectives[0]
  let bestDistance = Infinity
  for (const objective of objectives) {
    const distance = Math.hypot(objective[1] - x, objective[2] - y)
    if (distance < bestDistance) {
      best = objective
      bestDistance = distance
    }
  }
  return best[0]
}

function format(value) {
  return String(Math.round(value * 1000) / 1000)
}

const sites = []
const counts = {}
for (const group of groups.values()) {
  const first = group[0]
  const kind = kindOf(first.id, first.category)
  if (!kind) continue
  const x = group.reduce((sum, unit) => sum + unit.x, 0) / group.length
  const y = group.reduce((sum, unit) => sum + unit.y, 0) / group.length
  const family = familyOf(first.id)
  const site = {
    id: first.id,
    kind,
    coalition: first.coalition,
    objectiveId: nearestObjective(x, y),
    x,
    y,
    units: group.map((unit) => ({
      name: unit.name,
      type: unit.type,
      x: unit.x,
      y: unit.y,
      heading: unit.heading,
      category: unit.category
    }))
  }
  if (kind === 'sam') {
    site.range = ranges[family] ?? 20_000
    site.campaignType = campaignTypes[family] ?? 'Hawk'
  }
  sites.push(site)
  counts[`${kind}:${first.coalition}`] = (counts[`${kind}:${first.coalition}`] ?? 0) + 1
}

sites.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
console.log({ sites: sites.length, counts })

function field(name, value) {
  if (value == null) return ''
  return `${name}: ${typeof value === 'number' ? format(value) : `'${value.replaceAll("'", "\\'")}'`}`
}

const body = sites
  .map((site) => {
    const units = site.units
      .map((unit) => {
        const parts = [
          field('name', unit.name),
          field('type', unit.type),
          field('x', unit.x),
          field('y', unit.y),
          field('heading', unit.heading)
        ]
        if (unit.category) parts.push(field('category', unit.category))
        return `{ ${parts.filter(Boolean).join(', ')} }`
      })
      .join(', ')
    const parts = [
      field('id', site.id),
      field('kind', site.kind),
      field('coalition', site.coalition),
      field('objectiveId', site.objectiveId),
      field('x', site.x),
      field('y', site.y)
    ]
    if (site.range != null) parts.push(`range: ${site.range}`)
    if (site.campaignType) parts.push(field('campaignType', site.campaignType))
    parts.push(`units: [${units}]`)
    return `  site({ ${parts.filter(Boolean).join(', ')} })`
  })
  .join(',\n')

const output = `import type { AuthoredIadsSite } from '../../iads/types'

function site(value: AuthoredIadsSite) {
  return value
}

export const germanyIadsSites = [
${body}
]
`

const outputPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/theatres/germany-cold-war/iads-network.ts'
)
writeFileSync(outputPath, output)
console.log('Wrote', outputPath)
