import * as z from 'zod'

import { coalition } from '../../schemas/coalition'
import { era } from '../../schemas/era'
import { flightGroup } from '../../schemas/flight-group'
import { groundGroup } from '../../schemas/ground-group'
import { groundUnitType } from '../../schemas/ground-unit-type'
import { navalGroup } from '../../schemas/naval-group'
import { missionPackage } from '../../schemas/package'
import { position } from '../../schemas/position'
import { samType } from '../../schemas/sam'
import { structureBuilding } from '../../schemas/structure-building'
import { supply, supplyConvoy } from '../../schemas/supply'
import { aircraftTypesByTask } from '../../schemas/task'
import { campaignMode, career } from './career'

const campaignLogEntry = z.object({
  id: z.string(),
  type: z.enum(['spawn', 'combat', 'landing', 'campaign']),
  coalition: coalition,
  label: z.string().optional(),
  entityType: z.enum(['flightGroup', 'groundGroup']).optional(),
  entityId: z.string().optional(),
  campaignTime: z.string(),
  message: z.string(),
  createdAt: z.string()
})

export const escalationStage = z.enum(['Korea', 'Vietnam', 'Late CW', 'Modern'])

export const campaignEscalation = z.object({
  enabled: z.boolean(),
  stage: escalationStage,
  stageStartedAt: z.date(),
  eraDurationDays: z.number().int().min(1).max(30),
  history: z
    .array(
      z.object({
        stage: escalationStage,
        startedAt: z.date()
      })
    )
    .default([])
})

/** `stalemate`: the deadline passed with neither side holding its goal. */
const campaignStatus = z.enum(['active', 'won', 'lost', 'stalemate'])

/** Mission families the player can weight, as on the Falcon BMS Priorities screen. */
export const missionPriorityKind = z.enum([
  'oca',
  'sead',
  'interdiction',
  'strategic',
  'antiship',
  'dca'
])
/** Target families the player can weight. */
export const targetPriorityKind = z.enum([
  'airDefense',
  'airfields',
  'command',
  'groundForces',
  'logistics',
  'industry'
])
/** 0 never plan it, 3 as HQ would, 5 top priority. */
const priorityLevel = z.number().int().min(0).max(5)

export const commanderPriorities = z.object({
  /** Set by HQ: the player's weights are kept but not applied. */
  hq: z.boolean(),
  missions: z.partialRecord(missionPriorityKind, priorityLevel).optional(),
  targets: z.partialRecord(targetPriorityKind, priorityLevel).optional()
})

/** Rating of one player-flown flight, 1 (poor) to 5 (excellent), as the Falcon BMS debrief does. */
export const missionRating = z.object({
  at: z.date(),
  flightGroupId: z.string(),
  callsign: z.string(),
  task: z.string(),
  rating: z.number().int().min(1).max(5),
  reasons: z.array(z.string())
})

const campaignGoal = z.object({
  coalition,
  objectiveIds: z.array(z.string()).min(1)
})

const operationProfile = z.object({
  archetype: z.enum(['balanced', 'breakthrough', 'attrition', 'air-superiority', 'defense-crisis']),
  frontlineShape: z.enum(['linear', 'salient', 'split-front', 'overextended']),
  tempo: z.enum(['cautious', 'standard', 'surge']),
  initiativeCoalition: coalition.optional()
})

const groundBattleLock = z.object({
  id: z.string(),
  packageId: z.string(),
  coalition,
  attackerCoalition: coalition,
  defenderCoalition: coalition,
  attackerGroupIds: z.array(z.string()),
  defenderGroupIds: z.array(z.string()),
  targetObjectiveId: z.string().optional(),
  targetAirdromeName: z.string().optional(),
  expiresAt: z.date()
})

const storedEquipment = z.object({
  id: z.string(),
  name: z.string(),
  condition: z.enum(['operational', 'damaged']).default('operational')
})

const recoveringPersonnel = z.object({
  id: z.string(),
  count: z.number().int().positive(),
  availableAt: z.date()
})

const replacementPool = z.object({
  readyPersonnel: z.number().int().nonnegative().default(0),
  recoveringPersonnel: z.array(recoveringPersonnel).default([]),
  equipment: z.array(storedEquipment).default([])
})

const casualtyPoint = z.object({
  id: z.string(),
  objectiveId: z.string(),
  siteId: z.string().optional(),
  position,
  woundedCount: z.number().int().positive(),
  createdAt: z.date(),
  expiresAt: z.date(),
  status: z
    .enum(['awaiting-pickup', 'assigned', 'recovered', 'expired'])
    .default('awaiting-pickup'),
  assignedFlightGroupId: z.string().optional()
})

