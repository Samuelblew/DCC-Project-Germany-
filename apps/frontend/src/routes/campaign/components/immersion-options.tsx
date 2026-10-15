import { resolveImmersion, type ImmersionSettings } from '@dcc/contracts'
import { useSelector } from '@xstate/store/react'

import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { activeStore } from '@/stores/active'

const trafficLevels: Array<{ value: ImmersionSettings['civTraffic']; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }
]

const toggles: Array<{
  key: Exclude<keyof ImmersionSettings, 'civTraffic'>
  label: string
  hint: string
}> = [
  {
    key: 'groundCrew',
    label: 'Ground crew',
    hint: 'Ground power and mechanics behind the tail, a work area by the wing and a fuel bowser on cold starts; period equipment for the escalation stage'
  },
  {
    key: 'baseLife',
    label: 'Base life',
    hint: 'A guard post beside your spot: barriers, two soldiers on watch and their vehicle'
  },
  {
    key: 'convoys',
    label: 'Supply convoys',
    hint: 'Put the campaign supply convoys and helicopter lifts in the mission; the cargo is lost with them'
  },
  {
    key: 'ambientAir',
    label: 'Ambient air traffic',
    hint: 'Transport aircraft between your bases and neutral airliners, released during the mission'
  }
]

/** Immersion settings for the generated mission; shared by MiG Ops and Mission Control. */
export function ImmersionOptions({ compact = false }: { compact?: boolean }) {
  const stored = useSelector(activeStore, (state) => state.context.campaignParams?.immersion)
  const immersion = resolveImmersion(stored)
  const set = (settings: Partial<ImmersionSettings>) =>
    activeStore.send({ type: 'setImmersion', settings })

  return (
    <div className={cn('space-y-2', compact && 'text-xs')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.15em] text-white/50">
          Road traffic
        </span>
        {trafficLevels.map((level) => (
          <button
            key={level.value}
            type="button"
            onClick={() => set({ civTraffic: level.value })}
            className={cn(
              'rounded border px-2 py-0.5 text-xs transition-colors',
              immersion.civTraffic === level.value
                ? 'border-synthwave-cyan/60 bg-synthwave-cyan/15 text-synthwave-cyan'
                : 'border-white/15 text-white/60 hover:bg-white/5 hover:text-white'
            )}
          >
            {level.label}
          </button>
        ))}
      </div>
      <div className={cn('grid gap-2', compact ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1')}>
        {toggles.map((toggle) => (
          <label
            key={toggle.key}
            className="flex items-center justify-between gap-3 rounded px-1.5 py-1 hover:bg-white/5"
            title={toggle.hint}
          >
            <span>
              <span className="block text-sm text-white">{toggle.label}</span>
              {!compact && <span className="block text-sm text-white/40">{toggle.hint}</span>}
            </span>
            <Switch
              checked={immersion[toggle.key]}
              onCheckedChange={(checked) => set({ [toggle.key]: checked })}
            />
          </label>
        ))}
      </div>
    </div>
  )
}
