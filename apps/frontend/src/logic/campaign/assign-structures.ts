import { config, schemas } from '@dcc/contracts'
import { structureTemplates } from '@dcc/data'
import * as z from 'zod'

type Position = z.infer<typeof schemas.position>

function getDistance(a: Position, b: Position) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

export const StructureType = [
  'Barrack',
  'Depot',
  'Factory',
  'Factory 2',
  'Logistics Hub',
  'Power Plant',
  'Ammo Depot',
  'Fuel Storage',
  'Hospital',
  'Farp',
  'Command Center',
  'Prison',
  // Scenarios place oil platforms themselves; the greedy pass skips this type.
  'Oil Platform'
] as const

export type StructureType = (typeof StructureType)[number]

type ObjectiveInfo = {
  id: string
  position: Position
  targets: Array<{
    name: string
    type: string
    position: Position
  }>
}

type StructureAssignment = {
  objectiveId: string
  type: StructureType
  position: Position
  name: string
  resources: number
  buildings: z.infer<typeof schemas.structureBuilding>[]
}

type AssignStructuresOptions = {
  ensureEveryObjective?: boolean
  requiredStructures?: Array<{
    objectiveId: string
    targetName?: string
    type: StructureType
  }>
}

const requiredSpawnStructureTypes = ['Barrack', 'Depot'] as const satisfies readonly StructureType[]
const requiredSpawnStructureTypeSet = new Set<StructureType>(requiredSpawnStructureTypes)
const fallbackStructureTypes = [
  'Barrack',
  'Depot',
  'Logistics Hub',
  'Ammo Depot',
  'Fuel Storage',
  'Command Center'
] as const satisfies readonly StructureType[]

function createStructureAssignment(
  objective: ObjectiveInfo,
  type: StructureType,
  positionOffset: Position = { x: 0, y: 0 },
  targetName?: string
): StructureAssignment | undefined {
  const structureTargets = objective.targets.filter(
    (target) => target.type === 'Structure' && target.name.includes('|Structure|')
  )
  const target = targetName
    ? structureTargets.find((candidate) => candidate.name === targetName)
    : structureTargets[0]
  if (!target) return undefined

  const templates = structureTemplates[type]
  const template = templates[0]
  if (!template) return undefined

  return {
    objectiveId: objective.id,
    type,
    position: {
      x: target.position.x + positionOffset.x,
      y: target.position.y + positionOffset.y
    },
    name: target.name,
    resources: 0,
    buildings: template.buildings.map((building) => ({
      ...building,
      alive: building.alive ?? true
    }))
  }
}

function ensureRequiredStructures(
  assignments: StructureAssignment[],
  objectives: ObjectiveInfo[],
  requirements: NonNullable<AssignStructuresOptions['requiredStructures']>
) {
  const ensuredAssignments = [...assignments]
  const placedOnObjective = new Map<string, number>()

  for (const requirement of requirements) {
    const objective = objectives.find((candidate) => candidate.id === requirement.objectiveId)
    if (!objective) continue

    const sameObjectiveCount = placedOnObjective.get(requirement.objectiveId) ?? 0
    const assignment = createStructureAssignment(
      objective,
      requirement.type,
      { x: sameObjectiveCount * 280, y: 0 },
      requirement.targetName
    )
    if (!assignment) continue
    placedOnObjective.set(requirement.objectiveId, sameObjectiveCount + 1)

    const duplicateIndex = ensuredAssignments.findIndex(
      (candidate) =>
        candidate.objectiveId === requirement.objectiveId && candidate.type === requirement.type
    )
    if (duplicateIndex === -1) {
      ensuredAssignments.push(assignment)
    } else {
      ensuredAssignments[duplicateIndex] = assignment
    }
  }

  return ensuredAssignments
}

export function ensureRequiredSpawnStructures(
  assignments: StructureAssignment[],
  objectives: ObjectiveInfo[]
): StructureAssignment[] {
  const structureObjectives = objectives.filter((objective) =>
    objective.targets.some(
      (target) => target.type === 'Structure' && target.name.includes('|Structure|')
    )
  )

  if (structureObjectives.length === 0) {
    return assignments
  }

  const ensuredAssignments = [...assignments]
  for (const type of requiredSpawnStructureTypes) {
    if (ensuredAssignments.some((assignment) => assignment.type === type)) continue

    const objective =
      structureObjectives.find((candidate) =>
        ensuredAssignments.every((assignment) => assignment.objectiveId !== candidate.id)
      ) ?? structureObjectives[0]
    if (!objective) continue

    const sameObjectiveCount = ensuredAssignments.filter(
      (assignment) => assignment.objectiveId === objective.id
    ).length
    const assignment = createStructureAssignment(objective, type, {
      x: sameObjectiveCount * 180,
      y: 0
    })
    if (assignment) {
      ensuredAssignments.push(assignment)
    }
  }

  return ensuredAssignments
}

function ensureStructureAtEveryObjective(
  assignments: StructureAssignment[],
  objectives: ObjectiveInfo[]
) {
  const completedAssignments = [...assignments]
  const occupiedObjectives = new Set(assignments.map((assignment) => assignment.objectiveId))

  objectives.forEach((objective, index) => {
    if (occupiedObjectives.has(objective.id)) return

    const type = fallbackStructureTypes[index % fallbackStructureTypes.length]!
    const assignment = createStructureAssignment(objective, type)
    if (!assignment) return

    completedAssignments.push(assignment)
    occupiedObjectives.add(objective.id)
  })

  return completedAssignments
}