const extractionRequest = z.object({
  id: z.string(),
  groundGroupId: z.string(),
  objectiveId: z.string(),
  pickupSiteId: z.string(),
  destinationObjectiveId: z.string(),
  createdAt: z.date(),
  expiresAt: z.date(),
  retryAfter: z.date().optional(),
  status: z
    .enum(['awaiting-aircraft', 'assigned', 'embarked', 'delivered', 'failed'])
    .default('awaiting-aircraft'),
  assignedFlightGroupId: z.string().optional()
})

export const campaignDownedPilot = z.object({
  id: z.string(),
  name: z.string(),
  position,
  ejectedAt: z.date()
})

const campaignStructure = z.preprocess(
  (input) => {
    if (input == null || typeof input !== 'object') return input

    const rawStructure = input as { resources?: unknown; buildings?: unknown[] }
    if (rawStructure.resources != null) return input
    if (!Array.isArray(rawStructure.buildings)) return input

    // Backward compatibility for old saves where resources were stored on buildings.
    let migratedResources = 0
    for (const building of rawStructure.buildings) {
      if (building == null || typeof building !== 'object') continue
      const rawResources = (building as { resources?: unknown }).resources
      if (typeof rawResources === 'number') {
        migratedResources += rawResources
      }
    }

    return {
      ...rawStructure,
      resources: migratedResources
    }
  },
  z.object({
    id: z.string(),
    type: z.string(),
    objectiveId: z.string(),
    position,
    name: z.string(),
    resources: z.number().default(0),
    buildings: z.array(structureBuilding)
  })
)

export const campaignSamGroup = z.object({
  id: z.string(),
  type: samType,
  objectiveId: z.string(),
  deadUnitIndexes: z.array(z.number().int().nonnegative()).optional(),
  suppressed: z.boolean().optional(),
  destroyed: z.boolean().optional()
})

export const campaignEwrGroup = z.object({
  id: z.string(),
  type: z.string(),
  objectiveId: z.string(),
  position,
  suppressed: z.boolean().optional(),
  /** Search radar blinded while an enemy ECM orbit is on station. */
  jammed: z.boolean().optional(),
  destroyed: z.boolean().optional()
})

/** What a side last saw of an enemy unit: where, when, and from which sensor. */
export const intelContact = z.object({
  kind: z.enum(['ground', 'naval', 'convoy', 'air']),
  position,
  seenAt: z.date(),
  source: z.enum(['ground', 'radar', 'aircraft', 'naval'])
})

export const weatherPattern = z.enum(['clear', 'scattered', 'broken', 'overcast', 'rain'])

/** Campaign weather: a pattern that changes every few hours, drawn towards the climate. */
export const campaignWeather = z.object({
  pattern: weatherPattern,
  /** DCS cloud preset for the pattern; none when clear. */
  preset: z.string().optional(),
  /** Cloud base, metres above sea level. */
  cloudBase: z.number(),
  /** Surface wind: speed in m/s, direction it blows from in degrees. */
  windSpeed: z.number(),
  windDirection: z.number(),
  /** Altimeter setting, mmHg. */
  qnh: z.number(),
  /** Visibility in metres. */
  visibility: z.number(),
  /** The pattern expected next, and when it arrives. */
  forecast: weatherPattern,
  nextChangeAt: z.date()
})

const killTally = z.object({
  air: z.number().int().min(0).default(0),
  ground: z.number().int().min(0).default(0),
  static: z.number().int().min(0).default(0),
  naval: z.number().int().min(0).default(0),
  friendly: z.number().int().min(0).default(0)
})

/** One sortie the player flew, as the Falcon BMS logbook keeps it. */
export const logbookSortie = z.object({
  at: z.date(),
  callsign: z.string(),
  task: z.string(),
  aircraft: z.string(),
  rating: z.number().int().min(1).max(5),
  points: z.number(),
  kills: killTally,
  outcome: z.enum(['returned', 'ejected', 'killed', 'lost'])
})

/** The player's logbook for this campaign: points, rank, medals and the sortie record. */
export const logbook = z.object({
  points: z.number().default(0),
  missions: z.number().int().min(0).default(0),
  kills: killTally.default({ air: 0, ground: 0, static: 0, naval: 0, friendly: 0 }),
  ejections: z.number().int().min(0).default(0),
  deaths: z.number().int().min(0).default(0),
  medals: z.array(z.object({ id: z.string(), at: z.date(), reason: z.string() })).default([]),
  /** Newest last; the oldest drop off past a hundred. */
  sorties: z.array(logbookSortie).default([])
})

