import type { schemas } from '@dcc/contracts'
import type * as z from 'zod'

type GroundUnitTypes = z.infer<typeof schemas.campaign.campaign>['coalitions']['player']['groundUnitTypes']
type Position = { x: number; y: number }

export const DETACHMENT_INFANTRY = 8
/** Below this the barrack keeps the men in the pool instead of sending a fragment. */
export const DETACHMENT_MIN_INFANTRY = 4

/**
 * Preference is the piece that belongs with a company team in that era.
 * The faction list is already the escalation kit, so the first name that
 * faction actually owns wins. A Korea list never contains an Abrams.
 */
const TANKS = [
  'M-1 Abrams',
  'T-90',
  'leopard-2A4',
  'T-72B',
  'Leopard1A3',
  'M-60',
  'T-55',
  'M4_Sherman',
  'PT_76'
]
/** APC or IFV the infantry rides. BMP and Bradley count: the squad is mounted in them. */
const CARRIERS = [
  'M-2 Bradley',
  'BMP-3',
  'Marder',
  'BMP-2',
  'BMP-1',
  'M1126 Stryker ICV',
  'M-113',
  'MTLB'
]
/** Guns that travel with the company. Missiles of the division stay off this list. */
const COMPANY_AIR_DEFENSE = [
  '2S6 Tunguska',
  'M6 Linebacker',
  'Gepard',
  'ZSU-23-4 Shilka',
  'Vulcan',
  'Roland ADS',
  'M45_Quadmount',
  'ZSU_57_2',
  'M1_37mm',
  'Soldier stinger',
  'SA-18 Igla manpad',
  'Ural-375 ZU-23'
]
const FOOT_AIR_DEFENSE = new Set([
  'M45_Quadmount',
  'Soldier stinger',
  'SA-18 Igla manpad',
  'Ural-375 ZU-23'
])

export type PlannedUnit = {
  name: string
  count: 1
  position: Position
  heading: number
}

function owned(types: GroundUnitTypes) {
  return new Set(
    [
      ...(types.Vehicle ?? []),
      ...(types['Shorad Vehicle'] ?? []),
      ...(types['Shorad Infantry'] ?? []),
      ...(types.Infantry ?? [])
    ].filter((name) => name.length > 0)
  )
}

function pick(preferences: string[], have: Set<string>) {
  return preferences.find((name) => have.has(name))
}

export function planDetachment(params: {
  groundUnitTypes: GroundUnitTypes
  origin: Position
  heading: number
  /** Depot paid for the armor. Without it the squad still leaves, on foot. */
  withVehicles: boolean
  /** A barrack brings the squad. A depot on its own does not invent infantry. */
  withInfantry: boolean
}): PlannedUnit[] {
  const have = owned(params.groundUnitTypes)
  const infantryName = params.groundUnitTypes.Infantry?.find((name) => name.length > 0) ?? 'Infantry AK'
  const names: string[] = []

  if (params.withVehicles) {
    const tank = pick(TANKS, have)
    const carrier = pick(CARRIERS, have)
    if (tank) names.push(tank)
    if (carrier) names.push(carrier)
  }

  const airDefense = pick(
    params.withVehicles ? COMPANY_AIR_DEFENSE : COMPANY_AIR_DEFENSE.filter((name) => FOOT_AIR_DEFENSE.has(name)),
    have
  )
  if (airDefense && !names.includes(airDefense)) names.push(airDefense)

  const infantryCount = params.withInfantry ? DETACHMENT_INFANTRY : 0
  for (let index = 0; index < infantryCount; index += 1) names.push(infantryName)

  const forwardX = Math.cos(params.heading)
  const forwardY = Math.sin(params.heading)
  const sideX = -forwardY
  const sideY = forwardX
  const vehicleCount = names.length - infantryCount

  return names.map((name, index) => {
    const vehicle = index < vehicleCount
    const file = vehicle ? 0 : (index - vehicleCount) % 2 === 0 ? -1 : 1
    const rank = vehicle ? index : Math.floor((index - vehicleCount) / 2)
    const back = vehicle ? index * 28 : vehicleCount * 28 + 16 + rank * 8
    const side = vehicle ? 0 : file * 6
    return {
      name,
      count: 1 as const,
      heading: params.heading,
      position: {
        x: params.origin.x - forwardX * back + sideX * side,
        y: params.origin.y - forwardY * back + sideY * side
      }
    }
  })
}

/** Armor and self-propelled guns the depot pays for. Towed guns and MANPADS stay with the squad. */
export function detachmentVehicleNames(units: { name: string }[]) {
  return [
    ...new Set(
      units
        .map((unit) => unit.name)
        .filter(
          (name) =>
            !FOOT_AIR_DEFENSE.has(name) &&
            (TANKS.includes(name) || CARRIERS.includes(name) || COMPANY_AIR_DEFENSE.includes(name))
        )
    )
  ]
}
