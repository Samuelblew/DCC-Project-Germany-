/**
 * Headless ground-war simulation for balancing scenarios.
 *
 * Runs only the land campaign (resources -> supply -> battles/captures -> spawns -> movement) with the
 * real campaign systems. Air packages, flown missions and DCS results are not simulated, so results show
 * how the ground front behaves on its own.
 *
 * Usage (from apps/frontend):
 *   bun scripts/simulate-ground-war.ts [--scenario fulda-gap] [--runs 5] [--hours 96]
 *     [--multiplier 300] [--seed 1] [--timeline] [--events]
 */
import { schemas } from '@dcc/contracts'
import { factions, scenarios, templates, theatres } from '@dcc/data'
import type * as z from 'zod'

import { assignGroundGroups } from '../../core/src/main/api/campaign/assign-ground-groups'
import { assignStructures } from '@/logic/campaign/assign-structures'
import { updateCampaignGoal } from '@/logic/systems/campaign-goal'
import { spawnGroundGroups } from '@/logic/systems/spawn/ground-groups'
import { resolveFieldEngagements, updateGroundGroups } from '@/logic/systems/update-ground-groups'
import { updateResources } from '@/logic/systems/update-resources'
import { updateSupply } from '@/logic/systems/update-supply'
import { updateOperationProfile } from '@/logic/systems/update-operation-profile'
import { updateMorale } from '@/logic/systems/morale'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Scenario = z.infer<typeof schemas.scenario>
type Theatre = z.infer<typeof schemas.theatre>

const COALITIONS: Coalition[] = ['player', 'opponent']
const LOGIC_TICK_MS = 1000

function parseArgs() {
  const args = process.argv.slice(2)
  const value = (name: string, fallback: string) => {
    const index = args.indexOf(`--${name}`)
    return index === -1 ? fallback : (args[index + 1] ?? fallback)
  }
  return {
    scenarioId: value('scenario', 'fulda-gap'),
    runs: Number(value('runs', '5')),
    hours: Number(value('hours', '96')),
    multiplier: Number(value('multiplier', '300')),
    fastSteps: Number(value('fast-steps', '4')),
    seed: Number(value('seed', '1')),
    timeline: args.includes('--timeline'),
    events: args.includes('--events')
  }
}

/** Seeds Math.random and crypto.randomUUID so a run is reproducible for a given seed. */
function seedRandomness(seed: number) {
  let state = seed >>> 0 || 1
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  Math.random = next
  const hex = () => Math.floor(next() * 16).toString(16)
  crypto.randomUUID = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) =>
      char === 'x' ? hex() : ((Math.floor(next() * 4) + 8).toString(16) as string)
    ) as `${string}-${string}-${string}-${string}-${string}`
}

function getTemplate(factionId: string) {
  const faction = factions.find((entry) => entry.id === factionId)
  const template = templates.find((entry) => entry.name === faction?.templateName)
  if (!template) throw new Error(`No template for faction ${factionId}`)
  return template
}

function objectiveInfos(theatre: Theatre, objectiveIds: string[]) {
  return objectiveIds.map((id) => {
    const objective = theatre.objectives.find((entry) => entry.name === id)
    if (!objective) throw new Error(`Objective ${id} not found in ${theatre.name}`)
    return { id, position: objective.position, targets: theatre.targets[id] ?? [] }
  })
}

