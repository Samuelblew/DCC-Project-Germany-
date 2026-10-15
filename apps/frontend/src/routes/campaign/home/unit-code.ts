import { schemas } from '@dcc/contracts'
import * as z from 'zod'

const sidcUnitCode = {
  airport: 'IBA---',
  airDefence: 'UCD---',
  airDefenceMissle: 'UCDM--',
  armor: 'UCA---',
  infantry: 'UCI---',
  armamentProduction: 'IMG---',
  fuelStorage: 'USS3--',
  oilPlatform: 'IUG---',
  powerPlant: 'IUE---',
  depot: 'IMV---',
  ammoDepot: 'IME---',
  commandCenter: 'UH1---',
  attack: 'MFA---',
  bomber: 'MFB---',
  aew: 'MFRW--',
  fighter: 'MFF---',
  waypoint: 'MGPI--',
  militaryBase: 'IB----',
  installation: 'I-----',
  transport: 'IT----',
  radar: 'ESR---',
  carrier: 'CLCV--',
  surfaceCombatant: 'CL----',
  amphibious: 'CLLL--',
  downedPilot: 'USS6--',
  hospital: 'IXH---',
  prison: 'UULC--',
  attackHelicopter: 'MHA---',
  csar: 'MHH---',
  supply: 'USS---',
  utilityHelicopter: 'MHU---'
}

type SidcUnitCodeKey = keyof typeof sidcUnitCode

function getUnitCode(item: z.infer<typeof schemas.MapItem>): SidcUnitCodeKey {
  switch (item.type) {
    case 'Structure': {
      switch (item.structureType) {
        case 'Fuel Storage':
          return 'fuelStorage'
        case 'Oil Platform':
          return 'oilPlatform'
        case 'Power Plant':
          return 'powerPlant'
        case 'Factory':
        case 'Factory 2':
          return 'armamentProduction'
        case 'Logistics Hub':
          return 'transport'
        case 'Depot':
          return 'depot'
        case 'Ammo Depot':
          return 'ammoDepot'
        case 'Hospital':
          return 'hospital'
        case 'Command Center':
          return 'commandCenter'
        case 'Prison':
          return 'prison'
        case 'Farp':
          return 'militaryBase'
        case 'Barrack':
          return 'transport'
        default:
          return 'installation'
      }
    }
    case 'Airdrome':
      return 'airport'
    case 'Flight Group': {
      switch (item.task) {
        case 'CAS':
        case 'Pinpoint Strike':
        case 'Strategic Strike':
          return 'bomber'
        case 'CSAR':
          return 'csar'
        default:
          return 'fighter'
      }
    }
    case 'Ground Group': {
      // The groundGroupType is one of 'SAM' | 'Vehicle' | 'Infantry' | 'Shorad Vehicle' | 'Shorad Infantry' | 'EWS'
      // We map these to SIDC codes
      switch (item.groundGroupType) {
        case 'Infantry':
        case 'Shorad Infantry':
          return 'infantry'
        case 'Vehicle':
        case 'Shorad Vehicle':
        case 'EWS':
        default:
          return 'armor'
      }
    }
    case 'Downed Pilot':
      return 'downedPilot'
    case 'Convoy':
      return item.kind === 'air' ? 'utilityHelicopter' : 'supply'
    case 'SAM':
      return 'airDefenceMissle'
    case 'EWR':
      return 'radar'
    case 'GCI':
      return 'commandCenter'
    case 'Naval Group':
      switch (item.role) {
        case 'carrier':
          return 'carrier'
        case 'transport':
          return 'amphibious'
        case 'escort':
        case 'surface-combatant':
          return 'surfaceCombatant'
      }
      return 'surfaceCombatant'
    default:
      return 'waypoint'
  }
}

function getDomain(item: z.infer<typeof schemas.MapItem>): 'air' | 'ground' | 'sea' {
  switch (item.type) {
    case 'Structure':
    case 'Airdrome':
    case 'SAM':
    case 'EWR':
    case 'GCI':
    case 'Downed Pilot':
    case 'Ground Group':
      return 'ground'
    case 'Flight Group':
      return 'air'
    case 'Convoy':
      return item.kind === 'air' ? 'air' : 'ground'
    case 'Naval Group':
      return 'sea'
    default:
      return 'sea'
  }
}

export function getMilSymbolCode(item: z.infer<typeof schemas.MapItem>): string {
  const hostileCode = item.coalition === 'opponent' ? 'H' : 'F'
  const domain = getDomain(item)
  const unitCode = getUnitCode(item)
  const domainCode = domain === 'air' ? 'A' : domain === 'sea' ? 'S' : 'G'
  return `S${hostileCode}${domainCode}-${sidcUnitCode[unitCode]}`
}
