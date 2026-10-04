import { config, schemas } from '@dcc/contracts'
import { factions } from '@dcc/data'
import * as luaTable from '@dcc/lua-table'
import AdmZip from 'adm-zip'
import { err, ok, Result } from 'neverthrow'
import * as z from 'zod'

import { addAwacsGroups } from './add-awacs-groups'
import { addFlightGroups, type MissionFlightConfig } from './add-flight-groups'
import { addPlayerGciStations } from './add-gci'
import { addGermanyIads } from './add-germany-iads'
import { addGroundGroups } from './add-ground-groups'
import { addNavalGroups } from './add-naval-groups'
import { addStructures } from './add-structures'
import { getFrontlineSegments } from './frontline'
import { buildIadsConfig, type MissionIadsConfig } from './iads'
import { createKneeboardImages } from './kneeboard'
import { dictionary, mapResource } from './l10n'
import {
  createDoScriptAction,
  createDoScriptFileAction,
  createLoggedStartupAction,
  createTriggerFunction,
  createTriggerFunctionMap
} from './mission-config-trigger'
import { buildMissionCullingPlan, type MissionCullingManifest } from './mission-culling'
import { options } from './options'
import casLuaScript from './scripts/cas.lua?raw'
import ctldLuaScript from './scripts/ctld.lua?raw'
import dccIadsLuaScript from './scripts/dcc_iads.lua?raw'
import ewrLuaScript from './scripts/ewr.lua?raw'
import mistLuaScript from './scripts/mist_4_5_126.lua?raw'
import navigationLuaScript from './scripts/navigation.lua?raw'
import skynetIadsLuaScript from './scripts/skynet-iads.lua?raw'
import splashDamageLuaScript from './scripts/splash_damage.lua?raw'
import stateLuaScript from './scripts/state.lua?raw'
import { warehouses } from './warehouses'

export { resolveAppIconPath, setAppIconPath } from './kneeboard-logo'
export {
  createRouteMapViewport,
  dcsPositionToLngLat,
  resolveCaucasusPmtilesPath,
  resolveTheatrePmtilesPath,
  setCaucasusPmtilesPath,
  setTheatrePmtilesPath,
  SUPPORTED_THEATRE_MAP_TILE_NAMES
} from './kneeboard-map'

type TriggerValue = string | number | boolean

type MissionTriggerTables = {
  actions: Record<number, string>
  events: Record<number, unknown>
  custom: Record<number, unknown>
  func: Record<number, string>
  flag: Record<number, boolean>
  conditions: Record<number, string>
  customStartup: Record<number, unknown>
  funcStartup: Record<number, string>
}

type MissionTriggerRule = {
  rules: Record<number, Record<string, TriggerValue>>
  eventlist: string
  comment: string
  actions: Record<number, Record<string, TriggerValue>>
  predicate: string
  colorItem?: string
}

type MissionTriggerRules = Record<number, MissionTriggerRule>

type MissionScriptConfig = {
  missionId: string
  flightGroups: MissionFlightConfig[]
  carrierOps?: CarrierOpsConfig[]
  crashPilotSurvivalChance: number
  welcomeMessage?: MissionWelcomeMessage
  cullingManifest?: MissionCullingManifest
  magneticVariationDegrees?: number
}

type CarrierOpsConfig = {
  groupName: string
  displayName: string
  coalition: 'blue' | 'red'
  recoveryDuration: number
  speed: number
  holdingRadius: number
}

type MissionWelcomeMessage = {
  text: string
  duration: number
}

const DCS_COUNTRY_IDS: Record<string, number> = {
  Russia: 0,
  USA: 2,
  UK: 4,
  France: 5,
  Germany: 6,
  Israel: 15,
  GDR: 78,
  Argentina: 83
}

const JOINT_TASK_FORCE_COUNTRIES = {
  player: { id: 80, name: 'CJTF Blue' },
  opponent: { id: 81, name: 'CJTF Red' }
} as const

function hasCustomClientAircraft(
  coalition: z.infer<typeof schemas.campaign.campaign>['coalitions']['player']
) {
  return coalition.flightGroups.some((flightGroup) => {
    const factionAircraftTypes = schemas.resolveTaskAircraftTypes(
      coalition.aircraftTypes,
      flightGroup.task
    )

    return flightGroup.aircrafts.some(
      (aircraft) => aircraft.client && !factionAircraftTypes.includes(aircraft.aircraftName)
    )
  })
}

