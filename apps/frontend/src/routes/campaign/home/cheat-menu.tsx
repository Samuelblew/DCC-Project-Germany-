import { Skull } from 'lucide-react'
import { useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { Popover } from 'radix-ui'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { activeStore } from '@/stores/active'

type CheatKey =
  | 'unlimitedWeapons'
  | 'unlimitedFuel'
  | 'immortal'
  | 'easyFlight'
  | 'miniHud'
  | 'radioAssist'
  | 'crashRecover'
  | 'unrestrictedSatnav'

type LabelMode = 'none' | 'full' | 'abbreviated' | 'dot'

const cheatToggles: Array<{ key: CheatKey; label: string; hint: string; defaultOn?: boolean }> = [
  {
    key: 'unlimitedWeapons',
    label: 'Unlimited weapons',
    hint: 'Guns and stores refill as they fire'
  },
  {
    key: 'unlimitedFuel',
    label: 'Unlimited fuel',
    hint: 'Tanks stay at the loadout you took off with'
  },
  { key: 'immortal', label: 'Immortal', hint: 'Your aircraft cannot be destroyed' },
  { key: 'easyFlight', label: 'Easy flight', hint: 'Relaxed handling and envelope' },
  { key: 'miniHud', label: 'Mini HUD', hint: 'External-view flight data overlay' },
  { key: 'radioAssist', label: 'Radio assist', hint: 'Launch and threat callouts' },
  {
    key: 'crashRecover',
    label: 'Crash recover',
    hint: 'Respawn after a crash or eject',
    defaultOn: true
  },
  { key: 'unrestrictedSatnav', label: 'Unrestricted SATNAV', hint: 'GPS on every capable airframe' }
]

const labelCycle: LabelMode[] = ['none', 'full', 'abbreviated', 'dot']
const labelCaption: Record<LabelMode, string> = {
  none: 'Off',
  full: 'Full',
  abbreviated: 'Abbrev.',
  dot: 'Dot'
}

export function CheatMenu() {
  const [open, setOpen] = useState(false)
  const cheats = useSelector(activeStore, (state) => state.context.campaignParams?.dcsCheats)
  const labels = cheats?.labels ?? 'none'
  const revealEnemy = useSelector(
    activeStore,
    (state) => state.context.campaignParams?.fogOfWar === false
  )
  const armed =
    cheats?.unlimitedWeapons === true ||
    cheats?.unlimitedFuel === true ||
    cheats?.immortal === true ||
    cheats?.easyFlight === true ||
    (cheats?.labels != null && cheats.labels !== 'none')

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`tactical-button h-11 w-11 rounded-sm p-0 text-secondary ${
            open || armed ? 'text-synthwave-pink ring-1 ring-synthwave-pink/50' : ''
          }`}
          title="DCS cheats"
          aria-label="DCS cheats"
          aria-pressed={open}
        >
          <Skull className="h-5 w-5" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="tactical-panel z-1200 w-72 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-md p-3 text-synthwave-light backdrop-blur-md"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="retro-font text-xs uppercase tracking-[0.28em] text-synthwave-pink">
              ACE
            </span>
            <span className="text-[10px] uppercase tracking-wide text-secondary">
              Written into the .miz
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {cheatToggles.map((option) => {
              const on = cheats?.[option.key] ?? option.defaultOn ?? false
              return (
                <label
                  key={option.key}
                  className="flex items-center justify-between gap-3 rounded px-1.5 py-1.5 hover:bg-synthwave-pink/10"
                >
                  <span>
                    <span className="block text-[11px] text-synthwave-light">{option.label}</span>
                    <span className="block text-[10px] text-secondary">{option.hint}</span>
                  </span>
                  <Switch
                    size="sm"
                    checked={on}
                    onCheckedChange={(checked) =>
                      activeStore.trigger.setDcsCheat({ key: option.key, value: checked })
                    }
                  />
                </label>
              )
            })}
            <button
              type="button"
              className="mt-1 flex items-center justify-between rounded px-1.5 py-1.5 text-left hover:bg-synthwave-pink/10"
              onClick={() => {
                const index = labelCycle.indexOf(labels)
                const next = labelCycle[(index + 1) % labelCycle.length]!
                activeStore.trigger.setDcsCheat({ key: 'labels', value: next })
              }}
            >
              <span>
                <span className="block text-[11px] text-synthwave-light">Labels</span>
                <span className="block text-[10px] text-secondary">
                  None · Full · Abbrev. · Dot
                </span>
              </span>
              <span className="retro-font text-[11px] uppercase tracking-wide text-synthwave-cyan">
                {labelCaption[labels]}
              </span>
            </button>
            <label className="mt-1 flex items-center justify-between gap-3 border-t border-synthwave-pink/20 px-1.5 pt-2 pb-1.5 hover:bg-synthwave-pink/10">
              <span>
                <span className="block text-[11px] text-synthwave-light">Reveal enemy</span>
                <span className="block text-[10px] text-secondary">
                  No fog of war: every enemy unit on the map and open to the planners
                </span>
              </span>
              <Switch
                size="sm"
                checked={revealEnemy}
                onCheckedChange={(checked) =>
                  activeStore.trigger.setFogOfWar({ fogOfWar: !checked })
                }
              />
            </label>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
