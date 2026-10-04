import { afterEach, describe, expect, test, vi } from 'vitest'
import { schemas } from '@dcc/contracts'
import {
  aircraftProfiles,
  careerAircraft,
  careerRewards,
  careerTaskRewards,
  getAcquirableCareerAircraft,
  getCareerAircraft,
  theatres
} from '@dcc/data'
import { produce } from 'immer'
import type * as z from 'zod'

import {
  abortCareerSortie,
  buyAirframe,
  claimCareerMission,
  deleteCareerMission,
  fitRouteToWaypointLimit,
  createInitialCareer,
  getArmedFailures,
  getCareerLoadouts,
  getCareerRadioPlan,
  getKillReward,
  getLoadoutShortfall,
  getPurchasableAircraft,
  getReadyAirframes,
  getReplacementAircraft,
  getResaleValue,
  getTaskReward,
  isFlownByEnemy,
  isLoadoutValid,
  launchCareerSortie,
  releaseBareCareerSlots,
  saveCareerPreset,
  sellAirframe,
  setCareerRadioPlan,
  settleCareerSortie,
  updateCareer
} from './career'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']
type MissionState = z.infer<typeof schemas.missionState>

const MIG = 'MiG-29 Fulcrum'
const mig29 = getCareerAircraft(MIG)!
const germany = theatres.find((theatre) => theatre.name === 'Cold War Germany')!
const time = new Date('1985-06-15T09:00:00.000Z')
const R73 = '{MISSILE_R-73_APU-73}'
const R27R = '{MISSILE_R-27R_APU-470}'
const A2A_LOADOUT = 'a2a-r27r'

afterEach(() => {
  vi.restoreAllMocks()
})

function capTypes(...types: string[]) {
  return { CAP: types } as CoalitionData['aircraftTypes']
}

function coalition(id: 'player' | 'opponent', airdromeNames: string[]): CoalitionData {
  return {
    id,
    aircraftTypes: {} as CoalitionData['aircraftTypes'],
    groundUnitTypes: {} as CoalitionData['groundUnitTypes'],
    airdromeNames,
    objectiveIds: [],
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: []
  }
}

function careerCampaign(): Campaign {
  const campaign: Campaign = {
    version: 'test',
    id: 'career',
    name: 'Career',
    createdAt: time,
    updatedAt: time,
    time,
    timeMultiplier: 1,
    logs: [],
    scenarioId: 'fulda-gap',
    mode: 'career',
    coalitions: {
      player: coalition('player', ['Cochstedt', 'Laage']),
      opponent: coalition('opponent', ['Fulda'])
    }
  }
  campaign.coalitions.player.aircraftTypes = capTypes('MiG-29A', 'Su-27')
  campaign.coalitions.opponent.aircraftTypes = capTypes('F-16C_50')
  campaign.career = createInitialCareer({ aircraft: mig29, location: 'Cochstedt', time })
  campaign.coalitions.player.flightGroups.push({
    id: 'cap-1',
    aircrafts: [{ id: 'a1', unitName: 'Enfield-1', aircraftName: 'MiG-29 Fulcrum' }],
    task: 'CAP',
    position: { x: 0, y: 0 },
    homeBase: 'Cochstedt',
    callsign: 'Enfield-1',
    flightplan: { id: 'plan', startTime: time, waypoints: [] }
  })
  return campaign
}

function missionState(overrides: Partial<MissionState> = {}): MissionState {
  return {
    missionId: 'mission',
    ejectedPilots: [],
    troopExtractions: [],
    casevacPickups: [],
    lostUnits: [],
    landedUnits: [],
    cargoDeliveries: {},
    ...overrides
  }
}

const cochstedt = germany.airdromeDetails['Cochstedt']!
const laage = germany.airdromeDetails['Laage']!

describe('career purchases', () => {
  test('starts with one new aircraft, starting funds and a stock of stores', () => {
    const career = createInitialCareer({ aircraft: mig29, location: 'Cochstedt', time })

    expect(career.money).toBe(40)
    expect(career.airframes).toEqual([
      expect.objectContaining({ condition: 'new', integrity: 1, location: 'Cochstedt' })
    ])
    expect(career.inventory[MIG]![R73]).toBe(8)
  })

  test('a used aircraft is cheaper, worn, and comes with hidden minor defects', () => {
    const campaign = careerCampaign()
    const career = campaign.career!
    career.money = 200

    expect(buyAirframe(campaign, germany, mig29, 'used')).toEqual({ ok: true })

    const used = career.airframes[1]!
    expect(used.integrity).toBeGreaterThanOrEqual(0.6)
    expect(used.integrity).toBeLessThanOrEqual(0.9)
    expect(used.hiddenDefects.length).toBeGreaterThanOrEqual(1)
    const minorIds = new Set(mig29.minorFailures.map((failure) => failure.id))
    expect(used.hiddenDefects.every((failure) => minorIds.has(failure.id))).toBe(true)
    expect(career.money).toBeLessThanOrEqual(200 - 55)
  })

  test('refuses a purchase the player cannot afford and leaves the career unchanged', () => {
    const campaign = careerCampaign()
    const career = campaign.career!

    expect(buyAirframe(campaign, germany, mig29, 'new').ok).toBe(false)
    expect(career.airframes).toHaveLength(1)
    expect(career.nextTailNumber).toBe(2)
  })

  test('unrepaired damage arms one more minor failure per 15 points lost', () => {
    const career = createInitialCareer({ aircraft: mig29, location: 'Cochstedt', time })
    const airframe = career.airframes[0]!
    airframe.integrity = 0.7

    expect(getArmedFailures(mig29, airframe)).toHaveLength(2)
  })
})

