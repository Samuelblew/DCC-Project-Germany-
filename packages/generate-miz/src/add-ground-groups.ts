import { groundMarchKind } from '@dcc/campaign'
import { schemas } from '@dcc/contracts'
import {
  getSamDeadUnitIndexes,
  isGermanyIadsTheatre,
  isSamFullyDestroyed,
  samTemplates
} from '@dcc/data'
import { err, ok, Result } from 'neverthrow'
import * as z from 'zod'

import { resolveAiSkill } from './ai-skill'
import { isAirDefenseUnit, type MissionCullingPlan } from './mission-culling'
import { findTargetPlacement, positionsMatch } from './target-placement'

type Coalition = z.infer<typeof schemas.coalition>

const INFANTRY_UNIT_PATTERN = /infantry|soldier/i
const MIN_VEHICLE_SPACING = 10
const MIN_INFANTRY_SPACING = 3
const SPACING_CELL_SIZE = 12
const SPACING_SEARCH_RINGS = 12

/**
 * Keeps generated ground units from spawning inside each other. Campaign state can put several
 * groups on the same spot (for example after converging on one objective), so each unit is
 * nudged outwards to the nearest free position.
 */
export class GroundUnitSpacing {
  private readonly cells = new Map<string, { x: number; y: number; infantry: boolean }[]>()

  place(position: { x: number; y: number }, unitType: string): { x: number; y: number } {
    const infantry = INFANTRY_UNIT_PATTERN.test(unitType)
    for (let ring = 0; ring <= SPACING_SEARCH_RINGS; ring++) {
      const candidates = ring === 0 ? 1 : ring * 8
      for (let index = 0; index < candidates; index++) {
        const angle = (index / candidates) * Math.PI * 2
        const candidate = {
          x: position.x + Math.cos(angle) * ring * SPACING_CELL_SIZE,
          y: position.y + Math.sin(angle) * ring * SPACING_CELL_SIZE
        }
        if (this.isFree(candidate, infantry)) {
          this.occupy(candidate, infantry)
          return candidate
        }
      }
    }
    this.occupy(position, infantry)
    return position
  }

  private cellKey(x: number, y: number) {
    return `${Math.floor(x / SPACING_CELL_SIZE)}:${Math.floor(y / SPACING_CELL_SIZE)}`
  }

  private isFree(position: { x: number; y: number }, infantry: boolean) {
    const cellX = Math.floor(position.x / SPACING_CELL_SIZE)
    const cellY = Math.floor(position.y / SPACING_CELL_SIZE)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of this.cells.get(`${cellX + dx}:${cellY + dy}`) ?? []) {
          const spacing = infantry && other.infantry ? MIN_INFANTRY_SPACING : MIN_VEHICLE_SPACING
          if (Math.hypot(other.x - position.x, other.y - position.y) < spacing) return false
        }
      }
    }
    return true
  }

  private occupy(position: { x: number; y: number }, infantry: boolean) {
    const key = this.cellKey(position.x, position.y)
    const cell = this.cells.get(key) ?? []
    cell.push({ ...position, infantry })
    this.cells.set(key, cell)
  }
}

/**
 * Arrange units in a circle around a center point.
 * The first unit (typically the radar/command unit) is placed at center;
 * remaining units fan out at increasing radius.
 */
function arrangeUnits(
  center: { x: number; y: number },
  count: number,
  spacing: number
): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = []
  if (count === 0) return positions

  // First unit at center
  positions.push({ x: center.x, y: center.y })

  // Remaining units in a circle
  for (let i = 1; i < count; i++) {
    const angle = ((2 * Math.PI) / (count - 1)) * (i - 1)
    positions.push({
      x: center.x + Math.cos(angle) * spacing,
      y: center.y + Math.sin(angle) * spacing
    })
  }

  return positions
}

function positionUnits(
  fallbackCenter: { x: number; y: number },
  count: number,
  spacing: number,
  target?: z.infer<typeof schemas.target>
) {
  const fallbackPositions = arrangeUnits(fallbackCenter, count, spacing)

  return Array.from({ length: count }).map((_, index) => {
    const targetPosition = target?.unitPositions[index]
    const fallbackPosition = fallbackPositions[index] ?? fallbackCenter

    return {
      x: targetPosition?.x ?? fallbackPosition.x,
      y: targetPosition?.y ?? fallbackPosition.y,
      heading: targetPosition?.heading ?? 0
    }
  })
}

