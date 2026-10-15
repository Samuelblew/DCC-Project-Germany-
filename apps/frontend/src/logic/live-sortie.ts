import { produce } from 'immer'
import { schemas } from '@dcc/contracts'
import * as z from 'zod'

import { applyFastTick, applyLogicTick, type LiveSortieFreeze } from './campaign-tick'
import {
  applyLiveIadsDeaths,
  campaignDateFromMissionTime
} from '@/routes/campaign/mission/mission-state-update'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type MissionState = z.infer<typeof schemas.missionState>
type Coalition = 'player' | 'opponent'

const STEP_MS = 1000
/** One state-file update is 30s. A larger gap keeps catching up on the next read. */
const MAX_CATCH_UP_MS = 60_000

const coalitions: Array<[Coalition, 'blue' | 'red']> = [
  ['player', 'blue'],
  ['opponent', 'red']
]

function groundIdFromMissionName(name: string): string | null {
  const match = name.match(/^Ground-(.+)-\d+(?:-\d+)?$/)
  return match?.[1] ?? null
}

function collectFreeze(campaign: Campaign, missionState: MissionState): LiveSortieFreeze {
  const callsigns = new Set<string>()
  const groundIds = new Set<string>()
  for (const [, side] of coalitions) {
    for (const group of missionState.groupPositions?.[side].aircraft ?? []) {
      callsigns.add(group.name)
    }
    for (const group of missionState.groupPositions?.[side].ground ?? []) {
      const id = groundIdFromMissionName(group.name)
      if (id) groundIds.add(id)
    }
  }

  const flightIds = new Set<string>()
  for (const [coalition] of coalitions) {
    for (const flight of campaign.coalitions[coalition].flightGroups) {
      if (callsigns.has(flight.callsign)) flightIds.add(flight.id)
    }
  }

  return { flightIds, groundIds }
}

function overlayPositions(draft: Campaign, missionState: MissionState) {
  for (const [coalition, side] of coalitions) {
    const aircraft = new Map(
      (missionState.groupPositions?.[side].aircraft ?? []).map((group) => [group.name, group])
    )
    for (const flight of draft.coalitions[coalition].flightGroups) {
      const missionGroup = aircraft.get(flight.callsign)
      if (!missionGroup) continue
      flight.position = { x: missionGroup.x, y: missionGroup.y }
    }

    const ground = new Map<string, { x: number; y: number }>()
    for (const group of missionState.groupPositions?.[side].ground ?? []) {
      const id = groundIdFromMissionName(group.name)
      if (id) ground.set(id, group)
    }
    for (const group of draft.coalitions[coalition].groundGroups) {
      const missionGroup = ground.get(group.id)
      if (!missionGroup) continue
      group.position = { x: missionGroup.x, y: missionGroup.y }
    }

    for (const ewr of draft.coalitions[coalition].ewrGroups ?? []) {
      const prefix = `IADS-EWR-${ewr.id}-`
      const missionGroup = missionState.groupPositions?.[side].ground?.find((group) =>
        group.name.startsWith(prefix)
      )
      if (missionGroup) ewr.position = { x: missionGroup.x, y: missionGroup.y }
    }

    for (const navalGroup of draft.coalitions[coalition].navalGroups ?? []) {
      const missionGroupId = navalGroup.missionGroupId ?? navalGroup.id
      const missionGroup = missionState.groupPositions?.[side].ships?.find(
        (group) => group.name === `NavalGroup-${missionGroupId}`
      )
      if (!missionGroup || navalGroup.persistPosition === false) continue
      navalGroup.position = { x: missionGroup.x, y: missionGroup.y }
    }
  }
}

/**
 * While a sortie is running, DCS time and the positions in `dcc_state.json` own the entities
 * that made it into the mission. Everything else keeps advancing on the campaign tick, at 1×.
 * Search-radar deaths are kept immediately. Other losses stay with the debrief.
 */
export function applyLiveSortie(campaign: Campaign, missionState: MissionState): Campaign {
  if (missionState.missionId !== campaign.id) return campaign

  const remembered = applyLiveIadsDeaths(campaign, missionState)
  const missionDate = campaignDateFromMissionTime(new Date(remembered.time), missionState.time)
  if (!missionDate) return remembered

  const behindMs = missionDate.getTime() - new Date(remembered.time).getTime()
  const clockNeedsWork = behindMs >= STEP_MS || remembered.timeMultiplier !== 0
  if (!clockNeedsWork && !positionsNeedOverlay(remembered, missionState)) return remembered

  const freeze = collectFreeze(remembered, missionState)

  return produce(remembered, (draft) => {
    if (behindMs >= STEP_MS) {
      const steps = Math.floor(Math.min(behindMs, MAX_CATCH_UP_MS) / STEP_MS)
      draft.timeMultiplier = 1
      for (let step = 0; step < steps; step++) {
        draft.time = new Date(new Date(draft.time).getTime() + STEP_MS)
        applyFastTick(draft, STEP_MS, freeze)
        applyLogicTick(draft, STEP_MS, freeze)
      }
    }

    const caughtUp = missionDate.getTime() - new Date(draft.time).getTime() < STEP_MS
    if (caughtUp) draft.time = missionDate
    draft.timeTarget = undefined
    draft.timeMultiplier = 0
    overlayPositions(draft, missionState)
  })
}

function positionsNeedOverlay(campaign: Campaign, missionState: MissionState) {
  for (const [coalition, side] of coalitions) {
    const aircraft = new Map(
      (missionState.groupPositions?.[side].aircraft ?? []).map((group) => [group.name, group])
    )
    for (const flight of campaign.coalitions[coalition].flightGroups) {
      const missionGroup = aircraft.get(flight.callsign)
      if (!missionGroup) continue
      if (flight.position.x !== missionGroup.x || flight.position.y !== missionGroup.y) return true
    }

    for (const group of missionState.groupPositions?.[side].ground ?? []) {
      const id = groundIdFromMissionName(group.name)
      const campaignGroup = id
        ? campaign.coalitions[coalition].groundGroups.find((entry) => entry.id === id)
        : undefined
      if (!campaignGroup) continue
      if (campaignGroup.position.x !== group.x || campaignGroup.position.y !== group.y) return true
    }
  }
  return false
}
