import { schemas } from '@dcc/contracts'
import { callsigns } from '@dcc/data'
import * as z from 'zod'

export type FlightGroupData = z.infer<typeof schemas.flightGroup>

export class FlightGroup {
  static create(
    draft: z.infer<typeof schemas.campaign.campaign>,
    coalition: z.infer<typeof schemas.coalition>,
    params: {
      aircrafts: z.infer<typeof schemas.aircraft>[]
      task: z.infer<typeof schemas.flightGroup>['task']
      position: z.infer<typeof schemas.position>
      homeBase: string
      callsign?: string
      spawnSource?: z.infer<typeof schemas.flightGroup>['spawnSource']
      target?: z.infer<typeof schemas.flightGroup>['target']
      flightplan: z.infer<typeof schemas.flightplan>
      tot?: Date
      packageId?: string
    }
  ): string {
    const tot = params.tot ?? FlightGroup.calculateTot(params.flightplan)
    const id = crypto.randomUUID()

    const existingCallsigns = new Set([
      ...draft.coalitions.player.flightGroups.map((fg) => fg.callsign),
      ...draft.coalitions.opponent.flightGroups.map((fg) => fg.callsign)
    ])

    let callsign = params.callsign
    if (callsign == null) {
      let attempts = 0
      do {
        callsign = `${callsigns[Math.floor(Math.random() * callsigns.length)] ?? 'Enfield'}-${
          Math.floor(Math.random() * 9) + 1
        }`
        attempts += 1
      } while (existingCallsigns.has(callsign) && attempts < 200)
      if (existingCallsigns.has(callsign)) {
        callsign = `${callsign}-${existingCallsigns.size + 1}`
      }
    }

    const newFlightGroupData: z.infer<typeof schemas.flightGroup> = {
      id,
      aircrafts: params.aircrafts.map((aircraft, index) => ({
        ...aircraft,
        unitName: `${callsign}-${index + 1}`
      })),
      task: params.task,
      position: params.position,
      homeBase: params.homeBase,
      callsign,
      spawnSource: params.spawnSource,
      target: params.target,
      flightplan: params.flightplan,
      tot,
      packageId: params.packageId
    }

    draft.coalitions[coalition].flightGroups.push(newFlightGroupData)
    return id
  }

  static calculateTot(flightplan: z.infer<typeof schemas.flightplan>): Date | undefined {
    if (!flightplan.waypoints.length) return undefined

    const STARTUP_DELAY_MS = 10 * 60 * 1000 // 20 minutes

    const start = new Date(flightplan.startTime)
    let currentTime = start.getTime() + STARTUP_DELAY_MS
    let currentPos = flightplan.waypoints[0]?.position

    if (currentPos == null) return undefined

    for (const waypoint of flightplan.waypoints) {
      const dx = waypoint.position.x - currentPos.x
      const dy = waypoint.position.y - currentPos.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      // Time = distance / speed
      // speed is in m/s (approx)
      // distance is in meters
      const speed = waypoint.speed
      // Avoid division by zero
      const timeSeconds = speed > 0 ? distance / speed : 0

      currentTime += timeSeconds * 1000
      currentPos = waypoint.position

      if (waypoint.type === 'Task') {
        return new Date(currentTime)
      }
    }

    return undefined
  }

