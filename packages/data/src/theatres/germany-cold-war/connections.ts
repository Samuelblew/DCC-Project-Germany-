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
 * Fulda Gap hop graph. Same geography for Late CW and Escalation; era only changes
 * equipment. Vehicles use DCS On Road along these edges.
 */
export const connections: Connection[] = [
  ...chain([
    'Bordesholm',
    'Neumunster',
    'Bad Segeberg',
    'Bad Oldesloe',
    'Lubeck',
    'Schonberg',
    'Grevesmuhlen',
    'Wismar',
    'Neukloster',
    'Butzow',
    'Gustrow'
  ]),
  ...chain([
    'Lehrte',
    'Peine',
    'Braunschweig',
    'Konigslutter',
    'Helmstedt',
    'Haldensleben',
    'Eilsleben',
    'Oschersleben',
    'Calbe',
    'Kothen',
    'Bitterfeld',
    'Leipzig Mockau'
  ]),
  road('Helmstedt', 'Eilsleben'),
  ...chain(['Haldensleben', 'Burg', 'Genthin', 'Brandenburg', 'Werder', 'Potsdam']),
  ...chain([
    'Borken',
    'Schwalmstadt',
    'Alsfeld',
    'Lauterbach',
    'Hunfeld',
    'Geisa',
    'Vacha',
    'Eisenach',
    'Gotha',
    'Erfurt',
    'Weimar',
    'Apolda',
    'Naumburg',
    'Lutzen',
    'Leipzig Mockau'
  ]),
  ...chain(['Geisa', 'Schluchtern', 'Gelnhausen', 'Hanau', 'Frankfurt']),
  road('Hunfeld', 'Fulda'),
  road('Borken', 'Fritzlar')
]
