import { existsSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { terrainProjection, terrainTheatreName, transverseMercatorToLngLat } from '@dcc/data'
import { LOtoLL } from '@kilcekru/dcs-coordinates'
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import { PMTiles, type RangeResponse, type Source } from 'pmtiles'

type DcsTheatre = 'Caucasus' | 'Normandy' | 'PersianGulf' | 'Sinai' | 'SouthAtlantic' | 'Syria'
export type LngLat = { lng: number; lat: number }
export type LngLatBounds = { minLng: number; maxLng: number; minLat: number; maxLat: number }
export type MapPixel = { x: number; y: number }
export type ProjectLngLat = (lng: number, lat: number) => MapPixel

export type RouteMapViewport = {
  bounds: LngLatBounds
  projectLngLat: ProjectLngLat
}

const TILE_EXTENT = 4096
const MAP_LAYERS = ['earth', 'water'] as const
const THEATRE_PMTILES = [
  {
    theatreName: 'Caucasus',
    envVar: 'DCC_CAUCASUS_PMTILES',
    mapDirectory: 'caucasus',
    fileName: 'caucasus.pmtiles'
  },
  {
    theatreName: 'PersianGulf',
    envVar: 'DCC_PERSIAN_GULF_PMTILES',
    mapDirectory: 'persian-gulf',
    fileName: 'persian-gulf.pmtiles'
  },
  {
    theatreName: 'Syria',
    envVar: 'DCC_SYRIA_PMTILES',
    mapDirectory: 'syria',
    fileName: 'syria.pmtiles'
  },
  {
    theatreName: 'SouthAtlantic',
    envVar: 'DCC_SOUTH_ATLANTIC_PMTILES',
    mapDirectory: 'south-atlantic',
    fileName: 'south-atlantic.pmtiles'
  },
  {
    theatreName: 'Cold War Germany',
    envVar: 'DCC_GERMANY_COLD_WAR_PMTILES',
    mapDirectory: 'germany-cold-war',
    fileName: 'germany-cold-war.pmtiles'
  }
] as const
export const SUPPORTED_THEATRE_MAP_TILE_NAMES = THEATRE_PMTILES.map((config) => config.theatreName)
const CAUCASUS_MAX_ZOOM = 12
/** Keep the small kneeboard panel readable by drawing only the most prominent rivers. */
const MIN_MAJOR_RIVER_PIXEL_LENGTH = 85
const MAX_MAJOR_RIVER_PATHS = 10

const configuredPmtilesPaths = new Map<string, string>()
const cachedPmtiles = new Map<string, { path: string; archive: PMTiles }>()

function findFileUpwards(relativePath: string, startDir: string): string | undefined {
  let dir = startDir
  for (let depth = 0; depth < 12; depth += 1) {
    const candidate = join(dir, relativePath)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

class NodeFileSource implements Source {
  constructor(private readonly filePath: string) {}

  getKey(): string {
    return this.filePath
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const handle = await open(this.filePath, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      return { data: buffer.subarray(0, bytesRead).buffer }
    } finally {
      await handle.close()
    }
  }
}

export function setCaucasusPmtilesPath(filePath: string): void {
  setTheatrePmtilesPath('Caucasus', filePath)
}

export function resolveCaucasusPmtilesPath(): string | undefined {
  return resolveTheatrePmtilesPath('Caucasus')
}

function findTheatrePmtilesConfig(theatreName: string) {
  const terrain = terrainTheatreName(theatreName)
  return THEATRE_PMTILES.find((config) => config.theatreName === terrain)
}

function getFrontendPmtilesRelativePath(config: (typeof THEATRE_PMTILES)[number]) {
  return join('apps', 'frontend', 'public', 'maps', config.mapDirectory, config.fileName)
}

function getPackagedPmtilesRelativePath(config: (typeof THEATRE_PMTILES)[number]) {
  return join('maps', config.mapDirectory, config.fileName)
}

export function setTheatrePmtilesPath(theatreName: string, filePath: string): void {
  const config = findTheatrePmtilesConfig(theatreName)
  if (!config) return

  process.env[config.envVar] = filePath
  configuredPmtilesPaths.set(config.theatreName, filePath)
  cachedPmtiles.delete(config.theatreName)
}

export function resolveTheatrePmtilesPath(theatreName: string): string | undefined {
  const config = findTheatrePmtilesConfig(theatreName)
  if (!config) return undefined

  const configuredPath = configuredPmtilesPaths.get(config.theatreName)
  if (configuredPath && existsSync(configuredPath)) return configuredPath

  const envPath = process.env[config.envVar]
  if (envPath && existsSync(envPath)) return envPath

  const resourcesPath = (
    process as NodeJS.Process & {
      resourcesPath?: string
    }
  ).resourcesPath
  if (resourcesPath) {
    const packaged = join(resourcesPath, getPackagedPmtilesRelativePath(config))
    if (existsSync(packaged)) return packaged
    // Theatres not listed in extraResources still ship inside the renderer's copy of public/maps.
    const renderer = join(
      resourcesPath,
      'renderer',
      'frontend',
      getPackagedPmtilesRelativePath(config)
    )
    if (existsSync(renderer)) return renderer
  }

  const mapRelativePath = join('maps', config.mapDirectory, config.fileName)
  const frontendRelativePath = getFrontendPmtilesRelativePath(config)
  const cwdCandidates = [
    join(process.cwd(), frontendRelativePath),
    join(process.cwd(), 'public', mapRelativePath),
    join(process.cwd(), '../frontend/public', mapRelativePath),
    join(process.cwd(), '../../frontend/public', mapRelativePath)
  ]

  for (const candidate of cwdCandidates) {
    if (existsSync(candidate)) return candidate
  }

  return findFileUpwards(frontendRelativePath, dirname(fileURLToPath(import.meta.url)))
}

function getTheatrePmtiles(theatreName: string): PMTiles | undefined {
  const path = resolveTheatrePmtilesPath(theatreName)
  if (!path) return undefined
  const cached = cachedPmtiles.get(theatreName)
  if (cached && cached.path === path) return cached.archive

  const archive = new PMTiles(new NodeFileSource(path))
  cachedPmtiles.set(theatreName, { path, archive })
  return archive
}

/** Web Mercator normalized coordinates (0–1), matching MapLibre GL. */
function lngLatToMercator(lng: number, lat: number): { x: number; y: number } {
  const x = (lng + 180) / 360
  const sinLat = Math.sin((lat * Math.PI) / 180)
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)
  return { x, y }
}

function mercatorToLngLat(x: number, y: number): LngLat {
  const lng = x * 360 - 180
  const n = Math.PI - 2 * Math.PI * y
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return { lng, lat }
}

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

export function dcsPositionToLngLat(x: number, z: number, theatreName: string): LngLat | undefined {
  if (theatreName === 'Cold War Germany' || theatreName === 'GermanyCW') {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined
    return germanyColdWarToLngLat(x, z)
  }

  const projection = terrainProjection(terrainTheatreName(theatreName))
  if (projection) {
    return Number.isFinite(x) && Number.isFinite(z)
      ? transverseMercatorToLngLat(projection, x, z)
      : undefined
  }

  try {
    return LOtoLL({ theatre: terrainTheatreName(theatreName) as DcsTheatre, x, z })
  } catch {
    return undefined
  }
}

export function expandLngLatBounds(
  bounds: LngLatBounds,
  options: { expandFactor?: number; minSpanDegrees?: number } = {}
): LngLatBounds {
  const expandFactor = options.expandFactor ?? 1.9
  const minSpanDegrees = options.minSpanDegrees ?? 0.65
  const centerLng = (bounds.minLng + bounds.maxLng) / 2
  const centerLat = (bounds.minLat + bounds.maxLat) / 2
  const spanLng = Math.max(minSpanDegrees, (bounds.maxLng - bounds.minLng) * expandFactor)
  const spanLat = Math.max(minSpanDegrees, (bounds.maxLat - bounds.minLat) * expandFactor)

  return {
    minLng: centerLng - spanLng / 2,
    maxLng: centerLng + spanLng / 2,
    minLat: centerLat - spanLat / 2,
    maxLat: centerLat + spanLat / 2
  }
}

export function createRouteMapViewport(params: {
  lngLatPoints: LngLat[]
  box: { x: number; y: number; width: number; height: number; padding?: number }
  expandFactor?: number
  minSpanDegrees?: number
}): RouteMapViewport | undefined {
  if (params.lngLatPoints.length === 0) return undefined

  const lngs = params.lngLatPoints.map((point) => point.lng)
  const lats = params.lngLatPoints.map((point) => point.lat)
  const bounds = expandLngLatBounds(
    {
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats)
    },
    {
      expandFactor: params.expandFactor,
      minSpanDegrees: params.minSpanDegrees
    }
  )

  const padding = params.box.padding ?? 26
  const mercatorCorners = [
    lngLatToMercator(bounds.minLng, bounds.maxLat),
    lngLatToMercator(bounds.maxLng, bounds.maxLat),
    lngLatToMercator(bounds.minLng, bounds.minLat),
    lngLatToMercator(bounds.maxLng, bounds.minLat)
  ]
  let minMx = Math.min(...mercatorCorners.map((corner) => corner.x))
  let maxMx = Math.max(...mercatorCorners.map((corner) => corner.x))
  let minMy = Math.min(...mercatorCorners.map((corner) => corner.y))
  let maxMy = Math.max(...mercatorCorners.map((corner) => corner.y))
  const innerWidth = params.box.width - padding * 2
  const innerHeight = params.box.height - padding * 2
  const targetAspect = innerWidth / innerHeight
  let spanMx = Math.max(1e-9, maxMx - minMx)
  let spanMy = Math.max(1e-9, maxMy - minMy)
  const currentAspect = spanMx / spanMy

  if (currentAspect < targetAspect) {
    const expandedSpanMx = spanMy * targetAspect
    const centerMx = (minMx + maxMx) / 2
    minMx = centerMx - expandedSpanMx / 2
    maxMx = centerMx + expandedSpanMx / 2
  } else {
    const expandedSpanMy = spanMx / targetAspect
    const centerMy = (minMy + maxMy) / 2
    minMy = centerMy - expandedSpanMy / 2
    maxMy = centerMy + expandedSpanMy / 2
  }

  spanMx = Math.max(1e-9, maxMx - minMx)
  spanMy = Math.max(1e-9, maxMy - minMy)

  const scale = Math.min(innerWidth / spanMx, innerHeight / spanMy)
  const usedWidth = spanMx * scale
  const usedHeight = spanMy * scale
  const offsetX = params.box.x + (params.box.width - usedWidth) / 2
  const offsetY = params.box.y + (params.box.height - usedHeight) / 2

  const projectLngLat: ProjectLngLat = (lng, lat) => {
    const mercator = lngLatToMercator(lng, lat)
    return {
      x: offsetX + (mercator.x - minMx) * scale,
      y: offsetY + (mercator.y - minMy) * scale
    }
  }

  const northWest = mercatorToLngLat(minMx, minMy)
  const southEast = mercatorToLngLat(maxMx, maxMy)
  const adjustedBounds = {
    minLng: northWest.lng,
    maxLng: southEast.lng,
    minLat: southEast.lat,
    maxLat: northWest.lat
  }

  return { bounds: adjustedBounds, projectLngLat }
}

function tile2lon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}

