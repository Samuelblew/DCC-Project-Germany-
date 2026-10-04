import {
  DEFAULT_ESCALATION_ERA_DAYS,
  ESCALATION_STAGES,
  escalationDaysRemaining,
  escalationProgress,
  nextEscalationStage,
  type EscalationStage
} from '@dcc/data'
import { useSelector } from '@xstate/store/react'

import { activeStore } from '@/stores/active'

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

export function EscalationBar() {
  const enabled = useSelector(activeStore, (state) => state.context.escalation?.enabled)
  const stage = useSelector(activeStore, (state) => state.context.escalation?.stage)
  const stageStartedAt = useSelector(
    activeStore,
    (state) => state.context.escalation?.stageStartedAt
  )
  const eraDurationDays = useSelector(
    activeStore,
    (state) => state.context.escalation?.eraDurationDays ?? DEFAULT_ESCALATION_ERA_DAYS
  )
  const time = useSelector(activeStore, (state) => state.context.time)

  const now = toDate(time)
  if (!enabled || now == null) return null

  const currentStage: EscalationStage = stage ?? 'Korea'
  const started = toDate(stageStartedAt) ?? now
  const next = nextEscalationStage(currentStage)
  const progress = next ? escalationProgress(now, started, eraDurationDays) : 1
  const percent = Math.round(progress * 100)
  const stageIndex = ESCALATION_STAGES.indexOf(currentStage)
  const daysLeft = next ? escalationDaysRemaining(now, started, eraDurationDays) : 0

  return (
    <div className="mt-1.5 flex w-full flex-col gap-1 border-t border-white/10 pt-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="retro-font text-[10px] uppercase tracking-[0.14em] text-synthwave-cyan/80">
          {currentStage}
          {stageIndex >= 0 ? ` ${stageIndex + 1}/${ESCALATION_STAGES.length}` : ''}
        </span>
        <span className="text-[10px] leading-none text-synthwave-light/55">
          {next ? `${daysLeft}d to ${next}` : 'final era'}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-synthwave-purple/40">
        <div
          className="h-full rounded-full bg-linear-to-r from-synthwave-cyan to-synthwave-pink"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
