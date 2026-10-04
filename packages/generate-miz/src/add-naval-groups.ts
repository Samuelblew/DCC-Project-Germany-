import { schemas } from '@dcc/contracts'
import { err, ok, Result } from 'neverthrow'
import * as z from 'zod'

import { resolveAiSkill } from './ai-skill'
import { DEFAULT_ATC_FREQUENCY } from './radio-plan'

type Coalition = z.infer<typeof schemas.coalition>
type NavalGroup = z.infer<typeof schemas.navalGroup>

const MIN_CARRIER_WIND_SPEED = 0.5

function getTacanFrequency(channel: number) {
  const megahertz = channel < 64 ? 962 + channel - 1 : 1151 + channel - 64
  return megahertz * 1_000_000
}

function wrappedAction(action: { id: string; params: Record<string, unknown> }, number: number) {
  return {
    enabled: true,
    auto: false,
    id: 'WrappedAction',
    number,
    params: { action }
  }
}

function comboTask(tasks: ReturnType<typeof wrappedAction>[] = []) {
  return {
    id: 'ComboTask',
    params: { tasks }
  }
}

function navalWaypoint(x: number, y: number, speed: number, task = comboTask(), etaLocked = false) {
  return {
    alt: 0,
    alt_type: 'BARO',
    type: 'Turning Point',
    action: 'Turning Point',
    x,
    y,
    speed,
    ETA: 0,
    ETA_locked: etaLocked,
    speed_locked: true,
    formation_template: '',
    task
  }
}

function circularPatrolWaypoints(
  navalGroup: NavalGroup,
  patrol: NonNullable<NavalGroup['missionPatrol']>,
  initialTasks: ReturnType<typeof wrappedAction>[]
) {
  const segments = 8
  const forwardX = Math.cos(navalGroup.heading)
  const forwardY = Math.sin(navalGroup.heading)
  const rightX = forwardY
  const rightY = -forwardX
  const centerX = navalGroup.position.x + rightX * patrol.radius
  const centerY = navalGroup.position.y + rightY * patrol.radius
  const radialX = -rightX
  const radialY = -rightY
  const points = Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (index * 2 * Math.PI) / segments
    return navalWaypoint(
      centerX +
        radialX * patrol.radius * Math.cos(angle) +
        forwardX * patrol.radius * Math.sin(angle),
      centerY +
        radialY * patrol.radius * Math.cos(angle) +
        forwardY * patrol.radius * Math.sin(angle),
      patrol.speed,
      index === 0 ? comboTask(initialTasks) : comboTask(),
      index === 0
    )
  })
  points[points.length - 1]!.task = comboTask([
    wrappedAction(
      {
        id: 'SwitchWaypoint',
        params: {
          fromWaypointIndex: points.length,
          goToWaypointIndex: 2
        }
      },
      1
    )
  ])
  return points
}

function getSpawnHeading(navalGroup: NavalGroup, mission: z.infer<typeof schemas.dcs.mission>) {
  const surfaceWind = mission.weather.wind.atGround
  if (navalGroup.role !== 'carrier' || surfaceWind.speed < MIN_CARRIER_WIND_SPEED) {
    return navalGroup.heading
  }

  const windToHeading = (surfaceWind.dir * Math.PI) / 180
  return (windToHeading + Math.PI) % (2 * Math.PI)
}

function getPersistentUnits(navalGroup: NavalGroup) {
  return (
    navalGroup.units ??
    navalGroup.unitTypes.map((type, index) => ({
      id: `${navalGroup.id}-ship-${index + 1}`,
      type,
      damage: 0,
      ammunition: navalGroup.ammunition,
      fuel: navalGroup.fuel,
      tacan: undefined,
      state: 'operational' as const
    }))
  )
}

function getLiveUnits(navalGroup: NavalGroup) {
  const units = getPersistentUnits(navalGroup)
  return navalGroup.role === 'carrier'
    ? units
    : units.filter((unit) => unit.state !== 'sunk' && unit.damage < 1)
}

