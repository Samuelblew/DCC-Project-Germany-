/**
 * Transverse Mercator on WGS84 (Krüger series, sub-millimetre inside a zone) with the parameters
 * DCS uses for a terrain. DCS x is northing, DCS z (DCC `y`) is easting.
 *
 * @kilcekru/dcs-coordinates only covers a survey grid per terrain (Caucasus stops at 46°N); this
 * covers the whole terrain, so the Rostov air defence district of the Caucasus template fits.
 */
export type TransverseMercatorParams = {
  centralMeridian: number
  falseEasting: number
  falseNorthing: number
  scaleFactor: number
}

/** DCS Caucasus terrain; checked against every beacon in Mods/terrains/Caucasus/Beacons.lua. */
export const DCS_CAUCASUS_PROJECTION: TransverseMercatorParams = {
  centralMeridian: 33,
  falseEasting: -99516.9999999732,
  falseNorthing: -4998114.999999984,
  scaleFactor: 0.9996
}

const terrainProjections: Record<string, TransverseMercatorParams> = {
  Caucasus: DCS_CAUCASUS_PROJECTION
}

/** The exact projection of a DCS terrain, where DCC knows it (by terrain name, e.g. `Caucasus`). */
export function terrainProjection(terrain: string): TransverseMercatorParams | undefined {
  return terrainProjections[terrain]
}

const A = 6378137
const F = 1 / 298.257223563
const N = F / (2 - F)
const RECTIFYING_RADIUS = (A / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64)
const ALPHA = [
  N / 2 - (2 / 3) * N ** 2 + (5 / 16) * N ** 3,
  (13 / 48) * N ** 2 - (3 / 5) * N ** 3,
  (61 / 240) * N ** 3
]
const BETA = [
  N / 2 - (2 / 3) * N ** 2 + (37 / 96) * N ** 3,
  (1 / 48) * N ** 2 + (1 / 15) * N ** 3,
  (17 / 480) * N ** 3
]
const DELTA = [
  2 * N - (2 / 3) * N ** 2 - 2 * N ** 3,
  (7 / 3) * N ** 2 - (8 / 5) * N ** 3,
  (56 / 15) * N ** 3
]
const ECCENTRICITY = Math.sqrt(F * (2 - F))
const DEG = Math.PI / 180

export function lngLatToTransverseMercator(
  params: TransverseMercatorParams,
  lng: number,
  lat: number
): { x: number; y: number } {
  const phi = lat * DEG
  const lambda = (lng - params.centralMeridian) * DEG
  const t = Math.sinh(
    Math.atanh(Math.sin(phi)) - ECCENTRICITY * Math.atanh(ECCENTRICITY * Math.sin(phi))
  )
  const xiPrime = Math.atan2(t, Math.cos(lambda))
  const etaPrime = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t))
  let xi = xiPrime
  let eta = etaPrime
  for (let j = 1; j <= 3; j += 1) {
    const alpha = ALPHA[j - 1]!
    xi += alpha * Math.sin(2 * j * xiPrime) * Math.cosh(2 * j * etaPrime)
    eta += alpha * Math.cos(2 * j * xiPrime) * Math.sinh(2 * j * etaPrime)
  }
  const k = params.scaleFactor * RECTIFYING_RADIUS
  return { x: params.falseNorthing + k * xi, y: params.falseEasting + k * eta }
}

export function transverseMercatorToLngLat(
  params: TransverseMercatorParams,
  x: number,
  y: number
): { lng: number; lat: number } {
  const k = params.scaleFactor * RECTIFYING_RADIUS
  const xi = (x - params.falseNorthing) / k
  const eta = (y - params.falseEasting) / k
  let xiPrime = xi
  let etaPrime = eta
  for (let j = 1; j <= 3; j += 1) {
    const beta = BETA[j - 1]!
    xiPrime -= beta * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta)
    etaPrime -= beta * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta)
  }
  const chi = Math.asin(Math.sin(xiPrime) / Math.cosh(etaPrime))
  let phi = chi
  for (let j = 1; j <= 3; j += 1) phi += DELTA[j - 1]! * Math.sin(2 * j * chi)
  const lambda = Math.atan2(Math.sinh(etaPrime), Math.cos(xiPrime))
  return { lng: params.centralMeridian + lambda / DEG, lat: phi / DEG }
}
