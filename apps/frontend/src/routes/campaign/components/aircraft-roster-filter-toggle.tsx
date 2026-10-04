import { cn } from '@/lib/utils'

interface AircraftRosterFilterToggleProps {
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}

export function AircraftRosterFilterToggle({
  checked,
  disabled = false,
  onCheckedChange
}: AircraftRosterFilterToggleProps) {
  return (
    <label
      className={cn(
        'mx-1 mb-1 flex cursor-pointer items-start gap-2.5 rounded-sm px-2 py-2 transition-colors hover:bg-[#e8b730]/10',
        disabled && 'cursor-default opacity-55'
      )}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-amber-400"
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-white/80">
          Show all compatible aircraft
        </span>
        <span className="mt-0.5 block text-[10px] leading-tight text-white/45">
          Ignore the player faction aircraft roster
        </span>
      </span>
    </label>
  )
}
