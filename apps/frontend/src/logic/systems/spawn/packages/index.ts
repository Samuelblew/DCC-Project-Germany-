import { resolveAirActivity, type schemas } from '@dcc/contracts'
import * as z from 'zod'
import { featureFlags } from '@/lib/feature-flags'
import { campaignIadsEra, eraAtoAircraftCap, eraAtoNewPackagesPerTick } from '@dcc/data'
import { enforcePackageStartSpacing } from './package-start-spacing'
import {
  commitAtoPackages,
  defaultAtoPlannerPolicy,
  planAtoPackages,
  type AtoPlannerPolicy
} from './ato-planner'
import { resolveSpawnContext } from './common'
import { spawnCsar } from './csar'
import { spawnCasevac, spawnTroopExtraction } from './recovery'
import { spawnAntiShip } from './antiship'

export function spawnPackages(
  draft: z.infer<typeof schemas.campaign.campaign>,
  coalition: z.infer<typeof schemas.coalition>,
  policy: Partial<AtoPlannerPolicy> = {}
) {
  const context = resolveSpawnContext(draft, coalition)
  if (!context) return
  spawnCsar(draft, coalition)
  spawnTroopExtraction(draft, coalition)
  spawnCasevac(draft, coalition)
  spawnAntiShip(draft, coalition)
  const generation = campaignIadsEra(draft)
  const tempo = draft.operationProfile?.tempo ?? 'standard'
  const tempoPolicy: Partial<AtoPlannerPolicy> =
    tempo === 'cautious'
      ? { maxNewPackagesPerLogicTick: 1, maxActiveAircraft: eraAtoAircraftCap(generation) }
      : tempo === 'surge'
        ? { maxNewPackagesPerLogicTick: 3, maxActiveAircraft: eraAtoAircraftCap(generation) }
        : {
            maxNewPackagesPerLogicTick: eraAtoNewPackagesPerTick(generation),
            maxActiveAircraft: eraAtoAircraftCap(generation)
          }

  const base = { ...defaultAtoPlannerPolicy, ...tempoPolicy }
  const activity = resolveAirActivity(draft.campaignParams?.airActivity)
  const result = planAtoPackages(draft, coalition, context, {
    ...base,
    maxNewPackagesPerLogicTick: Math.max(1, Math.round(base.maxNewPackagesPerLogicTick * activity)),
    maxActivePackages: Math.max(1, Math.round(base.maxActivePackages * activity)),
    maxActiveAircraft: Math.max(2, Math.round(base.maxActiveAircraft * activity)),
    enableTransport: featureFlags.transportFlightGroups,
    ...policy
  })
  commitAtoPackages(draft, coalition, result.admitted)
  enforcePackageStartSpacing(draft, coalition)
}
