import { activeStore } from '@/stores/active'
import { useSelector } from '@xstate/store/react'

import { EscalationBar } from './escalation-bar'

export function Clock() {
  const time = useSelector(activeStore, (state) => state.context.time)

  if (time == null) return null

  const date = new Date(time)
  const formattedTime = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  }).format(date)
  const formattedDate = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC'
  })
    .format(date)
    .toUpperCase()

  return (
    <div className="tactical-inset flex min-w-[148px] flex-col items-stretch justify-center rounded-md px-3 py-1.5 text-secondary">
      <span className="retro-font text-center text-lg leading-none">{formattedTime}</span>
      <span className="retro-font mt-1 text-center text-xs leading-none">{formattedDate}</span>
      <EscalationBar />
    </div>
  )
}
