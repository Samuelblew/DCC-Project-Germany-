import { Bot, Gamepad2, Plane, Search, ShieldCheck, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { schemas } from '@dcc/contracts'
import { Tooltip as TooltipPrimitive } from 'radix-ui'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import { aircraftCatalog, type Faction } from './start-campaign-options'

type FactionEditorProps = {
  mode: 'create' | 'customize'
  seedFaction: Faction
  onCancel: () => void
  onSave: (faction: Faction) => void
}

const factionTaskNames = new Set<string>(schemas.task.options)

function cloneAircraftTypes(aircraftTypes: Faction['aircraftTypes']): Faction['aircraftTypes'] {
  return Object.fromEntries(
    Object.entries(aircraftTypes).map(([task, aircraft]) => [task, [...aircraft]])
  ) as Faction['aircraftTypes']
}

function isCustomFaction(faction: Faction) {
  return faction.id.startsWith('custom-')
}

export function FactionEditor({ mode, seedFaction, onCancel, onSave }: FactionEditorProps) {
  const [name, setName] = useState(
    mode === 'create'
      ? `${seedFaction.countryName} Task Force`
      : isCustomFaction(seedFaction)
        ? seedFaction.name
        : `${seedFaction.name} Custom`
  )
  const [year, setYear] = useState(seedFaction.year?.toString() ?? '')
  const [color, setColor] = useState<Faction['color']>(seedFaction.color)
  const [search, setSearch] = useState('')
  const [aircraftTypes, setAircraftTypes] = useState<Faction['aircraftTypes']>(() =>
    cloneAircraftTypes(seedFaction.aircraftTypes)
  )

  const selectedAircraft = useMemo(
    () => new Set(Object.values(aircraftTypes).flat()),
    [aircraftTypes]
  )
  const visibleAircraft = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return aircraftCatalog.filter((aircraft) => {
      const hasFactionTask = aircraft.availableTasks.some((task) => factionTaskNames.has(task))
      if (!hasFactionTask) return false
      if (!query) return true
      return `${aircraft.display_name} ${aircraft.name}`.toLocaleLowerCase().includes(query)
    })
  }, [search])

  const toggleAircraft = (aircraftName: string, availableTasks: readonly string[]) => {
    const shouldAdd = !selectedAircraft.has(aircraftName)
    setAircraftTypes((current) => {
      const next = cloneAircraftTypes(current)
      for (const task of schemas.task.options) {
        const entries = next[task] ?? []
        next[task] = entries.filter((entry) => entry !== aircraftName)
      }
      if (shouldAdd) {
        for (const task of availableTasks) {
          if (!factionTaskNames.has(task)) continue
          const factionTask = task as (typeof schemas.task.options)[number]
          next[factionTask] = [...(next[factionTask] ?? []), aircraftName]
        }
      }
      return next
    })
  }

  const saveFaction = () => {
    const parsedYear = Number.parseInt(year, 10)
    const faction: Faction = {
      ...seedFaction,
      id:
        mode === 'customize' && isCustomFaction(seedFaction)
          ? seedFaction.id
          : `custom-${crypto.randomUUID()}`,
      name: name.trim(),
      year: Number.isFinite(parsedYear) ? parsedYear : undefined,
      color,
      playable: true,
      aircraftTypes
    }
    onSave(faction)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="top-[calc(50%+1.25rem)] flex h-[min(880px,calc(100vh-5rem))] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden overflow-y-hidden border-synthwave-pink/45 bg-[#0b0a09] p-0 text-synthwave-light shadow-[0_0_80px_rgba(217,68,58,0.22)] sm:max-w-[calc(100vw-3rem)] xl:max-w-6xl">
        <DialogHeader className="shrink-0 border-b border-synthwave-purple/30 bg-synthwave-purple/8 px-6 py-5 pr-14">
          <div className="mb-1 flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.22em] text-synthwave-pink">
            <Sparkles className="h-3.5 w-3.5" />
            {mode === 'create' ? 'New force profile' : 'Faction workshop'}
          </div>
          <DialogTitle className="retro-font text-2xl tracking-wide text-white">
            {mode === 'create' ? 'CREATE FACTION' : 'CUSTOMIZE FACTION'}
          </DialogTitle>
          <DialogDescription className="text-synthwave-light/60">
            Choose the aircraft available to this faction. Each aircraft is automatically assigned
            to every mission role it supports.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 md:grid-cols-[300px_minmax(0,1fr)]">
          <section className="border-b border-synthwave-purple/30 bg-black/20 p-5 md:border-r md:border-b-0">
            <div className="grid gap-4">
              <label className="grid gap-1.5">
                <span className="text-[0.65rem] uppercase tracking-[0.18em] text-synthwave-cyan/75">
                  Faction name
                </span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-10 rounded-md border border-synthwave-purple/45 bg-synthwave-dark/80 px-3 text-sm text-white outline-none transition focus:border-synthwave-cyan focus:ring-2 focus:ring-synthwave-cyan/15"
                  placeholder="Task force name"
                  autoFocus
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-[0.65rem] uppercase tracking-[0.18em] text-synthwave-cyan/75">
                  Service year
                </span>
                <input
                  value={year}
                  onChange={(event) =>
                    setYear(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))
                  }
                  inputMode="numeric"
                  className="h-10 rounded-md border border-synthwave-purple/45 bg-synthwave-dark/80 px-3 text-sm text-white outline-none transition focus:border-synthwave-cyan focus:ring-2 focus:ring-synthwave-cyan/15"
                  placeholder="Optional"
                />
              </label>

              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 text-[0.65rem] uppercase tracking-[0.18em] text-synthwave-cyan/75">
                  Alignment
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  {(['blue', 'red'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setColor(option)}
                      className={cn(
                        'h-9 rounded-md border text-xs uppercase tracking-wider transition',
                        color === option
                          ? option === 'blue'
                            ? 'border-synthwave-cyan bg-synthwave-cyan/12 text-synthwave-cyan'
                            : 'border-synthwave-pink bg-synthwave-pink/12 text-synthwave-pink'
                          : 'border-synthwave-purple/35 text-synthwave-light/45 hover:border-synthwave-purple'
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="rounded-md border border-synthwave-purple/30 bg-synthwave-purple/8 p-3">
                <div className="mb-1 flex items-center gap-2 text-xs text-synthwave-cyan">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Ground-force foundation
                </div>
                <div className="text-sm text-white">{seedFaction.countryName}</div>
                <div className="mt-0.5 text-[0.65rem] leading-4 text-synthwave-light/45">
                  {seedFaction.templateName}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-synthwave-purple/25 pt-4 text-xs">
                <span className="text-synthwave-light/45">Selected aircraft</span>
                <span className="retro-font text-base text-synthwave-pink">
                  {selectedAircraft.size}
                </span>
              </div>
            </div>
          </section>

          <section className="flex min-h-0 flex-col p-5">
            <div className="relative mb-3 shrink-0">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-synthwave-cyan/55" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 w-full rounded-md border border-synthwave-purple/40 bg-synthwave-dark/75 pr-3 pl-9 text-sm text-white outline-none transition placeholder:text-synthwave-light/30 focus:border-synthwave-cyan focus:ring-2 focus:ring-synthwave-cyan/15"
                placeholder="Search the aircraft inventory..."
              />
            </div>
            <div className="synthwave-scrollbar min-h-0 flex-1 overflow-y-auto pr-2 [scrollbar-gutter:stable]">
              <TooltipPrimitive.Provider delayDuration={180} skipDelayDuration={80}>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleAircraft.map((aircraft) => {
                    const selected = selectedAircraft.has(aircraft.name)
                    const tasks = aircraft.availableTasks.filter((task) =>
                      factionTaskNames.has(task)
                    )
                    return (
                      <button
                        key={aircraft.name}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleAircraft(aircraft.name, aircraft.availableTasks)}
                        className={cn(
                          'group rounded-md border p-3 text-left transition-all',
                          selected
                            ? 'border-synthwave-pink/70 bg-synthwave-pink/8 shadow-[inset_3px_0_0_var(--synthwave-pink)]'
                            : 'border-synthwave-purple/30 bg-synthwave-dark/45 hover:border-synthwave-cyan/65 hover:bg-synthwave-cyan/5'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-white">
                              {aircraft.display_name}
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[0.6rem] text-synthwave-light/35">
                              {aircraft.name}
                            </div>
                          </div>
                          <span
                            className={cn(
                              'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition',
                              selected
                                ? 'border-synthwave-pink bg-synthwave-pink text-white'
                                : 'border-synthwave-purple/50 text-transparent group-hover:border-synthwave-cyan/65'
                            )}
                          >
                            ✓
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <span className="inline-flex items-center gap-1 rounded bg-synthwave-purple/16 px-1.5 py-0.5 text-[0.55rem] text-synthwave-light/55">
                            {aircraft.controllable ? (
                              <Gamepad2 className="h-2.5 w-2.5" />
                            ) : (
                              <Bot className="h-2.5 w-2.5" />
                            )}
                            {aircraft.controllable ? 'PLAYER' : 'AI'}
                          </span>
                          <TooltipPrimitive.Root>
                            <TooltipPrimitive.Trigger asChild>
                              <span
                                aria-label={`${tasks.length} roles: ${tasks.join(', ')}`}
                                className="inline-flex items-center gap-1 rounded bg-synthwave-purple/16 px-1.5 py-0.5 text-[0.55rem] text-synthwave-light/55 transition-colors hover:bg-synthwave-cyan/12 hover:text-synthwave-cyan"
                              >
                                <Plane className="h-2.5 w-2.5" />
                                {tasks.length} ROLES
                              </span>
                            </TooltipPrimitive.Trigger>
                            <TooltipPrimitive.Portal>
                              <TooltipPrimitive.Content
                                side="top"
                                align="end"
                                sideOffset={8}
                                collisionPadding={12}
                                className="z-[6000] max-w-80 rounded-md border border-synthwave-cyan/45 bg-[#161412]/98 p-3 text-synthwave-light shadow-[0_12px_36px_rgba(0,0,0,0.65),0_0_24px_rgba(232,183,48,0.12)] outline-none data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95"
                              >
                                <div className="mb-2 flex items-center justify-between gap-4 border-b border-synthwave-purple/30 pb-2">
                                  <span className="text-[0.6rem] uppercase tracking-[0.2em] text-synthwave-cyan">
                                    Mission roles
                                  </span>
                                  <span className="max-w-40 truncate font-mono text-[0.58rem] text-synthwave-light/40">
                                    {aircraft.name}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {tasks.map((task) => (
                                    <span
                                      key={task}
                                      className="rounded border border-synthwave-purple/35 bg-synthwave-purple/18 px-2 py-1 text-[0.62rem] uppercase tracking-wide text-synthwave-light/80"
                                    >
                                      {task}
                                    </span>
                                  ))}
                                </div>
                                <TooltipPrimitive.Arrow className="fill-[#161412]" />
                              </TooltipPrimitive.Content>
                            </TooltipPrimitive.Portal>
                          </TooltipPrimitive.Root>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </TooltipPrimitive.Provider>
            </div>
          </section>
        </div>

        <DialogFooter className="shrink-0 border-t border-synthwave-purple/30 bg-black/25 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="border-synthwave-purple/55 bg-transparent text-synthwave-light hover:border-synthwave-cyan hover:bg-synthwave-cyan/8 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={saveFaction}
            disabled={!name.trim() || selectedAircraft.size === 0}
            className="bg-synthwave-pink text-white hover:bg-synthwave-pink/85"
          >
            <Sparkles className="h-4 w-4" />
            {mode === 'create' ? 'Create faction' : 'Save faction'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