describe('career sorties', () => {
  function crewedCampaign() {
    const campaign = careerCampaign()
    const career = campaign.career!
    career.money = 200
    buyAirframe(campaign, germany, mig29, 'new')
    Object.assign(career.airframes[1]!, { status: 'ready', location: 'Cochstedt' })
    career.inventory[MIG]![R27R] = 4
    career.pilots.push({
      id: 'p1',
      name: 'Volkov',
      skill: 'Excellent',
      status: 'available',
      hiredAt: time
    })
    const result = launchCareerSortie(campaign, {
      flightGroupId: 'cap-1',
      loadoutId: A2A_LOADOUT,
      playerAirframeId: career.airframes[0]!.id,
      wingmen: [{ airframeId: career.airframes[1]!.id, pilotId: 'p1' }]
    })
    expect(result).toEqual({ ok: true })
    return campaign
  }

  test('crews the flight with owned aircraft and takes the stores from stock', () => {
    const campaign = crewedCampaign()
    const group = campaign.coalitions.player.flightGroups[0]!

    expect(group.aircrafts).toHaveLength(2)
    expect(group.aircrafts[0]).toMatchObject({ client: true, unitName: 'Enfield-1-1' })
    expect(group.aircrafts[1]).toMatchObject({ client: false, skill: 'Excellent' })
    expect(group.aircrafts[1]?.failures).toBeUndefined()
    expect(group.aircrafts[0]?.pylons).toHaveLength(7)
    expect(campaign.career!.inventory[MIG]![R73]).toBe(0)
    expect(campaign.career!.inventory[MIG]![R27R]).toBe(0)
    expect(campaign.career!.airframes.every((a) => a.status === 'flying')).toBe(true)
  })

  test('refuses a loadout the stock cannot cover', () => {
    const campaign = careerCampaign()
    campaign.career!.inventory = {}

    const result = launchCareerSortie(campaign, {
      flightGroupId: 'cap-1',
      loadoutId: A2A_LOADOUT,
      playerAirframeId: campaign.career!.airframes[0]!.id,
      wingmen: []
    })

    expect(result.ok).toBe(false)
    expect(campaign.career!.sortie).toBeUndefined()
  })

  test('pays for kills and a safe return, moves the aircraft where it landed, and returns stores', () => {
    const campaign = crewedCampaign()
    const moneyBefore = campaign.career!.money
    const lines = settleCareerSortie(
      campaign,
      missionState({
        lostUnits: [
          {
            name: 'Bandit-1',
            type: 'F-16C_50',
            categoryName: 'plane',
            coalition: 'red',
            killerUnitName: 'Enfield-1-1',
            x: 0,
            y: 0
          }
        ],
        landedUnits: [
          {
            name: 'Enfield-1-1',
            type: 'MiG-29 Fulcrum',
            time: 100,
            life: 40,
            life0: 50,
            ammo: [
              { typeName: 'weapons.missiles.R_73', displayName: 'R-73', count: 3 },
              { typeName: 'weapons.missiles.R_27R', displayName: 'R-27R', count: 2 }
            ],
            x: laage.x,
            y: laage.y
          },
          {
            name: 'Enfield-1-2',
            type: 'MiG-29 Fulcrum',
            time: 120,
            life: 50,
            life0: 50,
            ammo: [],
            x: cochstedt.x,
            y: cochstedt.y
          }
        ]
      }),
      germany,
      { taskCompleted: false }
    )

    const career = campaign.career!
    expect(career.money).toBe(moneyBefore + 25 + 6)
    expect(career.airframes[0]).toMatchObject({
      location: 'Laage',
      status: 'ready',
      integrity: 0.8
    })
    expect(career.airframes[1]).toMatchObject({ location: 'Cochstedt', status: 'ready' })
    expect(career.inventory[MIG]![R73]).toBe(3)
    expect(career.inventory[MIG]![R27R]).toBe(2)
    expect(career.pilots[0]?.status).toBe('available')
    expect(career.sortie).toBeUndefined()
    expect(lines).toContain('+25 kill: F-16C_50')
  })

  test('leaving the slot after landing is not a loss', () => {
    const campaign = crewedCampaign()

    settleCareerSortie(
      campaign,
      missionState({
        lostUnits: [
          {
            name: 'Enfield-1-1',
            type: 'MiG-29 Fulcrum',
            event: 'unit_lost',
            lossType: 'lost',
            time: 300,
            x: 0,
            y: 0
          }
        ],
        landedUnits: [
          {
            name: 'Enfield-1-1',
            type: 'MiG-29 Fulcrum',
            time: 200,
            ammo: [],
            x: cochstedt.x,
            y: cochstedt.y
          }
        ]
      }),
      germany,
      { taskCompleted: false }
    )

    expect(campaign.career!.airframes[0]?.status).toBe('ready')
  })

  test('a shot-down wingman costs the aircraft and, if he did not eject, the pilot', () => {
    const campaign = crewedCampaign()

    settleCareerSortie(
      campaign,
      missionState({
        lostUnits: [
          {
            name: 'Enfield-1-2',
            type: 'MiG-29 Fulcrum',
            event: 'dead',
            lossType: 'destroyed',
            x: 0,
            y: 0
          }
        ]
      }),
      germany,
      { taskCompleted: false }
    )

    const career = campaign.career!
    expect(career.airframes[1]?.status).toBe('destroyed')
    expect(career.pilots[0]?.status).toBe('dead')
  })
})

