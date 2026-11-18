import type { AuthoredIadsSite } from './types'

/**
 * Every imported template is the Late Cold War set (1979–1991): Sentry Germany is dated 1985 and
 * the Caucasus template 1988. That era keeps the authored layout; the others re-equip it.
 */
export const DEFAULT_AUTHORED_IADS_ERA = 'Late CW'

export type IadsContentEra = 'WW2' | 'Korea' | 'Vietnam' | 'Late CW' | 'Modern'

const late: IadsContentEra[] = ['Late CW']
const lateModern: IadsContentEra[] = ['Late CW', 'Modern']
const vietnamLate: IadsContentEra[] = ['Vietnam', 'Late CW']
const vietnamOn: IadsContentEra[] = ['Vietnam', 'Late CW', 'Modern']
const koreaOn: IadsContentEra[] = ['Korea', 'Vietnam', 'Late CW', 'Modern']

const SAM_FAMILY_ERAS: Record<string, IadsContentEra[]> = {
  'BSAM-HAWK': vietnamOn,
  'BSAM-PATRIOT': lateModern,
  'BSAM-ROLAND': lateModern,
  'BSAM-RAPIER': lateModern,
  'BSAM-SHORAD': lateModern,
  'SAM-SA2': vietnamLate,
  'SAM-SA3': vietnamOn,
  'SAM-SA5': lateModern,
  'SAM-SA6': lateModern,
  'SAM-SA8': lateModern,
  // Caucasus 1988: Buk from 1980, S-300PS from 1985.
  'SAM-SA10': lateModern,
  'SAM-SA11': lateModern
}

/** Trucks do not decide the era of a battery that also has a weapon. */
const LOGISTICS = new Set(['KAMAZ Truck', 'M 818', 'M978 HEMTT Tanker', 'UAZ-469', 'Ural-4320T'])

const UNIT_ERAS: Record<string, IadsContentEra[]> = {
  '55G6 EWR': lateModern,
  '1L13 EWR': lateModern,
  'FPS-117': lateModern,
  'FPS-117 Dome': lateModern,
  'Roland Radar': lateModern,
  'Hawk sr': vietnamOn,
  'p-19 s-125 sr': vietnamLate,
  RLS_19J6: late,
  'ZSU-23-4 Shilka': vietnamOn,
  'S-60_Type59_Artillery': ['Korea', 'Vietnam', 'Late CW'],
  'Ural-375 ZU-23': vietnamOn,
  Vulcan: vietnamOn,
  'M48 Chaparral': lateModern,
  'Soldier stinger': lateModern,
  'MiG-15bis': ['Korea', 'Vietnam', 'Late CW'],
  'MiG-21Bis': vietnamLate,
  'MiG-23MLD': late,
  'MiG-25RBT': late,
  'MiG-27K': late,
  'MiG-29A': lateModern,
  'Su-17M4': late,
  'Su-24M': lateModern,
  'MiG-31': lateModern,
  'Tu-22M3': lateModern,
  'Tu-95MS': lateModern,
  'Su-25': lateModern,
  'Su-27': lateModern,
  'Mi-24P': lateModern,
  'Mi-8MT': vietnamOn,
  'A-10A': lateModern,
  'F-4E-45MC': vietnamLate,
  'F-15C': lateModern,
  'F-16C bl.50': lateModern,
  'F-16C bl.52d': lateModern,
  AV8BNA: lateModern,
  AJS37: lateModern,
  'Tornado IDS': lateModern,
  'UH-1H': vietnamLate,
  'UH-60A': lateModern,
  'AH-1W': lateModern,
  'CH-47D': vietnamOn,
  'CH-53E': lateModern,
  'C-130': koreaOn,
  'C-17A': lateModern,
  'L-39C': vietnamOn,
  SA342L: lateModern,
  'KAMAZ Truck': vietnamOn,
  'M 818': vietnamOn,
  'M978 HEMTT Tanker': vietnamOn,
  'UAZ-469': vietnamOn,
  'Ural-4320T': vietnamOn
}

function intersect(lists: IadsContentEra[][]) {
  const [first, ...rest] = lists
  if (!first) return late
  return rest.reduce((current, list) => current.filter((era) => list.includes(era)), first)
}

function erasForUnits(site: AuthoredIadsSite) {
  const weapons = site.units.filter((unit) => !LOGISTICS.has(unit.type))
  const types = (weapons.length > 0 ? weapons : site.units).map((unit) => unit.type)
  return intersect(types.map((type) => UNIT_ERAS[type] ?? late))
}

export function authoredSiteEras(site: AuthoredIadsSite): IadsContentEra[] {
  if (site.kind === 'hq') return ['Korea', 'Vietnam', 'Late CW', 'Modern']
  if (site.kind === 'sam') {
    const family = site.id.match(/^(BSAM-[A-Z]+|SAM-SA\d+)/)?.[1]
    return (family && SAM_FAMILY_ERAS[family]) || late
  }
  return erasForUnits(site)
}

