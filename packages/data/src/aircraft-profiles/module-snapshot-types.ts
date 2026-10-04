/** What an installed DCS module offers, as scripts/verify-aircraft-profile.ts read it. */
export type ModuleSnapshot = {
  /** `flamingCliffs` when the module is flown through the Flaming Cliffs (MAC) layer. */
  fidelity: 'full' | 'flamingCliffs'
  /** Files and bundled missions the snapshot was read from, relative to the DCS root. */
  sources: string[]
  /** Every store CLSID the module defines or was seen carrying. */
  clsids: string[]
  /** Stations each store was seen on in the editor payloads and bundled missions. */
  observedStations: Record<string, number[]>
  /** Failure IDs the mission can arm. */
  failures: string[]
  /** Preset radios in `Radio[n]` order. */
  radios: Array<{ name: string; bands: Array<[number, number]>; channels: number }>
}