describe('career upkeep', () => {
  test('aircraft parked at an airfield the enemy took are lost', () => {
    const campaign = careerCampaign()
    campaign.coalitions.player.airdromeNames = ['Laage']

    updateCareer(campaign, germany)

    expect(campaign.career!.airframes[0]?.status).toBe('destroyed')
  })

  test('a broke, grounded player gets a free used aircraft after 24 campaign hours', () => {
    const campaign = careerCampaign()
    campaign.career!.airframes[0]!.status = 'destroyed'
    campaign.career!.money = 10

    updateCareer(campaign, germany)
    expect(campaign.career!.replacementAvailableAt).toEqual(
      new Date(time.getTime() + 24 * 3_600_000)
    )

    campaign.time = new Date(time.getTime() + 24 * 3_600_000)
    updateCareer(campaign, germany)

    const replacement = campaign.career!.airframes[1]
    expect(replacement).toMatchObject({ condition: 'used', status: 'ready' })
    expect(campaign.career!.replacementAvailableAt).toBeUndefined()
    expect(campaign.career!.money).toBe(10)
  })
})

describe('career presets', () => {
  test('every built-in loadout respects the module station rules', () => {
    for (const loadout of mig29.loadouts) {
      expect(isLoadoutValid(mig29, loadout.pylons), loadout.id).toBe(true)
    }
  })

  test('refuses a store on a station that cannot carry it', () => {
    const career = createInitialCareer({ aircraft: mig29, location: 'Cochstedt', time })

    const result = saveCareerPreset(career, mig29, {
      name: 'R-27 on the tips',
      pylons: [{ num: 1, CLSID: R27R }]
    })

    expect(result.ok).toBe(false)
    expect(career.presets).toHaveLength(0)
  })

  test('flies a player preset and takes exactly its stores from stock', () => {
    const campaign = careerCampaign()
    const career = campaign.career!
    expect(
      saveCareerPreset(career, mig29, {
        name: 'Light CAP',
        pylons: [
          { num: 1, CLSID: R73 },
          { num: 7, CLSID: R73 },
          { num: 3, CLSID: R27R }
        ]
      })
    ).toEqual({ ok: true })
    const preset = career.presets[0]!

    const result = launchCareerSortie(campaign, {
      flightGroupId: 'cap-1',
      loadoutId: preset.id,
      playerAirframeId: career.airframes[0]!.id,
      wingmen: []
    })

    expect(result).toEqual({ ok: true })
    expect(career.inventory[MIG]![R73]).toBe(6)
    expect(career.inventory[MIG]![R27R]).toBe(1)
    expect(campaign.coalitions.player.flightGroups[0]?.aircrafts[0]?.pylons).toHaveLength(3)
  })
})

