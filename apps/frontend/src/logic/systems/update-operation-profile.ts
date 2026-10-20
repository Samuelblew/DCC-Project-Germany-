import { schemas } from '@dcc/contracts'
import {
  AIR_SUPERIORITY_GRAPH_DELTA,
  campaignIadsEra,
  coalitionOperationProfile,
  scenarios,
  tempoForGeneration,
  theatres
} from '@dcc/data'
import { theatreHasLandGraph } from '@dcc/campaign'
import type * as z from 'zod'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Theatre = z.infer<typeof schemas.theatre>

function graphNodeIds(theatre: Theatre) {
  const ids = new Set<string>()
  for (const connection of theatre.connections ?? []) {
    if (connection.mode === 'sea') continue
    ids.add(connection.from)
    ids.add(connection.to)
  }
  return ids
}

function ownedGraphCount(draft: Campaign, coalition: Coalition, nodes: Set<string>) {
  const owned = draft.coalitions[coalition]
  let count = 0
  for (const id of nodes) {
    if (owned.objectiveIds.includes(id) || owned.airdromeNames.includes(id)) count += 1
  }
  return count
}

/** Live commander posture. Does not spawn extra DCS units; ATO already caps flights. */
export function updateOperationProfile(draft: Campaign) {
  const scenario = scenarios.find((entry) => entry.id === draft.scenarioId)
  const theatre = theatres.find((entry) => entry.name === scenario?.theatreName)
  if (!theatre) return

  const generation = campaignIadsEra(draft)
  const eraTempo = tempoForGeneration(generation)

  if (!theatreHasLandGraph(theatre)) {
    draft.operationProfile = {
      ...(draft.operationProfile ?? {
        archetype: 'balanced',
        frontlineShape: 'linear',
        initiativeCoalition: 'opponent'
      }),
      tempo: eraTempo
    }
    return
  }

  const nodes = graphNodeIds(theatre)
  const playerHeld = ownedGraphCount(draft, 'player', nodes)
  const opponentHeld = ownedGraphCount(draft, 'opponent', nodes)
  const delta = playerHeld - opponentHeld
  const previousInitiative = draft.operationProfile?.initiativeCoalition ?? 'opponent'
  const initiativeCoalition = delta > 0 ? 'player' : delta < 0 ? 'opponent' : previousInitiative
  const airSuperiority =
    Math.abs(delta) >= AIR_SUPERIORITY_GRAPH_DELTA &&
    generation !== 'Korea' &&
    generation !== 'Vietnam'

  draft.operationProfile = {
    archetype: airSuperiority ? 'air-superiority' : 'balanced',
    frontlineShape: 'linear',
    tempo: eraTempo,
    initiativeCoalition
  }
}

export { coalitionOperationProfile }
