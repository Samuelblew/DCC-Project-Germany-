import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import { proceduralDeploymentSites, proceduralStructureTargets } from '../procedural-ground-sites'
import { objectives } from './objectives'

type Target = z.infer<typeof schemas.target>

/** Airfield guard platoon, east of the field (inland on the coast), like Cold War Germany. */
function airfieldVehicleTargets(): Record<string, Target[]> {
  return Object.fromEntries(
    objectives
      .filter((objective) => objective.type === 'Airport')
      .map((objective) => {
        const position = { x: objective.position.x, y: objective.position.y + 2500 }
        return [
          objective.name,
          [
            {
              name: `${objective.name}|Vehicle|1`,
              position,
              type: 'Vehicle' as const,
              groupId: 1,
              objectiveName: objective.name,
              unitPositions: [
                { x: position.x, y: position.y, heading: 0 },
                { x: position.x + 18, y: position.y + 12, heading: 0 },
                { x: position.x - 16, y: position.y + 20, heading: 0 },
                { x: position.x + 10, y: position.y - 18, heading: 0 }
              ]
            }
          ]
        ]
      })
  )
}

const structureTargets = proceduralStructureTargets(objectives)
const vehicleTargets = airfieldVehicleTargets()

export const targets: Record<string, Target[]> = Object.fromEntries(
  objectives.map((objective) => [
    objective.name,
    [...(vehicleTargets[objective.name] ?? []), ...(structureTargets[objective.name] ?? [])]
  ])
)

export const deploymentSites = proceduralDeploymentSites(objectives)
