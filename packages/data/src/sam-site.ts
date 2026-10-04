import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export function getSamSitePosition(
  theatre: z.infer<typeof schemas.theatre>,
  objectiveId: string
): z.infer<typeof schemas.position> | undefined {
  const samTarget = theatre.targets?.[objectiveId]?.find((target) => target.type === 'SAM')
  if (samTarget) return samTarget.position
  return theatre.objectives.find((objective) => objective.name === objectiveId)?.position
}
