import { useSelector } from '@xstate/store/react'

import { activeStore } from '@/stores/active'

const DAY_MS = 24 * 60 * 60 * 1000

function moraleTone(value: number) {
  if (value >= 60) return 'text-synthwave-cyan'
  if (value <= 40) return 'text-signal-soft'
  return 'text-secondary'
}

/** Morale on both sides and the days left before the war ends in a stalemate. */
export function WarStatus() {
  const morale = useSelector(activeStore, (state) => state.context.morale)
  const deadline = useSelector(activeStore, (state) => state.context.deadline)
  const time = useSelector(activeStore, (state) => state.context.time)
  const status = useSelector(activeStore, (state) => state.context.status)

  const ours = Math.round(morale?.player ?? 50)
  const theirs = Math.round(morale?.opponent ?? 50)
  const daysLeft =
    deadline && (status ?? 'active') === 'active'
      ? Math.max(0, Math.ceil((new Date(deadline).getTime() - new Date(time).getTime()) / DAY_MS))
      : null

  return (
    <div
      className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-secondary"
      title="Morale rises with good mission ratings and captured towns and fades back to 50. Higher morale fights harder on the ground."
    >
      <span>
        Morale <span className={moraleTone(ours)}>{ours}</span>
        <span className="text-secondary/50"> / </span>
        <span className={moraleTone(theirs)}>{theirs}</span>
      </span>
      {daysLeft != null ? (
        <span title="Days before the war ends in a stalemate">D-{daysLeft}</span>
      ) : null}
    </div>
  )
}
