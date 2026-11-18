import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

const playerAirfields = [
  'Batumi',
  'Kobuleti',
  'Senaki-Kolkhi',
  'Kutaisi',
  'Sukhumi-Babushara',
  'Gudauta',
  'Tbilisi-Lochini',
  'Soganlug',
  'Vaziani'
]

const playerTowns = [
  'Ozurgeti',
  'Lanchkhuti',
  'Poti',
  'Zugdidi',
  'Dzhvari',
  'Mestia',
  'Abasha',
  'Martvili',
  'Samtredia',
  'Tskaltubo',
  'Tkibuli',
  'Ambrolauri',
  'Oni',
  'Glola',
  'Zestafoni',
  'Chiatura',
  'Sachkhere',
  'Khashuri',
  'Kareli',
  'Gori',
  'Kaspi',
  'Tskhinvali',
  'Java',
  'Mtskheta',
  'Pasanauri',
  'Kazbegi',
  'Rustavi',
  'Gali',
  'Ochamchira',
  'Tkvarcheli',
  'Sukhumi',
  'Tsebelda',
  'Azhara'
]

const opponentAirfields = [
  'Anapa-Vityazevo',
  'Krasnodar-Center',
  'Novorossiysk',
  'Krymsk',
  'Maykop-Khanskaya',
  'Gelendzhik',
  'Sochi-Adler',
  'Krasnodar-Pashkovsky',
  'Mineralnye Vody',
  'Nalchik',
  'Mozdok',
  'Beslan'
]

const opponentTowns = [
  'Sochi',
  'Lazarevskoe',
  'Tuapse',
  'Dzhubga',
  'Apsheronsk',
  'Belorechensk',
  'Ust-Labinsk',
  'Abinsk',
  'Slavyansk-na-Kubani',
  'Temryuk',
  'Gubskaya',
  'Kaladzhinskaya',
  'Udobnaya',
  'Teberda',
  'Karachaevsk',
  'Ust-Dzheguta',
  'Cherkessk',
  'Suvorovskaya',
  'Kislovodsk',
  'Pyatigorsk',
  'Georgievsk',
  'Novopavlovsk',
  'Baksan',
  'Tyrnyauz',
  'Maysky',
  'Prokhladny',
  'Digora',
  'Zaramag',
  'Alagir',
  'Vladikavkaz'
]

/** Supply depots behind each of the five ridge crossings. */
const depotTowns = new Set([
  'Zugdidi',
  'Sukhumi',
  'Ambrolauri',
  'Gori',
  'Mtskheta',
  'Sochi',
  'Karachaevsk',
  'Alagir',
  'Vladikavkaz',
  'Pyatigorsk'
])

function townStructures(towns: string[]) {
  return towns.flatMap((objectiveId) => {
    const assignments: Array<{ objectiveId: string; type: 'Barrack' | 'Depot' }> = [
      { objectiveId, type: 'Barrack' }
    ]
    if (depotTowns.has(objectiveId)) assignments.push({ objectiveId, type: 'Depot' })
    return assignments
  })
}

type Industry = {
  objectiveId: string
  type: 'Factory' | 'Factory 2' | 'Power Plant' | 'Fuel Storage' | 'Command Center'
}

const playerIndustry: Industry[] = [
  { objectiveId: 'Rustavi', type: 'Factory' },
  { objectiveId: 'Zestafoni', type: 'Factory 2' },
  { objectiveId: 'Tkibuli', type: 'Power Plant' },
  { objectiveId: 'Batumi', type: 'Fuel Storage' },
  { objectiveId: 'Tbilisi-Lochini', type: 'Command Center' }
]

const opponentIndustry: Industry[] = [
  { objectiveId: 'Krasnodar-Center', type: 'Factory' },
  { objectiveId: 'Nalchik', type: 'Factory 2' },
  { objectiveId: 'Mozdok', type: 'Power Plant' },
  { objectiveId: 'Tuapse', type: 'Fuel Storage' },
  { objectiveId: 'Novorossiysk', type: 'Fuel Storage' },
  { objectiveId: 'Pyatigorsk', type: 'Command Center' }
]

export const CaucasusRidge: z.infer<typeof schemas.scenario> = {
  theatreName: 'Cold War Caucasus',
  id: 'caucasus-ridge',
  name: 'Caucasus Ridge',
  available: true,
  date: new Date('1988-07-15T08:00:00Z'),
  era: 'Late CW',
  defaultFactionIds: {
    player: 'usa-1977',
    opponent: 'russia-1984'
  },
  briefing:
    'NATO holds the Transcaucasus, from Batumi and Sukhumi to Tbilisi. The Soviet North Caucasus and the Kuban hold everything north of the ridge, from Sochi to Krasnodar and Mozdok.\n\nThe Greater Caucasus can only be crossed in five places: the coast road at Gudauta, the Klukhor pass above Sukhumi, the Mamison pass above Oni, the Roki tunnel above Java and the Georgian Military Road at Kazbegi. Every crossing is covered by the Soviet SA-2, SA-3, SA-11 and S-300 belt. Force a pass and take Mineralnye Vody before the Soviets come down the Military Road to Tbilisi.',
  durationDays: 30,
  goal: {
    coalition: 'player',
    objectiveIds: ['Mineralnye Vody']
  },
  opponentGoal: {
    coalition: 'opponent',
    objectiveIds: ['Tbilisi-Lochini']
  },
  opponentBriefing:
    'The Soviet North Caucasus and the Kuban hold everything north of the ridge, from Sochi to Krasnodar and Mozdok. NATO holds the Transcaucasus, from Batumi and Sukhumi to Tbilisi.\n\nThe Greater Caucasus can only be crossed in five places: the coast road at Gudauta, the Klukhor pass from Teberda, the Mamison pass and the Roki tunnel from Zaramag, and the Georgian Military Road from Vladikavkaz. Keep the air defence belt standing over the passes and take Tbilisi before NATO reaches Mineralnye Vody.',
  start: {
    player: {
      airdromeNames: playerAirfields,
      groundGroupSpawnMultiplier: 2,
      objectiveIds: [...playerAirfields, ...playerTowns],
      structureAssignments: [...townStructures(playerTowns), ...playerIndustry]
    },
    opponent: {
      airdromeNames: opponentAirfields,
      groundGroupSpawnMultiplier: 1,
      objectiveIds: [...opponentAirfields, ...opponentTowns],
      structureAssignments: [...townStructures(opponentTowns), ...opponentIndustry]
    }
  }
}