const sideStrength = z.object({
  /** Vehicles and soldiers alive in ground groups. */
  ground: z.number(),
  /** Airframes in the order of battle. */
  air: z.number(),
  /** Towns and airfields held. */
  territory: z.number(),
  /** SAM sites able to fire. */
  airDefense: z.number(),
  morale: z.number()
})

/** One sample of both sides' strength for the Intel screen's graphs. */
export const forceSnapshot = z.object({
  at: z.date(),
  player: sideStrength,
  opponent: sideStrength
})

const campaignCoalition = z.object({
  id: z.string(),
  countryName: z.string().optional(),
  aircraftTypes: aircraftTypesByTask,
  groundUnitTypes: z.record(groundUnitType, z.array(z.string())),
  airdromeNames: z.array(z.string()),
  objectiveIds: z.array(z.string()),
  structures: z.array(campaignStructure),
  samGroups: z.array(campaignSamGroup),
  ewrGroups: z.array(campaignEwrGroup).optional(),
  groundGroups: z.array(groundGroup),
  flightGroups: z.array(flightGroup),
  packages: z.array(missionPackage),
  downedPilots: z.array(campaignDownedPilot).optional(),
  strategicStrikeCooldownUntil: z.date().optional(),
  /** Epoch ms when an aircraft type may launch again from a field. Key is `base:type`. */
  aircraftTurnaroundUntil: z.record(z.string(), z.number()).optional(),
  supplyNodes: z.record(z.string(), supply).optional(),
  supplyConvoys: z.array(supplyConvoy).optional(),
  /**
   * Air order of battle: airframes owned per aircraft type, flying ones included. Losses take them
   * away and reinforcements trickle back up to the capacity, as Falcon BMS squadrons do.
   */
  airframes: z
    .record(
      z.string(),
      z.object({
        total: z.number().min(0),
        capacity: z.number().min(0),
        lost: z.number().min(0),
        /** Progress towards the next replacement airframe, 0 to 1. */
        reinforcement: z.number().min(0)
      })
    )
    .optional(),
  replacementPools: z.record(z.string(), replacementPool).optional(),
  casualtyPoints: z.array(casualtyPoint).optional(),
  extractionRequests: z.array(extractionRequest).optional(),
  capturedPersonnel: z.number().int().nonnegative().optional(),
  capturedEquipment: z.array(storedEquipment).optional(),
  navalGroups: z.array(navalGroup).optional(),
  /** Fog of war: enemy units this side has seen, keyed by the enemy entity id. */
  intel: z.record(z.string(), intelContact).optional(),
  /** Epoch ms before this town may raise another company. Key is the objective id. */
  groundReplacementUntil: z.record(z.string(), z.number()).optional()
})

function migrationHash(input: string) {
  let value = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return (value >>> 0).toString(16).padStart(8, '0')
}

function migrationUnitWeight(name: string) {
  if (/infantry|soldier|rifle|manpad|stinger|igla/i.test(name)) return 1
  if (/aaa|sam|shorad|air-defense/i.test(name)) return 2
  return 3
}

function migrateGroundGroups(rawCoalition: unknown) {
  if (rawCoalition == null || typeof rawCoalition !== 'object') return rawCoalition
  const coalition = rawCoalition as { groundGroups?: unknown[] }
  if (!Array.isArray(coalition.groundGroups)) return rawCoalition
  return {
    ...coalition,
    groundGroups: coalition.groundGroups.map((rawGroup) => {
      if (rawGroup == null || typeof rawGroup !== 'object') return rawGroup
      const group = rawGroup as {
        id?: unknown
        units?: unknown[]
        baselineCombatPower?: unknown
        authorizedTemplateId?: unknown
      }
      if (typeof group.id !== 'string' || !Array.isArray(group.units)) return rawGroup
      const groupId = group.id
      let ordinal = 0
      const units = group.units.flatMap((rawUnit) => {
        if (rawUnit == null || typeof rawUnit !== 'object') return []
        const unit = rawUnit as { id?: unknown; name?: unknown; count?: unknown }
        if (typeof unit.name !== 'string' || typeof unit.count !== 'number') return []
        const unitName = unit.name
        const count = Math.max(0, Math.floor(unit.count))
        return Array.from({ length: count }, () => {
          ordinal += 1
          return {
            ...unit,
            id:
              count === 1 && typeof unit.id === 'string'
                ? unit.id
                : `ground-unit-${migrationHash(`${groupId}:${ordinal}:${unitName}`)}`,
            count: 1
          }
        })
      })
      const baselineCombatPower = units.reduce(
        (sum, unit) => sum + migrationUnitWeight(String(unit.name)),
        0
      )
      return {
        ...group,
        units,
        baselineCombatPower:
          typeof group.baselineCombatPower === 'number'
            ? group.baselineCombatPower
            : Math.max(1, baselineCombatPower),
        authorizedTemplateId:
          typeof group.authorizedTemplateId === 'string'
            ? group.authorizedTemplateId
            : `formation-${migrationHash(units.map((unit) => unit.name).join('|'))}`
      }
    })
  }
}

