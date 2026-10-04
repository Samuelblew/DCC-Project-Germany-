import * as z from 'zod'

const missionStateAmmo = z.object({
  typeName: z.string().optional(),
  displayName: z.string().optional(),
  count: z.number()
})

const missionStateUnit = z
  .object({
    name: z.coerce.string(),
    type: z.string(),
    x: z.number(),
    y: z.number(),
    altitude: z.number().optional(),
    heading: z.number().optional(),
    life: z.number().optional(),
    /** Life at spawn, so life / life0 is the airframe integrity. */
    life0: z.number().optional(),
    inAir: z.boolean().optional(),
    /** Stores still carried, as reported by Unit.getAmmo. */
    ammo: z.array(missionStateAmmo).optional()
  })
  .passthrough()

const missionStateTrackedUnit = z
  .object({
    name: z.coerce.string(),
    groupName: z.coerce.string().nullable().optional(),
    type: z.string().default('unknown'),
    category: z.number().optional(),
    categoryName: z.string().optional(),
    coalition: z.union([z.literal('blue'), z.literal('red'), z.number()]).optional(),
    event: z.string().optional(),
    lossType: z.string().optional(),
    killerPlayerName: z.string().optional(),
    killerUnitName: z.string().optional(),
    killerGroupName: z.string().optional(),
    weaponName: z.string().optional(),
    killCause: z.string().optional(),
    life: z.number().optional(),
    life0: z.number().optional(),
    ammo: z.array(missionStateAmmo).optional(),
    crashed: z.boolean().optional(),
    pilotEjected: z.boolean().optional(),
    pilotSurvivedCrash: z.boolean().optional(),
    time: z.number().optional(),
    x: z.number(),
    y: z.number()
  })
  .passthrough()

const missionStateGroup = z.object({
  name: z.coerce.string(),
  x: z.number(),
  y: z.number(),
  units: z.array(missionStateUnit).default([])
})

const coalitionPositions = z
  .object({
    aircraft: z.array(missionStateGroup).default([]),
    ground: z.array(missionStateGroup).default([]),
    ships: z.array(missionStateGroup).default([])
  })
  .default({ aircraft: [], ground: [], ships: [] })

// Lua JSON encoders may encode empty tables as [] instead of {}.
// Use a preprocess step to normalize arrays to the expected object shape.
const coalitionPositionsLenient = z.preprocess(
  (val) => (Array.isArray(val) ? { aircraft: [], ground: [], ships: [] } : val),
  coalitionPositions
)

const missionStateGroupPositions = z.object({
  blue: coalitionPositionsLenient,
  red: coalitionPositionsLenient
})

const cargoDeliveries = z.preprocess(
  (val) => (Array.isArray(val) ? {} : val),
  z.record(
    z.string(),
    z.object({
      time: z.number(),
      x: z.number(),
      y: z.number()
    })
  )
)

const cullingManifestRecord = z.preprocess(
  (val) => (Array.isArray(val) ? {} : val),
  z.record(z.string(), z.enum(['full', 'antiAirOnly']))
)

const cullingManifestBooleanRecord = z.preprocess(
  (val) => (Array.isArray(val) ? {} : val),
  z.record(z.string(), z.boolean())
)

const missionStateCullingManifest = z.object({
  groundGroups: z
    .object({
      player: cullingManifestRecord.default({}),
      opponent: cullingManifestRecord.default({})
    })
    .default({ player: {}, opponent: {} }),
  structures: z
    .object({
      player: cullingManifestBooleanRecord.default({}),
      opponent: cullingManifestBooleanRecord.default({})
    })
    .default({ player: {}, opponent: {} })
})

export const missionState = z
  .object({
    missionId: z.string(),
    missionEnded: z.boolean().optional(),
    time: z.number().optional(),
    ejectedPilots: z
      .array(
        z.object({
          name: z.coerce.string(),
          coalition: z.union([z.literal('blue'), z.literal('red'), z.number()]).optional(),
          time: z.number().optional(),
          x: z.number(),
          y: z.number()
        })
      )
      .default([]),
    rescuedPilots: z
      .array(
        z.object({
          pilotId: z.string(),
          pilotName: z.string().optional(),
          groupName: z.string().optional(),
          time: z.number().optional(),
          x: z.number().optional(),
          y: z.number().optional()
        })
      )
      .optional(),
    troopExtractions: z
      .array(
        z.object({
          requestId: z.string(),
          groupId: z.string(),
          flightGroupName: z.string().optional(),
          status: z.enum(['embarked', 'delivered']),
          time: z.number().optional()
        })
      )
      .default([]),
    casevacPickups: z
      .array(
        z.object({
          casualtyPointId: z.string(),
          flightGroupName: z.string().optional(),
          woundedCount: z.number().int().positive(),
          delivered: z.boolean(),
          time: z.number().optional()
        })
      )
      .default([]),
    lostUnits: z.array(missionStateTrackedUnit).default([]),
    landedUnits: z.array(missionStateTrackedUnit).default([]),
    cargoDeliveries: cargoDeliveries.default({}),
    groupPositions: missionStateGroupPositions.optional(),
    cullingManifest: missionStateCullingManifest.optional()
  })
  .passthrough()