describe('career missions on the board', () => {
  const route = [
    'TakeOff',
    'Ascend',
    'Contact',
    'Target',
    'Hold',
    'Egress',
    'Descent',
    'Landing'
  ].map((name, index, names) => ({
    name,
    position: { x: index * 1000, y: 0 },
    altitude: 5000,
    speed: 220,
    type:
      index === 0
        ? ('TakeOff' as const)
        : index === names.length - 1
          ? ('Landing' as const)
          : name === 'Ascend' || name === 'Descent'
            ? ('Nav' as const)
            : ('Task' as const)
  }))

  test.each(
    aircraftProfiles
      .filter((profile) => profile.maxRouteWaypoints != null)
      .map((profile) => [profile.aircraftName, profile.maxRouteWaypoints!] as const)
  )('a full generated route fits the %s navigation system', (_name, limit) => {
    expect(fitRouteToWaypointLimit(route, limit).length).toBeLessThanOrEqual(limit)
  })

  test('thins a route to the six points the MiG-29 holds, dropping climb and descent first', () => {
    const fitted = fitRouteToWaypointLimit(route, 6)

    expect(fitted.map((waypoint) => waypoint.name)).toEqual([
      'TakeOff',
      'Contact',
      'Target',
      'Hold',
      'Egress',
      'Landing'
    ])
  })

  test('standing a sortie down puts the generated flight back exactly as planned', () => {
    const campaign = careerCampaign()
    const group = campaign.coalitions.player.flightGroups[0]!
    group.aircrafts.push({ id: 'a2', unitName: 'Enfield-2', aircraftName: 'MiG-29 Fulcrum' })
    group.flightplan.waypoints = structuredClone(route)
    const before = structuredClone(group)

    launchCareerSortie(campaign, {
      flightGroupId: 'cap-1',
      loadoutId: A2A_LOADOUT,
      playerAirframeId: campaign.career!.airframes[0]!.id,
      wingmen: []
    })
    expect(group.flightplan.waypoints).toHaveLength(6)

    abortCareerSortie(campaign)

    expect(group.aircrafts).toEqual(before.aircrafts)
    expect(group.flightplan.waypoints).toEqual(before.flightplan.waypoints)
    expect(campaign.career!.inventory[MIG]![R73]).toBe(8)
    expect(campaign.career!.airframes[0]?.status).toBe('ready')
  })

  test('your own mission waits on the ground and leaves as soon as it is crewed', () => {
    const campaign = careerCampaign()
    const group = campaign.coalitions.player.flightGroups[0]!
    claimCareerMission(campaign, group.id)
    expect(group.aircrafts).toHaveLength(1)

    // Hours pass without a crew: the mission is still there, its takeoff just ahead of the clock.
    campaign.time = new Date(time.getTime() + 3 * 3_600_000)
    updateCareer(campaign, germany)
    expect(campaign.coalitions.player.flightGroups).toHaveLength(1)
    expect(group.flightplan.startTime).toEqual(new Date(campaign.time.getTime() + 20 * 60_000))

    launchCareerSortie(campaign, {
      flightGroupId: group.id,
      loadoutId: A2A_LOADOUT,
      playerAirframeId: campaign.career!.airframes[0]!.id,
      wingmen: []
    })
    expect(group.flightplan.startTime).toEqual(campaign.time)
  })

  test('deleting your own crewed mission returns its stores and removes it from the board', () => {
    const campaign = careerCampaign()
    claimCareerMission(campaign, 'cap-1')
    launchCareerSortie(campaign, {
      flightGroupId: 'cap-1',
      loadoutId: A2A_LOADOUT,
      playerAirframeId: campaign.career!.airframes[0]!.id,
      wingmen: []
    })

    expect(deleteCareerMission(campaign, 'cap-1')).toEqual({ ok: true })

    expect(campaign.coalitions.player.flightGroups).toHaveLength(0)
    expect(campaign.career!.sortie).toBeUndefined()
    expect(campaign.career!.inventory[MIG]![R73]).toBe(8)
  })

  test('generated missions cannot be deleted from the career screen', () => {
    const campaign = careerCampaign()

    expect(deleteCareerMission(campaign, 'cap-1').ok).toBe(false)
    expect(campaign.coalitions.player.flightGroups).toHaveLength(1)
  })
})

describe('career slot discipline', () => {
  test('a player slot set outside a sortie is released, a crewed sortie keeps its slot', () => {
    const campaign = careerCampaign()
    const group = campaign.coalitions.player.flightGroups[0]!
    group.aircrafts[0]!.client = true

    releaseBareCareerSlots(campaign)
    expect(group.aircrafts[0]?.client).toBe(false)

    launchCareerSortie(campaign, {
      flightGroupId: 'cap-1',
      loadoutId: A2A_LOADOUT,
      playerAirframeId: campaign.career!.airframes[0]!.id,
      wingmen: []
    })
    releaseBareCareerSlots(campaign)
    expect(group.aircrafts[0]?.client).toBe(true)
  })
})

describe('career actions inside the store', () => {
  // The store runs every career action on an immer draft; plain-object tests alone missed a
  // structuredClone that throws on drafts and silently cancelled every sortie.
  test('crewing and standing down work on an immer draft', () => {
    const campaign = careerCampaign()

    const crewed = produce(campaign, (draft) => {
      const result = launchCareerSortie(draft, {
        flightGroupId: 'cap-1',
        loadoutId: A2A_LOADOUT,
        playerAirframeId: draft.career!.airframes[0]!.id,
        wingmen: []
      })
      expect(result).toEqual({ ok: true })
    })
    expect(crewed.career!.sortie).toBeDefined()

    const stoodDown = produce(crewed, (draft) => abortCareerSortie(draft))
    expect(stoodDown.coalitions.player.flightGroups[0]?.aircrafts).toEqual(
      campaign.coalitions.player.flightGroups[0]?.aircrafts
    )
  })
})

