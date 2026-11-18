import { useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { coalitionOperationProfile, scenarios, theatres } from '@dcc/data'
import { ChartLine } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { type ForceSnapshot, type SideStrength, sideStrength } from '@/logic/systems/force-history'
import { isFogOfWarEnabled } from '@/logic/systems/intel'
import { activeStore } from '@/stores/active'

import { AirOrderOfBattle } from './air-order-of-battle'
import { LogbookView } from './logbook-view'

type Campaign = ReturnType<typeof activeStore.getSnapshot>['context']

const ARCHETYPE_LABELS: Record<string, string> = {
  balanced: 'Balanced',
  breakthrough: 'Breakthrough',
  attrition: 'Attrition',
  'air-superiority': 'Air superiority',
  'defense-crisis': 'Defence crisis'
}

const METRICS: Array<{ key: keyof SideStrength; label: string; hint: string; round: number }> = [
  { key: 'ground', label: 'Ground forces', hint: 'Vehicles and troops in the field', round: 10 },
  { key: 'air', label: 'Aircraft', hint: 'Airframes in the order of battle', round: 5 },
  { key: 'territory', label: 'Territory', hint: 'Towns and airfields held', round: 1 },
  { key: 'airDefense', label: 'SAM sites', hint: 'Air defence sites able to fire', round: 1 }
]

const NEWS_PATTERN =
  /captured|convoy|rated|stalemate|escalat|down behind|rescued|goal|lost|destroyed|morale/i

function formatTime(value: string | Date) {
  const date = new Date(value)
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  })
}

/** Under fog of war the enemy's numbers are an estimate, rounded to the metric's step. */
function estimate(value: number, step: number, fog: boolean) {
  if (!fog || step <= 1) return String(value)
  return `≈${Math.round(value / step) * step}`
}

