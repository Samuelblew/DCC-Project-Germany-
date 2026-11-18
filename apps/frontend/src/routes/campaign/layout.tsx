import { Outlet, useLocation, useNavigate } from 'react-router'
import { useTick } from './tick'
import { useEffect, useRef, useState } from 'react'
import { coreClient } from '@/lib/orpc'
import { activeStore, onActiveCampaignSaveRequest } from '@/stores/active'
import { useSelector } from '@xstate/store/react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { orpc } from '@/lib/orpc'
import { ArrowLeft, Flag, Plane, PlaneTakeoff, Target, type LucideIcon } from 'lucide-react'

const AUTOSAVE_INTERVAL_MS = 1_000

export function CampaignLayout() {
  useTick()
  const navigate = useNavigate()
  const location = useLocation()
  const timeMultiplier = useSelector(activeStore, (state) => state.context.timeMultiplier)
  const scenarioId = useSelector(activeStore, (state) => state.context.scenarioId)
  const campaignGoal = useSelector(activeStore, (state) => state.context.goal)
  const autosaveInFlightRef = useRef(false)
  const pendingAutosaveRef = useRef(false)
  const [showWelcomeDialog, setShowWelcomeDialog] = useState(
    typeof location.state === 'object' &&
      location.state !== null &&
      'showWelcomeDialog' in location.state &&
      location.state.showWelcomeDialog === true
  )
  const scenarioQuery = useQuery(
    orpc.data.getScenario.queryOptions({
      input: scenarioId
    })
  )
  const playerSide = useSelector(activeStore, (state) => state.context.playerSide)
  const scenarioBriefing =
    playerSide === 'red'
      ? (scenarioQuery.data?.opponentBriefing ?? scenarioQuery.data?.briefing)
      : scenarioQuery.data?.briefing
  const scenarioGoal = campaignGoal ?? scenarioQuery.data?.goal

  const saveCurrentCampaign = async (setTimeMultiplierToZero = false) => {
    if (autosaveInFlightRef.current) {
      pendingAutosaveRef.current = true
      return
    }

    do {
      pendingAutosaveRef.current = false
      autosaveInFlightRef.current = true

      try {
        const snapshot = activeStore.getSnapshot().context
        await coreClient.campaign.saveActiveCampaign({
          ...snapshot,
          ...(setTimeMultiplierToZero ? { timeMultiplier: 0 } : {})
        })
      } catch (error) {
        console.error('Failed to save campaign:', error)
      } finally {
        autosaveInFlightRef.current = false
      }
    } while (pendingAutosaveRef.current)
  }

  useEffect(() => {
    const handleSaveCampaign = async () => {
      await saveCurrentCampaign(true)
    }

    const handleExportMission = async () => {
      await coreClient.campaign.generateMiz(activeStore.getSnapshot().context)
    }

    const handleReturnToMenu = () => {
      navigate('/new')
    }

    const handleRemoveAllFlightGroups = () => {
      activeStore.send({ type: 'removeAllFlightGroups' })
    }

    // Register menu event listeners
    const unsubscribeSave = window.api?.onMenuSaveCampaign(handleSaveCampaign)
    const unsubscribeExport = window.api?.onMenuExportMission(handleExportMission)
    const unsubscribeReturn = window.api?.onMenuReturnToMenu(handleReturnToMenu)
    const unsubscribeRemoveFlightGroups = window.api?.onMenuRemoveFlightGroups(
      handleRemoveAllFlightGroups
    )

    return () => {
      unsubscribeSave?.()
      unsubscribeExport?.()
      unsubscribeReturn?.()
      unsubscribeRemoveFlightGroups?.()
    }
  }, [navigate])

  useEffect(() => {
    if (timeMultiplier <= 0) {
      return
    }

    const autosaveInterval = setInterval(() => {
      void saveCurrentCampaign(false)
    }, AUTOSAVE_INTERVAL_MS)

    return () => {
      clearInterval(autosaveInterval)
    }
  }, [timeMultiplier])

  useEffect(() => {
    return onActiveCampaignSaveRequest(() => {
      void saveCurrentCampaign(false)
    })
  }, [])

  const closeWelcomeDialog = () => {
    setShowWelcomeDialog(false)

    if (window.history.state && typeof window.history.state === 'object') {
      window.history.replaceState({ ...window.history.state, usr: null }, '', window.location.href)
    }
  }

  return (
    <div className="h-full">
      <Outlet />
      <WelcomeCampaignDialog
        open={showWelcomeDialog}
        onStart={closeWelcomeDialog}
        scenarioId={scenarioId}
        briefing={scenarioBriefing}
        goalObjectiveIds={scenarioGoal?.objectiveIds}
      />
    </div>
  )
}

