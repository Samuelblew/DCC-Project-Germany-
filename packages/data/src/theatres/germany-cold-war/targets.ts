import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

export const targets: Record<string, z.infer<typeof schemas.target>[]> = {
  Ramstein: [
    {
      name: 'Ramstein|SAM|1',
      position: { x: -494857.6875, y: -933510.6875 },
      type: 'SAM',
      groupId: 1,
      objectiveName: 'Ramstein',
      unitPositions: [{ x: -494857.6875, y: -933510.6875, heading: 0 }]
    },
    {
      name: 'Ramstein|Vehicle|1',
      position: { x: -498857.6875, y: -931010.6875 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Ramstein',
      unitPositions: [
        { x: -498857.6875, y: -931010.6875, heading: 0 },
        { x: -498839.6875, y: -930998.6875, heading: 0 },
        { x: -498873.6875, y: -930990.6875, heading: 0 },
        { x: -498847.6875, y: -931028.6875, heading: 0 }
      ]
    }
  ],
  Spangdahlem: [
    {
      name: 'Spangdahlem|SAM|1',
      position: { x: -422028.21875, y: -986801.0625 },
      type: 'SAM',
      groupId: 1,
      objectiveName: 'Spangdahlem',
      unitPositions: [{ x: -422028.21875, y: -986801.0625, heading: 0 }]
    },
    {
      name: 'Spangdahlem|Vehicle|1',
      position: { x: -426028.21875, y: -984301.0625 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Spangdahlem',
      unitPositions: [
        { x: -426028.21875, y: -984301.0625, heading: 0 },
        { x: -426010.21875, y: -984289.0625, heading: 0 },
        { x: -426044.21875, y: -984281.0625, heading: 0 },
        { x: -426018.21875, y: -984319.0625, heading: 0 }
      ]
    }
  ],
  Hahn: [
    {
      name: 'Hahn|SAM|1',
      position: { x: -432889.46875, y: -947583.875 },
      type: 'SAM',
      groupId: 1,
      objectiveName: 'Hahn',
      unitPositions: [{ x: -432889.46875, y: -947583.875, heading: 0 }]
    },
    {
      name: 'Hahn|Vehicle|1',
      position: { x: -436889.46875, y: -945083.875 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Hahn',
      unitPositions: [
        { x: -436889.46875, y: -945083.875, heading: 0 },
        { x: -436871.46875, y: -945071.875, heading: 0 },
        { x: -436905.46875, y: -945063.875, heading: 0 },
        { x: -436879.46875, y: -945101.875, heading: 0 }
      ]
    }
  ],
  Bitburg: [
    {
      name: 'Bitburg|SAM|1',
      position: { x: -424053.96875, y: -997282.6875 },
      type: 'SAM',
      groupId: 1,
      objectiveName: 'Bitburg',
      unitPositions: [{ x: -424053.96875, y: -997282.6875, heading: 0 }]
    },
    {
      name: 'Bitburg|Vehicle|1',
      position: { x: -428053.96875, y: -994782.6875 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Bitburg',
      unitPositions: [
        { x: -428053.96875, y: -994782.6875, heading: 0 },
        { x: -428035.96875, y: -994770.6875, heading: 0 },
        { x: -428069.96875, y: -994762.6875, heading: 0 },
        { x: -428043.96875, y: -994800.6875, heading: 0 }
      ]
    }
  ],
  Sembach: [
    {
      name: 'Sembach|SAM|1',
      position: { x: -490129.46875, y: -913120.625 },
      type: 'SAM',
      groupId: 1,
      objectiveName: 'Sembach',
      unitPositions: [{ x: -490129.46875, y: -913120.625, heading: 0 }]
    },
    {
      name: 'Sembach|Vehicle|1',
      position: { x: -494129.46875, y: -910620.625 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Sembach',
      unitPositions: [
        { x: -494129.46875, y: -910620.625, heading: 0 },
        { x: -494111.46875, y: -910608.625, heading: 0 },
        { x: -494145.46875, y: -910600.625, heading: 0 },
        { x: -494119.46875, y: -910638.625, heading: 0 }
      ]
    }
  ],
  Zweibrucken: [
    {
      name: 'Zweibrucken|SAM|1',
      position: { x: -518124.03125, y: -954430.0625 },
      type: 'SAM',
      groupId: 1,
      objectiveName: 'Zweibrucken',
      unitPositions: [{ x: -518124.03125, y: -954430.0625, heading: 0 }]
    },
    {
      name: 'Zweibrucken|Vehicle|1',
      position: { x: -522124.03125, y: -951930.0625 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Zweibrucken',
      unitPositions: [
        { x: -522124.03125, y: -951930.0625, heading: 0 },
        { x: -522106.03125, y: -951918.0625, heading: 0 },
        { x: -522140.03125, y: -951910.0625, heading: 0 },
        { x: -522114.03125, y: -951948.0625, heading: 0 }
      ]
    }
  ],
  Pferdsfeld: [
    {
      name: 'Pferdsfeld|SAM|1',
      position: { x: -448328.9375, y: -927059.625 },
      type: 'SAM',
      groupId: 1,
      objectiveName: 'Pferdsfeld',
      unitPositions: [{ x: -448328.9375, y: -927059.625, heading: 0 }]
    },
    {
      name: 'Pferdsfeld|Vehicle|1',
      position: { x: -452328.9375, y: -924559.625 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Pferdsfeld',
      unitPositions: [
        { x: -452328.9375, y: -924559.625, heading: 0 },
        { x: -452310.9375, y: -924547.625, heading: 0 },
        { x: -452344.9375, y: -924539.625, heading: 0 },
        { x: -452318.9375, y: -924577.625, heading: 0 }
      ]
    }
  ],
  Mendig: [
    {
      name: 'Mendig|SAM|1',
      position: { x: -388153.28125, y: -935225.375 },
      type: 'SAM',
      groupId: 1,
      objectiveName: 'Mendig',
      unitPositions: [{ x: -388153.28125, y: -935225.375, heading: 0 }]
    },
    {
      name: 'Mendig|Vehicle|1',
      position: { x: -392153.28125, y: -932725.375 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Mendig',
      unitPositions: [
        { x: -392153.28125, y: -932725.375, heading: 0 },
        { x: -392135.28125, y: -932713.375, heading: 0 },
        { x: -392169.28125, y: -932705.375, heading: 0 },
        { x: -392143.28125, y: -932743.375, heading: 0 }
      ]
    }
  ],
  Wiesbaden: [
    {
      name: 'Wiesbaden|SAM|1',
      position: { x: -436158.5625, y: -871687.125 },
      type: 'SAM',
      groupId: 1,
      objectiveName: 'Wiesbaden',
      unitPositions: [{ x: -436158.5625, y: -871687.125, heading: 0 }]
    },
    {
      name: 'Wiesbaden|Vehicle|1',
      position: { x: -440158.5625, y: -869187.125 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Wiesbaden',
      unitPositions: [
        { x: -440158.5625, y: -869187.125, heading: 0 },
        { x: -440140.5625, y: -869175.125, heading: 0 },
        { x: -440174.5625, y: -869167.125, heading: 0 },
        { x: -440148.5625, y: -869205.125, heading: 0 }
      ]
    }
  ],
  Frankfurt: [
    {
      name: 'Frankfurt|SAM|1',
      position: { x: -439683.84375, y: -851538.6875 },
      type: 'SAM',
      groupId: 1,
      objectiveName: 'Frankfurt',
      unitPositions: [{ x: -439683.84375, y: -851538.6875, heading: 0 }]
    },
    {
      name: 'Frankfurt|Vehicle|1',
      position: { x: -443683.84375, y: -849038.6875 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Frankfurt',
      unitPositions: [
        { x: -443683.84375, y: -849038.6875, heading: 0 },
        { x: -443665.84375, y: -849026.6875, heading: 0 },
        { x: -443699.84375, y: -849018.6875, heading: 0 },
        { x: -443673.84375, y: -849056.6875, heading: 0 }
      ]
    }
  ],
  Fulda: [
    {
      name: 'Fulda|SAM|1',
      position: { x: -397142.09375, y: -768015.8125 },
      type: 'SAM',
      groupId: 1,
      objectiveName: 'Fulda',
      unitPositions: [{ x: -397142.09375, y: -768015.8125, heading: 0 }]
    },
    {
      name: 'Fulda|Vehicle|1',
      position: { x: -401142.09375, y: -765515.8125 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Fulda',
      unitPositions: [
        { x: -401142.09375, y: -765515.8125, heading: 0 },
        { x: -401124.09375, y: -765503.8125, heading: 0 },
        { x: -401158.09375, y: -765495.8125, heading: 0 },
        { x: -401132.09375, y: -765533.8125, heading: 0 }
      ]
    }
  ],
  Fritzlar: [
    {
      name: 'Fritzlar|SAM|1',
      position: { x: -329799.96875, y: -782950.9375 },
      type: 'SAM',
      groupId: 1,
      objectiveName: 'Fritzlar',
      unitPositions: [{ x: -329799.96875, y: -782950.9375, heading: 0 }]
    },
    {
      name: 'Fritzlar|Vehicle|1',
      position: { x: -333799.96875, y: -780450.9375 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Fritzlar',
      unitPositions: [
        { x: -333799.96875, y: -780450.9375, heading: 0 },
        { x: -333781.96875, y: -780438.9375, heading: 0 },
        { x: -333815.96875, y: -780430.9375, heading: 0 },
        { x: -333789.96875, y: -780468.9375, heading: 0 }
      ]
    }
  ],
  Kiel: [
    {
      name: 'Kiel|Vehicle|1',
      position: { x: 18619.0859375, y: -666338.1875 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Kiel',
      unitPositions: [{ x: 18619.0859375, y: -666338.1875, heading: 0 }]
    }
  ],
  Hamburg: [
    {
      name: 'Hamburg|Vehicle|1',
      position: { x: -62281.59765625, y: -688151.875 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Hamburg',
      unitPositions: [{ x: -62281.59765625, y: -688151.875, heading: 0 }]
    }
  ],
  Hannover: [
    {
      name: 'Hannover|Vehicle|1',
      position: { x: -189958.71875, y: -727944.375 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Hannover',
      unitPositions: [{ x: -189958.71875, y: -727944.375, heading: 0 }]
    }
  ],
  Cologne: [
    {
      name: 'Cologne|Vehicle|1',
      position: { x: -333196.78125, y: -935590.0625 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Cologne',
      unitPositions: [{ x: -333196.78125, y: -935590.0625, heading: 0 }]
    }
  ],
  Tempelhof: [
    {
      name: 'Tempelhof|Vehicle|1',
      position: { x: -220930.65625, y: -478626.40625 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Tempelhof',
      unitPositions: [{ x: -220930.65625, y: -478626.40625, heading: 0 }]
    }
  ],
  Tegel: [
    {
      name: 'Tegel|Vehicle|1',
      position: { x: -210495.984375, y: -482975.21875 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Tegel',
      unitPositions: [{ x: -210495.984375, y: -482975.21875, heading: 0 }]
    }
  ],
  Gatow: [
    {
      name: 'Gatow|Vehicle|1',
      position: { x: -218568.53125, y: -494736.4375 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Gatow',
      unitPositions: [{ x: -218568.53125, y: -494736.4375, heading: 0 }]
    }
  ],
  Laage: [
    {
      name: 'Laage|Vehicle|1',
      position: { x: -51583.10546875, y: -535332.6875 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Laage',
      unitPositions: [{ x: -51583.10546875, y: -535332.6875, heading: 0 }]
    }
  ],
  Schonefeld: [
    {
      name: 'Schonefeld|Vehicle|1',
      position: { x: -231248.421875, y: -468459.3125 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Schonefeld',
      unitPositions: [{ x: -231248.421875, y: -468459.3125, heading: 0 }]
    }
  ],
  'Leipzig Mockau': [
    {
      name: 'Leipzig Mockau|Vehicle|1',
      position: { x: -332672.875, y: -558652.8125 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Leipzig Mockau',
      unitPositions: [{ x: -332672.875, y: -558652.8125, heading: 0 }]
    }
  ],
  Cochstedt: [
    {
      name: 'Cochstedt|Vehicle|1',
      position: { x: -273168.90625, y: -622484.125 },
      type: 'Vehicle',
      groupId: 1,
      objectiveName: 'Cochstedt',
      unitPositions: [{ x: -273168.90625, y: -622484.125, heading: 0 }]
    }
  ]
}