describe('career radio', () => {
  test('rejects a manual frequency the R-862 cannot tune', () => {
    const career = createInitialCareer({ aircraft: mig29, location: 'Cochstedt', time })
    const plan = getCareerRadioPlan(career, mig29)!
    plan.comms[0]![5] = { kind: 'manual', mhz: 180 }

    expect(setCareerRadioPlan(career, mig29, plan).ok).toBe(false)
    expect(career.radios[MIG]).toBeUndefined()
  })

  test('loads the saved presets into the player aircraft on every sortie', () => {
    const campaign = careerCampaign()
    const plan = getCareerRadioPlan(campaign.career!, mig29)!
    plan.comms[0]![4] = { kind: 'tower', airfield: 'Laage', band: 'uhf' }
    expect(setCareerRadioPlan(campaign.career!, mig29, plan)).toEqual({ ok: true })

    launchCareerSortie(campaign, {
      flightGroupId: 'cap-1',
      loadoutId: A2A_LOADOUT,
      playerAirframeId: campaign.career!.airframes[0]!.id,
      wingmen: []
    })

    const player = campaign.coalitions.player.flightGroups[0]!.aircrafts[0]!
    expect(player.radioPlan?.comms[0]?.[4]).toEqual({
      kind: 'tower',
      airfield: 'Laage',
      band: 'uhf'
    })
    expect(player.radioPlan?.comms[0]).toHaveLength(20)
  })

  test('plans saved with one flat comms list load as the first comms radio', () => {
    const flat = {
      comms: [{ kind: 'flight' }, { kind: 'tower', airfield: 'Laage', band: 'vhf' }],
      adf: [{ kind: 'home', approach: 0 }]
    }

    expect(schemas.radioPlan.parse(flat)).toEqual({
      comms: [[{ kind: 'flight' }, { kind: 'tower', airfield: 'Laage', band: 'vhf' }]],
      adf: [{ kind: 'home', approach: 0 }]
    })
  })
})

describe('careers with several aircraft types', () => {
  test('a new career records its type, the fidelity rule and that type as the stock owner', () => {
    const career = createInitialCareer({ aircraft: mig29, location: 'Cochstedt', time })

    expect(career.preferredAircraft).toBe(MIG)
    expect(career.acquisitionRule).toBe('fidelity')
    expect(Object.keys(career.inventory)).toEqual([MIG])
  })

  test('stock of another type does not arm this one', () => {
    const career = createInitialCareer({ aircraft: mig29, location: 'Cochstedt', time })
    career.inventory = { 'Su-27': { [R73]: 8, [R27R]: 2 } }

    const loadout = mig29.loadouts.find((entry) => entry.id === A2A_LOADOUT)!
    expect(getLoadoutShortfall(career, mig29, loadout, 1)).toHaveLength(2)
  })

  test('presets only show up for the type they were built for', () => {
    const career = createInitialCareer({ aircraft: mig29, location: 'Cochstedt', time })
    career.presets.push({
      id: 'preset-flanker',
      aircraftName: 'Su-27',
      name: 'Flanker CAP',
      pylons: [{ num: 1, CLSID: R73 }]
    })
    expect(saveCareerPreset(career, mig29, { name: 'Fulcrum CAP', pylons: [] })).toEqual({
      ok: true
    })

    const names = getCareerLoadouts(career, mig29).map((entry) => entry.name)
    expect(names).toContain('Fulcrum CAP')
    expect(names).not.toContain('Flanker CAP')
  })

  test('a flight flies one type: a wingman in another type is refused', () => {
    const campaign = careerCampaign()
    const career = campaign.career!
    career.airframes.push({
      ...career.airframes[0]!,
      id: 'flanker',
      tailNumber: '02',
      aircraftName: 'Su-27'
    })
    career.pilots.push({
      id: 'p1',
      name: 'Volkov',
      skill: 'Good',
      status: 'available',
      hiredAt: time
    })

    const result = launchCareerSortie(campaign, {
      flightGroupId: 'cap-1',
      loadoutId: A2A_LOADOUT,
      playerAirframeId: career.airframes[0]!.id,
      wingmen: [{ airframeId: 'flanker', pilotId: 'p1' }]
    })

    expect(result.ok).toBe(false)
    expect(career.sortie).toBeUndefined()
  })

  test('a sortie remembers its type and returns unused stores to that type', () => {
    const campaign = careerCampaign()
    launchCareerSortie(campaign, {
      flightGroupId: 'cap-1',
      loadoutId: A2A_LOADOUT,
      playerAirframeId: campaign.career!.airframes[0]!.id,
      wingmen: []
    })
    expect(campaign.career!.sortie?.aircraftName).toBe(MIG)

    abortCareerSortie(campaign)
    expect(campaign.career!.inventory[MIG]![R73]).toBe(8)
  })

  test('the free replacement is of the type lost last', () => {
    const career = createInitialCareer({ aircraft: mig29, location: 'Cochstedt', time })
    career.airframes[0]!.status = 'destroyed'

    expect(getReplacementAircraft(career)?.aircraftName).toBe(MIG)
  })
})

