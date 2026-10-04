import { getFactions } from '../data/get-factions'
import {
  assignDeploymentSite,
  ensurePersistentIadsEwrs,
  expandGroundGroupUnits,
  getCampaignDateForYear,
  getGpsEnabledCampaignDate,
  isInfantryGroundGroup
} from '@dcc/campaign'
import { getScenarios } from '../data/get-scenarios'
import { getTemplates } from '../data/get-templates'
import { pub } from '../orpc'
import * as z from 'zod'
import { config, schemas } from '@dcc/contracts'
import { writeFile, ensureDirectory, readFile, parseJson } from '../../utils'
import path from 'path'
import { getTheatre } from '../data/get-theatre'
import { assignObjectivesToCoalitions } from './assign-objectives-to-coalitions'
import { assignSams } from './assign-sams'
import {
  addCareerAircraftToTasks,
  assignStructures,
  createInitialCareer,
  pickCareerHomeBase
} from '@dcc/frontend/mission-generator'
import {
  createInitialEscalation,
  getAcquirableCareerAircraft,
  isFactionCareerAircraft,
  applyEscalationAircraftTypes,
  escalationFactionIds,
  isGermanyIadsTheatre,
  resolveCreateCampaignEra
} from '@dcc/data'
import { assignGroundGroups } from './assign-ground-groups'
import { mirrorScenarioSides } from './mirror-scenario-sides'
import { campaignsDir, stateFile } from '../../app-data'

type Coalition = z.infer<typeof schemas.coalition>
type Campaign = z.infer<typeof schemas.campaign.campaign>
type OperationProfile = NonNullable<Campaign['operationProfile']>

function createInitialStrategicStrikeCooldown(
  campaignTime: Date,
  opponentFaction: z.infer<typeof schemas.faction>
) {
  const strategicAircraftTypes = opponentFaction.aircraftTypes['Strategic Strike']
  if (!strategicAircraftTypes || strategicAircraftTypes.length === 0) {
    return undefined
  }

  const min = config.packages['Strategic Strike'].cooldownMinMs
  const max = config.packages['Strategic Strike'].cooldownMaxMs
  const cooldownMs = Math.floor(Math.random() * (max - min + 1)) + min
  return new Date(campaignTime.getTime() + cooldownMs)
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] ?? items[0]!
}

function rollOperationProfile(): OperationProfile {
  const archetypes: OperationProfile['archetype'][] = [
    'balanced',
    'breakthrough',
    'attrition',
    'air-superiority',
    'defense-crisis'
  ]
  const frontlineShapes: OperationProfile['frontlineShape'][] = [
    'linear',
    'salient',
    'split-front',
    'overextended'
  ]
  const tempos: OperationProfile['tempo'][] = ['cautious', 'standard', 'surge']
  const initiativeCoalition: Coalition = Math.random() < 0.55 ? 'opponent' : 'player'

  return {
    archetype: pickRandom(archetypes),
    frontlineShape: pickRandom(frontlineShapes),
    tempo: pickRandom(tempos),
    initiativeCoalition
  }
}

function findNearestBorderObjective(params: {
  sourceIds: string[]
  targetIds: string[]
  protectedIds: Set<string>
  objectiveMap: Map<string, { position: z.infer<typeof schemas.position> }>
}) {
  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const sourceId of params.sourceIds) {
    const source = params.objectiveMap.get(sourceId)
    if (!source) continue

    for (const targetId of params.targetIds) {
      if (params.protectedIds.has(targetId)) continue
      const target = params.objectiveMap.get(targetId)
      if (!target) continue

      const distance = Math.hypot(
        source.position.x - target.position.x,
        source.position.y - target.position.y
      )
      if (distance < bestDistance) {
        best = targetId
        bestDistance = distance
      }
    }
  }

  return best
}

function transferObjective(
  assignments: Record<Coalition, string[]>,
  from: Coalition,
  to: Coalition,
  objectiveId: string
) {
  if (assignments[from].length <= 1) return false
  const index = assignments[from].indexOf(objectiveId)
  if (index === -1 || assignments[to].includes(objectiveId)) return false

  assignments[from].splice(index, 1)
  assignments[to].push(objectiveId)
  return true
}

