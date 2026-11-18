import type { AirdromeRadio } from './airdrome-radio'
import { caucasus } from './caucasus'
import { airdromeRadio as caucasusRadio } from './caucasus/airdrome-radio'
import { CAUCASUS_COLD_WAR_THEATRE, caucasusColdWar } from './caucasus-cold-war'
import { germanyColdWar } from './germany-cold-war'
import { airdromeRadio as germanyColdWarRadio } from './germany-cold-war/airdrome-radio'
import { persianGulf } from './persian-gulf'
import { southAtlantic } from './south-atlantic'
import { syria } from './syria'

export type { AirdromeRadio } from './airdrome-radio'

export const theatres = [
  caucasus,
  caucasusColdWar,
  germanyColdWar,
  persianGulf,
  southAtlantic,
  syria
]

export { CAUCASUS_COLD_WAR_THEATRE }

/**
 * Theatres that reuse a stock DCS terrain under their own name. Coordinate conversion and map
 * tiles follow the terrain, not the DCC theatre name.
 */
const terrainAliases: Record<string, string> = {
  [CAUCASUS_COLD_WAR_THEATRE]: 'Caucasus'
}

export function terrainTheatreName(theatreName: string) {
  return terrainAliases[theatreName] ?? theatreName
}

const airdromeRadioByTheatre: Record<string, Record<string, AirdromeRadio>> = {
  [germanyColdWar.name]: germanyColdWarRadio,
  [caucasus.name]: caucasusRadio,
  [caucasusColdWar.name]: caucasusRadio
}

/** Tower frequencies and approach NDBs of a theatre's airfields, where the terrain data exists. */
export function getTheatreAirdromeRadio(theatreName: string): Record<string, AirdromeRadio> {
  return airdromeRadioByTheatre[theatreName] ?? {}
}
