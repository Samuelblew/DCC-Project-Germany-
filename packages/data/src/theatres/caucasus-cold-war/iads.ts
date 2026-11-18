import type { AuthoredIadsNetwork } from '../../iads/types'
import { caucasusIadsSites } from './iads-network'
import { CAUCASUS_COLD_WAR_THEATRE } from './index'

/**
 * Caucasus 1988 template: the Soviet air defence of the Transcaucasus and North Caucasus military
 * districts. Every site is authored Soviet; the side holding the nearest objective operates it.
 */
export const caucasusIadsNetwork: AuthoredIadsNetwork = {
  theatreName: CAUCASUS_COLD_WAR_THEATRE,
  sites: caucasusIadsSites
}
