import { useEffect, useMemo, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { useQuery } from '@tanstack/react-query'
import { samTemplates } from '@dcc/data'
import { ArrowLeft, ChevronDown, Clock, CloudSun, Plane, Sun, Target, Wind, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import { activeStore, resetFlightGroupClientSelections } from '@/stores/active'
import { hasFlightGroupTakenOff } from '@/logic/entities/flight-status'
import {
  aircraftCullingRadius,
  cullingRadius,
  longRangeSamMinRangeMeters,
  resolveAircraftCullingRadiusMeters,
  resolveCullingRadiusMeters,
  resolveSamCullingRadiusMeters,
  samCullingRadius
} from '@dcc/contracts'
import { coreClient, orpc } from '@/lib/orpc'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { getTaskAircraftTypeOptions } from '@/lib/aircraft-display'

import { FlightGroupCard } from '../components/flight-group-card'
import { MissionDebriefScreen, type MissionDebrief, type TargetOutcome } from './mission-debrief'
import { applyLiveSortie } from '@/logic/live-sortie'
import { applyMissionStateUpdate } from './mission-state-update'
import { ImmersionOptions } from '../components/immersion-options'
import { applyCareerMission } from '@/logic/career/apply-career-mission'

const KNOTS_PER_MS = 1.94384
type Campaign = z.infer<typeof schemas.campaign.campaign>
type FlightGroup = Campaign['coalitions']['player']['flightGroups'][number]
type MissionState = z.infer<typeof schemas.missionState>
type AiWingmanSpawn = NonNullable<NonNullable<Campaign['campaignParams']>['aiWingmanSpawn']>
type EnemySkill = NonNullable<NonNullable<Campaign['campaignParams']>['enemySkill']>

const eraLabels: Partial<Record<z.infer<typeof schemas.era>, string>> = {
  'Late CW': 'Late Cold War'
}

function formatEra(era: z.infer<typeof schemas.era>) {
  return eraLabels[era] ?? era
}

function formatTargetOutcome(progress: { destroyed: number; total: number }): TargetOutcome {
  const total = Math.max(1, progress.total)
  const destroyed = Math.min(total, Math.max(0, progress.destroyed))
  const percent = Math.round((destroyed / total) * 100)
  const complete = destroyed >= total

  return {
    label: complete ? 'Target achieved' : percent > 0 ? 'Target damaged' : 'Target intact',
    detail: `${destroyed}/${total} (${percent}%)`,
    complete
  }
}

function getStructureTargetProgress(campaign: Campaign, targetId: string) {
  for (const coalition of ['player', 'opponent'] as const) {
    const structure = campaign.coalitions[coalition].structures.find(
      (candidate) => candidate.id === targetId
    )
    if (!structure) continue

    return {
      destroyed: structure.buildings.filter((building) => !building.alive).length,
      total: structure.buildings.length
    }
  }

  return null
}

function getSamTargetProgress(campaign: Campaign, targetId: string) {
  for (const coalition of ['player', 'opponent'] as const) {
    const sam = campaign.coalitions[coalition].samGroups.find(
      (candidate) => candidate.id === targetId
    )
    if (!sam) continue

    const total = samTemplates[sam.type]?.units.length ?? sam.deadUnitIndexes?.length ?? 1
    return {
      destroyed: sam.destroyed ? total : (sam.deadUnitIndexes?.length ?? 0),
      total
    }
  }

  return null
}

function getEwrTargetProgress(campaign: Campaign, targetId: string) {
  for (const coalition of ['player', 'opponent'] as const) {
    const ewr = campaign.coalitions[coalition].ewrGroups?.find(
      (candidate) => candidate.id === targetId
    )
    if (ewr) return { destroyed: ewr.destroyed ? 1 : 0, total: 1 }
  }

  return null
}

function getGroundGroupTargetProgress(
  campaign: Campaign,
  missionState: MissionState,
  targetId: string
) {
  for (const coalition of ['player', 'opponent'] as const) {
    const groundGroup = campaign.coalitions[coalition].groundGroups.find(
      (candidate) => candidate.id === targetId
    )
    if (!groundGroup) continue

    const namePrefix = `Ground-${targetId}-`
    const destroyed = missionState.lostUnits.filter((unit) => {
      const groupName = unit.groupName ?? undefined
      return unit.name.startsWith(namePrefix) || groupName?.startsWith(namePrefix)
    }).length

    return {
      destroyed,
      total: groundGroup.units.reduce((sum, unit) => sum + Math.max(0, unit.count), 0)
    }
  }

  return null
}

function buildTargetOutcomes(
  clientFlightGroups: FlightGroup[],
  currentCampaign: Campaign,
  updatedCampaign: Campaign,
  missionState: MissionState
): Record<string, TargetOutcome> {
  const outcomes: Record<string, TargetOutcome> = {}

  for (const group of clientFlightGroups) {
    if (!group.target) {
      outcomes[group.id] = {
        label: 'No tracked target',
        detail: group.task,
        complete: false
      }
      continue
    }

    const progress =
      getStructureTargetProgress(updatedCampaign, group.target.id) ??
      getSamTargetProgress(updatedCampaign, group.target.id) ??
      getEwrTargetProgress(updatedCampaign, group.target.id) ??
      getGroundGroupTargetProgress(currentCampaign, missionState, group.target.id)

    if (progress) {
      outcomes[group.id] = formatTargetOutcome(progress)
    } else {
      outcomes[group.id] = {
        label: group.targetDestroyed ? 'Target achieved' : 'Target not destroyed',
        detail: group.target.type,
        complete: group.targetDestroyed === true
      }
    }
  }

  return outcomes
}

function formatTime(date: Date | string) {
  const d = new Date(date)
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  }).format(d)
}

