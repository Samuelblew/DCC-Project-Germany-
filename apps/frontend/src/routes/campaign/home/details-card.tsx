import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction
} from '@/components/ui/card'
import { Crosshair, Fuel, Layers3, PackageCheck, Radio, Route, User, Wrench, X } from 'lucide-react'
import { getTheatreAirdromeRadio, scenarios } from '@dcc/data'
import { useSelector } from '@xstate/store/react'
import { useState, type ReactNode } from 'react'
import {
  aircraftCullingRadius,
  cullingRadius,
  longRangeSamMinRangeMeters,
  resolveAircraftCullingRadiusMeters,
  resolveCullingRadiusMeters,
  resolveSamCullingRadiusMeters,
  samCullingRadius
} from '@dcc/contracts'
import { Button } from '@/components/ui/button'
import { activeStore, isFlightRouteEditable } from '@/stores/active'
import {
  planDirectedAttack,
  type DirectedAttackTarget
} from '@/logic/systems/spawn/directed-attack'
import { calculateResourceGainPerLogicTick } from '@/logic/systems/update-resources'
import { logisticsInterdictionAt } from '@/logic/systems/logistics-interdiction'
import type { SelectedItem } from './map'
import { cn } from '@/lib/utils'

function formatInGameClock(date: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  }).format(date)
}

function formatPercent(current: number, max: number) {
  if (max <= 0) return '--'
  return `${Math.round(Math.max(0, Math.min(1, current / max)) * 100)}%`
}

function getSupplyTone(current: number, max: number) {
  const value = max > 0 ? current / max : 0
  if (value <= 0.15) return 'text-red-300'
  if (value <= 0.35) return 'text-amber-300'
  return 'text-amber-300'
}

function getConnectedRoutes(
  supplyNodes: NonNullable<
    ReturnType<typeof activeStore.getSnapshot>['context']['coalitions']['player']['supplyNodes']
  >,
  nodeName: string
) {
  return Object.values(supplyNodes).flatMap(
    (supply) =>
      supply.logistics?.routes.filter(
        (route) => route.from === nodeName || route.to === nodeName
      ) ?? []
  )
}

