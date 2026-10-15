import type { ImmersionKit } from './immersion'

/**
 * One object of the scene around the player's parked aircraft. Positions are relative to the real
 * airframe, read at runtime: `at` picks the reference along the fuselage (tail, nose or centre) and
 * `side` the lateral one (beyond the left or right wingtip, or from the centreline), so the same
 * scene fits a MiG-21 and a Su-27. Layout follows the stock DCS cold-start missions: ground power
 * and crew behind the tail, a work area beside the jet, nothing in front of the nose.
 */
export type RampProp = {
  type: string
  category: string
  shape?: string
  at: 'tail' | 'nose' | 'center'
  /** Metres forward (+) or aft (-) of `at`. */
  fwd: number
  side: 'left' | 'right' | 'center'
  /** Metres outward from the wingtip, or right (+) of the centreline for `center`. */
  out: number
  /** Heading relative to the aircraft, degrees. */
  rel: number
  /** Free space checked before placing, metres. */
  radius: number
  /** Only for cold starts (ground power, fuel bowser). */
  coldStartOnly?: boolean
  /** A soldier standing still as a live ground unit instead of a static figure. */
  soldier?: boolean
  /** `crew` follows the Ground crew toggle, `base` the Base life toggle. */
  layer: 'crew' | 'base'
}

type EraBand = 'early' | 'vietnam' | 'lateCw' | 'modern'

const fortification = (type: string, shape: string) => ({ type, category: 'Fortifications', shape })
const unarmed = (type: string) => ({ type, category: 'Unarmed' })

const CONE = fortification('Cone01', 'M92_Cone01')
const EXTINGUISHER = fortification('FireExtinguisher02', 'M92_FireExtinguisher02')
const TOOLBOX = fortification('Toolbox02', 'M92_Toolbox02')
const PLATFORM = fortification('ElevatedPlatform_down', 'M92_ElevatedPlatform_down')
const CRATE = fortification('Cargo05', 'M92_Cargo05')
const OIL_BARREL = fortification('Oil Barrel', 'M92_Oilbarrel')
const BARRIER = fortification('Barrier D', 'M92_BarrierD')
const AMMO = { type: 'ammo_cargo', category: 'Cargos', shape: 'ammo_box_cargo' }
const BARRELS = { type: 'barrels_cargo', category: 'Cargos', shape: 'barrels_cargo' }
/** The stock missions use the carrier deck crew as ramp crew; DCS has no other standing figures. */
const MECHANIC_A = {
  type: 'Carrier LSO Personell 4',
  category: 'Personnel',
  shape: 'carrier_lso4_usa'
}
const MECHANIC_B = {
  type: 'Carrier LSO Personell',
  category: 'Personnel',
  shape: 'carrier_lso_usa'
}

type Prop = { type: string; category: string; shape?: string }

type SideKit = {
  /** Ground power: a truck or cart parked beside the jet. */
  power: Prop
  /** Western ramps also keep a tug nearby. */
  tug?: Prop
  /** Fuel bowsers parked back after refuelling the jet. */
  fuel: Prop[]
  car: Prop
  guard: string
}

const GENERATOR = fortification('GeneratorF', 'GeneratorF')
const LADDER = fortification('Ladder', 'M92_Ladder')

function sideKit(kit: ImmersionKit, band: EraBand): SideKit {
  const early = band === 'early'
  if (kit === 'eastern') {
    return {
      power: early ? unarmed('GAZ-66') : unarmed('Ural-4320 APA-5D'),
      fuel: early
        ? []
        : band === 'vietnam'
          ? [unarmed('ATZ-5')]
          : [unarmed('ATZ-10'), unarmed('ATMZ-5')],
      car: unarmed(early ? 'GAZ-66' : 'UAZ-469'),
      guard: 'Infantry AK ver3'
    }
  }
  return {
    power: early ? unarmed('M 818') : fortification('AM32a-60_02', 'M92_AM32a-60_02'),
    tug: early ? undefined : fortification('TugHarlan', 'M92_TugHarlan'),
    fuel: band === 'lateCw' || band === 'modern' ? [unarmed('M978 HEMTT Tanker')] : [],
    car: unarmed(band === 'modern' || band === 'lateCw' ? 'Hummer' : 'Land_Rover_109_S3'),
    guard: 'Soldier M4 GRG'
  }
}

