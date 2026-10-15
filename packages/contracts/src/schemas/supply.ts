import { z } from 'zod'

export const supplyStatus = z.enum([
  'abundant', // >75%
  'adequate', // 50-75%
  'low', // 25-50%
  'critical', // 5-25%
  'depleted' // 0-5%
])

export const supplyPool = z.object({
  current: z.number().min(0),
  max: z.number().min(0),
  productionRate: z.number().min(0).default(0),
  consumptionRate: z.number().min(0).default(0)
})

export const logisticsRoute = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  capacity: z.number().min(0),
  disruption: z.number().min(0).max(1).default(0),
  interdictedUntil: z.date().optional(),
  repairProgress: z.number().min(0).max(1).default(1),
  /** When the hub sends the next convoy down this route. */
  nextDispatchAt: z.date().optional()
})

/** Supply carried by one convoy, in the node pools' units. */
export const convoyCargo = z.object({
  supply: z.number().min(0),
  fuel: z.number().min(0),
  munitions: z.number().min(0),
  repair: z.number().min(0)
})

/**
 * A strategic supply run: trucks on the road graph (or a helicopter when the road is cut) carrying
 * cargo from a hub to the node the route feeds. The cargo only arrives with the convoy.
 */
export const supplyConvoy = z.object({
  id: z.string(),
  kind: z.enum(['road', 'air']),
  routeId: z.string(),
  from: z.string(),
  to: z.string(),
  /** Points from the hub to the destination; for road convoys, the towns on the way. */
  path: z.array(z.object({ x: z.number(), y: z.number() })),
  /** Index in `path` of the next point the convoy is heading for. */
  nextPoint: z.number().int().min(1),
  position: z.object({ x: z.number(), y: z.number() }),
  cargo: convoyCargo,
  /** Trucks (or helicopters) still running; the cargo shrinks with each one lost. */
  vehicles: z.number().int().min(1),
  departedAt: z.date()
})

export const virtualLogistics = z.object({
  hub: z.boolean().optional(),
  hubLevel: z.number().min(0).default(1),
  routeCapacity: z.number().min(0).optional(),
  routes: z.array(logisticsRoute).default([]),
  interdiction: z.number().min(0).max(1).default(0),
  repairRate: z.number().min(0).default(0),
  recoveryUntil: z.date().optional()
})

export const supply = z.object({
  current: z.number().min(0), // Current supply points
  max: z.number().min(0), // Storage capacity
  consumptionRate: z.number().min(0), // Drain per tick
  productionRate: z.number().min(0), // Generation per tick
  status: supplyStatus,
  fuel: supplyPool.optional(),
  munitions: supplyPool.optional(),
  repair: supplyPool.optional(),
  logistics: virtualLogistics.optional()
})

export type Supply = z.infer<typeof supply>
export type SupplyStatus = z.infer<typeof supplyStatus>
export type SupplyPool = z.infer<typeof supplyPool>
export type LogisticsRoute = z.infer<typeof logisticsRoute>
export type SupplyConvoy = z.infer<typeof supplyConvoy>
export type ConvoyCargo = z.infer<typeof convoyCargo>
export type VirtualLogistics = z.infer<typeof virtualLogistics>
