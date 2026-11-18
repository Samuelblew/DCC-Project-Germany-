/**
 * Review mission for the Cold War Caucasus theatre and its 1988 air defence template.
 *
 *   bun tools/generate-caucasus-ridge-review.ts <out.miz> [era]
 *
 * A client CAP leaves Kutaisi for Vladikavkaz over the Roki/Military Road crossings, so the
 * corridor culling has to keep the SAM belt on the ridge. `era` is Korea, Vietnam, Late CW or
 * Modern (default Late CW) and re-equips the authored sites the way Escalation does.
 *
 * `--survey` also measures every ground slot of the theatre in DCS: fly the mission for a few
 * seconds and each slot is written to Saved Games/DCS/Logs/dcs.log as
 * `DCC-SURVEY|<id>|<surface>|<height m>|<slope deg>` (surface 1 land, 2 shallow water, 3 water,
 * 4 road, 5 runway). `tools/read-terrain-survey.ts` turns the log into a report.
 */
import { schemas } from '@dcc/contracts'
import {
  CAUCASUS_COLD_WAR_THEATRE,
  ESCALATION_FACTION_IDS,
  type EscalationStage,
  factions,
  scenarios,
  templates,
  theatres
} from '@dcc/data'
import AdmZip from 'adm-zip'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod'

import { generateMizFromCampaign } from '../src/index'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CampaignCoalition = Campaign['coalitions']['player']

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const survey = process.argv.includes('--survey')
const era = (args[1] ?? 'Late CW') as EscalationStage
const factionIds = ESCALATION_FACTION_IDS[era]
if (!factionIds) throw new Error(`Unknown era ${era}`)

const scenario = scenarios.find((entry) => entry.id === 'caucasus-ridge')
const theatre = theatres.find((entry) => entry.name === CAUCASUS_COLD_WAR_THEATRE)
const playerFaction = factions.find((entry) => entry.id === factionIds.player)
const opponentFaction = factions.find((entry) => entry.id === factionIds.opponent)
const playerTemplate = templates.find((entry) => entry.name === playerFaction?.templateName)
const opponentTemplate = templates.find((entry) => entry.name === opponentFaction?.templateName)
if (
  !scenario ||
  !theatre ||
  !playerFaction ||
  !opponentFaction ||
  !playerTemplate ||
  !opponentTemplate
) {
  throw new Error('Caucasus Ridge campaign data is incomplete')
}

const kutaisi = theatre.airdromeDetails.Kutaisi
const vladikavkaz = theatre.objectives.find((objective) => objective.name === 'Vladikavkaz')
const capAircraft = playerFaction.aircraftTypes.CAP?.[0]
if (!kutaisi || !vladikavkaz || !capAircraft) throw new Error('Review flight data is incomplete')

function coalition(
  faction: (typeof factions)[number],
  template: (typeof templates)[number],
  start: (typeof scenario.start)['player']
): CampaignCoalition {
  return {
    id: faction.id,
    aircraftTypes: faction.aircraftTypes,
    groundUnitTypes: template.groundUnitTypes,
    airdromeNames: start.airdromeNames,
    objectiveIds: start.objectiveIds,
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: [],
    replacementPools: {},
    casualtyPoints: [],
    extractionRequests: []
  }
}

const now = scenario.date
const home = { x: kutaisi.x, y: kutaisi.y }
const campaign: Campaign = {
  version: '0.2.0',
  id: 'caucasus-ridge-review',
  name: 'Caucasus Ridge Review',
  createdAt: now,
  updatedAt: now,
  era: scenario.era,
  escalation: {
    enabled: true,
    stage: era,
    stageStartedAt: now,
    eraDurationDays: 8,
    history: [{ stage: era, startedAt: now }]
  },
  time: now,
  timeMultiplier: 1,
  status: 'active',
  goal: scenario.goal,
  campaignParams: { culling: true, ewr: true, iads: true, hotStart: false, exactTarget: true },
  logs: [],
  scenarioId: scenario.id,
  coalitions: {
    player: {
      ...coalition(playerFaction, playerTemplate, scenario.start.player),
      flightGroups: [
        {
          id: 'review-cap',
          aircrafts: [
            { id: 'review-cap-1', unitName: 'Colt-1', aircraftName: capAircraft, client: true }
          ],
          task: 'CAP',
          position: home,
          homeBase: 'Kutaisi',
          callsign: 'Colt-1',
          tot: new Date(now.getTime() + 25 * 60 * 1000),
          flightplan: {
            id: 'review-cap-plan',
            startTime: now,
            waypoints: [
              { name: 'Take Off', position: home, altitude: 0, speed: 120, type: 'TakeOff' },
              {
                name: 'Combat Air Patrol',
                position: vladikavkaz.position,
                altitude: 7_000,
                speed: 230,
                type: 'Task'
              },
              { name: 'Landing', position: home, altitude: 0, speed: 120, type: 'Landing' }
            ]
          }
        }
      ]
    },
    opponent: coalition(opponentFaction, opponentTemplate, scenario.start.opponent)
  }
}

const parsedCampaign = schemas.campaign.campaign.parse(campaign)
const outputPath = path.resolve(args[0] ?? 'caucasus-ridge-review.miz')
await mkdir(path.dirname(outputPath), { recursive: true })
const result = await generateMizFromCampaign(parsedCampaign, theatre, outputPath)
if (result.isErr()) throw result.error

if (survey) {
  const points = [
    ...(theatre.deploymentSites ?? []).flatMap((site) =>
      site.slots.map((slot) => ({ id: slot.id, x: slot.x, y: slot.y }))
    ),
    ...Object.values(theatre.targets)
      .flat()
      .flatMap((target) =>
        target.unitPositions.map((unit, index) => ({
          id: `${target.name}#${index + 1}`,
          x: unit.x,
          y: unit.y
        }))
      )
  ]
  const table = points
    .map((point) => `{${JSON.stringify(point.id)},${point.x.toFixed(1)},${point.y.toFixed(1)}}`)
    .join(',')
  const lua = `
-- DCC terrain survey: surface type and slope under every ground slot.
do
  local points = {${table}}
  local function survey()
    for _, p in ipairs(points) do
      local x, z = p[2], p[3]
      local h = land.getHeight({ x = x, y = z })
      local d = 0
      for _, o in ipairs({ { 10, 0 }, { -10, 0 }, { 0, 10 }, { 0, -10 } }) do
        d = math.max(d, math.abs(land.getHeight({ x = x + o[1], y = z + o[2] }) - h))
      end
      local slope = math.deg(math.atan(d / 10))
      env.info(string.format('DCC-SURVEY|%s|%d|%.1f|%.1f', p[1], land.getSurfaceType({ x = x, y = z }), h, slope))
    end
    env.info('DCC-SURVEY-DONE|' .. #points)
  end
  timer.scheduleFunction(survey, nil, timer.getTime() + 2)
end
`
  const zip = new AdmZip(outputPath)
  const entry = 'l10n/DEFAULT/mist.lua'
  const mist = zip.getEntry(entry)
  if (!mist) throw new Error('mist.lua missing from the mission')
  zip.updateFile(entry, Buffer.concat([mist.getData(), Buffer.from(lua, 'utf-8')]))
  zip.writeZip(outputPath)
  console.log(`Terrain survey of ${points.length} ground slots added`)
}

console.log(`Caucasus Ridge review mission (${era}): ${outputPath}`)
