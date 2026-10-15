import { groundMarchKind } from '@dcc/campaign'
import { describe, expect, test } from 'vitest'

import { detachmentVehicleNames, planDetachment } from './detachment'

const koreaUsa = {
  Vehicle: ['M4_Sherman', 'M-113'],
  Infantry: ['Soldier M4'],
  'Shorad Vehicle': ['M1_37mm'],
  'Shorad Infantry': ['M45_Quadmount']
}
const koreaPact = {
  Infantry: ['Infantry AK'],
  Vehicle: ['T-55', 'PT_76'],
  'Shorad Vehicle': ['ZSU_57_2'],
  'Shorad Infantry': ['Ural-375 ZU-23']
}
const vietnamUsa = {
  Vehicle: ['M-113', 'M-60'],
  Infantry: ['Soldier M4'],
  'Shorad Vehicle': ['M1_37mm', 'Vulcan'],
  'Shorad Infantry': ['M45_Quadmount']
}
const vietnamPact = {
  Infantry: ['Infantry AK'],
  Vehicle: ['BMP-1', 'MTLB', 'T-55'],
  'Shorad Vehicle': ['ZSU-23-4 Shilka', 'ZSU_57_2'],
  'Shorad Infantry': ['Ural-375 ZU-23']
}
const lateUsa = vietnamUsa
const latePact = {
  Infantry: ['Infantry AK'],
  Vehicle: ['T-72B', 'T-55', 'BMP-1', 'BMP-2', 'MTLB'],
  'Shorad Vehicle': ['ZSU-23-4 Shilka', 'Strela-1 9P31', 'Osa 9A33 ln'],
  'Shorad Infantry': ['Ural-375 ZU-23']
}
const modernUsa = {
  Vehicle: ['M-2 Bradley', 'M-1 Abrams', 'M1126 Stryker ICV'],
  Infantry: ['Soldier M4'],
  'Shorad Vehicle': ['Vulcan', 'M6 Linebacker'],
  'Shorad Infantry': ['Soldier stinger']
}
const modernPact = {
  Infantry: ['Infantry AK'],
  Vehicle: ['BMP-2', 'BMP-3', 'T-90'],
  'Shorad Vehicle': ['ZSU-23-4 Shilka', 'Ural-375 ZU-23', 'Osa 9A33 ln', '2S6 Tunguska', 'Tor 9A331'],
  'Shorad Infantry': ['SA-18 Igla manpad']
}

const origin = { x: 0, y: 0 }

function names(types: Parameters<typeof planDetachment>[0]['groundUnitTypes'], withVehicles = true) {
  return planDetachment({
    groundUnitTypes: types,
    origin,
    heading: 0,
    withVehicles,
    withInfantry: true
  }).map((unit) => unit.name)
}

function unique(list: string[]) {
  return [...new Set(list)]
}

describe('era detachments', () => {
  test('Korea rides an M113 and a Sherman, with the quad .50', () => {
    const picked = unique(names(koreaUsa))
    expect(picked).toEqual(['M4_Sherman', 'M-113', 'M45_Quadmount', 'Soldier M4'])
    expect(names(koreaUsa).filter((name) => name === 'Soldier M4')).toHaveLength(8)
  })

  test('Korea pact has a tank and a gun, and the squad walks', () => {
    const units = planDetachment({
      groundUnitTypes: koreaPact,
      origin,
      heading: 0,
      withVehicles: true,
      withInfantry: true
    })
    expect(unique(units.map((unit) => unit.name))).toEqual(['T-55', 'ZSU_57_2', 'Infantry AK'])
    expect(groundMarchKind(units)).toBe('foot')
  })

  test('Vietnam US is Patton, M113 and Vulcan', () => {
    expect(unique(names(vietnamUsa))).toEqual(['M-60', 'M-113', 'Vulcan', 'Soldier M4'])
    expect(groundMarchKind(names(vietnamUsa).map((name) => ({ name })))).toBe('mounted')
  })

  test('Vietnam pact rides BMP-1 behind a T-55', () => {
    expect(unique(names(vietnamPact))).toEqual([
      'T-55',
      'BMP-1',
      'ZSU-23-4 Shilka',
      'Infantry AK'
    ])
  })

  test('Late Cold War uses the kit that faction actually owns', () => {
    expect(unique(names(lateUsa))).toEqual(['M-60', 'M-113', 'Vulcan', 'Soldier M4'])
    expect(unique(names(latePact))).toEqual([
      'T-72B',
      'BMP-2',
      'ZSU-23-4 Shilka',
      'Infantry AK'
    ])
  })

  test('Modern is Abrams and Bradley, or T-90 and BMP-3', () => {
    expect(unique(names(modernUsa))).toEqual([
      'M-1 Abrams',
      'M-2 Bradley',
      'M6 Linebacker',
      'Soldier M4'
    ])
    expect(unique(names(modernPact))).toEqual([
      'T-90',
      'BMP-3',
      '2S6 Tunguska',
      'Infantry AK'
    ])
  })

  test('without a depot the squad still leaves, on foot, with a light gun', () => {
    const units = planDetachment({
      groundUnitTypes: koreaUsa,
      origin,
      heading: Math.PI / 2,
      withVehicles: false,
      withInfantry: true
    })
    expect(unique(units.map((unit) => unit.name))).toEqual(['M45_Quadmount', 'Soldier M4'])
    expect(detachmentVehicleNames(units)).toEqual([])
    expect(groundMarchKind(units)).toBe('foot')
    expect(units[0]?.position.y).not.toBe(units[1]?.position.y)
  })

  test('a depot on its own does not invent infantry', () => {
    const units = planDetachment({
      groundUnitTypes: { Infantry: ['Infantry AK'], Vehicle: ['BMP-2'] },
      origin,
      heading: 0,
      withVehicles: true,
      withInfantry: false
    })
    expect(units.map((unit) => unit.name)).toEqual(['BMP-2'])
    expect(groundMarchKind(units)).toBe('mounted')
  })
})
