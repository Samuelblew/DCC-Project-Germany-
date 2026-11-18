import { describe, expect, test } from 'vitest'
import {
  authoredIadsSitesForTheatre,
  authoredSiteFieldedBy,
  findAuthoredIadsSite,
  GERMANY_IADS_THEATRE,
  getAuthoredIadsSites,
  hasAuthoredIads,
  theatres
} from '@dcc/data'

describe('authored IADS registry', () => {
  test('only theatres with an imported template use authored sites', () => {
    expect(hasAuthoredIads(GERMANY_IADS_THEATRE)).toBe(true)
    expect(hasAuthoredIads('Syria')).toBe(false)
    expect(getAuthoredIadsSites('Syria', 'Late CW')).toEqual([])
  })

  test('site ids are unique across every theatre, so a target id finds one site', () => {
    const ids = theatres.flatMap((theatre) =>
      authoredIadsSitesForTheatre(theatre.name).map((site) => site.id)
    )
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every authored site belongs to an objective of its own theatre', () => {
    for (const theatre of theatres) {
      const objectiveNames = new Set(theatre.objectives.map((objective) => objective.name))
      for (const site of authoredIadsSitesForTheatre(theatre.name)) {
        expect(objectiveNames.has(site.objectiveId), `${theatre.name} ${site.id}`).toBe(true)
      }
    }
  })

  test('parked aircraft stay with the side that based them; air defence follows the owner', () => {
    expect(authoredSiteFieldedBy({ kind: 'airbase', coalition: 'opponent' }, 'opponent')).toBe(true)
    expect(authoredSiteFieldedBy({ kind: 'airbase', coalition: 'opponent' }, 'player')).toBe(false)
    expect(authoredSiteFieldedBy({ kind: 'sam', coalition: 'opponent' }, 'player')).toBe(true)
    expect(authoredSiteFieldedBy({ kind: 'ewr', coalition: 'opponent' }, 'player')).toBe(true)
  })

  test('a target id resolves to its authored site', () => {
    expect(findAuthoredIadsSite('BSAM-HAWK-1')?.campaignType).toBe('Hawk')
    expect(findAuthoredIadsSite('no-such-site')).toBeUndefined()
  })
})