function buildCampaign(scenario: Scenario, theatre: Theatre, multiplier: number): Campaign {
  const playerTemplate = getTemplate(scenario.defaultFactionIds.player)
  const opponentTemplate = getTemplate(scenario.defaultFactionIds.opponent)
  const infos = {
    player: objectiveInfos(theatre, scenario.start.player.objectiveIds),
    opponent: objectiveInfos(theatre, scenario.start.opponent.objectiveIds)
  }

  const buildCoalition = (coalition: Coalition) => {
    const start = scenario.start[coalition]
    const enemy: Coalition = coalition === 'player' ? 'opponent' : 'player'
    const template = coalition === 'player' ? playerTemplate : opponentTemplate
    const airbases = start.airdromeNames
      .map((name) => theatre.airdromeDetails[name])
      .filter((details) => details != null)
      .map((details) => ({ x: details.x, y: details.y }))
    // Mirrors create-campaign: Fulda Gap front structures start able to spawn one formation.
    const structures = assignStructures(infos[coalition], airbases, {
      requiredStructures: start.structureAssignments
    }).map((assignment) => ({
      id: crypto.randomUUID(),
      ...assignment,
      resources:
        scenario.id === 'fulda-gap' && assignment.type === 'Barrack'
          ? 500
          : scenario.id === 'fulda-gap' && assignment.type === 'Depot'
            ? 1000
            : assignment.resources
    }))
    const groundGroups = assignGroundGroups({
      coalitionObjectives: infos[coalition],
      enemyObjectives: infos[enemy],
      template
    }).map((assignment) => ({
      id: crypto.randomUUID(),
      objectiveId: assignment.objectiveId,
      units: assignment.units,
      // Copy: assignGroundGroups returns the theatre's own position object, and movement mutates it.
      position: { ...assignment.position },
      state: 'idle' as const
    }))

    return {
      objectiveIds: [...start.objectiveIds],
      airdromeNames: [...start.airdromeNames],
      structures,
      groundGroups,
      samGroups: [],
      flightGroups: [],
      packages: [],
      groundUnitTypes: template.groundUnitTypes
    }
  }

  return {
    id: `sim-${scenario.id}`,
    scenarioId: scenario.id,
    time: new Date(scenario.date),
    timeMultiplier: multiplier,
    status: 'active',
    goal: scenario.goal,
    logs: [],
    coalitions: { player: buildCoalition('player'), opponent: buildCoalition('opponent') }
  } as unknown as Campaign
}

type RunResult = {
  status: string
  hours: number
  captures: number
  flippedObjectives: number
  playerGoalAt?: number
  opponentGoalAt?: number
  objectives: Record<Coalition, number>
  groups: Record<Coalition, { total: number; idle: number }>
  peakGroups: number
  morale: { player: number; opponent: number }
  /** Mean fill of the non-hub supply nodes (towns) at the end. */
  townSupply: Record<Coalition, number>
  /** Supply convoys on the road: average over the run and the most at once. */
  convoys: { average: number; peak: number }
  timeline: string[]
  events: Map<string, number>
}

/** Groups log messages into kinds so a run can be summarised ("field battle started", ...). */
function getEventKind(message: string) {
  if (/^Ground battle started (on the road|in the field)/.test(message))
    return 'field battle started'
  if (message.startsWith('Ground battle started')) return 'objective battle started'
  if (/^Ground combat (on the road|in the field)/.test(message)) return 'field combat tick'
  if (message.startsWith('Ground combat')) return 'objective combat tick'
  if (message.startsWith('Objective captured')) return 'objective captured'
  if (message.startsWith('Airport captured')) return 'airport captured'
  if (message.startsWith('Ground group spawned')) {
    return message.includes(' moving to ') ? 'spawned (attacking)' : 'spawned (garrison)'
  }
  if (message.endsWith('entered the replacement pool')) return 'retreated to replacement pool'
  if (message.endsWith(' surrendered')) return 'surrendered'
  const retreat = message.match(/ is ([a-z ]+)$/)
  if (retreat) return `retreat: ${retreat[1]}`
  return message.split(' ').slice(0, 3).join(' ')
}

function holdsAll(campaign: Campaign, coalition: Coalition, objectiveIds: string[] | undefined) {
  if (!objectiveIds || objectiveIds.length === 0) return false
  const held = new Set(campaign.coalitions[coalition].objectiveIds)
  return objectiveIds.every((id) => held.has(id))
}

