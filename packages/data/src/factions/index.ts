import { Argentina1982A4 } from './argentina-1982-a4'
import { Argentina1982Official } from './argentina-1982-official'
import { EastGermany1985 } from './east-germany-1985'
import { France1982 } from './france-1982'
import { Israel1967 } from './israel-1967'
import { RUSSIA1955 } from './russia-1955'
import { RUSSIA1971 } from './russia-1971'
import { RUSSIA1984 } from './russia-1984'
import { RUSSIA1996 } from './russia-1996'
import { RussiaGermany1955 } from './russia-germany-1955'
import { RussiaGermany1967 } from './russia-germany-1967'
import { RussiaVietnam } from './russia-vietnam'
import { Sweden1970 } from './sweden-1970'
import { Uk1982 } from './uk-1982'
import { UsNavy1964 } from './us-navy-1964'
import { UsNavy1987 } from './us-navy-1987'
import { USA1952 } from './usa-1952'
import { USA1977 } from './usa-1977'
import { USA2004 } from './usa-2004'
import { UsaGermany1955 } from './usa-germany-1955'
import { UsaGermany1967 } from './usa-germany-1967'
import { USAVietnam } from './usa-vietnam'
import { WestGermany1985 } from './west-germany-1985'

export const factions = [
  USA1952,
  RUSSIA1955,
  UsaGermany1955,
  RussiaGermany1955,
  UsNavy1964,
  Israel1967,
  RussiaVietnam,
  USAVietnam,
  UsaGermany1967,
  RussiaGermany1967,
  Sweden1970,
  RUSSIA1971,
  USA1977,
  France1982,
  Uk1982,
  Argentina1982Official,
  Argentina1982A4,
  RUSSIA1984,
  WestGermany1985,
  EastGermany1985,
  UsNavy1987,
  RUSSIA1996,
  USA2004
].sort((left, right) => {
  const yearDelta = (left.year ?? 0) - (right.year ?? 0)
  if (yearDelta !== 0) return yearDelta
  return left.name.localeCompare(right.name)
})
