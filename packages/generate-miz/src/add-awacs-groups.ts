import { schemas } from '@dcc/contracts'
import { aircrafts } from '@dcc/data'
import { ok, Result } from 'neverthrow'
import * as z from 'zod'

import { resolveAiSkill } from './ai-skill'
import { AWACS_FREQUENCY } from './radio-plan'

// Build lookup map once
const aircraftMap = new Map<string, z.infer<typeof schemas.dcs.aircraft>>()
Object.values(aircrafts).forEach((def) => {
  if (def && typeof def === 'object' && 'name' in def) {
    aircraftMap.set(def.name, def)
  }
})

const DEFAULT_AWACS: Record<string, string> = {
  blue: 'E-3A',
  red: 'A-50'
}

const RACETRACK_LEG_KM = 120
const OFFSET_KM = 120
const AWACS_ALTITUDE = 9144

/**
 * Compute the centroid (average position) of a set of airdromes.
 */
function airdromeCentroid(
  airdromeNames: string[],
  theatre: z.infer<typeof schemas.theatre>
): { x: number; y: number } | null {
  let sumX = 0
  let sumY = 0
  let count = 0

  for (const name of airdromeNames) {
    const airdrome = theatre.airdromeDetails[name]
    if (airdrome) {
      sumX += airdrome.x
      sumY += airdrome.y
      count++
    }
  }

  if (count === 0) return null

  return { x: sumX / count, y: sumY / count }
}

/**
 * Returns an airborne-support anchor for a coalition without land bases.
 *
 * Carrier groups are preferred because they are the coalition's effective airbase. If there is
 * no carrier, use the centroid of the remaining active naval groups.
 */
function navalAnchor(
  navalGroups: NonNullable<
    z.infer<typeof schemas.campaign.campaign>['coalitions']['player']['navalGroups']
  >
): { x: number; y: number } | null {
  const activeGroups = navalGroups.filter((group) => group.state !== 'sunk')
  const carrier = activeGroups.find((group) => group.role === 'carrier')
  if (carrier) return carrier.position
  if (activeGroups.length === 0) return null

  const positionTotal = activeGroups.reduce(
    (total, group) => ({
      x: total.x + group.position.x,
      y: total.y + group.position.y
    }),
    { x: 0, y: 0 }
  )

  return {
    x: positionTotal.x / activeGroups.length,
    y: positionTotal.y / activeGroups.length
  }
}

/**
 * Adds one AWACS group per coalition to the mission.
 *
 * Each AWACS is spawned airborne behind its own lines with an infinite
 * race-track orbit, and is set immortal, invisible, with unlimited fuel.
 */
