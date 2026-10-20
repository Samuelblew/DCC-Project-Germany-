import * as z from 'zod'

import { era } from '../schemas/era'
import { task } from '../schemas/task'
import { aircraftName } from './aircraft-name'
import { loadout } from './loadout'

export const aircraft = z.object({
  chaff: z.number(),
  display_name: z.string(),
  flare: z.number(),
  ammo_type: z.number().optional(),
  gun: z.number().optional(),
  max_fuel: z.number(),
  max_height: z.number(),
  max_speed: z.number(),
  name: aircraftName,
  loadouts: z.array(loadout),
  availableTasks: z.array(task),
  controllable: z.boolean(),
  maxWaypoints: z.number().optional(),
  isHelicopter: z.boolean().default(false).optional(),
  isMod: z.boolean().default(false).optional(),
  modDirectory: z.string().optional(),
  isLarge: z.boolean().default(false).optional(),
  cruiseAltitude: z.number(),
  cruiseSpeed: z.number(),
  era,
  carrierCapable: z.boolean(),
  allowedFrequency: z.tuple([z.number(), z.number()]).optional(),
  customCallsigns: z.array(z.string()).optional(),
  AddPropAircraft: z.record(z.string(), z.string().or(z.number()).or(z.boolean())).optional(),
  datalinks: z
    .object({
      Link16: z.object({
        settings: z.record(z.string(), z.string().or(z.number()).or(z.boolean())),
        network: z
          .object({
            teamMembers: z.array(
              z.object({
                TDOA: z.boolean(),
                missionUnitId: z.number()
              })
            ),
            donors: z
              .array(
                z.object({
                  missionUnitId: z.number()
                })
              )
              .or(z.record(z.string(), z.any()))
          })
          .optional()
      })
    })
    .optional()
})
