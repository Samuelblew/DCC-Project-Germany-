import type { AuthoredIadsNetwork } from '../../iads/types'
import { germanyIadsSites } from './iads-network'

export const GERMANY_IADS_THEATRE = 'Cold War Germany'

/** Sentry Germany (1985): NATO and Warsaw Pact SAM, EWR, HQ, AAA and parked aircraft. */
export const germanyIadsNetwork: AuthoredIadsNetwork = {
  theatreName: GERMANY_IADS_THEATRE,
  sites: germanyIadsSites
}
