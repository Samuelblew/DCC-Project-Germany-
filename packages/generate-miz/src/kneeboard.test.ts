import { schemas } from '@dcc/contracts'
import { scenarios, theatres } from '@dcc/data'
import AdmZip from 'adm-zip'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import { generateMizFromCampaign } from './index'
import {
  buildKneeboardMissionDescription,
  buildKneeboardWaypointRows,
  createKneeboardFilename,
  getClientFlightGroups,
  getKneeboardFlightFrequencySummary,
  getKneeboardLandingTacanSummary,
  getKneeboardRadioChannelSummary,
  getKneeboardTargetTacanSummary,
  renderKneeboardSvg,
  sanitizeKneeboardFilenamePart
} from './kneeboard'
import {
  createRouteMapViewport,
  dcsPositionToLngLat,
  renderGeographicMapLayerFromPmtiles,
  resolveCaucasusPmtilesPath
} from './kneeboard-map'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CampaignCoalition = Campaign['coalitions']['player']
type FlightGroup = z.infer<typeof schemas.flightGroup>
type Theatre = z.infer<typeof schemas.theatre>

const CAUCASUS_TEST_ROUTE = {
  takeoff: { x: -280_000, y: 620_000 },
  task: { x: -260_000, y: 640_000 },
  landing: { x: -240_000, y: 660_000 }
} as const

function createFlightGroup(id: string, callsign: string, startTime: Date): FlightGroup {
  return {
    id,
    aircrafts: [1, 2].map((unitNumber) => ({
      id: `${id}-${unitNumber}`,
      unitName: `${callsign}-${unitNumber}`,
      aircraftName: 'F-16C_50'
    })),
    task: 'CAP',
    position: CAUCASUS_TEST_ROUTE.takeoff,
    homeBase: 'Test Base',
    callsign,
    flightplan: {
      id: `${id}-plan`,
      startTime,
      waypoints: [
        {
          name: 'Take Off',
          position: CAUCASUS_TEST_ROUTE.takeoff,
          altitude: 0,
          speed: 150,
          type: 'TakeOff'
        },
        {
          name: 'CAP',
          position: CAUCASUS_TEST_ROUTE.task,
          altitude: 6000,
          speed: 185.2,
          type: 'Task'
        },
        {
          name: 'Landing',
          position: CAUCASUS_TEST_ROUTE.landing,
          altitude: 0,
          speed: 150,
          type: 'Landing'
        }
      ]
    }
  }
}

function createCampaign(startTime: Date): Campaign {
  const createAircraftTypes = (): CampaignCoalition['aircraftTypes'] =>
    Object.fromEntries(
      schemas.task.options.map((task) => [task, [] as string[]])
    ) as unknown as CampaignCoalition['aircraftTypes']

  const createGroundUnitTypes = (): CampaignCoalition['groundUnitTypes'] =>
    Object.fromEntries(
      schemas.groundUnitType.options.map((type) => [type, [] as string[]])
    ) as unknown as CampaignCoalition['groundUnitTypes']

  const emptyCoalition: CampaignCoalition = {
    id: 'empty',
    aircraftTypes: createAircraftTypes(),
    groundUnitTypes: createGroundUnitTypes(),
    airdromeNames: [],
    objectiveIds: [],
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: []
  }

  return {
    version: 'test',
    id: 'campaign',
    name: 'Campaign',
    createdAt: startTime,
    updatedAt: startTime,
    time: startTime,
    timeMultiplier: 1,
    logs: [],
    scenarioId: 'scenario',
    coalitions: {
      player: {
        ...emptyCoalition,
        id: 'player',
        flightGroups: []
      },
      opponent: {
        ...emptyCoalition,
        id: 'opponent',
        flightGroups: []
      }
    }
  }
}

const theatre: Theatre = {
  name: 'Caucasus',
  objectives: [],
  targets: {},
  airdromeDetails: {},
  info: {
    center: { x: -260_000, y: 640_000 },
    weather: {
      temperature: { amplitude: 0, mean: 20 },
      cloudCover: { baseCloudCover: 0, seasonEffect: 0 },
      wind: { speed: 0, direction: 0 }
    },
    night: { startHour: 20, endHour: 6 }
  }
}