function WelcomeCampaignDialog({
  open,
  onStart,
  scenarioId,
  briefing,
  goalObjectiveIds
}: {
  open: boolean
  onStart: () => void
  scenarioId?: string
  briefing?: string
  goalObjectiveIds?: string[]
}) {
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null)
  const selectedAction = welcomeActions.find((action) => action.id === selectedActionId)
  const SelectedActionIcon = selectedAction?.icon
  const briefingParagraphs = briefing
    ?.split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="app-no-drag grid max-h-[min(90vh,760px)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden overflow-y-hidden border-synthwave-cyan/35 bg-synthwave-dark/95 p-0 text-synthwave-light shadow-[0_0_55px_color-mix(in_srgb,var(--synthwave-cyan)_18%,transparent)] backdrop-blur sm:max-w-2xl"
      >
        <div className="relative border-b border-synthwave-pink/25 px-6 py-5">
          <div className="absolute inset-0 bg-linear-to-r from-synthwave-purple/18 via-synthwave-pink/10 to-synthwave-cyan/12" />
          <DialogHeader className="relative gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-md border border-synthwave-cyan/40 bg-synthwave-cyan/10 text-synthwave-cyan shadow-[0_0_22px_color-mix(in_srgb,var(--synthwave-cyan)_22%,transparent)]">
              <PlaneTakeoff className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="retro-font text-2xl tracking-wide text-white">
                Campaign initialized
              </DialogTitle>
              <DialogDescription className="mt-2 max-w-xl text-sm leading-6 text-synthwave-light/75">
                Your campaign is ready. Select a flight group in the sidebar, press Takeoff, and fly
                the generated mission in DCS.
              </DialogDescription>
            </div>
          </DialogHeader>
        </div>

        <div className="synthwave-scrollbar min-h-0 overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            {selectedAction && SelectedActionIcon ? (
              <section className="space-y-4">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-synthwave-cyan transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-synthwave-cyan focus-visible:outline-none"
                  onClick={() => setSelectedActionId(null)}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-synthwave-cyan/30 bg-synthwave-cyan/10 text-synthwave-cyan">
                    <SelectedActionIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-white">
                      {selectedAction.detailTitle}
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-synthwave-light/78">
                      {selectedAction.detail}
                    </p>
                  </div>
                </div>
              </section>
            ) : (
              <>
                {briefingParagraphs && briefingParagraphs.length > 0 ? (
                  <section className="space-y-3">
                    <h3 className="retro-font text-xs uppercase tracking-wide text-synthwave-cyan">
                      Scenario
                    </h3>
                    <div className="space-y-3 text-sm leading-6 text-synthwave-light/78">
                      {briefingParagraphs.map((paragraph, index) => (
                        <p key={index}>{paragraph}</p>
                      ))}
                    </div>
                  </section>
                ) : null}

                {scenarioId === 'falklands-1982' ? (
                  <section>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="retro-font text-xs uppercase tracking-wide text-synthwave-cyan">
                        Campaign Phases
                      </h3>
                      <span className="text-xs text-synthwave-light/55">
                        {falklandsCampaignPhases.length} Phases
                      </span>
                    </div>
                    <ol className="space-y-2">
                      {falklandsCampaignPhases.map((phase, index) => (
                        <li
                          key={phase.title}
                          className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-md border border-synthwave-cyan/15 bg-synthwave-cyan/[0.045] p-3"
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded border border-synthwave-cyan/35 bg-synthwave-cyan/10 font-mono text-xs text-synthwave-cyan">
                            {String(index + 1).padStart(2, '0')}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-sm font-semibold text-white">{phase.title}</h4>
                              {index === 0 ? (
                                <span className="rounded border border-synthwave-pink/35 bg-synthwave-pink/8 px-1.5 py-0.5 text-[0.55rem] uppercase tracking-wider text-synthwave-pink">
                                  Start
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs leading-5 text-synthwave-light/68">
                              {phase.description}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}

                {goalObjectiveIds && goalObjectiveIds.length > 0 ? (
                  <section>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="retro-font text-xs uppercase tracking-wide text-synthwave-cyan">
                        Campaign Goal
                      </h3>
                      <span className="text-xs text-synthwave-light/55">
                        {goalObjectiveIds.length} Objectives
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {goalObjectiveIds.map((objectiveId) => (
                        <li
                          key={objectiveId}
                          className="flex items-start gap-3 rounded-md border border-synthwave-pink/15 bg-synthwave-pink/[0.06] p-3 text-sm text-synthwave-light/82"
                        >
                          <Target className="mt-0.5 h-4 w-4 shrink-0 text-synthwave-pink" />
                          <span>Capture {objectiveId}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              {welcomeActions.map((action) => (
                <WelcomeStep
                  key={action.id}
                  icon={action.icon}
                  title={action.title}
                  text={action.text}
                  selected={action.id === selectedActionId}
                  onClick={() => setSelectedActionId(action.id)}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-synthwave-purple/25 bg-black/18 px-6 py-4">
          <Button
            type="button"
            className="bg-synthwave-cyan text-synthwave-dark hover:bg-synthwave-cyan/85"
            onClick={() => {
              activeStore.trigger.updateTimeMultiplier({ timeMultiplier: 1 })
              onStart()
            }}
          >
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const falklandsCampaignPhases = [
  {
    title: 'Sea Control & Landing Preparation',
    description:
      'Protect the carrier, escort, and amphibious group. Eliminate hostile ships, the island SAM network, and local radar defenses to clear San Carlos.'
  },
  {
    title: 'San Carlos Landing',
    description:
      'Hold the task force together while the amphibious group unloads at San Carlos. The landing takes 30 campaign minutes.'
  },
  {
    title: 'Land Campaign',
    description:
      'Use the San Carlos beachhead, FARP, and landed formations to advance east and capture Port Stanley and Stanley Airport.'
  }
] as const

const welcomeActions: {
  id: string
  icon: LucideIcon
  title: string
  text: string
  detailTitle: string
  detail: string
}[] = [
  {
    id: 'select-flight',
    icon: Plane,
    title: 'Select a flight',
    text: 'Choose a flight group from the sidebar.',
    detailTitle: 'Pick the sortie you want to fly',
    detail:
      'Use the Flight Groups sidebar to select one of the available player flight groups. This decides which aircraft, task, and route you will fly next.'
  },
  {
    id: 'fly-mission',
    icon: PlaneTakeoff,
    title: 'Fly the mission',
    text: 'Export the sortie, launch DCS, and complete it.',
    detailTitle: 'Generate the .miz and fly it in DCS',
    detail:
      'Export the mission, open it in DCS World, and fly the selected package. The campaign waits for the mission state written by DCS persistence, which records losses, landings, captures, and other results.'
  },
  {
    id: 'reach-goal',
    icon: Flag,
    title: 'Reach the goal',
    text: 'Submit results and keep pushing objectives forward.',
    detailTitle: 'Debrief, advance, and keep pressure on the goal',
    detail:
      'After the mission, submit the DCS state file from the Mission view. The campaign applies the result, updates control and resources, then moves you closer to capturing the campaign objectives.'
  }
]

function WelcomeStep({
  icon: Icon,
  title,
  text,
  selected,
  onClick
}: {
  icon: LucideIcon
  title: string
  text: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`rounded-md border p-4 text-left transition-all focus-visible:ring-2 focus-visible:ring-synthwave-cyan focus-visible:outline-none ${
        selected
          ? 'border-synthwave-cyan/55 bg-synthwave-cyan/[0.09] shadow-[0_0_22px_color-mix(in_srgb,var(--synthwave-cyan)_14%,transparent)]'
          : 'border-synthwave-purple/25 bg-white/[0.04] hover:border-synthwave-pink/40 hover:bg-synthwave-pink/[0.06]'
      }`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <Icon className="mb-3 h-5 w-5 text-synthwave-pink" />
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-synthwave-light/65">{text}</p>
    </button>
  )
}