function formatWindDirection(degrees: number) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
  const index = Math.round(degrees / 45) % directions.length
  return `${degrees.toFixed(0)}° ${directions[index]}`
}

type ZodIssue = {
  path?: Array<string | number>
  message?: string
  expected?: string
  code?: string
}

function formatZodIssues(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as ZodIssue[]
    if (!Array.isArray(parsed)) return null
    return parsed
      .map((issue) => {
        const path =
          Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join('.') : '(root)'
        return `• ${path}: ${issue.message ?? issue.code ?? 'invalid'}`
      })
      .join('\n')
  } catch {
    return null
  }
}

function buildErrorToast(error: unknown): {
  title: string
  message: string
  details?: string
  tone: 'error'
} {
  if (error && typeof error === 'object' && 'code' in error) {
    const orpcError = error as {
      code: string
      message?: string
      data?: {
        message?: string
        path?: string
        expected?: string
        received?: string
      }
    }

    if (orpcError.code === 'MISSION_ID_MISMATCH') {
      return {
        title: 'Mission ID Mismatch',
        message: 'The state file belongs to a different campaign.',
        details: `Expected: ${orpcError.data?.expected}\nReceived: ${orpcError.data?.received}`,
        tone: 'error'
      }
    }

    if (orpcError.code === 'STALE_STATE_FILE') {
      return {
        title: 'Stale State File',
        message: 'The state file is older than the campaign file.',
        details: orpcError.data?.message,
        tone: 'error'
      }
    }

    if (orpcError.code === 'INVALID_STATE_FILE') {
      const raw = orpcError.data?.message ?? orpcError.message ?? ''
      const formatted = formatZodIssues(raw)
      return {
        title: 'Invalid State File',
        message: 'The mission state file could not be validated.',
        details: formatted ?? raw,
        tone: 'error'
      }
    }

    if (orpcError.code === 'FAILED_TO_READ_FILE') {
      return {
        title: 'State File Not Found',
        message: orpcError.data?.message ?? 'Could not read the state file.',
        details: orpcError.data?.path,
        tone: 'error'
      }
    }

    if (orpcError.code === 'FAILED_TO_WRITE_FILE') {
      const isLocked = orpcError.data?.message?.includes('EBUSY')
      return {
        title: 'Could Not Write File',
        message: isLocked
          ? 'The mission file is currently locked. Close it in DCS or another app, then try again.'
          : (orpcError.data?.message ?? 'Could not write the mission file.'),
        details: orpcError.data?.path,
        tone: 'error'
      }
    }

    return {
      title: orpcError.code,
      message: orpcError.message ?? 'Mission state submission failed.',
      details: orpcError.data?.message,
      tone: 'error'
    }
  }

  return {
    title: 'Submission Failed',
    message:
      error instanceof Error ? error.message : 'Mission state submission failed. Please try again.',
    tone: 'error'
  }
}

