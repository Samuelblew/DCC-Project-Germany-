import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

type Connection = z.infer<typeof schemas.objectiveConnection>

function road(from: string, to: string): Connection {
  return { from, to, mode: 'road', bidirectional: true, waypoints: [] }
}

function chain(names: string[]): Connection[] {
  const connections: Connection[] = []
  for (let index = 0; index < names.length - 1; index += 1) {
    const from = names[index]
    const to = names[index + 1]
    if (from && to) connections.push(road(from, to))
  }
  return connections
}

/**
 * Whole-map Caucasus hop graph. The ridge is crossed in five places: the Black Sea coast road
 * (Gudauta–Sochi), the Klukhor pass (Azhara–Teberda), the Mamison pass (Glola–Zaramag), the Roki
 * tunnel (Java–Zaramag) and the Georgian Military Road (Kazbegi–Vladikavkaz). Every hop stays
 * inside infantry assault range (40 NM); the passes get a town on each side for that. Geography is
 * era-independent; Escalation only changes equipment.
 */
export const connections: Connection[] = [
  // Transcaucasus: Adjara coast to Tbilisi
  ...chain([
    'Batumi',
    'Kobuleti',
    'Ozurgeti',
    'Lanchkhuti',
    'Samtredia',
    'Kutaisi',
    'Zestafoni',
    'Khashuri',
    'Kareli',
    'Gori',
    'Kaspi',
    'Mtskheta',
    'Soganlug',
    'Tbilisi-Lochini',
    'Vaziani'
  ]),
  road('Soganlug', 'Rustavi'),
  ...chain(['Senaki-Kolkhi', 'Abasha', 'Samtredia']),
  ...chain(['Senaki-Kolkhi', 'Martvili', 'Tskaltubo', 'Kutaisi']),
  ...chain(['Zestafoni', 'Chiatura', 'Sachkhere']),
  ...chain(['Zugdidi', 'Dzhvari', 'Mestia']),
  road('Ochamchira', 'Tkvarcheli'),

  // Black Sea coast, Kobuleti to Anapa
  ...chain([
    'Kobuleti',
    'Poti',
    'Senaki-Kolkhi',
    'Zugdidi',
    'Gali',
    'Ochamchira',
    'Sukhumi-Babushara',
    'Sukhumi',
    'Gudauta',
    'Sochi-Adler',
    'Sochi',
    'Lazarevskoe',
    'Tuapse',
    'Dzhubga',
    'Gelendzhik',
    'Novorossiysk',
    'Anapa-Vityazevo'
  ]),

  // Mountain crossings
  ...chain(['Tskaltubo', 'Tkibuli', 'Ambrolauri', 'Oni', 'Glola', 'Zaramag', 'Alagir']),
  ...chain(['Gori', 'Tskhinvali', 'Java', 'Zaramag']),
  ...chain(['Mtskheta', 'Pasanauri', 'Kazbegi', 'Vladikavkaz', 'Beslan', 'Mozdok']),
  ...chain([
    'Sukhumi',
    'Tsebelda',
    'Azhara',
    'Teberda',
    'Karachaevsk',
    'Ust-Dzheguta',
    'Cherkessk',
    'Suvorovskaya',
    'Pyatigorsk',
    'Mineralnye Vody',
    'Georgievsk',
    'Novopavlovsk',
    'Prokhladny',
    'Mozdok'
  ]),

  // North Caucasus
  road('Kislovodsk', 'Pyatigorsk'),
  ...chain(['Pyatigorsk', 'Baksan', 'Nalchik', 'Maysky', 'Prokhladny']),
  road('Tyrnyauz', 'Baksan'),
  ...chain(['Nalchik', 'Digora', 'Alagir', 'Vladikavkaz']),

  // Kuban
  ...chain([
    'Novorossiysk',
    'Krymsk',
    'Abinsk',
    'Krasnodar-Center',
    'Krasnodar-Pashkovsky',
    'Ust-Labinsk'
  ]),
  ...chain(['Anapa-Vityazevo', 'Temryuk', 'Slavyansk-na-Kubani', 'Krymsk']),
  road('Slavyansk-na-Kubani', 'Krasnodar-Center'),
  ...chain([
    'Krasnodar-Pashkovsky',
    'Belorechensk',
    'Maykop-Khanskaya',
    'Gubskaya',
    'Kaladzhinskaya',
    'Udobnaya',
    'Cherkessk'
  ]),
  ...chain(['Belorechensk', 'Apsheronsk', 'Tuapse'])
]
