import { useEffect, useState } from 'react'
import { AlertTriangle, BookOpen, ChevronLeft, ChevronRight, PlaneTakeoff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PathSettingsFields } from '@/components/path-settings-fields'
import { WelcomeHero } from '@/components/welcome-hero'
import { coreClient } from '@/lib/orpc'
import { resolvePathsForSave } from '@/lib/path-warnings'
import { cn } from '@/lib/utils'

const DISCORD_URL = 'https://discord.gg/jZZ3pFpY3e'

type WelcomeWorkflowProps = {
  open: boolean
  onComplete: () => void
}

const steps = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'alpha', label: 'Alpha notice' },
  { id: 'settings', label: 'Paths' }
] as const

export function WelcomeWorkflow({ open, onComplete }: WelcomeWorkflowProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [missionExportPath, setMissionExportPath] = useState('')
  const [dcsInstallPath, setDcsInstallPath] = useState('')
  const [detectedMissionExportPath, setDetectedMissionExportPath] = useState('')
  const [detectedDcsInstallPath, setDetectedDcsInstallPath] = useState('')
  const [enableDcsPersistence, setEnableDcsPersistence] = useState(true)
  const [dcsInstallPathError, setDcsInstallPathError] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string>('')

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    setStepIndex(0)
    setLoading(true)

    coreClient.campaign.getSettings().then((settings) => {
      if (cancelled) {
        return
      }

      setMissionExportPath(settings.missionExportPath || '')
      setDcsInstallPath(settings.dcsInstallPath || '')
      setDetectedMissionExportPath(settings.detectedMissionExportPath ?? '')
      setDetectedDcsInstallPath(settings.detectedDcsInstallPath ?? '')
      setEnableDcsPersistence(settings.enableDcsPersistence ?? true)
      setLoading(false)
    })
    window.api?.getAppVersion?.().then((version) => {
      if (!cancelled && version) {
        setAppVersion(version)
      }
    })

    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) {
    return null
  }

  const isFirstStep = stepIndex === 0
  const isLastStep = stepIndex === steps.length - 1

  const handleBack = () => {
    setStepIndex((current) => Math.max(0, current - 1))
  }

  const handleNext = () => {
    setStepIndex((current) => Math.min(steps.length - 1, current + 1))
  }

  const handleFinish = async () => {
    setSaving(true)
    setDcsInstallPathError(null)

    try {
      const paths = resolvePathsForSave(
        missionExportPath,
        dcsInstallPath,
        detectedMissionExportPath,
        detectedDcsInstallPath
      )

      await coreClient.campaign.saveSettings({
        missionExportPath: paths.missionExportPath || undefined,
        dcsInstallPath: paths.dcsInstallPath || undefined,
        enableDcsPersistence,
        hasCompletedWelcome: true
      })
      onComplete()
    } catch (error) {
      const message =
        error != null &&
        typeof error === 'object' &&
        'data' in error &&
        error.data != null &&
        typeof error.data === 'object' &&
        'message' in error.data &&
        typeof error.data.message === 'string'
          ? error.data.message
          : 'Failed to save settings.'
      setDcsInstallPathError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app-no-drag absolute inset-0 z-[6000] flex items-center justify-center bg-synthwave-dark/92 p-4 backdrop-blur-sm sm:p-6">
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--synthwave-pink) 1px, transparent 1px), linear-gradient(to bottom, var(--synthwave-pink) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }}
      />
      <div className="relative flex h-full w-full max-w-2xl flex-col">
        <div className="mb-4 flex shrink-0 justify-center gap-2">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                index <= stepIndex ? 'bg-synthwave-cyan' : 'bg-synthwave-purple/30'
              )}
              aria-hidden
            />
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-synthwave-pink/30 bg-black/55 backdrop-blur-sm">
          <div className="synthwave-scrollbar min-h-0 flex-1 overflow-y-auto">
            {stepIndex === 0 ? (
              <section>
                <WelcomeHero appVersion={appVersion} className="shrink-0" />
                <div className="space-y-4 px-6 py-5 text-sm leading-6 text-synthwave-light/75 sm:px-8">
                  <h3 className="retro-font text-sm tracking-wide text-synthwave-cyan uppercase">
                    How to start
                  </h3>
                  <div className="flex gap-3 rounded-md border border-synthwave-purple/30 bg-black/30 p-3">
                    <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-synthwave-pink" />
                    <div>
                      <p className="font-semibold text-white">Start a new campaign</p>
                      <p className="mt-1">
                        From the start screen, choose{' '}
                        <span className="text-synthwave-cyan">New Campaign</span>, select a
                        scenario, then create the campaign to open the operations map.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3 rounded-md border border-synthwave-purple/30 bg-black/30 p-3">
                    <PlaneTakeoff className="mt-0.5 h-4 w-4 shrink-0 text-synthwave-pink" />
                    <div>
                      <p className="font-semibold text-white">Fly in DCS</p>
                      <p className="mt-1">
                        Select a flight group on the map, press Takeoff to export the mission, then
                        fly it in DCS. When you land, submit the mission state to advance the
                        campaign.
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-synthwave-light/55">
                    On the next screens we will cover alpha limitations and the paths DCC needs to
                    export missions and talk to DCS.
                  </p>
                </div>
              </section>
            ) : null}

            {stepIndex === 1 ? (
              <section className="px-6 py-5 sm:px-8">
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-md border border-amber-300/45 bg-amber-300/10 text-amber-200">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <h2 className="retro-font text-3xl text-amber-200">Alpha preview</h2>
                <p className="mt-3 text-sm leading-6 text-synthwave-light/80">
                  You are using an early alpha build. Expect rough edges, missing features, and
                  breaking changes between releases.
                </p>
                <ul className="mt-5 list-disc space-y-2 pl-5 text-sm leading-6 text-synthwave-light/75">
                  <li>
                    Caucasus, Syria, and Persian Gulf scenarios are available for campaign start.
                  </li>
                  <li>Some systems (weather, ATC, broader aircraft sets) are not modeled yet.</li>
                  <li>Mission generation and campaign logic may change as we iterate.</li>
                </ul>
                <div className="mt-6 rounded-md border border-amber-400/40 bg-amber-950/40 p-4">
                  <p className="text-sm font-semibold text-amber-100">Found a bug?</p>
                  <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-amber-100/85">
                    <li>
                      Open the title bar <span className="font-semibold">Dev</span> menu and choose{' '}
                      <span className="font-semibold">Create Debug Bundle</span>.
                    </li>
                    <li>
                      Post the bundle on our{' '}
                      <a
                        href={DISCORD_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-synthwave-cyan underline-offset-2 hover:underline"
                      >
                        Discord
                      </a>{' '}
                      in <span className="font-semibold">#bug-discussion</span> with a short
                      description of what went wrong.
                    </li>
                  </ol>
                </div>
              </section>
            ) : null}

            {stepIndex === 2 ? (
              <section className="px-6 py-5 sm:px-8">
                <h2 className="retro-font text-3xl text-synthwave-cyan">Important paths</h2>
                <p className="mt-2 text-sm leading-6 text-synthwave-light/75">
                  DCC needs these folders to export missions and optionally patch DCS persistence
                  while the app is running. Auto-detected paths are used when you leave a field
                  empty.
                </p>
                <div className="mt-5">
                  {loading ? (
                    <p className="text-sm text-gray-400">Loading settings...</p>
                  ) : (
                    <PathSettingsFields
                      missionExportPath={missionExportPath}
                      dcsInstallPath={dcsInstallPath}
                      detectedMissionExportPath={detectedMissionExportPath}
                      detectedDcsInstallPath={detectedDcsInstallPath}
                      dcsInstallPathError={dcsInstallPathError}
                      onMissionExportPathChange={setMissionExportPath}
                      onDcsInstallPathChange={setDcsInstallPath}
                      onDcsInstallPathErrorChange={setDcsInstallPathError}
                    />
                  )}
                </div>
              </section>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-synthwave-purple/25 px-6 py-5 sm:px-8">
            {isFirstStep ? (
              <Button
                type="button"
                variant="ghost"
                className="pointer-events-none invisible"
                tabIndex={-1}
                aria-hidden
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="text-synthwave-light/70 hover:text-white"
                disabled={saving}
                onClick={handleBack}
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            )}
            {isLastStep ? (
              <Button
                type="button"
                disabled={loading || saving}
                className="bg-synthwave-pink text-white retro-font hover:bg-synthwave-pink/80"
                onClick={() => void handleFinish()}
              >
                {saving ? 'Saving...' : 'Get started'}
              </Button>
            ) : (
              <Button
                type="button"
                className="bg-synthwave-cyan text-synthwave-dark hover:bg-synthwave-cyan/85"
                onClick={handleNext}
              >
                Continue
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
