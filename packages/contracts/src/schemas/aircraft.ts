import * as z from 'zod'

import { dcs } from '../dcs'
import { radioPlan } from './radio-plan'

export const aircraft = z.object({
  id: z.string(),
  unitName: z.string(),
  aircraftName: dcs.aircraftName,
  client: z.boolean().optional(),
  /** AI skill for this aircraft; the generator defaults to High. */
  skill: z.enum(['Average', 'Good', 'High', 'Excellent']).optional(),
  /** Explicit stores, overriding the task loadout (career flights fly what the player owns). */
  pylons: z.array(z.object({ num: z.number().int(), CLSID: z.string() })).optional(),
  /** Failures armed for this aircraft when a player flies it. */
  failures: z
    .array(z.object({ id: z.string(), label: z.string(), afterMinutes: z.number().int().min(0) }))
    .optional(),
  /** Career airframe this aircraft represents. */
  careerAirframeId: z.string().optional(),
  /** Radio presets the player set up for this aircraft (comms and ADF channels). */
  radioPlan: radioPlan.optional()
})
