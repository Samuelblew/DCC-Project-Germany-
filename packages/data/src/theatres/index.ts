import type { AirdromeRadio } from './airdrome-radio'
import { caucasus } from './caucasus'
import { germanyColdWar } from './germany-cold-war'
import { airdromeRadio as germanyColdWarRadio } from './germany-cold-war/airdrome-radio'
import { persianGulf } from './persian-gulf'
import { southAtlantic } from './south-atlantic'
import { syria } from './syria'

export type { AirdromeRadio } from './airdrome-radio'

export const theatres = [caucasus, germanyColdWar, persianGulf, southAtlantic, syria]

const airdromeRadioByTheatre: Record<string, Record<string, AirdromeRadio>> = {
  [germanyColdWar.name]: germanyColdWarRadio
}

/** Tower frequencies and approach NDBs of a theatre's airfields, where the terrain data exists. */
export function getTheatreAirdromeRadio(theatreName: string): Record<string, AirdromeRadio> {
  return airdromeRadioByTheatre[theatreName] ?? {}
}