export function addGroundGroups(
  mission: z.infer<typeof schemas.dcs.mission>,
  campaign: z.infer<typeof schemas.campaign.campaign>,
  theatre: z.infer<typeof schemas.theatre>,
  cullingPlan?: MissionCullingPlan
): Result<void, Error> {
  const nextId = () => {
    mission.currentKey += 1
    return mission.currentKey
  }
  const spacing = new GroundUnitSpacing()

  for (const [key, value] of Object.entries(campaign.coalitions)) {
    const missionCoalitionKey = key === 'player' ? 'blue' : key === 'opponent' ? 'red' : 'neutrals'
    const coalitionKey = key as Coalition

    const countryList = mission.coalition[missionCoalitionKey].country
    const country = countryList?.[0]
    if (country == null) continue

    if (!country.vehicle) {
      country.vehicle = { group: [] }
    }

    // --- SAM Groups ---
    const samGroups = value.samGroups
    if (!isGermanyIadsTheatre(theatre.name) && samGroups && samGroups.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `Adding ${samGroups.length} SAM groups for coalition ${missionCoalitionKey} (${key})`
      )

      for (const sam of samGroups) {
        if (isSamFullyDestroyed(sam)) continue

        const objective = theatre.objectives.find((o) => o.name === sam.objectiveId)
        if (!objective) continue

        const template = samTemplates[sam.type]
        if (!template) continue

        const placement = findTargetPlacement(theatre, {
          objectiveName: sam.objectiveId,
          type: 'SAM'
        })
        if (
          cullingPlan?.getSamMode(
            sam.id,
            placement?.position ?? objective.position,
            template.range
          ) === 'omit'
        ) {
          continue
        }

        const deadUnitIndexes = getSamDeadUnitIndexes(sam)
        const liveTemplateUnits = template.units
          .map((unitType, index) => ({ unitType, index }))
          .filter((unit) => !deadUnitIndexes.has(unit.index))

        if (liveTemplateUnits.length === 0) continue

        const groupId = nextId()
        const groupName = `SAM-${sam.id}-${sam.type}-${groupId}`
        const target = placement
        const positions = positionUnits(objective.position, template.units.length, 50, target)

        const units = liveTemplateUnits.map(({ unitType, index }) => {
          const pos = positions[index] ?? { ...objective.position, heading: 0 }
          const placed = spacing.place(pos, unitType)
          return {
            unitId: nextId(),
            name: `${groupName}-${index + 1}`,
            x: placed.x,
            y: placed.y,
            type: unitType,
            heading: pos.heading,
            skill: resolveAiSkill(campaign, coalitionKey, 'High')
          }
        })

        const firstUnit = units[0]
        if (!firstUnit) continue

        country.vehicle.group.push({
          groupId: groupId,
          name: groupName,
          units: units,
          x: firstUnit.x,
          y: firstUnit.y,
          hidden: false,
          start_time: 0,
          route: {
            points: [
              {
                alt: 0,
                alt_type: 'BARO',
                type: 'Turning Point',
                y: firstUnit.y,
                x: firstUnit.x,
                speed: 0,
                action: 'Off Road',
                ETA: 0,
                ETA_locked: true,
                speed_locked: true,
                formation_template: ''
              }
            ]
          }
        })
      }
    }

    // --- Ground Groups ---
    const groundGroups = value.groundGroups
    if (groundGroups && groundGroups.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `Adding ${groundGroups.length} ground groups for coalition ${missionCoalitionKey} (${key})`
      )

      for (const gg of groundGroups) {
        const cullingMode = cullingPlan?.getGroundGroupMode(coalitionKey, gg) ?? 'full'
        if (cullingMode === 'omit') continue

        const groupId = nextId()
        const groupName = `Ground-${gg.id}-${groupId}`

        // Expand units: each entry has a name (DCS type) and count
        let shouldUseObjectiveTargets = false
        let target = gg.deployment
          ? undefined
          : findTargetPlacement(theatre, {
              objectiveName: gg.objectiveId,
              type: 'Vehicle',
              nameIncludes: '|Vehicle|',
              position: gg.position
            })
        if (target && gg.state === 'idle' && gg.objectiveId) {
          shouldUseObjectiveTargets = true
        }
        if (!target && gg.state === 'idle') {
          const objective = gg.objectiveId
            ? theatre.objectives.find((entry) => entry.name === gg.objectiveId)
            : undefined
          if (objective && positionsMatch(gg.position, objective.position)) {
            shouldUseObjectiveTargets = true
            target = findTargetPlacement(theatre, {
              objectiveName: gg.objectiveId,
              type: 'Vehicle',
              nameIncludes: '|Vehicle|'
            })
          }
        }
        const aaaTarget = shouldUseObjectiveTargets
          ? findTargetPlacement(theatre, {
              objectiveName: gg.objectiveId,
              type: 'AAA',
              nameIncludes: '|AAA|'
            })
          : undefined
        const expandedUnits: {
          id: string
          type: string
          x: number
          y: number
          heading: number
        }[] = []
        let unitIndex = 0
        let vehicleUnitIndex = 0
        let airDefenseUnitIndex = 0
        for (const unitEntry of gg.units) {
          for (let i = 0; i < unitEntry.count; i++) {
            const isAirDefense = isAirDefenseUnit(unitEntry.name, value)
            if (cullingMode === 'antiAirOnly' && !isAirDefense) {
              unitIndex++
              continue
            }

            const useAaaTarget = aaaTarget && isAirDefense
            const fallbackCenter = useAaaTarget ? aaaTarget.position : gg.position
            const placementIndex = useAaaTarget ? airDefenseUnitIndex : unitIndex
            const targetPosition = useAaaTarget
              ? aaaTarget.unitPositions[airDefenseUnitIndex++]
              : target?.unitPositions[vehicleUnitIndex++]
            if (gg.deployment && !unitEntry.position) {
              return err(
                new Error(
                  `Ground group ${gg.id} is assigned to ${gg.deployment.siteId} but unit ${unitEntry.id ?? unitIndex} has no persisted position`
                )
              )
            }
            expandedUnits.push({
              id: unitEntry.id ?? `legacy-${unitIndex + 1}`,
              type: unitEntry.name,
              x:
                unitEntry.position?.x ??
                targetPosition?.x ??
                fallbackCenter.x + (placementIndex % 5) * 30,
              y:
                unitEntry.position?.y ??
                targetPosition?.y ??
                fallbackCenter.y + Math.floor(placementIndex / 5) * 30,
              heading: unitEntry.heading ?? targetPosition?.heading ?? 0
            })
            unitIndex++
          }
        }

        if (expandedUnits.length === 0) continue

        const units = expandedUnits.map((eu) => {
          const placed = spacing.place(eu, eu.type)
          return {
            unitId: nextId(),
            name: `GroundUnit-${gg.id}-${eu.id}`,
            x: placed.x,
            y: placed.y,
            type: eu.type,
            heading: eu.heading,
            skill: resolveAiSkill(campaign, coalitionKey, 'High')
          }
        })

        const firstUnit = units[0]
        if (!firstUnit) continue

        // Build route waypoints
        const onFoot = groundMarchKind(gg.units) === 'foot'
        const routePoints = [
          {
            alt: 0,
            alt_type: 'BARO',
            type: 'Turning Point',
            y: firstUnit.y,
            x: firstUnit.x,
            speed: 0,
            action: 'Off Road',
            ETA: 0,
            ETA_locked: true,
            speed_locked: true,
            formation_template: ''
          }
        ]

        if (gg.state === 'withdrawing' && gg.retreat?.route.length) {
          const speed = onFoot ? 4 : 12
          for (const waypoint of gg.retreat.route) {
            routePoints.push({
              alt: 0,
              alt_type: 'BARO',
              type: 'Turning Point',
              y: waypoint.y,
              x: waypoint.x,
              speed,
              action: onFoot ? 'Off Road' : 'On Road',
              ETA: 0,
              ETA_locked: false,
              speed_locked: true,
              formation_template: ''
            })
          }
        } else if (gg.targetObjectiveId) {
          const targetObj = theatre.objectives.find((o) => o.name === gg.targetObjectiveId)
          if (targetObj) {
            const speed = onFoot ? 4 : 12
            const connection = (theatre.connections ?? []).find(
              (entry) =>
                (entry.from === gg.objectiveId && entry.to === gg.targetObjectiveId) ||
                (entry.bidirectional &&
                  entry.to === gg.objectiveId &&
                  entry.from === gg.targetObjectiveId)
            )
            const connectionWaypoints = connection
              ? connection.from === gg.objectiveId
                ? connection.waypoints
                : [...connection.waypoints].reverse()
              : []
            const mayUseLegacyDirectRoute = (theatre.connections?.length ?? 0) === 0
            const waypoints = [
              ...connectionWaypoints,
              ...(connection || mayUseLegacyDirectRoute ? [targetObj.position] : [])
            ]
            for (const waypoint of waypoints) {
              routePoints.push({
                alt: 0,
                alt_type: 'BARO',
                type: 'Turning Point',
                y: waypoint.y,
                x: waypoint.x,
                speed,
                action: connection?.mode === 'road' && !onFoot ? 'On Road' : 'Off Road',
                ETA: 0,
                ETA_locked: false,
                speed_locked: true,
                formation_template: ''
              })
            }
          }
        }

        country.vehicle.group.push({
          groupId: groupId,
          name: groupName,
          units: units,
          x: firstUnit.x,
          y: firstUnit.y,
          hidden: false,
          start_time: 0,
          route: {
            points: routePoints
          }
        })
        cullingPlan?.recordGroundGroup(
          coalitionKey,
          gg.id,
          cullingMode === 'antiAirOnly' ? 'antiAirOnly' : 'full'
        )
      }
    }
  }

  return ok()
}