export function configureMissionCountries(
  mission: z.infer<typeof schemas.dcs.mission>,
  campaign: z.infer<typeof schemas.campaign.campaign>
) {
  for (const [coalitionKey, missionCoalitionKey] of [
    ['player', 'blue'],
    ['opponent', 'red']
  ] as const) {
    const campaignCoalition = campaign.coalitions[coalitionKey]
    const faction = factions.find((candidate) => candidate.id === campaignCoalition.id)
    const countryName = campaignCoalition.countryName ?? faction?.countryName
    if (!countryName) continue
    const country = hasCustomClientAircraft(campaignCoalition)
      ? JOINT_TASK_FORCE_COUNTRIES[coalitionKey]
      : {
          id: DCS_COUNTRY_IDS[countryName],
          name: countryName
        }
    const countryId = country.id
    if (countryId == null) continue

    for (const side of ['neutrals', 'blue', 'red'] as const) {
      mission.coalitions[side] = mission.coalitions[side].filter((id) => id !== countryId)
    }
    mission.coalitions[missionCoalitionKey].push(countryId)
    mission.coalition[missionCoalitionKey].country = [
      {
        id: countryId,
        name: country.name,
        plane: { group: [] },
        helicopter: { group: [] },
        ship: { group: [] },
        static: { group: [] },
        vehicle: { group: [] }
      }
    ]
  }
}

function getStartupTriggerIndexes(ewrEnabled: boolean, iadsEnabled: boolean) {
  return [1, 2, 3, 4, 5, 6, 10, 11, ...(ewrEnabled ? [7] : []), ...(iadsEnabled ? [8, 9] : [])]
}

function createIadsConfigScript(iadsConfig: MissionIadsConfig) {
  const iadsConfigLuaResult = luaTable.stringify(iadsConfig, {
    mixedKeyTypes: true,
    pretty: false
  })
  if (iadsConfigLuaResult.isErr()) {
    return err(iadsConfigLuaResult.error)
  }

  return ok(`DCC_IADS_CONFIG = ${iadsConfigLuaResult.value}`)
}

function createMissionMapConfig(theatre: z.infer<typeof schemas.theatre>) {
  return {
    centerY: theatre.info.center.y,
    zoom: 3381.3919135227,
    centerX: theatre.info.center.x
  }
}

function createWelcomeMessage(
  flightGroups: MissionFlightConfig[],
  options: { ewrEnabled: boolean; carrierOpsEnabled: boolean; gciStationEnabled: boolean }
): MissionWelcomeMessage | undefined {
  const features = new Set<string>()

  if (flightGroups.some((flightGroup) => flightGroup.navigation?.targetPoint)) {
    features.add('target vectors')
  }

  if (flightGroups.some((flightGroup) => flightGroup.navigation?.landingPoint)) {
    features.add('landing vectors')
  }

  if (flightGroups.some((flightGroup) => flightGroup.navigation?.tacan)) {
    features.add('target TACAN details')
  }

  if (flightGroups.some((flightGroup) => flightGroup.task === 'CAS')) {
    features.add('JTAC smoke, coordinates, and laser control')
  }

  if (flightGroups.some((flightGroup) => 'csar' in flightGroup && flightGroup.csar)) {
    features.add('CSAR pilot status, smoke, and pickup')
  }

  if (options.gciStationEnabled) {
    features.add('MiG-29 GCI (KRU) covering the theatre')
  }

  if (
    options.ewrEnabled &&
    flightGroups.some((flightGroup) => flightGroup.client && !flightGroup.nativeGci)
  ) {
    features.add('GCI picture calls')
  }

  if (options.carrierOpsEnabled) {
    features.add('carrier recovery-window control')
  }

  if (flightGroups.some((flightGroup) => flightGroup.isHelicopter)) {
    features.add('CTLD cargo commands')
  }

  if (features.size === 0) return undefined

  const featureList = Array.from(features)

  return {
    text: [
      'Welcome aboard. DCC is online and your mission support is ready.',
      'Open F10 > Other for:',
      ...featureList.map((feature) => `- ${feature}`),
      'Good hunting.'
    ].join('\n'),
    duration: 25
  }
}

function createCarrierOpsConfig(
  campaign: z.infer<typeof schemas.campaign.campaign>
): CarrierOpsConfig[] {
  return (['player', 'opponent'] as const).flatMap((campaignCoalition) => {
    const missionCoalition = campaignCoalition === 'player' ? 'blue' : 'red'
    return (campaign.coalitions[campaignCoalition].navalGroups ?? [])
      .filter((group) => group.role === 'carrier')
      .map((group) => ({
        groupName: `NavalGroup-${group.id}`,
        displayName: group.name,
        coalition: missionCoalition,
        recoveryDuration: 20 * 60,
        speed: 12,
        holdingRadius: 6_000
      }))
  })
}

