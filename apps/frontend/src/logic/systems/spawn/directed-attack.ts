import { config, schemas } from '@dcc/contracts'
import {
  aircrafts,
  findAuthoredIadsSite,
  getCareerAircraft,
  getSamSitePosition,
  isAuthoredIadsSamDestroyed,
  scenarios,
  theatres
} from '@dcc/data'
import * as z from 'zod'

import {
  buildAttackMissionWaypoints,
  buildCasMissionWaypoints,
  buildDeadMissionWaypoints,
  buildSeadMissionWaypoints,
  buildStrikeMissionWaypoints,
  spawnPlannedFlightGroup
} from '@/logic/entities/flight-group-spawn'
import { logCampaignAction } from '@/logic/simulation-log'
import { calculateDistance } from '@/logic/utils/calculate-distance'
import {
  getCoalitionAirdromes,
  getCoalitionCasHomeBases,
  type AirdromeSelection
} from '@/logic/systems/spawn/packages/common'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type FlightTask = z.infer<typeof schemas.task>
type Position = z.infer<typeof schemas.position>
type Theatre = z.infer<typeof schemas.theatre>

export type DirectedAttackKind =
  | 'sam'
  | 'ewr'
  | 'airdrome'
  | 'town'
  | 'structure'
  | 'ground'
  | 'naval'

export type DirectedAttackTarget = {
  kind: DirectedAttackKind
  id: string
  name: string
  objectiveId?: string
}

export type DirectedAttackPlan = {
  task: FlightTask
  aircraftType: z.infer<typeof schemas.dcs.aircraftName>
  homeBase: string
  targetPosition: Position
}

const tasksByKind: Record<DirectedAttackKind, FlightTask[]> = {
  sam: ['SEAD', 'DEAD', 'Pinpoint Strike'],
  ewr: ['SEAD', 'DEAD', 'Pinpoint Strike'],
  ground: ['CAS', 'Ground Attack', 'Pinpoint Strike'],
  naval: ['Antiship Strike', 'Pinpoint Strike'],
  airdrome: ['Pinpoint Strike', 'Ground Attack'],
  town: ['Pinpoint Strike', 'Ground Attack'],
  structure: ['Pinpoint Strike', 'Ground Attack']
}

function campaignTheatre(draft: Campaign): Theatre | null {
  const scenario = scenarios.find((candidate) => candidate.id === draft.scenarioId)
  if (!scenario) return null
  return theatres.find((candidate) => candidate.name === scenario.theatreName) ?? null
}

function resolveTargetPosition(
  draft: Campaign,
  theatre: Theatre,
  target: DirectedAttackTarget
): Position | null {
  if (target.kind === 'structure') {
    for (const coalition of [draft.coalitions.opponent, draft.coalitions.player]) {
      const structure = coalition.structures.find((candidate) => candidate.id === target.id)
      if (structure) return structure.position
    }
  }

  if (target.kind === 'ground') {
    for (const coalition of [draft.coalitions.opponent, draft.coalitions.player]) {
      const group = coalition.groundGroups.find((candidate) => candidate.id === target.id)
      if (group) return group.position
    }
  }

  if (target.kind === 'naval') {
    for (const coalition of [draft.coalitions.opponent, draft.coalitions.player]) {
      const group = coalition.navalGroups?.find((candidate) => candidate.id === target.id)
      if (group) return group.position
    }
  }

  if (target.kind === 'sam' || target.kind === 'ewr' || target.kind === 'structure') {
    const site = findAuthoredIadsSite(target.id)
    if (site) {
      if (isAuthoredIadsSamDestroyed(site, draft.iadsDeadUnits)) return null
      return { x: site.x, y: site.y }
    }
  }

  if (target.kind === 'sam' || target.kind === 'ewr') {
    const objectiveId = target.objectiveId
    if (objectiveId) return getSamSitePosition(theatre, objectiveId) ?? null
  }

  if (target.kind === 'airdrome') {
    const airdrome = theatre.airdromeDetails[target.name]
    if (airdrome) return { x: airdrome.x, y: airdrome.y }
  }

  const objectiveName = target.objectiveId ?? target.name
  return theatre.objectives.find((objective) => objective.name === objectiveName)?.position ?? null
}

function pickAircraft(draft: Campaign, tasks: FlightTask[]) {
  if (draft.career) {
    const preferred = getCareerAircraft(draft.career.preferredAircraft)
    if (preferred) {
      const matchedTask = tasks.find((task) =>
        preferred.loadouts.some((loadout) => loadout.tasks.includes(task))
      )
      if (matchedTask) {
        return {
          task: matchedTask,
          aircraftType: preferred.aircraftName as z.infer<typeof schemas.dcs.aircraftName>
        }
      }
    }
  }

  for (const task of tasks) {
    const aircraftType = draft.coalitions.player.aircraftTypes[task]?.[0]
    if (aircraftType) {
      return {
        task,
        aircraftType: aircraftType as z.infer<typeof schemas.dcs.aircraftName>
      }
    }
  }
  return null
}

