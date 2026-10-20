import { useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { FastForward, Plane, PlaneTakeoff } from 'lucide-react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { activeStore } from '@/stores/active'
import { coreClient } from '@/lib/orpc'
import { cn } from '@/lib/utils'
import { PlayerParkingSelect } from '../components/player-parking-select'
import { SelectFlightDialog } from './select-flight-dialog'
import { CareerOpsDialog } from './career-ops-dialog'
import { CareerDialog } from './career-dialog'

export function TakeoffButton() {
  const navigate = useNavigate()
  const [isSaving, setIsSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [opsOpen, setOpsOpen] = useState(false)
  const [hangarOpen, setHangarOpen] = useState(false)
  const isCareer = useSelector(activeStore, (state) => state.context.career != null)
  const clientFlightGroup = useSelector(activeStore, (state) =>
    state.context.coalitions.player.flightGroups.find((fg) => fg.aircrafts.some((ac) => ac.client))
  )
  const campaignTime = useSelector(activeStore, (state) => state.context.time)
  const timeMultiplier = useSelector(activeStore, (state) => state.context.timeMultiplier)
  const timeTarget = useSelector(activeStore, (state) => state.context.timeTarget)

  const hasClient = !!clientFlightGroup

  const startTime = clientFlightGroup ? new Date(clientFlightGroup.flightplan.startTime) : null
  const currentTime = campaignTime ? new Date(campaignTime) : new Date()
  const isBeforeTakeoff = startTime && currentTime < startTime
  const isForwardingToTakeoff =
    !!startTime &&
    !!timeTarget &&
    timeMultiplier > 0 &&
    new Date(timeTarget).getTime() === startTime.getTime()

  const selectFlightButton = (primary = false) => (
    <Button
      size="sm"
      variant={primary ? 'tacticalAction' : 'outline'}
      className={`h-10 w-full rounded-md px-4 ${primary ? '' : 'tactical-button text-secondary'}`}
      onClick={() => (isCareer ? setOpsOpen(true) : setDialogOpen(true))}
    >
      <Plane className="mr-1.5 h-4 w-4" />
      {isCareer ? 'Ops' : 'Select Flight'}
    </Button>
  )
  const dialogs = (
    <>
      <SelectFlightDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      {isCareer ? (
        <>
          <CareerOpsDialog
            open={opsOpen}
            onOpenChange={setOpsOpen}
            onOpenHangar={() => setHangarOpen(true)}
            onOpenOtherMissions={() => {
              setOpsOpen(false)
              setDialogOpen(true)
            }}
          />
          <CareerDialog open={hangarOpen} onOpenChange={setHangarOpen} />
        </>
      ) : null}
    </>
  )

  if (!hasClient) {
    return (
      <div className="grid flex-1 min-w-0 grid-cols-1">
        {selectFlightButton(true)}
        {dialogs}
      </div>
    )
  }

  const parking = clientFlightGroup ? (
    <PlayerParkingSelect
      flightGroupId={clientFlightGroup.id}
      aircraftName={clientFlightGroup.aircrafts.find((aircraft) => aircraft.client)?.aircraftName}
    />
  ) : null

  if (isBeforeTakeoff && startTime) {
    return (
      <div className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
        {parking}
        <div className="grid min-w-0 grid-cols-2 gap-2">
          {selectFlightButton()}
          <Button
            size="sm"
            variant="tacticalAction"
            className={cn(
              'relative h-10 w-full overflow-hidden rounded-md',
              isForwardingToTakeoff && 'takeoff-forwarding-button'
            )}
            aria-label="Forward to Takeoff"
            onClick={() => {
              activeStore.trigger.setTimeTarget({ timeTarget: startTime })
              activeStore.trigger.updateTimeMultiplier({ timeMultiplier: 300 })
            }}
          >
            {isForwardingToTakeoff ? <span className="takeoff-forwarding-sweep" /> : null}
            <FastForward
              className={cn(
                'relative z-10 mr-1.5 h-4 w-4',
                isForwardingToTakeoff && 'takeoff-forwarding-icon'
              )}
            />
            <span className="relative z-10 flex min-w-0 flex-col items-start leading-none">
              <span className="text-xs">Forward to Takeoff</span>
            </span>
          </Button>
        </div>
        {dialogs}
      </div>
    )
  }

  return (
    <div className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
      {parking}
      <div className="grid min-w-0 grid-cols-2 gap-2">
        {selectFlightButton()}
        <Button
          size="sm"
          variant="tacticalAction"
          className="h-10 w-full rounded-md"
          onClick={async () => {
            if (!hasClient || isSaving) return
            setIsSaving(true)
            try {
              await coreClient.campaign.saveActiveCampaign(activeStore.getSnapshot().context)
              navigate('/mission')
            } finally {
              setIsSaving(false)
            }
          }}
          disabled={!hasClient || isSaving}
        >
          <PlaneTakeoff className="mr-2 h-4 w-4" />
          Takeoff
        </Button>
      </div>
      {dialogs}
    </div>
  )
}
