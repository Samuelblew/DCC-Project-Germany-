import { Clock, Crosshair, PlaneTakeoff, User } from 'lucide-react'
import { schemas } from '@dcc/contracts'
import * as z from 'zod'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { getAircraftDisplayName } from '@/lib/aircraft-display'
import { cn } from '@/lib/utils'
import { AircraftRosterFilterToggle } from './aircraft-roster-filter-toggle'
import { PlayerParkingSelect } from './player-parking-select'

type FlightGroup = z.infer<typeof schemas.flightGroup>

interface FlightGroupCardProps {
  group: FlightGroup
  isAirborne?: boolean
  selected?: boolean
  targetOutcome?: {
    label: string
    detail?: string
    complete: boolean
  }
  onClick?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  showClientControls?: boolean
  showAircraftType?: boolean
  aircraftTypeDisabled?: boolean
  aircraftTypeOptions?: string[]
  showAllAircraftTypes?: boolean
  onAircraftTypeChange?: (aircraftType: string) => void
  onShowAllAircraftTypesChange?: (checked: boolean) => void
  onClientCountChange?: (count: number) => void
}

function formatTime(date: Date | string) {
  const d = new Date(date)
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  }).format(d)
}

export function FlightGroupCard({
  group,
  isAirborne = false,
  selected = false,
  targetOutcome,
  onClick,
  onMouseEnter,
  onMouseLeave,
  showClientControls = false,
  showAircraftType = false,
  aircraftTypeDisabled = false,
  aircraftTypeOptions = [],
  showAllAircraftTypes = false,
  onAircraftTypeChange,
  onShowAllAircraftTypesChange,
  onClientCountChange
}: FlightGroupCardProps) {
  const hasClients = group.aircrafts.some((aircraft) => aircraft.client)
  const clientCount = group.aircrafts.filter((aircraft) => aircraft.client).length
  const availableClientCount = group.aircrafts.length
  const selectedAircraftType = group.aircrafts[0]?.aircraftName
  const showAircraftTypeSelect =
    showAircraftType &&
    selectedAircraftType &&
    aircraftTypeOptions.length > 0 &&
    onAircraftTypeChange
  const targetOutcomeTone = targetOutcome?.complete
    ? 'text-amber-300'
    : targetOutcome?.label === 'Target damaged'
      ? 'text-amber-300'
      : 'text-red-300'

  return (
    <div
      className={cn(
        'w-full min-w-0 rounded-md border p-2 transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.065),0_8px_18px_rgba(0,0,0,0.2)]',
        isAirborne
          ? selected
            ? 'border-amber-400 bg-amber-400/15 shadow-[inset_0_2px_8px_rgba(0,0,0,0.32),0_0_18px_rgba(251,191,36,0.14)]'
            : 'border-amber-400/40 bg-amber-400/7 hover:bg-amber-400/12'
          : selected
            ? hasClients
              ? 'border-amber-400 bg-amber-500/20 shadow-[inset_0_2px_8px_rgba(0,0,0,0.35),0_0_20px_rgba(232,183,48,0.16)]'
              : 'border-synthwave-pink bg-synthwave-pink/20 shadow-[inset_0_2px_8px_rgba(0,0,0,0.35),0_0_20px_rgba(217,68,58,0.16)]'
            : hasClients
              ? 'border-amber-400/30 bg-amber-500/10 hover:border-amber-400/45 hover:bg-amber-500/16'
              : 'border-synthwave-pink/16 bg-synthwave-pink/[0.055] hover:border-synthwave-pink/34 hover:bg-synthwave-pink/10'
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span
              className={cn('text-sm font-medium', hasClients ? 'text-amber-300' : 'text-primary')}
            >
              {group.callsign}
            </span>
            {isAirborne && (
              <span className="flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <PlaneTakeoff className="h-2.5 w-2.5" />
                Airborne
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-secondary/70">
            <div className="flex items-center gap-1" title="Start Time">
              <Clock className="h-3 w-3" />
              <span>{formatTime(group.flightplan.startTime)}</span>
            </div>
            {group.tot && (
              <div className="flex items-center gap-1" title="Time Over Target">
                <Crosshair className="h-3 w-3" />
                <span>{formatTime(group.tot)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-0.5">
          <span className="rounded-full border border-secondary/20 bg-secondary/10 px-1.5 py-0.5 text-xs text-secondary/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
            {group.task}
          </span>
          <div className="flex items-center gap-2 text-[10px] text-secondary/60">
            <span>
              {group.aircrafts.length}{' '}
              {showAircraftType && group.aircrafts[0]
                ? getAircraftDisplayName(group.aircrafts[0].aircraftName)
                : 'Aircraft'}
            </span>
            <div
              className={cn('flex items-center gap-1', hasClients && 'text-amber-300')}
              title="Client slots"
            >
              <User className="h-3 w-3" />
              <span>{clientCount}</span>
            </div>
          </div>
        </div>
      </div>

      {targetOutcome && (
        <div className="mt-2 border-t border-synthwave-pink/10 pt-2">
          <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-wide">
            <span className={targetOutcomeTone}>{targetOutcome.label}</span>
            {targetOutcome.detail && (
              <span className="shrink-0 text-secondary/65">{targetOutcome.detail}</span>
            )}
          </div>
        </div>
      )}

      {showAircraftTypeSelect && (
        <div
          className="mt-2 border-t border-synthwave-pink/10 pt-2"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="sr-only">Aircraft type for {group.callsign}</span>
          <Select
            value={selectedAircraftType}
            onValueChange={onAircraftTypeChange}
            disabled={aircraftTypeDisabled}
          >
            <SelectTrigger
              className="h-8 border-[#e8b730]/25 bg-black/35 text-xs text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-[#e8b730]/45 focus:ring-[#e8b730]/25 disabled:cursor-default disabled:opacity-55"
              title="Aircraft type"
            >
              <SelectValue placeholder="Aircraft type">
                {getAircraftDisplayName(selectedAircraftType)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent
              className="border-[#e8b730]/25 bg-[#161412]/95 text-white shadow-[0_12px_32px_rgba(0,0,0,0.45)] backdrop-blur"
            >
              {aircraftTypeOptions.map((aircraftType) => (
                <SelectItem
                  key={aircraftType}
                  value={aircraftType}
                  className="text-xs focus:bg-[#e8b730]/15 focus:text-white"
                >
                  {getAircraftDisplayName(aircraftType)}
                </SelectItem>
              ))}
              {onShowAllAircraftTypesChange && (
                <>
                  <SelectSeparator className="bg-[#e8b730]/15" />
                  <AircraftRosterFilterToggle
                    checked={showAllAircraftTypes}
                    onCheckedChange={onShowAllAircraftTypesChange}
                  />
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {showClientControls && onClientCountChange && (
        <div
          className="mt-2 flex items-center justify-between border-t border-synthwave-pink/10 pt-2"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="flex items-center gap-1 text-xs text-secondary/70">
            <User className="h-3 w-3" />
            Clients
          </span>
          {hasClients ? (
            <ToggleGroup
              type="single"
              size="sm"
              value={clientCount.toString()}
              className="tactical-inset rounded-md"
              onValueChange={(value) => {
                if (!value) return
                onClientCountChange(parseInt(value))
              }}
            >
              {Array.from({ length: group.aircrafts.length + 1 }).map((_, index) => (
                <ToggleGroupItem
                  key={index}
                  value={index.toString()}
                  className="tactical-button h-6 w-6 rounded-sm border-0 p-0 text-xs text-secondary data-[state=on]:text-amber-300"
                >
                  {index}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : (
            <div className="inline-flex rounded-md shadow-[0_0_18px_rgba(217,68,58,0.14)]">
              <button
                type="button"
                className={cn(
                  'tactical-button tactical-action-button h-7 border-0 px-3 text-xs font-medium text-white transition-colors',
                  availableClientCount > 1 ? 'rounded-l-sm rounded-r-none' : 'rounded-sm'
                )}
                onClick={() => onClientCountChange(1)}
              >
                Join
              </button>
              {Array.from({ length: Math.max(availableClientCount - 1, 0) }).map((_, index) => {
                const count = index + 2
                const isLast = count === availableClientCount

                return (
                  <button
                    key={count}
                    type="button"
                    className={cn(
                      'tactical-button tactical-action-button h-7 w-7 rounded-none border-0 border-l border-white/18 p-0 text-xs font-semibold text-white transition-colors',
                      isLast && 'rounded-r-sm'
                    )}
                    onClick={() => onClientCountChange(count)}
                    title={`Add ${count} client slots`}
                    aria-label={`Add ${count} client slots`}
                  >
                    {count}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
      {showClientControls && hasClients ? (
        <div className="mt-2 border-t border-synthwave-pink/10 pt-2">
          <PlayerParkingSelect
            flightGroupId={group.id}
            aircraftName={group.aircrafts.find((aircraft) => aircraft.client)?.aircraftName}
          />
        </div>
      ) : null}
    </div>
  )
}
