import type { schemas } from '@dcc/contracts'
import type { AirdromeRadio, ProfileRadios } from '@dcc/data'
import type * as z from 'zod'

export const RADIO_CHANNELS = {
  flight: 1,
  awacs: 2,
  atc: 3,
  jtac: 4
} as const

export const DEFAULT_ATC_FREQUENCY = 250
export const AWACS_FREQUENCY = 251
export const JTAC_FREQUENCY = 305

type RadioPlan = z.infer<typeof schemas.radioPlan>
type ChannelSource = z.infer<typeof schemas.radioChannelSource>

export type RadioPlanContext = {
  flightFrequency: number
  homeBase: string
  airdromeRadio: Record<string, AirdromeRadio>
}

/** Comms purposes the kneeboard lists, with the preset each one ended up on. */
export type PlannedRadioChannel = {
  purpose: 'FLIGHT' | 'AWACS' | 'ATC' | 'JTAC'
  radio: number
  channel: number
  /** Channel number as the cockpit shows it, when the panel does not count from 1. */
  cockpitChannel?: number
  frequency: number
}

/** The cockpit's label for preset `channel` (1-based), or undefined when it counts from 1. */
export function toCockpitChannel(channel: number, firstChannelLabel: number) {
  return firstChannelLabel === 1 ? undefined : channel - 1 + firstChannelLabel
}

function towerFrequency(radio: AirdromeRadio | undefined, band: 'uhf' | 'vhf') {
  return band === 'uhf' ? radio?.radio?.uhf : radio?.radio?.vhf
}

function resolveChannel(source: ChannelSource, context: RadioPlanContext): number | undefined {
  switch (source.kind) {
    case 'flight':
      return context.flightFrequency
    case 'awacs':
      return AWACS_FREQUENCY
    case 'jtac':
      return JTAC_FREQUENCY
    case 'homeTower':
      return towerFrequency(context.airdromeRadio[context.homeBase], source.band)
    case 'tower':
      return towerFrequency(context.airdromeRadio[source.airfield], source.band)
    case 'manual':
      return source.mhz
    case 'empty':
      return undefined
  }
}

const PURPOSE_BY_KIND: Partial<Record<ChannelSource['kind'], PlannedRadioChannel['purpose']>> = {
  flight: 'FLIGHT',
  awacs: 'AWACS',
  homeTower: 'ATC',
  jtac: 'JTAC'
}

/**
 * Turns the player's radio plan into the mission's Radio table, placing each comms set and the
 * ADF (outer/inner NDB pairs, in MHz as the mission editor stores them) in the `Radio[n]` slot
 * the aircraft profile names. Sets the plan leaves out stay empty.
 */
export function resolveRadioPlan(
  plan: RadioPlan,
  profileRadios: ProfileRadios,
  context: RadioPlanContext
) {
  const slots = [
    ...profileRadios.comms.map((radio) => radio.missionRadio),
    profileRadios.adf?.missionRadio ?? 0
  ]
  const radios: Array<{ channels: Record<number, number> }> = Array.from(
    { length: Math.max(...slots) },
    () => ({ channels: {} })
  )
  const channels: PlannedRadioChannel[] = []

  profileRadios.comms.forEach((radio, radioIndex) => {
    const presets = radios[radio.missionRadio - 1]!.channels
    plan.comms[radioIndex]?.slice(0, radio.channels).forEach((source, index) => {
      const frequency = resolveChannel(source, context)
      if (frequency == null) return
      const channel = index + 1
      presets[channel] = frequency
      const purpose = PURPOSE_BY_KIND[source.kind]
      if (purpose && !channels.some((planned) => planned.purpose === purpose)) {
        const cockpitChannel = toCockpitChannel(channel, radio.firstChannelLabel)
        channels.push({
          purpose,
          radio: radio.missionRadio,
          channel,
          ...(cockpitChannel != null ? { cockpitChannel } : {}),
          frequency
        })
      }
    })
  })

  const adfRadio = profileRadios.adf
  if (adfRadio) {
    const presets = radios[adfRadio.missionRadio - 1]!.channels
    plan.adf.slice(0, adfRadio.pairs).forEach((source, pair) => {
      if (source.kind === 'empty') return
      const airfield = source.kind === 'home' ? context.homeBase : source.airfield
      const approach = context.airdromeRadio[airfield]?.approaches[source.approach]
      if (!approach) return
      presets[pair * 2 + 1] = approach.outer.khz / 1000
      if (approach.inner) presets[pair * 2 + 2] = approach.inner.khz / 1000
    })
  }

  return { radios, channels }
}