function tile2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

function tileCoordToLngLat(
  x: number,
  y: number,
  tileX: number,
  tileY: number,
  z: number,
  extent = TILE_EXTENT
): LngLat {
  const globalX = tileX + x / extent
  const globalY = tileY + y / extent
  return { lng: tile2lon(globalX, z), lat: tile2lat(globalY, z) }
}

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}

function latToTileY(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** z
  )
}

function chooseZoom(lonSpan: number, latSpan: number): number {
  const span = Math.max(lonSpan, latSpan)
  if (span > 3) return 8
  if (span > 1.5) return 9
  if (span > 0.75) return 10
  if (span > 0.35) return 11
  return CAUCASUS_MAX_ZOOM
}

function ringsToSvgPaths(
  rings: { x: number; y: number }[][],
  tileX: number,
  tileY: number,
  z: number,
  extent: number,
  projectLngLat: ProjectLngLat
): string[] {
  return rings
    .filter((ring) => ring.length > 1)
    .map((ring) => {
      const commands: string[] = []
      let started = false
      for (const point of ring) {
        const { lng, lat } = tileCoordToLngLat(point.x, point.y, tileX, tileY, z, extent)
        const pixel = projectLngLat(lng, lat)
        commands.push(`${started ? 'L' : 'M'} ${pixel.x.toFixed(1)} ${pixel.y.toFixed(1)}`)
        started = true
      }
      if (commands.length < 2) return ''
      return `${commands.join(' ')} Z`
    })
    .filter((path) => path.length > 0)
}

