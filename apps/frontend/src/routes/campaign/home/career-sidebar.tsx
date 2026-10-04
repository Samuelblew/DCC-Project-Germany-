import { useSelector } from '@xstate/store/react'
import { getCareerAircraft } from '@dcc/data'
import { Coins, Eye, Plane } from 'lucide-react'

import { cn } from '@/lib/utils'
import { activeStore } from '@/stores/active'

/**
 * The career's side panel: your money, your aircraft and the crewed sortie. The coalition's
 * flight list stays one click away instead of being the main view.
 */
export function CareerSidebar({ onShowCoalitionFlights }: { onShowCoalitionFlights: () => void }) {
  const career = useSelector(activeStore, (state) => state.context.career)
  const coalitionFlightCount = useSelector(
    activeStore,
    (state) => state.context.coalitions.player.flightGroups.length
  )
  if (!career) return null
  const aircraft = getCareerAircraft(career.preferredAircraft)
  const airframes = career.airframes.filter((airframe) => airframe.status !== 'destroyed')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-7 pb-5 pt-8">
        <div className="flex items-center gap-4 text-lg font-semibold text-white">
          <Plane className="h-5 w-5 text-synthwave-pink" />
          <span className="retro-font">{aircraft?.displayName ?? career.preferredAircraft}</span>
          <span className="ml-auto flex items-center gap-1.5 text-base text-synthwave-cyan">
            <Coins className="h-4 w-4" />
            {Math.round(career.money)} cr
          </span>
        </div>
        <div className="mt-1 text-[0.65rem] uppercase tracking-[0.18em] text-white/40">
          {career.acquisitionRule === 'arcade'
            ? 'Arcade: any aircraft'
            : 'Fidelity: coalition aircraft'}
        </div>
      </div>

      <div className="synthwave-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-4">
        {career.sortie ? (
          <div className="rounded border border-synthwave-cyan/40 bg-synthwave-cyan/10 px-3 py-2 text-sm">
            <div className="text-xs uppercase tracking-[0.15em] text-synthwave-cyan">
              Sortie ready
            </div>
            {career.sortie.callsign} at {career.sortie.homeBase} ·{' '}
            {career.sortie.members.length === 1
              ? 'alone'
              : `${career.sortie.members.length - 1} wingmen`}
          </div>
        ) : null}

        {airframes.length === 0 ? (
          <div className="rounded border border-white/10 p-4 text-center text-sm text-white/45">
            No aircraft. Visit the hangar.
          </div>
        ) : (
          airframes.map((airframe) => (
            <div
              key={airframe.id}
              className="tactical-panel flex items-center gap-3 rounded-md px-3 py-2.5 text-sm"
            >
              <span className="retro-font text-base text-[#f5d020]">#{airframe.tailNumber}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-white/85">
                  <span className="mr-1.5 text-xs text-white/50">
                    {getCareerAircraft(airframe.aircraftName)?.shortName ?? airframe.aircraftName}
                  </span>
                  {airframe.location}
                </div>
                <div className="text-xs uppercase text-white/45">
                  {airframe.status === 'flying'
                    ? 'on sortie'
                    : airframe.status === 'delivering'
                      ? `${airframe.condition} · in delivery`
                      : `${airframe.condition} · ready`}
                </div>
              </div>
              <span
                className={cn(
                  'tabular-nums',
                  airframe.integrity < 0.7 ? 'text-synthwave-pink' : 'text-white/80'
                )}
              >
                {Math.round(airframe.integrity * 100)}%
              </span>
            </div>
          ))
        )}

        <p className="px-1 pt-1 text-xs text-white/40">
          Plan and crew your missions from the Ops button at the top.
        </p>
      </div>

      <button
        type="button"
        onClick={onShowCoalitionFlights}
        className="tactical-button m-3 flex shrink-0 items-center justify-center gap-2 rounded-md py-2 text-xs text-secondary"
      >
        <Eye className="h-3.5 w-3.5" />
        Coalition flights ({coalitionFlightCount})
      </button>
    </div>
  )
}