export function Mission() {
  const navigate = useNavigate()
  const [isGenerating, setIsGenerating] = useState(false)
  const [isGenerated, setIsGenerated] = useState(false)
  const [isMissionStateReady, setIsMissionStateReady] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [missionOptionsOpen, setMissionOptionsOpen] = useState(false)
  const [showAllAircraft, setShowAllAircraft] = useState(false)
  const [debrief, setDebrief] = useState<MissionDebrief | null>(null)
  const [toast, setToast] = useState<{
    title: string
    message: string
    details?: string
    tone: 'error'
  } | null>(null)
  const scenarioId = useSelector(activeStore, (state) => state.context.scenarioId)
  const campaignEra = useSelector(activeStore, (state) => state.context.era)
  const campaignTime = useSelector(activeStore, (state) => state.context.time)
  const timeMultiplier = useSelector(activeStore, (state) => state.context.timeMultiplier)
  const hotStart = useSelector(activeStore, (state) => state.context.campaignParams?.hotStart)
  const aiWingmanSpawn = useSelector(
    activeStore,
    (state) => state.context.campaignParams?.aiWingmanSpawn ?? 'landOnly'
  )
  const culling = useSelector(
    activeStore,
    (state) => state.context.campaignParams?.culling ?? false
  )
  const cullingRadiusMeters = useSelector(
    activeStore,
    (state) => state.context.campaignParams?.cullingRadius
  )
  const cullingRadiusKm = resolveCullingRadiusMeters(cullingRadiusMeters) / 1000
  const cullingAircraftRadiusMeters = useSelector(
    activeStore,
    (state) => state.context.campaignParams?.cullingAircraftRadius
  )
  const cullingAircraftRadiusKm =
    resolveAircraftCullingRadiusMeters(cullingAircraftRadiusMeters) / 1000
  const cullingSamRadiusMeters = useSelector(
    activeStore,
    (state) => state.context.campaignParams?.cullingSamRadius
  )
  const cullingSamRadiusKm = resolveSamCullingRadiusMeters(cullingSamRadiusMeters) / 1000
  const enemySkill = useSelector(
    activeStore,
    (state) => state.context.campaignParams?.enemySkill ?? 'default'
  )
  const ewr = useSelector(activeStore, (state) => state.context.campaignParams?.ewr ?? true)
  const iads = useSelector(activeStore, (state) => state.context.campaignParams?.iads ?? true)
  const exactTarget = useSelector(
    activeStore,
    (state) => state.context.campaignParams?.exactTarget ?? true
  )
  const casJtac = useSelector(activeStore, (state) => state.context.campaignParams?.casJtac ?? true)
  const navigationVectors = useSelector(activeStore, (state) => {
    const params = state.context.campaignParams
    return (
      params?.navigationVectors ??
      params?.navigationTargetVectors ??
      params?.navigationLandingVectors ??
      ['targetVector', 'landingAirport'].includes(params?.navigationAid ?? 'targetVector')
    )
  })
  const navigationTargetTacan = useSelector(activeStore, (state) => {
    const params = state.context.campaignParams
    return params?.navigationTargetTacan ?? params?.navigationAid === 'targetTacan'
  })
  const playerFlightGroups = useSelector(
    activeStore,
    (state) => state.context.coalitions.player.flightGroups
  )
  const playerAircraftTypes = useSelector(
    activeStore,
    (state) => state.context.coalitions.player.aircraftTypes
  )

  const scenarioQuery = useQuery(
    orpc.data.getScenario.queryOptions({
      input: scenarioId
    })
  )
  const theatreQuery = useQuery(
    orpc.data.getTheatre.queryOptions({
      input: scenarioQuery.data?.theatreName ?? '',
      enabled: scenarioQuery.data != null
    })
  )

  const clientFlightGroups = useMemo(
    () => playerFlightGroups.filter((group) => group.aircrafts.some((ac) => ac.client)),
    [playerFlightGroups]
  )

  const weather = theatreQuery.data?.info.weather
  const scenario = scenarioQuery.data
  const displayedEra = campaignEra ?? scenario?.era
  const displayedEraLabel = displayedEra ? formatEra(displayedEra) : null
  const currentTime = campaignTime ? new Date(campaignTime) : new Date()

  const handleGenerate = async () => {
    if (isGenerating) return
    setIsGenerating(true)
    try {
      await coreClient.campaign.generateMiz(activeStore.getSnapshot().context)
      setIsGenerated(true)
      setIsMissionStateReady(false)
    } catch (error) {
      console.error('Failed to generate mission', error)
      setToast(buildErrorToast(error))
    } finally {
      setIsGenerating(false)
    }
  }

  useEffect(() => {
    if (!isGenerated || debrief) {
      return
    }

    let cancelled = false

    const checkMissionState = async () => {
      try {
        const missionState = await coreClient.campaign.loadMissionState()
        if (cancelled) return
        setIsMissionStateReady(true)
        const current = activeStore.getSnapshot().context
        const next = applyLiveSortie(current, missionState)
        if (next !== current) {
          activeStore.send({ type: 'loadCampaign', campaign: next })
        }
        if (next.campaignParams?.worldMode === 'bubble') {
          void coreClient.campaign.saveBubbleCatalogue(next).catch(() => {
            // The mission script keeps the last catalogue it could read.
          })
        }
      } catch {
        // The state file is expected to be missing or stale until DCS writes this mission's result.
      }
    }

    void checkMissionState()
    const interval = window.setInterval(() => {
      void checkMissionState()
    }, 2000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [isGenerated, debrief])

  useEffect(() => {
    if (!toast) {
      return
    }

    // Keep detailed error toasts open until dismissed manually
    if (toast.details) {
      return
    }

    const timeout = window.setTimeout(() => {
      setToast(null)
    }, 6000)

    return () => window.clearTimeout(timeout)
  }, [toast])

  const submitMissionState = async (missionState: MissionState) => {
    setIsMissionStateReady(true)
    const currentCampaign = activeStore.getSnapshot().context
    const debriefClientFlightGroups = clientFlightGroups
    const appliedCampaign = applyMissionStateUpdate(currentCampaign, missionState)
    const targetOutcomes = buildTargetOutcomes(
      debriefClientFlightGroups,
      currentCampaign,
      appliedCampaign,
      missionState
    )
    const careerSortie = currentCampaign.career?.sortie
    const career = applyCareerMission(appliedCampaign, missionState, {
      taskCompleted: careerSortie
        ? targetOutcomes[careerSortie.flightGroupId]?.complete === true
        : false
    })
    const updatedCampaign = resetFlightGroupClientSelections(career.campaign)
    activeStore.send({ type: 'loadCampaign', campaign: updatedCampaign })
    await coreClient.campaign.saveActiveCampaign(updatedCampaign)
    setDebrief({
      submittedAt: updatedCampaign.time,
      missionState,
      clientFlightGroups: debriefClientFlightGroups,
      targetOutcomes,
      careerLines: career.lines
    })
  }

  const handleSubmitMissionState = async () => {
    if (isSubmitting || !isMissionStateReady) return
    setIsSubmitting(true)
    try {
      const missionState = await coreClient.campaign.loadMissionState()
      await submitMissionState(missionState)
    } catch (error) {
      console.error('Failed to submit mission state', error)
      setToast(buildErrorToast(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSelectMissionStateFile = async () => {
    if (isSubmitting || !isGenerated) return
    setIsSubmitting(true)
    try {
      const selectedStatePath = await window.api?.selectMissionStateFile()
      if (!selectedStatePath) {
        return
      }
      const missionState = await coreClient.campaign.loadMissionStateFromFile({
        path: selectedStatePath
      })
      await submitMissionState(missionState)
    } catch (error) {
      console.error('Failed to submit mission state', error)
      setToast(buildErrorToast(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAircraftTypeChange = (flightGroupId: string, aircraftType: string) => {
    activeStore.send({ type: 'setFlightGroupAircraftType', flightGroupId, aircraftType })
    setIsGenerated(false)
    setIsMissionStateReady(false)
  }

  if (debrief) {
    return <MissionDebriefScreen debrief={debrief} onClose={() => navigate('/')} />
  }

  return (
    <div className="h-full overflow-hidden bg-[#0f0e0d]">
      {toast && (
        <div className="fixed right-6 top-24 z-50 w-[min(560px,calc(100vw-3rem))] rounded-lg border border-red-500/40 bg-red-950/90 text-red-100 shadow-[0_0_30px_rgba(255,0,0,0.35)] backdrop-blur">
          <div className="flex items-start justify-between gap-3 border-b border-red-500/30 px-4 py-3">
            <div className="text-sm font-semibold uppercase tracking-wider text-red-200">
              {toast.title}
            </div>
            <button
              onClick={() => setToast(null)}
              className="text-red-300 hover:text-red-100 transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-4 py-3 space-y-2">
            <div className="text-sm text-red-50">{toast.message}</div>
            {toast.details && (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-red-500/20 bg-black/40 px-3 py-2 text-xs leading-relaxed text-red-100/80 font-mono">
                {toast.details}
              </pre>
            )}
          </div>
        </div>
      )}
      {/* Grid background */}
      <div
        className="fixed inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(217,68,58,0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(217,68,58,0.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }}
      />
      {/* Horizon glow */}
      <div className="fixed inset-x-0 bottom-0 h-[30vh] bg-gradient-to-t from-[#d9443a]/30 via-[#9c6a33]/10 to-transparent" />

      <div className="relative z-10 p-6 h-full flex flex-col gap-4">
        {/* Header */}
        <div className="flex flex-col items-start gap-3">
          <Button
            variant="outline"
            size="sm"
            className="border-[#d9443a]/40 text-[#d9443a] hover:bg-[#d9443a]/10 bg-transparent"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          <h1
            className="text-2xl font-bold tracking-[0.2em] text-[#d9443a]/80 uppercase"
            style={{ fontFamily: 'system-ui', fontWeight: 800 }}
          >
            Mission Control
          </h1>
        </div>

        {/* Main Content */}
        <div className="flex-1 grid grid-cols-[1.45fr_1fr_1fr] gap-4 min-h-0">
          {/* Left Column - Actions */}
          <div className="flex min-h-0 flex-col gap-4">
            {/* Step-by-step guide */}
            <div className="flex min-h-0 flex-1 flex-col border border-[#d9443a]/30 bg-[#d9443a]/5 rounded-lg p-4 backdrop-blur-sm shadow-[0_0_20px_rgba(217,68,58,0.2)]">
              <div className="flex items-center gap-2 mb-4">
                <Target className="h-4 w-4 text-[#d9443a]" />
                <span className="text-sm font-semibold text-white">Mission Actions</span>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-5 pr-4">
                  {/* Step 1: Generate */}
                  <div className={cn('space-y-2', isGenerated && 'opacity-50')}>
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'h-7 w-7 rounded-full border-2 text-xs flex items-center justify-center font-bold',
                          isGenerated
                            ? 'border-green-500/60 text-green-400'
                            : 'border-[#d9443a]/60 text-[#d9443a]'
                        )}
                      >
                        {isGenerated ? '\u2713' : '1'}
                      </div>
                      <span className="text-sm font-medium text-white">Generate Mission File</span>
                    </div>
                    <p className="text-sm text-white/50 ml-10">
                      Creates a .miz file from your campaign state. Open it in DCS to fly the
                      mission.
                    </p>
                    {!isGenerated && (
                      <div className="ml-10 space-y-3">
                        <div className="border border-[#d9443a]/20 rounded-lg bg-[#d9443a]/5 p-3 flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium text-white">Hot Start</div>
                            <div className="text-sm text-white/40">
                              Skip startup — begin with engines running on the runway
                            </div>
                          </div>
                          <Switch
                            checked={!!hotStart}
                            onCheckedChange={(checked) =>
                              activeStore.send({ type: 'setHotStart', hotStart: checked })
                            }
                          />
                        </div>
                        <div className="space-y-2 rounded-lg border border-[#d9443a]/20 bg-[#d9443a]/5 p-3">
                          <div>
                            <div className="text-sm font-medium text-white">Enemy AI skill</div>
                            <div className="text-sm text-white/40">
                              DCS skill for every enemy aircraft, SAM, ground unit and ship. Random
                              lets DCS roll each unit separately
                            </div>
                          </div>
                          <ToggleGroup
                            type="single"
                            value={enemySkill}
                            variant="outline"
                            size="sm"
                            aria-label="Enemy AI skill"
                            onValueChange={(value) => {
                              if (!value) return
                              activeStore.send({
                                type: 'setEnemySkill',
                                enemySkill: value === 'default' ? undefined : (value as EnemySkill)
                              })
                            }}
                            className="flex-wrap justify-start"
                          >
                            <ToggleGroupItem
                              value="default"
                              aria-label="Keep the generator defaults per unit"
                              className="border-[#d9443a]/25 bg-transparent text-white/55 hover:bg-[#d9443a]/10 hover:text-white data-[state=on]:bg-[#d9443a]/20 data-[state=on]:text-[#ef7f70]"
                            >
                              Default
                            </ToggleGroupItem>
                            <ToggleGroupItem
                              value="Average"
                              aria-label="Every enemy AI at Average skill"
                              className="border-[#d9443a]/25 bg-transparent text-white/55 hover:bg-[#d9443a]/10 hover:text-white data-[state=on]:bg-[#d9443a]/20 data-[state=on]:text-[#ef7f70]"
                            >
                              Average
                            </ToggleGroupItem>
                            <ToggleGroupItem
                              value="Good"
                              aria-label="Every enemy AI at Good skill"
                              className="border-[#d9443a]/25 bg-transparent text-white/55 hover:bg-[#d9443a]/10 hover:text-white data-[state=on]:bg-[#d9443a]/20 data-[state=on]:text-[#ef7f70]"
                            >
                              Good
                            </ToggleGroupItem>
                            <ToggleGroupItem
                              value="High"
                              aria-label="Every enemy AI at High skill"
                              className="border-[#d9443a]/25 bg-transparent text-white/55 hover:bg-[#d9443a]/10 hover:text-white data-[state=on]:bg-[#d9443a]/20 data-[state=on]:text-[#ef7f70]"
                            >
                              High
                            </ToggleGroupItem>
                            <ToggleGroupItem
                              value="Excellent"
                              aria-label="Every enemy AI at Excellent skill"
                              className="border-[#d9443a]/25 bg-transparent text-white/55 hover:bg-[#d9443a]/10 hover:text-white data-[state=on]:bg-[#d9443a]/20 data-[state=on]:text-[#ef7f70]"
                            >
                              Excellent
                            </ToggleGroupItem>
                            <ToggleGroupItem
                              value="Random"
                              aria-label="DCS rolls a random skill for each enemy AI unit"
                              className="border-[#d9443a]/25 bg-transparent text-white/55 hover:bg-[#d9443a]/10 hover:text-white data-[state=on]:bg-[#d9443a]/20 data-[state=on]:text-[#ef7f70]"
                            >
                              Random
                            </ToggleGroupItem>
                          </ToggleGroup>
                        </div>
                        <div className="space-y-2 rounded-lg border border-[#d9443a]/20 bg-[#d9443a]/5 p-3">
                          <div>
                            <div className="text-sm font-medium text-white">Immersion</div>
                            <div className="text-sm text-white/40">
                              Ambient life around you; it follows the culling bands
                            </div>
                          </div>
                          <ImmersionOptions />
                        </div>
                        <div className="overflow-hidden rounded-lg border border-[#d9443a]/20 bg-[#d9443a]/5">
                          <button
                            type="button"
                            onClick={() => setMissionOptionsOpen((open) => !open)}
                            aria-expanded={missionOptionsOpen}
                            className="flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-[#d9443a]/10"
                          >
                            <div>
                              <div className="text-sm font-medium text-white">
                                Advanced Mission Options
                              </div>
                              <div className="text-sm text-white/40">
                                AI wingmen, performance, navigation, and mission support
                              </div>
                            </div>
                            <ChevronDown
                              className={cn(
                                'h-4 w-4 shrink-0 text-[#d9443a] transition-transform',
                                missionOptionsOpen && 'rotate-180'
                              )}
                            />
                          </button>
                          {missionOptionsOpen && (
                            <div className="space-y-3 border-t border-[#d9443a]/15 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium text-white">AI Wingman</div>
                                  <div className="text-sm text-white/40">
                                    Choose when AI wingmen are added to client flights
                                  </div>
                                </div>
                                <ToggleGroup
                                  type="single"
                                  value={aiWingmanSpawn}
                                  variant="outline"
                                  size="sm"
                                  aria-label="AI wingman spawn behavior"
                                  onValueChange={(value) => {
                                    if (!value) return
                                    activeStore.send({
                                      type: 'setAiWingmanSpawn',
                                      aiWingmanSpawn: value as AiWingmanSpawn
                                    })
                                  }}
                                  className="shrink-0"
                                >
                                  <ToggleGroupItem
                                    value="never"
                                    aria-label="Never spawn AI wingmen"
                                    className="border-[#d9443a]/25 bg-transparent text-white/55 hover:bg-[#d9443a]/10 hover:text-white data-[state=on]:bg-[#d9443a]/20 data-[state=on]:text-[#ef7f70]"
                                  >
                                    Never
                                  </ToggleGroupItem>
                                  <ToggleGroupItem
                                    value="landOnly"
                                    aria-label="Spawn AI wingmen at land bases only, not on carriers or airborne"
                                    className="border-[#d9443a]/25 bg-transparent text-white/55 hover:bg-[#d9443a]/10 hover:text-white data-[state=on]:bg-[#d9443a]/20 data-[state=on]:text-[#ef7f70]"
                                  >
                                    Land only
                                  </ToggleGroupItem>
                                  <ToggleGroupItem
                                    value="always"
                                    aria-label="Always spawn AI wingmen"
                                    className="border-[#d9443a]/25 bg-transparent text-white/55 hover:bg-[#d9443a]/10 hover:text-white data-[state=on]:bg-[#d9443a]/20 data-[state=on]:text-[#ef7f70]"
                                  >
                                    Always
                                  </ToggleGroupItem>
                                </ToggleGroup>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium text-white">Culling</div>
                                  <div className="text-sm text-white/40">
                                    Off by default. When on, only the flight you are flying keeps a
                                    corridor around its route
                                  </div>
                                </div>
                                <Switch
                                  checked={!!culling}
                                  onCheckedChange={(checked) =>
                                    activeStore.send({ type: 'setCulling', culling: checked })
                                  }
                                />
                              </div>
                              <div className={cn('space-y-2', !culling && 'opacity-50')}>
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      Waypoint radius
                                    </div>
                                    <div className="text-sm text-white/40">
                                      Width of the corridor around your route line
                                    </div>
                                  </div>
                                  <span className="text-sm text-white/80">
                                    {cullingRadiusKm} km
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min={cullingRadius.minMeters / 1000}
                                  max={cullingRadius.maxMeters / 1000}
                                  step={cullingRadius.stepMeters / 1000}
                                  value={cullingRadiusKm}
                                  disabled={!culling}
                                  aria-label="Culling radius around waypoints"
                                  className="w-full accent-[#e8b730]"
                                  onChange={(event) =>
                                    activeStore.send({
                                      type: 'setCullingRadius',
                                      meters: Number(event.target.value) * 1000
                                    })
                                  }
                                />
                              </div>
                              <div className={cn('space-y-2', !culling && 'opacity-50')}>
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      Aircraft radius
                                    </div>
                                    <div className="text-sm text-white/40">
                                      Much wider band for flights that pass near your route or could
                                      come to intercept you
                                    </div>
                                  </div>
                                  <span className="text-sm text-white/80">
                                    {cullingAircraftRadiusKm} km
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min={aircraftCullingRadius.minMeters / 1000}
                                  max={aircraftCullingRadius.maxMeters / 1000}
                                  step={aircraftCullingRadius.stepMeters / 1000}
                                  value={cullingAircraftRadiusKm}
                                  disabled={!culling}
                                  aria-label="Aircraft culling radius around the route"
                                  className="w-full accent-[#ffb000]"
                                  onChange={(event) =>
                                    activeStore.send({
                                      type: 'setCullingAircraftRadius',
                                      meters: Number(event.target.value) * 1000
                                    })
                                  }
                                />
                              </div>
                              <div className={cn('space-y-2', !culling && 'opacity-50')}>
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      Long-range SAM radius
                                    </div>
                                    <div className="text-sm text-white/40">
                                      Band for SAMs reaching {longRangeSamMinRangeMeters / 1000} km
                                      or more (SA-2, SA-5, Hawk, Patriot), so they still cover your
                                      route without loading every site on the map
                                    </div>
                                  </div>
                                  <span className="text-sm text-white/80">
                                    {cullingSamRadiusKm} km
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min={samCullingRadius.minMeters / 1000}
                                  max={samCullingRadius.maxMeters / 1000}
                                  step={samCullingRadius.stepMeters / 1000}
                                  value={cullingSamRadiusKm}
                                  disabled={!culling}
                                  aria-label="Long-range SAM culling radius around the route"
                                  className="w-full accent-synthwave-pink"
                                  onChange={(event) =>
                                    activeStore.send({
                                      type: 'setCullingSamRadius',
                                      meters: Number(event.target.value) * 1000
                                    })
                                  }
                                />
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium text-white">GCI</div>
                                  <div className="text-sm text-white/40">
                                    Place a KRU station for the MiG-29A HUD intercept link. Other
                                    aircraft keep F10 picture calls
                                  </div>
                                </div>
                                <Switch
                                  checked={!!ewr}
                                  onCheckedChange={(checked) =>
                                    activeStore.send({ type: 'setEwr', ewr: checked })
                                  }
                                />
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium text-white">IADS</div>
                                  <div className="text-sm text-white/40">
                                    Add Skynet-controlled enemy SAM and radar behavior
                                  </div>
                                </div>
                                <Switch
                                  checked={!!iads}
                                  onCheckedChange={(checked) =>
                                    activeStore.send({ type: 'setIads', iads: checked })
                                  }
                                />
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium text-white">
                                    Exact Strike Target
                                  </div>
                                  <div className="text-sm text-white/40">
                                    Use precise target steerpoints for Strike missions
                                  </div>
                                </div>
                                <Switch
                                  checked={!!exactTarget}
                                  onCheckedChange={(checked) =>
                                    activeStore.send({
                                      type: 'setExactTarget',
                                      exactTarget: checked
                                    })
                                  }
                                />
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium text-white">CAS JTAC</div>
                                  <div className="text-sm text-white/40">
                                    Add JTAC support for player CAS tasking
                                  </div>
                                </div>
                                <Switch
                                  checked={!!casJtac}
                                  onCheckedChange={(checked) =>
                                    activeStore.send({ type: 'setCasJtac', casJtac: checked })
                                  }
                                />
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium text-white">F10 Vectors</div>
                                  <div className="text-sm text-white/40">
                                    Add radio-menu requests for target and landing vectors
                                  </div>
                                </div>
                                <Switch
                                  checked={navigationVectors}
                                  onCheckedChange={(enabled) =>
                                    activeStore.send({ type: 'setNavigationVectors', enabled })
                                  }
                                />
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium text-white">Target TACAN</div>
                                  <div className="text-sm text-white/40">
                                    Add a generated target TACAN beacon for client flights
                                  </div>
                                </div>
                                <Switch
                                  checked={navigationTargetTacan}
                                  onCheckedChange={(enabled) =>
                                    activeStore.send({ type: 'setNavigationTargetTacan', enabled })
                                  }
                                />
                              </div>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={handleGenerate}
                          disabled={isGenerating}
                          className="h-9 px-5 text-sm font-medium bg-[#d9443a] text-white rounded hover:bg-[#d9443a]/80 disabled:opacity-50 transition-colors shadow-[0_0_15px_rgba(217,68,58,0.5)]"
                        >
                          {isGenerating ? 'Generating...' : 'Generate'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Step 2: Fly in DCS */}
                  <div className={cn('space-y-2', (!isGenerated || isSubmitting) && 'opacity-50')}>
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'h-7 w-7 rounded-full border-2 text-xs flex items-center justify-center font-bold',
                          isMissionStateReady
                            ? 'border-green-500/60 text-green-400'
                            : 'border-[#e8b730]/60 text-[#e8b730]'
                        )}
                      >
                        {isMissionStateReady ? '\u2713' : '2'}
                      </div>
                      <span className="text-sm font-medium text-white">Fly the Mission in DCS</span>
                    </div>
                    <p className="text-sm text-white/50 ml-10">
                      {isGenerated && !isMissionStateReady
                        ? 'Waiting for DCS to write a fresh mission state for this campaign.'
                        : 'Load the generated mission in DCS World and complete your objectives.'}
                    </p>
                    {isGenerated && (
                      <button
                        type="button"
                        onClick={handleSelectMissionStateFile}
                        disabled={isSubmitting}
                        className="ml-10 text-sm font-medium text-[#e8b730]/80 underline-offset-4 transition-colors hover:text-[#e8b730] hover:underline disabled:pointer-events-none disabled:opacity-50"
                      >
                        Optional: select a mission state file manually
                      </button>
                    )}
                  </div>

                  {/* Step 3: Submit results */}
                  <div className={cn('space-y-2', !isMissionStateReady && 'opacity-50')}>
                    <div className="flex items-center gap-3">
                      <div className="h-7 w-7 rounded-full border-2 border-[#9c6a33]/60 text-xs flex items-center justify-center font-bold text-[#9c6a33]">
                        3
                      </div>
                      <span className="text-sm font-medium text-white">Submit Results</span>
                    </div>
                    <p className="text-sm text-white/50 ml-10">
                      After flying, submit the mission results to advance the campaign. Losses and
                      objectives will be updated.
                    </p>
                    {isMissionStateReady && (
                      <div className="ml-10">
                        <button
                          onClick={handleSubmitMissionState}
                          disabled={isSubmitting || !isMissionStateReady}
                          className="h-9 px-5 text-sm font-medium bg-[#9c6a33] text-white rounded hover:bg-[#9c6a33]/80 disabled:opacity-50 transition-colors shadow-[0_0_15px_rgba(156,106,51,0.5)]"
                        >
                          {isSubmitting ? 'Submitting...' : 'Submit Mission State'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </div>
          </div>

          {/* Center Column - Flight Groups */}
          <div className="flex min-h-0 min-w-0 flex-col rounded-lg border border-[#d9443a]/30 bg-[#d9443a]/5 p-4 backdrop-blur-sm">
            <div className="mb-3 flex shrink-0 items-center gap-2">
              <Plane className="h-5 w-5 text-[#d9443a]" />
              <span className="text-sm font-semibold text-white">Client Flights</span>
              <span className="ml-auto text-sm text-white/40">
                {clientFlightGroups.length} groups
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex w-full min-w-0 flex-col gap-2">
                {clientFlightGroups.map((group) => {
                  const aircraftOptions = getTaskAircraftTypeOptions(
                    group.task,
                    showAllAircraft ? undefined : playerAircraftTypes[group.task]
                  )

                  return (
                    <FlightGroupCard
                      key={group.id}
                      group={group}
                      isAirborne={hasFlightGroupTakenOff(group, currentTime)}
                      showAircraftType
                      aircraftTypeDisabled={isGenerated || isGenerating}
                      aircraftTypeOptions={aircraftOptions}
                      showAllAircraftTypes={showAllAircraft}
                      onAircraftTypeChange={(aircraftType) =>
                        handleAircraftTypeChange(group.id, aircraftType)
                      }
                      onShowAllAircraftTypesChange={setShowAllAircraft}
                    />
                  )
                })}
              </div>
            </div>
          </div>

          {/* Right Column - Time & Weather */}
          <ScrollArea className="min-h-0">
            <div className="flex min-h-full flex-col gap-4 pr-4">
              {/* Time */}
              <div className="border border-[#e8b730]/30 bg-[#e8b730]/5 rounded-lg p-4 backdrop-blur-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-5 w-5 text-[#e8b730]" />
                  <span className="text-sm font-semibold text-white">Mission Time</span>
                </div>
                <div className="text-4xl font-bold text-[#e8b730] tabular-nums">
                  {campaignTime ? formatTime(campaignTime) : '--:--'}
                </div>
                <div className="flex justify-between mt-2 text-sm text-white/50">
                  <span>UTC</span>
                  <span className={timeMultiplier === 0 ? 'text-[#d9443a]' : ''}>
                    x{timeMultiplier}
                  </span>
                </div>
              </div>

              {/* Weather */}
              <div className="flex-1 border border-[#9c6a33]/30 bg-[#9c6a33]/5 rounded-lg p-4 backdrop-blur-sm">
                <div className="flex items-center gap-2 mb-3">
                  <CloudSun className="h-5 w-5 text-[#9c6a33]" />
                  <span className="text-sm font-semibold text-white">Weather</span>
                </div>
                {weather ? (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="flex items-center gap-2 text-sm text-white/50">
                        <Sun className="h-4 w-4" /> Temp
                      </span>
                      <span className="text-sm text-white">
                        {weather.temperature.mean.toFixed(0)}°C
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="flex items-center gap-2 text-sm text-white/50">
                        <Wind className="h-4 w-4" /> Wind
                      </span>
                      <span className="text-sm text-white">
                        {(weather.wind.speed * KNOTS_PER_MS).toFixed(0)} kt
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-white/50">Direction</span>
                      <span className="text-sm text-white">
                        {formatWindDirection(weather.wind.direction)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-white/50">Clouds</span>
                      <span className="text-sm text-white">
                        {Math.round(
                          (weather.cloudCover.baseCloudCover + weather.cloudCover.seasonEffect) *
                            100
                        )}
                        %
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-white/40">Loading...</div>
                )}
              </div>

              {/* Theatre Info */}
              <div className="border border-[#d9443a]/20 rounded-lg p-4 bg-black/30">
                <div className="text-sm font-bold text-white">
                  {scenario?.name ?? 'Active Mission'}
                </div>
                <div className="text-sm text-white/40 mt-1">{scenario?.theatreName ?? '—'}</div>
                {displayedEraLabel && (
                  <div className="text-sm text-[#d9443a]/60 mt-1">{displayedEraLabel}</div>
                )}
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}
