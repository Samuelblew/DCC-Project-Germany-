import { schemas } from '@dcc/contracts'
import * as z from 'zod'
export const buildings: Record<
  z.infer<typeof schemas.buildingType>,
  z.infer<typeof schemas.building>
> = {
  '.Command Center': {
    category: 'Fortifications',
    shapeName: 'ComCenter',
    type: '.Command Center'
  },
  'Electric power box': {
    category: 'Fortifications',
    shapeName: 'tr_budka',
    type: 'Electric power box'
  },
  'Garage B': {
    category: 'Fortifications',
    shapeName: 'garage_b',
    type: 'Garage B'
  },
  'Hangar A': {
    category: 'Fortifications',
    shapeName: 'angar_a',
    type: 'Hangar A'
  },
  'Tech hangar A': {
    category: 'Fortifications',
    shapeName: 'ceh_ang_a',
    type: 'Tech hangar A'
  },
  'Tech combine': {
    category: 'Fortifications',
    shapeName: 'kombinat',
    type: 'Tech combine'
  },
  'Repair workshop': {
    category: 'Fortifications',
    shapeName: 'tech',
    type: 'Repair workshop'
  },
  FARP: {
    category: 'Heliports',
    shapeName: 'FARPS',
    type: 'FARP'
  },
  'FARP Ammo Dump Coating': {
    category: 'Fortifications',
    shapeName: 'SetkaKP',
    type: 'FARP Ammo Dump Coating'
  },
  'FARP CP Blindage': {
    category: 'Fortifications',
    shapeName: 'kp_ug',
    type: 'FARP CP Blindage'
  },
  'FARP Fuel Depot': {
    category: 'Fortifications',
    shapeName: 'GSM Rus',
    type: 'FARP Fuel Depot'
  },
  'FARP Tent': {
    category: 'Fortifications',
    shapeName: 'PalatkaB',
    type: 'FARP Tent'
  },
  'Chemical tank A': {
    category: 'Fortifications',
    shapeName: 'him_bak_a',
    type: 'Chemical tank A'
  },
  'Oil rig': {
    category: 'Heliports',
    shapeName: 'oil_platform',
    type: 'Oil rig'
  },
  'Hangar B': {
    category: 'Fortifications',
    shapeName: 'angar_b',
    type: 'Hangar B'
  },
  Warehouse: {
    category: 'Warehouses',
    type: 'Warehouse',
    shapeName: 'sklad'
  },
  Tank: {
    category: 'Warehouses',
    type: 'Tank',
    shapeName: 'bak'
  },
  'Tank 2': {
    category: 'Warehouses',
    type: 'Tank 2',
    shapeName: 'airbase_tbilisi_tank_01'
  },
  'Container 20ft': {
    category: 'Cargos',
    type: 'Container 20ft',
    shapeName: 'container_20ft'
  },
  'Container 40ft': {
    category: 'Cargos',
    type: 'Container 40ft',
    shapeName: 'container_40ft'
  },
  'Workshop A': {
    category: 'Fortifications',
    shapeName: 'tec_a',
    type: 'Workshop A'
  },
  'Subsidiary structure 3': {
    category: 'Fortifications',
    type: 'Subsidiary structure 3',
    shapeName: 'hozdomik3'
  },
  'Subsidiary structure 2': {
    category: 'Fortifications',
    shapeName: 'hozdomik2',
    type: 'Subsidiary structure 2'
  },
  'Boiler-house A': {
    category: 'Fortifications',
    shapeName: 'kotelnaya_a',
    type: 'Boiler-house A'
  },
  'Military staff': {
    category: 'Fortifications',
    shapeName: 'aviashtab',
    type: 'Military staff'
  },
  'Small werehouse 2': {
    category: 'Fortifications',
    shapeName: 's2',
    type: 'Small werehouse 2'
  },
  'Small werehouse 3': {
    category: 'Fortifications',
    shapeName: 's3',
    type: 'Small werehouse 3'
  },
  'TV tower': {
    category: 'Fortifications',
    shapeName: 'tele_bash',
    type: 'TV tower'
  },
  'Railway station': {
    category: 'Fortifications',
    shapeName: 'r_vok_sd',
    type: 'Railway station'
  },
  FARP_SINGLE_01: {
    category: 'Heliports',
    shapeName: 'FARP_SINGLE_01',
    type: 'FARP_SINGLE_01'
  },
  outpost: {
    category: 'Fortifications',
    type: 'outpost',
    shapeName: undefined
  }
}
