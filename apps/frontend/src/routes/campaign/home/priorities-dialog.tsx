import { useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { Crosshair } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import {
  MISSION_PRIORITIES,
  NEUTRAL_PRIORITY,
  TARGET_PRIORITIES
} from '@/logic/systems/commander-priorities'
import { activeStore } from '@/stores/active'

const LEVEL_LABELS = ['Never', 'Minimal', 'Low', 'Normal', 'High', 'Maximum']

type Priorities = NonNullable<ReturnType<typeof activeStore.getSnapshot>['context']['priorities']>

function PriorityRow({
  label,
  hint,
  value,
  disabled,
  onChange
}: {
  label: string
  hint?: string
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-56">
        <div className="text-secondary">{label}</div>
        {hint ? <div className="text-xs text-white/40">{hint}</div> : null}
      </div>
      <input
        type="range"
        min={0}
        max={5}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={`${label} priority`}
        className="w-40 accent-synthwave-cyan disabled:opacity-40"
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span
        className={
          value === 0 ? 'w-20 text-signal-soft' : value > 3 ? 'w-20 text-synthwave-cyan' : 'w-20'
        }
      >
        {LEVEL_LABELS[value]}
      </span>
    </div>
  )
}

const DEFAULT_PRIORITIES: Priorities = { hq: true }

export function PrioritiesDialog() {
  const [open, setOpen] = useState(false)
  // Select the stored value as is: a default built inside the selector is a new object on every
  // read, and React re-renders forever.
  const stored = useSelector(activeStore, (state) => state.context.priorities)
  const priorities: Priorities = stored ?? DEFAULT_PRIORITIES

  const update = (next: Partial<Priorities>) =>
    activeStore.send({ type: 'setPriorities', priorities: { ...priorities, ...next } })

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="tactical-button h-10 w-10 p-0 text-secondary"
        aria-label="Commander priorities"
        title="Commander priorities"
        onClick={() => setOpen(true)}
      >
        <Crosshair className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="tactical-panel text-synthwave-light backdrop-blur-md sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="retro-font text-sm uppercase text-primary">
              Commander priorities
            </DialogTitle>
            <DialogDescription className="text-white/50">
              Steer what your side&apos;s air tasking order goes after. Normal leaves the planner
              alone; Never removes the mission or target family. The enemy plans on its own.
            </DialogDescription>
          </DialogHeader>

          <label className="flex items-center gap-3 text-sm">
            <Switch checked={priorities.hq} onCheckedChange={(hq) => update({ hq })} />
            <span className="text-secondary">Set by HQ</span>
            <span className="text-xs text-white/40">The planner&apos;s own judgement</span>
          </label>

          <div className="flex flex-col gap-2">
            <div className="retro-font text-xs uppercase text-primary">Missions</div>
            {MISSION_PRIORITIES.map((entry) => (
              <PriorityRow
                key={entry.key}
                label={entry.label}
                hint={entry.hint}
                value={priorities.missions?.[entry.key] ?? NEUTRAL_PRIORITY}
                disabled={priorities.hq}
                onChange={(value) =>
                  update({ missions: { ...priorities.missions, [entry.key]: value } })
                }
              />
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <div className="retro-font text-xs uppercase text-primary">Targets</div>
            {TARGET_PRIORITIES.map((entry) => (
              <PriorityRow
                key={entry.key}
                label={entry.label}
                value={priorities.targets?.[entry.key] ?? NEUTRAL_PRIORITY}
                disabled={priorities.hq}
                onChange={(value) =>
                  update({ targets: { ...priorities.targets, [entry.key]: value } })
                }
              />
            ))}
          </div>

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="tactical-button text-secondary"
              disabled={priorities.hq}
              onClick={() => update({ missions: undefined, targets: undefined })}
            >
              Reset to normal
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
