import {
  createHashRouter,
  redirect,
  Outlet,
  useRouteError,
  Navigate,
  useLocation
} from 'react-router'
import { coreClient } from './lib/orpc'
import { activeStore } from './stores/active'
import { uiStore } from './stores/ui'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useSelector } from '@xstate/store/react'
import {
  AlertTriangle,
  Archive,
  Bug,
  Check,
  Clipboard,
  FolderOpen,
  Home,
  Package,
  Maximize2,
  Minimize2,
  Minus,
  RefreshCw,
  Route,
  ScrollText,
  Settings,
  X
} from 'lucide-react'
import { debugLog } from './lib/debug'
import { Button } from './components/ui/button'
import { ThemeController } from './components/theme-controller'
import { WelcomeWorkflow } from './components/welcome-workflow'
import { buildPathWarnings, getPathWarningKey, type PathWarning } from './lib/path-warnings'

function RootLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [pathWarnings, setPathWarnings] = useState<PathWarning[]>([])
  const [dismissedPathWarnings, setDismissedPathWarnings] = useState<Set<string>>(() => new Set())
  const [showWelcomeWorkflow, setShowWelcomeWorkflow] = useState(false)
  const [welcomeWorkflowChecked, setWelcomeWorkflowChecked] = useState(false)
  const welcomeDismissedThisSessionRef = useRef(false)

  useEffect(() => {
    const handleOpenCampaign = () => {
      navigate('/load')
    }

    const unsubscribe = window.api?.onMenuOpenCampaign(handleOpenCampaign)

    return () => {
      unsubscribe?.()
    }
  }, [navigate])

  useEffect(() => {
    let cancelled = false

    coreClient.campaign.getSettings().then((settings) => {
      if (cancelled) {
        return
      }

      setWelcomeWorkflowChecked(true)

      if (welcomeDismissedThisSessionRef.current) {
        return
      }

      setShowWelcomeWorkflow(settings.hasCompletedWelcome !== true)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const refreshPathWarnings = async () => {
    const settings = await coreClient.campaign.getSettings()
    setPathWarnings(buildPathWarnings(settings))
  }

  useEffect(() => {
    let cancelled = false

    void coreClient.campaign.getSettings().then((settings) => {
      if (cancelled) {
        return
      }
      setPathWarnings(buildPathWarnings(settings))
    })

    return () => {
      cancelled = true
    }
  }, [location.key])

  const completeWelcomeWorkflow = () => {
    welcomeDismissedThisSessionRef.current = true
    setShowWelcomeWorkflow(false)
    void refreshPathWarnings()
  }

  const visiblePathWarnings = pathWarnings.filter(
    (warning) => !dismissedPathWarnings.has(getPathWarningKey(warning))
  )

  return (
    <div className="flex h-screen flex-col">
      <ThemeController />
      <AppTitleBar showDevMenu={welcomeWorkflowChecked} />
      <div className="relative min-h-0 flex-1">
        {visiblePathWarnings.length > 0 && !showWelcomeWorkflow ? (
          <PathWarningBanner
            warnings={visiblePathWarnings}
            onOpenSettings={() => navigate('/settings')}
            onDismiss={() => {
              setDismissedPathWarnings((current) => {
                const next = new Set(current)
                visiblePathWarnings.forEach((warning) => next.add(getPathWarningKey(warning)))
                return next
              })
            }}
          />
        ) : null}
        <Outlet />
        {welcomeWorkflowChecked ? (
          <WelcomeWorkflow open={showWelcomeWorkflow} onComplete={completeWelcomeWorkflow} />
        ) : null}
      </div>
    </div>
  )
}

function PathWarningBanner({
  warnings,
  onOpenSettings,
  onDismiss
}: {
  warnings: PathWarning[]
  onOpenSettings: () => void
  onDismiss: () => void
}) {
  return (
    <div className="app-no-drag absolute left-3 right-3 top-2 z-4990 rounded border border-amber-400/60 bg-amber-950/95 px-3 py-2 text-amber-100 shadow-lg shadow-black/30 backdrop-blur">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1 space-y-1 text-xs sm:text-sm">
          {warnings.map((warning) => (
            <div key={warning.title}>
              <span className="font-semibold">{warning.title}</span>{' '}
              <span className="text-amber-100/80">{warning.detail}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-amber-300/50 px-2 text-xs font-semibold text-amber-50 hover:bg-amber-300/15"
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </button>
        <button
          type="button"
          aria-label="Dismiss path warning"
          onClick={onDismiss}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-amber-50/80 hover:bg-amber-300/15 hover:text-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/70"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function AppTitleBar({ showDevMenu = true }: { showDevMenu?: boolean }) {
  const [isMaximized, setIsMaximized] = useState(false)
  const [devMenuToggled, setIsDevMenuOpen] = useState(false)
  const isLogOpen = useSelector(uiStore, (state) => state.context.isLogOpen)
  const showAtoPackages = useSelector(uiStore, (state) => state.context.showAtoPackages)
  const showLogistics = useSelector(uiStore, (state) => state.context.showLogistics)
  const logEntries = useSelector(activeStore, (state) => state.context.logs)

  // The dev menu only stays open while it may be shown.
  const isDevMenuOpen = showDevMenu && devMenuToggled

  useEffect(() => {
    let cancelled = false

    window.api?.getWindowMaximized?.().then((nextIsMaximized) => {
      if (!cancelled) {
        setIsMaximized(nextIsMaximized)
      }
    })

    const unsubscribe = window.api?.onWindowMaximizedChange?.(setIsMaximized)

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const MaximizeIcon = isMaximized ? Minimize2 : Maximize2

  return (
    <div className="app-drag-region relative z-5000 flex h-10 shrink-0 items-center border-b border-synthwave-pink/20 bg-synthwave-dark/88 px-3 text-synthwave-light shadow-[0_10px_30px_rgba(0,0,0,0.22)] backdrop-blur-md">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="retro-font shrink-0 text-sm font-semibold tracking-wide text-synthwave-cyan">
          DCC
        </div>
        {showDevMenu ? (
          <div className="app-no-drag relative">
            <button
              type="button"
              className="titlebar-menu-button"
              aria-haspopup="menu"
              aria-expanded={isDevMenuOpen}
              onClick={() => setIsDevMenuOpen((open) => !open)}
            >
              Dev
            </button>
            {isDevMenuOpen ? (
              <div className="titlebar-menu" role="menu">
                <button
                  type="button"
                  className="titlebar-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setIsDevMenuOpen(false)
                    void window.api?.openDevTools?.()
                  }}
                >
                  Show Chrome DevTools
                </button>
                <button
                  type="button"
                  className="titlebar-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setIsDevMenuOpen(false)
                    uiStore.trigger.toggleLog()
                  }}
                >
                  <span className="flex items-center gap-2">
                    <ScrollText className="h-3.5 w-3.5" />
                    {isLogOpen ? 'Hide' : 'Show'} Action Log
                    <span className="ml-auto text-[10px] opacity-70">{logEntries.length}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="titlebar-menu-item"
                  role="menuitemcheckbox"
                  aria-checked={showAtoPackages}
                  onClick={() => uiStore.trigger.toggleAtoPackages()}
                >
                  <span className="flex w-full items-center gap-2">
                    <Package className="h-3.5 w-3.5" />
                    ATO Packages
                    <span className="ml-auto text-[10px] opacity-70">
                      {showAtoPackages ? 'Shown' : 'Hidden'}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="titlebar-menu-item"
                  role="menuitemcheckbox"
                  aria-checked={showLogistics}
                  onClick={() => uiStore.trigger.toggleLogistics()}
                >
                  <span className="flex w-full items-center gap-2">
                    <Route className="h-3.5 w-3.5" />
                    Logistics
                    <span className="ml-auto text-[10px] opacity-70">
                      {showLogistics ? 'Shown' : 'Hidden'}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="titlebar-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setIsDevMenuOpen(false)
                    void window.api?.openUserDataFolder?.()
                  }}
                >
                  <span className="flex items-center gap-2">
                    <FolderOpen className="h-3.5 w-3.5" />
                    Open User Data Folder
                  </span>
                </button>
                <button
                  type="button"
                  className="titlebar-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setIsDevMenuOpen(false)
                    void window.api?.createDebugBundle?.()
                  }}
                >
                  <span className="flex items-center gap-2">
                    <Archive className="h-3.5 w-3.5" />
                    Create Debug Bundle
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="app-no-drag flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="window-control-button"
          aria-label="Minimize window"
          onClick={() => void window.api?.minimizeWindow()}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="window-control-button"
          aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
          onClick={() => void window.api?.toggleMaximizeWindow()}
        >
          <MaximizeIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="window-control-button window-control-button-close"
          aria-label="Close window"
          onClick={() => void window.api?.closeWindow()}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

async function activeCampaignMiddleware() {
  const activeCampaign = await coreClient.campaign.getActiveCampaign()
  if (!activeCampaign) {
    throw redirect('/new')
  }
  debugLog('loaded campaign', activeCampaign)
  activeStore.trigger.loadCampaign({ campaign: activeCampaign })
}

function isInvalidAppStateError(error: unknown) {
  if (error == null || typeof error !== 'object') {
    return false
  }

  const candidate = error as { message?: unknown; code?: unknown }
  return (
    candidate.message === 'INVALID_APP_STATE' ||
    candidate.code === 'INVALID_APP_STATE' ||
    (typeof candidate.message === 'string' && candidate.message.includes('INVALID_APP_STATE'))
  )
}

function getErrorMessage(error: unknown) {
  if (error == null) {
    return 'Unknown error'
  }

  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') {
      return message
    }
  }

  return 'Unexpected application error'
}

function GlobalErrorBoundary() {
  const error = useRouteError()
  return <GlobalErrorScreen error={error} />
}

function GlobalErrorScreen({ error }: { error: unknown }) {
  const navigate = useNavigate()
  const [didCopy, setDidCopy] = useState(false)
  const message = getErrorMessage(error)

  useEffect(() => {
    console.error('Unhandled route error:', error)
  }, [error])

  const copyErrorText = async () => {
    await navigator.clipboard.writeText(message)
    setDidCopy(true)
    window.setTimeout(() => setDidCopy(false), 1600)
  }

  return (
    <div className="flex h-screen flex-col bg-synthwave-dark text-synthwave-light">
      <AppTitleBar />
      <main className="app-no-drag flex min-h-0 flex-1 items-center justify-center px-6 py-10">
        <section className="w-full max-w-2xl rounded-md border border-synthwave-pink/30 bg-black/28 p-6 shadow-[0_0_45px_color-mix(in_srgb,var(--signal-soft)_12%,transparent)]">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-amber-300/45 bg-amber-300/10 text-amber-200">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="retro-font text-xl tracking-wide text-white">Something went wrong</h1>
              <p className="mt-3 text-sm leading-6 text-synthwave-light/75">
                DCC hit an unexpected error. Your campaign saves are kept in app data, and the
                safest next move is to return to the start screen or reload the app.
              </p>
              <pre className="mt-4 max-h-40 overflow-auto rounded border border-synthwave-purple/25 bg-black/35 p-3 text-xs leading-5 text-synthwave-light/70">
                {message}
              </pre>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  type="button"
                  className="bg-synthwave-cyan text-synthwave-dark hover:bg-synthwave-cyan/85"
                  onClick={() => navigate('/new', { replace: true })}
                >
                  <Home className="h-4 w-4" />
                  Start screen
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-synthwave-purple/45 bg-white/[0.04] text-synthwave-light hover:bg-synthwave-purple/20"
                  onClick={() => window.location.reload()}
                >
                  <RefreshCw className="h-4 w-4" />
                  Reload
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-synthwave-purple/45 bg-white/[0.04] text-synthwave-light hover:bg-synthwave-purple/20"
                  onClick={() => void copyErrorText()}
                >
                  {didCopy ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                  {didCopy ? 'Copied' : 'Copy error'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-synthwave-purple/45 bg-white/[0.04] text-synthwave-light hover:bg-synthwave-purple/20"
                  onClick={() => void window.api?.createDebugBundle?.()}
                >
                  <Bug className="h-4 w-4" />
                  Debug bundle
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function ActiveCampaignErrorBoundary() {
  const error = useRouteError()

  if (isInvalidAppStateError(error)) {
    return <Navigate to="/new" />
  }

  return <GlobalErrorScreen error={error} />
}

export const router = createHashRouter([
  {
    Component: RootLayout,
    ErrorBoundary: GlobalErrorBoundary,
    children: [
      {
        path: '/',
        lazy: async () => {
          const { CampaignLayout } = await import('./routes/campaign/layout')
          return { Component: CampaignLayout }
        },
        middleware: [activeCampaignMiddleware],
        ErrorBoundary: ActiveCampaignErrorBoundary,
        children: [
          {
            index: true,
            lazy: async () => {
              const { Home } = await import('./routes/campaign/home/home')
              return { Component: Home }
            }
          },
          {
            path: 'mission',
            lazy: async () => {
              const { Mission } = await import('./routes/campaign/mission/mission')
              return { Component: Mission }
            }
          }
        ]
      },
      {
        path: '/new',
        children: [
          {
            index: true,
            lazy: async () => {
              const { StartMenu } = await import('./routes/shell/start')
              return { Component: StartMenu }
            }
          },
          {
            path: 'scenario',
            lazy: async () => {
              const { ScenarioSelect } = await import('./routes/shell/start')
              return { Component: ScenarioSelect }
            }
          }
        ]
      },
      {
        path: '/load',
        lazy: async () => {
          const { Load } = await import('./routes/shell/load')
          return { Component: Load }
        }
      },
      {
        path: '/settings',
        lazy: async () => {
          const { Settings } = await import('./routes/shell/settings')
          return { Component: Settings }
        }
      },
      {
        path: '/mission-generator',
        lazy: async () => {
          const { MissionGenerator } = await import('./routes/mission-generator/mission-generator')
          return { Component: MissionGenerator }
        }
      }
    ]
  }
])