function lineLengthOnScreen(
  line: { x: number; y: number }[],
  tileX: number,
  tileY: number,
  z: number,
  extent: number,
  projectLngLat: ProjectLngLat
): number {
  let total = 0
  let previous: MapPixel | undefined

  for (const point of line) {
    const { lng, lat } = tileCoordToLngLat(point.x, point.y, tileX, tileY, z, extent)
    const pixel = projectLngLat(lng, lat)
    if (previous) {
      total += Math.hypot(pixel.x - previous.x, pixel.y - previous.y)
    }
    previous = pixel
  }

  return total
}

function lineToSvgPath(
  line: { x: number; y: number }[],
  tileX: number,
  tileY: number,
  z: number,
  extent: number,
  projectLngLat: ProjectLngLat
): string | undefined {
  if (line.length < 2) return undefined

  const commands: string[] = []
  let started = false
  for (const point of line) {
    const { lng, lat } = tileCoordToLngLat(point.x, point.y, tileX, tileY, z, extent)
    const pixel = projectLngLat(lng, lat)
    commands.push(`${started ? 'L' : 'M'} ${pixel.x.toFixed(1)} ${pixel.y.toFixed(1)}`)
    started = true
  }

  if (commands.length < 2) return undefined
  return commands.join(' ')
}