const carrierDefeatMessage = 'Campaign lost: carrier capability destroyed'

function protectCarrierGroups(rawCoalition: unknown) {
  if (rawCoalition == null || typeof rawCoalition !== 'object') return rawCoalition
  const coalition = rawCoalition as { navalGroups?: unknown[] }
  if (!Array.isArray(coalition.navalGroups)) return rawCoalition
  return {
    ...coalition,
    navalGroups: coalition.navalGroups.map((rawGroup) => {
      if (rawGroup == null || typeof rawGroup !== 'object') return rawGroup
      const group = rawGroup as { role?: unknown; units?: unknown[] }
      if (group.role !== 'carrier') return rawGroup
      return {
        ...group,
        damage: 0,
        state: 'operational',
        units: Array.isArray(group.units)
          ? group.units.map((rawUnit) =>
              rawUnit != null && typeof rawUnit === 'object'
                ? { ...rawUnit, damage: 0, state: 'operational' }
                : rawUnit
            )
          : group.units
      }
    })
  }
}

export const campaign = z.preprocess(
  (input) => {
    if (input == null || typeof input !== 'object') return input

    const rawCampaign = input as {
      createdAt?: unknown
      updatedAt?: unknown
      status?: unknown
      timeMultiplier?: unknown
      logs?: unknown[]
      coalitions?: Record<string, unknown>
      germanyIadsDeadUnits?: unknown
      iadsDeadUnits?: unknown
    }
    const lastCampaignLog = Array.isArray(rawCampaign.logs)
      ? [...rawCampaign.logs]
          .reverse()
          .find(
            (entry) =>
              entry != null &&
              typeof entry === 'object' &&
              (entry as { type?: unknown }).type === 'campaign'
          )
      : undefined
    const recoverCarrierDefeat =
      rawCampaign.status === 'lost' &&
      lastCampaignLog != null &&
      typeof lastCampaignLog === 'object' &&
      (lastCampaignLog as { message?: unknown }).message === carrierDefeatMessage
    const coalitions = rawCampaign.coalitions
      ? Object.fromEntries(
          Object.entries(rawCampaign.coalitions).map(([key, value]) => [
            key,
            protectCarrierGroups(migrateGroundGroups(value))
          ])
        )
      : rawCampaign.coalitions
    // Saves before the Caucasus template kept authored IADS losses under the Germany-only name.
    const { germanyIadsDeadUnits: legacyIadsDeadUnits, ...currentCampaign } = rawCampaign

    return {
      ...currentCampaign,
      iadsDeadUnits: rawCampaign.iadsDeadUnits ?? legacyIadsDeadUnits,
      version: '0.2.0',
      updatedAt: rawCampaign.updatedAt ?? rawCampaign.createdAt,
      status: recoverCarrierDefeat ? 'active' : rawCampaign.status,
      timeMultiplier: recoverCarrierDefeat ? 1 : rawCampaign.timeMultiplier,
      logs: recoverCarrierDefeat
        ? rawCampaign.logs?.filter(
            (entry) =>
              entry == null ||
              typeof entry !== 'object' ||
              (entry as { message?: unknown }).message !== carrierDefeatMessage
          )
        : rawCampaign.logs,
      coalitions
    }
  },
  z.object({
    version: z.string(),
    id: z.string(),
    name: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    era: era.optional(),
    escalation: campaignEscalation.optional(),
    playerSide: z.enum(['blue', 'red']).optional(),
    /** Classic plays the whole coalition; career flies one owned aircraft with a budget. */
    mode: campaignMode.optional(),
    career: career.optional(),
    time: z.date(),
    timeMultiplier: z.number(),
    timeTarget: z.date().optional(),
    status: campaignStatus.optional(),
    goal: campaignGoal.optional(),
    /** The player's Priorities screen; only the player's own air tasking follows it. */
    priorities: commanderPriorities.optional(),
    /** The war ends in a stalemate at this campaign time if no goal was reached. */
    deadline: z.date().optional(),
    /** 0 to 100 per side, 50 neutral. Mission ratings and captures move it; it drifts back to 50. */
    morale: z.object({ player: z.number(), opponent: z.number() }).optional(),
    /** Latest ratings of the player's flights, newest last. */
    missionRatings: z.array(missionRating).optional(),
    logbook: logbook.optional(),
    weather: campaignWeather.optional(),
    /** Force levels sampled every few campaign hours, oldest first. */
    forceHistory: z.array(forceSnapshot).optional(),
    operationProfile: operationProfile.optional(),
    groundBattleLocks: z.array(groundBattleLock).optional(),
    /** A road between two towns stays closed until this epoch ms. */
    roadCuts: z
      .array(
        z.object({
          from: z.string(),
          to: z.string(),
          until: z.number()
        })
      )
      .optional(),
    /** Epoch ms when new ground axes may open. Absent means they already may. */
    groundOffensiveAt: z.number().optional(),
    /** Epoch ms when factories and power plants become the preferred strike. */
    strategicStrikeAt: z.number().optional(),
    campaignPhase: z
      .enum(['sea-control', 'landing-preparation', 'san-carlos-landing', 'land-campaign'])
      .optional(),
    landingOperation: z
      .object({
        startedAt: z.date().optional(),
        completesAt: z.date().optional(),
        reservedSiteIds: z.array(z.string()).default([]),
        completed: z.boolean().default(false)
      })
      .optional(),
    campaignParams: z
      .object({
        hotStart: z.boolean().optional(),
        aiWingmanSpawn: z.enum(['never', 'landOnly', 'always']).optional(),
        /** Corridor keeps ground and SAM along the route in the .miz. Bubble spawns them beside the player. */
        worldMode: z.enum(['corridor', 'bubble']).optional(),
        culling: z.boolean().optional(),
        cullingRadius: z.number().optional(),
        cullingAircraftRadius: z.number().optional(),
        cullingSamRadius: z.number().optional(),
        /** Ambient life written into the mission; see resolveImmersion. */
        immersion: z
          .object({
            civTraffic: z.enum(['off', 'low', 'medium', 'high']).optional(),
            groundCrew: z.boolean().optional(),
            baseLife: z.boolean().optional(),
            convoys: z.boolean().optional(),
            ambientAir: z.boolean().optional()
          })
          .optional(),
        /** Multiplier on AI air traffic; see resolveAirActivity. */
        airActivity: z.number().optional(),
        /** Enemy units show and are targeted only once seen. Defaults on. */
        fogOfWar: z.boolean().optional(),
        /** DCS skill for every enemy AI unit; unset keeps the generator's per-unit defaults. */
        enemySkill: z.enum(['Average', 'Good', 'High', 'Excellent', 'Random']).optional(),
        ewr: z.boolean().optional(),
        iads: z.boolean().optional(),
        exactTarget: z.boolean().optional(),
        casJtac: z.boolean().optional(),
        navigationVectors: z.boolean().optional(),
        navigationTargetVectors: z.boolean().optional(),
        navigationTargetTacan: z.boolean().optional(),
        navigationLandingVectors: z.boolean().optional(),
        navigationAid: z.enum(['targetVector', 'targetTacan', 'landingAirport']).optional(),
        escalationEraDays: z.number().int().min(1).max(30).optional(),
        /** DCS Gameplay cheats written into the mission options.lua. */
        dcsCheats: z
          .object({
            unlimitedWeapons: z.boolean().optional(),
            unlimitedFuel: z.boolean().optional(),
            immortal: z.boolean().optional(),
            easyFlight: z.boolean().optional(),
            labels: z.enum(['none', 'full', 'abbreviated', 'dot']).optional(),
            miniHud: z.boolean().optional(),
            radioAssist: z.boolean().optional(),
            crashRecover: z.boolean().optional(),
            unrestrictedSatnav: z.boolean().optional()
          })
          .optional()
      })
      .optional(),
    logs: z.array(campaignLogEntry).default([]),
    /** Destroyed unit names per authored IADS site id (Sentry Germany, Caucasus 1988). */
    iadsDeadUnits: z.record(z.string(), z.array(z.string())).optional(),
    scenarioId: z.string(),
    coalitions: z.record(coalition, campaignCoalition)
  })
)

export const campaignSummary = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.date(),
  updatedAt: z.date()
})
