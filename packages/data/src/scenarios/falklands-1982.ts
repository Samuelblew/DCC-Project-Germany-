import { schemas } from '@dcc/contracts'
import * as z from 'zod'

const operationalGroup = (
  id: string,
  name: string,
  role: 'carrier' | 'escort' | 'transport' | 'surface-combatant',
  unitTypes: string[],
  position: { x: number; y: number },
  heading: number,
  cargo = 0,
  missionGroupId?: string
) => ({
  id,
  name,
  role,
  missionGroupId,
  unitTypes,
  units: unitTypes.map((type, index) => ({
    id: `${id}-ship-${index + 1}`,
    type,
    damage: 0,
    ammunition: 1,
    fuel: 1,
    state: 'operational' as const
  })),
  position,
  heading,
  damage: 0,
  fuel: 1,
  ammunition: 1,
  cargo,
  state: 'operational' as const
})

const radians = (degrees: number) => (degrees * Math.PI) / 180

export const Falklands1982: z.infer<typeof schemas.scenario> = {
  theatreName: 'SouthAtlantic',
  id: 'falklands-1982',
  name: 'Operation Corporate — Falklands 1982',
  sideSelectable: false,
  // Enabled after reviewed objectives, routes, deployment sites, airfields, and DCS mission smoke test.
  available: true,
  era: 'Late CW',
  defaultFactionIds: {
    player: 'uk-1982',
    opponent: 'argentina-1982-official'
  },
  date: new Date('1982-05-01T09:00:00Z'),
  briefing:
    'Lead the UK task force from sea control through the San Carlos landing and the land campaign for Stanley. The historical order of battle is represented with DCS substitutions where no exact flyable aircraft or unit exists. The accelerated campaign remains a sandbox: preserve carrier capability, amphibious lift, and expeditionary supply while suppressing the naval, radar, and air-defense threat.',
  goal: {
    coalition: 'player',
    objectiveIds: ['Port Stanley', 'Stanley Airport']
  },
  deferredObjectiveIds: ['San Carlos', 'Port San Carlos'],
  start: {
    player: {
      airdromeNames: [],
      groundGroupSpawnMultiplier: 1,
      objectiveIds: []
    },
    opponent: {
      airdromeNames: ['Stanley Airport', 'Rio Grande', 'Rio Gallegos', 'San Julian'],
      groundGroupSpawnMultiplier: 1,
      objectiveIds: [
        'Port Stanley',
        'Stanley Airport',
        'Darwin',
        'Goose Green',
        'Fox Bay',
        'Port Howard',
        'Evelyn Station Farm',
        'Mount Kent',
        'Two Sisters',
        'Mount Longdon',
        'Wireless Ridge',
        'Mount Tumbledown',
        'Fitzroy',
        'Bluff Cove',
        'Ajax Bay',
        'Douglas Settlement',
        "L'Antioja",
        'Estancia House',
        'Mount Challenger',
        'Mount Harriet',
        'Sapper Hill',
        'Moody Brook',
        'Murrell Farm',
        'Port Louis',
        "Johnson's Harbour",
        'Volunteer Point',
        'Cape Dolphin',
        'Little Creek',
        'Bull Point',
        'North Arm',
        'Swan Inlet',
        'Port Harriet',
        'Mount Usborne',
        'Hill Cove',
        'Roy Cove',
        'Chartres',
        'Port Stephens',
        'Port Edgar',
        'Pebble Island',
        'Shallow Bay',
        'Warrah River',
        'Rio Grande',
        'Rio Gallegos',
        'San Julian'
      ]
    }
  },
  navalGroups: {
    player: [
      {
        ...operationalGroup(
          'uk-carrier-group',
          'UK Carrier Group',
          'carrier',
          // Tarawa's larger flight deck gives DCS AI enough room for reliable Harrier operations.
          ['LHA_Tarawa'],
          // The historical carrier area was farther east, beyond the terrain boundary. This is near
          // the eastern edge while retaining the margin required by DCS coordinate conversion.
          { x: 87_610, y: 184_267 },
          radians(270)
        ),
        tacan: { channel: 11, band: 'X' as const, callsign: 'HMS' }
      },
      operationalGroup(
        'uk-escort-group',
        'UK Escort Screen',
        'escort',
        ['leander-gun-achilles', 'leander-gun-andromeda', 'leander-gun-ariadne'],
        { x: 82_610, y: 190_267 },
        radians(270),
        0,
        'uk-carrier-group'
      ),
      operationalGroup(
        'uk-amphibious-group',
        'San Carlos Amphibious Group',
        'transport',
        ['atconveyor', 'CastleClass_01'],
        // Ascension is outside the terrain. Start northeast of the islands as an inbound
        // abstraction, inside the coordinate grid; the campaign moves this group into San Carlos
        // Water only when the landing starts.
        { x: 332_376, y: 147_640 },
        radians(210),
        1_000
      )
    ],
    opponent: [
      {
        ...operationalGroup(
          'arg-surface-group',
          'Argentine Surface Group',
          'surface-combatant',
          // Three gun-only Leanders abstract the Belgrano group without adding missile air defenses,
          // allowing the AV-8B to attack safely with laser-guided bombs from high altitude.
          ['leander-gun-achilles', 'leander-gun-andromeda', 'leander-gun-ariadne'],
          // Roughly 20 NM south of Bull Point, the southern tip of East Falkland.
          { x: -22_010, y: -8_141 },
          radians(45)
        ),
        missionPatrol: { pattern: 'circle' as const, radius: 2_500, speed: 3 },
        persistPosition: false
      }
    ]
  }
}