describe('kneeboard client flight selection', () => {
  test('selects only flight groups with client aircraft and creates stable safe filenames', () => {
    const startTime = new Date('2026-01-01T12:00:00Z')
    const campaign = createCampaign(startTime)
    const clientGroup = createFlightGroup('blue-client', 'Enfield/1', startTime)
    clientGroup.aircrafts[0]!.client = true
    const aiGroup = createFlightGroup('blue-ai', 'Chevy-2', startTime)
    campaign.coalitions.player.flightGroups = [clientGroup, aiGroup]

    const clientGroups = getClientFlightGroups(campaign)

    expect(clientGroups.map(({ flightGroup }) => flightGroup.callsign)).toEqual(['Enfield/1'])
    expect(sanitizeKneeboardFilenamePart(' Pinpoint Strike! ')).toBe('Pinpoint-Strike')
    expect(createKneeboardFilename(1, clientGroup)).toBe('DCC_001_Enfield-1_CAP.png')
  })
})

describe('kneeboard geographic map', () => {
  test('renders protomaps water and land paths when caucasus tiles are available', async () => {
    if (!resolveCaucasusPmtilesPath()) return

    const lngLatPoints = [
      dcsPositionToLngLat(CAUCASUS_TEST_ROUTE.takeoff.x, CAUCASUS_TEST_ROUTE.takeoff.y, 'Caucasus'),
      dcsPositionToLngLat(CAUCASUS_TEST_ROUTE.task.x, CAUCASUS_TEST_ROUTE.task.y, 'Caucasus'),
      dcsPositionToLngLat(CAUCASUS_TEST_ROUTE.landing.x, CAUCASUS_TEST_ROUTE.landing.y, 'Caucasus')
    ].filter((point): point is NonNullable<typeof point> => point != null)

    const viewport = createRouteMapViewport({
      lngLatPoints,
      box: { x: 0, y: 0, width: 640, height: 228, padding: 26 }
    })
    expect(viewport).toBeDefined()
    if (!viewport) return

    const layer = await renderGeographicMapLayerFromPmtiles({
      bounds: viewport.bounds,
      projectLngLat: viewport.projectLngLat
    })

    expect(layer).toContain('map-land')
    expect(layer).toContain('map-sea')
  })
})

describe('kneeboard waypoint rows', () => {
  test('formats route timing, distance, bearing, altitude, and speed', () => {
    const startTime = new Date('2026-01-01T12:00:00Z')
    const rows = buildKneeboardWaypointRows(
      createFlightGroup('blue-client', 'Enfield-1', startTime)
    )

    expect(rows).toMatchObject([
      {
        index: undefined,
        eta: '12:00Z',
        altitude: '0',
        speed: '292',
        legDistance: '---',
        totalDistance: '---',
        bearing: '---',
        remarks: 'DEPART'
      },
      {
        index: 1,
        eta: '12:02Z',
        altitude: '19,685',
        speed: '360',
        legDistance: '15.3',
        totalDistance: '15.3',
        bearing: '045',
        remarks: 'CAP'
      },
      {
        index: 2,
        eta: '12:05Z',
        altitude: '0',
        speed: '292',
        legDistance: '15.3',
        totalDistance: '30.5',
        bearing: '045',
        remarks: 'LAND'
      }
    ])
  })

  test('formats metres, km/h and kilometres for metric instruments', () => {
    const startTime = new Date('2026-01-01T12:00:00Z')
    const rows = buildKneeboardWaypointRows(
      createFlightGroup('blue-client', 'Enfield-1', startTime),
      'metric'
    )

    expect(rows[1]).toMatchObject({
      altitude: '6,000',
      speed: '667',
      legDistance: '28.3',
      totalDistance: '28.3'
    })
  })

  test('calculates bearings clockwise from north using DCS coordinates', () => {
    const startTime = new Date('2026-01-01T12:00:00Z')
    const flightGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)

    flightGroup.flightplan.waypoints = [
      { name: 'Origin', type: 'TakeOff', position: { x: 0, y: 0 }, altitude: 0, speed: 150 },
      { name: 'North', type: 'Nav', position: { x: 10_000, y: 0 }, altitude: 0, speed: 150 },
      {
        name: 'East',
        type: 'Nav',
        position: { x: 10_000, y: 10_000 },
        altitude: 0,
        speed: 150
      },
      {
        name: 'South',
        type: 'Nav',
        position: { x: 0, y: 10_000 },
        altitude: 0,
        speed: 150
      },
      { name: 'West', type: 'Nav', position: { x: 0, y: 0 }, altitude: 0, speed: 150 }
    ]

    expect(buildKneeboardWaypointRows(flightGroup).map((row) => row.bearing)).toEqual([
      '---',
      '000',
      '090',
      '180',
      '270'
    ])
  })
})

