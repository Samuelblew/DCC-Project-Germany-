import { useSelector } from '@xstate/store/react'
import { aircrafts, scenarios, theatres } from '@dcc/data'
import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import { hasFlightGroupTakenOff } from '@/logic/entities/flight-status'
import { activeStore } from '@/stores/active'

type Stand = z.infer<typeof schemas.airdromeStand>

function standOrder(left: Stand, right: Stand) {
  const leftNumber = Number(left.id)
  const rightNumber = Number(right.id)
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber
  }
  return left.id.localeCompare(right.id, undefined, { numeric: true })
}

function parkingStands(stands: Record<string, Stand>, aircraftName: string | undefined) {
  const definition = Object.values(aircrafts).find((entry) => entry.name === aircraftName)
  const isHelicopter = definition?.isHelicopter === true
  const isLarge = definition?.isLarge === true
  const compatible = Object.values(stands)
    .filter((stand) => {
      if (stand.blocked) return false
      if (isHelicopter && !stand.helicopter) return false
      if (!isHelicopter && !stand.plane) return false
      if (isLarge && !stand.large) return false
      return true
    })
    .sort(standOrder)
  return {
    shelters: compatible.filter((stand) => stand.shelter),
    ramp: compatible.filter((stand) => !stand.shelter)
  }
}

/**
 * Parking number from the DCS airfield stand list (`parking_id` in the mission).
 * Automatic keeps the generator's free-stand pick, which stays clear of parked helicopters.
 */
export function PlayerParkingSelect({
  flightGroupId,
  aircraftName
}: {
  flightGroupId: string
  aircraftName?: string
}) {
  const group = useSelector(activeStore, (state) =>
    state.context.coalitions.player.flightGroups.find((entry) => entry.id === flightGroupId)
  )
  const scenarioId = useSelector(activeStore, (state) => state.context.scenarioId)
  const campaignMinute = useSelector(activeStore, (state) =>
    Math.floor(new Date(state.context.time).getTime() / 60_000)
  )
  const theatreName = scenarios.find((entry) => entry.id === scenarioId)?.theatreName
  const theatre = theatres.find((entry) => entry.name === theatreName)
  const airdrome = group ? theatre?.airdromeDetails[group.homeBase] : undefined
  const stands = parkingStands(airdrome?.standlist ?? {}, aircraftName ?? group?.aircrafts[0]?.aircraftName)
  const choices = [...stands.shelters, ...stands.ramp]
  const currentTime = new Date(campaignMinute * 60_000)
  if (!group || !airdrome || choices.length === 0 || hasFlightGroupTakenOff(group, currentTime)) {
    return null
  }

  const selected = group.parkingStandId && choices.some((stand) => stand.id === group.parkingStandId)
    ? group.parkingStandId
    : ''

  return (
    <label
      className="flex min-w-0 items-center gap-2"
      title="Parking number on this airfield, the same id DCS uses. Automatic avoids stands next to parked helicopters. Wingmen take the next free spots."
      onClick={(event) => event.stopPropagation()}
    >
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-secondary/70">Parking</span>
      <select
        aria-label="Parking spot"
        className="h-8 min-w-0 flex-1 rounded-md border border-synthwave-pink/30 bg-black/40 px-2 text-xs text-synthwave-light"
        value={selected}
        onChange={(event) =>
          activeStore.send({
            type: 'setPlayerParkingStand',
            flightGroupId,
            parkingStandId: event.target.value || undefined
          })
        }
      >
        <option value="">Automatic</option>
        {stands.shelters.length > 0 ? (
          <optgroup label="Shelter">
            {stands.shelters.map((stand) => (
              <option key={stand.id} value={stand.id}>
                {stand.id}
              </option>
            ))}
          </optgroup>
        ) : null}
        {stands.ramp.length > 0 ? (
          <optgroup label="Ramp">
            {stands.ramp.map((stand) => (
              <option key={stand.id} value={stand.id}>
                {stand.id}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  )
}