export function authoredSiteMatchesEra(site: AuthoredIadsSite, era: string | undefined) {
  if (era == null || era === DEFAULT_AUTHORED_IADS_ERA) return true
  return authoredSiteEras(site).includes(era as IadsContentEra)
}

const KOREA_AAA_FAMILIES = new Set(['SAM-SA2', 'SAM-SA3', 'BSAM-HAWK'])
const KOREA_DORMANT_SAM_FAMILIES = new Set([
  'BSAM-PATRIOT',
  'BSAM-ROLAND',
  'BSAM-RAPIER',
  'BSAM-SHORAD',
  'SAM-SA5',
  'SAM-SA6',
  'SAM-SA8'
])
const MODERN_EWR_TYPES = new Set([
  '55G6 EWR',
  '1L13 EWR',
  'FPS-117',
  'FPS-117 Dome',
  'Roland Radar',
  'RLS_19J6'
])
const KOREA_AAA_TYPE = 'S-60_Type59_Artillery'
const VIETNAM_EWR_TYPE = 'p-19 s-125 sr'
/** DCS S-300PS battery. SA-2 hills become this in the final generation. */
const S300_BATTERY = [
  'S-300PS 40B6M tr',
  'S-300PS 64H6E sr',
  'S-300PS 54K6 cp',
  'S-300PS 5P85C ln',
  'S-300PS 5P85D ln',
  'S-300PS 5P85C ln',
  'S-300PS 5P85D ln',
  'S-300PS 5P85D ln'
]

export function authoredSamFamily(siteId: string) {
  return siteId.match(/^(BSAM-[A-Z]+|SAM-SA\d+)/)?.[1]
}

function convertSiteToKoreaAaa(site: AuthoredIadsSite): AuthoredIadsSite {
  return {
    ...site,
    kind: 'aaa',
    campaignType: undefined,
    range: undefined,
    units: site.units.map((unit) =>
      LOGISTICS.has(unit.type) ? unit : { ...unit, type: KOREA_AAA_TYPE }
    )
  }
}

function convertEwrToVietnamSearch(site: AuthoredIadsSite): AuthoredIadsSite {
  let changed = false
  const units = site.units.map((unit) => {
    if (!MODERN_EWR_TYPES.has(unit.type)) return unit
    changed = true
    return { ...unit, type: VIETNAM_EWR_TYPE }
  })
  return changed ? { ...site, units } : site
}

function resolveKoreaSite(site: AuthoredIadsSite): AuthoredIadsSite | null {
  if (site.kind === 'hq') return site
  if (site.kind === 'ewr') return null

  if (site.kind === 'sam') {
    const family = authoredSamFamily(site.id)
    if (family && KOREA_AAA_FAMILIES.has(family)) return convertSiteToKoreaAaa(site)
    if (family && KOREA_DORMANT_SAM_FAMILIES.has(family)) return null
    return authoredSiteMatchesEra(site, 'Korea') ? site : null
  }

  if (site.kind === 'aaa') {
    const hasS60 = site.units.some((unit) => unit.type === KOREA_AAA_TYPE)
    return hasS60 ? site : null
  }

  return authoredSiteMatchesEra(site, 'Korea') ? site : null
}

function resolveVietnamSite(site: AuthoredIadsSite): AuthoredIadsSite | null {
  if (site.kind === 'ewr') return convertEwrToVietnamSearch(site)
  return authoredSiteMatchesEra(site, 'Vietnam') ? site : null
}

function convertSiteToS300(site: AuthoredIadsSite): AuthoredIadsSite {
  return {
    ...site,
    kind: 'sam',
    campaignType: 'SA-10-300',
    range: 74_000,
    units: site.units.map((unit, index) => ({
      ...unit,
      type: S300_BATTERY[index % S300_BATTERY.length]!
    }))
  }
}

function resolveModernSite(site: AuthoredIadsSite): AuthoredIadsSite | null {
  if (site.kind === 'sam' && authoredSamFamily(site.id) === 'SAM-SA2') {
    return convertSiteToS300(site)
  }
  return authoredSiteMatchesEra(site, 'Modern') ? site : null
}

/** Same Sentry hill, era-specific battery. Late CW keeps the authored layout. */
export function resolveAuthoredIadsSiteForEra(
  site: AuthoredIadsSite,
  era: string | undefined
): AuthoredIadsSite | null {
  if (era == null || era === DEFAULT_AUTHORED_IADS_ERA) return site
  if (era === 'Korea') return resolveKoreaSite(site)
  if (era === 'Vietnam') return resolveVietnamSite(site)
  if (era === 'Modern') return resolveModernSite(site)
  return authoredSiteMatchesEra(site, era) ? site : null
}

export function authoredIadsEquipmentKey(site: AuthoredIadsSite, era: string | undefined) {
  const resolved = resolveAuthoredIadsSiteForEra(site, era)
  if (!resolved) return ''
  return `${resolved.kind}:${resolved.units
    .map((unit) => unit.type)
    .slice()
    .sort()
    .join(',')}`
}
