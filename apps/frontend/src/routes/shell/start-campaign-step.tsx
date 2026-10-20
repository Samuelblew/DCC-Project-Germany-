import { Check, Clock3, Plane, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import {
  DEFAULT_ESCALATION_ERA_DAYS,
  ESCALATION_FACTION_IDS,
  isFactionCareerAircraft,
  type CareerAircraft
} from '@dcc/data'

import { cn } from '@/lib/utils'

import { AircraftRoster } from './start-aircraft-roster'
import {
  aircraftCatalog,
  eraMenuOptions,
  eraOptions,
  factionIdsForEra,
  getFactionAircraft,
  type CampaignEra,
  type Faction,
  type PlayerSide,
  type Scenario,
  type ScenarioStep
} from './start-campaign-options'

export type CampaignMode = 'classic' | 'career'
export type CareerAcquisitionRule = 'fidelity' | 'arcade'

type CampaignStepProps = {
  scenario: Scenario
  step: Exclude<ScenarioStep, 'scenario'>
  selectedEra: CampaignEra
  factions: Faction[]
  selectedPlayerFactionId: string
  selectedOpponentFactionId: string
  campaignYear: number
  isCreatingCampaign: boolean
  forceGpsEnabledDate: boolean
  playerSide: PlayerSide
  sideSelectable: boolean
  campaignMode: CampaignMode
  acquisitionRule: CareerAcquisitionRule
  /** Career aircraft the acquisition rule allows for the player's faction. */
  careerAircraft: CareerAircraft[]
  careerAircraftName: string | undefined
  installedMods?: readonly string[]
  escalationEnabled: boolean
  eraDurationDays: number
  onSelectCampaignMode: (mode: CampaignMode) => void
  onSelectAcquisitionRule: (rule: CareerAcquisitionRule) => void
  onSelectCareerAircraft: (aircraftName: string) => void
  onToggleEscalation: (enabled: boolean) => void
  onEraDurationDaysChange: (days: number) => void
  onSelectPlayerSide: (side: PlayerSide) => void
  onSelectEra: (era: CampaignEra) => void
  onSelectPlayerFaction: (factionId: string) => void
  onSelectOpponentFaction: (factionId: string) => void
  onForceGpsEnabledDateChange: (force: boolean) => void
  onCustomizeFaction: (role: 'player' | 'opponent') => void
  onCreateFaction: (role: 'player' | 'opponent') => void
  onCustomizeFactions: () => void
  onCreateCampaign: () => void
}

export function CampaignStep({
  scenario,
  step,
  selectedEra,
  factions,
  selectedPlayerFactionId,
  selectedOpponentFactionId,
  campaignYear,
  isCreatingCampaign,
  forceGpsEnabledDate,
  playerSide,
  sideSelectable,
  campaignMode,
  acquisitionRule,
  careerAircraft,
  careerAircraftName,
  installedMods,
  escalationEnabled,
  eraDurationDays,
  onSelectCampaignMode,
  onSelectAcquisitionRule,
  onSelectCareerAircraft,
  onToggleEscalation,
  onEraDurationDaysChange,
  onSelectPlayerSide,
  onSelectEra,
  onSelectPlayerFaction,
  onSelectOpponentFaction,
  onForceGpsEnabledDateChange,
  onCustomizeFaction,
  onCreateFaction,
  onCustomizeFactions,
  onCreateCampaign
}: CampaignStepProps) {
  const [activeFactionRole, setActiveFactionRole] = useState<'player' | 'opponent'>('player')
  const selectedEraOption = eraOptions.find((era) => era.id === selectedEra) ?? eraOptions[0]!
  const selectedPlayerFaction = factions.find((faction) => faction.id === selectedPlayerFactionId)
  const selectedOpponentFaction = factions.find(
    (faction) => faction.id === selectedOpponentFactionId
  )
  const playerAircraft = getFactionAircraft(selectedPlayerFaction, installedMods)
  const selectedCareerAircraft = careerAircraft.find(
    (aircraft) => aircraft.aircraftName === careerAircraftName
  )
  const activeFaction =
    activeFactionRole === 'player' ? selectedPlayerFaction : selectedOpponentFaction
  const factionsDiffer = selectedPlayerFactionId !== selectedOpponentFactionId

  return (
    <div className="grid min-h-0 flex-1 overflow-hidden gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="synthwave-scrollbar grid min-h-0 content-start gap-2.5 overflow-x-hidden overflow-y-auto pr-2 [scrollbar-gutter:stable]">
        <div className="rounded-md border border-synthwave-purple/45 bg-synthwave-dark/78 p-3 backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="retro-font text-sm tracking-wide text-synthwave-cyan">PLAY AS</div>
            <div className="text-[0.65rem] uppercase tracking-[0.18em] text-synthwave-light/45">
              {sideSelectable
                ? 'Follows your faction color; swaps territory, bases and goal'
                : 'This scenario is blue side only'}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { side: 'blue' as const, label: 'BLUE SIDE', hint: 'Scenario player territory' },
                { side: 'red' as const, label: 'RED SIDE', hint: 'Scenario opponent territory' }
              ] as const
            ).map((option) => {
              const isSelected = playerSide === option.side
              const disabled = option.side === 'red' && !sideSelectable
              return (
                <button
                  key={option.side}
                  type="button"
                  disabled={disabled}
                  className={cn(
                    'rounded-md border p-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-35',
                    isSelected
                      ? option.side === 'blue'
                        ? 'border-synthwave-cyan bg-synthwave-cyan/10 text-white'
                        : 'border-synthwave-pink bg-synthwave-pink/10 text-white'
                      : 'border-synthwave-purple/45 text-synthwave-light hover:border-synthwave-cyan'
                  )}
                  onClick={() => onSelectPlayerSide(option.side)}
                >
                  <div className="retro-font text-sm tracking-wide">{option.label}</div>
                  <div className="mt-0.5 text-xs text-synthwave-light/55">{option.hint}</div>
                </button>
              )
            })}
          </div>
        </div>
        <div className="rounded-md border border-synthwave-purple/45 bg-synthwave-dark/78 p-3 backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="retro-font text-sm tracking-wide text-synthwave-cyan">
              CAMPAIGN MODE
            </div>
            <div className="text-[0.65rem] uppercase tracking-[0.18em] text-synthwave-light/45">
              {campaignMode === 'career'
                ? 'Fly one owned aircraft; earn money, buy aircraft, stores and wingmen'
                : 'Pick any flight of your coalition'}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { mode: 'classic' as const, label: 'CLASSIC', hint: 'The coalition is yours' },
                { mode: 'career' as const, label: 'CAREER', hint: 'One pilot, one budget' }
              ] as const
            ).map((option) => (
              <button
                key={option.mode}
                type="button"
                className={cn(
                  'rounded-md border p-2.5 text-left transition-all',
                  campaignMode === option.mode
                    ? 'border-synthwave-cyan bg-synthwave-cyan/10 text-white'
                    : 'border-synthwave-purple/45 text-synthwave-light hover:border-synthwave-cyan'
                )}
                onClick={() => onSelectCampaignMode(option.mode)}
              >
                <div className="retro-font text-sm tracking-wide">{option.label}</div>
                <div className="mt-0.5 text-xs text-synthwave-light/55">{option.hint}</div>
              </button>
            ))}
          </div>
          {campaignMode === 'career' ? (
            <>
              <div className="mt-2 flex items-center gap-2">
                <div className="text-[0.65rem] uppercase tracking-[0.18em] text-synthwave-light/45">
                  Aircraft rule
                </div>
                {(
                  [
                    {
                      rule: 'fidelity' as const,
                      label: 'FIDELITY',
                      hint: "Only your coalition's aircraft"
                    },
                    { rule: 'arcade' as const, label: 'ARCADE', hint: 'Any aircraft, any side' }
                  ] as const
                ).map((option) => (
                  <button
                    key={option.rule}
                    type="button"
                    title={option.hint}
                    className={cn(
                      'rounded border px-2.5 py-1 text-xs transition-all',
                      acquisitionRule === option.rule
                        ? 'border-synthwave-cyan bg-synthwave-cyan/10 text-white'
                        : 'border-synthwave-purple/45 text-synthwave-light hover:border-synthwave-cyan'
                    )}
                    onClick={() => onSelectAcquisitionRule(option.rule)}
                  >
                    <span className="retro-font tracking-wide">{option.label}</span>
                    <span className="ml-1.5 text-synthwave-light/55">{option.hint}</span>
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {careerAircraft.map((aircraft) => {
                  const isMod =
                    aircraftCatalog.find((entry) => entry.name === aircraft.aircraftName)?.isMod ??
                    false
                  return (
                    <button
                      key={aircraft.aircraftName}
                      type="button"
                      className={cn(
                        'flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs transition-all',
                        careerAircraftName === aircraft.aircraftName
                          ? 'border-synthwave-cyan bg-synthwave-cyan/10 text-white'
                          : 'border-synthwave-purple/45 text-synthwave-light hover:border-synthwave-cyan'
                      )}
                      onClick={() => onSelectCareerAircraft(aircraft.aircraftName)}
                    >
                      <Plane className="h-3.5 w-3.5" />
                      {aircraft.displayName}
                      {isMod ? (
                        <span className="rounded border border-synthwave-pink/40 bg-synthwave-pink/10 px-1 py-0.5 text-[0.55rem] uppercase text-synthwave-pink">
                          MOD
                        </span>
                      ) : null}
                    </button>
                  )
                })}
                {careerAircraft.length === 0 ? (
                  <div className="text-xs text-synthwave-pink">
                    No career aircraft in your coalition. Pick another faction or switch to Arcade.
                  </div>
                ) : null}
              </div>
              {selectedCareerAircraft &&
              selectedOpponentFaction &&
              isFactionCareerAircraft(
                selectedCareerAircraft,
                selectedOpponentFaction.aircraftTypes
              ) ? (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-synthwave-cyan/80">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  The enemy flies the {selectedCareerAircraft.displayName} too: telling friend from
                  foe by eye gets harder.
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        {step === 'era' || escalationEnabled ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {eraMenuOptions.map((era) => {
              const isEscalation = era.id === 'Escalation'
              const isSelected = isEscalation
                ? escalationEnabled
                : !escalationEnabled && era.id === selectedEra
              const eraDefaults = isEscalation
                ? ESCALATION_FACTION_IDS.Korea
                : factionIdsForEra(era.id, scenario.theatreName)

              return (
                <div
                  key={era.id}
                  className={cn(
                    'group flex flex-col rounded-md border text-left transition-all',
                    isEscalation && isSelected && 'sm:col-span-2',
                    'bg-synthwave-dark/78 shadow-[0_18px_45px_rgba(0,0,0,0.22)] backdrop-blur',
                    isSelected
                      ? 'border-synthwave-pink text-white shadow-[0_0_32px_rgba(217,68,58,0.24)]'
                      : 'border-synthwave-purple/45 text-synthwave-light hover:border-synthwave-cyan hover:bg-synthwave-purple/10'
                  )}
                >
                  <button
                    type="button"
                    className="flex w-full flex-col p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-synthwave-cyan"
                    onClick={() => {
                      if (era.id === 'Escalation') {
                        onToggleEscalation(true)
                        return
                      }
                      onSelectEra(era.id)
                    }}
                  >
                    <div className="mb-2 flex w-full items-start justify-between gap-3">
                      <div>
                        <div className="retro-font text-lg tracking-wide">{era.label}</div>
                        <div className="mt-1 flex items-center gap-1 text-xs text-synthwave-cyan/75">
                          <Clock3 className="h-3.5 w-3.5" />
                          {era.callsign}
                        </div>
                      </div>
                      <span
                        className={cn(
                          'rounded border px-2 py-1 text-xs',
                          isSelected
                            ? 'border-synthwave-pink/70 text-synthwave-pink'
                            : 'border-synthwave-purple/50 text-synthwave-light/55'
                        )}
                      >
                        {isSelected ? 'SELECTED' : 'AVAILABLE'}
                      </span>
                    </div>
                    <p className="text-sm leading-5 text-synthwave-light/68">{era.description}</p>
                  </button>
                  <div className="flex flex-col gap-2 border-t border-synthwave-purple/25 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Plane className="h-3.5 w-3.5 text-synthwave-cyan/60" />
                      <span className="text-[0.65rem] uppercase tracking-[0.18em] text-synthwave-light/40">
                        {
                          factions.find(
                            (faction) =>
                              faction.id ===
                              (playerSide === 'red' ? eraDefaults.opponent : eraDefaults.player)
                          )?.name
                        }
                      </span>
                    </div>
                    {isEscalation && isSelected ? (
                      <label
                        className="flex flex-col gap-1"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex items-center justify-between text-[0.65rem] uppercase tracking-[0.18em] text-synthwave-light/45">
                          <span>Days per generation</span>
                          <span className="retro-font text-synthwave-cyan">{eraDurationDays}</span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={30}
                          value={eraDurationDays}
                          onChange={(event) => onEraDurationDaysChange(Number(event.target.value))}
                          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-synthwave-purple/50 accent-synthwave-pink"
                        />
                        <div className="text-[0.58rem] text-synthwave-light/40">
                          Default {DEFAULT_ESCALATION_ERA_DAYS} days. Last generation stays until
                          the scenario ends.
                        </div>
                      </label>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {(
              [
                {
                  role: 'player' as const,
                  label: 'PLAYER',
                  selectedId: selectedPlayerFactionId,
                  onSelect: onSelectPlayerFaction
                },
                {
                  role: 'opponent' as const,
                  label: 'OPPONENT',
                  selectedId: selectedOpponentFactionId,
                  onSelect: onSelectOpponentFaction
                }
              ] as const
            ).map((column) => (
              <div key={column.role} className="flex min-h-0 flex-col">
                <div className="retro-font sticky top-0 z-10 bg-synthwave-dark/95 pb-2 text-sm tracking-wide text-synthwave-cyan backdrop-blur-sm">
                  {column.label}
                </div>
                <div className="grid gap-2">
                  {factions.map((faction) => {
                    const isSelected = faction.id === column.selectedId
                    const isActive = isSelected && activeFactionRole === column.role
                    const isConflict =
                      column.role === 'opponent'
                        ? faction.id === selectedPlayerFactionId
                        : faction.id === selectedOpponentFactionId

                    return (
                      <button
                        key={`${column.role}-${faction.id}`}
                        type="button"
                        className={cn(
                          'rounded-md border p-3 text-left transition-all',
                          'bg-synthwave-dark/78 backdrop-blur',
                          isSelected
                            ? isActive
                              ? 'border-synthwave-pink text-white shadow-[inset_3px_0_0_var(--synthwave-pink),0_0_24px_rgba(217,68,58,0.2)]'
                              : 'border-synthwave-cyan/80 bg-synthwave-cyan/[0.06] text-white shadow-[inset_3px_0_0_var(--synthwave-cyan),0_0_20px_rgba(232,183,48,0.12)]'
                            : 'border-synthwave-purple/45 text-synthwave-light hover:border-synthwave-cyan hover:bg-synthwave-purple/10',
                          isConflict && !isSelected && 'opacity-45'
                        )}
                        onClick={() => {
                          setActiveFactionRole(column.role)
                          column.onSelect(faction.id)
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="retro-font text-base tracking-wide">{faction.name}</div>
                            <div className="mt-1 text-xs text-synthwave-cyan/75">
                              {faction.year != null ? `YEAR ${faction.year}` : faction.id}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {isSelected ? (
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[0.58rem] uppercase tracking-wider',
                                  isActive
                                    ? 'border-synthwave-pink/60 bg-synthwave-pink/10 text-synthwave-pink'
                                    : 'border-synthwave-cyan/60 bg-synthwave-cyan/10 text-synthwave-cyan'
                                )}
                              >
                                <Check className="h-2.5 w-2.5" />
                                Selected
                              </span>
                            ) : null}
                            <span
                              className={cn(
                                'rounded border px-2 py-0.5 text-[0.6rem] uppercase tracking-wider',
                                faction.color === 'blue'
                                  ? 'border-synthwave-cyan/50 text-synthwave-cyan'
                                  : 'border-synthwave-pink/50 text-synthwave-pink'
                              )}
                            >
                              {faction.color}
                            </span>
                          </div>
                        </div>
                        {faction.id.startsWith('custom-') ? (
                          <div className="mt-2 text-[0.58rem] uppercase tracking-[0.18em] text-synthwave-pink/75">
                            Custom faction
                          </div>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AircraftRoster
        scenario={scenario}
        step={step}
        eraLabel={escalationEnabled ? 'Escalation' : selectedEraOption.label}
        playerFaction={selectedPlayerFaction}
        opponentFaction={selectedOpponentFaction}
        playerFactionId={selectedPlayerFactionId}
        campaignYear={campaignYear}
        aircraft={playerAircraft}
        isCreatingCampaign={isCreatingCampaign}
        forceGpsEnabledDate={forceGpsEnabledDate}
        factionsDiffer={factionsDiffer}
        selectedFaction={activeFaction}
        lockFactions={escalationEnabled}
        onCustomizeFactions={onCustomizeFactions}
        onForceGpsEnabledDateChange={onForceGpsEnabledDateChange}
        onCustomizeSelectedFaction={() => onCustomizeFaction(activeFactionRole)}
        onCreateSelectedFaction={() => onCreateFaction(activeFactionRole)}
        onCreateCampaign={onCreateCampaign}
      />
    </div>
  )
}