function createWelcomeMessageScript() {
  return [
    'timer.scheduleFunction(function()',
    '  if config and config.welcomeMessage and trigger and trigger.action then',
    '    trigger.action.outText(config.welcomeMessage.text, config.welcomeMessage.duration or 20, false)',
    '  end',
    'end, {}, timer.getTime() + 8)'
  ].join('\n')
}

type DrawingLine = {
  visible: boolean
  colorString: string
  lineMode: string
  mapY: number
  primitiveType: string
  style: string
  closed: boolean
  thickness: number
  mapX: number
  layerName: string
  name: string
  points: Record<number, { x: number; y: number }>
}

type MissionDrawings = {
  layers: Array<{
    visible: boolean
    name: string
    objects: DrawingLine[]
  }>
}

const DCS_DRAWING_LAYER_NAMES = ['Author', 'Red', 'Blue', 'Common'] as const

function addFrontlineDrawings(
  mission: z.infer<typeof schemas.dcs.mission>,
  campaign: z.infer<typeof schemas.campaign.campaign>,
  theatre: z.infer<typeof schemas.theatre>
): void {
  const segments = getFrontlineSegments(campaign, theatre)
  if (segments.length === 0) return

  const missionWithDrawings = mission as typeof mission & {
    drawings?: MissionDrawings
  }
  const drawings = missionWithDrawings.drawings ?? { layers: [] }
  missionWithDrawings.drawings = drawings
  const existingLayers = new Map(drawings.layers.map((layer) => [layer.name, layer]))
  drawings.layers = DCS_DRAWING_LAYER_NAMES.map(
    (name) => existingLayers.get(name) ?? { visible: true, name, objects: [] }
  )
  const commonLayer = drawings.layers[3]
  if (!commonLayer) return

  const offsetSegment = (segment: (typeof segments)[number], offset: number) => {
    const dx = segment.end.x - segment.start.x
    const dy = segment.end.y - segment.start.y
    const length = Math.hypot(dx, dy)
    if (length === 0) return segment
    const ox = (-dy / length) * offset
    const oy = (dx / length) * offset
    return {
      start: { x: segment.start.x + ox, y: segment.start.y + oy },
      end: { x: segment.end.x + ox, y: segment.end.y + oy }
    }
  }

  const addLine = (
    name: string,
    segment: (typeof segments)[number],
    colorString: string
  ): DrawingLine => ({
    visible: true,
    colorString,
    lineMode: 'segments',
    mapY: segment.start.y,
    primitiveType: 'Line',
    style: 'solid',
    closed: false,
    thickness: 4,
    mapX: segment.start.x,
    layerName: commonLayer.name,
    name,
    points: {
      1: { x: 0, y: 0 },
      2: { x: segment.end.x - segment.start.x, y: segment.end.y - segment.start.y }
    }
  })

  segments.forEach((segment, index) => {
    const blueSegment = offsetSegment(segment, -250)
    const redSegment = offsetSegment(segment, 250)
    commonLayer.objects.push(
      addLine(`DCC Frontline Blue ${index + 1}`, blueSegment, '0x00ddffd9'),
      addLine(`DCC Frontline Red ${index + 1}`, redSegment, '0xff4d4fd9')
    )
  })
}