export function DetailsCard({
  selectedItem,
  onClose,
  onSelectObjective
}: {
  selectedItem: SelectedItem
  onClose: () => void
  onSelectObjective?: (objectiveName: string) => void
}) {
  const campaign = useSelector(activeStore, (state) => state.context)
  const [attackNote, setAttackNote] = useState<{ itemId: string | null; text: string } | null>(null)
  const selectedPlayerFlight =
    selectedItem && 'flightplan' in selectedItem
      ? (campaign.coalitions.player.flightGroups.find((group) => group.id === selectedItem.id) ??
        null)
      : null
  const corridorRadiusKm = resolveCullingRadiusMeters(campaign.campaignParams?.cullingRadius) / 1000
  const aircraftCorridorRadiusKm =
    resolveAircraftCullingRadiusMeters(campaign.campaignParams?.cullingAircraftRadius) / 1000
  const samCorridorRadiusKm =
    resolveSamCullingRadiusMeters(campaign.campaignParams?.cullingSamRadius) / 1000
  const attackTarget = attackTargetFromSelection(selectedItem, campaign)
  const attack = attackTarget ? planDirectedAttack(campaign, attackTarget) : null
  const selectedId = selectedItem && 'id' in selectedItem ? selectedItem.id : null

  // A message belongs to the item it was written for; selecting another item hides it.
  const attackMessage = attackNote?.itemId === selectedId ? attackNote.text : null

  if (!selectedItem) return null

  const objectiveName =
    'objectiveId' in selectedItem && typeof selectedItem.objectiveId === 'string'
      ? selectedItem.objectiveId
      : 'target' in selectedItem &&
          selectedItem.target != null &&
          typeof selectedItem.target.objectiveId === 'string'
        ? selectedItem.target.objectiveId
        : null

  const defaultTitle =
    'callsign' in selectedItem
      ? selectedItem.callsign
      : 'name' in selectedItem
        ? selectedItem.name
        : `Ground Group ${selectedItem.id.slice(0, 8)}`
  const defaultSubtitle = `${'coalition' in selectedItem ? selectedItem.coalition : 'player'} ${
    'type' in selectedItem
      ? String(selectedItem.type)
      : 'callsign' in selectedItem
        ? 'Flight Group'
        : 'Objective'
  }`
  const isObjectiveLinkedItem =
    'type' in selectedItem &&
    (selectedItem.type === 'Structure' ||
      selectedItem.type === 'SAM' ||
      selectedItem.type === 'EWR' ||
      selectedItem.type === 'GCI' ||
      selectedItem.type === 'Ground Group')
  const headerTitle = isObjectiveLinkedItem && objectiveName != null ? objectiveName : defaultTitle
  const headerSubtitle = isObjectiveLinkedItem
    ? selectedItem.type === 'Ground Group'
      ? selectedItem.groundGroupType
      : selectedItem.name
    : defaultSubtitle
  const resourceAmount =
    'resources' in selectedItem && selectedItem.resources != null
      ? Math.floor(selectedItem.resources as number)
      : null
  const spawnCostAmount =
    'spawnCost' in selectedItem && selectedItem.spawnCost != null
      ? Math.floor(selectedItem.spawnCost as number)
      : null
  const hasSpawnProgress = resourceAmount != null && spawnCostAmount != null && spawnCostAmount > 0
  const spawnProgressPercent = hasSpawnProgress
    ? Math.min(100, Math.max(0, (resourceAmount / spawnCostAmount) * 100))
    : 0
  const remainingToSpawn = hasSpawnProgress ? Math.max(0, spawnCostAmount - resourceAmount) : null

  const selectedGroundGroup = (() => {
    const id = selectedItem.id
    return (
      campaign.coalitions.player.groundGroups.find((g) => g.id === id) ??
      campaign.coalitions.opponent.groundGroups.find((g) => g.id === id) ??
      null
    )
  })()

  const selectedStructure =
    'type' in selectedItem && selectedItem.type === 'Structure'
      ? (campaign.coalitions[selectedItem.coalition].structures.find(
          (structure) => structure.id === selectedItem.id
        ) ?? null)
      : null
  const selectedStructureCoalition =
    'type' in selectedItem && selectedItem.type === 'Structure' ? selectedItem.coalition : null
  const selectedNavalGroup =
    'type' in selectedItem && selectedItem.type === 'Naval Group'
      ? (campaign.coalitions[selectedItem.coalition].navalGroups?.find(
          (group) => group.id === selectedItem.id
        ) ?? null)
      : null
  const selectedCoalition = 'coalition' in selectedItem ? selectedItem.coalition : 'player'
  const isSelectedAirdrome = 'type' in selectedItem && selectedItem.type === 'Airdrome'
  const selectedNodeName = isSelectedAirdrome ? selectedItem.name : null
  const theatreName = scenarios.find((entry) => entry.id === campaign.scenarioId)?.theatreName
  const selectedAirdromeRadio =
    selectedNodeName != null && theatreName != null
      ? getTheatreAirdromeRadio(theatreName)[selectedNodeName]
      : undefined
  const selectedSupply =
    selectedNodeName != null
      ? (campaign.coalitions[selectedCoalition].supplyNodes?.[selectedNodeName] ?? null)
      : null
  const selectedConnectedRoutes =
    selectedSupply != null && selectedNodeName != null
      ? getConnectedRoutes(
          campaign.coalitions[selectedCoalition].supplyNodes ?? {},
          selectedNodeName
        )
      : []
  const selectedPackage =
    'flightplan' in selectedItem && 'packageId' in selectedItem && selectedItem.packageId
      ? (campaign.coalitions[selectedCoalition].packages.find(
          (missionPackage) => missionPackage.id === selectedItem.packageId
        ) ?? null)
      : null

  const gainPerInGameSecond =
    selectedStructure != null && selectedStructureCoalition != null
      ? calculateResourceGainPerLogicTick(
          selectedStructure,
          campaign.coalitions[selectedStructureCoalition].structures,
          1,
          logisticsInterdictionAt(
            campaign,
            selectedStructureCoalition,
            selectedStructure.objectiveId
          )
        )
      : 0

  const estimatedSpawnInGameSeconds =
    remainingToSpawn != null && remainingToSpawn > 0 && gainPerInGameSecond > 0
      ? remainingToSpawn / gainPerInGameSecond
      : null

  const spawnEtaLabel =
    remainingToSpawn == null
      ? null
      : remainingToSpawn <= 0
        ? formatInGameClock(new Date(campaign.time))
        : estimatedSpawnInGameSeconds == null
          ? '--:--'
          : formatInGameClock(
              new Date(new Date(campaign.time).getTime() + estimatedSpawnInGameSeconds * 1000)
            )

  return (
    <div className="absolute top-28 right-4 z-1100 flex max-h-[calc(100vh-9rem)] w-80 flex-col">
      <Card className="flex min-h-0 flex-col overflow-hidden backdrop-blur-md bg-synthwave-dark/80 border-synthwave-pink/30 text-synthwave-light shadow-[0_0_15px_color-mix(in_srgb,var(--synthwave-pink)_30%,transparent)]">
        <CardHeader className="shrink-0">
          <CardTitle className="text-synthwave-cyan retro-font">{headerTitle}</CardTitle>
          <CardDescription className="text-secondary">{headerSubtitle}</CardDescription>
          <CardAction>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close details"
              className="window-control-button window-control-button-close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </CardAction>
        </CardHeader>
        <CardContent className="synthwave-scrollbar min-h-0 flex-1 overflow-y-auto">
          {'type' in selectedItem && selectedItem.type === 'GCI' ? (
            <div className="mb-3 space-y-1 text-[11px] text-secondary">
              <p>MiG-29A KRU intercept station. WAVE {selectedItem.channel}.</p>
              <p>Control range {Math.round(selectedItem.range / 1000)} km.</p>
            </div>
          ) : null}
          {selectedPlayerFlight && (
            <div className="mb-3 space-y-1">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-secondary/70">
                <span>Route corridor</span>
                <span>{corridorRadiusKm} km</span>
              </div>
              <input
                type="range"
                min={cullingRadius.minMeters / 1000}
                max={cullingRadius.maxMeters / 1000}
                step={cullingRadius.stepMeters / 1000}
                value={corridorRadiusKm}
                aria-label="Corridor width around the route"
                className="w-full accent-synthwave-cyan"
                onChange={(event) =>
                  activeStore.send({
                    type: 'setCullingRadius',
                    meters: Number(event.target.value) * 1000
                  })
                }
              />
              <div className="flex items-center justify-between pt-2 text-[10px] uppercase tracking-wide text-secondary/70">
                <span>Aircraft corridor</span>
                <span>{aircraftCorridorRadiusKm} km</span>
              </div>
              <input
                type="range"
                min={aircraftCullingRadius.minMeters / 1000}
                max={aircraftCullingRadius.maxMeters / 1000}
                step={aircraftCullingRadius.stepMeters / 1000}
                value={aircraftCorridorRadiusKm}
                aria-label="Aircraft corridor width around the route"
                className="w-full accent-[#ffb000]"
                onChange={(event) =>
                  activeStore.send({
                    type: 'setCullingAircraftRadius',
                    meters: Number(event.target.value) * 1000
                  })
                }
              />
              <div className="flex items-center justify-between pt-2 text-[10px] uppercase tracking-wide text-secondary/70">
                <span>Long-range SAM corridor</span>
                <span>{samCorridorRadiusKm} km</span>
              </div>
              <input
                type="range"
                min={samCullingRadius.minMeters / 1000}
                max={samCullingRadius.maxMeters / 1000}
                step={samCullingRadius.stepMeters / 1000}
                value={samCorridorRadiusKm}
                aria-label="Long-range SAM corridor width around the route"
                className="w-full accent-synthwave-pink"
                onChange={(event) =>
                  activeStore.send({
                    type: 'setCullingSamRadius',
                    meters: Number(event.target.value) * 1000
                  })
                }
              />
              <p className="text-[10px] text-secondary/70">
                The route band keeps ground units and short-range air defence, the SAM band keeps
                SAMs reaching {longRangeSamMinRangeMeters / 1000} km or more, and the aircraft band
                keeps aircraft. Turn Culling on when generating the mission to load only what is
                inside them.
              </p>
              <p className="text-[10px] text-secondary/70">
                {isFlightRouteEditable(selectedPlayerFlight, campaign.time)
                  ? 'Route: drag waypoints on the map, drag the small dots between them to add one, right-click an added Nav point to delete it.'
                  : 'Route is locked because this flight has already taken off.'}
              </p>
            </div>
          )}
          {attackTarget && (
            <div className="mb-3 space-y-1">
              <Button
                type="button"
                size="sm"
                variant="tacticalAction"
                className="h-10 w-full gap-2"
                disabled={!attack?.plan}
                onClick={() => {
                  if (!attack?.plan) return
                  const before = campaign.coalitions.player.flightGroups.length
                  activeStore.send({ type: 'createDirectedAttack', target: attackTarget })
                  const after =
                    activeStore.getSnapshot().context.coalitions.player.flightGroups.length
                  setAttackNote({
                    itemId: selectedId,
                    text:
                      after > before
                        ? 'Flight added. Select it when you want to fly.'
                        : 'Could not add the flight.'
                  })
                }}
              >
                <Crosshair className="h-4 w-4" />
                {attack?.plan ? `Add ${attack.plan.task} flight` : (attack?.reason ?? 'Attack')}
              </Button>
              {attack?.plan && (
                <p className="text-[10px] uppercase tracking-wide text-secondary/70">
                  {attack.plan.aircraftType} from {attack.plan.homeBase}
                </p>
              )}
              {attackMessage && (
                <p
                  className={`text-xs ${attackMessage.startsWith('Flight added') ? 'text-secondary/80' : 'text-red-400'}`}
                >
                  {attackMessage}
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-sm">
            {'structureType' in selectedItem && (
              <>
                <div className="text-secondary/70">Structure Type</div>
                <div>{String(selectedItem.structureType)}</div>
              </>
            )}
            {'resources' in selectedItem && selectedItem.resources != null && (
              <>
                <div className="text-secondary/70">Resources</div>
                <div>{resourceAmount}</div>
              </>
            )}
            {'spawnCost' in selectedItem && selectedItem.spawnCost != null && (
              <>
                <div className="text-secondary/70">Needed to Spawn</div>
                <div>{spawnCostAmount}</div>
              </>
            )}
            {hasSpawnProgress && (
              <div className="col-span-2 mt-1">
                <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-secondary/70">
                  <span>Spawn Progress</span>
                  <span>{Math.round(spawnProgressPercent)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-synthwave-pink/15 ring-1 ring-synthwave-pink/20">
                  <div
                    className="h-full bg-linear-to-r from-synthwave-cyan to-synthwave-pink transition-[width] duration-300"
                    style={{ width: `${spawnProgressPercent}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-secondary/70">
                  <span>Est. Spawn Time</span>
                  <span>{spawnEtaLabel}</span>
                </div>
              </div>
            )}
            {objectiveName != null && (
              <>
                <div className="text-secondary/70">Objective</div>
                <div
                  className="cursor-pointer hover:text-synthwave-cyan transition-colors"
                  onClick={() => onSelectObjective?.(objectiveName)}
                >
                  {objectiveName}
                </div>
              </>
            )}
            {selectedGroundGroup && (
              <>
                <div className="text-secondary/70">Status</div>
                <div
                  className={
                    selectedGroundGroup.state === 'combat'
                      ? 'text-red-400'
                      : selectedGroundGroup.state === 'moving'
                        ? 'text-yellow-400'
                        : 'text-green-400'
                  }
                >
                  {selectedGroundGroup.state.charAt(0).toUpperCase() +
                    selectedGroundGroup.state.slice(1)}
                </div>
                {selectedGroundGroup.targetObjectiveId && (
                  <>
                    <div className="text-secondary/70">Target</div>
                    <div
                      className="cursor-pointer hover:text-synthwave-cyan transition-colors"
                      onClick={() => onSelectObjective?.(selectedGroundGroup.targetObjectiveId!)}
                    >
                      {selectedGroundGroup.targetObjectiveId}
                    </div>
                  </>
                )}
                {selectedGroundGroup.targetAirdromeName && (
                  <>
                    <div className="text-secondary/70">Target Airport</div>
                    <div>{selectedGroundGroup.targetAirdromeName}</div>
                  </>
                )}
                <div className="col-span-2 mt-2">
                  <div className="text-secondary/70 text-xs uppercase tracking-wide mb-1">
                    Units ({selectedGroundGroup.units.reduce((sum, u) => sum + u.count, 0)})
                  </div>
                  <div className="space-y-1">
                    {selectedGroundGroup.units.map((unit) => (
                      <div key={unit.name} className="flex items-center justify-between text-xs">
                        <span className="truncate mr-2">{unit.name}</span>
                        <span className="text-secondary/70 shrink-0">x{unit.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
            {selectedNavalGroup && (
              <>
                <div className="text-secondary/70">Role</div>
                <div className="capitalize">{selectedNavalGroup.role.replaceAll('-', ' ')}</div>
                <div className="text-secondary/70">Status</div>
                <div
                  className={cn(
                    'capitalize',
                    selectedNavalGroup.state === 'operational'
                      ? 'text-amber-300'
                      : selectedNavalGroup.state === 'sunk'
                        ? 'text-red-300'
                        : 'text-amber-300'
                  )}
                >
                  {selectedNavalGroup.state}
                </div>
                <div className="text-secondary/70">Capability</div>
                <div>{formatPercent(1 - selectedNavalGroup.damage, 1)}</div>
                <div className="text-secondary/70">Course</div>
                <div>
                  {Math.round(((((selectedNavalGroup.heading * 180) / Math.PI) % 360) + 360) % 360)}
                  °
                </div>
                <div className="text-secondary/70">Fuel</div>
                <div>{formatPercent(selectedNavalGroup.fuel, 1)}</div>
                <div className="text-secondary/70">Ammunition</div>
                <div>{formatPercent(selectedNavalGroup.ammunition, 1)}</div>
                {selectedNavalGroup.role === 'transport' && (
                  <>
                    <div className="text-secondary/70">Cargo</div>
                    <div>{Math.round(selectedNavalGroup.cargo)}</div>
                  </>
                )}
                <div className="col-span-2 mt-2 border-t border-synthwave-pink/10 pt-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-secondary/70">
                    Vessels (
                    {selectedNavalGroup.units
                      ? selectedNavalGroup.units.filter((unit) => unit.state !== 'sunk').length
                      : selectedNavalGroup.unitTypes.length}
                    /{selectedNavalGroup.units?.length ?? selectedNavalGroup.unitTypes.length})
                  </div>
                  <div className="space-y-1">
                    {(
                      selectedNavalGroup.units ??
                      selectedNavalGroup.unitTypes.map((type, index) => ({
                        id: `${selectedNavalGroup.id}-${index}`,
                        type,
                        state: 'operational' as const
                      }))
                    ).map((unit) => (
                      <div
                        key={unit.id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="min-w-0 truncate">{unit.type}</span>
                        <span
                          className={cn(
                            'shrink-0 capitalize',
                            unit.state === 'operational'
                              ? 'text-amber-300/80'
                              : unit.state === 'sunk'
                                ? 'text-red-300'
                                : 'text-amber-300'
                          )}
                        >
                          {unit.state}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
            {'flightplan' in selectedItem && (
              <>
                <div className="text-secondary/70">Task</div>
                <div>{(selectedItem as { task: string }).task}</div>
                {selectedPackage && (
                  <>
                    <div className="text-secondary/70">ATO Package</div>
                    <div className="min-w-0 truncate">{selectedPackage.type}</div>
                  </>
                )}
                <div className="text-secondary/70">Waypoints</div>
                <div>{selectedItem.flightplan.waypoints.length}</div>
                {'aircrafts' in selectedItem && (
                  <>
                    <div className="text-secondary/70 flex items-center gap-2">
                      Clients
                      <User className="h-3 w-3" />
                    </div>
                    <div>
                      {selectedItem.aircrafts.filter((a) => a.client).length} /{' '}
                      {selectedItem.aircrafts.length}
                    </div>
                  </>
                )}
              </>
            )}
            {selectedAirdromeRadio && (
              <div className="col-span-2 mt-2 border-t border-synthwave-pink/10 pt-3">
                <div className="mb-2 flex items-center gap-2">
                  <Radio className="h-3.5 w-3.5 shrink-0 text-synthwave-pink" />
                  <span className="retro-font truncate text-[10px] uppercase text-primary">
                    Radio
                  </span>
                  {selectedAirdromeRadio.radio ? (
                    <span className="ml-auto text-[10px] uppercase text-secondary/70">
                      {selectedAirdromeRadio.radio.callsign}
                    </span>
                  ) : null}
                </div>
                {selectedAirdromeRadio.radio ? (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-[10px] text-secondary/70">Tower UHF</div>
                      <div className="tabular-nums">
                        {selectedAirdromeRadio.radio.uhf?.toFixed(3) ?? '—'} MHz
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-secondary/70">Tower VHF</div>
                      <div className="tabular-nums">
                        {selectedAirdromeRadio.radio.vhf?.toFixed(3) ?? '—'} MHz
                      </div>
                    </div>
                  </div>
                ) : null}
                {selectedAirdromeRadio.approaches.length > 0 ? (
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="text-[10px] text-secondary/70">
                      Approach NDBs (outer / inner)
                    </div>
                    {selectedAirdromeRadio.approaches.map((approach, index) => (
                      <div key={index} className="flex justify-between gap-2 tabular-nums">
                        <span className="text-secondary/70">{approach.heading}°</span>
                        <span>
                          {approach.outer.callsign} {approach.outer.khz}
                          {approach.inner
                            ? ` / ${approach.inner.callsign} ${approach.inner.khz}`
                            : ''}{' '}
                          kHz
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
            {selectedSupply && (
              <div className="col-span-2 mt-2 border-t border-synthwave-pink/10 pt-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <PackageCheck className="h-3.5 w-3.5 shrink-0 text-synthwave-pink" />
                    <span className="retro-font truncate text-[10px] uppercase text-primary">
                      Logistics
                    </span>
                  </div>
                  <span
                    className={cn(
                      'text-[10px] uppercase',
                      getSupplyTone(selectedSupply.current, selectedSupply.max)
                    )}
                  >
                    {selectedSupply.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[10px] text-secondary/70">
                      <span>Supply</span>
                      <span className={getSupplyTone(selectedSupply.current, selectedSupply.max)}>
                        {formatPercent(selectedSupply.current, selectedSupply.max)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-synthwave-pink/15">
                      <div
                        className="h-full rounded-full bg-synthwave-cyan"
                        style={{
                          width: formatPercent(selectedSupply.current, selectedSupply.max)
                        }}
                      />
                    </div>
                  </div>
                  {selectedSupply.fuel && (
                    <PoolMeter
                      label="Fuel"
                      icon={<Fuel className="h-3 w-3 text-synthwave-pink" />}
                      current={selectedSupply.fuel.current}
                      max={selectedSupply.fuel.max}
                    />
                  )}
                  {selectedSupply.munitions && (
                    <PoolMeter
                      label="Munitions"
                      icon={<Layers3 className="h-3 w-3 text-synthwave-pink" />}
                      current={selectedSupply.munitions.current}
                      max={selectedSupply.munitions.max}
                    />
                  )}
                  {selectedSupply.repair && (
                    <PoolMeter
                      label="Repair"
                      icon={<Wrench className="h-3 w-3 text-synthwave-pink" />}
                      current={selectedSupply.repair.current}
                      max={selectedSupply.repair.max}
                    />
                  )}
                </div>
                {selectedSupply.logistics && (
                  <div className="mt-2 flex items-center justify-between rounded border border-synthwave-pink/10 bg-black/15 px-2 py-1.5 text-[10px] uppercase tracking-wide">
                    <span className="flex items-center gap-1.5 text-secondary/65">
                      <Route className="h-3 w-3 text-synthwave-cyan" />
                      {selectedConnectedRoutes.length} routes
                    </span>
                    <span className="text-secondary/65">
                      {selectedConnectedRoutes.filter((route) => route.disruption > 0.25).length}{' '}
                      disrupted
                    </span>
                  </div>
                )}
              </div>
            )}
            {'range' in selectedItem && typeof selectedItem.range === 'number' && (
              <>
                <div className="text-secondary/70">Range</div>
                <div>{(selectedItem.range / 1000).toFixed(1)} km</div>
                <div className="text-secondary/70">Status</div>
                <div
                  className={
                    (selectedItem as unknown as { active: boolean }).active
                      ? 'text-green-400'
                      : 'text-red-400'
                  }
                >
                  {(selectedItem as unknown as { active: boolean }).active ? 'Active' : 'Inactive'}
                </div>
              </>
            )}
            {'type' in selectedItem && selectedItem.type === 'EWR' && (
              <>
                <div className="text-secondary/70">Status</div>
                <div className={selectedItem.active ? 'text-green-400' : 'text-red-400'}>
                  {selectedItem.active ? 'Active' : 'Destroyed'}
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function attackTargetFromSelection(
  item: SelectedItem,
  campaign: ReturnType<typeof activeStore.getSnapshot>['context']
): DirectedAttackTarget | null {
  if (!item || 'callsign' in item) return null

  if ('units' in item && !('type' in item)) {
    const ownedByOpponent = campaign.coalitions.opponent.groundGroups.some(
      (group) => group.id === item.id
    )
    if (!ownedByOpponent) return null
    return {
      kind: 'ground',
      id: item.id,
      name: item.units[0]?.name ?? 'Ground group',
      objectiveId: item.objectiveId
    }
  }

  if (!('coalition' in item) || item.coalition !== 'opponent') return null
  if (!('type' in item)) {
    return { kind: 'town', id: item.name, name: item.name, objectiveId: item.name }
  }

  switch (item.type) {
    case 'SAM':
      return { kind: 'sam', id: item.id, name: item.name, objectiveId: item.objectiveId }
    case 'EWR':
      return { kind: 'ewr', id: item.id, name: item.name, objectiveId: item.objectiveId }
    case 'Airdrome':
      return { kind: 'airdrome', id: item.name, name: item.name, objectiveId: item.name }
    case 'Structure':
      return {
        kind: 'structure',
        id: item.id,
        name: item.name,
        objectiveId: item.objectiveId
      }
    case 'Ground Group':
      return { kind: 'ground', id: item.id, name: item.name, objectiveId: item.objectiveId }
    case 'Naval Group':
      return { kind: 'naval', id: item.id, name: item.name }
    default:
      return null
  }
}

function PoolMeter({
  label,
  icon,
  current,
  max
}: {
  label: string
  icon: ReactNode
  current: number
  max: number
}) {
  const percent = formatPercent(current, max)

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-secondary/70">
        <span className="flex min-w-0 items-center gap-1">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <span className={getSupplyTone(current, max)}>{percent}</span>
      </div>
      <div className="h-1.5 rounded-full bg-synthwave-pink/15">
        <div className="h-full rounded-full bg-synthwave-cyan" style={{ width: percent }} />
      </div>
    </div>
  )
}
