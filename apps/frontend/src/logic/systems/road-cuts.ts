import { hopKey } from '@dcc/campaign'
import type { schemas } from '@dcc/contracts'
import type * as z from 'zod'

type Campaign = z.infer<typeof schemas.campaign.campaign>

export const ROAD_CUT_MS = 2 * 60 * 60 * 1000

export function activeRoadCutKeys(draft: Campaign, now = draft.time) {
  const keys = new Set<string>()
  const at = now.getTime()
  for (const cut of draft.roadCuts ?? []) {
    if (cut.until > at) keys.add(hopKey(cut.from, cut.to))
  }
  return keys
}

export function cutRoad(draft: Campaign, from: string, to: string, until: number) {
  const cuts = (draft.roadCuts ??= [])
  const key = hopKey(from, to)
  const existing = cuts.find((cut) => hopKey(cut.from, cut.to) === key)
  if (existing) {
    existing.until = Math.max(existing.until, until)
    return
  }
  cuts.push({ from, to, until })
}

export function roadTargetId(from: string, to: string) {
  return `road|${hopKey(from, to)}`
}