function applyFrontlineVariation(params: {
  assignments: Record<Coalition, string[]>
  profile: OperationProfile
  objectiveMap: Map<string, { position: z.infer<typeof schemas.position> }>
  protectedIds: Set<string>
}) {
  const initiative = params.profile.initiativeCoalition ?? 'opponent'
  const other: Coalition = initiative === 'player' ? 'opponent' : 'player'

  if (params.profile.frontlineShape === 'linear') return

  const captureForInitiative = findNearestBorderObjective({
    sourceIds: params.assignments[initiative],
    targetIds: params.assignments[other],
    protectedIds: params.protectedIds,
    objectiveMap: params.objectiveMap
  })
  if (captureForInitiative) {
    transferObjective(params.assignments, other, initiative, captureForInitiative)
  }

  if (params.profile.frontlineShape !== 'split-front') return

  const counterCapture = findNearestBorderObjective({
    sourceIds: params.assignments[other],
    targetIds: params.assignments[initiative],
    protectedIds: params.protectedIds,
    objectiveMap: params.objectiveMap
  })
  if (counterCapture) {
    transferObjective(params.assignments, initiative, other, counterCapture)
  }
}

async function setActiveCampaignId(id: string) {
  // Read existing state to preserve settings (e.g., missionExportPath)
  let existingState: Record<string, unknown> = {}
  const file = await readFile(stateFile)
  if (file.isOk()) {
    const parsed = parseJson(file.value)
    if (parsed.isOk()) {
      existingState = parsed.value as Record<string, unknown>
    }
  }
  await writeFile(stateFile, { ...existingState, activeCampaignId: id })
}

