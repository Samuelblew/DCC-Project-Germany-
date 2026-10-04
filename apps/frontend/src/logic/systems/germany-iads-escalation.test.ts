import { describe, expect, test } from 'vitest'
import { campaignIadsEra, getGermanyIadsSites } from '@dcc/data'

describe('Germany IADS escalation ladder', () => {
  test('Korea fields S-60 AAA on the SA-2 and Hawk hills', () => {
    const sites = getGermanyIadsSites('Korea')
    const sa2 = sites.find((site) => site.id === 'SAM-SA2-1')
    const hawk = sites.find((site) => site.id === 'BSAM-HAWK-1')
    const patriot = sites.find((site) => site.id === 'BSAM-PATRIOT-1')

    expect(sa2?.kind).toBe('aaa')
    expect(sa2?.units.some((unit) => unit.type === 'S-60_Type59_Artillery')).toBe(true)
    expect(sa2?.units.some((unit) => unit.type === 'S_75M_Volhov')).toBe(false)
    expect(hawk?.kind).toBe('aaa')
    expect(hawk?.units.some((unit) => unit.type === 'S-60_Type59_Artillery')).toBe(true)
    expect(patriot).toBeUndefined()
  })

  test('Vietnam restores Hawk and SA-2 batteries and period search radars', () => {
    const sites = getGermanyIadsSites('Vietnam')
    const sa2 = sites.find((site) => site.id === 'SAM-SA2-1')
    const hawk = sites.find((site) => site.id === 'BSAM-HAWK-1')
    const ewr = sites.find((site) => site.id === 'EWR-1')
    const patriot = sites.find((site) => site.id === 'BSAM-PATRIOT-1')

    expect(sa2?.kind).toBe('sam')
    expect(sa2?.units.some((unit) => unit.type === 'S_75M_Volhov')).toBe(true)
    expect(hawk?.campaignType).toBe('Hawk')
    expect(ewr?.units[0]?.type).toBe('p-19 s-125 sr')
    expect(patriot).toBeUndefined()
  })

  test('Modern puts S-300 on the SA-2 hills and keeps the SA-6 belt', () => {
    const sites = getGermanyIadsSites('Modern')
    const sa2 = sites.find((site) => site.id === 'SAM-SA2-1')
    expect(sa2?.campaignType).toBe('SA-10-300')
    expect(sa2?.units.some((unit) => unit.type.startsWith('S-300PS'))).toBe(true)
    expect(sa2?.units.some((unit) => unit.type === 'S_75M_Volhov')).toBe(false)
    expect(sites.find((site) => site.id === 'SAM-SA6-1')?.campaignType).toBe('SA-6')
    expect(sites.find((site) => site.id === 'SAM-SA3-1')).toBeDefined()
    expect(sites.find((site) => site.id === 'BSAM-PATRIOT-1')?.kind).toBe('sam')
  })

  test('IADS follows Escalation stage even if campaign.era is Late CW', () => {
    const era = campaignIadsEra({
      era: 'Late CW',
      escalation: { enabled: true, stage: 'Korea' }
    })
    expect(era).toBe('Korea')
    expect(getGermanyIadsSites(era).find((site) => site.id === 'BSAM-PATRIOT-1')).toBeUndefined()
  })
})
