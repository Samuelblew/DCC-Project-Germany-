import { schemas } from '@dcc/contracts'
import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import { configureMissionCountries } from './index'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Mission = z.infer<typeof schemas.dcs.mission>

function createMission(): Mission {
  return {
    coalitions: {
      neutrals: [],
      blue: [2, 80],
      red: [0, 81]
    },
    coalition: {
      neutrals: { country: [] },
      blue: { country: [] },
      red: { country: [] }
    }
  } as unknown as Mission
}

function createCampaign(playerAircraftType: string, client = true): Campaign {
  const createCoalition = (id: string, capAircraftTypes: string[]) => ({
    id,
    aircraftTypes: { CAP: capAircraftTypes },
    flightGroups: [
      {
        task: 'CAP',
        aircrafts: [{ aircraftName: playerAircraftType, client }]
      }
    ]
  })

  return {
    coalitions: {
      player: createCoalition('usa-2004', ['F-16C_50']),
      opponent: {
        ...createCoalition('russia-1996', ['Su-27']),
        flightGroups: []
      }
    }
  } as unknown as Campaign
}

describe('configureMissionCountries', () => {
  test('uses the faction country for a client aircraft in the faction roster', () => {
    const mission = createMission()

    configureMissionCountries(mission, createCampaign('F-16C_50'))

    expect(mission.coalition.blue.country?.[0]).toMatchObject({ id: 2, name: 'USA' })
    expect(mission.coalition.red.country?.[0]).toMatchObject({ id: 0, name: 'Russia' })
  })

  test('uses the joint task force country for a custom client aircraft', () => {
    const mission = createMission()

    configureMissionCountries(mission, createCampaign('Su-27'))

    expect(mission.coalition.blue.country?.[0]).toMatchObject({ id: 80, name: 'CJTF Blue' })
    expect(mission.coalitions.blue.filter((countryId) => countryId === 80)).toHaveLength(1)
    expect(mission.coalition.red.country?.[0]).toMatchObject({ id: 0, name: 'Russia' })
  })

  test('does not treat an unselected AI aircraft as a custom mission aircraft', () => {
    const mission = createMission()

    configureMissionCountries(mission, createCampaign('Su-27', false))

    expect(mission.coalition.blue.country?.[0]).toMatchObject({ id: 2, name: 'USA' })
  })

  test('uses the country stored with a user-created faction', () => {
    const mission = createMission()
    const campaign = createCampaign('F-16C_50')
    campaign.coalitions.player.id = 'custom-task-force'
    campaign.coalitions.player.countryName = 'USA'

    configureMissionCountries(mission, campaign)

    expect(mission.coalition.blue.country?.[0]).toMatchObject({ id: 2, name: 'USA' })
  })

  test('uses the DCS Germany and GDR countries for the German factions', () => {
    const mission = createMission()
    const campaign = createCampaign('MiG-21Bis')
    campaign.coalitions.player.id = 'east-germany-1985'
    campaign.coalitions.player.aircraftTypes.CAP = ['MiG-21Bis']
    campaign.coalitions.opponent.id = 'west-germany-1985'

    configureMissionCountries(mission, campaign)

    expect(mission.coalition.blue.country?.[0]).toMatchObject({ id: 78, name: 'GDR' })
    expect(mission.coalition.red.country?.[0]).toMatchObject({ id: 6, name: 'Germany' })
    expect(mission.coalitions.blue).toContain(78)
    expect(mission.coalitions.red).toContain(6)
  })
})
