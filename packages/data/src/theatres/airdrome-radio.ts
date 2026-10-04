/** Radio facilities of one airfield, as declared by the DCS terrain. Frequencies in MHz / kHz. */
export type AirdromeRadio = {
  radio?: {
    /** Tower callsign. */
    callsign: string
    /** UHF tower frequency in MHz. */
    uhf?: number
    /** VHF (118-140 MHz) tower frequency in MHz. */
    vhf?: number
  }
  /** Approach NDB pairs (outer and inner marker), one per runway direction. */
  approaches: Array<{
    heading: number
    outer: { khz: number; callsign: string }
    inner?: { khz: number; callsign: string }
  }>
}
