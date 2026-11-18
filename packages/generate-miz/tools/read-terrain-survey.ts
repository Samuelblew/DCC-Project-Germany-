/**
 * Reads the `DCC-SURVEY|...` lines that `generate-caucasus-ridge-review.ts --survey` leaves in
 * dcs.log and lists the ground slots that sit in water or on a slope vehicles cannot hold.
 *
 *   bun tools/read-terrain-survey.ts [path/to/dcs.log] [--json out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const jsonIndex = args.indexOf('--json')
const jsonPath = jsonIndex >= 0 ? args[jsonIndex + 1] : undefined
const logPath =
  args.find((arg, index) => !arg.startsWith('--') && index !== jsonIndex + 1) ??
  'C:/Users/flame/Saved Games/DCS/Logs/dcs.log'

/** Steeper than this a parked truck or tank slides or tips in DCS. */
const MAX_SLOPE_DEG = 15
const SURFACES: Record<number, string> = {
  1: 'land',
  2: 'shallow water',
  3: 'water',
  4: 'road',
  5: 'runway'
}

type Sample = { id: string; surface: number; height: number; slope: number }

const samples = new Map<string, Sample>()
let done = false
for (const line of readFileSync(logPath, 'utf8').split(/\r?\n/)) {
  if (line.includes('DCC-SURVEY-DONE|')) done = true
  const match = line.match(/DCC-SURVEY\|(.+)\|(\d+)\|(-?[\d.]+)\|(-?[\d.]+)\s*$/)
  if (!match) continue
  samples.set(match[1]!, {
    id: match[1]!,
    surface: Number(match[2]),
    height: Number(match[3]),
    slope: Number(match[4])
  })
}

if (samples.size === 0) {
  console.log(`No DCC-SURVEY lines in ${logPath}. Fly the survey mission for a few seconds first.`)
  process.exit(1)
}

const wet = [...samples.values()].filter((sample) => sample.surface === 2 || sample.surface === 3)
const steep = [...samples.values()].filter(
  (sample) => !wet.includes(sample) && sample.slope > MAX_SLOPE_DEG
)
const objectiveOf = (id: string) => id.split(/-(?:infantry|vehicles)-\d+$|\|/)[0]!

console.log(`${samples.size} slots surveyed${done ? '' : ' (survey did not finish)'}`)
console.log(`${wet.length} in water, ${steep.length} steeper than ${MAX_SLOPE_DEG}°`)
const byObjective = new Map<string, string[]>()
for (const sample of [...wet, ...steep]) {
  const reason =
    sample.surface === 2 || sample.surface === 3
      ? SURFACES[sample.surface]!
      : `${sample.slope.toFixed(0)}°`
  const list = byObjective.get(objectiveOf(sample.id)) ?? []
  list.push(`${sample.id} (${reason})`)
  byObjective.set(objectiveOf(sample.id), list)
}
for (const [objective, problems] of [...byObjective].sort()) {
  console.log(`  ${objective}: ${problems.length}`)
}

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify([...samples.values()], null, 1))
  console.log(`Samples written to ${jsonPath}`)
}