function simulate(
  scenario: Scenario,
  theatre: Theatre,
  options: ReturnType<typeof parseArgs>
): RunResult {
  const campaign = buildCampaign(scenario, theatre, options.multiplier)
  const startMs = campaign.time.getTime()
  const hoursSinceStart = (time: Date | string) => (new Date(time).getTime() - startMs) / 3.6e6
  const logicTicks = Math.ceil((options.hours * 3600) / options.multiplier)
  const fastDelta = LOGIC_TICK_MS / options.fastSteps
  const captureCounts = new Map<string, number>()
  const timeline: string[] = []
  const events = new Map<string, number>()
  let captures = 0
  let peakGroups = 0
  let convoySum = 0
  let convoyTicks = 0
  let convoyPeak = 0
  let playerGoalAt: number | undefined
  let opponentGoalAt: number | undefined

  for (let tick = 0; tick < logicTicks && campaign.status === 'active'; tick++) {
    for (const coalition of COALITIONS) updateResources(campaign, coalition)
    for (const coalition of COALITIONS) updateSupply(campaign, coalition, LOGIC_TICK_MS)
    for (const coalition of COALITIONS) {
      updateGroundGroups(campaign, coalition, LOGIC_TICK_MS, { move: false })
    }
    resolveFieldEngagements(campaign, LOGIC_TICK_MS)
    // Same order as the campaign logic tick: posture first, it steers where columns are raised.
    updateOperationProfile(campaign)
    updateMorale(campaign, (LOGIC_TICK_MS * campaign.timeMultiplier) / 1000)
    for (const coalition of COALITIONS) spawnGroundGroups(campaign, coalition)
    updateCampaignGoal(campaign)

    for (let step = 0; step < options.fastSteps; step++) {
      campaign.time = new Date(campaign.time.getTime() + fastDelta * options.multiplier)
      for (const coalition of COALITIONS) {
        updateGroundGroups(campaign, coalition, fastDelta, { capture: false })
      }
    }

    const now = hoursSinceStart(campaign.time)
    if (playerGoalAt == null && holdsAll(campaign, 'player', scenario.goal?.objectiveIds)) {
      playerGoalAt = now
    }
    if (
      opponentGoalAt == null &&
      holdsAll(campaign, 'opponent', scenario.opponentGoal?.objectiveIds)
    ) {
      opponentGoalAt = now
    }
    const convoysNow = COALITIONS.reduce(
      (sum, coalition) => sum + (campaign.coalitions[coalition].supplyConvoys?.length ?? 0),
      0
    )
    convoySum += convoysNow
    convoyTicks += 1
    convoyPeak = Math.max(convoyPeak, convoysNow)
    peakGroups = Math.max(
      peakGroups,
      campaign.coalitions.player.groundGroups.length +
        campaign.coalitions.opponent.groundGroups.length
    )

    for (const entry of campaign.logs) {
      const kind = `${entry.coalition} ${getEventKind(entry.message)}`
      events.set(kind, (events.get(kind) ?? 0) + 1)
      const match = entry.message.match(/^(?:Objective|Airport) captured: (.+)$/)
      if (!match) continue
      captures++
      captureCounts.set(match[1]!, (captureCounts.get(match[1]!) ?? 0) + 1)
      if (options.timeline) {
        const at = hoursSinceStart(entry.campaignTime).toFixed(1).padStart(5)
        timeline.push(`${at}h ${entry.coalition.padEnd(8)} ${entry.message}`)
      }
    }
    campaign.logs.length = 0
  }

  const groupStats = (coalition: Coalition) => ({
    total: campaign.coalitions[coalition].groundGroups.length,
    idle: campaign.coalitions[coalition].groundGroups.filter((group) => group.state === 'idle')
      .length
  })

  return {
    status: campaign.status ?? 'active',
    hours: hoursSinceStart(campaign.time),
    captures,
    flippedObjectives: [...captureCounts.values()].filter((count) => count >= 2).length,
    playerGoalAt,
    opponentGoalAt,
    objectives: {
      player: campaign.coalitions.player.objectiveIds.length,
      opponent: campaign.coalitions.opponent.objectiveIds.length
    },
    groups: { player: groupStats('player'), opponent: groupStats('opponent') },
    peakGroups,
    morale: {
      player: Math.round(campaign.morale?.player ?? 50),
      opponent: Math.round(campaign.morale?.opponent ?? 50)
    },
    townSupply: {
      player: townSupplyFill(campaign, 'player'),
      opponent: townSupplyFill(campaign, 'opponent')
    },
    convoys: { average: convoyTicks > 0 ? convoySum / convoyTicks : 0, peak: convoyPeak },
    timeline,
    events
  }
}

