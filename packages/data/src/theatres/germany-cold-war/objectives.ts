import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

export const objectives: z.infer<typeof schemas.objective>[] = [
  {
    name: 'Ramstein',
    type: 'Airport',
    position: { x: -498857.6875, y: -933510.6875 }
  },
  {
    name: 'Spangdahlem',
    type: 'Airport',
    position: { x: -426028.21875, y: -986801.0625 }
  },
  {
    name: 'Hahn',
    type: 'Airport',
    position: { x: -436889.46875, y: -947583.875 }
  },
  {
    name: 'Bitburg',
    type: 'Airport',
    position: { x: -428053.96875, y: -997282.6875 }
  },
  {
    name: 'Sembach',
    type: 'Airport',
    position: { x: -494129.46875, y: -913120.625 }
  },
  {
    name: 'Zweibrucken',
    type: 'Airport',
    position: { x: -522124.03125, y: -954430.0625 }
  },
  {
    name: 'Pferdsfeld',
    type: 'Airport',
    position: { x: -452328.9375, y: -927059.625 }
  },
  {
    name: 'Mendig',
    type: 'Airport',
    position: { x: -392153.28125, y: -935225.375 }
  },
  {
    name: 'Wiesbaden',
    type: 'Airport',
    position: { x: -440158.5625, y: -871687.125 }
  },
  {
    name: 'Frankfurt',
    type: 'Airport',
    position: { x: -443683.84375, y: -851538.6875 }
  },
  {
    name: 'Fulda',
    type: 'Airport',
    position: { x: -401142.09375, y: -768015.8125 }
  },
  {
    name: 'Fritzlar',
    type: 'Airport',
    position: { x: -333799.96875, y: -782950.9375 }
  },
  {
    name: 'Kiel',
    type: 'Airport',
    position: { x: 18619.0859375, y: -668838.1875 }
  },
  {
    name: 'Schwedeneck A',
    type: 'Installation',
    position: { x: 42132, y: -675831 }
  },
  {
    name: 'Schwedeneck B',
    type: 'Installation',
    position: { x: 39644, y: -672941 }
  },
  {
    name: 'Hamburg',
    type: 'Airport',
    position: { x: -62281.59765625, y: -690651.875 }
  },
  {
    name: 'Hannover',
    type: 'Airport',
    position: { x: -189958.71875, y: -730444.375 }
  },
  {
    name: 'Cologne',
    type: 'Airport',
    position: { x: -333196.78125, y: -938090.0625 }
  },
  {
    name: 'Tempelhof',
    type: 'Airport',
    position: { x: -220930.65625, y: -481126.40625 }
  },
  {
    name: 'Tegel',
    type: 'Airport',
    position: { x: -210495.984375, y: -485475.21875 }
  },
  {
    name: 'Gatow',
    type: 'Airport',
    position: { x: -218568.53125, y: -497236.4375 }
  },
  {
    name: 'Laage',
    type: 'Airport',
    position: { x: -51583.10546875, y: -537832.6875 }
  },
  {
    name: 'Schonefeld',
    type: 'Airport',
    position: { x: -231248.421875, y: -470959.3125 }
  },
  {
    name: 'Leipzig Mockau',
    type: 'Airport',
    position: { x: -332672.875, y: -561152.8125 }
  },
  {
    name: 'Cochstedt',
    type: 'Airport',
    position: { x: -273168.90625, y: -624984.125 }
  },
  { name: 'Bordesholm', type: 'Town', position: { x: -2246.22, y: -680827.82 } },
  { name: 'Neumunster', type: 'Town', position: { x: -13545.25, y: -683968.81 } },
  { name: 'Bad Segeberg', type: 'Town', position: { x: -31910.13, y: -665452.51 } },
  { name: 'Bad Oldesloe', type: 'Town', position: { x: -46394.77, y: -663263.18 } },
  { name: 'Lubeck', type: 'Town', position: { x: -43552.76, y: -641950.61 } },
  { name: 'Schonberg', type: 'Town', position: { x: -47301.53, y: -626165.18 } },
  { name: 'Grevesmuhlen', type: 'Town', position: { x: -48320.41, y: -610130.28 } },
  { name: 'Wismar', type: 'Town', position: { x: -47857.15, y: -590503.6 } },
  { name: 'Neukloster', type: 'Town', position: { x: -52561.39, y: -576450.79 } },
  { name: 'Butzow', type: 'Town', position: { x: -57107.87, y: -557162.9 } },
  { name: 'Gustrow', type: 'Town', position: { x: -64373.84, y: -545206.05 } },
  { name: 'Lehrte', type: 'Town', position: { x: -201872.9, y: -713817.61 } },
  { name: 'Peine', type: 'Town', position: { x: -210112.2, y: -697590.99 } },
  { name: 'Braunschweig', type: 'Town', position: { x: -218811.96, y: -678549.39 } },
  { name: 'Konigslutter', type: 'Town', position: { x: -223683.32, y: -658787.7 } },
  { name: 'Helmstedt', type: 'Town', position: { x: -228080.56, y: -645950.18 } },
  { name: 'Haldensleben', type: 'Town', position: { x: -224925.44, y: -617624.87 } },
  { name: 'Eilsleben', type: 'Town', position: { x: -238821.04, y: -633539.63 } },
  { name: 'Oschersleben', type: 'Town', position: { x: -252086.14, y: -634001.8 } },
  { name: 'Calbe', type: 'Town', position: { x: -270747.83, y: -598414.28 } },
  { name: 'Kothen', type: 'Town', position: { x: -289531.61, y: -587077.95 } },
  { name: 'Bitterfeld', type: 'Town', position: { x: -306856.54, y: -564055.97 } },
  { name: 'Borken', type: 'Town', position: { x: -341333.17, y: -784684.1 } },
  { name: 'Schwalmstadt', type: 'Town', position: { x: -355359.89, y: -791405.87 } },
  { name: 'Alsfeld', type: 'Town', position: { x: -373779.07, y: -790649.36 } },
  { name: 'Lauterbach', type: 'Town', position: { x: -387682.35, y: -784003.41 } },
  { name: 'Hunfeld', type: 'Town', position: { x: -387918.19, y: -757107.01 } },
  { name: 'Geisa', type: 'Town', position: { x: -385127.83, y: -743418.82 } },
  { name: 'Vacha', type: 'Town', position: { x: -373463.61, y: -736555.48 } },
  { name: 'Eisenach', type: 'Town', position: { x: -360261.65, y: -713247.44 } },
  { name: 'Gotha', type: 'Town', position: { x: -366982.78, y: -686901.86 } },
  { name: 'Erfurt', type: 'Town', position: { x: -366933.13, y: -663548 } },
  { name: 'Weimar', type: 'Town', position: { x: -369578.45, y: -642937.07 } },
  { name: 'Apolda', type: 'Town', position: { x: -366234.18, y: -628762.65 } },
  { name: 'Naumburg', type: 'Town', position: { x: -354745.97, y: -606443.14 } },
  { name: 'Lutzen', type: 'Town', position: { x: -345811.66, y: -581944.53 } },
  { name: 'Burg', type: 'Town', position: { x: -230827.34, y: -587840.94 } },
  { name: 'Genthin', type: 'Town', position: { x: -218519.47, y: -565500.06 } },
  { name: 'Brandenburg', type: 'Town', position: { x: -221049.57, y: -538851.71 } },
  { name: 'Werder', type: 'Town', position: { x: -227822.09, y: -513178.04 } },
  { name: 'Potsdam', type: 'Town', position: { x: -227360.68, y: -504204.18 } },
  { name: 'Schluchtern', type: 'Town', position: { x: -421144.83, y: -779954.7 } },
  { name: 'Gelnhausen', type: 'Town', position: { x: -433659.7, y: -806237.39 } },
  { name: 'Hanau', type: 'Town', position: { x: -438105.77, y: -827018.71 } }
]
