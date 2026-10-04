import * as z from 'zod'

/**
 * What one preset channel of a comms radio holds. Mission-dependent sources (the flight's own
 * frequency, the tower of the base the flight leaves from) are resolved when the mission is built.
 */
export const radioChannelSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('empty') }),
  z.object({ kind: z.literal('flight') }),
  z.object({ kind: z.literal('awacs') }),
  z.object({ kind: z.literal('jtac') }),
  z.object({ kind: z.literal('homeTower'), band: z.enum(['uhf', 'vhf']) }),
  z.object({ kind: z.literal('tower'), airfield: z.string(), band: z.enum(['uhf', 'vhf']) }),
  z.object({ kind: z.literal('manual'), mhz: z.number() })
])

/** One outer/inner pair of ADF presets, filled with an airfield's approach NDBs. */
export const adfPairSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('empty') }),
  z.object({ kind: z.literal('home'), approach: z.number().int().min(0).default(0) }),
  z.object({ kind: z.literal('airfield'), airfield: z.string(), approach: z.number().int().min(0) })
])

/** Plans saved before aircraft could carry several comms radios held one flat channel list. */
function migrateSingleCommsRadio(value: unknown) {
  if (typeof value !== 'object' || value === null) return value
  const comms = (value as { comms?: unknown }).comms
  if (!Array.isArray(comms) || comms.length === 0 || Array.isArray(comms[0])) return value
  return { ...value, comms: [comms] }
}

/**
 * The player's radio setup for an aircraft: one channel list per comms radio, in the order the
 * aircraft profile lists the radios, and the ADF presets. Channels are in cockpit order.
 */
export const radioPlan = z.preprocess(
  migrateSingleCommsRadio,
  z.object({
    comms: z.array(z.array(radioChannelSource)),
    adf: z.array(adfPairSource).default([])
  })
)
