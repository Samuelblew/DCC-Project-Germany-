import * as z from 'zod'

import { dcs } from '../../dcs'
import { aircraft } from '../../schemas/aircraft'
import { waypoint } from '../../schemas/flightplan'
import { radioPlan } from '../../schemas/radio-plan'
import { task } from '../../schemas/task'

/** DCS AI skill levels a hired wingman can fly at. */
export const careerPilotSkill = z.enum(['Average', 'Good', 'High', 'Excellent'])

/** A failure armed in the mission for the player's own aircraft. */
const careerFailure = z.object({
  /** DCS failure id as declared by the aircraft module. */
  id: z.string(),
  label: z.string(),
  /** Campaign minutes after mission start when the failure fires. */
  afterMinutes: z.number().int().min(0)
})

/** One individual aircraft the player owns. */
export const careerAirframe = z.object({
  id: z.string(),
  tailNumber: z.string(),
  aircraftName: dcs.aircraftName,
  condition: z.enum(['new', 'used']),
  /** Structural condition, 1 = pristine. Battle damage lowers it; repairs restore it. */
  integrity: z.number().min(0).max(1),
  /** Defects a used aircraft came with, unknown to the player until an overhaul. */
  hiddenDefects: z.array(careerFailure).default([]),
  /** Airfield the aircraft is parked at. It only changes when the aircraft lands elsewhere. */
  location: z.string(),
  /** `delivering` until `arrivesAt`: bought, paid for, and on its way to `location`. */
  status: z.enum(['ready', 'flying', 'destroyed', 'delivering']),
  arrivesAt: z.date().optional(),
  acquiredAt: z.date()
})

export const careerPilot = z.object({
  id: z.string(),
  name: z.string(),
  skill: careerPilotSkill,
  status: z.enum(['available', 'flying', 'dead']),
  hiredAt: z.date()
})

export const careerLedgerEntry = z.object({
  id: z.string(),
  time: z.date(),
  amount: z.number(),
  reason: z.string()
})

/** The flight the player launched, kept until the mission result is settled. */
export const careerSortie = z.object({
  flightGroupId: z.string(),
  /** Type the flight is crewed in; its stock receives returned stores. Older sorties lack it. */
  aircraftName: dcs.aircraftName.optional(),
  /** The flight's task at launch; decides the completion bonus. Older sorties lack it. */
  task: task.optional(),
  callsign: z.string(),
  homeBase: z.string(),
  startedAt: z.date(),
  /** The flight as planned before it was crewed, restored if the sortie stands down. */
  originalAircrafts: z.array(aircraft).optional(),
  originalWaypoints: z.array(waypoint).optional(),
  members: z.array(
    z.object({
      unitName: z.string(),
      airframeId: z.string(),
      /** Undefined for the player's own aircraft. */
      pilotId: z.string().optional(),
      /** Weapon id -> stores loaded, taken from the inventory at takeoff. */
      loaded: z.record(z.string(), z.number().int().min(0)).default({})
    })
  )
})

/** A loadout the player built station by station for one aircraft type. */
export const careerPreset = z.object({
  id: z.string(),
  aircraftName: dcs.aircraftName,
  name: z.string().min(1),
  pylons: z.array(z.object({ num: z.number().int(), CLSID: z.string() }))
})

/**
 * Fidelity only offers aircraft of the player's coalition; arcade offers any aircraft. Chosen when
 * the campaign is created.
 */
export const careerAcquisitionRule = z.enum(['fidelity', 'arcade'])

const stock = z.record(z.string(), z.number().int().min(0))

/**
 * Careers saved before several aircraft types were supported kept one `aircraftName`, a single
 * inventory and a single radio plan. They all belonged to that type.
 */
function migrateSingleAircraftCareer(input: unknown) {
  if (input == null || typeof input !== 'object') return input
  const raw = input as Record<string, unknown>
  const legacyType = typeof raw.aircraftName === 'string' ? raw.aircraftName : undefined
  if (legacyType == null) return input
  const { aircraftName: _legacyType, radio, inventory, presets, sortie, ...rest } = raw
  const legacyInventory = inventory != null && typeof inventory === 'object' ? inventory : {}
  const isFlatInventory = Object.values(legacyInventory).every((value) => typeof value === 'number')
  return {
    ...rest,
    preferredAircraft: raw.preferredAircraft ?? legacyType,
    inventory: isFlatInventory ? { [legacyType]: legacyInventory } : legacyInventory,
    radios: raw.radios ?? (radio != null ? { [legacyType]: radio } : {}),
    presets: Array.isArray(presets)
      ? presets.map((preset: unknown) =>
          preset != null && typeof preset === 'object' && !('aircraftName' in preset)
            ? { ...preset, aircraftName: legacyType }
            : preset
        )
      : presets,
    sortie:
      sortie != null && typeof sortie === 'object' && !('aircraftName' in sortie)
        ? { ...sortie, aircraftName: legacyType }
        : sortie
  }
}

export const career = z.preprocess(
  migrateSingleAircraftCareer,
  z.object({
    /** Type the career screens open on; follows the aircraft the player last crewed. */
    preferredAircraft: dcs.aircraftName,
    acquisitionRule: careerAcquisitionRule.default('fidelity'),
    money: z.number(),
    airframes: z.array(careerAirframe).default([]),
    pilots: z.array(careerPilot).default([]),
    /** Aircraft type -> weapon id (pylon CLSID) -> stores owned. Each type keeps its own stock. */
    inventory: z.record(z.string(), stock).default({}),
    presets: z.array(careerPreset).default([]),
    /** Aircraft type -> radio presets loaded into the player's aircraft on every sortie. */
    radios: z.record(z.string(), radioPlan).default({}),
    ledger: z.array(careerLedgerEntry).default([]),
    sortie: careerSortie.optional(),
    /** Set while the player is broke and grounded; a free used aircraft arrives at this time. */
    replacementAvailableAt: z.date().optional(),
    nextTailNumber: z.number().int().default(1)
  })
)

export const campaignMode = z.enum(['classic', 'career'])
