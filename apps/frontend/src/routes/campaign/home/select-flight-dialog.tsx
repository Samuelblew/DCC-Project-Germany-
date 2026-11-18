import { useState } from 'react'
import { Plane, ChevronLeft, User, PlaneTakeoff, RotateCcw, X, Plus } from 'lucide-react'
import { useSelector } from '@xstate/store/react'
import { schemas } from '@dcc/contracts'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { activeStore } from '@/stores/active'
import { getCareerAircraftTypes } from '@/logic/career/career'
import { canCreateManualFlightGroup } from '@/logic/systems/spawn/manual-flight-group'
import { hasFlightGroupTakenOff } from '@/logic/entities/flight-status'
import { FlightGroupCard } from '../components/flight-group-card'
import { getFlightGroupsByTask, getSortedFlightGroupTasks } from './flight-group-task-groups'

interface SelectFlightDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SelectFlightDialog({ open, onOpenChange }: SelectFlightDialogProps) {
  const [selectedTask, setSelectedTask] = useState<string | null>(null)

  const allFlightGroups = useSelector(
    activeStore,
    (state) => state.context.coalitions.player.flightGroups
  )
  const career = useSelector(activeStore, (state) => state.context.career)
  const campaignTime = useSelector(activeStore, (state) => state.context.time)
  const canCreateSelectedTask = useSelector(activeStore, (state) => {
    const task = schemas.task.safeParse(selectedTask)
    // Career flights of the owned aircraft are planned from the operations screen instead.
    return task.success && !state.context.career
      ? canCreateManualFlightGroup(state.context, 'player', task.data)
      : false
  })
  const currentTime = campaignTime ? new Date(campaignTime) : new Date()
  // In career mode this lists other aircraft only: the career's types fly through the
  // operations screen, where their cost and stores are accounted for.
  const careerTypes = career ? getCareerAircraftTypes(career) : undefined
  const flightGroups = careerTypes
    ? allFlightGroups.filter((group) =>
        group.aircrafts.every((aircraft) => !careerTypes.has(aircraft.aircraftName))
      )
    : allFlightGroups

  const groupsByTask = getFlightGroupsByTask(flightGroups)
  const tasks = getSortedFlightGroupTasks(groupsByTask)

  const handleClose = () => {
    onOpenChange(false)
    setSelectedTask(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setSelectedTask(null)
        }
        onOpenChange(value)
      }}
    >
      <DialogContent
        className="flex max-h-[min(90vh,640px)] flex-col overflow-hidden overflow-y-hidden border-synthwave-pink/30 bg-synthwave-dark/95 text-synthwave-light shadow-[0_0_30px_color-mix(in_srgb,var(--synthwave-pink)_40%,transparent)] backdrop-blur-xl sm:max-w-md"
        showCloseButton={false}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            {selectedTask && (
              <button
                onClick={() => setSelectedTask(null)}
                className="text-secondary hover:text-white transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <Plane className="h-5 w-5 text-synthwave-pink" />
            <DialogTitle className="text-synthwave-cyan retro-font">
              {selectedTask ?? 'Select Task'}
            </DialogTitle>
          </div>
          <DialogDescription className="text-secondary/70">
            {selectedTask
              ? 'Set the number of client slots per flight group'
              : 'Choose a mission type to see available flights'}
          </DialogDescription>
        </DialogHeader>

        {!selectedTask ? (
          <div className="synthwave-scrollbar grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-y-auto">
            {career ? (
              <div className="col-span-2 text-xs text-white/45">
                Missions flown in other aircraft earn no money and use none of your stores.
              </div>
            ) : null}
            {tasks.map((task) => {
              const groups = groupsByTask.get(task)!
              const totalClients = groups.reduce(
                (sum, g) => sum + g.aircrafts.filter((a) => a.client).length,
                0
              )
              const airborneCount = groups.filter((g) =>
                hasFlightGroupTakenOff(g, currentTime)
              ).length
              return (
                <button
                  key={task}
                  onClick={() => setSelectedTask(task)}
                  className="flex flex-col items-center gap-1.5 rounded-lg border border-synthwave-pink/20 bg-synthwave-pink/5 p-3 text-center transition-colors hover:border-synthwave-pink/50 hover:bg-synthwave-pink/15"
                >
                  <span className="text-sm font-medium text-primary">{task}</span>
                  <div className="flex items-center gap-2 text-[10px] text-secondary/70">
                    <span>
                      {groups.length} {groups.length === 1 ? 'flight' : 'flights'}
                    </span>
                    {airborneCount > 0 && (
                      <span
                        className="flex items-center gap-0.5 text-amber-400"
                        title={`${airborneCount} already airborne`}
                      >
                        <PlaneTakeoff className="h-2.5 w-2.5" />
                        {airborneCount}
                      </span>
                    )}
                    {totalClients > 0 && (
                      <span className="flex items-center gap-0.5 text-synthwave-cyan">
                        <User className="h-2.5 w-2.5" />
                        {totalClients}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          // Flight groups for selected task
          <div className="synthwave-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {(groupsByTask.get(selectedTask) ?? []).map((group) => (
              <FlightGroupCard
                key={group.id}
                group={group}
                isAirborne={hasFlightGroupTakenOff(group, currentTime)}
                showClientControls
                onClientCountChange={(count) =>
                  activeStore.send({
                    type: 'setFlightGroupClientCount',
                    flightGroupId: group.id,
                    count
                  })
                }
              />
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            className="mr-auto border-synthwave-pink/30 text-secondary hover:bg-synthwave-pink/20 hover:text-white"
            onClick={() => {
              if (career?.sortie) activeStore.send({ type: 'careerAbortSortie' })
              for (const fg of allFlightGroups) {
                if (fg.aircrafts.some((ac) => ac.client)) {
                  activeStore.send({
                    type: 'setFlightGroupClientCount',
                    flightGroupId: fg.id,
                    count: 0
                  })
                }
              }
            }}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset
          </Button>
          {selectedTask && (
            <>
              {canCreateSelectedTask && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-synthwave-cyan/40 text-synthwave-cyan hover:bg-synthwave-cyan/20 hover:text-white"
                  onClick={() => {
                    const task = schemas.task.safeParse(selectedTask)
                    if (!task.success) return

                    activeStore.send({
                      type: 'createManualPlayerFlightGroup',
                      task: task.data
                    })
                  }}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  New
                </Button>
              )}
            </>
          )}
          {selectedTask && (
            <Button
              variant="outline"
              size="sm"
              className="border-synthwave-pink/30 text-secondary hover:bg-synthwave-pink/20 hover:text-white"
              onClick={() => setSelectedTask(null)}
            >
              <ChevronLeft className="mr-1.5 h-3.5 w-3.5" />
              Back
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="border-synthwave-pink/30 text-secondary hover:bg-synthwave-pink/20 hover:text-white"
            onClick={handleClose}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
