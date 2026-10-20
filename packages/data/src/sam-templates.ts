import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const samTemplates: Record<
  z.infer<typeof schemas.samType>,
  z.infer<typeof schemas.samTemplate>
> = {
  'SA-2': {
    units: [
      'SNR_75V',
      'S_75M_Volhov',
      'S_75M_Volhov',
      'S_75M_Volhov',
      'S_75M_Volhov',
      'S_75M_Volhov',
      'S_75M_Volhov',
      'ZIL-131 KUNG',
      'ZIL-131 KUNG',
      'p-19 s-125 sr'
    ],
    fireInterval: 60,
    range: 45_000
  },
  'SA-3': {
    units: [
      'snr s-125 tr',
      '5p73 s-125 ln',
      '5p73 s-125 ln',
      '5p73 s-125 ln',
      '5p73 s-125 ln',
      'p-19 s-125 sr',
      'ZIL-131 KUNG',
      'ZiL-131 APA-80',
      'GAZ-66',
      'GAZ-66',
      'GAZ-66',
      'ZiL-131 APA-80'
    ],
    fireInterval: 60,
    range: 25_000
  },
  'SA-5': {
    units: [
      'RPC_5N62V',
      'RLS_19J6',
      'S-200_Launcher',
      'S-200_Launcher',
      'S-200_Launcher',
      'S-200_Launcher',
      'S-200_Launcher',
      'S-200_Launcher',
      'S-200_Launcher',
      'S-200_Launcher',
      'S-200_Launcher',
      'S-200_Launcher',
      'ZiL-131 APA-80',
      'GAZ-66'
    ],
    fireInterval: 60,
    // S-200: about 240 km. It used to read 35.5 km, copied from the SA-6 entry.
    range: 240_000
  },
  'SA-6': {
    units: [
      'Kub 1S91 str',
      'Kub 2P25 ln',
      'Kub 2P25 ln',
      'Kub 2P25 ln',
      'Kub 2P25 ln',
      'ATZ-10',
      'ATZ-10',
      'ZiL-131 APA-80',
      'Ural-4320-31',
      'Ural-4320-31',
      'Ural-375 PBU'
    ],
    fireInterval: 60,
    range: 35_500
  },
  'SA-10-300': {
    units: [
      'S-300PS 40B6M tr',
      'S-300PS 40B6MD sr',
      'S-300PS 54K6 cp',
      'S-300PS 64H6E sr',
      'S-300PS 5P85C ln',
      'S-300PS 5P85D ln',
      'S-300PS 5P85D ln',
      'S-300PS 5P85C ln',
      'S-300PS 5P85D ln',
      'S-300PS 5P85D ln',
      'generator_5i57',
      'generator_5i57',
      'ATZ-5',
      'ATZ-5',
      'GAZ-66',
      'ATZ-60_Maz',
      'ATZ-60_Maz',
      'KAMAZ Truck'
    ],
    fireInterval: 60,
    range: 74_000
  },
  Hawk: {
    units: [
      'Hawk pcp',
      'Hawk sr',
      'Hawk cwar',
      'Hawk tr',
      'Hawk ln',
      'Hawk ln',
      'Hawk ln',
      'Hawk tr',
      'Hawk ln',
      'Hawk ln',
      'Hawk ln'
    ],
    fireInterval: 60,
    range: 47_400
  },
  Roland: {
    units: ['Roland Radar', 'Roland ADS', 'Roland ADS', 'Roland ADS'],
    fireInterval: 10,
    range: 8_000
  }
}

type SamState = {
  type: z.infer<typeof schemas.samType>
  destroyed?: boolean
  suppressed?: boolean
  deadUnitIndexes?: number[]
}

export function getSamDeadUnitIndexes(sam: SamState): Set<number> {
  return new Set(
    (sam.deadUnitIndexes ?? []).filter((index) => Number.isInteger(index) && index >= 0)
  )
}

export function isSamFullyDestroyed(sam: SamState): boolean {
  const template = samTemplates[sam.type]
  if (!template) return Boolean(sam.destroyed)

  if (sam.destroyed && (sam.deadUnitIndexes?.length ?? 0) === 0) return true

  const deadUnitIndexes = getSamDeadUnitIndexes(sam)
  return template.units.every((_, index) => deadUnitIndexes.has(index))
}

type SamComponentRole = 'launcher' | 'searchRadar' | 'trackRadar' | 'radar'

function getSamComponentRoles(unitName: string): Set<SamComponentRole> {
  const normalized = unitName.toLowerCase()
  const roles = new Set<SamComponentRole>()

  if (
    normalized.includes('launcher') ||
    normalized.includes('roland ads') ||
    normalized.includes('volhov') ||
    normalized.endsWith(' ln') ||
    normalized.includes(' ln ')
  ) {
    roles.add('launcher')
  }

  if (
    normalized.includes('roland radar') ||
    normalized.includes(' str') ||
    normalized.includes(' tr') ||
    normalized.includes('snr') ||
    normalized.includes('rpc') ||
    normalized.includes('cwar')
  ) {
    roles.add('trackRadar')
    roles.add('radar')
  }

  if (
    normalized.includes('roland radar') ||
    normalized.includes(' str') ||
    normalized.includes(' sr') ||
    normalized.includes('rls') ||
    normalized.includes('p-19') ||
    normalized.includes('64h6')
  ) {
    roles.add('searchRadar')
    roles.add('radar')
  }

  return roles
}

function isLauncherUnit(unitName: string): boolean {
  return getSamComponentRoles(unitName).has('launcher')
}

function everyComponentRoleDestroyed(
  template: z.infer<typeof schemas.samTemplate>,
  deadUnitIndexes: Set<number>,
  role: SamComponentRole
): boolean {
  const roleIndexes = template.units
    .map((unitName, index) => ({ roles: getSamComponentRoles(unitName), index }))
    .filter((unit) => unit.roles.has(role))
    .map((unit) => unit.index)

  return roleIndexes.length > 0 && roleIndexes.every((index) => deadUnitIndexes.has(index))
}

export function isSamHardwareCapable(sam: SamState): boolean {
  if (isSamFullyDestroyed(sam)) return false
  const template = samTemplates[sam.type]
  if (!template) return false

  const deadUnitIndexes = getSamDeadUnitIndexes(sam)
  if (
    everyComponentRoleDestroyed(template, deadUnitIndexes, 'searchRadar') ||
    everyComponentRoleDestroyed(template, deadUnitIndexes, 'trackRadar') ||
    everyComponentRoleDestroyed(template, deadUnitIndexes, 'radar')
  ) {
    return false
  }

  return template.units.some(
    (unitName, index) => !deadUnitIndexes.has(index) && isLauncherUnit(unitName)
  )
}

export function isSamOperational(sam: SamState): boolean {
  return !sam.suppressed && isSamHardwareCapable(sam)
}
