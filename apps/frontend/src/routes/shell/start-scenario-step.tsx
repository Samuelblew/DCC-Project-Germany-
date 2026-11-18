import { ArrowRight, Globe2 } from 'lucide-react'
import { scenarios } from '@dcc/data'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { Scenario } from './start-campaign-options'

type ScenarioStepProps = {
  selectedScenario: Scenario | undefined
  isCreatingCampaign: boolean
  onSelectScenario: (scenarioId: string) => void
  onContinue: () => void
}

export function ScenarioStep({
  selectedScenario,
  isCreatingCampaign,
  onSelectScenario,
  onContinue
}: ScenarioStepProps) {
  return (
    <div className="grid min-h-0 flex-1 overflow-hidden gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="synthwave-scrollbar min-h-0 overflow-auto pr-2">
        <div className="grid gap-3">
          {scenarios.map((scenario) => {
            const isSelected = scenario.id === selectedScenario?.id
            const briefingPreview =
              scenario.briefing
                .split(/\n{2,}/)[0]
                ?.replace(/\s+/g, ' ')
                .trim() ?? ''

            return (
              <button
                key={scenario.id}
                type="button"
                className={cn(
                  'group flex min-h-48 flex-col rounded-md border p-4 text-left transition-all',
                  'bg-synthwave-dark/78 shadow-[0_18px_45px_rgba(0,0,0,0.22)] backdrop-blur',
                  isSelected
                    ? 'border-synthwave-pink text-white shadow-[0_0_32px_color-mix(in_srgb,var(--synthwave-pink)_24%,transparent)]'
                    : 'border-synthwave-purple/45 text-synthwave-light hover:border-synthwave-cyan hover:bg-synthwave-purple/10',
                  !scenario.available && 'cursor-not-allowed opacity-45'
                )}
                onClick={() => {
                  if (scenario.available) {
                    onSelectScenario(scenario.id)
                  }
                }}
                disabled={!scenario.available}
              >
                <div className="mb-4">
                  <div>
                    <div className="retro-font text-xl tracking-wide">{scenario.name}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-synthwave-cyan/75">
                      <span className="inline-flex items-center gap-1">
                        <Globe2 className="h-3.5 w-3.5" />
                        {scenario.theatreName}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="line-clamp-4 text-sm leading-6 text-synthwave-light/68">
                  {briefingPreview}
                </p>
                <div className="mt-auto flex min-h-5 justify-end pt-4">
                  {scenario.author ? (
                    <span className="text-xs uppercase tracking-wide text-synthwave-light/45">
                      Author {scenario.author}
                    </span>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <aside className="flex min-h-0 flex-col rounded-md border border-synthwave-pink/35 bg-black/30 p-5 shadow-[0_0_44px_color-mix(in_srgb,var(--synthwave-pink)_14%,transparent)] backdrop-blur">
        {selectedScenario ? (
          <>
            <div className="retro-font text-2xl text-white">{selectedScenario.name}</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-synthwave-cyan/80">
              <span>{selectedScenario.theatreName}</span>
            </div>
            <div className="synthwave-scrollbar mt-5 min-h-0 flex-1 overflow-auto border-y border-synthwave-purple/30 py-4">
              {selectedScenario.briefing
                .split(/\n{2,}/)
                .filter((paragraph) => paragraph.trim().length > 0)
                .map((paragraph) => (
                  <p
                    key={paragraph}
                    className="mb-4 text-sm leading-6 text-synthwave-light/72 last:mb-0"
                  >
                    {paragraph}
                  </p>
                ))}
            </div>
            <div className="mt-5 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-synthwave-light/55">PLAYER</span>
                <span className="truncate text-right text-white">
                  {selectedScenario.start.player.airdromeNames.join(', ')}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-synthwave-light/55">OBJECTIVE</span>
                <span className="truncate text-right text-synthwave-pink">
                  {selectedScenario.goal?.objectiveIds.join(', ') ?? 'Campaign advance'}
                </span>
              </div>
            </div>
            <Button
              type="button"
              className="mt-5 h-11 bg-synthwave-pink text-white hover:bg-synthwave-pink/85"
              onClick={onContinue}
              disabled={isCreatingCampaign || !selectedScenario.available}
            >
              NEXT
              <ArrowRight className="h-4 w-4" />
            </Button>
          </>
        ) : null}
      </aside>
    </div>
  )
}
