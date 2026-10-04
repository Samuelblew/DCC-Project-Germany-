import { schemas } from '@dcc/contracts'
import { expandGroundGroupUnits } from '@dcc/campaign'
import * as z from 'zod'

export type GroundGroupData = z.infer<typeof schemas.groundGroup>

export class GroundGroup {
  static create(
    draft: z.infer<typeof schemas.campaign.campaign>,
    coalition: z.infer<typeof schemas.coalition>,
    params: {
      position: z.infer<typeof schemas.position>
      objectiveId?: string
      targetObjectiveId?: string
      targetAirdromeName?: string
      units: GroundGroupData['units']
      state?: GroundGroupData['state']
    }
  ): string {
    const id = crypto.randomUUID()
    const newGroup: GroundGroupData = {
      id,
      position: { ...params.position },
      objectiveId: params.objectiveId,
      targetObjectiveId: params.targetObjectiveId,
      targetAirdromeName: params.targetAirdromeName,
      units: params.units,
      state: params.state ?? 'idle'
    }

    expandGroundGroupUnits(newGroup)

    draft.coalitions[coalition].groundGroups.push(newGroup)
    return id
  }

  constructor(protected _data: GroundGroupData) {}

  get id() {
    return this._data.id
  }

  get position() {
    return this._data.position
  }

  get units() {
    return this._data.units
  }

  get state() {
    return this._data.state
  }

  get targetObjectiveId() {
    return this._data.targetObjectiveId
  }

  get targetAirdromeName() {
    return this._data.targetAirdromeName
  }

  setPosition(pos: z.infer<typeof schemas.position>) {
    this._data.position = pos
  }
}