function nearestHomeBase(
  draft: Campaign,
  theatre: Theatre,
  aircraftType: z.infer<typeof schemas.dcs.aircraftName>,
  targetPosition: Position
): AirdromeSelection | null {
  const isHelicopter =
    Object.values(aircrafts).find((aircraft) => aircraft.name === aircraftType)?.isHelicopter ??
    false
  const readyCareerLocations = draft.career
    ? new Set(
        draft.career.airframes
          .filter(
            (airframe) => airframe.status === 'ready' && airframe.aircraftName === aircraftType
          )
          .map((airframe) => airframe.location)
      )
    : null
  const allBases = isHelicopter
    ? getCoalitionCasHomeBases(draft, theatre, 'player', aircraftType)
    : getCoalitionAirdromes(draft, theatre, 'player')
  const bases =
    readyCareerLocations && readyCareerLocations.size > 0
      ? allBases.filter((base) => readyCareerLocations.has(base.name))
      : allBases

  let best: AirdromeSelection | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const base of bases) {
    const distance = calculateDistance(base.position, targetPosition)
    if (distance < bestDistance) {
      best = base
      bestDistance = distance
    }
  }
  return best
}

export function planDirectedAttack(
  draft: Campaign,
  target: DirectedAttackTarget
): { plan: DirectedAttackPlan | null; reason: string | null } {
  const theatre = campaignTheatre(draft)
  if (!theatre) return { plan: null, reason: 'Theatre data is not loaded.' }

  const targetPosition = resolveTargetPosition(draft, theatre, target)
  if (!targetPosition) return { plan: null, reason: 'This target has no position.' }

  const aircraft = pickAircraft(draft, tasksByKind[target.kind])
  if (!aircraft) return { plan: null, reason: 'No attack aircraft are available.' }

  const home = nearestHomeBase(draft, theatre, aircraft.aircraftType, targetPosition)
  if (!home) return { plan: null, reason: 'No friendly airbase is available.' }

  return {
    plan: {
      task: aircraft.task,
      aircraftType: aircraft.aircraftType,
      homeBase: home.name,
      targetPosition
    },
    reason: null
  }
}

function aircraftCountFor(task: FlightTask): number {
  if (!(task in config.packages)) return 2
  const packageConfig = config.packages[task as keyof typeof config.packages]
  if ('aircraftsPerGroup' in packageConfig && typeof packageConfig.aircraftsPerGroup === 'number') {
    return packageConfig.aircraftsPerGroup
  }
  return 2
}

function waypointsFor(task: FlightTask, home: Position, target: Position) {
  if (task === 'SEAD') return buildSeadMissionWaypoints(home, target)
  if (task === 'DEAD') return buildDeadMissionWaypoints(home, target)
  if (task === 'CAS') return buildCasMissionWaypoints(home, target)
  if (task === 'Ground Attack') return buildAttackMissionWaypoints(home, target)
  return buildStrikeMissionWaypoints(home, target, target)
}

function targetKind(
  kind: DirectedAttackKind
): 'structure' | 'ground-group' | 'naval-group' | undefined {
  if (kind === 'structure') return 'structure'
  if (kind === 'ground') return 'ground-group'
  if (kind === 'naval') return 'naval-group'
  return undefined
}

export function createDirectedAttack(draft: Campaign, target: DirectedAttackTarget): string | null {
  const theatre = campaignTheatre(draft)
  const planned = planDirectedAttack(draft, target)
  if (!theatre || !planned.plan) return null

  const home = nearestHomeBase(
    draft,
    theatre,
    planned.plan.aircraftType,
    planned.plan.targetPosition
  )
  if (!home) return null

  const kind = targetKind(target.kind)
  const { flightGroupId } = spawnPlannedFlightGroup({
    draft,
    coalition: 'player',
    task: planned.plan.task,
    aircraftType: planned.plan.aircraftType,
    aircraftCount: aircraftCountFor(planned.plan.task),
    homeBase: home.name,
    homeBasePosition: home.position,
    destination: planned.plan.targetPosition,
    missionWaypoints: waypointsFor(planned.plan.task, home.position, planned.plan.targetPosition),
    startTime: new Date(draft.time),
    runwayAngle: home.runwayAngle,
    target: {
      id: target.id,
      type: target.kind === 'sam' ? 'SAM' : target.kind === 'ewr' ? 'EWR' : target.name,
      objectiveId: target.objectiveId ?? target.name,
      ...(kind ? { kind } : {})
    },
    spawnSource: 'manual'
  })

  logCampaignAction(
    draft,
    'player',
    `Attack mission: ${planned.plan.task} against ${target.name} from ${home.name}`
  )

  return flightGroupId
}
