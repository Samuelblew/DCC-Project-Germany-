import { AlertTriangle, Fuel, PackageCheck, Route, Wrench } from 'lucide-react'
import { useSelector } from '@xstate/store/react'
import { schemas } from '@dcc/contracts'
import * as z from 'zod'

import { activeStore } from '@/stores/active'
import { cn } from '@/lib/utils'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Supply = z.infer<typeof schemas.supply>
type SupplyPool = NonNullable<Supply['fuel']>

function ratio(current: number, max: number) {
  return max > 0 ? Math.max(0, Math.min(1, current / max)) : 0
}

function poolRatio(pool: SupplyPool | undefined, fallback: Supply) {
  return pool ? ratio(pool.current, pool.max) : ratio(fallback.current, fallback.max)
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function getTone(value: number) {
  if (value <= 0.15) return 'text-red-300'
  if (value <= 0.35) return 'text-amber-300'
  return 'text-amber-300'
}

function getBarColor(value: number) {
  if (value <= 0.15) return 'bg-red-400'
  if (value <= 0.35) return 'bg-amber-300'
  return 'bg-synthwave-cyan'
}

function getPoolAverage(nodes: Supply[], getPool: (supply: Supply) => SupplyPool | undefined) {
  const totals = nodes.reduce(
    (sum, supply) => {
      const pool = getPool(supply)
      if (!pool) return sum
      return {
        current: sum.current + pool.current,
        max: sum.max + pool.max
      }
    },
    { current: 0, max: 0 }
  )
  return totals.max > 0 ? ratio(totals.current, totals.max) : null
}

function getNodeHealth(supply: Supply) {
  return Math.min(
    ratio(supply.current, supply.max),
    poolRatio(supply.fuel, supply),
    poolRatio(supply.munitions, supply),
    poolRatio(supply.repair, supply)
  )
}

function summarizeLogistics(campaign: Campaign, coalition: Coalition) {
  const supplyNodes = campaign.coalitions[coalition].supplyNodes ?? {}
  const nodes = Object.entries(supplyNodes)
  const supplies = nodes.map(([, supply]) => supply)
  const now = new Date(campaign.time)
  const routeCount = supplies.reduce(
    (sum, supply) => sum + (supply.logistics?.routes.length ?? 0),
    0
  )
  const disruptedRoutes = supplies.reduce(
    (sum, supply) =>
      sum + (supply.logistics?.routes.filter((route) => route.disruption > 0.25).length ?? 0),
    0
  )
  const recoveringNodes = supplies.filter(
    (supply) => supply.logistics?.recoveryUntil && new Date(supply.logistics.recoveryUntil) > now
  ).length

  const bottlenecks = nodes
    .map(([id, supply]) => ({
      id,
      supply,
      health: getNodeHealth(supply)
    }))
    .sort((a, b) => a.health - b.health)
    .slice(0, 3)

  return {
    nodeCount: nodes.length,
    routeCount,
    disruptedRoutes,
    recoveringNodes,
    supply:
      supplies.length > 0 ? ratioSum(supplies.map((supply) => [supply.current, supply.max])) : null,
    fuel: getPoolAverage(supplies, (supply) => supply.fuel),
    munitions: getPoolAverage(supplies, (supply) => supply.munitions),
    repair: getPoolAverage(supplies, (supply) => supply.repair),
    bottlenecks
  }
}

function ratioSum(values: Array<[number, number]>) {
  const [current, max] = values.reduce(
    ([currentSum, maxSum], [current, max]) => [currentSum + current, maxSum + max],
    [0, 0]
  )
  return ratio(current, max)
}

function Meter({
  icon: Icon,
  label,
  value
}: {
  icon: typeof Fuel
  label: string
  value: number | null
}) {
  const displayValue = value ?? 0

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-secondary/70">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon className="h-3 w-3 shrink-0 text-synthwave-pink" />
          <span className="truncate">{label}</span>
        </span>
        <span className={cn('tabular-nums', value == null ? 'text-secondary/45' : getTone(value))}>
          {value == null ? '--' : formatPercent(value)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-synthwave-pink/12 ring-1 ring-synthwave-pink/15">
        <div
          className={cn('h-full transition-[width] duration-300', getBarColor(displayValue))}
          style={{ width: `${Math.max(4, displayValue * 100)}%` }}
        />
      </div>
    </div>
  )
}

export function LogisticsOverview() {
  const campaign = useSelector(activeStore, (state) => state.context)
  const summary = summarizeLogistics(campaign, 'player')

  return (
    <section className="tactical-inset mx-2 mb-2 shrink-0 rounded-md p-3 text-synthwave-light">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PackageCheck className="h-4 w-4 text-synthwave-pink" />
          <span className="retro-font text-xs uppercase text-primary">Logistics</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-secondary/70">
          <span>{summary.nodeCount} nodes</span>
          <span className="h-3 w-px bg-synthwave-pink/20" />
          <Route className="h-3 w-3 text-synthwave-cyan" />
          <span>{summary.routeCount}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Meter icon={PackageCheck} label="Supply" value={summary.supply} />
        <Meter icon={Fuel} label="Fuel" value={summary.fuel} />
        <Meter icon={AlertTriangle} label="Munitions" value={summary.munitions} />
        <Meter icon={Wrench} label="Repair" value={summary.repair} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] uppercase tracking-wide">
        <div className="rounded border border-synthwave-pink/12 bg-black/18 px-2 py-1.5">
          <div className="text-secondary/55">Interdicted</div>
          <div className={summary.disruptedRoutes > 0 ? 'text-amber-300' : 'text-amber-300'}>
            {summary.disruptedRoutes} routes
          </div>
        </div>
        <div className="rounded border border-synthwave-pink/12 bg-black/18 px-2 py-1.5">
          <div className="text-secondary/55">Recovering</div>
          <div className={summary.recoveringNodes > 0 ? 'text-amber-300' : 'text-amber-300'}>
            {summary.recoveringNodes} bases
          </div>
        </div>
      </div>

      {summary.bottlenecks.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {summary.bottlenecks.map((node) => (
            <div
              key={node.id}
              className="flex items-center justify-between gap-2 rounded border border-synthwave-pink/10 bg-black/15 px-2 py-1 text-xs"
            >
              <span className="min-w-0 truncate text-secondary/80">{node.id}</span>
              <span className={cn('shrink-0 tabular-nums', getTone(node.health))}>
                {formatPercent(node.health)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
