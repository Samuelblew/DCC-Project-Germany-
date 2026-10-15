import { schemas } from '@dcc/contracts'
import { buildings } from '@dcc/data'
import { err, ok, Result } from 'neverthrow'
import * as z from 'zod'

import type { MissionCullingPlan } from './mission-culling'
import { findTargetPlacement, positionsMatch } from './target-placement'

type Coalition = z.infer<typeof schemas.coalition>

export function addStructures(
  mission: z.infer<typeof schemas.dcs.mission>,
  campaign: z.infer<typeof schemas.campaign.campaign>,
  theatre: z.infer<typeof schemas.theatre>,
  cullingPlan?: MissionCullingPlan
): Result<void, Error> {
  const nextId = () => {
    mission.currentKey += 1
    return mission.currentKey
  }

  for (const [key, value] of Object.entries(campaign.coalitions)) {
    const missionCoalitionKey = key === 'player' ? 'blue' : key === 'opponent' ? 'red' : 'neutrals'
    const coalitionKey = key as Coalition

    const coalitionStructures = value.structures

    if (!coalitionStructures || coalitionStructures.length === 0) continue

    // eslint-disable-next-line no-console
    console.log(
      `Adding ${coalitionStructures.length} structures for coalition ${missionCoalitionKey} (${key})`
    )

    const countryList = mission.coalition[missionCoalitionKey].country

    // countryList is guaranteed to be non-empty array here
    const country = countryList?.[0]
    if (country == null) {
      return err(new Error(`no country found for coalition ${missionCoalitionKey} ${key}`))
    }

    if (!country.static) {
      country.static = { group: [] }
    }

    coalitionStructures.forEach((struct) => {
      const objective = theatre.objectives.find((o) => o.name === struct.objectiveId)
      if (!objective) return
      if (cullingPlan?.getStructureMode(coalitionKey, struct) === 'omit') {
        return
      }

      const groupId = nextId()
      const groupName = `Static-${struct.id}-${struct.type}-${groupId}`

      const groupUnits: { x: number; y: number; [key: string]: unknown }[] = []

      const basePos = struct.position ?? objective.position
      let target = findTargetPlacement(theatre, {
        objectiveName: struct.objectiveId,
        type: 'Structure',
        nameIncludes: '|Structure|',
        position: basePos
      })
      if (!target && positionsMatch(basePos, objective.position)) {
        target = findTargetPlacement(theatre, {
          objectiveName: struct.objectiveId,
          type: 'Structure',
          nameIncludes: '|Structure|'
        })
      }

      struct.buildings.forEach((building, index) => {
        if (building.alive === false) return

        const buildingInfo = buildings[building.type]
        if (!buildingInfo) return

        const unitId = nextId()
        // A FARP or an oil rig is a complete template. The theatre target only marks
        // its origin; using the target's first static would replace the rig with
        // whatever land object reserved that spot.
        const keepTemplate = struct.type === 'Farp' || struct.type === 'Oil Platform'
        const targetPosition = keepTemplate ? undefined : target?.unitPositions[index]
        const useTargetStatic = targetPosition != null
        const posX = targetPosition?.x ?? basePos.x + building.offset.x
        const posY = targetPosition?.y ?? basePos.y + building.offset.y

        groupUnits.push({
          category: useTargetStatic
            ? (target?.structureCategory ?? buildingInfo.category)
            : buildingInfo.category,
          shape_name: useTargetStatic && target?.structureType ? undefined : buildingInfo.shapeName,
          type: useTargetStatic ? (target?.structureType ?? buildingInfo.type) : buildingInfo.type,
          unitId: unitId,
          rate: 100,
          y: posY,
          x: posX,
          name: `${groupName}-${index + 1}`,
          heading: targetPosition?.heading ?? 0
        })
      })

      if (groupUnits.length === 0) return

      const firstUnit = groupUnits[0]
      if (!firstUnit) return

      country.static?.group.push({
        heading: 0,
        route: {
          points: [
            {
              alt: 0,
              name: firstUnit.name as string,
              type: '',
              y: firstUnit.y,
              speed: 0,
              x: firstUnit.x,
              formation_template: '',
              action: ''
            }
          ]
        },
        groupId: groupId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        units: groupUnits as any,
        y: firstUnit.y,
        x: firstUnit.x,
        name: groupName,
        dead: false
      })
      cullingPlan?.recordStructure(coalitionKey, struct.id)
    })
  }

  return ok()
}