describe('kneeboard mission description', () => {
  test('uses package variant and reason when available', () => {
    const startTime = new Date('2026-01-01T12:00:00Z')
    const flightGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)
    flightGroup.task = 'CAS'
    flightGroup.packageId = 'package-1'
    flightGroup.target = {
      id: 'ground-1',
      type: 'Ground Group',
      objectiveId: 'Kobuleti'
    }

    const description = buildKneeboardMissionDescription({
      flightGroup,
      theatre: {
        ...theatre,
        objectives: [{ name: 'Kobuleti', type: 'Frontline', position: { x: 0, y: 0 } }]
      },
      missionPackage: {
        id: 'package-1',
        type: 'CAS Package',
        targetObjectiveId: 'Kobuleti',
        members: [{ flightGroupId: flightGroup.id, role: 'cas', totOffset: 0 }],
        tot: startTime,
        status: 'active',
        variantId: 'defensive-cas',
        variantLabel: 'Defensive CAS',
        reason: 'Enemy ground attack threatening Kobuleti'
      }
    })

    expect(description).toContain('Defensive CAS')
    expect(description).toContain('Enemy ground attack threatening Kobuleti')
    expect(description).toContain('ground group / kobuleti')
  })

  test('renders long package IDs and target descriptions without raw overflow text', async () => {
    const startTime = new Date('2026-01-01T12:00:00Z')
    const campaign = createCampaign(startTime)
    const flightGroup = createFlightGroup('blue-client', 'Dodge-2', startTime)
    const packageId = 'planned-dead-30aa-fdc3-46ff-b085-5bd6efbb1f02'
    flightGroup.task = 'DEAD'
    flightGroup.packageId = packageId
    flightGroup.target = {
      id: 'sam-1',
      type: 'SA-2',
      objectiveId: 'Qatana'
    }
    campaign.coalitions.player.flightGroups = [flightGroup]
    campaign.coalitions.player.packages = [
      {
        id: packageId,
        type: 'DEAD Package',
        targetObjectiveId: 'Qatana',
        members: [{ flightGroupId: flightGroup.id, role: 'dead', totOffset: 0 }],
        tot: startTime,
        status: 'active',
        variantId: 'standalone-dead',
        variantLabel: 'Standalone DEAD',
        reason: 'Untargeted SAM threat'
      }
    ]

    const svg = await renderKneeboardSvg({
      campaign,
      theatre: {
        ...theatre,
        name: 'Syria',
        objectives: [{ name: 'Qatana', type: 'Military', position: { x: 0, y: 0 } }]
      },
      missionFlightConfigs: [],
      coalition: 'player',
      flightGroup
    })

    expect(svg).not.toContain(packageId)
    expect(svg).toContain('planned-dead-30aa')
    expect(svg).toContain('Standalone DEAD: Untargeted SAM threat.')
    expect(svg).toContain('Target is sa-2 / qatana.')
    expect(svg).toContain('targetDescriptionClip')
  })
})

