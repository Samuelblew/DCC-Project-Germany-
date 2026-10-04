import { Layers } from 'lucide-react'
import { useState } from 'react'
import { useSelector } from '@xstate/store/react'

import { Button } from '@/components/ui/button'
import { uiStore, type MapLayerKey, defaultMapLayers } from '@/stores/ui'

const layerOptions: Array<{ key: MapLayerKey; label: string }> = [
  { key: 'airdromes', label: 'Airdromes' },
  { key: 'towns', label: 'Towns' },
  { key: 'flights', label: 'Flights' },
  { key: 'ground', label: 'Ground' },
  { key: 'structures', label: 'Structures' },
  { key: 'sam', label: 'SAM' },
  { key: 'ewr', label: 'Radar' },
  { key: 'gci', label: 'GCI' },
  { key: 'frontline', label: 'Front line' },
  { key: 'samRange', label: 'SAM range' }
]

export function MapLayerFilter() {
  const [open, setOpen] = useState(false)
  const mapLayers = useSelector(uiStore, (state) => state.context.mapLayers)

  return (
    <div className="tactical-inset relative rounded-full p-2">
      <Button
        variant="outline"
        size="sm"
        className={`tactical-button h-[30px] w-[30px] rounded-full p-0 text-secondary backdrop-blur-md ${
          open ? 'text-synthwave-light ring-1 ring-synthwave-pink/60' : ''
        }`}
        onClick={() => setOpen((value) => !value)}
        title="Map layers"
        aria-label="Map layers"
        aria-pressed={open}
        aria-expanded={open}
      >
        <Layers className="h-3.5 w-3.5" />
      </Button>
      {open ? (
        <div className="tactical-panel absolute right-full bottom-0 mr-2 w-44 rounded-md p-2 text-synthwave-light backdrop-blur-md">
          <div className="retro-font mb-1 px-1 text-[10px] uppercase tracking-wide text-primary">
            Layers
          </div>
          <div className="flex flex-col">
            {layerOptions.map((option) => {
              const enabled = mapLayers[option.key] ?? defaultMapLayers[option.key]
              return (
                <button
                  key={option.key}
                  type="button"
                  className={`flex items-center justify-between rounded px-1.5 py-1 text-left text-[11px] text-secondary hover:bg-synthwave-pink/10 hover:text-synthwave-light ${
                    option.key === 'samRange' ? 'mt-1 border-t border-white/10 pt-2' : ''
                  }`}
                  aria-pressed={enabled}
                  onClick={() => uiStore.trigger.toggleMapLayer({ layer: option.key })}
                >
                  <span>{option.label}</span>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      enabled
                        ? 'bg-synthwave-cyan shadow-[0_0_8px_rgba(232,183,48,0.7)]'
                        : 'bg-white/15'
                    }`}
                  />
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
