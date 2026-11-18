import { GRAYSCALE, layers, type Flavor } from '@protomaps/basemaps'
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'

// Neutral mid-light grey basemap so coalition overlays and the black-red-gold UI read clearly.
const tacticalGreyFlavor: Flavor = {
  ...GRAYSCALE,
  background: '#8c949b',
  earth: '#b3b5b7',
  park_a: '#adb0b0',
  park_b: '#abaeae',
  hospital: '#b7b8b9',
  industrial: '#acadaf',
  school: '#b7b8b9',
  wood_a: '#a9acac',
  wood_b: '#a7aaaa',
  pedestrian: '#b9babb',
  scrub_a: '#aeb0b0',
  scrub_b: '#acaeae',
  glacier: '#c8cacc',
  sand: '#bdbcb8',
  beach: '#c0bfbb',
  aerodrome: '#a9abad',
  runway: '#d8d9da',
  water: '#8c949b',
  zoo: '#adafb0',
  military: '#a6a8aa',
  pier: '#a3a5a7',
  buildings: '#a2a4a6',
  minor_service_casing: '#a0a2a4',
  minor_casing: '#a0a2a4',
  link_casing: '#a0a2a4',
  major_casing_late: '#9a9c9f',
  highway_casing_late: '#95979a',
  other: '#c4c5c6',
  minor_service: '#c4c5c6',
  minor_a: '#cbcccd',
  minor_b: '#c4c5c6',
  link: '#cbcccd',
  major_casing_early: '#9a9c9f',
  major: '#d2d3d4',
  highway_casing_early: '#95979a',
  highway: '#dcdcdd',
  railway: '#8e9093',
  boundaries: '#5f6366',
  bridges_other_casing: '#a0a2a4',
  bridges_minor_casing: '#a0a2a4',
  bridges_link_casing: '#a0a2a4',
  bridges_major_casing: '#9a9c9f',
  bridges_highway_casing: '#95979a',
  bridges_other: '#c4c5c6',
  bridges_minor: '#cbcccd',
  bridges_link: '#cbcccd',
  bridges_major: '#d2d3d4',
  bridges_highway: '#dcdcdd',
  roads_label_minor: '#55585b',
  roads_label_minor_halo: '#c4c5c6',
  roads_label_major: '#4a4d50',
  roads_label_major_halo: '#d0d1d2',
  ocean_label: '#4c555d',
  subplace_label: '#3e4144',
  subplace_label_halo: '#bfc1c3',
  city_label: '#26282a',
  city_label_halo: '#c6c8ca',
  state_label: '#4d5053',
  state_label_halo: '#bfc1c3',
  country_label: '#3a3d40',
  address_label: '#55585b',
  address_label_halo: '#c4c5c6'
}

const worldSource = 'protomaps-world'
const worldPmtilesUrl = new URL('./maps/world-low.pmtiles', window.location.href).toString()

type TheatreDetailMap = {
  source: string
  path: string
  bounds: [number, number, number, number]
}

const theatreDetailMaps: TheatreDetailMap[] = [
  {
    source: 'protomaps-caucasus',
    path: './maps/caucasus/caucasus.pmtiles',
    bounds: [36.4, 40.7, 46.0, 47.6]
  },
  {
    source: 'protomaps-persian-gulf',
    path: './maps/persian-gulf/persian-gulf.pmtiles',
    bounds: [52.170937, 23.120984, 58.262927, 30.802893]
  },
  {
    source: 'protomaps-syria',
    path: './maps/syria/syria.pmtiles',
    bounds: [31.667351, 31.871518, 40.806337, 37.861136]
  },
  {
    source: 'protomaps-south-atlantic',
    path: './maps/south-atlantic/south-atlantic.pmtiles',
    bounds: [-75, -56, -56, -45]
  },
  {
    source: 'protomaps-germany-cold-war',
    path: './maps/germany-cold-war/germany-cold-war.pmtiles',
    bounds: [5.2, 47.2, 15.8, 56.2]
  }
]
const caucasusDetailMap = theatreDetailMaps[0]!
const caucasusSource = caucasusDetailMap.source
const caucasusPmtilesUrl = new URL(caucasusDetailMap.path, window.location.href).toString()
const caucasusDetailBounds = caucasusDetailMap.bounds
export const THEATRE_DETAIL_MAX_ZOOM = 12
export const CAUCASUS_DETAIL_MAX_ZOOM = THEATRE_DETAIL_MAX_ZOOM

