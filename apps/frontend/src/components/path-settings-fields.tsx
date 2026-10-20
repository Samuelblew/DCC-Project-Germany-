import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

type PathSettingsFieldsProps = {
  missionExportPath: string
  dcsInstallPath: string
  detectedMissionExportPath: string
  detectedDcsInstallPath: string
  dcsInstallPathError: string | null
  onMissionExportPathChange: (path: string) => void
  onDcsInstallPathChange: (path: string) => void
  onDcsInstallPathErrorChange: (message: string | null) => void
}

export function PathSettingsFields({
  missionExportPath,
  dcsInstallPath,
  detectedMissionExportPath,
  detectedDcsInstallPath,
  dcsInstallPathError,
  onMissionExportPathChange,
  onDcsInstallPathChange,
  onDcsInstallPathErrorChange
}: PathSettingsFieldsProps) {
  const handleBrowseMissionExportPath = async () => {
    const path = await window.api?.selectDirectory()
    if (path) {
      onMissionExportPathChange(path)
    }
  }

  const handleBrowseDcsInstallPath = async () => {
    const result =
      typeof window.api?.selectDcsInstallDirectory === 'function'
        ? await window.api.selectDcsInstallDirectory()
        : await window.api?.selectDirectory().then((path) =>
            path == null
              ? null
              : {
                  path,
                  valid: true,
                  message: null
                }
          )
    if (!result) {
      return
    }
    if (!result.valid) {
      onDcsInstallPathErrorChange(result.message)
      return
    }
    onDcsInstallPathErrorChange(null)
    onDcsInstallPathChange(result.path)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-300">Mission Export Path</label>
        <div className="flex gap-2">
          <div className="flex h-9 flex-1 items-center truncate rounded border border-gray-700 bg-gray-900 px-2 font-mono text-sm">
            {missionExportPath || detectedMissionExportPath || 'Not set'}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleBrowseMissionExportPath()}
            className="border-synthwave-purple text-synthwave-cyan hover:bg-synthwave-purple/20"
          >
            Browse...
          </Button>
        </div>
        {!missionExportPath && !detectedMissionExportPath ? (
          <div className="flex items-center gap-2 rounded border border-amber-400/60 bg-amber-950/60 px-2 py-1.5 text-xs text-amber-100">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
            <span>No path set and no DCS Saved Games folder was found.</span>
          </div>
        ) : null}
        <p className="text-xs text-gray-500">
          Folder where generated mission files are saved (for example your DCS Saved Games Missions
          folder).
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-300">DCS Install Path</label>
        <div className="flex gap-2">
          <div className="flex h-9 flex-1 items-center truncate rounded border border-gray-700 bg-gray-900 px-2 font-mono text-sm">
            {dcsInstallPath || detectedDcsInstallPath || 'Not set'}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleBrowseDcsInstallPath()}
            className="border-synthwave-purple text-synthwave-cyan hover:bg-synthwave-purple/20"
          >
            Browse...
          </Button>
        </div>
        {!dcsInstallPath && !detectedDcsInstallPath ? (
          <div className="flex items-center gap-2 rounded border border-amber-400/60 bg-amber-950/60 px-2 py-1.5 text-xs text-amber-100">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
            <span>No path set and no DCS World install was found.</span>
          </div>
        ) : null}
        {dcsInstallPathError ? (
          <div className="flex items-center gap-2 rounded border border-red-400/60 bg-red-950/60 px-2 py-1.5 text-xs text-red-100">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-300" />
            <span>{dcsInstallPathError}</span>
          </div>
        ) : null}
        <p className="text-xs text-gray-500">
          DCS World install root — the folder that contains `bin\DCS.exe` or `bin\DCS_server.exe`.
        </p>
      </div>
    </div>
  )
}