function Sparkline({ samples, metric }: { samples: ForceSnapshot[]; metric: keyof SideStrength }) {
  const width = 300
  const height = 70
  const values = samples.flatMap((sample) => [sample.player[metric], sample.opponent[metric]])
  const max = Math.max(1, ...values)
  const line = (side: 'player' | 'opponent') =>
    samples
      .map((sample, index) => {
        const x = samples.length === 1 ? width : (index / (samples.length - 1)) * width
        const y = height - (sample[side][metric] / max) * (height - 4) - 2
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-16 w-full">
      <polyline
        points={line('opponent')}
        fill="none"
        stroke="var(--enemy-red)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={line('player')}
        fill="none"
        stroke="var(--friendly-blue)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function PostureCard({ campaign, side }: { campaign: Campaign; side: 'player' | 'opponent' }) {
  const profile = coalitionOperationProfile(campaign, side)
  const morale = Math.round(campaign.morale?.[side] ?? 50)
  const initiative = campaign.operationProfile?.initiativeCoalition === side
  return (
    <div className="tactical-inset flex-1 rounded-md p-3 text-sm">
      <div
        className="retro-font mb-1 text-xs uppercase"
        style={{ color: side === 'player' ? 'var(--friendly-blue)' : 'var(--enemy-red)' }}
      >
        {side === 'player' ? 'Our posture' : 'Enemy posture'}
      </div>
      <div className="text-synthwave-light">
        {ARCHETYPE_LABELS[profile.archetype] ?? profile.archetype}
        <span className="text-secondary"> · {profile.tempo} tempo</span>
      </div>
      <div className="mt-1 text-xs text-secondary">
        Morale {morale}
        {initiative ? <span className="text-synthwave-cyan"> · holds the initiative</span> : null}
      </div>
    </div>
  )
}

function IntelReport() {
  const campaign = useSelector(activeStore, (state) => state.context)
  const scenario = scenarios.find((entry) => entry.id === campaign.scenarioId)
  const theatre = theatres.find((entry) => entry.name === scenario?.theatreName)
  const fog = isFogOfWarEnabled(campaign)

  const now: ForceSnapshot | null = theatre
    ? {
        at: campaign.time,
        player: sideStrength(campaign, 'player', theatre),
        opponent: sideStrength(campaign, 'opponent', theatre)
      }
    : null
  const samples = [...(campaign.forceHistory ?? []), ...(now ? [now] : [])]
  const dayAgo = [...samples]
    .reverse()
    .find((sample) => campaign.time.getTime() - sample.at.getTime() >= 24 * 3_600_000)

  const news = campaign.logs
    .filter(
      (entry) =>
        entry.type === 'campaign' || (entry.type === 'combat' && NEWS_PATTERN.test(entry.message))
    )
    .slice(-25)
    .reverse()
  const ratings = (campaign.missionRatings ?? []).slice(-5).reverse()

  return (
    <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
      <div className="flex flex-col gap-2 sm:flex-row">
        <PostureCard campaign={campaign} side="player" />
        <PostureCard campaign={campaign} side="opponent" />
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <span className="retro-font text-xs uppercase text-primary">Force levels</span>
          <span className="text-[10px] uppercase tracking-wide text-secondary">
            <span style={{ color: 'var(--friendly-blue)' }}>Ours</span> /{' '}
            <span style={{ color: 'var(--enemy-red)' }}>Enemy{fog ? ' (estimate)' : ''}</span>
            {' · '}
            {samples.length > 1 ? `since ${formatTime(samples[0]!.at)}` : 'history builds up'}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {METRICS.map((metric) => {
            const ours = now?.player[metric.key] ?? 0
            const theirs = now?.opponent[metric.key] ?? 0
            const change = dayAgo ? ours - dayAgo.player[metric.key] : null
            return (
              <div key={metric.key} className="tactical-inset rounded-md p-2.5" title={metric.hint}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-secondary">{metric.label}</span>
                  <span className="tabular-nums">
                    <span style={{ color: 'var(--friendly-blue)' }}>{ours}</span>
                    {change ? (
                      <span
                        className={cn(
                          'text-[10px]',
                          change > 0 ? 'text-synthwave-cyan' : 'text-signal-soft'
                        )}
                      >
                        {' '}
                        ({change > 0 ? '+' : ''}
                        {change} 24h)
                      </span>
                    ) : null}
                    <span className="text-secondary/50"> / </span>
                    <span style={{ color: 'var(--enemy-red)' }}>
                      {estimate(theirs, metric.round, fog)}
                    </span>
                  </span>
                </div>
                {samples.length > 1 ? <Sparkline samples={samples} metric={metric.key} /> : null}
              </div>
            )
          })}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <AirOrderOfBattle />
          {ratings.length > 0 ? (
            <div className="mt-3">
              <div className="mb-1.5 text-[10px] uppercase tracking-wide text-secondary/70">
                Latest mission ratings
              </div>
              <div className="space-y-1">
                {ratings.map((rating) => (
                  <div
                    key={`${rating.flightGroupId}-${String(rating.at)}`}
                    className="flex items-center justify-between rounded border border-synthwave-pink/10 bg-black/15 px-2 py-1 text-xs"
                    title={rating.reasons.join(', ')}
                  >
                    <span className="truncate text-secondary/80">
                      {rating.callsign} · {rating.task}
                    </span>
                    <span className="text-synthwave-cyan">
                      {'★'.repeat(rating.rating)}
                      <span className="text-secondary/30">{'★'.repeat(5 - rating.rating)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-secondary/70">
            War news
          </div>
          {news.length === 0 ? (
            <div className="text-xs text-secondary">Nothing to report yet.</div>
          ) : (
            <ul className="space-y-1">
              {news.map((entry) => (
                <li key={entry.id} className="flex gap-2 text-xs">
                  <span className="shrink-0 tabular-nums text-secondary/60">
                    {formatTime(entry.campaignTime)}
                  </span>
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      background:
                        entry.coalition === 'player' ? 'var(--friendly-blue)' : 'var(--enemy-red)'
                    }}
                  />
                  <span className="text-synthwave-light/90">{entry.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

export function IntelDialog() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'intel' | 'logbook'>('intel')
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="tactical-button h-10 w-10 p-0 text-secondary"
        aria-label="Intelligence"
        title="Intelligence"
        onClick={() => setOpen(true)}
      >
        <ChartLine className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="tactical-panel text-synthwave-light backdrop-blur-md sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="retro-font text-sm uppercase text-primary">
              Intelligence
            </DialogTitle>
            <DialogDescription className="text-white/50">
              Posture, strength over time, squadrons and the latest from the front; your logbook.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-1">
            {(['intel', 'logbook'] as const).map((entry) => (
              <Button
                key={entry}
                variant="ghost"
                size="sm"
                className={cn(
                  'tactical-button retro-font text-xs uppercase',
                  tab === entry ? 'text-synthwave-cyan' : 'text-secondary'
                )}
                onClick={() => setTab(entry)}
              >
                {entry === 'intel' ? 'Intelligence' : 'Logbook'}
              </Button>
            ))}
          </div>
          {open ? tab === 'intel' ? <IntelReport /> : <LogbookView /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
