import * as z from 'zod'

export const task = z.enum([
  'DEAD',
  'AWACS',
  'CAP',
  'Escort',
  'Pinpoint Strike',
  'Strategic Strike',
  'CAS',
  'CSAR',
  'CASEVAC',
  'Troop Extraction',
  'Air Assault',
  'SEAD',
  'Intercept',
  'Antiship Strike',
  'Fighter Sweep',
  'Ground Attack',
  'Runway Attack',
  'Transport',
  'Refueling',
  'RescueHelo',
  'AFAC',
  'Training'
])

type Task = z.infer<typeof task>

/**
 * Aircraft lists keyed by every task. Saved campaigns and custom factions created before a task
 * existed get an empty list for it, so adding a task never invalidates stored data.
 */
export const aircraftTypesByTask = z.preprocess(
  (value) => {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return value
    const filled: Record<string, unknown> = { ...value }
    for (const taskName of task.options) {
      filled[taskName] ??= []
    }
    return filled
  },
  z.record(task, z.array(z.string()))
)

/**
 * Any aircraft can train, and any air-to-air aircraft can sweep.
 */
export function aircraftSupportsTask(availableTasks: readonly string[], taskName: Task): boolean {
  if (taskName === 'Training') return true
  if (taskName === 'Fighter Sweep') {
    return availableTasks.includes('Fighter Sweep') || availableTasks.includes('CAP')
  }
  return availableTasks.includes(taskName)
}

/**
 * With no list configured, sweeps fall back to the CAP aircraft and training to every aircraft the
 * coalition owns.
 */
export function resolveTaskAircraftTypes(
  aircraftTypes: Partial<Record<Task, string[]>>,
  taskName: Task
): string[] {
  const configured = aircraftTypes[taskName] ?? []
  if (configured.length > 0) return configured
  if (taskName === 'Fighter Sweep') return aircraftTypes.CAP ?? []
  if (taskName === 'Training') {
    return [...new Set(Object.values(aircraftTypes).flatMap((types) => types ?? []))]
  }
  return configured
}
