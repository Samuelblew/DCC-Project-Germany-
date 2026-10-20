import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

const playerTowns = [
  'Bordesholm',
  'Neumunster',
  'Bad Segeberg',
  'Bad Oldesloe',
  'Lubeck',
  'Schonberg',
  'Lehrte',
  'Peine',
  'Braunschweig',
  'Konigslutter',
  'Helmstedt',
  'Borken',
  'Schwalmstadt',
  'Alsfeld',
  'Lauterbach',
  'Hunfeld',
  'Geisa',
  'Schluchtern',
  'Gelnhausen',
  'Hanau'
]

const opponentTowns = [
  'Grevesmuhlen',
  'Wismar',
  'Neukloster',
  'Butzow',
  'Gustrow',
  'Haldensleben',
  'Eilsleben',
  'Oschersleben',
  'Calbe',
  'Kothen',
  'Bitterfeld',
  'Vacha',
  'Eisenach',
  'Gotha',
  'Erfurt',
  'Weimar',
  'Apolda',
  'Naumburg',
  'Lutzen',
  'Burg',
  'Genthin',
  'Brandenburg',
  'Werder',
  'Potsdam'
]

const depotTowns = new Set([
  'Schonberg',
  'Helmstedt',
  'Geisa',
  'Grevesmuhlen',
  'Haldensleben',
  'Vacha'
])

function industry(
  sites: Array<{
    objectiveId: string
    type:
      | 'Factory'
      | 'Factory 2'
      | 'Power Plant'
      | 'Fuel Storage'
      | 'Command Center'
      | 'Oil Platform'
  }>
) {
  return sites
}

const playerIndustry = industry([
  { objectiveId: 'Braunschweig', type: 'Factory' },
  { objectiveId: 'Hannover', type: 'Factory 2' },
  { objectiveId: 'Hanau', type: 'Factory' },
  { objectiveId: 'Helmstedt', type: 'Power Plant' },
  { objectiveId: 'Hamburg', type: 'Fuel Storage' },
  { objectiveId: 'Frankfurt', type: 'Command Center' },
  { objectiveId: 'Schwedeneck A', type: 'Oil Platform' },
  { objectiveId: 'Schwedeneck B', type: 'Oil Platform' }
])

const opponentIndustry = industry([
  { objectiveId: 'Eisenach', type: 'Factory' },
  { objectiveId: 'Gotha', type: 'Factory 2' },
  { objectiveId: 'Erfurt', type: 'Factory' },
  { objectiveId: 'Bitterfeld', type: 'Factory' },
  { objectiveId: 'Bitterfeld', type: 'Power Plant' },
  { objectiveId: 'Kothen', type: 'Fuel Storage' },
  { objectiveId: 'Potsdam', type: 'Command Center' }
])
function goalStructures(objectiveId: string) {
  return [
    { objectiveId, type: 'Barrack' as const },
    { objectiveId, type: 'Depot' as const }
  ]
}

function frontStructures(towns: string[]) {
  return towns.flatMap((objectiveId) => {
    const assignments: Array<{ objectiveId: string; type: 'Barrack' | 'Depot' }> = [
      { objectiveId, type: 'Barrack' }
    ]
    if (depotTowns.has(objectiveId)) {
      assignments.push({ objectiveId, type: 'Depot' })
    }
    return assignments
  })
}

export const FuldaGap: z.infer<typeof schemas.scenario> = {
  theatreName: 'Cold War Germany',
  id: 'fulda-gap',
  name: 'Fulda Gap',
  available: true,
  date: new Date('1985-06-15T09:00:00Z'),
  era: 'Late CW',
  defaultFactionIds: {
    player: 'usa-1977',
    opponent: 'russia-1984'
  },
  briefing:
    'NATO holds western Germany, from the Baltic bases to Frankfurt, Fulda and Fritzlar. The Warsaw Pact holds the east, including Tegel, Gatow and Tempelhof.\n\nThe ground front is the border towns, each within march range of the next, from Lubeck and Helmstedt down through the Fulda Gap toward Leipzig. The army holds for the first two hours while the air war hits airfields and command. After eight hours the bombers go for factories, power plants and the Schwedeneck oil platforms in the Bay of Kiel. A base replaces a sortie over hours, not seconds. Take Leipzig before the Pact pushes those towns west.',
  // Like the BMS Rolling Fire campaign: thirty days to reach the goal, then a stalemate.
  durationDays: 30,
  goal: {
    coalition: 'player',
    objectiveIds: ['Leipzig Mockau']
  },
  opponentGoal: {
    coalition: 'opponent',
    objectiveIds: ['Frankfurt']
  },
  opponentBriefing:
    'The Warsaw Pact holds the east, including Tegel, Gatow and Tempelhof. NATO holds western Germany, from the Baltic bases to Frankfurt, Fulda and Fritzlar.\n\nThe ground front is the border towns, each within march range of the next, from Grevesmuhlen and Haldensleben to Vacha at the Fulda Gap. The army holds for the first two hours while the air war hits airfields and command. After eight hours the bombers go for factories, power plants and the Schwedeneck oil platforms in the Bay of Kiel. A base replaces a sortie over hours, not seconds. Push through the gap and take Frankfurt before NATO reaches Leipzig.',
  start: {
    player: {
      airdromeNames: [
        'Ramstein',
        'Spangdahlem',
        'Hahn',
        'Bitburg',
        'Sembach',
        'Zweibrucken',
        'Pferdsfeld',
        'Mendig',
        'Wiesbaden',
        'Kiel',
        'Hamburg',
        'Hannover',
        'Cologne',
        'Fulda',
        'Frankfurt',
        'Fritzlar'
      ],
      groundGroupSpawnMultiplier: 2,
      objectiveIds: [
        'Ramstein',
        'Spangdahlem',
        'Hahn',
        'Bitburg',
        'Sembach',
        'Zweibrucken',
        'Pferdsfeld',
        'Mendig',
        'Wiesbaden',
        'Kiel',
        'Hamburg',
        'Hannover',
        'Schwedeneck A',
        'Schwedeneck B',
        'Cologne',
        'Fulda',
        'Frankfurt',
        'Fritzlar',
        ...playerTowns
      ],
      structureAssignments: [
        ...frontStructures(playerTowns),
        ...goalStructures('Frankfurt'),
        ...playerIndustry
      ]
    },
    opponent: {
      airdromeNames: [
        'Laage',
        'Schonefeld',
        'Leipzig Mockau',
        'Cochstedt',
        'Tempelhof',
        'Tegel',
        'Gatow'
      ],
      groundGroupSpawnMultiplier: 1,
      objectiveIds: [
        'Laage',
        'Schonefeld',
        'Leipzig Mockau',
        'Cochstedt',
        'Tempelhof',
        'Tegel',
        'Gatow',
        ...opponentTowns
      ],
      structureAssignments: [
        ...frontStructures(opponentTowns),
        ...goalStructures('Leipzig Mockau'),
        ...opponentIndustry
      ]
    }
  }
}
