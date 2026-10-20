import { config, schemas } from '@dcc/contracts'
import { aircrafts, scenarios, theatres } from '@dcc/data'
import type * as z from 'zod'

import { FlightGroup } from '../entities/flight-group'
import { calculateDistance } from '../utils/calculate-distance'
import {
  getCoalitionAirdromes,
  getCoalitionFarps,
  type AirdromeSelection
} from './spawn/packages/common'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type FlightGroupData = Campaign['coalitions']['player']['flightGroups'][number]
type AircraftName = z.infer<typeof schemas.dcs.aircraftName>

const aircraftMap = new Map(Object.values(aircrafts).map((aircraft) => [aircraft.name, aircraft]))
const generatedRouteWaypointNames = new Set(['TakeOff', 'Ascend', 'Descent', 'Landing'])

function getCampaignTheatre(campaign: Campaign) {
  const scenario = scenarios.find((candidate) => candidate.id === campaign.scenarioId)
  return scenario
    ? theatres.find((candidate) => candidate.name === scenario.theatreName)
    : undefined
}

function getMissionWaypoints(group: FlightGroupData) {
  return group.flightplan.waypoints.filter(
    (waypoint) => !generatedRouteWaypointNames.has(waypoint.name)
  )
}

function findNearestReachableHomeBase(
  candidates: AirdromeSelection[],
  targetPosition: z.infer<typeof schemas.position>
) {
  return candidates
    .filter(
      (candidate) =>
        calculateDistance(candidate.position, targetPosition) <= config.packages.CAS.maxDistance
    )
    .sort(
      (left, right) =>
        calculateDistance(left.position, targetPosition) -
        calculateDistance(right.position, targetPosition)
    )[0]
}

/**
 * Moves CAS flights between FARPs and airbases when the aircraft category changes.
 * Returns false when the override would leave the flight without a valid departure base.
 */
export function rehomeCasForAircraftChange(
  campaign: Campaign,
  coalition: Coalition,
  group: FlightGroupData,
  aircraftType: AircraftName
): boolean {
  const aircraft = aircraftMap.get(aircraftType)
  const previousAircraftType = group.aircrafts[0]?.aircraftName
  const previousAircraft = previousAircraftType ? aircraftMap.get(previousAircraftType) : undefined
  if (
    aircraft?.isHelicopter == null ||
    previousAircraft?.isHelicopter == null ||
    aircraft.isHelicopter === previousAircraft.isHelicopter
  ) {
    return true
  }

  const theatre = getCampaignTheatre(campaign)
  if (!theatre) return false

  const missionWaypoints = getMissionWaypoints(group)
  const targetPosition =
    missionWaypoints.find((waypoint) => waypoint.name === 'Target')?.position ??
    missionWaypoints.find((waypoint) => waypoint.type === 'Task')?.position ??
    missionWaypoints[0]?.position
  if (!targetPosition) return false

  const airdromes = getCoalitionAirdromes(campaign, theatre, coalition)
  const currentAirdrome = airdromes.find((candidate) => candidate.name === group.homeBase)
  const homeBase =
    group.task === 'CAS' && aircraft.isHelicopter
      ? (findNearestReachableHomeBase(
          [...airdromes, ...getCoalitionFarps(campaign, coalition)],
          targetPosition
        ) ?? currentAirdrome)
      : (currentAirdrome ??
        findNearestReachableHomeBase(
          aircraft.isHelicopter
            ? [...airdromes, ...getCoalitionFarps(campaign, coalition)]
            : airdromes,
          targetPosition
        ))
  if (!homeBase) return false

  const previousFlightplan = group.flightplan
  const rebuiltFlightplan = FlightGroup.createFlightPlan(
    homeBase.position,
    targetPosition,
    missionWaypoints,
    new Date(previousFlightplan.startTime),
    homeBase.runwayAngle,
    aircraft.isHelicopter
  )

  group.homeBase = homeBase.name
  group.position = homeBase.position
  group.flightplan = {
    ...rebuiltFlightplan,
    id: previousFlightplan.id,
    originalStartTime: previousFlightplan.originalStartTime
  }
  group.tot = FlightGroup.calculateTot(group.flightplan)
  return true
}
