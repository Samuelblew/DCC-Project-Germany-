import {
  lngLatToTransverseMercator,
  terrainProjection,
  terrainTheatreName,
  transverseMercatorToLngLat
} from '@dcc/data'
import { LLtoLO, LOtoLL, type Types } from '@kilcekru/dcs-coordinates'

export type LngLat = { lat: number; lng: number }

const GERMANY_THEATRES = new Set(['Cold War Germany', 'GermanyCW'])

// Quadratic fit of DCS x/z to WGS84, from the Cold War Germany beacon survey.
// Inputs are scaled by 1e5 before applying these coefficients.
const GERMANY_LAT = [
  0.9085607775476312, 0.020582809983466177, 0.003863576322000295, -0.00026506778971813194,
  -0.008581651625086506, 54.73573333567657
]
const GERMANY_LNG = [
  -0.04089794937263669, 1.5733060904990106, 0.028012459008367907, -0.0051060927441876625,
  0.00517645904592412, 20.47736300928656
]

function germanyColdWarToLngLat(x: number, z: number): LngLat {
  const scaledX = x / 1e5
  const scaledZ = z / 1e5
  const basis = [scaledX, scaledZ, scaledX * scaledZ, scaledX * scaledX, scaledZ * scaledZ, 1]
  let lat = 0
  let lng = 0
  for (let index = 0; index < basis.length; index += 1) {
    const term = basis[index] ?? 0
    lat += (GERMANY_LAT[index] ?? 0) * term
    lng += (GERMANY_LNG[index] ?? 0) * term
  }
  return { lat, lng }
}

// Newton iteration must start inside Germany; starting at 0,0 diverges.
function lngLatToGermanyColdWar(lng: number, lat: number) {
  const step = 10
  let x = -250_000
  let z = -700_000
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const current = germanyColdWarToLngLat(x, z)
    const latError = lat - current.lat
    const lngError = lng - current.lng
    if (Math.abs(latError) < 1e-9 && Math.abs(lngError) < 1e-9) break
    const alongX = germanyColdWarToLngLat(x + step, z)
    const alongZ = germanyColdWarToLngLat(x, z + step)
    const dLatX = (alongX.lat - current.lat) / step
    const dLngX = (alongX.lng - current.lng) / step
    const dLatZ = (alongZ.lat - current.lat) / step
    const dLngZ = (alongZ.lng - current.lng) / step
    const det = dLatX * dLngZ - dLatZ * dLngX
    if (det === 0) return undefined
    x += (latError * dLngZ - dLatZ * lngError) / det
    z += (dLatX * lngError - dLngX * latError) / det
  }
  return Number.isFinite(x) && Number.isFinite(z) ? { x, y: z } : undefined
}

export function tryLngLatToDcsPosition(
  theatre: string,
  lng: number,
  lat: number
): { x: number; y: number } | undefined {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined

  if (GERMANY_THEATRES.has(theatre)) return lngLatToGermanyColdWar(lng, lat)
  const projection = terrainProjection(terrainTheatreName(theatre))
  if (projection) return lngLatToTransverseMercator(projection, lng, lat)

  try {
    const result = LLtoLO({ theatre: terrainTheatreName(theatre) as Types.Theatre, lat, lng })
    return { x: result.x, y: result.z }
  } catch {
    return undefined
  }
}

/**
 * The coordinate library only covers a bounded survey grid for each DCS theatre.
 * Runtime positions can legitimately fall outside that grid (for example, older
 * South Atlantic saves), so map rendering must treat conversion as fallible.
 */
export function tryDcsPositionToLngLat(theatre: string, x: number, z: number): LngLat | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined

  if (GERMANY_THEATRES.has(theatre)) return germanyColdWarToLngLat(x, z)
  const projection = terrainProjection(terrainTheatreName(theatre))
  if (projection) return transverseMercatorToLngLat(projection, x, z)

  try {
    return LOtoLL({ theatre: terrainTheatreName(theatre) as Types.Theatre, x, z })
  } catch {
    return undefined
  }
}