describe('careers saved before several aircraft types', () => {
  test('migrate the single type, stock, radio, presets and sortie to that type', () => {
    const plan = getCareerRadioPlan(
      createInitialCareer({ aircraft: mig29, location: 'Cochstedt', time }),
      mig29
    )!
    const legacyRadio = { comms: plan.comms[0], adf: plan.adf }
    const legacy = {
      aircraftName: MIG,
      money: 75,
      airframes: [],
      pilots: [],
      inventory: { [R73]: 6, [R27R]: 1 },
      presets: [{ id: 'preset-1', name: 'Light CAP', pylons: [{ num: 1, CLSID: R73 }] }],
      radio: legacyRadio,
      ledger: [],
      sortie: {
        flightGroupId: 'cap-1',
        callsign: 'Enfield-1',
        homeBase: 'Cochstedt',
        startedAt: time,
        members: []
      },
      nextTailNumber: 3
    }

    const career = schemas.campaign.career.parse(legacy)

    expect(career.preferredAircraft).toBe(MIG)
    expect(career.acquisitionRule).toBe('fidelity')
    expect(career.money).toBe(75)
    expect(career.inventory).toEqual({ [MIG]: { [R73]: 6, [R27R]: 1 } })
    expect(career.radios).toEqual({ [MIG]: plan })
    expect(career.presets[0]).toMatchObject({ id: 'preset-1', aircraftName: MIG })
    expect(career.sortie?.aircraftName).toBe(MIG)
    expect(career.nextTailNumber).toBe(3)
    expect('aircraftName' in career).toBe(false)
  })

  test('a career parses again unchanged', () => {
    const career = createInitialCareer({ aircraft: mig29, location: 'Cochstedt', time })

    expect(schemas.campaign.career.parse(career)).toEqual(career)
  })
})

describe('every career aircraft profile', () => {
  test.each(careerAircraft.map((aircraft) => [aircraft.aircraftName, aircraft] as const))(
    '%s: loadouts only use its own stores on stations that take them',
    (_name, aircraft) => {
      const stationNumbers = new Set(aircraft.stations.map((station) => station.num))
      expect(aircraft.loadouts.length).toBeGreaterThan(0)
      for (const loadout of aircraft.loadouts) {
        expect(isLoadoutValid(aircraft, loadout.pylons), loadout.id).toBe(true)
      }
      for (const weapon of aircraft.weapons) {
        expect(
          weapon.stations.every((num) => stationNumbers.has(num)),
          weapon.name
        ).toBe(true)
        expect(weapon.free || weapon.price > 0, weapon.name).toBe(true)
      }
      for (const [weaponId, count] of Object.entries(aircraft.startInventory)) {
        expect(
          aircraft.weapons.some((weapon) => weapon.id === weaponId),
          weaponId
        ).toBe(true)
        expect(count).toBeGreaterThan(0)
      }
    }
  )
})

describe('a Su-27 career', () => {
  const su27 = getCareerAircraft('Su-27')!

  test('starts with its own stock and no radio plan, since the module has no preset panel', () => {
    const career = createInitialCareer({ aircraft: su27, location: 'Cochstedt', time })

    expect(career.preferredAircraft).toBe('Su-27')
    expect(Object.keys(career.inventory)).toEqual(['Su-27'])
    expect(getCareerRadioPlan(career, su27)).toBeUndefined()
    expect(setCareerRadioPlan(career, su27, { comms: [], adf: [] }).ok).toBe(false)
  })

  test('a used Su-27 is worn but carries no hidden defects', () => {
    const campaign = careerCampaign()
    campaign.career = createInitialCareer({ aircraft: su27, location: 'Cochstedt', time })
    campaign.career.money = 500

    expect(buyAirframe(campaign, germany, su27, 'used')).toEqual({ ok: true })
    expect(campaign.career.airframes[1]).toMatchObject({ aircraftName: 'Su-27', hiddenDefects: [] })
  })

  test('MiG-29 presets and stock stay with the MiG next to a Su-27', () => {
    const career = createInitialCareer({ aircraft: su27, location: 'Cochstedt', time })
    career.inventory[MIG] = { [R73]: 4 }
    saveCareerPreset(career, mig29, { name: 'Fulcrum CAP', pylons: [{ num: 1, CLSID: R73 }] })

    expect(getCareerLoadouts(career, su27).map((entry) => entry.name)).not.toContain('Fulcrum CAP')
    const su27Loadout = su27.loadouts.find((entry) => entry.id === 'a2a-r27r')!
    expect(getLoadoutShortfall(career, su27, su27Loadout, 1)).toEqual([])
  })

  test('flies a sortie with its own loadout and stock', () => {
    const campaign = careerCampaign()
    campaign.career = createInitialCareer({ aircraft: su27, location: 'Cochstedt', time })
    campaign.coalitions.player.flightGroups[0]!.aircrafts[0]!.aircraftName = 'Su-27'

    const result = launchCareerSortie(campaign, {
      flightGroupId: 'cap-1',
      loadoutId: 'a2a-r27r',
      playerAirframeId: campaign.career.airframes[0]!.id,
      wingmen: []
    })

    expect(result).toEqual({ ok: true })
    const player = campaign.coalitions.player.flightGroups[0]!.aircrafts[0]!
    expect(player.aircraftName).toBe('Su-27')
    expect(player.radioPlan).toBeUndefined()
    expect(campaign.career.sortie?.aircraftName).toBe('Su-27')
    // 4 R-73 of the 8 in stock went onto the aircraft.
    expect(campaign.career.inventory['Su-27']![su27.weapons[0]!.id]).toBe(4)
  })
})

