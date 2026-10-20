import * as z from 'zod'

import { coalition } from './coalition'
import { era } from './era'
import { navalGroup } from './naval-group'
import { structureType } from './structure-type'

const initialStructure = z.object({
  objectiveId: z.string(),
  targetName: z.string().optional(),
  type: structureType
})

const startObjectives = z.object({
  airdromeNames: z.array(z.string()),
  carrierObjectiveId: z.string().optional(),
  groundGroupSpawnMultiplier: z.number().positive().optional(),
  objectiveIds: z.array(z.string()),
  structureAssignments: z.array(initialStructure).optional()
})

const scenarioGoal = z.object({
  coalition,
  objectiveIds: z.array(z.string()).min(1)
})

export const scenario = z.object({
  theatreName: z.string(),
  id: z.string(),
  available: z.boolean(),
  name: z.string(),
  author: z.string().optional(),
  era,
  defaultFactionIds: z.record(coalition, z.string()).optional(),
  date: z.date(),
  briefing: z.string(),
  navalGroups: z.record(coalition, z.array(navalGroup)).optional(),
  deferredObjectiveIds: z.array(z.string()).optional(),
  goal: scenarioGoal.optional(),
  opponentGoal: scenarioGoal.optional(),
  /** Campaign days before the war ends in a stalemate. Escalation campaigns use their eras instead. */
  durationDays: z.number().positive().optional(),
  opponentBriefing: z.string().optional(),
  sideSelectable: z.boolean().optional(),
  start: z.record(coalition, startObjectives)
})
