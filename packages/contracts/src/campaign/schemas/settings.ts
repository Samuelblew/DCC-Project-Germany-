import * as z from 'zod'

export const settings = z.object({
  missionExportPath: z.string().optional(),
  dcsInstallPath: z.string().optional(),
  enableDcsPersistence: z.boolean().optional(),
  aiProvider: z.enum(['openai', 'anthropic', 'openrouter']).optional(),
  aiApiKey: z.string().optional(),
  aiModel: z.string().optional(),
  disableAutoUpdate: z.boolean().optional(),
  lastViewPath: z.string().optional(),
  hasCompletedWelcome: z.boolean().optional()
})

export const settingsOutput = settings.extend({
  detectedMissionExportPath: z.string().optional(),
  detectedDcsInstallPath: z.string().optional(),
  installedMods: z.array(z.string()).optional()
})
