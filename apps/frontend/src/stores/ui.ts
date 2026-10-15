import { createStore } from '@xstate/store'

export const mapLayerKeys = [
  'airdromes',
  'towns',
  'flights',
  'ground',
  'naval',
  'convoys',
  'structures',
  'sam',
  'ewr',
  'gci',
  'pilots',
  'frontline',
  'samRange'
] as const

export type MapLayerKey = (typeof mapLayerKeys)[number]

export type MapLayers = Record<MapLayerKey, boolean>

export const defaultMapLayers: MapLayers = {
  airdromes: true,
  towns: true,
  flights: true,
  ground: true,
  naval: true,
  convoys: true,
  structures: true,
  sam: true,
  ewr: true,
  gci: true,
  pilots: true,
  frontline: true,
  samRange: false
}

export const uiStore = createStore({
  context: {
    isLogOpen: false,
    showAtoPackages: false,
    showLogistics: false,
    mapLayers: defaultMapLayers,
    showMissionFootprint: false
  },
  on: {
    toggleLog: (context) => ({ ...context, isLogOpen: !context.isLogOpen }),
    toggleAtoPackages: (context) => ({
      ...context,
      showAtoPackages: !context.showAtoPackages
    }),
    toggleLogistics: (context) => ({ ...context, showLogistics: !context.showLogistics }),
    toggleMissionFootprint: (context) => ({
      ...context,
      showMissionFootprint: !context.showMissionFootprint
    }),
    setMapLayer: (context, event: { layer: MapLayerKey; visible: boolean }) => ({
      ...context,
      mapLayers: { ...defaultMapLayers, ...context.mapLayers, [event.layer]: event.visible }
    }),
    resetMapLayers: (context) => ({ ...context, mapLayers: { ...defaultMapLayers } }),
    toggleMapLayer: (context, event: { layer: MapLayerKey }) => ({
      ...context,
      mapLayers: {
        ...defaultMapLayers,
        ...context.mapLayers,
        [event.layer]: !(context.mapLayers[event.layer] ?? defaultMapLayers[event.layer])
      }
    })
  }
})
