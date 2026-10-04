import { useMemo, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { getCareerAircraft } from '@dcc/data'
import { Trash2 } from 'lucide-react'

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
import { getCareerLoadouts, getStock } from '@/logic/career/career'
import { activeStore } from '@/stores/active'

type Stations = Record<number, string | undefined>

function toStations(pylons: Array<{ num: number; CLSID: string }>): Stations {
  return Object.fromEntries(pylons.map((pylon) => [pylon.num, pylon.CLSID]))
}

/**
 * Builds or edits a loadout station by station. Only stores the module accepts on a station are
 * offered there; `presetId` edits an existing player preset, otherwise a new one is created.
 */
export function CareerPresetEditor({
  open,
  aircraftName,
  presetId,
  onClose
}: {
  open: boolean
  /** Type the preset is for; defaults to the type the career screens open on. */
  aircraftName?: string
  presetId?: string
  onClose: (savedPresetId?: string) => void
}) {
  const career = useSelector(activeStore, (state) => state.context.career)
  const aircraft = career ? getCareerAircraft(aircraftName ?? career.preferredAircraft) : undefined
  const loadouts = useMemo(
    () => (career && aircraft ? getCareerLoadouts(career, aircraft) : []),
    [career, aircraft]
  )
  const editing = career?.presets.find((preset) => preset.id === presetId)
  const [name, setName] = useState(editing?.name ?? '')
  const [stations, setStations] = useState<Stations>(() =>
    toStations(editing?.pylons ?? aircraft?.loadouts[0]?.pylons ?? [])
  )

  if (!career || !aircraft) return null

  const weaponName = (id: string | undefined) =>
    aircraft.weapons.find((weapon) => weapon.id === id)?.name
  const pylons = Object.entries(stations)
    .filter((entry): entry is [string, string] => entry[1] != null)
    .map(([num, CLSID]) => ({ num: Number(num), CLSID }))
  const neededPerAircraft = new Map<string, number>()
  for (const pylon of pylons) {
    const weapon = aircraft.weapons.find((entry) => entry.id === pylon.CLSID)
    if (!weapon || weapon.free) continue
    neededPerAircraft.set(pylon.CLSID, (neededPerAircraft.get(pylon.CLSID) ?? 0) + 1)
  }

  const save = () => {
    const before = activeStore.getSnapshot().context.career?.presets.map((p) => p.id) ?? []
    activeStore.send({
      type: 'careerSavePreset',
      preset: { id: editing?.id, name: name || 'My loadout', pylons },
      aircraftName: aircraft.aircraftName
    })
    const after = activeStore.getSnapshot().context.career?.presets ?? []
    const savedId = editing?.id ?? after.find((preset) => !before.includes(preset.id))?.id
    onClose(savedId)
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="flex max-h-[min(90vh,880px)] flex-col overflow-hidden overflow-y-hidden border-synthwave-pink/30 bg-synthwave-dark/95 text-synthwave-light backdrop-blur-xl sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="retro-font text-synthwave-cyan">
            {editing ? 'Edit preset' : 'New preset'}
          </DialogTitle>
          <DialogDescription className="text-secondary/70">
            Stations are shown as seen from behind the aircraft. Stores come from your stock at
            takeoff.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            className="min-w-56 flex-1 rounded border border-white/15 bg-black/40 px-2 py-1.5"
            placeholder="Preset name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <span className="text-white/50">Start from</span>
          <select
            className="rounded border border-white/15 bg-black/40 px-2 py-1.5"
            value=""
            onChange={(event) => {
              const source = loadouts.find((loadout) => loadout.id === event.target.value)
              if (source) setStations(toStations(source.pylons))
            }}
          >
            <option value="" disabled>
              Copy a loadout…
            </option>
            {loadouts.map((loadout) => (
              <option key={loadout.id} value={loadout.id}>
                {loadout.name}
              </option>
            ))}
          </select>
        </div>

        <div className="synthwave-scrollbar grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1.5 overflow-y-auto">
          {aircraft.stations.map((station) => {
            const options = aircraft.weapons.filter((weapon) =>
              weapon.stations.includes(station.num)
            )
            const selected = stations[station.num]
            return (
              <div
                key={station.num}
                className={cn(
                  'flex flex-col gap-1.5 rounded border p-2',
                  selected ? 'border-synthwave-cyan/40 bg-synthwave-cyan/5' : 'border-white/10'
                )}
              >
                <div className="text-[10px] uppercase tracking-[0.14em] text-white/45">
                  {station.num} · {station.label}
                </div>
                <select
                  className="w-full rounded border border-white/15 bg-black/50 px-1 py-1 text-xs"
                  value={selected ?? ''}
                  onChange={(event) =>
                    setStations((current) => ({
                      ...current,
                      [station.num]: event.target.value || undefined
                    }))
                  }
                >
                  <option value="">Empty</option>
                  {options.map((weapon) => (
                    <option key={weapon.id} value={weapon.id}>
                      {weapon.name}
                    </option>
                  ))}
                </select>
                <div className="min-h-4 text-center text-[11px] text-white/70">
                  {weaponName(selected) ?? '—'}
                </div>
              </div>
            )
          })}
        </div>

        <div className="space-y-1 rounded border border-white/10 bg-white/[0.03] p-3 text-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.15em] text-white/50">
            Per aircraft
          </div>
          {neededPerAircraft.size === 0 ? (
            <div className="text-white/40">No stores, guns only.</div>
          ) : (
            [...neededPerAircraft].map(([weaponId, count]) => {
              const owned = getStock(career, aircraft.aircraftName)[weaponId] ?? 0
              return (
                <div key={weaponId} className="flex items-center gap-2">
                  <span className="flex-1">
                    {count}x {weaponName(weaponId)}
                  </span>
                  <span
                    className={cn(
                      'tabular-nums text-xs',
                      owned < count ? 'text-synthwave-pink' : 'text-white/50'
                    )}
                  >
                    {owned} in stock
                  </span>
                </div>
              )
            })
          )}
        </div>

        <DialogFooter className="gap-2">
          {editing ? (
            <Button
              variant="outline"
              size="sm"
              className="mr-auto"
              onClick={() => {
                activeStore.send({ type: 'careerDeletePreset', presetId: editing.id })
                onClose()
              }}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Delete
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button size="sm" variant="tacticalAction" onClick={save}>
            Save preset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