export function assignStructures(
  objectives: ObjectiveInfo[],
  airbasePositions: Position[] = [],
  options: AssignStructuresOptions = {}
): StructureAssignment[] {
  const structureObjectives = objectives.filter((objective) =>
    objective.targets.some(
      (target) => target.type === 'Structure' && target.name.includes('|Structure|')
    )
  )

  // State tracking
  const assignments = new Map<
    string,
    {
      type: StructureType
      position: Position
      name: string
      resources: number
      buildings: z.infer<typeof schemas.structureBuilding>[]
    }
  >() // objectiveId -> assignment info
  const coveredObjectives = new Map<StructureType, Set<string>>() // type -> Set<objectiveId>

  // Initialize coverage sets
  StructureType.forEach((type) => {
    coveredObjectives.set(type, new Set())
  })

  // A scenario that places its own barracks or depots decides where troops are raised; the greedy
  // pass then only spreads the other structure types.
  const scenarioPlacesSpawns = (options.requiredStructures ?? []).some((requirement) =>
    requiredSpawnStructureTypeSet.has(requirement.type)
  )
  const authoredTypes = new Set(
    (options.requiredStructures ?? [])
      .map((requirement) => requirement.type)
      .filter((type) => !requiredSpawnStructureTypeSet.has(type))
  )
  const requiredTypes = [
    ...(scenarioPlacesSpawns ? [] : requiredSpawnStructureTypes),
    ...StructureType.filter(
      (type) =>
        !requiredSpawnStructureTypeSet.has(type) &&
        !authoredTypes.has(type) &&
        type !== 'Oil Platform'
    )
  ]
  const structureExclusionRangeOverrides: Partial<Record<StructureType, number>> =
    config.structureExclusionRanges

  for (const type of requiredTypes) {
    const range = structureExclusionRangeOverrides[type] ?? config.structureExclusionRange
    const coveredSet = coveredObjectives.get(type)!

    // Helper to check if an objective is covered by currently assigned structures of this type
    // (Note: In this greedy pass, we assign one type at a time, so initially for a new type, coverage is 0 unless we decide to support multi-role structures which we don't here)

    // Identify uncovered objectives
    let uncovered = objectives.filter((obj) => !coveredSet.has(obj.id))

    while (uncovered.length > 0) {
      let bestCandidate: ObjectiveInfo | null = null
      let maxCoveredCount = -1

      // Consider candidates: objectives that don't have a structure assignment yet
      let candidates = structureObjectives.filter(
        (obj) =>
          !assignments.has(obj.id) &&
          !Array.from(assignments.values()).some(
            (assignment) =>
              assignment.type === type && getDistance(obj.position, assignment.position) < range
          )
      )

      // FARPs must not be within exclusion range of an airbase or another FARP
      if (type === 'Farp') {
        const placedFarpPositions = Array.from(assignments.values())
          .filter((a) => a.type === 'Farp')
          .map((a) => a.position)

        candidates = candidates.filter((candidate) => {
          const tooCloseToAirbase = airbasePositions.some(
            (ab) => getDistance(candidate.position, ab) < range
          )
          const tooCloseToFarp = placedFarpPositions.some(
            (fp) => getDistance(candidate.position, fp) < range
          )
          return !tooCloseToAirbase && !tooCloseToFarp
        })
      }

      if (candidates.length === 0) {
        // No more spots to place structures. Cannot achieve full coverage.
        // In a real scenario we might log a warning.
        break
      }

      for (const candidate of candidates) {
        // Calculate how many *currently uncovered* objectives this candidate would cover
        const wouldCover = uncovered.filter(
          (target) => getDistance(candidate.position, target.position) <= range
        )

        if (wouldCover.length > maxCoveredCount) {
          maxCoveredCount = wouldCover.length
          bestCandidate = candidate
        }
      }

      if (bestCandidate) {
        // Assign structure
        const assignment = createStructureAssignment(bestCandidate, type)
        if (!assignment) break

        assignments.set(bestCandidate.id, {
          type: assignment.type,
          position: assignment.position,
          name: assignment.name,
          resources: assignment.resources,
          buildings: assignment.buildings
        })

        // Update coverage
        // We need to find ALL objectives this new structure covers, not just the currently uncovered ones, to maintain accurate state if we were tracking partials,
        // but here we just care about removing from 'uncovered' list for this iteration.
        // Actually, let's update the global coveredSet for this type
        objectives.forEach((obj) => {
          if (getDistance(bestCandidate!.position, obj.position) <= range) {
            coveredSet.add(obj.id)
          }
        })

        // Update uncovered list for next loop iteration
        uncovered = objectives.filter((obj) => !coveredSet.has(obj.id))
      } else {
        // Should not happen if candidates exist and we can at least cover self
        break
      }
    }
  }

  const emptyStructureObjectiveCount = structureObjectives.filter(
    (objective) => !assignments.has(objective.id)
  ).length

  console.log(
    `Structure assignment left ${emptyStructureObjectiveCount}/${structureObjectives.length} objectives with structure targets empty because no structure type was available`
  )

  // Convert assignments map to array
  // Scenario structures go in first so the spawn-structure fallback only fills a real gap.
  const completedAssignments = ensureRequiredSpawnStructures(
    ensureRequiredStructures(
      Array.from(assignments.entries()).map(([objectiveId, info]) => ({
        objectiveId,
        type: info.type,
        position: info.position,
        name: info.name,
        resources: info.resources,
        buildings: info.buildings
      })),
      objectives,
      options.requiredStructures ?? []
    ),
    objectives
  )

  return options.ensureEveryObjective
    ? ensureStructureAtEveryObjective(completedAssignments, objectives)
    : completedAssignments
}