function addTransportCargoTriggers(
  mission: z.infer<typeof schemas.dcs.mission>,
  campaign: z.infer<typeof schemas.campaign.campaign>
): void {
  const nextMissionKey = () => {
    mission.currentKey += 1
    return mission.currentKey
  }

  const zones = mission.triggers?.zones ?? []
  if (!mission.triggers) {
    mission.triggers = { zones }
  } else {
    mission.triggers.zones = zones
  }

  if (!mission.trig) {
    mission.trig = {
      actions: {},
      events: {},
      custom: {},
      func: {},
      flag: {},
      conditions: {},
      customStartup: {},
      funcStartup: {}
    }
  }

  const trig = mission.trig as MissionTriggerTables
  const rawTrigrules: unknown = mission.trigrules
  const trigrules: MissionTriggerRules =
    rawTrigrules && typeof rawTrigrules === 'object' ? (rawTrigrules as MissionTriggerRules) : {}
  mission.trigrules = trigrules

  let trigIndex =
    Math.max(0, ...Object.keys(trig.actions).map((key) => Number.parseInt(key, 10))) + 1
  let ruleIndex = Math.max(0, ...Object.keys(trigrules).map((key) => Number.parseInt(key, 10))) + 1

  Object.values(campaign.coalitions).forEach((coalition) => {
    coalition.flightGroups.forEach((fg) => {
      if (fg.task !== 'Transport') return

      const directWp = fg.flightplan.waypoints.find((wp) => wp.name === 'Direct')
      if (!directWp) return

      const zoneId = nextMissionKey()

      zones.push({
        radius: 609.6,
        zoneId: zoneId,
        color: { 1: 1, 2: 1, 3: 1, 4: 0.15 },
        properties: {},
        hidden: false,
        y: directWp.position.y,
        x: directWp.position.x,
        name: 'Cargo',
        heading: 0,
        type: 0
      })

      const actionIndex = trigIndex
      trigIndex += 1

      trig.actions[actionIndex] =
        'a_out_text_delay(getValueDictByKey("DictKey_ActionText_6"), 10, false, 0);'
      trig.conditions[actionIndex] = `return(c_cargo_unhooked_in_zone("ANY_BLUE", ${zoneId}) )`
      trig.flag[actionIndex] = true
      trig.funcStartup[actionIndex] = createTriggerFunction(actionIndex)

      trigrules[ruleIndex] = {
        rules: {
          1: {
            predicate: 'c_cargo_unhooked_in_zone',
            cargo: 'ANY_BLUE',
            zone: zoneId
          }
        },
        eventlist: '',
        comment: 'Cargo Message',
        actions: {
          1: {
            seconds: 10,
            start_delay: 0,
            KeyDict_text: 'DictKey_ActionText_6',
            text: 'DictKey_ActionText_6',
            predicate: 'a_out_text_delay',
            clearview: false
          }
        },
        predicate: 'triggerStart'
      }

      ruleIndex += 1
    })
  })
}

type ObjectiveSurveyOptions = {
  objectiveIds?: string[]
  radius?: number
}

function addObjectiveSurveyZones(
  mission: z.infer<typeof schemas.dcs.mission>,
  theatre: z.infer<typeof schemas.theatre>,
  options: ObjectiveSurveyOptions
): void {
  const selectedObjectiveIds = options.objectiveIds
    ? new Set(options.objectiveIds)
    : new Set(theatre.objectives.map((objective) => objective.name))
  const zones = mission.triggers?.zones ?? []
  if (!mission.triggers) {
    mission.triggers = { zones }
  } else {
    mission.triggers.zones = zones
  }

  for (const objective of theatre.objectives) {
    if (!selectedObjectiveIds.has(objective.name)) continue

    mission.currentKey += 1
    zones.push({
      radius: options.radius ?? 1_500,
      zoneId: mission.currentKey,
      color: { 1: 1, 2: 0.75, 3: 0, 4: 0.18 },
      properties: {},
      hidden: false,
      y: objective.position.y,
      x: objective.position.x,
      name: `DCC_SURVEY_${objective.name}`,
      heading: 0,
      type: 0
    })
  }
}

type GenerateMizOptions = {
  objectiveSurvey?: ObjectiveSurveyOptions
}

