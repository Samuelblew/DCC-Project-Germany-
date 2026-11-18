import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

type Objective = z.infer<typeof schemas.objective>
type Target = z.infer<typeof schemas.target>
type DeploymentSite = z.infer<typeof schemas.deploymentSite>

/**
 * Generated ground layout for theatres without hand-placed sites (Cold War Germany, Cold War
 * Caucasus). Everything sits north-east of the objective centre: inland on the Black Sea coast.
 */
function ring(x: number, y: number, count: number, radius: number) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2
    return {
      x: x + Math.cos(angle) * radius,
      y: y + Math.sin(angle) * radius,
      heading: angle
    }
  })
}

export function proceduralStructureTargets(objectives: Objective[]): Record<string, Target[]> {
  return Object.fromEntries(
    objectives.map((objective) => {
      const position = {
        x: objective.position.x + 2200,
        y: objective.position.y + 1600
      }
      return [
        objective.name,
        [
          {
            name: `${objective.name}|Structure|1`,
            position,
            objectiveName: objective.name,
            groupId: 2,
            type: 'Structure' as const,
            unitPositions: [{ ...position, heading: 0 }]
          }
        ]
      ]
    })
  )
}

export function proceduralDeploymentSites(objectives: Objective[]): DeploymentSite[] {
  return objectives.flatMap((objective) => {
    const infantryCenter = {
      x: objective.position.x + 2200,
      y: objective.position.y + 900
    }
    const vehicleCenter = {
      x: objective.position.x + 2200,
      y: objective.position.y + 2400
    }
    const infantrySlots = ring(infantryCenter.x, infantryCenter.y, 10, 40)
    const vehicleSlots = ring(vehicleCenter.x, vehicleCenter.y, 6, 35)

    return [
      {
        id: `${objective.name}-infantry`,
        objectiveId: objective.name,
        position: infantryCenter,
        roles: ['infantry'],
        posture: 'staging-column',
        source: 'authored',
        slots: infantrySlots.map((slot, index) => ({
          id: `${objective.name}-infantry-${index + 1}`,
          ...slot,
          allowedUnitKinds: ['infantry']
        }))
      },
      {
        id: `${objective.name}-vehicles`,
        objectiveId: objective.name,
        position: vehicleCenter,
        roles: ['vehicle'],
        posture: 'dispersed-defense',
        source: 'authored',
        slots: vehicleSlots.map((slot, index) => ({
          id: `${objective.name}-vehicles-${index + 1}`,
          ...slot,
          allowedUnitKinds: ['vehicle']
        }))
      }
    ]
  })
}