describe('buying, delivering and selling aircraft', () => {
  const su27 = getCareerAircraft('Su-27')!
  const hours = (count: number) => new Date(time.getTime() + count * 3_600_000)

  function shoppingCampaign(rule: 'fidelity' | 'arcade' = 'fidelity') {
    const campaign = careerCampaign()
    campaign.career!.acquisitionRule = rule
    campaign.career!.money = 500
    campaign.coalitions.player.aircraftTypes = capTypes('MiG-29A')
    campaign.coalitions.opponent.objectiveIds = ['Ramstein']
    return campaign
  }

  test('fidelity sells only the coalition types; arcade sells every type', () => {
    const fidelity = shoppingCampaign('fidelity')
    expect(getPurchasableAircraft(fidelity).map((entry) => entry.aircraftName)).toEqual([MIG])
    expect(buyAirframe(fidelity, germany, su27, 'new').ok).toBe(false)
    expect(fidelity.career!.money).toBe(500)

    const arcade = shoppingCampaign('arcade')
    expect(getPurchasableAircraft(arcade)).toEqual(careerAircraft)
    expect(buyAirframe(arcade, germany, su27, 'new')).toEqual({ ok: true })
  })

  test('fidelity sells every career type the coalition flies', () => {
    const campaign = shoppingCampaign('fidelity')
    campaign.coalitions.player.aircraftTypes = capTypes('MiG-29A', 'Su-25')
    expect(getPurchasableAircraft(campaign).map((entry) => entry.aircraftName)).toEqual([
      MIG,
      'Su-25'
    ])
  })

  test('the starting aircraft list follows the rule and the faction', () => {
    const nato = { CAP: ['F-16C_50', 'F-15C'], CAS: ['A-10A'] }
    expect(
      getAcquirableCareerAircraft('fidelity', nato).map((entry) => entry.aircraftName)
    ).toEqual(['F-15C', 'A-10A', 'F-16C_50'])
    expect(
      getAcquirableCareerAircraft('fidelity', { CAP: ['F-16C_50'] }).map(
        (entry) => entry.aircraftName
      )
    ).toEqual(['F-16C_50'])
    expect(getAcquirableCareerAircraft('arcade', nato)).toEqual(careerAircraft)
    expect(
      getAcquirableCareerAircraft('fidelity', { CAP: ['MiG-29A'] }).map(
        (entry) => entry.aircraftName
      )
    ).toEqual(['MiG-29 Fulcrum'])
    expect(
      getAcquirableCareerAircraft('fidelity', { CAP: ['F-5E-3'] }).map(
        (entry) => entry.aircraftName
      )
    ).toEqual(['F-5E-3_FC'])
    expect(
      getAcquirableCareerAircraft('fidelity', { CAP: ['F-86F Sabre'] }).map(
        (entry) => entry.aircraftName
      )
    ).toEqual(['F-86F_FC'])
    expect(
      getAcquirableCareerAircraft('fidelity', { CAP: ['MiG-15bis'] }).map(
        (entry) => entry.aircraftName
      )
    ).toEqual(['MiG-15bis_FC'])
  })

  test('a bought aircraft is paid at once and waits for its delivery at the rear airfield', () => {
    const campaign = shoppingCampaign()

    expect(buyAirframe(campaign, germany, mig29, 'new')).toEqual({ ok: true })

    const bought = campaign.career!.airframes[1]!
    expect(campaign.career!.money).toBe(500 - mig29.prices.new)
    // Laage is farther from the enemy at Ramstein than Cochstedt.
    expect(bought).toMatchObject({ status: 'delivering', location: 'Laage' })
    expect(bought.arrivesAt).toEqual(hours(mig29.deliveryHours))
    expect(getReadyAirframes(campaign.career!)).toHaveLength(1)
  })

  test('arrives once the delivery time has passed and lets the planner fly the type', () => {
    const campaign = shoppingCampaign()
    buyAirframe(campaign, germany, mig29, 'new')

    campaign.time = hours(mig29.deliveryHours - 1)
    updateCareer(campaign, germany)
    expect(campaign.career!.airframes[1]?.status).toBe('delivering')

    campaign.time = hours(mig29.deliveryHours)
    updateCareer(campaign, germany)
    expect(campaign.career!.airframes[1]).toMatchObject({ status: 'ready', location: 'Laage' })
    expect(campaign.coalitions.player.aircraftTypes.CAP).toContain(MIG)
  })

  test('an aircraft from outside the coalition stays out of the planner', () => {
    const campaign = shoppingCampaign('arcade')
    buyAirframe(campaign, germany, su27, 'new')

    campaign.time = hours(su27.deliveryHours)
    updateCareer(campaign, germany)

    expect(campaign.career!.airframes[1]?.status).toBe('ready')
    expect(campaign.coalitions.player.aircraftTypes.CAP).toEqual(['MiG-29A'])
  })

  test('a delivery bound for an airfield the enemy took goes to the remaining rear airfield', () => {
    const campaign = shoppingCampaign()
    buyAirframe(campaign, germany, mig29, 'new')
    campaign.coalitions.player.airdromeNames = ['Cochstedt']

    campaign.time = hours(mig29.deliveryHours)
    updateCareer(campaign, germany)

    expect(campaign.career!.airframes[1]).toMatchObject({ status: 'ready', location: 'Cochstedt' })
  })

  test('the enemy flying the same type is flagged, not refused', () => {
    const campaign = shoppingCampaign()
    campaign.coalitions.opponent.aircraftTypes = capTypes('MiG-29A')

    expect(isFlownByEnemy(campaign, mig29)).toBe(true)
    expect(isFlownByEnemy(campaign, su27)).toBe(false)
    expect(buyAirframe(campaign, germany, mig29, 'new')).toEqual({ ok: true })
  })

  test('selling pays the resale value and only works on the ground', () => {
    const campaign = shoppingCampaign()
    const career = campaign.career!
    const airframe = career.airframes[0]!
    airframe.integrity = 0.5
    const value = Math.round(mig29.prices.new * mig29.resaleFactor * 0.5)
    expect(getResaleValue(mig29, airframe)).toBe(value)

    airframe.status = 'flying'
    expect(sellAirframe(career, mig29, airframe.id, time).ok).toBe(false)
    airframe.status = 'ready'
    expect(sellAirframe(career, mig29, airframe.id, time)).toEqual({ ok: true })

    expect(career.airframes).toHaveLength(0)
    expect(career.money).toBe(500 + value)
    expect(career.ledger.at(-1)).toMatchObject({ amount: value })
  })

  test('a used aircraft sells against its used price', () => {
    const campaign = shoppingCampaign()
    const airframe = campaign.career!.airframes[0]!
    airframe.condition = 'used'

    expect(getResaleValue(mig29, airframe)).toBe(
      Math.round(mig29.prices.usedRange[1] * mig29.resaleFactor)
    )
  })

  test('selling the last aircraft of the open type opens the career on the one left', () => {
    const campaign = shoppingCampaign('arcade')
    const career = campaign.career!
    buyAirframe(campaign, germany, su27, 'new')

    sellAirframe(career, mig29, career.airframes[0]!.id, time)

    expect(career.preferredAircraft).toBe('Su-27')
  })
})