export async function generateMizFromCampaign(
  campaign: z.infer<typeof schemas.campaign.campaign>,
  theatre: z.infer<typeof schemas.theatre>,
  path: string,
  generationOptions: GenerateMizOptions = {}
): Promise<Result<void, Error>> {
  // eslint-disable-next-line no-console
  console.log('generating miz file')

  const ewrEnabled = campaign.campaignParams?.ewr !== false
  const iadsRequested = campaign.campaignParams?.iads !== false

  const mission: z.infer<typeof schemas.dcs.mission> = {
    version: 23,
    theatre: theatre.dcsName ?? theatre.name,
    descriptionText: 'DictKey_descriptionText_1',
    descriptionRedTask: 'DictKey_descriptionRedTask_2',
    descriptionBlueTask: 'DictKey_descriptionBlueTask_3',
    descriptionNeutralsTask: 'DictKey_descriptionNeutralsTask_4',
    sortie: 'DictKey_sortie_5',
    currentKey: 137,
    maxDictId: 6,
    start_time:
      campaign.time.getUTCHours() * 3600 +
      campaign.time.getUTCMinutes() * 60 +
      campaign.time.getUTCSeconds(),
    date: {
      Day: campaign.time.getUTCDate(),
      Year: campaign.time.getUTCFullYear(),
      Month: campaign.time.getUTCMonth() + 1
    },
    map: createMissionMapConfig(theatre),
    goals: [],
    weather: {
      name: 'Winter, clean sky',
      atmosphere_type: 0,
      wind: {
        at8000: {
          speed: theatre.info.weather.wind.speed,
          dir: theatre.info.weather.wind.direction
        },
        atGround: {
          speed: theatre.info.weather.wind.speed,
          dir: theatre.info.weather.wind.direction
        },
        at2000: {
          speed: theatre.info.weather.wind.speed,
          dir: theatre.info.weather.wind.direction
        }
      },
      enable_dust: false,
      dust_density: 0,
      qnh: 760,
      groundTurbulence: 0,
      type_weather: 0,
      season: { temperature: 20 },
      visibility: { distance: 80000 },
      clouds: {
        density: 0,
        thickness: 200,
        preset: 'Preset2',
        base: 2500,
        iprecptns: 0
      },
      cyclones: [],
      name_ru: 'Лето. Штиль',
      name_cn: '夏季 晴天+无风',
      name_de: 'Sommer, Klar',
      name_fr: 'Eté, ciel dégagé, vent nul',
      name_es: 'Verano. Despejado',
      halo: { preset: 'auto' }
    },
    coalitions: {
      neutrals: [
        91, 70, 83, 23, 65, 86, 64, 25, 63, 76, 84, 90, 29, 62, 30, 78, 87, 31, 61, 32, 33, 60, 17,
        35, 69, 36, 59, 71, 79, 58, 57, 56, 55, 92, 88, 73, 39, 89, 54, 77, 72, 41, 42, 44, 85, 75,
        53, 22, 52, 66, 51, 74, 82, 7, 68, 50, 49, 48, 67
      ],
      blue: [21, 11, 8, 80, 28, 26, 13, 5, 16, 6, 15, 20, 12, 40, 45, 9, 46, 10, 3, 4, 1, 2],
      red: [18, 24, 27, 81, 34, 37, 38, 0, 43, 19, 47]
    },
    coalition: {
      neutrals: {
        bullseye: { y: 0, x: 0 },
        nav_points: [],
        name: 'neutrals',
        country: []
      },
      blue: {
        bullseye: { y: 617414, x: -291014 },
        nav_points: [],
        name: 'blue',
        country: [
          {
            id: 2,
            name: 'USA',
            plane: {
              group: []
            },
            static: {
              group: []
            },
            vehicle: {
              group: []
            }
          }
        ]
      },
      red: {
        bullseye: { y: 371700, x: 11557 },
        nav_points: [],
        name: 'red',
        country: [
          {
            id: 0,
            name: 'USA',
            plane: {
              group: []
            },
            static: {
              group: []
            },
            vehicle: {
              group: []
            }
          }
        ]
      }
    },
    result: {
      offline: { conditions: {}, actions: {}, func: {} },
      total: 0,
      blue: { conditions: {}, actions: {}, func: {} },
      red: { conditions: {}, actions: {}, func: {} }
    },
    groundControl: {
      passwords: {
        artillery_commander: {},
        instructor: {},
        observer: {},
        forward_observer: {}
      },
      roles: {
        artillery_commander: { neutrals: 0, blue: 0, red: 0 },
        instructor: { neutrals: 0, blue: 0, red: 0 },
        observer: { neutrals: 0, blue: 0, red: 0 },
        forward_observer: { neutrals: 0, blue: 0, red: 0 }
      },
      isPilotControlVehicles: false
    },
    trig: {
      actions: {
        1: createLoggedStartupAction(
          'Loading config',
          `a_do_script("config = { missionId = '${campaign.id}', flightGroups = {} }")`
        ),
        2: createLoggedStartupAction('Loading mist', createDoScriptFileAction('ResKey_Action_10')),
        3: createLoggedStartupAction('Loading state', createDoScriptFileAction('ResKey_Action_8')),
        4: createLoggedStartupAction('Loading ctld', createDoScriptFileAction('ResKey_Action_17')),
        5: createLoggedStartupAction(
          'Loading splash damage',
          createDoScriptFileAction('ResKey_Action_7')
        ),
        6: createLoggedStartupAction('Loading cas', createDoScriptFileAction('ResKey_Action_16')),
        10: createLoggedStartupAction(
          'Loading navigation',
          createDoScriptFileAction('ResKey_Action_21')
        ),
        11: createLoggedStartupAction(
          'Scheduling welcome message',
          createDoScriptAction(createWelcomeMessageScript())
        ),
        ...(ewrEnabled
          ? {
              7: createLoggedStartupAction(
                'Loading ewr',
                createDoScriptFileAction('ResKey_Action_18')
              )
            }
          : {}),
        ...(iadsRequested
          ? {
              8: createLoggedStartupAction(
                'Loading Skynet IADS',
                createDoScriptFileAction('ResKey_Action_19')
              ),
              9: createLoggedStartupAction(
                'Loading DCC IADS',
                createDoScriptFileAction('ResKey_Action_20')
              )
            }
          : {})
      },
      events: {},
      custom: {},
      func: {},
      flag: {
        1: true,
        2: true,
        3: true,
        4: true,
        5: true,
        6: true,
        10: true,
        11: true,
        ...(ewrEnabled ? { 7: true } : {}),
        ...(iadsRequested ? { 8: true, 9: true } : {})
      },
      conditions: {
        1: 'return(true)',
        2: 'return(true)',
        3: 'return(true)',
        4: 'return(true)',
        5: 'return(true)',
        6: 'return(true)',
        10: 'return(true)',
        11: 'return(true)',
        ...(ewrEnabled ? { 7: 'return(true)' } : {}),
        ...(iadsRequested ? { 8: 'return(true)', 9: 'return(true)' } : {})
      },
      customStartup: {},
      funcStartup: createTriggerFunctionMap(getStartupTriggerIndexes(ewrEnabled, iadsRequested))
    },
    trigrules: {
      1: {
        rules: {},
        eventlist: '',
        predicate: 'triggerStart',
        comment: 'DCC Config',
        actions: {
          1: { predicate: 'a_do_script', text: `config = { missionId = '${campaign.id}' }` }
        },
        colorItem: '0x00ffffff'
      },
      2: {
        rules: {},
        eventlist: '',
        predicate: 'triggerStart',
        comment: 'MIST Script',
        actions: { 1: { predicate: 'a_do_script_file', file: 'ResKey_Action_10' } },
        colorItem: '0x00ffffff'
      },
      3: {
        rules: {},
        eventlist: '',
        predicate: 'triggerStart',
        comment: 'DCC State Script',
        actions: { 1: { predicate: 'a_do_script_file', file: 'ResKey_Action_8' } },
        colorItem: '0x00ffffff'
      },
      4: {
        rules: {},
        eventlist: '',
        predicate: 'triggerStart',
        comment: 'CTLD Script',
        actions: { 1: { predicate: 'a_do_script_file', file: 'ResKey_Action_17' } },
        colorItem: '0x00ffffff'
      },
      5: {
        rules: {},
        eventlist: '',
        predicate: 'triggerStart',
        comment: 'Splash Damage Script',
        actions: { 1: { predicate: 'a_do_script_file', file: 'ResKey_Action_7' } },
        colorItem: '0x00ffffff'
      },
      6: {
        rules: {},
        eventlist: '',
        predicate: 'triggerStart',
        comment: 'CAS JTAC Script',
        actions: { 1: { predicate: 'a_do_script_file', file: 'ResKey_Action_16' } },
        colorItem: '0x00ffffff'
      },
      10: {
        rules: {},
        eventlist: '',
        predicate: 'triggerStart',
        comment: 'DCC Navigation Script',
        actions: { 1: { predicate: 'a_do_script_file', file: 'ResKey_Action_21' } },
        colorItem: '0x00ffffff'
      },
      11: {
        rules: {},
        eventlist: '',
        predicate: 'triggerStart',
        comment: 'DCC Welcome Message',
        actions: { 1: { predicate: 'a_do_script', text: createWelcomeMessageScript() } },
        colorItem: '0x00ffffff'
      },
      ...(ewrEnabled
        ? {
            7: {
              rules: {},
              eventlist: '',
              predicate: 'triggerStart',
              comment: 'EWR Script',
              actions: { 1: { predicate: 'a_do_script_file', file: 'ResKey_Action_18' } },
              colorItem: '0x00ffffff'
            }
          }
        : {}),
      ...(iadsRequested
        ? {
            8: {
              rules: {},
              eventlist: '',
              predicate: 'triggerStart',
              comment: 'Skynet IADS Script',
              actions: { 1: { predicate: 'a_do_script_file', file: 'ResKey_Action_19' } },
              colorItem: '0x00ffffff'
            },
            9: {
              rules: {},
              eventlist: '',
              predicate: 'triggerStart',
              comment: 'DCC IADS Script',
              actions: { 1: { predicate: 'a_do_script_file', file: 'ResKey_Action_20' } },
              colorItem: '0x00ffffff'
            }
          }
        : {})
    },
    triggers: {
      zones: []
    }
  }

  const cullingPlan = buildMissionCullingPlan(campaign, theatre)

  if (generationOptions.objectiveSurvey) {
    addObjectiveSurveyZones(mission, theatre, generationOptions.objectiveSurvey)
  }

  configureMissionCountries(mission, campaign)

  const navalGroupsResult = addNavalGroups(mission, campaign)
  if (navalGroupsResult.isErr()) {
    return err(navalGroupsResult.error)
  }

  const structuresResult = addStructures(mission, campaign, theatre, cullingPlan)
  if (structuresResult.isErr()) {
    return err(structuresResult.error)
  }

  const groundGroupsResult = addGroundGroups(mission, campaign, theatre, cullingPlan)
  if (groundGroupsResult.isErr()) {
    return err(groundGroupsResult.error)
  }

  const germanyIads = addGermanyIads(mission, campaign, theatre, cullingPlan)
  const iadsConfig = buildIadsConfig(mission, campaign)
  if (iadsConfig && germanyIads) {
    iadsConfig.commandCenters.push(...germanyIads.commandCenters)
  }
  if (iadsRequested && !iadsConfig) {
    delete (mission.trig as MissionTriggerTables).actions[8]
    delete (mission.trig as MissionTriggerTables).actions[9]
    delete (mission.trig as MissionTriggerTables).flag[8]
    delete (mission.trig as MissionTriggerTables).flag[9]
    delete (mission.trig as MissionTriggerTables).conditions[8]
    delete (mission.trig as MissionTriggerTables).conditions[9]
    delete (mission.trig as MissionTriggerTables).funcStartup[8]
    delete (mission.trig as MissionTriggerTables).funcStartup[9]
    delete (mission.trigrules as MissionTriggerRules)[8]
    delete (mission.trigrules as MissionTriggerRules)[9]
  }

  const flightGroupsResult = addFlightGroups(mission, campaign, theatre)
  if (flightGroupsResult.isErr()) {
    return err(flightGroupsResult.error)
  }
  const gciStations = addPlayerGciStations(mission, campaign, theatre, cullingPlan, {
    enabled: ewrEnabled
  })
  const carrierOps = createCarrierOpsConfig(campaign)
  const welcomeMessage = createWelcomeMessage(flightGroupsResult.value, {
    ewrEnabled,
    carrierOpsEnabled: carrierOps.length > 0,
    gciStationEnabled: gciStations.length > 0
  })
  const scriptConfig: MissionScriptConfig = {
    missionId: campaign.id,
    flightGroups: flightGroupsResult.value,
    ...(carrierOps.length > 0 ? { carrierOps } : {}),
    crashPilotSurvivalChance: config.packages.CSAR.pilotSurvivalChance,
    ...(welcomeMessage ? { welcomeMessage } : {}),
    ...(cullingPlan.enabled ? { cullingManifest: cullingPlan.manifest } : {}),
    ...(theatre.info.magneticVariationDegrees != null
      ? { magneticVariationDegrees: theatre.info.magneticVariationDegrees }
      : {})
  }
  const scriptConfigLuaResult = luaTable.stringify(scriptConfig, {
    mixedKeyTypes: true,
    pretty: false
  })
  if (scriptConfigLuaResult.isErr()) {
    return err(scriptConfigLuaResult.error)
  }
  const scriptConfigLua = scriptConfigLuaResult.value
  const trig = mission.trig as MissionTriggerTables
  const trigrules = mission.trigrules as MissionTriggerRules
  const configTriggerRule = trigrules[1]
  if (!configTriggerRule) {
    return err(new Error('Mission config trigger rule is missing'))
  }
  const configScript = `config = ${scriptConfigLua}`
  trig.actions[1] = createLoggedStartupAction('Loading config', createDoScriptAction(configScript))
  configTriggerRule.actions[1] = {
    predicate: 'a_do_script',
    text: configScript
  }

  if (iadsConfig) {
    const iadsConfigScriptResult = createIadsConfigScript(iadsConfig)
    if (iadsConfigScriptResult.isErr()) {
      return err(iadsConfigScriptResult.error)
    }

    const iadsTriggerRule = trigrules[9]
    if (!iadsTriggerRule) {
      return err(new Error('DCC IADS trigger rule is missing'))
    }
    const iadsAction = `${createDoScriptAction(iadsConfigScriptResult.value)}; ${createDoScriptFileAction('ResKey_Action_20')}`
    trig.actions[9] = createLoggedStartupAction('Loading DCC IADS', iadsAction)
    iadsTriggerRule.actions[1] = {
      predicate: 'a_do_script',
      text: iadsConfigScriptResult.value
    }
    iadsTriggerRule.actions[2] = {
      predicate: 'a_do_script_file',
      file: 'ResKey_Action_20'
    }
  }

  addTransportCargoTriggers(mission, campaign)

  const awacsResult = addAwacsGroups(mission, campaign, theatre)
  if (awacsResult.isErr()) {
    return awacsResult
  }

  addFrontlineDrawings(mission, campaign, theatre)

  const missionLuaResult = luaTable.stringify(mission, { mixedKeyTypes: true })
  if (missionLuaResult.isErr()) {
    return err(missionLuaResult.error)
  }
  const missionLua = missionLuaResult.value

  const optionsLuaResult = luaTable.stringify(options(campaign), { mixedKeyTypes: true })
  if (optionsLuaResult.isErr()) {
    return err(optionsLuaResult.error)
  }
  const optionsLua = optionsLuaResult.value

  const warehousesLuaResult = luaTable.stringify(warehouses(theatre, campaign, mission), {
    mixedKeyTypes: true
  })
  if (warehousesLuaResult.isErr()) {
    return err(warehousesLuaResult.error)
  }
  const warehousesLua = warehousesLuaResult.value

  const dictionaryLuaResult = luaTable.stringify(dictionary(), { mixedKeyTypes: true })
  if (dictionaryLuaResult.isErr()) {
    return err(dictionaryLuaResult.error)
  }
  const dictionaryLua = dictionaryLuaResult.value

  const mapResourceLuaResult = luaTable.stringify(mapResource(), { mixedKeyTypes: true })
  if (mapResourceLuaResult.isErr()) {
    return err(mapResourceLuaResult.error)
  }
  const mapResourceLua = mapResourceLuaResult.value

  let kneeboardImages
  try {
    kneeboardImages = await createKneeboardImages({
      campaign,
      theatre,
      missionFlightConfigs: flightGroupsResult.value
    })
  } catch (error) {
    if (error instanceof Error) {
      return err(error)
    }
    return err(new Error('Unknown error generating kneeboard images'))
  }

  const zip = new AdmZip()
  // DCS expects explicit directory entries in addition to the files below them.
  // Some ZIP readers infer these folders, but the Mission Editor does not do so reliably.
  zip.addFile('l10n/', Buffer.alloc(0))
  zip.addFile('l10n/DEFAULT/', Buffer.alloc(0))
  if (kneeboardImages.length > 0) {
    zip.addFile('KNEEBOARD/', Buffer.alloc(0))
    zip.addFile('KNEEBOARD/IMAGES/', Buffer.alloc(0))
  }
  zip.addFile('mission', Buffer.from('mission = ' + missionLua, 'utf-8'))
  zip.addFile('options', Buffer.from('options = ' + optionsLua, 'utf-8'))
  zip.addFile('theatre', Buffer.from(theatre.dcsName ?? theatre.name, 'utf-8'))
  zip.addFile('warehouses', Buffer.from('warehouses = ' + warehousesLua, 'utf-8'))
  zip.addFile('l10n/DEFAULT/dictionary', Buffer.from('dictionary = ' + dictionaryLua, 'utf-8'))
  zip.addFile('l10n/DEFAULT/mapResource', Buffer.from('mapResource = ' + mapResourceLua, 'utf-8'))
  zip.addFile('l10n/DEFAULT/mist.lua', Buffer.from(mistLuaScript, 'utf-8'))
  zip.addFile('l10n/DEFAULT/state.lua', Buffer.from(stateLuaScript, 'utf-8'))
  zip.addFile('l10n/DEFAULT/ctld.lua', Buffer.from(ctldLuaScript, 'utf-8'))
  zip.addFile('l10n/DEFAULT/splash_damage.lua', Buffer.from(splashDamageLuaScript, 'utf-8'))
  zip.addFile('l10n/DEFAULT/cas.lua', Buffer.from(casLuaScript, 'utf-8'))
  zip.addFile('l10n/DEFAULT/ewr.lua', Buffer.from(ewrLuaScript, 'utf-8'))
  zip.addFile('l10n/DEFAULT/navigation.lua', Buffer.from(navigationLuaScript, 'utf-8'))
  if (iadsConfig) {
    zip.addFile('l10n/DEFAULT/skynet-iads.lua', Buffer.from(skynetIadsLuaScript, 'utf-8'))
    zip.addFile('l10n/DEFAULT/dcc_iads.lua', Buffer.from(dccIadsLuaScript, 'utf-8'))
  }
  kneeboardImages.forEach((image) => {
    zip.addFile(`KNEEBOARD/IMAGES/${image.filename}`, image.buffer)
  })
  try {
    zip.writeZip(path)
    // eslint-disable-next-line no-console
    console.log('🚀 mission saved to', path)
    return ok(undefined)
  } catch (error) {
    if (error instanceof Error) {
      return err(error)
    }
    return err(new Error('Unknown error writing zip file'))
  }
}
