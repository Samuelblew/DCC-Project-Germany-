import { BookOpen, Bot, Gamepad2, Pencil, Plane, Plus, Satellite } from 'lucide-react'
import { motion } from 'motion/react'
import { getCampaignDateForYear, getGpsEnabledCampaignDate, isGpsAvailable } from '@dcc/campaign'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import type {
  CampaignEra,
  Faction,
  FactionAircraft,
  Scenario,
  ScenarioStep
} from './start-campaign-options'
import { formatFactionLabel } from './start-campaign-options'

type AircraftRosterProps = {
  scenario: Scenario
  step: Exclude<ScenarioStep, 'scenario'>
  eraLabel: CampaignEra | string
  playerFaction: Faction | undefined
  opponentFaction: Faction | undefined
  playerFactionId: string
  campaignYear: number
  aircraft: FactionAircraft[]
  isCreatingCampaign: boolean
  forceGpsEnabledDate: boolean
  factionsDiffer: boolean
  selectedFaction: Faction | undefined
  lockFactions?: boolean
  onCustomizeFactions: () => void
  onForceGpsEnabledDateChange: (force: boolean) => void
  onCustomizeSelectedFaction: () => void
  onCreateSelectedFaction: () => void
  onCreateCampaign: () => void
}

export function AircraftRoster({
  scenario,
  step,
  eraLabel,
  playerFaction,
  opponentFaction,
  playerFactionId,
  campaignYear,
  aircraft,
  isCreatingCampaign,
  forceGpsEnabledDate,
  factionsDiffer,
  selectedFaction,
  lockFactions = false,
  onCustomizeFactions,
  onForceGpsEnabledDateChange,
  onCustomizeSelectedFaction,
  onCreateSelectedFaction,
  onCreateCampaign
}: AircraftRosterProps) {
  const campaignDate = getCampaignDateForYear(scenario.date, campaignYear)
  const gpsNaturallyAvailable = isGpsAvailable(campaignDate)
  const effectiveDate = forceGpsEnabledDate ? getGpsEnabledCampaignDate(campaignDate) : campaignDate
  const gpsAvailable = isGpsAvailable(effectiveDate)
  const formattedEffectiveDate = effectiveDate
    .toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    })
    .toUpperCase()

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-md border border-synthwave-pink/35 bg-black/30 shadow-[0_0_44px_rgba(217,68,58,0.14)] backdrop-blur">
      <div className="border-b border-synthwave-purple/30 p-5">
        <div className="mb-2 flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.2em] text-synthwave-pink">
          <Plane className="h-3.5 w-3.5" />
          Aircraft roster
        </div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="retro-font text-xl text-white">
              {playerFaction ? formatFactionLabel(playerFaction) : 'Player faction'}
            </div>
            <div className="mt-1 text-xs text-synthwave-cyan/75">
              {eraLabel}
              {opponentFaction ? ` // vs ${formatFactionLabel(opponentFaction)}` : ''}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="rounded border border-synthwave-cyan/35 px-2 py-1 text-[0.65rem] text-synthwave-cyan">
              {aircraft.length} TYPES
            </span>
            {step === 'factions' && !lockFactions ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Customize selected faction"
                className="h-8 border-synthwave-purple/50 bg-transparent px-2.5 text-[0.6rem] uppercase tracking-wider text-synthwave-light/70 hover:border-synthwave-cyan hover:bg-synthwave-cyan/8 hover:text-synthwave-cyan"
                onClick={onCustomizeSelectedFaction}
                disabled={isCreatingCampaign || !selectedFaction}
              >
                <Pencil className="h-3 w-3" />
                Customize
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="synthwave-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3 [scrollbar-gutter:stable]">
        <motion.div
          key={playerFactionId}
          className="grid gap-2"
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
        >
          {aircraft.map((entry) => (
            <div
              key={entry.name}
              className="relative rounded border border-synthwave-purple/30 bg-synthwave-dark/55 p-3"
            >
              <div className="absolute inset-y-0 left-0 w-0.5 bg-synthwave-cyan/65" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{entry.displayName}</div>
                  {entry.displayName !== entry.name ? (
                    <div className="mt-0.5 truncate font-mono text-[0.6rem] text-synthwave-light/35">
                      {entry.name}
                    </div>
                  ) : null}
                </div>
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[0.55rem] uppercase tracking-wider',
                    entry.controllable
                      ? 'border-synthwave-pink/50 text-synthwave-pink'
                      : 'border-synthwave-cyan/30 text-synthwave-cyan/65'
                  )}
                >
                  {entry.controllable ? (
                    <Gamepad2 className="h-2.5 w-2.5" />
                  ) : (
                    <Bot className="h-2.5 w-2.5" />
                  )}
                  {entry.controllable ? 'Player' : 'AI'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="rounded bg-synthwave-purple/18 px-1.5 py-0.5 text-[0.58rem] text-synthwave-light/50">
                  {entry.isHelicopter ? 'HELICOPTER' : 'FIXED WING'}
                </span>
                {entry.isMod ? (
                  <span className="rounded border border-synthwave-pink/40 bg-synthwave-pink/10 px-1.5 py-0.5 text-[0.58rem] text-synthwave-pink">
                    MOD
                  </span>
                ) : null}
                {entry.roles.slice(0, 2).map((role) => (
                  <span
                    key={role}
                    className="rounded bg-synthwave-purple/18 px-1.5 py-0.5 text-[0.58rem] text-synthwave-light/50"
                  >
                    {role.toUpperCase()}
                  </span>
                ))}
                {entry.roles.length > 2 ? (
                  <span className="group/roles relative inline-flex cursor-default rounded bg-synthwave-purple/18 px-1.5 py-0.5 text-[0.58rem] text-synthwave-cyan/60">
                    +{entry.roles.length - 2}
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute top-full left-0 z-30 mt-1.5 flex w-max max-w-52 flex-wrap gap-1 rounded border border-synthwave-purple/50 bg-black/95 px-2 py-1.5 opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.55)] transition-opacity group-hover/roles:opacity-100"
                    >
                      {entry.roles.slice(2).map((role) => (
                        <span
                          key={role}
                          className="rounded bg-synthwave-purple/25 px-1.5 py-0.5 text-[0.58rem] text-synthwave-light/80"
                        >
                          {role.toUpperCase()}
                        </span>
                      ))}
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </motion.div>
      </div>

      <div className="border-t border-synthwave-purple/30 p-4">
        <div className="mb-3 flex items-center justify-between gap-3 text-xs">
          <span className="truncate text-synthwave-light/50">
            {scenario.name} // {scenario.theatreName}
          </span>
          <span className="shrink-0 text-synthwave-pink">{eraLabel}</span>
        </div>
        <div
          className={cn(
            'mb-3 rounded-md border bg-synthwave-dark/60 p-3 transition-colors',
            gpsAvailable ? 'border-synthwave-cyan/35' : 'border-synthwave-pink/40'
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <Satellite
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0',
                  gpsAvailable ? 'text-synthwave-cyan' : 'text-synthwave-pink'
                )}
              />
              <div className="min-w-0">
                <div
                  className={cn(
                    'text-[0.6rem] uppercase tracking-[0.18em]',
                    gpsAvailable ? 'text-synthwave-cyan' : 'text-synthwave-pink'
                  )}
                >
                  GPS {gpsAvailable ? 'available' : 'unavailable'}
                </div>
                <div className="mt-1 text-[0.68rem] text-synthwave-light/55">
                  Mission date · {formattedEffectiveDate}
                  {forceGpsEnabledDate && !gpsNaturallyAvailable ? ' · OVERRIDDEN' : ''}
                </div>
              </div>
            </div>
            <Switch
              id="force-gps-enabled-date"
              aria-label="Force GPS-enabled mission date"
              checked={forceGpsEnabledDate && !gpsNaturallyAvailable}
              onCheckedChange={onForceGpsEnabledDateChange}
              disabled={isCreatingCampaign || gpsNaturallyAvailable}
              className="mt-0.5 data-[state=checked]:bg-synthwave-cyan data-[state=unchecked]:bg-synthwave-purple/45"
            />
          </div>
          <label
            htmlFor="force-gps-enabled-date"
            className={cn(
              'mt-2 block text-[0.62rem] leading-4 text-synthwave-light/45',
              !gpsNaturallyAvailable && 'cursor-pointer'
            )}
          >
            {gpsNaturallyAvailable ? 'GPS is already available.' : 'Enable GPS for this campaign.'}
          </label>
        </div>
        {step === 'era' && !lockFactions ? (
          <Button
            type="button"
            variant="outline"
            className="mb-2 h-10 w-full border-synthwave-purple bg-synthwave-dark/80 text-synthwave-cyan hover:border-synthwave-pink hover:bg-synthwave-purple/10 hover:text-white"
            onClick={onCustomizeFactions}
            disabled={isCreatingCampaign}
          >
            Customize Factions
          </Button>
        ) : null}
        {lockFactions ? (
          <div className="mb-2 rounded border border-synthwave-cyan/25 bg-synthwave-dark/60 px-3 py-2 text-center text-[0.62rem] uppercase tracking-[0.16em] text-synthwave-cyan/75">
            Fleets locked to Escalation
          </div>
        ) : null}
        {step === 'factions' && !lockFactions ? (
          <Button
            type="button"
            variant="outline"
            aria-label="Create new faction from selected faction"
            className="mb-2 h-10 w-full border-synthwave-purple bg-synthwave-dark/80 text-synthwave-cyan hover:border-synthwave-pink hover:bg-synthwave-purple/10 hover:text-white"
            onClick={onCreateSelectedFaction}
            disabled={isCreatingCampaign || !selectedFaction}
          >
            <Plus className="h-4 w-4" />
            New Faction
          </Button>
        ) : null}
        <Button
          type="button"
          className="h-11 w-full bg-synthwave-pink text-white hover:bg-synthwave-pink/85"
          onClick={onCreateCampaign}
          disabled={isCreatingCampaign || !scenario.available || !factionsDiffer}
        >
          <BookOpen className="h-4 w-4" />
          {isCreatingCampaign ? 'CREATING' : 'CREATE CAMPAIGN'}
        </Button>
      </div>
    </aside>
  )
}