describe('rewards by role and task', () => {
  const su25 = getCareerAircraft('Su-25')!
  const tank = { name: 'T-72', type: 'T-72B', categoryName: 'vehicle', x: 0, y: 0 }
  const fighter = { name: 'F-16', type: 'F-16C_50', categoryName: 'plane', x: 0, y: 0 }

  test('a fighter earns mostly from air kills, an attack aircraft from ground kills', () => {
    expect(getKillReward(mig29, fighter)).toBe(careerRewards.airKill)
    expect(getKillReward(mig29, tank)).toBeLessThan(careerRewards.groundKill + 1)
    expect(getKillReward(su25, tank)).toBe(careerRewards.groundKill * 2)
    expect(getKillReward(su25, tank)).toBeGreaterThan(getKillReward(mig29, tank))
  })

  test('each task pays its own completion bonus', () => {
    expect(getTaskReward('DEAD')).toBe(careerTaskRewards.DEAD)
    expect(getTaskReward('DEAD')).toBeGreaterThan(getTaskReward('CAP'))
    expect(getTaskReward('Transport')).toBe(careerRewards.taskCompleted)
    expect(getTaskReward(undefined)).toBe(careerRewards.taskCompleted)
  })

  test('a sortie records its task and is paid that task bonus', () => {
    const campaign = careerCampaign()
    launchCareerSortie(campaign, {
      flightGroupId: 'cap-1',
      loadoutId: A2A_LOADOUT,
      playerAirframeId: campaign.career!.airframes[0]!.id,
      wingmen: []
    })
    expect(campaign.career!.sortie?.task).toBe('CAP')
    const moneyBefore = campaign.career!.money

    const lines = settleCareerSortie(campaign, missionState(), germany, { taskCompleted: true })

    expect(campaign.career!.money).toBe(moneyBefore + careerTaskRewards.CAP!)
    expect(lines).toContain(`+${careerTaskRewards.CAP} CAP completed`)
  })
})
