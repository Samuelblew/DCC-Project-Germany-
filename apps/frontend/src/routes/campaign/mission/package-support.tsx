import { useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { produce } from 'immer'

import { Button } from '@/components/ui/button'
import {
  requestPackageSupport,
  type SupportRequest
} from '@/logic/systems/spawn/packages/ato-planner'
import { activeStore } from '@/stores/active'

const REQUESTS: Array<{ request: SupportRequest; label: string; hint: string }> = [
  { request: 'escort', label: 'Escort', hint: 'Fighters cover your route to the target' },
  { request: 'sead', label: 'SEAD', hint: 'Suppress the SAM that guards your target' },
  { request: 'sweep', label: 'Sweep', hint: 'Fighters clear the air ahead of you' }
]

const ROLE_BY_REQUEST: Record<SupportRequest, string> = {
  escort: 'cap',
  sead: 'sead',
  sweep: 'sweep'
}

/**
 * Falcon BMS style "add flight": AI support for a flight the player flies, drawn from the
 * coalition's squadrons and joined to the flight's package.
 */
export function PackageSupport({
  flightGroupId,
  disabled
}: {
  flightGroupId: string
  disabled: boolean
}) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const members = useSelector(activeStore, (state) => {
    const group = state.context.coalitions.player.flightGroups.find(
      (entry) => entry.id === flightGroupId
    )
    const pkg = group?.packageId
      ? state.context.coalitions.player.packages.find((entry) => entry.id === group.packageId)
      : undefined
    return pkg?.members
  })

  const request = (kind: SupportRequest) => {
    const results: Array<ReturnType<typeof requestPackageSupport>> = []
    const next = produce(activeStore.getSnapshot().context, (draft) => {
      results.push(requestPackageSupport(draft, 'player', flightGroupId, kind))
    })
    const result = results[0] ?? { ok: false as const, reason: 'not applied' }
    if (result.ok) {
      activeStore.send({ type: 'packageSupportAdded', campaign: next })
      setMessage({ ok: true, text: `${result.callsign} joins your package` })
    } else {
      setMessage({ ok: false, text: `No ${kind}: ${result.reason}` })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 text-xs">
      <span className="text-white/45">Request support</span>
      {REQUESTS.map((entry) => {
        const has = members?.some((member) => member.role === ROLE_BY_REQUEST[entry.request])
        return (
          <Button
            key={entry.request}
            variant="ghost"
            size="sm"
            className="tactical-button h-7 px-2 text-xs text-secondary"
            disabled={disabled || has}
            title={has ? `Your package already has ${entry.label.toLowerCase()}` : entry.hint}
            onClick={() => request(entry.request)}
          >
            {has ? `${entry.label} ✓` : entry.label}
          </Button>
        )
      })}
      {message ? (
        <span className={message.ok ? 'text-synthwave-cyan' : 'text-[#ef7f70]'}>
          {message.text}
        </span>
      ) : null}
    </div>
  )
}