export function addAwacsGroups(
  mission: z.infer<typeof schemas.dcs.mission>,
  campaign: z.infer<typeof schemas.campaign.campaign>,
  theatre: z.infer<typeof schemas.theatre>
): Result<void, Error> {
  const nextId = () => {
    mission.currentKey += 1
    return mission.currentKey
  }

  // Collect centroids for both coalitions so we can compute the frontline midpoint
  const coalitionData: {
    key: string
    missionCoalitionKey: 'blue' | 'red'
    centroid: { x: number; y: number }
    aircraftTypes: z.infer<
      typeof schemas.campaign.campaign
    >['coalitions']['player']['aircraftTypes']
  }[] = []

  for (const [key, value] of Object.entries(campaign.coalitions)) {
    const missionCoalitionKey = key === 'player' ? 'blue' : key === 'opponent' ? 'red' : null
    if (!missionCoalitionKey) continue

    const centroid =
      airdromeCentroid(value.airdromeNames, theatre) ?? navalAnchor(value.navalGroups ?? [])
    if (!centroid) {
      // eslint-disable-next-line no-console
      console.warn(`No airdromes or active naval groups found for coalition ${key}, skipping AWACS`)
      continue
    }

    coalitionData.push({
      key,
      missionCoalitionKey,
      centroid,
      aircraftTypes: value.aircraftTypes
    })
  }

  if (coalitionData.length < 2) {
    // eslint-disable-next-line no-console
    console.warn('Need both coalitions to compute AWACS positioning, skipping')
    return ok()
  }

  // Frontline midpoint is the average of the two coalition centroids
  const blue = coalitionData.find((c) => c.missionCoalitionKey === 'blue')
  const red = coalitionData.find((c) => c.missionCoalitionKey === 'red')

  if (!blue || !red) return ok()

  const frontlineMidpoint = {
    x: (blue.centroid.x + red.centroid.x) / 2,
    y: (blue.centroid.y + red.centroid.y) / 2
  }

  // Frontline axis: direction from blue centroid to red centroid
  const frontAxisX = red.centroid.x - blue.centroid.x
  const frontAxisY = red.centroid.y - blue.centroid.y
  const frontAxisLen = Math.sqrt(frontAxisX * frontAxisX + frontAxisY * frontAxisY)

  if (frontAxisLen === 0) return ok()

  // Normalised frontline direction
  const fNx = frontAxisX / frontAxisLen
  const fNy = frontAxisY / frontAxisLen

  // Perpendicular direction for the long racetrack legs
  const perpX = -fNy
  const perpY = fNx

  const offsetM = OFFSET_KM * 1000
  const legHalfM = (RACETRACK_LEG_KM * 1000) / 2

  for (const coalition of coalitionData) {
    // Determine AWACS aircraft type
    const awacsTypes = coalition.aircraftTypes['AWACS'] ?? []
    const aircraftName = awacsTypes[0] ?? DEFAULT_AWACS[coalition.missionCoalitionKey] ?? 'E-3A'

    const aircraftDef = aircraftMap.get(aircraftName)
    if (!aircraftDef) {
      // eslint-disable-next-line no-console
      console.warn(`AWACS aircraft definition not found for ${aircraftName}, skipping`)
      continue
    }

    // Position: offset from frontline midpoint away from the enemy (behind own lines)
    // Blue pushes towards negative front axis, red towards positive
    const sign = coalition.missionCoalitionKey === 'blue' ? -1 : 1
    const orbitCenter = {
      x: frontlineMidpoint.x + fNx * offsetM * sign,
      y: frontlineMidpoint.y + fNy * offsetM * sign
    }

    // Racetrack endpoints: perpendicular to frontline
    const racetrackStart = {
      x: orbitCenter.x - perpX * legHalfM,
      y: orbitCenter.y - perpY * legHalfM
    }
    const racetrackEnd = {
      x: orbitCenter.x + perpX * legHalfM,
      y: orbitCenter.y + perpY * legHalfM
    }

    const cruiseSpeed = aircraftDef.cruiseSpeed
    const altitude = AWACS_ALTITUDE

    const countryList = mission.coalition[coalition.missionCoalitionKey].country
    const country = countryList?.[0]
    if (country == null) continue

    if (!country.plane) {
      country.plane = { group: [] }
    }

    const groupId = nextId()
    const unitId = nextId()
    const groupName = `AWACS-${coalition.missionCoalitionKey}`

    // Heading: from racetrack start towards end
    const dx = racetrackEnd.x - racetrackStart.x
    const dy = racetrackEnd.y - racetrackStart.y
    const heading = Math.atan2(dx, dy)

    const unit: z.infer<typeof schemas.dcs.aircraftUnit> = {
      alt: altitude,
      alt_type: 'BARO',
      hardpoint_racks: true,
      heading: heading,
      callsign: {
        _1: 1,
        _2: 1,
        name: `${groupName}11`,
        _3: 1
      },
      psi: 0,
      onboard_num: '010',
      payload: {
        pylons: {},
        fuel: aircraftDef.max_fuel,
        flare: aircraftDef.flare,
        ammo_type: 1,
        chaff: aircraftDef.chaff,
        gun: 100
      },
      livery_id: 'default',
      skill: resolveAiSkill(
        campaign,
        coalition.missionCoalitionKey === 'red' ? 'opponent' : 'player',
        'High'
      ),
      speed: cruiseSpeed,
      type: aircraftDef.name,
      unitId: unitId,
      x: racetrackStart.x,
      y: racetrackStart.y,
      name: `${groupName}-1`
    }

    // First waypoint tasks:
    // 1. SetImmortal
    // 2. SetInvisible
    // 3. SetUnlimitedFuel
    // 4. EPLRS datalink
    // 5. AWACS
    // 6. Racetrack orbit, no duration
    const tasks: z.infer<typeof schemas.dcs.task>[] = [
      {
        enabled: true,
        auto: false,
        id: 'WrappedAction',
        number: 1,
        params: {
          action: {
            id: 'SetImmortal',
            params: { value: true }
          }
        }
      },
      {
        enabled: true,
        auto: false,
        id: 'WrappedAction',
        number: 2,
        params: {
          action: {
            id: 'SetInvisible',
            params: { value: true }
          }
        }
      },
      {
        enabled: true,
        auto: false,
        id: 'WrappedAction',
        number: 3,
        params: {
          action: {
            id: 'SetUnlimitedFuel',
            params: { value: true }
          }
        }
      },
      {
        enabled: true,
        auto: true,
        id: 'WrappedAction',
        number: 4,
        params: {
          action: {
            id: 'EPLRS',
            params: { value: true }
          }
        }
      },
      {
        enabled: true,
        auto: false,
        id: 'AWACS',
        number: 5,
        params: {}
      },
      {
        enabled: true,
        auto: false,
        id: 'Orbit',
        number: 6,
        params: {
          pattern: 'Race-Track',
          point: {
            x: racetrackStart.x,
            y: racetrackStart.y
          },
          point2: {
            x: racetrackEnd.x,
            y: racetrackEnd.y
          },
          speed: cruiseSpeed,
          altitude: altitude
        }
      }
    ]

    const routePoints: z.infer<typeof schemas.dcs.aircraftRoutePoint>[] = [
      {
        alt: altitude,
        action: 'Turning Point',
        alt_type: 'BARO',
        speed: cruiseSpeed,
        task: {
          id: 'ComboTask',
          params: {
            tasks: tasks
          }
        },
        type: 'Turning Point',
        x: racetrackStart.x,
        y: racetrackStart.y,
        ETA: 0,
        ETA_locked: true,
        speed_locked: true,
        formation_template: '',
        name: 'Racetrack Start'
      },
      {
        alt: altitude,
        action: 'Turning Point',
        alt_type: 'BARO',
        speed: cruiseSpeed,
        task: {
          id: 'ComboTask',
          params: {
            tasks: []
          }
        },
        type: 'Turning Point',
        x: racetrackEnd.x,
        y: racetrackEnd.y,
        ETA: 0,
        ETA_locked: false,
        speed_locked: true,
        formation_template: '',
        name: 'Racetrack End'
      }
    ]

    const group = {
      groupId: groupId,
      name: groupName,
      start_time: 0,
      task: 'AWACS',
      uncontrollable: false,
      units: [unit],
      x: racetrackStart.x,
      y: racetrackStart.y,
      route: {
        points: routePoints
      },
      modulation: false,
      hidden: false,
      communication: true,
      frequency: AWACS_FREQUENCY
    }

    country.plane.group.push(group)

    // eslint-disable-next-line no-console
    console.log(
      `Added AWACS group "${groupName}" (${aircraftName}) for ${coalition.missionCoalitionKey} coalition`
    )
  }

  return ok()
}