type MapFeaturePaths = {
  land: string[]
  water: string[]
  rivers: MapRiverPath[]
}

type MapRiverPath = { path: string; screenLength: number }

async function loadTileFeatures(
  archive: PMTiles,
  z: number,
  x: number,
  y: number,
  projectLngLat: ProjectLngLat
): Promise<MapFeaturePaths> {
  const result = await archive.getZxy(z, x, y)
  if (!result) return { land: [], water: [], rivers: [] }

  const tile = new VectorTile(new Pbf(result.data))
  const land: string[] = []
  const water: string[] = []
  const rivers: MapRiverPath[] = []

  for (const layerName of MAP_LAYERS) {
    const layer = tile.layers[layerName]
    if (!layer) continue

    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index)
      const geometry = feature.loadGeometry()
      const kind = feature.properties.kind as string | undefined

      if (feature.type === 3) {
        const paths = ringsToSvgPaths(geometry, x, y, z, layer.extent, projectLngLat)
        if (layerName === 'earth') land.push(...paths)
        else water.push(...paths)
        continue
      }

      if (layerName === 'water' && feature.type === 2) {
        if (kind !== 'river') continue
        for (const line of geometry) {
          const screenLength = lineLengthOnScreen(line, x, y, z, layer.extent, projectLngLat)
          const path = lineToSvgPath(line, x, y, z, layer.extent, projectLngLat)
          if (path && screenLength >= MIN_MAJOR_RIVER_PIXEL_LENGTH) {
            rivers.push({ path, screenLength })
          }
        }
      }
    }
  }

  return { land, water, rivers }
}

export async function renderGeographicMapLayerFromPmtiles(params: {
  theatreName?: string
  bounds: LngLatBounds
  projectLngLat: ProjectLngLat
}): Promise<string> {
  const archive = getTheatrePmtiles(params.theatreName ?? 'Caucasus')
  if (!archive) return ''

  const lonSpan = params.bounds.maxLng - params.bounds.minLng
  const latSpan = params.bounds.maxLat - params.bounds.minLat
  const zoom = chooseZoom(lonSpan, latSpan)

  const minTileX = lonToTileX(params.bounds.minLng, zoom)
  const maxTileX = lonToTileX(params.bounds.maxLng, zoom)
  const minTileY = latToTileY(params.bounds.maxLat, zoom)
  const maxTileY = latToTileY(params.bounds.minLat, zoom)

  const land: string[] = []
  const water: string[] = []
  const rivers: MapRiverPath[] = []

  for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      const tileFeatures = await loadTileFeatures(archive, zoom, tileX, tileY, params.projectLngLat)
      land.push(...tileFeatures.land)
      water.push(...tileFeatures.water)
      rivers.push(...tileFeatures.rivers)
    }
  }

  const selectedRivers = rivers
    .sort((a, b) => b.screenLength - a.screenLength || a.path.localeCompare(b.path))
    .slice(0, MAX_MAJOR_RIVER_PATHS)

  if (land.length === 0 && water.length === 0 && selectedRivers.length === 0) return ''

  return `
    ${land.map((path) => `<path d="${path}" class="map-land" />`).join('')}
    ${water.map((path) => `<path d="${path}" class="map-sea" />`).join('')}
    ${selectedRivers.map((river) => `<path d="${river.path}" class="map-river" />`).join('')}
  `
}