export function addNavalGroups(
  mission: z.infer<typeof schemas.dcs.mission>,
  campaign: z.infer<typeof schemas.campaign.campaign>
): Result<void, Error> {
  const nextId = () => {
    mission.currentKey += 1
    return mission.currentKey
  }

  try {
    for (const [coalitionKey, coalition] of Object.entries(campaign.coalitions)) {
      const missionCoalitionKey = coalitionKey === 'player' ? 'blue' : 'red'
      const country = mission.coalition[missionCoalitionKey].country?.[0]
      if (!country) continue
      country.ship ??= { group: [] }

      const navalGroups: NavalGroup[] = coalition.navalGroups ?? []
      const navalGroupIds = new Set(navalGroups.map((group) => group.id))
      const missionGroups = new Map<string, NavalGroup[]>()
      for (const navalGroup of navalGroups) {
        const missionGroupId =
          navalGroup.missionGroupId && navalGroupIds.has(navalGroup.missionGroupId)
            ? navalGroup.missionGroupId
            : navalGroup.id
        const members = missionGroups.get(missionGroupId) ?? []
        members.push(navalGroup)
        missionGroups.set(missionGroupId, members)
      }

      for (const [missionGroupId, unsortedMembers] of missionGroups) {
        const leader =
          unsortedMembers.find((group) => group.id === missionGroupId) ?? unsortedMembers[0]
        if (!leader) continue
        const members = [leader, ...unsortedMembers.filter((group) => group !== leader)]

        const carriers = members.filter((group) => group.role === 'carrier')
        const carrier = carriers[0]
        const spawnHeading = getSpawnHeading(carrier ?? leader, mission)
        const formationBearing = spawnHeading + Math.PI / 2
        const units = members.flatMap((navalGroup) => {
          if (navalGroup.role !== 'carrier' && navalGroup.state === 'sunk') return []
          return getLiveUnits(navalGroup).map((unit, index) => ({
            unitId: nextId(),
            name: `NavalUnit-${navalGroup.id}-${unit.id}`,
            type: unit.type,
            x: navalGroup.position.x + Math.cos(formationBearing) * index * 700,
            y: navalGroup.position.y + Math.sin(formationBearing) * index * 700,
            heading: spawnHeading,
            skill: resolveAiSkill(campaign, coalitionKey as Coalition, 'Excellent')
          }))
        })
        if (units.length === 0) continue

        const carrierBeacons = carriers.flatMap((carrierGroup) => {
          const persistentUnits = getPersistentUnits(carrierGroup)
          return persistentUnits.flatMap((persistentUnit, index) => {
            const tacan = persistentUnit.tacan ?? (index === 0 ? carrierGroup.tacan : undefined)
            if (!tacan) return []

            const missionUnit = units.find(
              (unit) => unit.name === `NavalUnit-${carrierGroup.id}-${persistentUnit.id}`
            )
            return missionUnit ? [{ missionUnit, tacan }] : []
          })
        })
        const carrierTasks = carrier
          ? [
              wrappedAction({ id: 'SetImmortal', params: { value: true } }, 1),
              ...carrierBeacons.map(({ missionUnit, tacan }, index) =>
                wrappedAction(
                  {
                    id: 'ActivateBeacon',
                    params: {
                      type: 4,
                      frequency: getTacanFrequency(tacan.channel),
                      callsign: tacan.callsign,
                      channel: tacan.channel,
                      unitId: missionUnit.unitId,
                      modeChannel: tacan.band,
                      bearing: true,
                      system: 3
                    }
                  },
                  index + 2
                )
              )
            ]
          : []
        const routePoints = leader.missionPatrol
          ? circularPatrolWaypoints(leader, leader.missionPatrol, carrierTasks)
          : [
              navalWaypoint(
                leader.position.x,
                leader.position.y,
                leader.state === 'unloading' ? 0 : 8,
                comboTask(carrierTasks),
                true
              )
            ]

        country.ship.group.push({
          groupId: nextId(),
          name: `NavalGroup-${missionGroupId}`,
          x: leader.position.x,
          y: leader.position.y,
          units,
          task: 'Nothing',
          ...(carrier
            ? {
                communication: true,
                frequency: DEFAULT_ATC_FREQUENCY,
                modulation: 0
              }
            : {}),
          route: {
            points: routePoints
          }
        })
      }
    }
    return ok(undefined)
  } catch (cause) {
    return err(cause instanceof Error ? cause : new Error('Failed to add naval groups'))
  }
}

export function findCarrierMissionUnit(
  mission: z.infer<typeof schemas.dcs.mission>,
  coalition: Coalition,
  navalGroupId: string,
  preferredUnitTypes?: ReadonlySet<string>
) {
  const missionCoalitionKey = coalition === 'player' ? 'blue' : 'red'
  const groupName = `NavalGroup-${navalGroupId}`
  for (const country of mission.coalition[missionCoalitionKey].country ?? []) {
    const group = country.ship?.group.find((candidate) => candidate.name === groupName)
    const unit = preferredUnitTypes
      ? group?.units.find((candidate) => preferredUnitTypes.has(candidate.type))
      : group?.units[0]
    if (unit) return unit
  }
  return undefined
}
