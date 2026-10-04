import * as z from 'zod'

import { coalition } from './coalition'
import { flightplan } from './flightplan'
import { groundUnitType } from './ground-unit-type'
import { navalGroup } from './naval-group'
import { structureType } from './structure-type'
import { task } from './task'

const mapItem = z.object({
  id: z.string(),
  name: z.string(),
  coalition,
  position: z.object({
    lng: z.number(),
    lat: z.number()
  })
})

export const AirdromeMapItem = mapItem.extend({
  type: z.literal('Airdrome')
})

export const FlightGroupMapItem = mapItem.extend({
  type: z.literal('Flight Group'),
  task,
  flightplan,
  callsign: z.string().optional()
})

export const StructureMapItem = mapItem.extend({
  type: z.literal('Structure'),
  objectiveId: z.string(),
  structureType: structureType,
  resources: z.number().optional(),
  spawnCost: z.number().optional()
})

export const GroundGroupMapItem = mapItem.extend({
  type: z.literal('Ground Group'),
  objectiveId: z.string().optional(),
  groundGroupType: groundUnitType
})

export const DownedPilotMapItem = mapItem.extend({
  type: z.literal('Downed Pilot')
})

export const SamMapItem = mapItem.extend({
  type: z.literal('SAM'),
  objectiveId: z.string(),
  range: z.number(),
  active: z.boolean()
})

export const EwrMapItem = mapItem.extend({
  type: z.literal('EWR'),
  objectiveId: z.string(),
  active: z.boolean()
})

export const GciMapItem = mapItem.extend({
  type: z.literal('GCI'),
  objectiveId: z.string(),
  channel: z.number(),
  range: z.number(),
  active: z.boolean()
})

export const NavalGroupMapItem = mapItem.extend({
  type: z.literal('Naval Group'),
  role: navalGroup.shape.role,
  state: navalGroup.shape.state,
  heading: z.number(),
  damage: z.number().min(0).max(1),
  fuel: z.number().min(0).max(1),
  ammunition: z.number().min(0).max(1),
  cargo: z.number().nonnegative(),
  unitTypes: z.array(z.string()),
  unitCount: z.number().int().nonnegative(),
  operationalUnitCount: z.number().int().nonnegative()
})

export const MapItem = z.discriminatedUnion('type', [
  AirdromeMapItem,
  FlightGroupMapItem,
  StructureMapItem,
  GroundGroupMapItem,
  DownedPilotMapItem,
  SamMapItem,
  EwrMapItem,
  GciMapItem,
  NavalGroupMapItem
])
