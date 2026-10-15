import {
  Info,
  Sun,
  Target,
  Wind,
  FastForward,
  Hourglass,
  Pause,
  Play,
  Menu,
  Save,
  FolderOpen,
  Home as HomeIcon,
  Settings as SettingsIcon,
  Plus,
  Minus,
  Ruler,
  Warehouse,
  EyeOff,
  X
} from 'lucide-react'
import React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { useSelector } from '@xstate/store/react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ScrollBar } from '@/components/ui/scroll-area'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import type { SelectedItem } from './map'
import { MapLayerFilter } from './map-layer-filter'
import { activeStore } from '@/stores/active'
import { uiStore } from '@/stores/ui'
import { coreClient, orpc } from '@/lib/orpc'
import { Clock } from './clock'
import { CheatMenu } from './cheat-menu'
import { WorldModeMenu } from './world-mode-menu'
import { ActiveFlightGroups } from './active-flight-groups'
import { AtoPackageBoard } from './ato-package-board'
import { LogisticsOverview } from './logistics-overview'
import { CampaignOperationsOverview } from './campaign-operations-overview'
import { TakeoffButton } from './takeoff-button'
import { CareerDialog } from './career-dialog'
import { CareerSidebar } from './career-sidebar'
import { CAUCASUS_DETAIL_MAX_ZOOM } from './offline-map-style'

const campaignData = {
  name: 'Mission Briefing',
  description:
    'A daring raid on a heavily fortified enemy airbase. Intelligence suggests they are preparing a large-scale offensive. Your mission: cripple their air power before they can launch.',
  windSpeed: '15 knots',
  windDirection: 'NW',
  temperature: '28°C',
  objectives: ['Destroy the primary fuel depot', 'Disable the runway', 'Eliminate enemy air patrol']
}

const LOG_ROW_HEIGHT = 52
const LOG_OVERSCAN = 6
const MAP_OVERLAY_SAFE_LEFT_PX = 412
const CampaignMap = React.lazy(() => import('./map').then(({ Map }) => ({ default: Map })))

function isTextEntryElement(element: EventTarget | null) {
  if (!(element instanceof HTMLElement)) {
    return false
  }

  const tagName = element.tagName.toLowerCase()
  return (
    element.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select'
  )
}