function place(
  prop: Prop,
  at: RampProp['at'],
  fwd: number,
  side: RampProp['side'],
  out: number,
  rel: number,
  radius: number,
  layer: RampProp['layer'],
  extra: Partial<RampProp> = {}
): RampProp {
  return { ...prop, at, fwd, side, out, rel, radius, layer, ...extra }
}

/**
 * Laid out like a real launch and the stock DCS missions: the crew chief and the fire guard (with
 * the extinguisher) on the left, the canopy side, ground power parked alongside on the right,
 * spare equipment and the fuel bowsers stood back behind the jet, nothing ahead of the nose or in
 * the exhaust.
 */
export function rampScene(kit: ImmersionKit, band: EraBand): RampProp[] {
  const side = sideKit(kit, band)
  const early = band === 'early'
  return [
    // Left side: crew chief by the toolbox, fire guard with the extinguisher, a work area.
    place(MECHANIC_A, 'center', 3.5, 'left', 1.5, 90, 1, 'crew'),
    place(TOOLBOX, 'center', 2, 'left', 3.5, 135, 1, 'crew'),
    place(MECHANIC_B, 'center', 5, 'left', 3, 110, 1, 'crew'),
    place(EXTINGUISHER, 'center', 5.5, 'left', 4.5, 150, 1, 'crew'),
    place(OIL_BARREL, 'center', -2, 'left', 3.5, 0, 1, 'crew'),
    place(PLATFORM, 'center', -1, 'left', 6.5, 90, 2, 'crew'),
    place(CRATE, 'center', -3.5, 'left', 5, 125, 1.5, 'crew'),
    // Right side: ground power alongside (cold starts), ammunition by the wing.
    place(side.power, 'center', -1, 'right', 5.5, 0, 4, 'crew', { coldStartOnly: true }),
    place(early ? BARRELS : AMMO, 'center', 4, 'right', 3, 90, 1.5, 'crew'),
    ...(side.tug ? [place(side.tug, 'tail', -4, 'right', 6, 0, 3, 'crew')] : []),
    // Cones at the wingtips, a later-era habit.
    ...(early
      ? []
      : [
          place(CONE, 'center', 0, 'left', 0.6, 0, 0.6, 'crew'),
          place(CONE, 'center', 0, 'right', 0.6, 0, 0.6, 'crew')
        ]),
    // Spare equipment stood back behind the jet, clear of the exhaust.
    place(GENERATOR, 'tail', -18, 'center', -9, 76, 2, 'crew'),
    place(LADDER, 'tail', -17, 'center', -6.5, 58, 1.5, 'crew'),
    place(EXTINGUISHER, 'tail', -16, 'center', -8, 144, 1, 'crew'),
    // Fuel bowsers parked back after refuelling.
    ...side.fuel.map((fuel, index) =>
      place(
        fuel,
        'tail',
        -26 + index * 3,
        'center',
        index === 0 ? -12 : 9,
        131 + index * 35,
        5,
        'crew'
      )
    ),
    // Guard post beside the spot: a barrier line, two soldiers on watch and their car.
    place(BARRIER, 'center', -2.5, 'right', 12, 90, 1.5, 'base'),
    place(BARRIER, 'center', 0, 'right', 12, 90, 1.5, 'base'),
    place(BARRIER, 'center', 2.5, 'right', 12, 90, 1.5, 'base'),
    place({ type: side.guard, category: 'Infantry' }, 'center', -1, 'right', 14, 90, 1, 'base', {
      soldier: true
    }),
    place({ type: side.guard, category: 'Infantry' }, 'center', 1.5, 'right', 14.5, 60, 1, 'base', {
      soldier: true
    }),
    place(side.car, 'tail', -8, 'right', 12, 30, 4, 'base')
  ]
}
