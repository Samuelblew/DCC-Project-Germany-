import { useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { getCareerAircraft, getTheatreAirdromeRadio, scenarios, theatres } from '@dcc/data'
import type { schemas } from '@dcc/contracts'
import type * as z from 'zod'
import { Radio } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { getCareerRadioPlan, getReadyAirframes, isCommsFrequencyValid } from '@/logic/career/career'
import { activeStore } from '@/stores/active'

type RadioPlan = z.infer<typeof schemas.radioPlan>
type ChannelSource = RadioPlan['comms'][number][number]
type AdfSource = RadioPlan['adf'][number]
type TowerBand = 'uhf' | 'vhf'

const AWACS_MHZ = 251
const JTAC_MHZ = 305
const TOWER_BAND_RANGES: Record<TowerBand, [number, number]> = {
  vhf: [108, 156],
  uhf: [225, 400]
}

/** Airfield tower bands a comms set can tune, UHF first. */
function towerBands(bands: Array<[number, number]>): TowerBand[] {
  return (['uhf', 'vhf'] as const).filter((band) => {
    const [low, high] = TOWER_BAND_RANGES[band]
    return bands.some(([from, to]) => from < high && to > low)
  })
}

function formatMhz(mhz: number | undefined) {
  return mhz == null ? '—' : `${mhz.toFixed(3)} MHz`
}

/** Select values for a comms preset; airfield names may contain spaces but never "|". */
function encodeChannel(source: ChannelSource) {
  switch (source.kind) {
    case 'homeTower':
      return `homeTower|${source.band}`
    case 'tower':
      return `tower|${source.airfield}|${source.band}`
    default:
      return source.kind
  }
}

function decodeChannel(value: string, previous: ChannelSource): ChannelSource {
  const [kind, a, b] = value.split('|')
  switch (kind) {
    case 'flight':
    case 'awacs':
    case 'jtac':
    case 'empty':
      return { kind }
    case 'homeTower':
      return { kind, band: a === 'vhf' ? 'vhf' : 'uhf' }
    case 'tower':
      return { kind, airfield: a!, band: b === 'vhf' ? 'vhf' : 'uhf' }
    case 'manual':
      return { kind, mhz: previous.kind === 'manual' ? previous.mhz : 251 }
    default:
      return previous
  }
}

function encodeAdf(source: AdfSource) {
  if (source.kind === 'home') return `home|${source.approach}`
  if (source.kind === 'airfield') return `airfield|${source.airfield}|${source.approach}`
  return 'empty'
}

function decodeAdf(value: string): AdfSource {
  const [kind, a, b] = value.split('|')
  if (kind === 'home') return { kind, approach: Number(a) }
  if (kind === 'airfield') return { kind, airfield: a!, approach: Number(b) }
  return { kind: 'empty' }
}

/**
 * Sets an aircraft's radio presets from the DCC, laid out from its profile: every channel of each
 * comms set and every ADF pair, with airfield tower frequencies and approach NDBs taken from the
 * terrain. Loaded into the aircraft at takeoff.
 */
export function CareerRadioDialog({
  open,
  aircraftName,
  onOpenChange
}: {
  open: boolean
  /** Type whose radios are set; defaults to the type the career screens open on. */
  aircraftName?: string
  onOpenChange: (open: boolean) => void
}) {
  const career = useSelector(activeStore, (state) => state.context.career)
  const scenarioId = useSelector(activeStore, (state) => state.context.scenarioId)
  const friendlyAirfields = useSelector(
    activeStore,
    (state) => state.context.coalitions.player.airdromeNames
  )
  const aircraft = career ? getCareerAircraft(aircraftName ?? career.preferredAircraft) : undefined
  const theatre = theatres.find(
    (entry) => entry.name === scenarios.find((s) => s.id === scenarioId)?.theatreName
  )
  const radioData = theatre ? getTheatreAirdromeRadio(theatre.name) : {}
  const [plan, setPlan] = useState<RadioPlan | null>(null)

  const savedPlan = career && aircraft ? getCareerRadioPlan(career, aircraft) : undefined
  if (!career || !aircraft?.radios || !savedPlan) return null

  const current = plan ?? savedPlan
  const homeBase =
    getReadyAirframes(career, undefined, aircraft.aircraftName)[0]?.location ??
    career.airframes.find((airframe) => airframe.aircraftName === aircraft.aircraftName)?.location
  const friendly = new Set(friendlyAirfields)
  const airfieldNames = Object.keys(radioData).sort(
    (a, b) => Number(friendly.has(b)) - Number(friendly.has(a)) || a.localeCompare(b)
  )
  const towerAirfields = airfieldNames.filter((name) => radioData[name]?.radio)
  const approachAirfields = airfieldNames.filter((name) => radioData[name]!.approaches.length > 0)
  const { comms: commsSpecs, adf: adfSpec } = aircraft.radios

  const resolve = (source: ChannelSource): string => {
    switch (source.kind) {
      case 'flight':
        return 'set per mission'
      case 'awacs':
        return formatMhz(AWACS_MHZ)
      case 'jtac':
        return formatMhz(JTAC_MHZ)
      case 'homeTower': {
        const radio = homeBase ? radioData[homeBase]?.radio : undefined
        return `${formatMhz(source.band === 'uhf' ? radio?.uhf : radio?.vhf)} (base)`
      }
      case 'tower': {
        const radio = radioData[source.airfield]?.radio
        return formatMhz(source.band === 'uhf' ? radio?.uhf : radio?.vhf)
      }
      case 'manual':
        return formatMhz(source.mhz)
      case 'empty':
        return ''
    }
  }

  const describeAdf = (source: AdfSource) => {
    if (source.kind === 'empty') return ''
    const airfield = source.kind === 'home' ? homeBase : source.airfield
    const approach = airfield ? radioData[airfield]?.approaches[source.approach] : undefined
    if (!approach) return 'no NDB here'
    const inner = approach.inner ? ` / ${approach.inner.callsign} ${approach.inner.khz}` : ''
    return `${approach.outer.callsign} ${approach.outer.khz}${inner} kHz`
  }

  const updateComms = (radioIndex: number, index: number, source: ChannelSource) =>
    setPlan({
      ...current,
      comms: current.comms.map((channels, r) =>
        r === radioIndex ? channels.map((entry, i) => (i === index ? source : entry)) : channels
      )
    })
  const updateAdf = (index: number, source: AdfSource) =>
    setPlan({ ...current, adf: current.adf.map((entry, i) => (i === index ? source : entry)) })

  /** Fills a set's empty channels with friendly towers, nearest to the home base first. */
  const fillFriendlyTowers = (radioIndex: number) => {
    const band = towerBands(commsSpecs[radioIndex]!.bands)[0]
    if (!band) return
    const home = homeBase && theatre ? theatre.airdromeDetails[homeBase] : undefined
    const used = new Set(
      current.comms[radioIndex]!.flatMap((source) =>
        source.kind === 'tower' ? [source.airfield] : []
      )
    )
    const candidates = towerAirfields
      .filter((name) => friendly.has(name) && name !== homeBase && !used.has(name))
      .sort((a, b) => {
        const da = theatre?.airdromeDetails[a]
        const db = theatre?.airdromeDetails[b]
        if (!home || !da || !db) return 0
        return Math.hypot(da.x - home.x, da.y - home.y) - Math.hypot(db.x - home.x, db.y - home.y)
      })
    const comms = current.comms.map((channels, r) =>
      r !== radioIndex
        ? channels
        : channels.map((source) => {
            if (source.kind !== 'empty') return source
            const airfield = candidates.shift()
            return airfield ? ({ kind: 'tower', airfield, band } as const) : source
          })
    )
    setPlan({ ...current, comms })
  }

  const invalidManual = current.comms.some((channels, radioIndex) =>
    channels.some(
      (source) =>
        source.kind === 'manual' && !isCommsFrequencyValid(aircraft, source.mhz, radioIndex)
    )
  )
  const radioNames = [...commsSpecs.map((radio) => radio.name), ...(adfSpec ? [adfSpec.name] : [])]

  const close = () => {
    setPlan(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent className="flex max-h-[min(90vh,800px)] flex-col overflow-hidden overflow-y-hidden border-synthwave-pink/30 bg-synthwave-dark/95 text-synthwave-light backdrop-blur-xl sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="retro-font flex items-center gap-2 text-synthwave-cyan">
            <Radio className="h-5 w-5" />
            {radioNames.join(' · ')} presets
          </DialogTitle>
          <DialogDescription className="text-secondary/70">
            Loaded into your aircraft on every sortie. &quot;Base&quot; entries follow the airfield
            you take off from{homeBase ? ` (now ${homeBase})` : ''}.
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            'grid min-h-0 grid-cols-1 gap-4 text-sm',
            adfSpec && 'lg:grid-cols-[1.6fr_1fr]'
          )}
        >
          <div className="synthwave-scrollbar flex max-h-[60vh] min-h-0 flex-col gap-4 overflow-y-auto pr-1">
            {commsSpecs.map((radio, radioIndex) => {
              const bands = towerBands(radio.bands)
              const towerOptions = (names: string[]) =>
                names.flatMap((name) =>
                  bands.map((band) => (
                    <option key={`${name}${band}`} value={`tower|${name}|${band}`}>
                      {name} {band.toUpperCase()}
                    </option>
                  ))
                )
              return (
                <section key={radio.name} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-white/50">
                      {radio.name} · {radio.bands.map(([l, h]) => `${l}-${h}`).join(' / ')} MHz
                    </h3>
                    {bands.length > 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto h-6 px-2 text-xs"
                        onClick={() => fillFriendlyTowers(radioIndex)}
                      >
                        Fill friendly towers
                      </Button>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    {(current.comms[radioIndex] ?? []).map((source, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="w-14 shrink-0 text-xs text-white/50">
                          Ch {index + radio.firstChannelLabel}
                        </span>
                        <select
                          className="min-w-0 flex-1 rounded border border-white/15 bg-black/40 px-1.5 py-1 text-xs"
                          value={encodeChannel(source)}
                          onChange={(event) =>
                            updateComms(
                              radioIndex,
                              index,
                              decodeChannel(event.target.value, source)
                            )
                          }
                        >
                          <option value="empty">Empty</option>
                          <optgroup label="Mission">
                            <option value="flight">Flight frequency</option>
                            <option value="awacs">AWACS</option>
                            <option value="jtac">JTAC</option>
                            {bands.map((band) => (
                              <option key={band} value={`homeTower|${band}`}>
                                Base tower {band.toUpperCase()}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Friendly airfields">
                            {towerOptions(towerAirfields.filter((name) => friendly.has(name)))}
                          </optgroup>
                          <optgroup label="Other airfields">
                            {towerOptions(towerAirfields.filter((name) => !friendly.has(name)))}
                          </optgroup>
                          <option value="manual">Manual…</option>
                        </select>
                        {source.kind === 'manual' ? (
                          <input
                            type="number"
                            step={0.025}
                            className={cn(
                              'w-24 rounded border bg-black/40 px-1.5 py-1 text-xs',
                              isCommsFrequencyValid(aircraft, source.mhz, radioIndex)
                                ? 'border-white/15'
                                : 'border-synthwave-pink'
                            )}
                            value={source.mhz}
                            onChange={(event) =>
                              updateComms(radioIndex, index, {
                                kind: 'manual',
                                mhz: Number(event.target.value)
                              })
                            }
                          />
                        ) : (
                          <span className="w-32 shrink-0 text-right text-xs tabular-nums text-white/60">
                            {resolve(source)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>

          {adfSpec ? (
            <section className="flex min-h-0 flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-white/50">
                {adfSpec.name} · approach NDBs (outer / inner)
              </h3>
              {current.adf.map((source, pair) => (
                <div
                  key={pair}
                  className="space-y-1 rounded border border-white/10 bg-white/[0.03] p-2"
                >
                  <div className="text-xs text-white/50">Channel {pair + 1} · outer and inner</div>
                  <select
                    className="w-full rounded border border-white/15 bg-black/40 px-1.5 py-1 text-xs"
                    value={encodeAdf(source)}
                    onChange={(event) => updateAdf(pair, decodeAdf(event.target.value))}
                  >
                    <option value="empty">Empty</option>
                    {(homeBase ? (radioData[homeBase]?.approaches ?? []) : []).map(
                      (approach, i) => (
                        <option key={`home${i}`} value={`home|${i}`}>
                          Base · approach {approach.heading}°
                        </option>
                      )
                    )}
                    {approachAirfields.flatMap((name) =>
                      radioData[name]!.approaches.map((approach, i) => (
                        <option key={`${name}${i}`} value={`airfield|${name}|${i}`}>
                          {friendly.has(name) ? '' : '(enemy) '}
                          {name} · {approach.heading}°
                        </option>
                      ))
                    )}
                  </select>
                  <div className="text-xs tabular-nums text-white/60">{describeAdf(source)}</div>
                </div>
              ))}
            </section>
          ) : null}
        </div>

        <DialogFooter className="items-center gap-2">
          {invalidManual ? (
            <span className="mr-auto text-xs text-synthwave-pink">
              A manual frequency is outside its radio&apos;s bands.
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className={invalidManual ? '' : 'mr-auto'}
            onClick={() => setPlan(getCareerRadioPlan({ ...career, radios: {} }, aircraft)!)}
          >
            Reset to default
          </Button>
          <Button variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="tacticalAction"
            disabled={invalidManual}
            onClick={() => {
              activeStore.send({
                type: 'careerSetRadio',
                plan: current,
                aircraftName: aircraft.aircraftName
              })
              close()
            }}
          >
            Save presets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