export function Home() {
  const topbarRef = React.useRef<HTMLDivElement>(null)
  const [topbarHeight, setTopbarHeight] = React.useState(86)
  const [mapZoom, setMapZoom] = React.useState(7)
  const [isMeasureMode, setIsMeasureMode] = React.useState(false)
  const [isBriefingOpen, setIsBriefingOpen] = React.useState(false)
  const [isCareerOpen, setIsCareerOpen] = React.useState(false)
  const [showCoalitionFlights, setShowCoalitionFlights] = React.useState(false)
  const isCareer = useSelector(activeStore, (state) => state.context.career != null)
  const careerMoney = useSelector(activeStore, (state) =>
    Math.round(state.context.career?.money ?? 0)
  )
  const [isCampaignMenuOpen, setIsCampaignMenuOpen] = React.useState(false)
  const [selectedItem, setSelectedItem] = React.useState<SelectedItem>(null)
  const [previewItem, setPreviewItem] = React.useState<SelectedItem>(null)
  const timeMultiplier = useSelector(activeStore, (state) => state.context.timeMultiplier)
  const campaignStatus = useSelector(activeStore, (state) => state.context.status)
  const scenarioId = useSelector(activeStore, (state) => state.context.scenarioId)
  const campaignGoal = useSelector(activeStore, (state) => state.context.goal)
  const logEntries = useSelector(activeStore, (state) => state.context.logs)
  const playerFlightGroups = useSelector(
    activeStore,
    (state) => state.context.coalitions.player.flightGroups
  )
  const opponentFlightGroups = useSelector(
    activeStore,
    (state) => state.context.coalitions.opponent.flightGroups
  )
  const isLogOpen = useSelector(uiStore, (state) => state.context.isLogOpen)
  const showAtoPackages = useSelector(uiStore, (state) => state.context.showAtoPackages)
  const showLogistics = useSelector(uiStore, (state) => state.context.showLogistics)
  const timerState =
    timeMultiplier === 0
      ? 'pause'
      : timeMultiplier === 1
        ? 'play'
        : timeMultiplier >= 3600
          ? 'hour'
          : 'fast-forward'
  const visibleLogs = React.useMemo(() => [...logEntries].reverse(), [logEntries])
  const activeFlightGroupIds = React.useMemo(
    () => new Set([...playerFlightGroups, ...opponentFlightGroups].map((group) => group.id)),
    [playerFlightGroups, opponentFlightGroups]
  )
  const visibleSelectedItem = React.useMemo(() => {
    if (!selectedItem || !('flightplan' in selectedItem)) return selectedItem
    return activeFlightGroupIds.has(selectedItem.id) ? selectedItem : null
  }, [activeFlightGroupIds, selectedItem])
  const logViewportRef = React.useRef<HTMLDivElement | null>(null)
  const lastRunningTimeMultiplierRef = React.useRef(timeMultiplier > 0 ? timeMultiplier : 1)
  const [logScrollTop, setLogScrollTop] = React.useState(0)
  const [logViewportHeight, setLogViewportHeight] = React.useState(190)
  const scenarioQuery = useQuery(
    orpc.data.getScenario.queryOptions({
      input: scenarioId
    })
  )
  const playerSide = useSelector(activeStore, (state) => state.context.playerSide)
  const scenarioBriefing =
    (playerSide === 'red' ? scenarioQuery.data?.opponentBriefing : undefined) ??
    scenarioQuery.data?.briefing ??
    campaignData.description
  const scenarioName = scenarioQuery.data?.name ?? campaignData.name
  const briefingParagraphs = React.useMemo(
    () => scenarioBriefing.split(/\n{2,}/).filter((paragraph) => paragraph.trim().length > 0),
    [scenarioBriefing]
  )
  const scenarioGoal = campaignGoal ?? scenarioQuery.data?.goal
  const primaryObjectives = scenarioGoal?.objectiveIds ?? campaignData.objectives
  const formatPrimaryObjective = React.useCallback(
    (objective: string) => (scenarioGoal ? `Capture ${objective}` : objective),
    [scenarioGoal]
  )

  React.useEffect(() => {
    if (timeMultiplier > 0) {
      lastRunningTimeMultiplierRef.current = timeMultiplier
    }
  }, [timeMultiplier])

  React.useLayoutEffect(() => {
    const node = topbarRef.current
    if (!node) return
    const sync = () => setTopbarHeight(Math.round(node.getBoundingClientRect().height))
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const pauseTimer = React.useCallback(() => {
    const { timeMultiplier: currentTimeMultiplier } = activeStore.getSnapshot().context
    if (currentTimeMultiplier > 0) {
      lastRunningTimeMultiplierRef.current = currentTimeMultiplier
    }
    activeStore.trigger.updateTimeMultiplier({ timeMultiplier: 0 })
  }, [])

  const resumeTimer = React.useCallback(
    (
      timeMultiplier = lastRunningTimeMultiplierRef.current,
      options?: { clearTimeTarget?: boolean }
    ) => {
      if (options?.clearTimeTarget) {
        activeStore.trigger.setTimeTarget({ timeTarget: undefined })
      }
      activeStore.trigger.updateTimeMultiplier({
        timeMultiplier
      })
    },
    []
  )

  const toggleTimerPaused = React.useCallback(() => {
    const { timeMultiplier: currentTimeMultiplier } = activeStore.getSnapshot().context
    if (currentTimeMultiplier === 0) {
      resumeTimer()
    } else {
      pauseTimer()
    }
  }, [pauseTimer, resumeTimer])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== ' ' || isTextEntryElement(event.target)) {
        return
      }

      event.preventDefault()
      toggleTimerPaused()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [toggleTimerPaused])

  React.useEffect(() => {
    const viewport = logViewportRef.current
    if (!viewport) return

    const updateHeight = () => setLogViewportHeight(viewport.clientHeight)
    updateHeight()

    const observer = new ResizeObserver(updateHeight)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [isLogOpen])

  const totalLogHeight = visibleLogs.length * LOG_ROW_HEIGHT
  const startIndex = Math.max(0, Math.floor(logScrollTop / LOG_ROW_HEIGHT) - LOG_OVERSCAN)
  const endIndex = Math.min(
    visibleLogs.length,
    Math.ceil((logScrollTop + logViewportHeight) / LOG_ROW_HEIGHT) + LOG_OVERSCAN
  )
  const virtualLogs = visibleLogs.slice(startIndex, endIndex)
  const handleLogItemClick = React.useCallback((entry: (typeof logEntries)[number]) => {
    if (!entry.entityType || !entry.entityId) return

    const snapshot = activeStore.getSnapshot().context
    if (entry.entityType === 'flightGroup') {
      const flightGroup =
        snapshot.coalitions.player.flightGroups.find((group) => group.id === entry.entityId) ??
        snapshot.coalitions.opponent.flightGroups.find((group) => group.id === entry.entityId)
      if (flightGroup) {
        setSelectedItem(flightGroup)
      }
      return
    }

    const groundGroup =
      snapshot.coalitions.player.groundGroups.find((group) => group.id === entry.entityId) ??
      snapshot.coalitions.opponent.groundGroups.find((group) => group.id === entry.entityId)
    if (groundGroup) {
      setSelectedItem(groundGroup)
    }
  }, [])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape' || isTextEntryElement(event.target)) {
        return
      }

      if (selectedItem) {
        event.preventDefault()
        setSelectedItem(null)
        return
      }

      if (isBriefingOpen) {
        event.preventDefault()
        setIsBriefingOpen(false)
        return
      }

      if (isMeasureMode) {
        event.preventDefault()
        setIsMeasureMode(false)
        return
      }

      event.preventDefault()
      setIsCampaignMenuOpen((isOpen) => !isOpen)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isBriefingOpen, isMeasureMode, selectedItem])

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      {/* Map - Full screen background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 flex flex-col overflow-hidden">
          {/* Map Controls & Weather - Floating bottom right */}
          <div className="absolute right-3 bottom-16 z-1100 flex flex-col items-end gap-3">
            <MapLayerFilter />
            {/* Zoom Controls */}
            <div className="tactical-inset flex flex-col gap-2 rounded-full p-2">
              <Button
                variant="outline"
                size="sm"
                className={`tactical-button h-[30px] w-[30px] rounded-full p-0 text-secondary backdrop-blur-md ${
                  isMeasureMode ? 'text-synthwave-light ring-1 ring-synthwave-pink/60' : ''
                }`}
                onClick={() => setIsMeasureMode((value) => !value)}
                title="Measure distance"
                aria-label="Measure distance"
                aria-pressed={isMeasureMode}
              >
                <Ruler className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="tactical-button h-[30px] w-[30px] rounded-full p-0 text-secondary backdrop-blur-md"
                onClick={() => setMapZoom(Math.min(CAUCASUS_DETAIL_MAX_ZOOM, mapZoom + 1))}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="tactical-button h-[30px] w-[30px] rounded-full p-0 text-secondary backdrop-blur-md"
                onClick={() => setMapZoom(Math.max(3, mapZoom - 1))}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Weather Widget */}
            <Card className="tactical-panel pointer-events-auto rounded-md p-2 text-synthwave-light backdrop-blur-md">
              <div className="flex items-center gap-4 text-xs font-medium">
                <div className="flex items-center gap-1.5">
                  <Wind className="h-3.5 w-3.5 text-synthwave-pink" />
                  <span>
                    {campaignData.windSpeed} {campaignData.windDirection}
                  </span>
                </div>
                <div className="h-3 w-px bg-synthwave-pink/30" />
                <div className="flex items-center gap-1.5">
                  <Sun className="h-3.5 w-3.5 text-synthwave-pink" />
                  <span>{campaignData.temperature}</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Synthwave grid background */}
          <div
            className="absolute inset-0 z-0"
            style={{
              backgroundImage:
                'linear-gradient(to right, var(--synthwave-pink) 1px, transparent 1px), linear-gradient(to bottom, var(--synthwave-pink) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
              opacity: 0.3,
              perspective: '1000px',
              perspectiveOrigin: 'center',
              transform: 'rotateX(60deg)',
              backgroundPosition: 'center'
            }}
          />

          {/* Horizon glow */}
          <div className="absolute bottom-0 left-0 right-0 h-[30vh] bg-linear-to-t from-synthwave-pink via-synthwave-purple to-transparent opacity-30" />

          <React.Suspense fallback={<div className="h-full w-full bg-synthwave-dark" />}>
            <CampaignMap
              selectedItem={visibleSelectedItem}
              previewItem={previewItem}
              onSelect={setSelectedItem}
              zoom={mapZoom}
              measureMode={isMeasureMode}
              overlaySafeLeft={MAP_OVERLAY_SAFE_LEFT_PX}
              showGoalMarkers={isBriefingOpen}
            />
          </React.Suspense>
        </div>
      </div>

      {/* Top Bar - Full Width */}
      <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
        <Card
          ref={topbarRef}
          className="tactical-topbar pointer-events-auto rounded-none border-x-0 border-t-0 px-5 py-6 text-synthwave-light backdrop-blur-md"
        >
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div className="flex items-center gap-2 justify-self-start">
              <CampaignMenu open={isCampaignMenuOpen} onOpenChange={setIsCampaignMenuOpen} />
              <Button
                variant="ghost"
                size="sm"
                className="tactical-button h-10 rounded-md px-4 text-secondary"
                onClick={() => setIsBriefingOpen(!isBriefingOpen)}
              >
                <Info className="h-4 w-4 text-synthwave-pink" />
                <span className="retro-font text-xs">Mission Briefing</span>
              </Button>
              {isCareer ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="tactical-button h-10 rounded-md px-4 text-secondary"
                  onClick={() => setIsCareerOpen(true)}
                >
                  <Warehouse className="h-4 w-4 text-synthwave-cyan" />
                  <span className="retro-font text-xs">Hangar · {careerMoney} cr</span>
                </Button>
              ) : null}
              <CareerDialog open={isCareerOpen} onOpenChange={setIsCareerOpen} />
            </div>

            <div className="justify-self-center">
              <TakeoffButton />
            </div>

            <div className="flex items-center gap-6 justify-self-end">
              {campaignStatus === 'won' ? (
                <span className="retro-font text-xs uppercase tracking-wide text-synthwave-pink">
                  Goal reached
                </span>
              ) : null}
              <div className="flex items-center gap-1">
                <WorldModeMenu />
                <CheatMenu />
              </div>
              <Clock />
              <ToggleGroup
                type="single"
                value={timerState}
                className="tactical-inset rounded-md p-1.5"
                onValueChange={(value) => {
                  if (!value) return
                  switch (value) {
                    case 'pause':
                      pauseTimer()
                      break
                    case 'play':
                      resumeTimer(1, { clearTimeTarget: true })
                      break
                    case 'fast-forward':
                      activeStore.trigger.setTimeTarget({ timeTarget: undefined })
                      activeStore.trigger.updateTimeMultiplier({ timeMultiplier: 300 })
                      break
                    case 'hour':
                      activeStore.trigger.setTimeTarget({ timeTarget: undefined })
                      activeStore.trigger.updateTimeMultiplier({ timeMultiplier: 3600 })
                      break
                  }
                }}
              >
                <ToggleGroupItem
                  value="pause"
                  size="sm"
                  className="tactical-button h-11 w-11 rounded-sm border-0 p-0 data-[state=on]:text-synthwave-pink"
                >
                  <Pause className="h-5 w-5" />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="play"
                  size="sm"
                  className="tactical-button h-11 w-11 rounded-sm border-0 p-0 data-[state=on]:text-synthwave-pink"
                >
                  <Play className="h-5 w-5" />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="fast-forward"
                  size="sm"
                  title="Five campaign minutes per second"
                  className="tactical-button h-11 w-11 rounded-sm border-0 p-0 data-[state=on]:text-synthwave-pink"
                >
                  <FastForward className="h-5 w-5" />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="hour"
                  size="sm"
                  title="One campaign hour per second"
                  className="tactical-button h-11 w-11 rounded-sm border-0 p-0 data-[state=on]:text-synthwave-pink"
                >
                  <Hourglass className="h-5 w-5" />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </Card>

        {/* Briefing Content - drops down from top bar */}
        {isBriefingOpen && (
          <Card className="tactical-panel pointer-events-auto absolute left-4 mt-2 w-[400px] rounded-md p-3 text-synthwave-light backdrop-blur-md">
            <div className="mb-1 flex min-h-9 items-center justify-between gap-3">
              <h3 className="retro-font truncate text-base font-medium uppercase tracking-wide text-primary">
                {scenarioName}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close mission briefing"
                className="h-7 w-7 shrink-0 text-secondary hover:bg-synthwave-pink/10 hover:text-synthwave-pink"
                onClick={() => setIsBriefingOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
              <div className="space-y-3 text-sm leading-relaxed text-secondary/80">
                {briefingParagraphs.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="retro-font text-xs font-medium uppercase text-primary">
                    Primary Objectives
                  </h4>
                  <span className="text-xs text-secondary">{primaryObjectives.length} Targets</span>
                </div>
                <ul className="space-y-2 text-sm">
                  {primaryObjectives.map((objective, index) => (
                    <li key={index} className="tactical-inset flex items-start gap-2 rounded p-2">
                      <Target className="h-4 w-4 mt-0.5 text-synthwave-pink shrink-0" />
                      <span>{formatPrimaryObjective(objective)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Sidebar - Left Panel */}
      <div
        className="tactical-surface absolute bottom-0 left-0 z-10 flex w-[400px] flex-col overflow-hidden border-l-0 border-t-0 border-b-0 text-synthwave-light backdrop-blur-md"
        style={{ top: topbarHeight }}
      >
        {/* Career: your aircraft first; the coalition's flights only on request */}
        {isCareer && !showCoalitionFlights ? (
          <CareerSidebar onShowCoalitionFlights={() => setShowCoalitionFlights(true)} />
        ) : (
          <>
            {isCareer ? (
              <button
                type="button"
                onClick={() => setShowCoalitionFlights(false)}
                className="tactical-button mx-3 mt-3 flex shrink-0 items-center justify-center gap-2 rounded-md py-2 text-xs text-secondary"
              >
                <EyeOff className="h-3.5 w-3.5" />
                Hide coalition flights
              </button>
            ) : null}
            <ActiveFlightGroups
              selectedItem={visibleSelectedItem}
              onSelect={setSelectedItem}
              onPreview={setPreviewItem}
            />
          </>
        )}

        <CampaignOperationsOverview />

        {showAtoPackages ? <AtoPackageBoard /> : null}
        {showLogistics ? <LogisticsOverview /> : null}

        {isLogOpen && (
          <div className="tactical-inset m-2 h-[240px] shrink-0 rounded-md p-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="retro-font text-xs uppercase text-primary">Action Log</span>
              <Button
                variant="ghost"
                size="sm"
                className="tactical-button h-6 px-2 text-[10px] text-secondary"
                onClick={() => activeStore.send({ type: 'clearLogs' })}
              >
                Clear
              </Button>
            </div>
            <ScrollAreaPrimitive.Root className="relative h-[190px] overflow-hidden text-xs">
              <ScrollAreaPrimitive.Viewport
                ref={logViewportRef}
                className="focus-visible:ring-ring/50 size-full rounded-[inherit] pr-2 transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1"
                onScroll={(event) => setLogScrollTop(event.currentTarget.scrollTop)}
              >
                {visibleLogs.length === 0 ? (
                  <div className="text-secondary/70">No actions logged yet.</div>
                ) : (
                  <div style={{ height: totalLogHeight, position: 'relative' }}>
                    {virtualLogs.map((entry, idx) => {
                      const index = startIndex + idx
                      return (
                        <div
                          key={entry.id}
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: index * LOG_ROW_HEIGHT
                          }}
                          className="pb-0"
                        >
                          <div
                            className={`rounded border px-2 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${
                              entry.coalition === 'player'
                                ? 'border-amber-400/30 bg-amber-950/30'
                                : 'border-red-400/30 bg-red-950/30'
                            } ${
                              entry.entityId
                                ? 'cursor-pointer hover:ring-1 hover:ring-synthwave-pink/40'
                                : ''
                            }`}
                            onClick={() => handleLogItemClick(entry)}
                            role={entry.entityId ? 'button' : undefined}
                            tabIndex={entry.entityId ? 0 : undefined}
                            onKeyDown={(event) => {
                              if (!entry.entityId) return
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                handleLogItemClick(entry)
                              }
                            }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`uppercase tracking-wide ${
                                    entry.type === 'combat' ? 'text-red-300' : 'text-amber-300'
                                  }`}
                                >
                                  {entry.type}
                                </span>
                                {entry.label && (
                                  <span className="text-[10px] text-secondary uppercase tracking-wide">
                                    {entry.label}
                                  </span>
                                )}
                              </div>
                              <span className="text-secondary/70">
                                {new Date(entry.campaignTime).toLocaleTimeString()}
                              </span>
                            </div>
                            <div
                              className={
                                entry.coalition === 'player'
                                  ? 'mt-0.5 text-amber-100'
                                  : 'mt-0.5 text-red-100'
                              }
                            >
                              {entry.message}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </ScrollAreaPrimitive.Viewport>
              <ScrollBar />
              <ScrollAreaPrimitive.Corner />
            </ScrollAreaPrimitive.Root>
          </div>
        )}
      </div>
    </div>
  )
}

function CampaignMenu({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const navigate = useNavigate()

  const handleSave = async () => {
    const snapshot = activeStore.getSnapshot().context
    await coreClient.campaign.saveActiveCampaign({
      ...snapshot,
      timeMultiplier: 0
    })
    onOpenChange(false)
  }

  const handleReturnToStart = () => {
    onOpenChange(false)
    navigate('/new')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="tactical-button h-10 w-10 p-0 text-secondary">
          <Menu className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="tactical-panel text-synthwave-light backdrop-blur-md sm:max-w-sm"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="retro-font text-sm uppercase text-primary">
            Campaign Menu
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            className="tactical-button w-full justify-start gap-3 text-secondary"
            onClick={handleSave}
          >
            <Save className="h-4 w-4 text-synthwave-pink" />
            Save Campaign
          </Button>
          <Button
            variant="ghost"
            className="tactical-button w-full justify-start gap-3 text-secondary"
            onClick={() => {
              onOpenChange(false)
              navigate('/load')
            }}
          >
            <FolderOpen className="h-4 w-4 text-synthwave-pink" />
            Open Campaign
          </Button>
          <div className="h-px bg-synthwave-pink/20" />
          <Button
            variant="ghost"
            className="tactical-button w-full justify-start gap-3 text-secondary"
            onClick={() => {
              onOpenChange(false)
              navigate('/settings')
            }}
          >
            <SettingsIcon className="h-4 w-4 text-synthwave-pink" />
            Settings
          </Button>
          <Button
            variant="ghost"
            className="tactical-button w-full justify-start gap-3 text-secondary"
            onClick={handleReturnToStart}
          >
            <HomeIcon className="h-4 w-4 text-synthwave-pink" />
            Return to Start
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
