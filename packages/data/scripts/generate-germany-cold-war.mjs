import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const exportPath = 'C:/Users/flame/Saved Games/DCS/Missions/dcc-germanycw-airbases.json'
const outDir = path.resolve('packages/data/src/theatres/germany-cold-war')

const corridor = [
  'Ramstein',
  'Spangdahlem',
  'Hahn',
  'Bitburg',
  'Sembach',
  'Zweibrucken',
  'Pferdsfeld',
  'Mendig',
  'Wiesbaden',
  'Frankfurt',
  'Fulda',
  'Fritzlar'
]

const raw = JSON.parse(await readFile(exportPath, 'utf8'))
const byName = new Map(raw.airbases.map((airbase) => [airbase.name, airbase]))

for (const name of corridor) {
  if (!byName.has(name)) {
    throw new Error(`Missing airbase ${name}`)
  }
}

const airdromeDetails = {}
for (const airbase of raw.airbases) {
  const standlist = {}
  for (const [standId, stand] of Object.entries(airbase.standlist ?? {})) {
    if (typeof stand.x !== 'number' || typeof stand.y !== 'number') continue
    standlist[String(stand.id ?? standId)] = {
      id: String(stand.id ?? standId),
      crossroad_index: stand.crossroad_index,
      helicopter: Boolean(stand.helicopter),
      large: Boolean(stand.large),
      plane: Boolean(stand.plane),
      shelter: Boolean(stand.shelter),
      x: stand.x,
      y: stand.y
    }
  }
  airdromeDetails[airbase.name] = {
    id: airbase.id,
    name: airbase.name,
    x: airbase.x,
    y: airbase.y,
    runwayAngle: airbase.runwayAngle ?? 0,
    standlist
  }
}

const objectives = corridor.map((name) => {
  const airbase = byName.get(name)
  return {
    name,
    type: 'Airport',
    position: { x: airbase.x, y: airbase.y }
  }
})

function target(name, type, groupId, position, unitPositions) {
  return {
    name: `${name}|${type}|${groupId}`,
    position,
    type,
    groupId,
    objectiveName: name,
    unitPositions
  }
}

const targets = {}
for (const objective of objectives) {
  const { x, y } = objective.position
  const sam = { x: x + 4000, y }
  const vehicles = { x, y: y + 2500 }
  targets[objective.name] = [
    target(objective.name, 'SAM', 1, sam, [{ ...sam, heading: 0 }]),
    target(objective.name, 'Vehicle', 1, vehicles, [
      { x: vehicles.x, y: vehicles.y, heading: 0 },
      { x: vehicles.x + 18, y: vehicles.y + 12, heading: 0 },
      { x: vehicles.x - 16, y: vehicles.y + 20, heading: 0 },
      { x: vehicles.x + 10, y: vehicles.y - 18, heading: 0 }
    ])
  ]
}

const center = objectives.reduce(
  (sum, objective) => ({
    x: sum.x + objective.position.x / objectives.length,
    y: sum.y + objective.position.y / objectives.length
  }),
  { x: 0, y: 0 }
)

await mkdir(outDir, { recursive: true })

await writeFile(
  path.join(outDir, 'airdrome-details.ts'),
  `import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

// Generated from a DCS Cold War Germany airbase export. Do not edit by hand.
export const airdromeDetails: Record<string, z.infer<typeof schemas.airdromeDetails>> = ${JSON.stringify(airdromeDetails, null, 2)}
`
)

function renderObjective(objective) {
  return `  {
    name: '${objective.name}',
    type: '${objective.type}',
    position: { x: ${objective.position.x}, y: ${objective.position.y} }
  }`
}

await writeFile(
  path.join(outDir, 'objectives.ts'),
  `import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

export const objectives: z.infer<typeof schemas.objective>[] = [
${objectives.map(renderObjective).join(',\n')}
]
`
)

function renderUnit(unit) {
  return `{ x: ${unit.x}, y: ${unit.y}, heading: ${unit.heading} }`
}

function renderTarget(entry) {
  return `    {
      name: '${entry.name}',
      position: { x: ${entry.position.x}, y: ${entry.position.y} },
      type: '${entry.type}',
      groupId: ${entry.groupId},
      objectiveName: '${entry.objectiveName}',
      unitPositions: [${entry.unitPositions.map(renderUnit).join(', ')}]
    }`
}

const targetBlocks = Object.entries(targets)
  .map(([name, entries]) => `  '${name}': [\n${entries.map(renderTarget).join(',\n')}\n  ]`)
  .join(',\n')

await writeFile(
  path.join(outDir, 'targets.ts'),
  `import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

export const targets: Record<string, z.infer<typeof schemas.target>[]> = {
${targetBlocks}
}
`
)

await writeFile(
  path.join(outDir, 'index.ts'),
  `import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import { airdromeDetails } from './airdrome-details'
import { objectives } from './objectives'
import { targets } from './targets'

export const germanyColdWar: z.infer<typeof schemas.theatre> = {
  name: 'Cold War Germany',
  dcsName: 'GermanyCW',
  objectives,
  targets,
  airdromeDetails,
  info: {
    center: {
      x: ${center.x},
      y: ${center.y}
    },
    weather: {
      temperature: {
        amplitude: 8,
        mean: 16
      },
      cloudCover: {
        baseCloudCover: 0.35,
        seasonEffect: 0.25
      },
      wind: {
        speed: 3,
        direction: 250
      }
    },
    night: {
      startHour: 21,
      endHour: 5
    }
  }
}
`
)

console.log(
  `airbases ${Object.keys(airdromeDetails).length}, objectives ${objectives.length}, center ${center.x.toFixed(1)} ${center.y.toFixed(1)}`
)
