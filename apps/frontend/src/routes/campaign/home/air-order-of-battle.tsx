import { useSelector } from '@xstate/store/react'
import { Plane } from 'lucide-react'

import { cn } from '@/lib/utils'
import { getAircraftDisplayName } from '@/lib/aircraft-display'
import { airframesInUse } from '@/logic/systems/air-order-of-battle'
import { activeStore } from '@/stores/active'

/**
 * Airframes per type for our side (ready / owned, losses), and the enemy's overall strength.
 * Losses only come back slowly, so this is where air superiority shows.
 */
export function AirOrderOfBattle() {
  const campaign = useSelector(activeStore, (state) => state.context)
  const ours = Object.entries(campaign.coalitions.player.airframes ?? {})
    .filter(([, stock]) => stock.capacity > 0)
    .sort(([a], [b]) => a.localeCompare(b))
  const enemy = Object.values(campaign.coalitions.opponent.airframes ?? {})
  const enemyTotal = enemy.reduce((sum, stock) => sum + stock.total, 0)
  const enemyCapacity = enemy.reduce((sum, stock) => sum + stock.capacity, 0)
  const enemyLost = enemy.reduce((sum, stock) => sum + stock.lost, 0)

  if (ours.length === 0) return null

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wide text-secondary/70">
        <span className="flex items-center gap-1.5">
          <Plane className="h-3 w-3 text-synthwave-pink" />
          Air order of battle
        </span>
        <span title="Enemy airframes left of full strength, and destroyed so far">
          Enemy {enemyTotal}/{enemyCapacity} · {enemyLost} down
        </span>
      </div>
      <div className="space-y-1">
        {ours.map(([type, stock]) => {
          const ready = Math.max(0, stock.total - airframesInUse(campaign, 'player', type))
          const strength = stock.capacity > 0 ? stock.total / stock.capacity : 1
          return (
            <div
              key={type}
              className="flex items-center justify-between gap-2 rounded border border-synthwave-pink/10 bg-black/15 px-2 py-1 text-xs"
              title={`${ready} ready, ${stock.total - ready} flying, ${stock.lost} lost`}
            >
              <span className="min-w-0 truncate text-secondary/80">
                {getAircraftDisplayName(type)}
              </span>
              <span
                className={cn(
                  'shrink-0 tabular-nums',
                  strength >= 0.75
                    ? 'text-synthwave-cyan'
                    : strength >= 0.4
                      ? 'text-amber-300'
                      : 'text-signal-soft'
                )}
              >
                {ready}/{stock.total}
                {stock.lost > 0 ? (
                  <span className="text-secondary/50"> · -{stock.lost}</span>
                ) : null}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
