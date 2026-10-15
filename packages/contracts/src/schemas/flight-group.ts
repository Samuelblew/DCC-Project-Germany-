import * as z from 'zod'

import { aircraft } from './aircraft'
import { flightplan } from './flightplan'
import { position } from './position'
import { task } from './task'

const structureTarget = z.object({
  id: z.string(),
  type: z.string(),
  objectiveId: z.string(),
  kind: z
    .enum(['structure', 'ground-group', 'naval-group', 'troop-extraction', 'casevac'])
    .optional()
})

export const flightGroup = z.object({
  id: z.string(),
  aircrafts: z.array(aircraft),
  task,
  position,
  homeBase: z.string(),
  /**
   * Parking stand id at `homeBase` for the player's aircraft.
   * The number is the DCS stand id (`parking_id`). Unset lets the generator pick a free stand.
   */
  parkingStandId: z.string().optional(),
  callsign: z.string(),
  spawnSource: z.enum(['automatic', 'manual']).optional(),
  /** Planned by the career player for their own aircraft; never flown by the AI. */
  careerMission: z.boolean().optional(),
  target: structureTarget.optional(),
  targetDestroyed: z.boolean().optional(),
  tot: z.date().optional(),
  originalTot: z.date().optional(),
  flightplan: flightplan,
  packageId: z.string().optional(),
  /** Overrides the task patrol length. Ambush CAP stays up for 15 minutes. */
  patrolDurationMs: z.number().positive().optional(),
  // Transport-specific fields
  cargoAmount: z.number().min(0).optional(),
  sourceNode: z.string().optional(),
  destinationNode: z.string().optional(),
  cargoStatus: z.enum(['loaded', 'in-transit', 'delivered', 'lost']).optional(),
  transportType: z.enum(['strategic', 'tactical', 'emergency']).optional()
})
