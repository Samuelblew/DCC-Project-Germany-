import { Check, Layers, RotateCcw } from 'lucide-react'
import { useSelector } from '@xstate/store/react'
import { DropdownMenu } from 'radix-ui'

import { Button } from '@/components/ui/button'
import { defaultMapLayers, uiStore, type MapLayerKey } from '@/stores/ui'

const layerOptions: Array<{ key: MapLayerKey; label: string }> = [
  { key: 'airdromes', label: 'Airfields' },
  { key: 'towns', label: 'Towns & objectives' },
  { key: 'flights', label: 'Flights' },
  { key: 'ground', label: 'Ground forces' },
  { key: 'naval', label: 'Naval groups' },
  { key: 'convoys', label: 'Supply convoys' },
  { key: 'structures', label: 'Structures' },
  { key: 'sam', label: 'SAMs' },
  { key: 'ewr', label: 'Radars' },
  { key: 'gci', label: 'GCI' },
  { key: 'pilots', label: 'Downed pilots' },
  { key: 'frontline', label: 'Frontline' },
  { key: 'samRange', label: 'SAM threat ranges' }
]

/** Layer toggles in a portalled menu, so no map panel or card can clip or cover it. */
export function MapLayerFilter() {
  const mapLayers = useSelector(uiStore, (state) => state.context.mapLayers)
  const isVisible = (key: MapLayerKey) => mapLayers[key] ?? defaultMapLayers[key]
  const hasChanges = layerOptions.some(({ key }) => isVisible(key) !== defaultMapLayers[key])

  return (
    <DropdownMenu.Root modal={false}>
      <div className="tactical-inset rounded-full p-2">
        <DropdownMenu.Trigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="tactical-button relative h-[30px] w-[30px] rounded-full p-0 text-secondary backdrop-blur-md data-[state=open]:text-synthwave-cyan data-[state=open]:ring-1 data-[state=open]:ring-synthwave-cyan/60"
            title="Map layers"
            aria-label="Map layers"
          >
            <Layers className="h-3.5 w-3.5" />
            {hasChanges && (
              <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-synthwave-cyan" />
            )}
          </Button>
        </DropdownMenu.Trigger>
      </div>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="left"
          align="end"
          sideOffset={12}
          collisionPadding={12}
          aria-label="Map layers"
          className="tactical-panel z-1200 w-60 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-md p-2 text-synthwave-light backdrop-blur-md"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <DropdownMenu.Label className="flex items-center justify-between border-b border-synthwave-cyan/15 px-2 pb-2 pt-1">
            <span className="retro-font text-xs uppercase tracking-[0.18em] text-synthwave-cyan">
              Map layers
            </span>
            <span className="text-[9px] uppercase tracking-wider text-secondary/60">Display</span>
          </DropdownMenu.Label>
          <DropdownMenu.Group className="py-1">
            {layerOptions.map(({ key, label }) => (
              <DropdownMenu.CheckboxItem
                key={key}
                checked={isVisible(key)}
                disabled={key === 'samRange' && !isVisible('sam')}
                onCheckedChange={(checked) =>
                  uiStore.trigger.setMapLayer({ layer: key, visible: checked === true })
                }
                onSelect={(event) => event.preventDefault()}
                className="flex cursor-pointer items-center justify-between gap-4 rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-synthwave-cyan/10 data-[highlighted]:text-synthwave-cyan data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
              >
                {label}
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-synthwave-cyan/35 bg-synthwave-dark/60 text-synthwave-cyan">
                  <DropdownMenu.ItemIndicator>
                    <Check className="h-3 w-3" />
                  </DropdownMenu.ItemIndicator>
                </span>
              </DropdownMenu.CheckboxItem>
            ))}
          </DropdownMenu.Group>
          <DropdownMenu.Separator className="h-px bg-synthwave-cyan/15" />
          <DropdownMenu.Item
            disabled={!hasChanges}
            onSelect={(event) => {
              event.preventDefault()
              uiStore.trigger.resetMapLayers()
            }}
            className="mt-1 flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-[11px] text-secondary outline-none data-[highlighted]:bg-synthwave-cyan/10 data-[highlighted]:text-synthwave-cyan data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to defaults
          </DropdownMenu.Item>
          <p className="px-2 pb-1 pt-2 text-[10px] leading-relaxed text-secondary/60">
            Selected routes and briefing objectives stay visible.
          </p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