describe('kneeboard TACAN summaries', () => {
  test('formats target and landing TACAN values for the kneeboard footer', () => {
    const startTime = new Date('2026-01-01T12:00:00Z')
    const flightGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)
    flightGroup.homeBase = 'Kobuleti'

    expect(
      getKneeboardTargetTacanSummary({
        groupId: 101,
        name: 'Enfield-1',
        task: 'CAP',
        unitNames: ['Enfield-1-1'],
        frequency: 251.05,
        navigation: {
          mode: 'targetTacan',
          targetLabel: 'Target',
          targetPoint: { x: 0, z: 0 },
          tacan: { channel: 31, band: 'X', callsign: 'DCC1' }
        }
      })
    ).toBe('31X DCC1')

    expect(
      getKneeboardLandingTacanSummary(flightGroup, {
        ...theatre,
        airdromeDetails: {
          Kobuleti: {
            id: 1,
            name: 'Kobuleti',
            x: 0,
            y: 0,
            runwayAngle: 0,
            standlist: {},
            tacan: { channel: 67, band: 'X', callsign: 'KBL' }
          }
        }
      })
    ).toBe('67X KBL')
  })

  test('uses fallback when TACAN data is unavailable', () => {
    const startTime = new Date('2026-01-01T12:00:00Z')
    const flightGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)

    expect(getKneeboardTargetTacanSummary(undefined)).toBe('---')
    expect(getKneeboardLandingTacanSummary(flightGroup, theatre)).toBe('---')
  })

  test('formats the assigned flight radio frequency', () => {
    const missionConfig = {
      groupId: 101,
      name: 'Enfield-1',
      task: 'CAP' as const,
      unitNames: ['Enfield-1-1'],
      frequency: 251.05,
      radioPreset: { radio: 1, channel: 1 },
      radioChannels: [
        { purpose: 'FLIGHT' as const, radio: 1, channel: 1, frequency: 251.05 },
        { purpose: 'AWACS' as const, radio: 1, channel: 2, frequency: 251 },
        { purpose: 'ATC' as const, radio: 1, channel: 3, frequency: 250 },
        { purpose: 'JTAC' as const, radio: 1, channel: 4, frequency: 305 }
      ]
    }

    expect(getKneeboardFlightFrequencySummary(missionConfig)).toBe('251.050 MHz R1 CH1')
    expect(getKneeboardRadioChannelSummary(missionConfig, 'AWACS')).toBe('R1 251.000 MHz')
    expect(getKneeboardRadioChannelSummary(missionConfig, 'ATC')).toBe('R1 250.000 MHz')
    expect(getKneeboardRadioChannelSummary(missionConfig, 'JTAC')).toBe('R1 305.000 MHz')
    expect(getKneeboardFlightFrequencySummary(undefined)).toBe('---')
  })

  test('renders flight radio and carrier landing TACAN on the kneeboard', async () => {
    const startTime = new Date('2026-01-01T12:00:00Z')
    const campaign = createCampaign(startTime)
    const flightGroup = createFlightGroup('carrier-client', 'Enfield-1', startTime)
    flightGroup.aircrafts[0]!.client = true
    flightGroup.homeBase = 'uk-carrier-group'
    campaign.coalitions.player.flightGroups = [flightGroup]

    const svg = await renderKneeboardSvg({
      campaign,
      theatre,
      coalition: 'player',
      flightGroup,
      missionFlightConfigs: [
        {
          groupId: 101,
          name: 'Enfield-1',
          task: 'CAP',
          unitNames: ['Enfield-1-1'],
          frequency: 251.05,
          radioPreset: { radio: 1, channel: 1 },
          radioChannels: [
            { purpose: 'FLIGHT', radio: 1, channel: 1, frequency: 251.05 },
            { purpose: 'AWACS', radio: 1, channel: 2, frequency: 251 },
            { purpose: 'ATC', radio: 1, channel: 3, frequency: 250 },
            { purpose: 'JTAC', radio: 1, channel: 4, frequency: 305 }
          ],
          navigation: {
            landingTacan: { channel: 11, band: 'X', callsign: 'HMS' }
          }
        }
      ]
    })

    expect(svg).toContain('CH1 FLIGHT')
    expect(svg).toContain('R1 251.050 MHz')
    expect(svg).toContain('CH2 AWACS')
    expect(svg).toContain('R1 251.000 MHz')
    expect(svg).toContain('CH3 ATC')
    expect(svg).toContain('R1 250.000 MHz')
    expect(svg).toContain('CH4 JTAC')
    expect(svg).toContain('R1 305.000 MHz')
    expect(svg).toContain('LANDING TACAN')
    expect(svg).toContain('11X HMS')
  })

  test('briefs a MiG-29 in metric units, with cockpit channel numbers and NDB instead of TACAN', async () => {
    const startTime = new Date('2026-01-01T12:00:00Z')
    const campaign = createCampaign(startTime)
    const flightGroup = createFlightGroup('mig-client', 'Enfield-1', startTime)
    flightGroup.aircrafts = flightGroup.aircrafts.map((aircraft) => ({
      ...aircraft,
      aircraftName: 'MiG-29 Fulcrum'
    }))
    flightGroup.aircrafts[0]!.client = true
    flightGroup.homeBase = 'Cochstedt'
    campaign.coalitions.player.flightGroups = [flightGroup]

    const svg = await renderKneeboardSvg({
      campaign,
      theatre: { ...theatre, name: 'Cold War Germany' },
      coalition: 'player',
      flightGroup,
      missionFlightConfigs: [
        {
          groupId: 101,
          name: 'Enfield-1',
          task: 'CAP',
          unitNames: ['Enfield-1-1'],
          frequency: 260.25,
          radioPreset: { radio: 1, channel: 1, cockpitChannel: 0 },
          radioChannels: [
            { purpose: 'FLIGHT', radio: 1, channel: 1, cockpitChannel: 0, frequency: 260.25 },
            { purpose: 'ATC', radio: 1, channel: 3, cockpitChannel: 2, frequency: 254.7 }
          ]
        }
      ]
    })

    expect(svg).toContain('CH0 FLIGHT')
    expect(svg).toContain('CH2 ATC')
    expect(svg).toContain('ALT M')
    expect(svg).toContain('KM/H')
    expect(svg).toContain('HOME NDB')
    expect(svg).toContain('950')
    expect(svg).not.toContain('TACAN')
  })
})