function townSupplyFill(campaign: Campaign, coalition: Coalition) {
  const towns = Object.values(campaign.coalitions[coalition].supplyNodes ?? {}).filter(
    (supply) => supply.logistics?.hub !== true && supply.max > 0
  )
  if (towns.length === 0) return 0
  return towns.reduce((sum, supply) => sum + supply.current / supply.max, 0) / towns.length
}

function formatHours(value: number | undefined) {
  return value == null ? '-' : `${value.toFixed(1)}h`
}

function main() {
  const options = parseArgs()
  const scenario = scenarios.find((entry) => entry.id === options.scenarioId)
  if (!scenario) {
    throw new Error(
      `Unknown scenario ${options.scenarioId}. Available: ${scenarios.map((s) => s.id).join(', ')}`
    )
  }
  const theatre = theatres.find((entry) => entry.name === scenario.theatreName)
  if (!theatre) throw new Error(`Theatre ${scenario.theatreName} not found`)

  // assignStructures reports coverage on every call; keep the report readable.
  const log = console.log
  console.log = () => {}
  const results: RunResult[] = []
  for (let run = 0; run < options.runs; run++) {
    seedRandomness(options.seed + run)
    results.push(simulate(scenario, theatre, options))
  }
  console.log = log

  console.log(
    `${scenario.name}: ${options.runs} runs x ${options.hours}h at ${options.multiplier}x (seeds ${options.seed}-${options.seed + options.runs - 1})`
  )
  console.log(
    `player goal: ${scenario.goal?.objectiveIds.join(', ') ?? '-'} | opponent goal: ${scenario.opponentGoal?.objectiveIds.join(', ') ?? '-'}\n`
  )
  const header = [
    'seed',
    'status',
    'player goal',
    'opp goal',
    'captures',
    'flipped',
    'obj P/O',
    'groups P(idle)/O(idle)',
    'peak',
    'town supply P/O',
    'convoys avg/peak',
    'morale P/O'
  ]
  const rows = results.map((result, index) => [
    String(options.seed + index),
    result.status,
    formatHours(result.playerGoalAt),
    formatHours(result.opponentGoalAt),
    String(result.captures),
    String(result.flippedObjectives),
    `${result.objectives.player}/${result.objectives.opponent}`,
    `${result.groups.player.total}(${result.groups.player.idle})/${result.groups.opponent.total}(${result.groups.opponent.idle})`,
    String(result.peakGroups),
    `${Math.round(result.townSupply.player * 100)}%/${Math.round(result.townSupply.opponent * 100)}%`,
    `${result.convoys.average.toFixed(1)}/${result.convoys.peak}`,
    `${result.morale.player}/${result.morale.opponent}`
  ])
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]!.length))
  )
  const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i]!)).join('  ')
  console.log(line(header))
  console.log(widths.map((width) => '-'.repeat(width)).join('  '))
  rows.forEach((row) => console.log(line(row)))

  const opponentWins = results.filter((result) => result.opponentGoalAt != null).length
  const playerWins = results.filter((result) => result.playerGoalAt != null).length
  const average = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length
  console.log(
    `\nplayer goal reached ${playerWins}/${results.length}, opponent goal reached ${opponentWins}/${results.length}, ` +
      `avg captures ${average(results.map((r) => r.captures)).toFixed(0)}, ` +
      `avg flipped objectives ${average(results.map((r) => r.flippedObjectives)).toFixed(1)}`
  )

  if (options.events) {
    const totals = new Map<string, number>()
    for (const result of results) {
      for (const [kind, count] of result.events) totals.set(kind, (totals.get(kind) ?? 0) + count)
    }
    console.log('\nevents per run (average):')
    for (const [kind, count] of [...totals].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`  ${(count / results.length).toFixed(1).padStart(8)}  ${kind}`)
    }
  }

  if (options.timeline) {
    results.forEach((result, index) => {
      console.log(`\n--- seed ${options.seed + index} timeline ---`)
      result.timeline.forEach((entry) => console.log(entry))
    })
  }
}

main()