function prepareLayer(
  layer: LayerSpecification,
  source: string,
  minzoom?: number,
  maxzoom?: number
) {
  const preparedLayer = {
    ...layer,
    id: `${source}-${layer.id}`,
    ...(minzoom == null ? {} : { minzoom }),
    ...(maxzoom == null ? {} : { maxzoom })
  }

  if (
    preparedLayer.type !== 'symbol' ||
    !('layout' in preparedLayer) ||
    preparedLayer.layout == null
  ) {
    return preparedLayer
  }
  if (!('text-field' in preparedLayer.layout)) return preparedLayer
  if (preparedLayer.id.endsWith('address_label') || preparedLayer.id.endsWith('roads_shields')) {
    return preparedLayer
  }

  return {
    ...preparedLayer,
    layout: {
      ...preparedLayer.layout,
      'text-field': ['get', 'name:en'] as ['get', string]
    }
  }
}

function prepareLayers(
  source: string,
  minzoom?: number,
  maxzoom?: number,
  options: { includeBackground?: boolean } = {}
) {
  return layers(source, tacticalGreyFlavor, { lang: 'en' })
    .filter((layer) => options.includeBackground !== false || layer.type !== 'background')
    .map((layer) => prepareLayer(layer, source, minzoom, maxzoom))
}

const englishOnlyLayers = [
  ...prepareLayers(worldSource),
  ...theatreDetailMaps.flatMap((detailMap) =>
    prepareLayers(detailMap.source, 6, undefined, { includeBackground: false })
  )
]

const layersWithEmptyEnglishLabels = englishOnlyLayers.map((layer) => {
  if (layer.type !== 'symbol' || !('layout' in layer) || layer.layout == null) return layer
  if (!('text-field' in layer.layout)) return layer
  if (layer.id.endsWith('address_label') || layer.id.endsWith('roads_shields')) return layer

  return {
    ...layer,
    layout: {
      ...layer.layout,
      'text-field': ['get', 'name:en'] as ['get', string]
    }
  }
})

const additionalTheatreSources = Object.fromEntries(
  theatreDetailMaps.slice(1).map((detailMap) => [
    detailMap.source,
    {
      type: 'vector' as const,
      url: `pmtiles://${new URL(detailMap.path, window.location.href).toString()}`,
      attribution:
        '<a href="https://github.com/protomaps/basemaps">Protomaps</a> Â© <a href="https://osm.org/copyright">OpenStreetMap</a>',
      minzoom: 3,
      maxzoom: THEATRE_DETAIL_MAX_ZOOM,
      bounds: detailMap.bounds
    }
  ])
)

export const offlineCaucasusMapStyle: StyleSpecification = {
  version: 8,
  glyphs: './maps/fonts/{fontstack}/{range}.pbf',
  sources: {
    [worldSource]: {
      type: 'vector',
      url: `pmtiles://${worldPmtilesUrl}`,
      attribution:
        '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://osm.org/copyright">OpenStreetMap</a>',
      minzoom: 0,
      maxzoom: 5
    },
    [caucasusSource]: {
      type: 'vector',
      url: `pmtiles://${caucasusPmtilesUrl}`,
      attribution:
        '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://osm.org/copyright">OpenStreetMap</a>',
      minzoom: 3,
      maxzoom: CAUCASUS_DETAIL_MAX_ZOOM,
      bounds: caucasusDetailBounds
    },
    ...additionalTheatreSources
  },
  layers: layersWithEmptyEnglishLabels
}

export const offlineTheatreMapStyle = offlineCaucasusMapStyle