export const createCampaign = pub.campaign.createCampaign.handler(async ({ errors, input }) => {
  const scenarios = getScenarios()
  const baseScenario = scenarios.find((entry) => entry.id === input.scenarioId && entry.available)
  if (baseScenario == null) {
    throw errors.NOT_FOUND({
      data: { message: 'Scenario not found or unavailable', path: input.scenarioId }
    })
  }
  const playerSide = input.playerSide ?? 'blue'
  if (playerSide === 'red' && baseScenario.sideSelectable === false) {
    throw errors.NOT_FOUND({
      data: {
        message: 'This scenario can only be played from the blue side',
        path: input.scenarioId
      }
    })
  }
  const scenario = playerSide === 'red' ? mirrorScenarioSides(baseScenario) : baseScenario

  const theatre = getTheatre(scenario.theatreName)
  if (theatre == null) {
    throw errors.NOT_FOUND({ data: { message: 'No theatre found', path: scenario.theatreName } })
  }

  const carrierObjectiveIds = new Set(
    Object.values(scenario.start)
      .map((coalitionStart) => coalitionStart.carrierObjectiveId)
      .filter((objectiveId): objectiveId is string => objectiveId != null)
  )
  const deferredObjectiveIds = new Set(scenario.deferredObjectiveIds ?? [])
  const excludedObjectiveIds = new Set([...carrierObjectiveIds, ...deferredObjectiveIds])

  for (const objectiveId of deferredObjectiveIds) {
    if (!theatre.objectives.some((objective) => objective.name === objectiveId)) {
      throw errors.NOT_FOUND({
        data: {
          message: `Deferred objective ${objectiveId} not found in theatre ${theatre.name}`,
          path: 'scenario.deferredObjectiveIds'
        }
      })
    }
  }

  const objectives = theatre.objectives.filter(
    (objective) => !excludedObjectiveIds.has(objective.name)
  )
  const objectiveMap = new Map(objectives.map((o) => [o.name, o]))

  const strategicStart: z.infer<typeof schemas.scenario>['start'] = {
    player: {
      ...scenario.start.player,
      objectiveIds: scenario.start.player.objectiveIds.filter(
        (objectiveId) => !excludedObjectiveIds.has(objectiveId)
      )
    },
    opponent: {
      ...scenario.start.opponent,
      objectiveIds: scenario.start.opponent.objectiveIds.filter(
        (objectiveId) => !excludedObjectiveIds.has(objectiveId)
      )
    }
  }

  const objectiveAssignments = assignObjectivesToCoalitions({
    objectives,
    start: strategicStart,
    onMissingObjective: ({ coalition, objectiveId }) => {
      throw errors.NOT_FOUND({
        data: {
          message: `Objective ${objectiveId} not found in theatre ${theatre.name}`,
          path: `scenario.start.${coalition}.objectiveIds`
        }
      })
    }
  })
  const operationProfile = rollOperationProfile()
  const protectedObjectiveIds = new Set([
    ...strategicStart.player.objectiveIds,
    ...strategicStart.opponent.objectiveIds,
    ...carrierObjectiveIds,
    ...deferredObjectiveIds,
    ...(scenario.goal?.objectiveIds ?? [])
  ])
  applyFrontlineVariation({
    assignments: objectiveAssignments,
    profile: operationProfile,
    objectiveMap,
    protectedIds: protectedObjectiveIds
  })

  const getObjectiveInfos = (objectiveIds: string[]) => {
    return objectiveIds.map((id) => {
      const obj = objectiveMap.get(id)
      if (!obj) throw new Error(`Objective ${id} not found`) // Should be caught earlier but safe to check

      const targets = theatre.targets[obj.name] ?? []
      const hasSamTarget = targets.some((t) => t.type === 'SAM')
      return {
        id: obj.name,
        position: obj.position,
        hasSamTarget,
        targets: targets.map((t) => ({ name: t.name, type: t.type, position: t.position }))
      }
    })
  }

  const getStructures = (
    objectiveIds: string[],
    airdromeNames: string[],
    requiredStructures: NonNullable<
      z.infer<typeof schemas.scenario>['start']['player']['structureAssignments']
    > = []
  ) => {
    const coalitionObjectives = getObjectiveInfos(objectiveIds)
    const airbasePositions = airdromeNames
      .map((name) => theatre.airdromeDetails[name])
      .filter((details) => details != null)
      .map((details) => ({ x: details.x, y: details.y }))
    const assignments = assignStructures(coalitionObjectives, airbasePositions, {
      ensureEveryObjective: scenario.id === 'falklands-1982',
      requiredStructures
    })

    return assignments.map((assignment) => {
      return {
        id: crypto.randomUUID(),
        type: assignment.type,
        objectiveId: assignment.objectiveId,
        position: assignment.position,
        name: assignment.name,
        resources:
          scenario.id === 'fulda-gap' && assignment.type === 'Barrack'
            ? 500
            : scenario.id === 'fulda-gap' && assignment.type === 'Depot'
              ? 1000
              : assignment.resources,
        buildings: assignment.buildings
      }
    })
  }

  const factions = getFactions()
  const escalationIds = input.escalation ? escalationFactionIds('Korea', playerSide) : undefined
  const playerFaction =
    (escalationIds
      ? factions.find((faction) => faction.id === escalationIds.player)
      : undefined) ??
    input.playerFaction ??
    factions.find((faction) => faction.id === input.playerFactionId)
  const opponentFaction =
    (escalationIds
      ? factions.find((faction) => faction.id === escalationIds.opponent)
      : undefined) ??
    input.opponentFaction ??
    factions.find((faction) => faction.id === input.opponentFactionId)

  if (playerFaction == null || opponentFaction == null) {
    throw errors.NOT_FOUND({
      data: {
        message: 'Faction not found',
        path: playerFaction == null ? input.playerFactionId : input.opponentFactionId
      }
    })
  }

  if (playerFaction.id === opponentFaction.id) {
    throw errors.NOT_FOUND({
      data: {
        message: 'Player and opponent factions must be different',
        path: playerFaction.id
      }
    })
  }

  const templates = getTemplates()
  const playerTemplate = templates.find((template) => template.name === playerFaction.templateName)
  const opponentTemplate = templates.find(
    (template) => template.name === opponentFaction.templateName
  )
  if (playerTemplate == null || opponentTemplate == null) {
    throw errors.NOT_FOUND({
      data: { message: 'No templates found', path: 'usa-modern or russia-modern' }
    })
  }

  const playerStructures = getStructures(
    objectiveAssignments.player ?? [],
    scenario.start.player.airdromeNames,
    scenario.start.player.structureAssignments
  )
  const opponentStructures = getStructures(
    objectiveAssignments.opponent ?? [],
    scenario.start.opponent.airdromeNames,
    scenario.start.opponent.structureAssignments
  )

  // Assign SAM groups to both coalitions
  const playerObjectiveInfos = getObjectiveInfos(objectiveAssignments.player ?? [])
  const opponentObjectiveInfos = getObjectiveInfos(objectiveAssignments.opponent ?? [])

  // Germany fields the authored IADS network; template SAM groups would ignore the era ladder.
  const germanyIads = isGermanyIadsTheatre(theatre.name)

  // Get SAM types from templates (first SAM type defined in groundUnitTypes.SAM)
  const playerSamType = playerTemplate.groundUnitTypes.SAM?.[0] as
    | z.infer<typeof schemas.samType>
    | undefined
  const opponentSamType = opponentTemplate.groundUnitTypes.SAM?.[0] as
    | z.infer<typeof schemas.samType>
    | undefined

  // Player SAMs: cover all player objectives, no restrictions
  const playerSamAssignments =
    !germanyIads && playerSamType
      ? assignSams({
          coalitionObjectives: playerObjectiveInfos,
          samType: playerSamType
        })
      : []

  const falklandsSamAssignments: Array<{
    objectiveId: string
    type: z.infer<typeof schemas.samType>
  }> = [
    { objectiveId: 'Goose Green', type: 'Roland' },
    { objectiveId: 'Stanley Airport', type: 'Hawk' },
    { objectiveId: 'Evelyn Station Farm', type: 'Hawk' },
    { objectiveId: 'Fox Bay', type: 'Hawk' }
  ]

  // Opponent SAMs: the Falklands scenario has a deterministic reviewed network. Other scenarios
  // retain the randomized coverage allocator and its player-objective exclusion rule.
  const opponentSamAssignments = germanyIads
    ? []
    : scenario.id === 'falklands-1982'
      ? falklandsSamAssignments.filter((assignment) =>
          opponentObjectiveInfos.some(
            (objective) => objective.id === assignment.objectiveId && objective.hasSamTarget
          )
        )
      : opponentSamType
        ? assignSams({
            coalitionObjectives: opponentObjectiveInfos,
            samType: opponentSamType,
            forbiddenObjectives: playerObjectiveInfos
          })
        : []

  const playerSamGroups = playerSamAssignments.map((assignment) => ({
    id: crypto.randomUUID(),
    type: assignment.type,
    objectiveId: assignment.objectiveId
  }))

  const opponentSamGroups = opponentSamAssignments.map((assignment) => ({
    id:
      scenario.id === 'falklands-1982'
        ? `arg-${assignment.objectiveId.toLowerCase().replaceAll(' ', '-')}-${assignment.type.toLowerCase()}`
        : crypto.randomUUID(),
    type: assignment.type,
    objectiveId: assignment.objectiveId
  }))

  const playerGroundAssignments = assignGroundGroups({
    coalitionObjectives: playerObjectiveInfos,
    enemyObjectives: opponentObjectiveInfos,
    template: playerTemplate
  })

  const opponentGroundAssignments = assignGroundGroups({
    coalitionObjectives: opponentObjectiveInfos,
    enemyObjectives: playerObjectiveInfos,
    template: opponentTemplate,
    defendAllObjectives: scenario.id === 'falklands-1982'
  })

  const playerGroundGroups = (scenario.id === 'falklands-1982' ? [] : playerGroundAssignments).map(
    (assignment) => ({
      id: crypto.randomUUID(),
      objectiveId: assignment.objectiveId,
      units: assignment.units,
      position: assignment.position,
      state: 'idle' as const
    })
  )

  const opponentGroundGroups = opponentGroundAssignments.map((assignment) => ({
    id: crypto.randomUUID(),
    objectiveId: assignment.objectiveId,
    units: assignment.units,
    position: assignment.position,
    state: 'idle' as const
  }))

  // Initialize supply nodes for airdromes and objectives
  const initializeSupplyNodes = (airdromeNames: string[], objectiveIds: string[]) => {
    const supplyNodes: Record<string, z.infer<typeof schemas.supply>> = {}

    // Rear airdromes (depots) - high capacity, produce supply
    for (const airdromeName of airdromeNames.slice(0, Math.ceil(airdromeNames.length / 2))) {
      supplyNodes[airdromeName] = {
        current: 10000,
        max: 10000,
        productionRate: 20,
        consumptionRate: 0,
        status: 'abundant'
      }
    }

    // Forward airdromes - moderate capacity, no production
    for (const airdromeName of airdromeNames.slice(Math.ceil(airdromeNames.length / 2))) {
      supplyNodes[airdromeName] = {
        current: 5000,
        max: 10000,
        productionRate: 0,
        consumptionRate: 0,
        status: 'adequate'
      }
    }

    // Objectives/FARPs - low capacity, no production
    for (const objectiveId of objectiveIds) {
      if (supplyNodes[objectiveId]) continue

      supplyNodes[objectiveId] = {
        current: 500,
        max: 1000,
        productionRate: 0,
        consumptionRate: 0,
        status: 'adequate'
      }
    }

    return supplyNodes
  }

  const playerSupplyNodes = initializeSupplyNodes(
    scenario.start.player.airdromeNames,
    objectiveAssignments.player ?? []
  )

  const opponentSupplyNodes = initializeSupplyNodes(
    scenario.start.opponent.airdromeNames,
    objectiveAssignments.opponent ?? []
  )

  const applyProfileSupplyPressure = (
    supplyNodes: Record<string, z.infer<typeof schemas.supply>>,
    coalition: Coalition
  ) => {
    const objectiveIds = objectiveAssignments[coalition] ?? []
    const pressuredObjectiveId = objectiveIds.find(
      (objectiveId) => !protectedObjectiveIds.has(objectiveId)
    )
    if (!pressuredObjectiveId) return

    const node = supplyNodes[pressuredObjectiveId]
    if (!node) return

    const isInitiative = operationProfile.initiativeCoalition === coalition
    if (operationProfile.archetype === 'defense-crisis' && !isInitiative) {
      node.current = Math.min(node.current, node.max * 0.2)
      node.status = 'critical'
    } else if (operationProfile.archetype === 'attrition') {
      node.current = Math.min(node.current, node.max * 0.35)
      node.status = 'low'
    } else if (operationProfile.frontlineShape === 'overextended' && isInitiative) {
      node.current = Math.min(node.current, node.max * 0.3)
      node.status = 'low'
    }
  }

  applyProfileSupplyPressure(playerSupplyNodes, 'player')
  applyProfileSupplyPressure(opponentSupplyNodes, 'opponent')

  const now = new Date()
  const selectedCampaignTime = getCampaignDateForYear(
    scenario.date,
    input.escalation
      ? scenario.date.getUTCFullYear()
      : (input.campaignYear ?? scenario.date.getUTCFullYear())
  )
  const campaignTime = input.forceGpsEnabledDate
    ? getGpsEnabledCampaignDate(selectedCampaignTime)
    : selectedCampaignTime
  const escalation = input.escalation
    ? createInitialEscalation(campaignTime, input.escalationEraDays)
    : undefined
  const campaignEra = resolveCreateCampaignEra(input.era, input.escalation)
  const opponentStrategicStrikeCooldownUntil = createInitialStrategicStrikeCooldown(
    campaignTime,
    opponentFaction
  )

  const defaultState: z.infer<typeof schemas.campaign.campaign> = {
    version: '0.2.0',
    createdAt: now,
    updatedAt: now,
    id: crypto.randomUUID(),
    name: scenario.name,
    era: campaignEra,
    escalation,
    playerSide,
    time: campaignTime,
    timeMultiplier: 0,
    campaignParams: {
      hotStart: false,
      aiWingmanSpawn: 'landOnly',
      culling: true,
      ewr: true,
      iads: true,
      exactTarget: true,
      casJtac: true,
      navigationVectors: true,
      navigationTargetTacan: false,
      ...(escalation ? { escalationEraDays: escalation.eraDurationDays } : {})
    },
    status: 'active',
    goal: scenario.goal,
    operationProfile,
    groundBattleLocks: [],
    campaignPhase: scenario.id === 'falklands-1982' ? 'sea-control' : undefined,
    logs: [],
    scenarioId: scenario.id,
    coalitions: {
      player: {
        id: playerFaction.id,
        countryName: playerFaction.countryName,
        aircraftTypes: playerFaction.aircraftTypes,
        groundUnitTypes: playerTemplate.groundUnitTypes,
        airdromeNames: scenario.start.player.airdromeNames,
        objectiveIds: objectiveAssignments.player ?? [],
        structures: playerStructures,
        samGroups: playerSamGroups,
        groundGroups: playerGroundGroups,
        flightGroups: [],
        packages: [],
        supplyNodes: playerSupplyNodes,
        replacementPools: Object.fromEntries(
          Object.keys(playerSupplyNodes).map((nodeId) => [
            nodeId,
            { readyPersonnel: 0, recoveringPersonnel: [], equipment: [] }
          ])
        ),
        casualtyPoints: [],
        extractionRequests: [],
        navalGroups: structuredClone(scenario.navalGroups?.player ?? [])
      },
      opponent: {
        id: opponentFaction.id,
        countryName: opponentFaction.countryName,
        aircraftTypes: opponentFaction.aircraftTypes,
        groundUnitTypes: opponentTemplate.groundUnitTypes,
        airdromeNames: scenario.start.opponent.airdromeNames,
        objectiveIds: objectiveAssignments.opponent ?? [],
        structures: opponentStructures,
        samGroups: opponentSamGroups,
        groundGroups: opponentGroundGroups,
        flightGroups: [],
        packages: [],
        strategicStrikeCooldownUntil: opponentStrategicStrikeCooldownUntil,
        supplyNodes: opponentSupplyNodes,
        replacementPools: Object.fromEntries(
          Object.keys(opponentSupplyNodes).map((nodeId) => [
            nodeId,
            { readyPersonnel: 0, recoveringPersonnel: [], equipment: [] }
          ])
        ),
        casualtyPoints: [],
        extractionRequests: [],
        navalGroups: structuredClone(scenario.navalGroups?.opponent ?? [])
      }
    }
  }

  if (input.escalation) {
    applyEscalationAircraftTypes(defaultState, 'Korea')
  }

  for (const coalition of ['player', 'opponent'] as const) {
    for (const group of defaultState.coalitions[coalition].groundGroups) {
      expandGroundGroupUnits(group)
      if (!group.objectiveId) continue
      assignDeploymentSite({
        campaign: defaultState,
        coalition,
        theatre,
        group,
        objectiveId: group.objectiveId,
        roles: isInfantryGroundGroup(group) ? ['infantry', 'defensive'] : ['vehicle', 'defensive'],
        reason: 'creation',
        now: campaignTime
      })
    }
  }

  if (input.mode === 'career') {
    const acquisitionRule = input.careerAcquisitionRule ?? 'fidelity'
    const player = defaultState.coalitions.player
    const acquirable = getAcquirableCareerAircraft(acquisitionRule, player.aircraftTypes)
    const careerAircraft = input.careerAircraft
      ? acquirable.find((entry) => entry.aircraftName === input.careerAircraft)
      : acquirable[0]
    if (careerAircraft == null) {
      throw errors.NOT_FOUND({
        data: {
          message: `Career aircraft not available to the player's coalition under the ${acquisitionRule} rule`,
          path: String(input.careerAircraft)
        }
      })
    }
    player.aircraftTypes = structuredClone(player.aircraftTypes)
    // Types from outside the coalition (arcade) stay the player's own; the AI keeps its fleet.
    if (isFactionCareerAircraft(careerAircraft, player.aircraftTypes)) {
      addCareerAircraftToTasks(player.aircraftTypes, careerAircraft)
    }
    const location = pickCareerHomeBase(defaultState, theatre)
    if (location == null) {
      throw errors.NOT_FOUND({
        data: { message: 'No player airfield to base the career aircraft', path: scenario.id }
      })
    }
    defaultState.mode = 'career'
    defaultState.career = createInitialCareer({
      aircraft: careerAircraft,
      acquisitionRule,
      location,
      time: campaignTime
    })
  }

  ensurePersistentIadsEwrs(defaultState, theatre)

  const result = schemas.campaign.campaign.safeParse(defaultState)
  if (!result.success) {
    throw errors.NOT_FOUND({
      data: { message: `Invalid campaign state: ${result.error.message}`, path: 'campaign' }
    })
  }

  // Ensure campaigns directory exists
  const dirResult = await ensureDirectory(campaignsDir)
  if (dirResult.isErr()) {
    throw errors.FAILED_TO_WRITE_FILE({
      data: { path: campaignsDir, message: dirResult.error.message }
    })
  }

  // Save campaign to campaigns directory
  const campaignPath = path.join(campaignsDir, `${defaultState.id}.json`)
  const writeFileResult = await writeFile(campaignPath, defaultState)
  if (writeFileResult.isErr()) {
    throw errors.FAILED_TO_WRITE_FILE({
      data: { path: campaignPath, message: writeFileResult.error.message }
    })
  }

  // Set as active campaign
  await setActiveCampaignId(defaultState.id)

  return defaultState
})