  static createFlightPlan(
    home: z.infer<typeof schemas.position>,
    destination: z.infer<typeof schemas.position>,
    missionWaypoints: z.infer<typeof schemas.waypoint>[],
    startTime: Date,
    runwayAngle?: number,
    isHelicopter?: boolean
  ): z.infer<typeof schemas.flightplan> {
    const waypoints: z.infer<typeof schemas.waypoint>[] = []
    const dx = destination.x - home.x
    const dy = destination.y - home.y
    const distance = Math.sqrt(dx * dx + dy * dy)

    const ux = dx / distance
    const uy = dy / distance

    // If runway angle is provided, adjust ux/uy for Ascend/Descent to align with runway
    let ascendUx = ux
    let ascendUy = uy
    let descentUx = ux
    let descentUy = uy

    if (runwayAngle !== undefined) {
      // DCS coordinates: x=North, z=East (but here x, y).
      // If we assume x=North, y=East:
      // runwayAngle is degrees from North (CW).
      // Angle 0 -> (1, 0)
      // Angle 90 -> (0, 1)
      const rad = (runwayAngle * Math.PI) / 180
      const rx = Math.cos(rad)
      const ry = Math.sin(rad)

      // Determine if we should use angle or angle+180
      // Dot product with target vector
      const dot = rx * ux + ry * uy

      // If dot > 0, runway is roughly pointing towards target.
      // Ascend: fly along runway heading (rx, ry)
      // Descent: fly into runway heading?
      // Usually landing is INTO wind/runway heading.
      // So if runway heading is H, you land flying H.
      // You approach from -H.
      // So Descent point should be at home - (rx, ry) * dist?

      // Wait, if runway is 09 (East), you land flying East.
      // You approach from West. Descent point is West of airfield.
      // West is -East. So `home - vector`.

      // But which runway end to use? 09 or 27?
      // Pick the one aligned with takeoff towards target.
      // If dot > 0: Runway points to target.
      // Takeoff: Along (rx, ry).
      // Landing: Along (rx, ry). Approach from -(rx, ry).

      if (dot > 0) {
        ascendUx = rx
        ascendUy = ry
        descentUx = rx // Descent point is BEHIND runway start, so home - descentVector * dist
        descentUy = ry
      } else {
        // Runway points away. Use reciprocal (angle + 180).
        ascendUx = -rx
        ascendUy = -ry
        descentUx = -rx
        descentUy = -ry
      }
    }

    // 1. TakeOff
    waypoints.push({
      name: 'TakeOff',
      position: home,
      altitude: 0,
      speed: isHelicopter ? 50 : 150,
      type: 'TakeOff'
    })

    if (!isHelicopter) {
      // 2. Ascend / Join (20km out)
      waypoints.push({
        name: 'Ascend',
        position: {
          x: home.x + ascendUx * 20000,
          y: home.y + ascendUy * 20000
        },
        altitude: 2000,
        speed: 200,
        type: 'Nav'
      })
    }

    // 3. Mission Waypoints
    waypoints.push(...missionWaypoints)

    if (!isHelicopter) {
      // 4. Descent (20km from home)
      // Descent point is "Final Approach Fix" roughly.
      // If landing direction is D, we should be at home - D * 20km.
      // So we use SUBTRACTION here relative to landing direction?
      // descentUx/Uy is the runway direction we selected (aligned with takeoff).
      // Assuming same direction for landing.
      waypoints.push({
        name: 'Descent',
        position: {
          x: home.x - descentUx * 20000,
          y: home.y - descentUy * 20000
        },
        altitude: 2000,
        speed: 200,
        type: 'Nav'
      })
    }

    // 5. Landing
    waypoints.push({
      name: 'Landing',
      position: home,
      altitude: 0,
      speed: isHelicopter ? 50 : 150,
      type: 'Landing'
    })

    return {
      id: crypto.randomUUID(),
      startTime,
      waypoints
    }
  }

  static calculateStartTimeForTot(
    home: z.infer<typeof schemas.position>,
    missionWaypoints: z.infer<typeof schemas.waypoint>[],
    desiredTot: Date,
    isHelicopter?: boolean
  ): Date {
    const STARTUP_DELAY_MS = 10 * 60 * 1000 // 10 minutes

    // Calculate time from takeoff to ToT (the Task waypoint)
    let timeToTotMs = 0
    let currentPos = home

    if (!isHelicopter) {
      // Include the ascend waypoint time (20km at 200 m/s)
      const ascendDistance = 20000
      const ascendSpeed = 200
      timeToTotMs += (ascendDistance / ascendSpeed) * 1000
    }

    // Update current position to ascend position (we don't have the exact position here,
    // so we'll use the first mission waypoint as reference)
    if (missionWaypoints.length > 0) {
      currentPos = missionWaypoints[0]!.position
    }

    // Calculate time through mission waypoints until Task waypoint
    for (const waypoint of missionWaypoints) {
      const dx = waypoint.position.x - currentPos.x
      const dy = waypoint.position.y - currentPos.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      const speed = waypoint.speed
      const timeSeconds = speed > 0 ? distance / speed : 0

      timeToTotMs += timeSeconds * 1000
      currentPos = waypoint.position

      if (waypoint.type === 'Task') {
        break
      }
    }

    // Start time = desired ToT - time to reach ToT - startup delay
    const startTime = new Date(desiredTot.getTime() - timeToTotMs - STARTUP_DELAY_MS)
    return startTime
  }

