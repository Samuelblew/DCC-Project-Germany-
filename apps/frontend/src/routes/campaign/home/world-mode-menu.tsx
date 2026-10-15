import { Settings } from 'lucide-react'
import { useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { Popover } from 'radix-ui'

import { Button } from '@/components/ui/button'
import { activeStore } from '@/stores/active'

const modes = [
  {
    id: 'corridor',
    label: 'Corridor',
    hint: 'Ground and SAM along your route are placed in the mission and stay there'
  },
  {
    id: 'bubble',
    label: 'Live bubble',
    hint: 'Ground, SAM and AI flights appear around you, each at its own range, and leave when you move away. Your own flight stays in the mission'
  }
] as const

export function WorldModeMenu() {
  const [open, setOpen] = useState(false)
  const worldMode = useSelector(
    activeStore,
    (state) => state.context.campaignParams?.worldMode ?? 'corridor'
  )
  const live = worldMode === 'bubble'

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`tactical-button h-11 w-11 rounded-sm p-0 text-secondary ${
            open || live ? 'text-synthwave-cyan ring-1 ring-synthwave-cyan/50' : ''
          }`}
          title="World mode"
          aria-label="World mode"
          aria-pressed={open}
        >
          <Settings className="h-5 w-5" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="tactical-panel z-1200 w-72 rounded-md p-3 text-synthwave-light backdrop-blur-md"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="retro-font text-xs uppercase tracking-[0.28em] text-synthwave-cyan">
              World
            </span>
            <span className="text-[10px] uppercase tracking-wide text-secondary">Next mission</span>
          </div>
          <div className="flex flex-col gap-1">
            {modes.map((mode) => {
              const selected = worldMode === mode.id
              return (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={selected}
                  className={`rounded px-1.5 py-1.5 text-left ${
                    selected ? 'bg-synthwave-cyan/15' : 'hover:bg-synthwave-cyan/10'
                  }`}
                  onClick={() => activeStore.trigger.setWorldMode({ worldMode: mode.id })}
                >
                  <span className="block text-[11px] text-synthwave-light">{mode.label}</span>
                  <span className="block text-[10px] text-secondary">{mode.hint}</span>
                </button>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
