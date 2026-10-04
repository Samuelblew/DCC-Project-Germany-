import * as z from 'zod'

import { aircraftTypesByTask } from './task'

export const faction = z.object({
  id: z.string(),
  aircraftTypes: aircraftTypesByTask,
  countryName: z.string(),
  name: z.string(),
  year: z.number().optional(),
  playable: z.boolean(),
  templateName: z.string(),
  color: z.enum(['blue', 'red']),
  createdAt: z.date().optional()
})