  constructor(protected _data: FlightGroupData) {}

  // Getters read from the wrapped data object
  get id() {
    return this._data.id
  }

  get task() {
    return this._data.task
  }

  get position() {
    return this._data.position
  }

  get homeBase() {
    return this._data.homeBase
  }

  get callsign() {
    return this._data.callsign
  }

  get aircrafts() {
    return this._data.aircrafts
  }

  get target() {
    return this._data.target
  }

  get tot() {
    return this._data.tot
  }

  get packageId() {
    return this._data.packageId
  }

  get targetDestroyed() {
    return this._data.targetDestroyed
  }

  set targetDestroyed(targetDestroyed: boolean | undefined) {
    this._data.targetDestroyed = targetDestroyed
  }

  // Setters mutate the wrapped data object (works with Immer drafts)
  setPosition(newPosition: z.infer<typeof schemas.position>) {
    this._data.position = newPosition
  }

  setHomeBase(newHomeBase: string) {
    this._data.homeBase = newHomeBase
  }

  setTarget(target: NonNullable<FlightGroupData['target']>) {
    this._data.target = target
  }

  isLanded(currentTime: Date): boolean {
    const startTime = new Date(this._data.flightplan.startTime)
    if (currentTime < startTime) {
      return false
    }

    const STARTUP_DELAY_MS = 10 * 60 * 1000 // 10 minutes

    let elapsed = currentTime.getTime() - startTime.getTime()

    if (elapsed < STARTUP_DELAY_MS) {
      return false
    }

    elapsed -= STARTUP_DELAY_MS

    const waypoints = this._data.flightplan.waypoints
    for (let i = 0; i < waypoints.length - 1; i++) {
      const startWp = waypoints[i]
      const endWp = waypoints[i + 1]

      if (!startWp || !endWp) {
        continue
      }

      const dx = endWp.position.x - startWp.position.x
      const dy = endWp.position.y - startWp.position.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const speed = endWp.speed

      const timeSeconds = speed > 0 ? dist / speed : 0
      const timeMs = timeSeconds * 1000

      if (elapsed < timeMs) {
        return false
      }

      elapsed -= timeMs
    }

    return true
  }

  move(currentTime: Date) {
    const startTime = new Date(this._data.flightplan.startTime)
    if (currentTime < startTime) {
      return
    }

    const STARTUP_DELAY_MS = 10 * 60 * 1000 // 10 minutes

    let elapsed = currentTime.getTime() - startTime.getTime()

    if (elapsed < STARTUP_DELAY_MS) {
      if (this._data.flightplan.waypoints.length > 0) {
        this.setPosition(this._data.flightplan.waypoints[0]?.position ?? this._data.position)
      }
      return
    }

    elapsed -= STARTUP_DELAY_MS

    const waypoints = this._data.flightplan.waypoints
    for (let i = 0; i < waypoints.length - 1; i++) {
      const startWp = waypoints[i]
      const endWp = waypoints[i + 1]

      if (!startWp || !endWp) {
        continue
      }

      const dx = endWp.position.x - startWp.position.x
      const dy = endWp.position.y - startWp.position.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const speed = endWp.speed

      const timeSeconds = speed > 0 ? dist / speed : 0
      const timeMs = timeSeconds * 1000

      if (elapsed < timeMs) {
        const ratio = elapsed / timeMs
        this.setPosition({
          x: startWp.position.x + dx * ratio,
          y: startWp.position.y + dy * ratio
        })
        return
      }

      elapsed -= timeMs
    }

    if (waypoints.length > 0) {
      this.setPosition(waypoints[waypoints.length - 1]?.position ?? this._data.position)
    }
  }
}
