import { schemas } from '@dcc/contracts'
import { advanceFalklandsCampaign } from '@dcc/campaign'
import { scenarios, theatres } from '@dcc/data'
import * as z from 'zod'

import { debugLog } from '@/lib/debug'
import { logCampaignAction } from '@/logic/simulation-log'
import { updateCareer } from '@/logic/career/career'

import { updateCampaignGoal } from './systems/campaign-goal'
import { removeDestroyedStructures } from './systems/remove-destroyed-structures'
import { spawn } from './systems/spawn'
import { updateEscalation } from './systems/update-escalation'
import { updateFlightGroups } from './systems/update-flight-groups'
import { resolveFieldEngagements, updateGroundGroups } from './systems/update-ground-groups'
import { updatePackages } from './systems/update-packages'
import { updateResources } from './systems/update-resources'
import { updateSupply } from './systems/update-supply'
import { updateDownedPilots } from './systems/downed-pilots'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>

const activeCoalitions: Coalition[] = ['player', 'opponent']

function forEachActiveCoalition(callback: (coalition: Coalition) => void) {
  for (const coalition of activeCoalitions) {
    callback(coalition)
  }
}

function isCampaignHalted(draft: Campaign) {
  return draft.status === 'lost'
}

function updateFalklandsCampaign(draft: Campaign) {
  const theatre = theatres.find((candidate) => candidate.name === 'SouthAtlantic')
  if (!theatre) return
  for (const event of advanceFalklandsCampaign(draft, theatre)) {
    logCampaignAction(draft, event.kind === 'defeat' ? 'opponent' : 'player', event.message)
  }
}

export function applyFastTick(draft: Campaign, delta: number) {
  if (isCampaignHalted(draft)) return

  debugLog('fast tick', draft.time)

  forEachActiveCoalition((coalition) => updateDownedPilots(draft, coalition))
  forEachActiveCoalition((coalition) => updateFlightGroups(draft, coalition))
  forEachActiveCoalition((coalition) => updatePackages(draft, coalition))
  forEachActiveCoalition((coalition) => removeDestroyedStructures(draft, coalition))
  forEachActiveCoalition((coalition) =>
    updateGroundGroups(draft, coalition, delta, { capture: false })
  )
  updateFalklandsCampaign(draft)
  updateCampaignGoal(draft)
}

function updateCareerUpkeep(draft: Campaign) {
  if (!draft.career) return
  const scenario = scenarios.find((entry) => entry.id === draft.scenarioId)
  const theatre = theatres.find((entry) => entry.name === scenario?.theatreName)
  if (theatre) updateCareer(draft, theatre)
}

export function applyLogicTick(draft: Campaign, delta: number) {
  if (isCampaignHalted(draft)) return

  forEachActiveCoalition((coalition) => updateResources(draft, coalition))
  forEachActiveCoalition((coalition) => updateSupply(draft, coalition, delta))
  forEachActiveCoalition((coalition) =>
    updateGroundGroups(draft, coalition, delta, { move: false })
  )
  resolveFieldEngagements(draft, delta)
  updateEscalation(draft)
  forEachActiveCoalition((coalition) => spawn(draft, coalition))
  updateCareerUpkeep(draft)
  updateFalklandsCampaign(draft)
  updateCampaignGoal(draft)
}
