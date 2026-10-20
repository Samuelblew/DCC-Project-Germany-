import { useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { airActivity, resolveAirActivity, schemas } from '@dcc/contracts'
import type * as z from 'zod'
import { getCareerAircraft } from '@dcc/data'
import { Coins, Pencil, Plane, Plus, Radio, Trash2, Users, Warehouse } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { AIRCRAFT_ROLE_LABELS } from '@/lib/aircraft-display'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  canFlyCareerFlight,
  getAvailablePilots,
  getCareerLoadouts,
  getLoadoutShortfall,
  getReadyAirframes
} from '@/logic/career/career'
import { hasFlightGroupTakenOff } from '@/logic/entities/flight-status'
import { activeStore } from '@/stores/active'
import { canCreateManualFlightGroup } from '@/logic/systems/spawn/manual-flight-group'
import { ImmersionOptions } from '../components/immersion-options'
import { PlayerParkingSelect } from '../components/player-parking-select'
import { CareerPresetEditor } from './career-preset-editor'
import { CareerRadioDialog } from './career-radio-dialog'

/** DCS flights hold four aircraft: the player and up to three wingmen. */
const MAX_WINGMEN = 3

function formatTakeoff(start: Date, now: Date) {
  const minutes = Math.round((start.getTime() - now.getTime()) / 60_000)
  if (minutes <= 0) return 'now'
  if (minutes < 60) return `in ${minutes} min`
  return `in ${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/**
 * The career's home screen for flying: pick one of your aircraft, a mission leaving from its base,
 * a loadout and wingmen, then crew the sortie.
 */
type EnemySkill = NonNullable<
  NonNullable<z.infer<typeof schemas.campaign.campaign>['campaignParams']>['enemySkill']
>

const enemySkillOptions: Array<{ value: EnemySkill | 'default'; label: string; hint: string }> = [
  { value: 'default', label: 'Default', hint: 'Generator defaults (High, ships Excellent)' },
  { value: 'Average', label: 'Average', hint: 'Every enemy AI at Average' },
  { value: 'Good', label: 'Good', hint: 'Every enemy AI at Good' },
  { value: 'High', label: 'High', hint: 'Every enemy AI at High' },
  { value: 'Excellent', label: 'Excellent', hint: 'Every enemy AI at Excellent' },
  { value: 'Random', label: 'Random', hint: 'DCS rolls a random skill for each enemy unit' }
]

export function CareerOpsDialog({
  open,
  onOpenChange,
  onOpenHangar,
  onOpenOtherMissions
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenHangar: () => void
  onOpenOtherMissions: () => void
}) {
  const career = useSelector(activeStore, (state) => state.context.career)
  const flightGroups = useSelector(
    activeStore,
    (state) => state.context.coalitions.player.flightGroups
  )
  // Minute resolution: the clock ticks every frame, and this screen only needs takeoff countdowns.
  const campaignMinute = useSelector(activeStore, (state) =>
    Math.floor(new Date(state.context.time).getTime() / 60_000)
  )
  const now = new Date(campaignMinute * 60_000)

  const [airframeId, setAirframeId] = useState<string | null>(null)
  const [flightGroupId, setFlightGroupId] = useState<string | null>(null)
  const [missionView, setMissionView] = useState<'mine' | 'generated'>('mine')
  const [loadoutId, setLoadoutId] = useState<string | null>(null)
  const [wingmen, setWingmen] = useState<Array<{ airframeId: string; pilotId: string }>>([])
  const [radioOpen, setRadioOpen] = useState(false)
  const airActivityValue = useSelector(activeStore, (state) =>
    resolveAirActivity(state.context.campaignParams?.airActivity)
  )
  const enemySkill = useSelector(
    activeStore,
    (state) => state.context.campaignParams?.enemySkill ?? 'default'
  )
  const [presetEditor, setPresetEditor] = useState<{ presetId?: string; key: number } | null>(null)

  const readyAirframes = career ? getReadyAirframes(career) : []
  const airframe =
    readyAirframes.find((entry) => entry.id === airframeId) ?? readyAirframes[0] ?? undefined
  // Missions, loadouts, stock and radios all follow the type of the selected aircraft.
  const aircraft = career
    ? getCareerAircraft(airframe?.aircraftName ?? career.preferredAircraft)
    : undefined
  const base = airframe?.location
  const flyable =
    career && aircraft && base
      ? flightGroups
          .filter(
            (group) =>
              group.homeBase === base &&
              !hasFlightGroupTakenOff(group, now) &&
              canFlyCareerFlight(career, aircraft, group)
          )
          .sort((a, b) => +new Date(a.flightplan.startTime) - +new Date(b.flightplan.startTime))
      : []
  // Your own planned missions, or the coalition's generated (ATO) ones you can take over.
  const missions = flyable.filter((group) =>
    missionView === 'mine' ? group.careerMission === true : group.careerMission !== true
  )
  const mission = missions.find((group) => group.id === flightGroupId) ?? missions[0]
  const allLoadouts = career && aircraft ? getCareerLoadouts(career, aircraft) : []
  const loadouts = mission
    ? [...allLoadouts].sort(
        (a, b) => Number(b.tasks.includes(mission.task)) - Number(a.tasks.includes(mission.task))
      )
    : allLoadouts

  if (!career || !aircraft) return null

  // Until you pick one, start from the best loadout your stock can actually arm.
  const flightSize = 1 + wingmen.length
  const canArm = (entry: (typeof loadouts)[number]) =>
    getLoadoutShortfall(career, aircraft, entry, flightSize).length === 0
  const loadout =
    loadouts.find((entry) => entry.id === loadoutId) ?? loadouts.find(canArm) ?? loadouts[0]
  const pilots = getAvailablePilots(career)
  const baseAirframes = base ? getReadyAirframes(career, base, aircraft.aircraftName) : []
  const usedAirframeIds = new Set([airframe?.id, ...wingmen.map((w) => w.airframeId)])
  const usedPilotIds = new Set(wingmen.map((w) => w.pilotId))
  const spareAirframes = baseAirframes.filter((entry) => !usedAirframeIds.has(entry.id))
  const sparePilots = pilots.filter((pilot) => !usedPilotIds.has(pilot.id))
  const shortfall = loadout
    ? getLoadoutShortfall(career, aircraft, loadout, 1 + wingmen.length)
    : []
  // Only tasks the planner can actually build from this base right now.
  const plannableTasks = base
    ? schemas.task.options
        .filter(
          (task) =>
            task === 'Training' || aircraft.loadouts.some((entry) => entry.tasks.includes(task))
        )
        .filter((task) =>
          canCreateManualFlightGroup(activeStore.getSnapshot().context, 'player', task, {
            homeBases: new Set([base]),
            aircraftType: aircraft.aircraftName
          })
        )
    : []
  const blocker = !airframe
    ? 'No aircraft on the ground. Buy one in the hangar.'
    : !mission
      ? `No mission leaving ${base}. Plan a new one below.`
      : !loadout
        ? 'Choose a loadout'
        : shortfall.length > 0
          ? `Not enough stores: ${shortfall.map((s) => `${s.name} ${s.owned}/${s.needed}`).join(', ')}`
          : null

  const selectAirframe = (id: string) => {
    setAirframeId(id)
    setFlightGroupId(null)
    setWingmen([])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,900px)] flex-col overflow-hidden overflow-y-hidden border-synthwave-pink/30 bg-synthwave-dark/95 text-synthwave-light backdrop-blur-xl sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="retro-font flex items-center gap-3 text-synthwave-cyan">
            <Plane className="h-5 w-5" />
            {aircraft.displayName} operations
            <span className="text-xs font-normal uppercase tracking-[0.15em] text-white/45">
              {AIRCRAFT_ROLE_LABELS[aircraft.role]}
            </span>
            <span className="ml-auto flex items-center gap-1.5 text-base">
              <Coins className="h-4 w-4" />
              {Math.round(career.money)} cr
            </span>
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 text-secondary/70">
            Pick an aircraft, a mission from its base, a loadout and your wingmen.
            <Button size="sm" variant="outline" className="ml-auto h-7" onClick={onOpenHangar}>
              <Warehouse className="mr-1 h-3.5 w-3.5" />
              Hangar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={!aircraft.radios}
              title={aircraft.radios ? undefined : 'This aircraft has no programmable radios'}
              onClick={() => setRadioOpen(true)}
            >
              <Radio className="mr-1 h-3.5 w-3.5" />
              Radio
            </Button>
            <Button size="sm" variant="outline" className="h-7" onClick={onOpenOtherMissions}>
              Other aircraft missions
            </Button>
          </DialogDescription>
        </DialogHeader>

        {career.sortie ? (
          <div className="flex items-center gap-3 rounded border border-synthwave-cyan/40 bg-synthwave-cyan/10 px-3 py-2 text-sm">
            Sortie {career.sortie.callsign} is crewed and armed at {career.sortie.homeBase}. Use
            Takeoff when ready.
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7"
              onClick={() => activeStore.send({ type: 'careerAbortSortie' })}
            >
              Stand down
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 rounded border border-white/10 bg-black/20 px-3 py-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-white/50">
            Enemy AI skill
          </span>
          {enemySkillOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.hint}
              onClick={() =>
                activeStore.send({
                  type: 'setEnemySkill',
                  enemySkill: option.value === 'default' ? undefined : option.value
                })
              }
              className={cn(
                'rounded border px-2 py-0.5 text-xs transition-colors',
                enemySkill === option.value
                  ? 'border-synthwave-cyan/60 bg-synthwave-cyan/15 text-synthwave-cyan'
                  : 'border-white/15 text-white/60 hover:bg-white/5 hover:text-white'
              )}
            >
              {option.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-white/40">
            Applies to every enemy aircraft, SAM, ground unit and ship in the next mission
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded border border-white/10 bg-black/20 px-3 py-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-white/50">
            Air activity
          </span>
          <input
            type="range"
            min={airActivity.min}
            max={airActivity.max}
            step={airActivity.step}
            value={airActivityValue}
            aria-label="AI air activity multiplier"
            className="w-48 accent-synthwave-cyan"
            onChange={(event) =>
              activeStore.send({ type: 'setAirActivity', airActivity: Number(event.target.value) })
            }
          />
          <span className="w-12 text-synthwave-cyan">x{airActivityValue.toFixed(2)}</span>
          <span className="ml-auto text-xs text-white/40">
            How many AI packages (CAP, strike, SEAD, CAS) both sides keep in the air. Builds up over
            the next campaign hours
          </span>
        </div>

        <div className="rounded border border-white/10 bg-black/20 px-3 py-2 text-sm">
          <ImmersionOptions compact />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden text-sm lg:grid-cols-[1fr_1.3fr_1.3fr]">
          {/* 1. Aircraft */}
          <section className="flex min-h-0 flex-col gap-2 rounded border border-white/10 bg-black/20 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-white/50">
              1 · Your aircraft
            </h3>
            <div className="synthwave-scrollbar min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {career.airframes
                .filter((entry) => entry.status !== 'destroyed')
                .map((entry) => {
                  const selectable = entry.status === 'ready'
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={!selectable}
                      onClick={() => selectAirframe(entry.id)}
                      className={cn(
                        'w-full rounded border px-3 py-2 text-left transition-colors disabled:opacity-50',
                        airframe?.id === entry.id
                          ? 'border-synthwave-cyan/60 bg-synthwave-cyan/10'
                          : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="retro-font text-base text-synthwave-cyan">
                          #{entry.tailNumber}
                        </span>
                        <span className="text-xs text-white/60">
                          {getCareerAircraft(entry.aircraftName)?.shortName ?? entry.aircraftName}
                        </span>
                        <span
                          className={cn(
                            'ml-auto tabular-nums',
                            entry.integrity < 0.7 ? 'text-synthwave-pink' : 'text-white/80'
                          )}
                        >
                          {Math.round(entry.integrity * 100)}%
                        </span>
                      </div>
                      <div className="text-xs text-white/55">
                        {entry.location} ·{' '}
                        {entry.status === 'flying'
                          ? 'on sortie'
                          : entry.status === 'delivering'
                            ? 'in delivery'
                            : entry.condition}
                      </div>
                    </button>
                  )
                })}
            </div>
          </section>

          {/* 2. Mission */}
          <section className="flex min-h-0 flex-col gap-2 rounded border border-white/10 bg-black/20 p-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-white/50">
                2 · Mission from {base ?? '—'}
              </h3>
              <div className="ml-auto flex rounded border border-white/15 p-0.5 text-[11px]">
                {(
                  [
                    { id: 'mine', label: 'My missions' },
                    { id: 'generated', label: 'Generated' }
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setMissionView(option.id)
                      setFlightGroupId(null)
                    }}
                    className={cn(
                      'rounded px-2 py-0.5 transition-colors',
                      missionView === option.id
                        ? 'bg-synthwave-cyan/20 text-synthwave-cyan'
                        : 'text-white/50 hover:text-white/80'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-white/40">
              {missionView === 'mine'
                ? 'Missions you planned. They wait for you and leave as soon as you crew them.'
                : 'The coalition planned these. Crewing one replaces its aircraft with yours.'}
            </p>
            <div className="synthwave-scrollbar min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {missions.length === 0 ? (
                <div className="rounded border border-white/10 p-3 text-center text-white/40">
                  {missionView === 'mine'
                    ? 'You have no mission from this base. Plan one below.'
                    : 'No generated mission leaves this base.'}
                </div>
              ) : (
                missions.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setFlightGroupId(group.id)}
                    className={cn(
                      'w-full rounded border px-3 py-2 text-left transition-colors',
                      mission?.id === group.id
                        ? 'border-synthwave-cyan/60 bg-synthwave-cyan/10'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{group.task}</span>
                      <span className="ml-auto text-xs text-white/55">
                        {formatTakeoff(new Date(group.flightplan.startTime), now)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-white/55">
                      <span className="min-w-0 flex-1 truncate">
                        {group.callsign}
                        {group.target
                          ? ` · ${group.target.type} at ${group.target.objectiveId}`
                          : ''}
                      </span>
                      {group.careerMission ? (
                        <span
                          role="button"
                          tabIndex={0}
                          title="Delete this mission"
                          className="text-white/45 hover:text-synthwave-pink"
                          onClick={(event) => {
                            event.stopPropagation()
                            activeStore.send({
                              type: 'careerDeleteMission',
                              flightGroupId: group.id
                            })
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return
                            event.stopPropagation()
                            activeStore.send({
                              type: 'careerDeleteMission',
                              flightGroupId: group.id
                            })
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))
              )}
            </div>
            {base ? (
              <div className="border-t border-white/10 pt-2">
                <div className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-white/40">
                  Plan a new mission from {base}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {plannableTasks.length === 0 ? (
                    <span className="text-xs text-white/40">
                      Nothing to plan from here right now.
                    </span>
                  ) : null}
                  {plannableTasks.map((task) => (
                    <Button
                      key={task}
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        activeStore.send({
                          type: 'createManualPlayerFlightGroup',
                          task,
                          homeBase: base,
                          aircraftType: aircraft.aircraftName
                        })
                        setMissionView('mine')
                      }}
                    >
                      <Plus className="mr-0.5 h-3 w-3" />
                      {task}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {/* 3. Loadout and wingmen */}
          <section className="flex min-h-0 flex-col gap-2 rounded border border-white/10 bg-black/20 p-3">
            <div className="flex items-center">
              <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-white/50">
                3 · Loadout
              </h3>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-6 px-2 text-xs"
                onClick={() => setPresetEditor({ key: Date.now() })}
              >
                <Plus className="mr-0.5 h-3 w-3" />
                New preset
              </Button>
            </div>
            <div className="synthwave-scrollbar max-h-48 space-y-1 overflow-y-auto">
              {loadouts.map((entry) => {
                const own = career.presets.some((preset) => preset.id === entry.id)
                const short =
                  getLoadoutShortfall(career, aircraft, entry, 1 + wingmen.length).length > 0
                return (
                  <div
                    key={entry.id}
                    className={cn(
                      'flex items-center gap-2 rounded border px-2 py-1.5',
                      loadout?.id === entry.id
                        ? 'border-synthwave-cyan/60 bg-synthwave-cyan/10'
                        : 'border-white/10 bg-white/[0.03]'
                    )}
                  >
                    <button
                      type="button"
                      className="flex-1 text-left"
                      onClick={() => setLoadoutId(entry.id)}
                    >
                      {entry.name}
                    </button>
                    {mission && entry.tasks.includes(mission.task) ? (
                      <span className="text-[10px] uppercase text-synthwave-cyan">suggested</span>
                    ) : null}
                    {own ? <span className="text-[10px] uppercase text-white/45">mine</span> : null}
                    {short ? (
                      <span className="text-[10px] uppercase text-synthwave-pink">short</span>
                    ) : null}
                    {own ? (
                      <button
                        type="button"
                        className="text-white/50 hover:text-white"
                        title="Edit preset"
                        onClick={() => setPresetEditor({ presetId: entry.id, key: Date.now() })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>

            <div className="mt-1 flex items-center">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-white/50">
                <Users className="h-3.5 w-3.5" />
                Wingmen
              </h3>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-6 px-2 text-xs"
                disabled={
                  wingmen.length >= MAX_WINGMEN ||
                  spareAirframes.length === 0 ||
                  sparePilots.length === 0
                }
                title={
                  spareAirframes.length === 0
                    ? `No spare aircraft at ${base}`
                    : sparePilots.length === 0
                      ? 'Hire a wingman in the hangar'
                      : undefined
                }
                onClick={() =>
                  setWingmen((current) => [
                    ...current,
                    { airframeId: spareAirframes[0]!.id, pilotId: sparePilots[0]!.id }
                  ])
                }
              >
                <Plus className="mr-0.5 h-3 w-3" />
                Add
              </Button>
            </div>
            {wingmen.length === 0 ? (
              <p className="text-xs text-white/40">Flying alone.</p>
            ) : (
              wingmen.map((wingman, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <select
                    className="min-w-0 flex-1 rounded border border-white/15 bg-black/40 px-1.5 py-1 text-xs"
                    value={wingman.pilotId}
                    onChange={(event) =>
                      setWingmen((current) =>
                        current.map((w, i) =>
                          i === index ? { ...w, pilotId: event.target.value } : w
                        )
                      )
                    }
                  >
                    {pilots
                      .filter(
                        (pilot) => pilot.id === wingman.pilotId || !usedPilotIds.has(pilot.id)
                      )
                      .map((pilot) => (
                        <option key={pilot.id} value={pilot.id}>
                          {pilot.name} · {pilot.skill}
                        </option>
                      ))}
                  </select>
                  <select
                    className="w-24 rounded border border-white/15 bg-black/40 px-1.5 py-1 text-xs"
                    value={wingman.airframeId}
                    onChange={(event) =>
                      setWingmen((current) =>
                        current.map((w, i) =>
                          i === index ? { ...w, airframeId: event.target.value } : w
                        )
                      )
                    }
                  >
                    {baseAirframes
                      .filter(
                        (entry) => entry.id === wingman.airframeId || !usedAirframeIds.has(entry.id)
                      )
                      .map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          #{entry.tailNumber} {Math.round(entry.integrity * 100)}%
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className="text-white/50 hover:text-white"
                    onClick={() => setWingmen((current) => current.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}

            <div className="mt-auto space-y-2 border-t border-white/10 pt-2">
              {mission && aircraft ? (
                <PlayerParkingSelect
                  flightGroupId={mission.id}
                  aircraftName={aircraft.aircraftName}
                />
              ) : null}
              {airframe && airframe.integrity < 1 ? (
                <p className="text-xs text-synthwave-pink/80">
                  #{airframe.tailNumber} has unrepaired damage: expect minor system failures.
                </p>
              ) : null}
              {blocker ? <p className="text-xs text-synthwave-pink">{blocker}</p> : null}
              <Button
                className="w-full"
                variant="tacticalAction"
                disabled={blocker != null}
                onClick={() => {
                  if (!airframe || !mission || !loadout) return
                  activeStore.send({
                    type: 'careerLaunchSortie',
                    plan: {
                      flightGroupId: mission.id,
                      loadoutId: loadout.id,
                      playerAirframeId: airframe.id,
                      wingmen
                    }
                  })
                  setWingmen([])
                  onOpenChange(false)
                }}
              >
                Crew and arm {mission ? mission.callsign : ''}
              </Button>
            </div>
          </section>
        </div>

        <CareerRadioDialog
          open={radioOpen}
          aircraftName={aircraft.aircraftName}
          onOpenChange={setRadioOpen}
        />
        {presetEditor ? (
          <CareerPresetEditor
            key={presetEditor.key}
            open
            aircraftName={aircraft.aircraftName}
            presetId={presetEditor.presetId}
            onClose={(savedId) => {
              setPresetEditor(null)
              if (savedId) setLoadoutId(savedId)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