describe('generateMizFromCampaign kneeboards', () => {
  test('smoke-generates a South Atlantic mission with persistent naval groups', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dcc-south-atlantic-'))
    const mizPath = path.join(dir, 'mission.miz')

    try {
      const scenario = scenarios.find((candidate) => candidate.id === 'falklands-1982')
      const southAtlantic = theatres.find((candidate) => candidate.name === 'SouthAtlantic')
      if (!scenario || !southAtlantic) throw new Error('South Atlantic test data is missing')

      const campaign = createCampaign(scenario.date)
      campaign.scenarioId = scenario.id
      campaign.coalitions.player.id = 'uk-1982'
      campaign.coalitions.opponent.id = 'argentina-1982-official'
      campaign.coalitions.player.navalGroups = structuredClone(scenario.navalGroups?.player ?? [])
      campaign.coalitions.opponent.navalGroups = structuredClone(
        scenario.navalGroups?.opponent ?? []
      )
      const carrier = campaign.coalitions.player.navalGroups.find(
        (group) => group.role === 'carrier'
      )
      if (!carrier?.units) throw new Error('South Atlantic carrier group is missing')
      carrier.state = 'sunk'
      carrier.damage = 1
      for (const unit of carrier.units) {
        unit.state = 'sunk'
        unit.damage = 1
      }

      const result = await generateMizFromCampaign(campaign, southAtlantic, mizPath)

      expect(result.isOk()).toBe(true)
      if (result.isErr()) throw result.error

      const zip = new AdmZip(mizPath)
      const missionText = zip.getEntry('mission')?.getData().toString('utf-8') ?? ''
      expect(zip.getEntry('l10n/')?.isDirectory).toBe(true)
      expect(zip.getEntry('l10n/DEFAULT/')?.isDirectory).toBe(true)
      expect(zip.getEntry('theatre')?.getData().toString('utf-8')).toBe('Falklands')
      expect(missionText).toContain('["theatre"] = "Falklands"')
      expect(missionText).toContain('["Year"] = 1982')
      const surfaceWindStart = missionText.indexOf('["atGround"]')
      const surfaceWindEnd = missionText.indexOf('}', surfaceWindStart)
      const surfaceWind = missionText.slice(surfaceWindStart, surfaceWindEnd)
      expect(surfaceWindStart).toBeGreaterThanOrEqual(0)
      expect(surfaceWind).toContain('["speed"] = 9')
      expect(surfaceWind).toContain('["dir"] = 170')
      expect(missionText).toContain('NavalGroup-uk-carrier-group')
      expect(missionText).toContain('NavalUnit-uk-carrier-group-uk-carrier-group-ship-1')
      expect(missionText).toContain('["type"] = "LHA_Tarawa"')
      const carrierGroupStart = missionText.indexOf('NavalGroup-uk-carrier-group')
      const amphibiousGroupStart = missionText.indexOf('NavalGroup-uk-amphibious-group')
      expect(carrierGroupStart).toBeGreaterThanOrEqual(0)
      expect(missionText).not.toContain('NavalGroup-uk-escort-group')
      expect(amphibiousGroupStart).toBeGreaterThan(carrierGroupStart)
      expect(missionText.slice(carrierGroupStart, amphibiousGroupStart)).toContain(
        'NavalUnit-uk-escort-group-uk-escort-group-ship-1'
      )
      expect(missionText.slice(carrierGroupStart, amphibiousGroupStart)).toContain(
        '["id"] = "SetImmortal"'
      )
      expect(missionText).toContain('carrierOps')
      expect(missionText).toContain('recoveryDuration')
      const stateScript = zip.getEntry('l10n/DEFAULT/state.lua')?.getData().toString('utf-8') ?? ''
      expect(stateScript).toContain("addSubMenuForCoalition(side, 'Carrier Operations')")
      expect(stateScript).toContain("id = 'SwitchWaypoint'")
      expect(stateScript).toContain('timer.getTime() + duration')
      expect(missionText).toContain('NavalGroup-arg-surface-group')
      expect(missionText).toContain('["type"] = "leander-gun-achilles"')
      expect(missionText).toContain('["type"] = "leander-gun-andromeda"')
      expect(missionText).toContain('["type"] = "leander-gun-ariadne"')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('writes the selected theatre into mission files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dcc-theatre-'))
    const mizPath = path.join(dir, 'mission.miz')

    try {
      const startTime = new Date('2026-01-01T12:00:00Z')
      const campaign = createCampaign(startTime)
      campaign.coalitions.player.flightGroups = [createFlightGroup('blue-ai', 'Chevy-2', startTime)]
      const syriaTheatre: Theatre = {
        ...theatre,
        name: 'Syria',
        info: {
          ...theatre.info,
          center: { x: -238_900, y: -50_203 }
        }
      }

      const result = await generateMizFromCampaign(campaign, syriaTheatre, mizPath)

      expect(result.isOk()).toBe(true)
      if (result.isErr()) throw result.error

      const zip = new AdmZip(mizPath)
      const missionEntry = zip.getEntry('mission')

      expect(zip.getEntry('theatre')?.getData().toString('utf-8')).toBe('Syria')
      expect(missionEntry?.getData().toString('utf-8')).toContain('["theatre"] = "Syria"')
      expect(missionEntry?.getData().toString('utf-8')).toContain('["centerX"] = -238900')
      expect(missionEntry?.getData().toString('utf-8')).toContain('["centerY"] = -50203')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('adds kneeboard PNGs for client groups only', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dcc-kneeboard-'))
    const mizPath = path.join(dir, 'mission.miz')

    try {
      const startTime = new Date('2026-01-01T12:00:00Z')
      const campaign = createCampaign(startTime)
      const clientGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)
      clientGroup.aircrafts[0]!.client = true
      campaign.coalitions.player.flightGroups = [
        clientGroup,
        createFlightGroup('blue-ai', 'Chevy-2', startTime)
      ]

      const result = await generateMizFromCampaign(campaign, theatre, mizPath)

      expect(result.isOk()).toBe(true)
      if (result.isErr()) throw result.error

      const zip = new AdmZip(mizPath)
      const entries = zip.getEntries().map((entry) => entry.entryName)
      const kneeboardEntries = entries.filter(
        (entry) => entry.startsWith('KNEEBOARD/IMAGES/') && !entry.endsWith('/')
      )

      expect(kneeboardEntries).toEqual(['KNEEBOARD/IMAGES/DCC_001_Enfield-1_CAP.png'])
      const kneeboardEntry = zip.getEntry('KNEEBOARD/IMAGES/DCC_001_Enfield-1_CAP.png')
      expect(kneeboardEntry?.getData().subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('does not add kneeboard entries when there are no client flight groups', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dcc-kneeboard-'))
    const mizPath = path.join(dir, 'mission.miz')

    try {
      const startTime = new Date('2026-01-01T12:00:00Z')
      const campaign = createCampaign(startTime)
      campaign.coalitions.player.flightGroups = [createFlightGroup('blue-ai', 'Chevy-2', startTime)]

      const result = await generateMizFromCampaign(campaign, theatre, mizPath)

      expect(result.isOk()).toBe(true)
      if (result.isErr()) throw result.error

      const zip = new AdmZip(mizPath)
      const kneeboardEntries = zip
        .getEntries()
        .map((entry) => entry.entryName)
        .filter((entry) => entry.startsWith('KNEEBOARD/IMAGES/'))

      expect(kneeboardEntries).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
