import { Clock, Layers3, Plane, Target } from 'lucide-react'
import { useSelector } from '@xstate/store/react'
import { schemas } from '@dcc/contracts'
import * as z from 'zod'

import { activeStore } from '@/stores/active'
import { cn } from '@/lib/utils'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type MissionPackage = Campaign['coalitions']['player']['packages'][number]
type FlightGroup = Campaign['coalitions']['player']['flightGroups'][number]

function formatTime(date: Date | string) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  }).format(new Date(date))
}

function getPackageTone(missionPackage: MissionPackage) {
  if ((missionPackage.priority ?? 0) >= 70) return 'border-amber-400/30 bg-amber-500/10'
  if ((missionPackage.priority ?? 0) >= 55) return 'border-amber-300/30 bg-amber-300/10'
  return 'border-synthwave-pink/18 bg-synthwave-pink/[0.055]'
}

function getPackageMembers(
  missionPackage: MissionPackage,
  flightGroups: FlightGroup[]
): Array<{ group: FlightGroup | undefined; role: string }> {
  return missionPackage.members.map((member) => ({
    role: member.role,
    group: flightGroups.find((group) => group.id === member.flightGroupId)
  }))
}

export function AtoPackageBoard() {
  const packages = useSelector(activeStore, (state) => state.context.coalitions.player.packages)
  const flightGroups = useSelector(
    activeStore,
    (state) => state.context.coalitions.player.flightGroups
  )
  const activePackages = packages
    .filter((missionPackage) => missionPackage.status === 'active')
    .sort((a, b) => {
      const priorityDelta = (b.priority ?? 0) - (a.priority ?? 0)
      if (priorityDelta !== 0) return priorityDelta

      return new Date(a.tot).getTime() - new Date(b.tot).getTime()
    })
  const visiblePackages = activePackages.slice(0, 3)

  return (
    <section className="tactical-inset mx-2 mb-2 shrink-0 rounded-md p-3 text-synthwave-light">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers3 className="h-4 w-4 text-synthwave-pink" />
          <span className="retro-font text-xs uppercase text-primary">ATO Packages</span>
        </div>
        <span className="text-[10px] uppercase tracking-wide text-secondary/70">
          {activePackages.length} active
        </span>
      </div>

      {visiblePackages.length === 0 ? (
        <div className="rounded border border-synthwave-pink/10 bg-black/15 px-2 py-3 text-center text-xs text-secondary/60">
          No active ATO packages
        </div>
      ) : (
        <div className="space-y-2">
          {visiblePackages.map((missionPackage) => {
            const members = getPackageMembers(missionPackage, flightGroups)

            return (
              <div
                key={missionPackage.id}
                className={cn(
                  'rounded-md border p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
                  getPackageTone(missionPackage)
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-primary">
                      {missionPackage.variantLabel ?? missionPackage.type}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-secondary/70">
                      <Target className="h-3 w-3 shrink-0 text-synthwave-pink" />
                      <span className="truncate">{missionPackage.targetObjectiveId}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center justify-end gap-1 text-xs text-amber-300">
                      <Clock className="h-3 w-3" />
                      <span>{formatTime(missionPackage.tot)}</span>
                    </div>
                    {missionPackage.priority != null && (
                      <div className="mt-1 text-[10px] text-secondary/60">
                        P{missionPackage.priority}
                      </div>
                    )}
                  </div>
                </div>

                {missionPackage.reason && (
                  <div className="mt-2 truncate text-[10px] text-secondary/65">
                    {missionPackage.reason}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {members.map((member) => (
                    <span
                      key={`${missionPackage.id}-${member.role}-${member.group?.id ?? 'missing'}`}
                      className="inline-flex max-w-full items-center gap-1 rounded border border-secondary/15 bg-black/18 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-secondary/75"
                    >
                      <Plane className="h-2.5 w-2.5 shrink-0 text-synthwave-cyan" />
                      <span className="truncate">
                        {member.role} {member.group?.callsign ?? 'pending'}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
