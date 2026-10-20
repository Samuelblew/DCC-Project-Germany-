import { schemas } from '@dcc/contracts'
import { aircrafts } from '@dcc/data'
import type * as z from 'zod'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type AirframeStock = NonNullable<Campaign['coalitions']['player']['airframes']>[string]

/** One squadron per type. Helicopter units are smaller, and the big support jets are few. */
const FIGHTER_SQUADRON = 24
const HELICOPTER_SQUADRON = 12
const SUPPORT_FLIGHT = 4
/** Share of a type's capacity replaced per campaign day (Falcon BMS ReinforcementTime). */
const REINFORCEMENT_PER_DAY = 0.15
const DAY_SECONDS = 24 * 3600

const SUPPORT_TASKS = new Set(['AWACS', 'Refueling'])

function definition(aircraftName: string) {
  return Object.values(aircrafts).find((aircraft) => aircraft.name === aircraftName)
}

export function airframeCapacity(aircraftName: string) {
  const def = definition(aircraftName)
  if (def?.isHelicopter) return HELICOPTER_SQUADRON
  const tasks = def?.availableTasks ?? []
  if (tasks.length > 0 && tasks.every((task) => SUPPORT_TASKS.has(task))) return SUPPORT_FLIGHT
  return FIGHTER_SQUADRON
}

function coalitionTypes(draft: Campaign, coalition: Coalition) {
  return [...new Set(Object.values(draft.coalitions[coalition].aircraftTypes).flat())]
}

/** Every type the coalition can fly gets a full squadron the first time it is seen. */
export function ensureAirframes(draft: Campaign, coalition: Coalition) {
  const stock = (draft.coalitions[coalition].airframes ??= {})
  for (const type of coalitionTypes(draft, coalition)) {
    if (stock[type]) continue
    const capacity = airframeCapacity(type)
    stock[type] = { total: capacity, capacity, lost: 0, reinforcement: 0 }
  }
  return stock
}

/** Aircraft of a type currently out on a flight; career airframes live in the hangar instead. */
export function airframesInUse(
  campaign: Pick<Campaign, 'coalitions'>,
  coalition: Coalition,
  aircraftName: string
) {
  let count = 0
  for (const group of campaign.coalitions[coalition].flightGroups) {
    if (group.careerMission) continue
    for (const aircraft of group.aircrafts) {
      if (aircraft.aircraftName === aircraftName && !aircraft.careerAirframeId) count += 1
    }
  }
  return count
}

export function availableAirframes(
  campaign: Pick<Campaign, 'coalitions'>,
  coalition: Coalition,
  aircraftName: string
) {
  const stock = campaign.coalitions[coalition].airframes?.[aircraftName]
  if (!stock) return Number.POSITIVE_INFINITY
  return Math.max(0, stock.total - airframesInUse(campaign, coalition, aircraftName))
}

/** Whether `count` aircraft of the type are on the ground and ready to fly. */
export function hasAirframes(
  campaign: Pick<Campaign, 'coalitions'>,
  coalition: Coalition,
  aircraftName: string,
  count = 2
) {
  return availableAirframes(campaign, coalition, aircraftName) >= count
}

/** An aircraft lost in the campaign or in DCS leaves the order of battle for good. */
export function recordAirframeLoss(
  draft: Campaign,
  coalition: Coalition,
  aircraft: { aircraftName: string; careerAirframeId?: string }
) {
  if (aircraft.careerAirframeId) return
  const stock = draft.coalitions[coalition].airframes?.[aircraft.aircraftName]
  if (!stock) return
  stock.total = Math.max(0, stock.total - 1)
  stock.lost += 1
}

function reinforce(stock: AirframeStock, seconds: number) {
  if (stock.total >= stock.capacity) {
    stock.reinforcement = 0
    return
  }
  stock.reinforcement += (stock.capacity * REINFORCEMENT_PER_DAY * seconds) / DAY_SECONDS
  while (stock.reinforcement >= 1 && stock.total < stock.capacity) {
    stock.total += 1
    stock.reinforcement -= 1
  }
}

/** Seeds new types and trickles replacements back in, `seconds` of campaign time at a time. */
export function updateAirframes(draft: Campaign, coalition: Coalition, seconds: number) {
  const stock = ensureAirframes(draft, coalition)
  if (seconds <= 0) return
  for (const entry of Object.values(stock)) reinforce(entry, seconds)
}
