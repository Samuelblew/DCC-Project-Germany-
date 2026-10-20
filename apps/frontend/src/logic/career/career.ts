import { schemas } from '@dcc/contracts'
import {
  careerAircraft as careerAircraftCatalog,
  careerPilotHire,
  careerRewards,
  careerRoleMultipliers,
  careerStart,
  careerTaskRewards,
  getAcquirableCareerAircraft,
  getCareerAircraft,
  isFactionCareerAircraft,
  normalizeAmmoName,
  type CareerKillKind,
  type CareerAircraft,
  type CareerLoadout,
  type CareerPilotSkill,
  type CareerRadioPlan
} from '@dcc/data'
import type * as z from 'zod'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Career = z.infer<typeof schemas.campaign.career>
type AcquisitionRule = z.infer<typeof schemas.campaign.careerAcquisitionRule>
type Airframe = z.infer<typeof schemas.campaign.careerAirframe>
type Pilot = z.infer<typeof schemas.campaign.careerPilot>
type FlightGroup = Campaign['coalitions']['player']['flightGroups'][number]
type MissionState = z.infer<typeof schemas.missionState>
type Theatre = z.infer<typeof schemas.theatre>
type Position = { x: number; y: number }

/** A landing farther than this from a friendly airfield counts as an off-field landing. */
const AIRFIELD_LANDING_RADIUS = 6_000
/** Each 15 points of missing integrity arms one more minor failure on the player's aircraft. */
const DAMAGE_PER_FAILURE = 0.15
const HIDDEN_DEFECT_MINUTES: [number, number] = [5, 45]

const PILOT_NAMES = [
  'Volkov',
  'Sokolov',
  'Morozov',
  'Lebedev',
  'Kozlov',
  'Novikov',
  'Orlov',
  'Zaitsev',
  'Pavlov',
  'Semenov',
  'Golubev',
  'Vinogradov'
]

export type CareerResult = { ok: true } | { ok: false; reason: string }

const ok: CareerResult = { ok: true }
const fail = (reason: string): CareerResult => ({ ok: false, reason })

function randomBetween([min, max]: [number, number]) {
  return min + Math.random() * (max - min)
}

function randomInt([min, max]: [number, number]) {
  return Math.floor(min + Math.random() * (max - min + 1))
}

function pickDistinct<T>(items: readonly T[], count: number): T[] {
  const pool = [...items]
  const picked: T[] = []
  while (picked.length < count && pool.length > 0) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!)
  }
  return picked
}

function distance(a: Position, b: Position) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Deep copy of date-free data that also works on immer drafts. */
function copyPlainData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function addLedgerEntry(career: Career, amount: number, reason: string, time: Date) {
  career.money += amount
  career.ledger.push({ id: crypto.randomUUID(), time: new Date(time), amount, reason })
}

/** Stores owned for one aircraft type; each type keeps its own stock. */
export function getStock(career: Career, aircraftName: string): Readonly<Record<string, number>> {
  return career.inventory[aircraftName] ?? {}
}

function addStock(career: Career, aircraftName: string, weaponId: string, delta: number) {
  const stock = (career.inventory[aircraftName] ??= {})
  stock[weaponId] = (stock[weaponId] ?? 0) + delta
}

/** Every type the player has owned, plus the one the career screens open on. */
export function getCareerAircraftTypes(career: Career): Set<string> {
  return new Set([
    career.preferredAircraft,
    ...career.airframes.map((airframe) => airframe.aircraftName)
  ])
}

/** The career aircraft the screens show by default. */
export function getPreferredCareerAircraft(career: Career): CareerAircraft | undefined {
  return getCareerAircraft(career.preferredAircraft)
}

function createAirframe(
  career: Career,
  aircraft: CareerAircraft,
  condition: Airframe['condition'],
  location: string,
  time: Date
): Airframe {
  const tailNumber = String(career.nextTailNumber).padStart(2, '0')
  career.nextTailNumber += 1
  const used = condition === 'used'
  return {
    id: crypto.randomUUID(),
    tailNumber,
    aircraftName: aircraft.aircraftName,
    condition,
    integrity: used ? Number(randomBetween(aircraft.usedIntegrityRange).toFixed(2)) : 1,
    hiddenDefects: used
      ? pickDistinct(aircraft.minorFailures, randomInt(aircraft.usedDefectCount)).map(
          (failure) => ({ ...failure, afterMinutes: randomInt(HIDDEN_DEFECT_MINUTES) })
        )
      : [],
    location,
    status: 'ready',
    acquiredAt: new Date(time)
  }
}

export function createInitialCareer(params: {
  aircraft: CareerAircraft
  location: string
  time: Date
  acquisitionRule?: AcquisitionRule
}): Career {
  const aircraftName = params.aircraft.aircraftName
  const career: Career = {
    preferredAircraft: aircraftName,
    acquisitionRule: params.acquisitionRule ?? 'fidelity',
    money: 0,
    airframes: [],
    pilots: [],
    inventory: { [aircraftName]: { ...params.aircraft.startInventory } },
    presets: [],
    radios: {},
    ledger: [],
    nextTailNumber: 1
  }
  career.airframes.push(
    createAirframe(career, params.aircraft, 'new', params.location, params.time)
  )
  addLedgerEntry(career, careerStart.money, 'Starting funds', params.time)
  return career
}

/** The player's airfield closest to the enemy, where the first aircraft is based. */
export function pickCareerHomeBase(campaign: Campaign, theatre: Theatre): string | undefined {
  const enemyPositions = campaign.coalitions.opponent.objectiveIds
    .map((id) => theatre.objectives.find((objective) => objective.name === id)?.position)
    .filter((position): position is Position => position != null)
  const airfields = campaign.coalitions.player.airdromeNames
    .map((name) => ({ name, details: theatre.airdromeDetails[name] }))
    .filter((entry) => entry.details != null)
  let best: string | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const { name, details } of airfields) {
    const nearestEnemy = Math.min(...enemyPositions.map((p) => distance(p, details!)))
    if (nearestEnemy < bestDistance) {
      bestDistance = nearestEnemy
      best = name
    }
  }
  return best ?? campaign.coalitions.player.airdromeNames[0]
}

export function getUsedAirframePrice(aircraft: CareerAircraft, integrity: number) {
  const [min, max] = aircraft.prices.usedRange
  const [low, high] = aircraft.usedIntegrityRange
  const share = high > low ? (integrity - low) / (high - low) : 1
  return Math.round(min + Math.max(0, Math.min(1, share)) * (max - min))
}

/** Types the player may buy under the career's acquisition rule. */
export function getPurchasableAircraft(campaign: Campaign): CareerAircraft[] {
  const career = campaign.career
  if (!career) return []
  return getAcquirableCareerAircraft(
    career.acquisitionRule,
    campaign.coalitions.player.aircraftTypes
  )
}

/** Whether the enemy flies this type too, which makes telling friend from foe by eye harder. */
export function isFlownByEnemy(campaign: Campaign, aircraft: CareerAircraft) {
  return isFactionCareerAircraft(aircraft, campaign.coalitions.opponent.aircraftTypes)
}

/**
 * Buys an aircraft for delivery to the rear airfield. It is paid for at once and stands ready there
 * once the type's delivery time has passed; flying it to another base is up to the player.
 */
export function buyAirframe(
  campaign: Campaign,
  theatre: Theatre,
  aircraft: CareerAircraft,
  condition: Airframe['condition']
): CareerResult {
  const career = campaign.career
  if (!career) return fail('No career')
  const purchasable = getPurchasableAircraft(campaign)
  if (!purchasable.some((entry) => entry.aircraftName === aircraft.aircraftName)) {
    return fail(`The ${aircraft.displayName} is not available to your coalition`)
  }
  const location = pickRearAirfield(campaign, theatre)
  if (!location) return fail('No friendly airfield to deliver to')
  const time = campaign.time
  const airframe = createAirframe(career, aircraft, condition, location, time)
  const price =
    condition === 'new' ? aircraft.prices.new : getUsedAirframePrice(aircraft, airframe.integrity)
  if (career.money < price) {
    career.nextTailNumber -= 1
    return fail(`Not enough money: ${price} needed`)
  }
  airframe.status = 'delivering'
  airframe.arrivesAt = new Date(time.getTime() + aircraft.deliveryHours * 3_600_000)
  career.airframes.push(airframe)
  addLedgerEntry(
    career,
    -price,
    `Bought ${condition} ${aircraft.displayName} #${airframe.tailNumber}, delivery to ${location}`,
    time
  )
  career.replacementAvailableAt = undefined
  return ok
}

/** What an aircraft fetches when sold: its new or used value, worn down by lost integrity. */
export function getResaleValue(aircraft: CareerAircraft, airframe: Airframe) {
  const value = airframe.condition === 'new' ? aircraft.prices.new : aircraft.prices.usedRange[1]
  return Math.round(value * aircraft.resaleFactor * airframe.integrity)
}

/** Sells an aircraft parked at its base. The career opens on another type if none of it is left. */
export function sellAirframe(
  career: Career,
  aircraft: CareerAircraft,
  airframeId: string,
  time: Date
): CareerResult {
  const airframe = career.airframes.find((entry) => entry.id === airframeId)
  if (!airframe || airframe.status !== 'ready')
    return fail('Only aircraft on the ground can be sold')
  const value = getResaleValue(aircraft, airframe)
  career.airframes = career.airframes.filter((entry) => entry.id !== airframeId)
  addLedgerEntry(career, value, `Sold ${aircraft.displayName} #${airframe.tailNumber}`, time)
  const owned = career.airframes.filter((entry) => entry.status !== 'destroyed')
  if (!owned.some((entry) => entry.aircraftName === career.preferredAircraft) && owned[0]) {
    career.preferredAircraft = owned[0].aircraftName
  }
  return ok
}

export function getRepairCost(aircraft: CareerAircraft, airframe: Airframe) {
  return Math.ceil((1 - airframe.integrity) * 100 * aircraft.prices.repairPerPercent)
}

export function repairAirframe(
  career: Career,
  aircraft: CareerAircraft,
  airframeId: string,
  time: Date
): CareerResult {
  const airframe = career.airframes.find((entry) => entry.id === airframeId)
  if (!airframe || airframe.status !== 'ready') return fail('Aircraft is not on the ground')
  const cost = getRepairCost(aircraft, airframe)
  if (cost <= 0) return fail('Aircraft is not damaged')
  if (career.money < cost) return fail(`Not enough money: ${cost} needed`)
  airframe.integrity = 1
  addLedgerEntry(career, -cost, `Repaired #${airframe.tailNumber}`, time)
  return ok
}

export function overhaulAirframe(
  career: Career,
  aircraft: CareerAircraft,
  airframeId: string,
  time: Date
): CareerResult {
  const airframe = career.airframes.find((entry) => entry.id === airframeId)
  if (!airframe || airframe.status !== 'ready') return fail('Aircraft is not on the ground')
  if (airframe.condition !== 'used') return fail('Only used aircraft need an overhaul')
  if (career.money < aircraft.prices.overhaul) {
    return fail(`Not enough money: ${aircraft.prices.overhaul} needed`)
  }
  airframe.hiddenDefects = []
  airframe.condition = 'new'
  addLedgerEntry(career, -aircraft.prices.overhaul, `Overhauled #${airframe.tailNumber}`, time)
  return ok
}

export function hirePilot(career: Career, skill: CareerPilotSkill, time: Date): CareerResult {
  const price = careerPilotHire[skill]
  if (career.money < price) return fail(`Not enough money: ${price} needed`)
  const name = PILOT_NAMES[career.pilots.length % PILOT_NAMES.length]!
  career.pilots.push({
    id: crypto.randomUUID(),
    name,
    skill,
    status: 'available',
    hiredAt: new Date(time)
  })
  addLedgerEntry(career, -price, `Hired ${skill} wingman ${name}`, time)
  return ok
}

export function buyWeapon(
  career: Career,
  aircraft: CareerAircraft,
  weaponId: string,
  count: number,
  time: Date
): CareerResult {
  const weapon = aircraft.weapons.find((entry) => entry.id === weaponId)
  if (!weapon || weapon.free) return fail('Unknown weapon')
  const cost = weapon.price * count
  if (count <= 0) return fail('Nothing to buy')
  if (career.money < cost) return fail(`Not enough money: ${cost} needed`)
  addStock(career, aircraft.aircraftName, weaponId, count)
  addLedgerEntry(career, -cost, `Bought ${count}x ${weapon.name}`, time)
  return ok
}

/** Built-in loadouts followed by the player's own presets for that aircraft. */
export function getCareerLoadouts(career: Career, aircraft: CareerAircraft): CareerLoadout[] {
  return [
    ...aircraft.loadouts,
    ...career.presets
      .filter((preset) => preset.aircraftName === aircraft.aircraftName)
      .map((preset) => ({
        id: preset.id,
        name: preset.name,
        tasks: [],
        pylons: preset.pylons.map((pylon) => ({ ...pylon }))
      }))
  ]
}

/** Whether every store sits on a station the module accepts it on. */
export function isLoadoutValid(aircraft: CareerAircraft, pylons: CareerLoadout['pylons']) {
  const stations = new Set<number>()
  for (const pylon of pylons) {
    if (stations.has(pylon.num)) return false
    stations.add(pylon.num)
    const weapon = aircraft.weapons.find((entry) => entry.id === pylon.CLSID)
    if (!weapon || !weapon.stations.includes(pylon.num)) return false
  }
  return true
}

export function saveCareerPreset(
  career: Career,
  aircraft: CareerAircraft,
  preset: { id?: string; name: string; pylons: CareerLoadout['pylons'] }
): CareerResult {
  const name = preset.name.trim()
  if (!name) return fail('Name the preset')
  if (!isLoadoutValid(aircraft, preset.pylons))
    return fail('A store is on a station that cannot carry it')
  const pylons = [...preset.pylons].sort((a, b) => a.num - b.num)
  const existing = preset.id ? career.presets.find((entry) => entry.id === preset.id) : undefined
  if (existing && existing.aircraftName !== aircraft.aircraftName) {
    return fail(`That preset belongs to the ${existing.aircraftName}`)
  }
  if (existing) {
    existing.name = name
    existing.pylons = pylons
  } else {
    career.presets.push({
      id: `preset-${crypto.randomUUID()}`,
      aircraftName: aircraft.aircraftName,
      name,
      pylons
    })
  }
  return ok
}

export function deleteCareerPreset(career: Career, presetId: string): CareerResult {
  const before = career.presets.length
  career.presets = career.presets.filter((preset) => preset.id !== presetId)
  return career.presets.length < before ? ok : fail('Preset not found')
}

/**
 * The player's radio presets for an aircraft, padded to its channel counts. Undefined when the
 * module has no preset radios the DCC can program.
 */
export function getCareerRadioPlan(
  career: Career,
  aircraft: CareerAircraft
): CareerRadioPlan | undefined {
  const radios = aircraft.radios
  if (!radios) return undefined
  const plan = career.radios[aircraft.aircraftName] ?? radios.defaultPlan
  const pad = <T>(entries: T[], length: number, empty: T) =>
    Array.from({ length }, (_, index) => entries[index] ?? empty)
  return {
    comms: radios.comms.map((radio, index) =>
      pad(plan.comms[index] ?? [], radio.channels, { kind: 'empty' })
    ),
    adf: radios.adf ? pad(plan.adf, radios.adf.pairs, { kind: 'empty' }) : []
  }
}

/** Whether a manual frequency is one the aircraft's comms radio at `radioIndex` can tune. */
export function isCommsFrequencyValid(aircraft: CareerAircraft, mhz: number, radioIndex = 0) {
  return (
    aircraft.radios?.comms[radioIndex]?.bands.some(([low, high]) => mhz >= low && mhz <= high) ??
    false
  )
}

export function setCareerRadioPlan(
  career: Career,
  aircraft: CareerAircraft,
  plan: CareerRadioPlan
): CareerResult {
  const radios = aircraft.radios
  if (!radios) return fail(`The ${aircraft.displayName} has no programmable radios`)
  if (plan.comms.length > radios.comms.length) return fail('Too many comms radios')
  if (plan.comms.some((channels, index) => channels.length > radios.comms[index]!.channels)) {
    return fail('Too many comms presets')
  }
  if (plan.adf.length > (radios.adf?.pairs ?? 0)) return fail('Too many ADF presets')
  const invalid = plan.comms.some((channels, index) =>
    channels.some(
      (source) => source.kind === 'manual' && !isCommsFrequencyValid(aircraft, source.mhz, index)
    )
  )
  if (invalid) return fail('A manual frequency is outside the radio bands')
  career.radios[aircraft.aircraftName] = plan
  return ok
}

/** Stores a loadout needs that the inventory cannot cover for `aircraftCount` aircraft. */
export function getLoadoutShortfall(
  career: Career,
  aircraft: CareerAircraft,
  loadout: CareerLoadout,
  aircraftCount: number
) {
  const needed = new Map<string, number>()
  for (const pylon of loadout.pylons) {
    const weapon = aircraft.weapons.find((entry) => entry.id === pylon.CLSID)
    if (!weapon || weapon.free) continue
    needed.set(pylon.CLSID, (needed.get(pylon.CLSID) ?? 0) + aircraftCount)
  }
  return [...needed]
    .map(([weaponId, count]) => ({
      weaponId,
      name: aircraft.weapons.find((entry) => entry.id === weaponId)?.name ?? weaponId,
      needed: count,
      owned: getStock(career, aircraft.aircraftName)[weaponId] ?? 0
    }))
    .filter((entry) => entry.owned < entry.needed)
}

/** Ready aircraft, optionally only those at one base or of one type. */
export function getReadyAirframes(career: Career, location?: string, aircraftName?: string) {
  return career.airframes.filter(
    (airframe) =>
      airframe.status === 'ready' &&
      (location == null || airframe.location === location) &&
      (aircraftName == null || airframe.aircraftName === aircraftName)
  )
}

export function getAvailablePilots(career: Career) {
  return career.pilots.filter((pilot) => pilot.status === 'available')
}

/** Failures armed on the player's aircraft: its hidden defects plus wear from unrepaired damage. */
export function getArmedFailures(aircraft: CareerAircraft, airframe: Airframe) {
  const hiddenIds = new Set(airframe.hiddenDefects.map((failure) => failure.id))
  const damageCount = Math.floor((1 - airframe.integrity + 1e-9) / DAMAGE_PER_FAILURE)
  const damageFailures = pickDistinct(
    aircraft.minorFailures.filter((failure) => !hiddenIds.has(failure.id)),
    damageCount
  ).map((failure) => ({ ...failure, afterMinutes: 0 }))
  return [...airframe.hiddenDefects, ...damageFailures]
}

export type SortiePlan = {
  flightGroupId: string
  loadoutId: string
  playerAirframeId: string
  wingmen: Array<{ airframeId: string; pilotId: string }>
}

export function canFlyCareerFlight(career: Career, aircraft: CareerAircraft, group: FlightGroup) {
  const taskSupported =
    group.task === 'Training' ||
    aircraft.loadouts.some((loadout) => loadout.tasks.includes(group.task))
  return (
    taskSupported && getReadyAirframes(career, group.homeBase, aircraft.aircraftName).length > 0
  )
}

/**
 * Commits a sortie: the flight is rebuilt from the owned aircraft and hired pilots, stores leave the
 * stock of the type flown, and everything involved is marked as flying until the result is settled.
 * The type is the player's own aircraft; every wingman must fly the same type, as DCS flights do.
 */
export function launchCareerSortie(campaign: Campaign, plan: SortiePlan): CareerResult {
  const career = campaign.career
  if (!career) return fail('Not a career campaign')
  if (career.sortie) return fail('A sortie is already in progress')
  const group = campaign.coalitions.player.flightGroups.find((g) => g.id === plan.flightGroupId)
  if (!group) return fail('Flight not found')
  const playerAirframe = career.airframes.find((entry) => entry.id === plan.playerAirframeId)
  if (!playerAirframe) return fail('Aircraft not found')
  const aircraft = getCareerAircraft(playerAirframe.aircraftName)
  if (!aircraft) return fail(`The ${playerAirframe.aircraftName} cannot be flown in the career`)
  const loadout = getCareerLoadouts(career, aircraft).find((entry) => entry.id === plan.loadoutId)
  if (!loadout) return fail('Unknown loadout')
  if (!isLoadoutValid(aircraft, loadout.pylons)) return fail('Loadout breaks station rules')

  const airframeIds = [plan.playerAirframeId, ...plan.wingmen.map((w) => w.airframeId)]
  if (new Set(airframeIds).size !== airframeIds.length) return fail('Each aircraft flies once')
  const airframes = airframeIds.map((id) => career.airframes.find((entry) => entry.id === id))
  if (airframes.some((a) => !a || a.status !== 'ready' || a.location !== group.homeBase)) {
    return fail(`Every aircraft must be ready at ${group.homeBase}`)
  }
  if (airframes.some((a) => a!.aircraftName !== aircraft.aircraftName)) {
    return fail(`Every aircraft in the flight must be a ${aircraft.displayName}`)
  }
  const pilots = plan.wingmen.map((w) => career.pilots.find((p) => p.id === w.pilotId))
  if (pilots.some((p) => !p || p.status !== 'available')) return fail('A wingman is unavailable')
  if (new Set(plan.wingmen.map((w) => w.pilotId)).size !== plan.wingmen.length) {
    return fail('Each wingman flies once')
  }
  const shortfall = getLoadoutShortfall(career, aircraft, loadout, airframeIds.length)
  if (shortfall.length > 0) {
    return fail(
      `Missing stores: ${shortfall.map((s) => `${s.name} ${s.owned}/${s.needed}`).join(', ')}`
    )
  }

  const loaded: Record<string, number> = {}
  for (const pylon of loadout.pylons) {
    const weapon = aircraft.weapons.find((entry) => entry.id === pylon.CLSID)
    if (!weapon || weapon.free) continue
    loaded[pylon.CLSID] = (loaded[pylon.CLSID] ?? 0) + 1
  }
  for (const [weaponId, perAircraft] of Object.entries(loaded)) {
    addStock(career, aircraft.aircraftName, weaponId, -perAircraft * airframeIds.length)
  }

  // Plain JSON copies: inside the store these are immer drafts, which structuredClone rejects.
  const originalAircrafts = copyPlainData(group.aircrafts)
  const originalWaypoints = copyPlainData(group.flightplan.waypoints)
  if (aircraft.maxRouteWaypoints != null) {
    group.flightplan.waypoints = fitRouteToWaypointLimit(
      group.flightplan.waypoints,
      aircraft.maxRouteWaypoints
    )
  }

  const template = group.aircrafts[0]
  group.aircrafts = airframes.map((airframe, index) => ({
    id: template && index === 0 ? template.id : crypto.randomUUID(),
    unitName: `${group.callsign}-${index + 1}`,
    aircraftName: aircraft.aircraftName,
    client: index === 0,
    skill: index === 0 ? undefined : pilots[index - 1]!.skill,
    pylons: loadout.pylons.map((pylon) => ({ ...pylon })),
    failures: index === 0 ? getArmedFailures(aircraft, airframe!) : undefined,
    radioPlan: index === 0 ? getCareerRadioPlan(career, aircraft) : undefined,
    careerAirframeId: airframe!.id
  }))

  // Your own missions wait for you, so crewing one means leaving now.
  if (group.careerMission) setTakeoff(group, new Date(campaign.time))

  for (const airframe of airframes) airframe!.status = 'flying'
  for (const pilot of pilots) pilot!.status = 'flying'
  career.preferredAircraft = aircraft.aircraftName
  career.sortie = {
    flightGroupId: group.id,
    aircraftName: aircraft.aircraftName,
    task: group.task,
    callsign: group.callsign,
    homeBase: group.homeBase,
    startedAt: new Date(campaign.time),
    originalAircrafts,
    originalWaypoints,
    members: airframes.map((airframe, index) => ({
      unitName: `${group.callsign}-${index + 1}`,
      airframeId: airframe!.id,
      pilotId: index === 0 ? undefined : plan.wingmen[index - 1]!.pilotId,
      loaded: { ...loaded }
    }))
  }
  return ok
}

/** Cancels a sortie that never flew: stores go back and the aircraft and pilots stand down. */
export function abortCareerSortie(campaign: Campaign) {
  const career = campaign.career
  const sortie = career?.sortie
  if (!career || !sortie) return
  const aircraftName = sortie.aircraftName ?? career.preferredAircraft
  for (const member of sortie.members) {
    for (const [weaponId, count] of Object.entries(member.loaded)) {
      addStock(career, aircraftName, weaponId, count)
    }
    const airframe = career.airframes.find((entry) => entry.id === member.airframeId)
    if (airframe?.status === 'flying') airframe.status = 'ready'
    const pilot = career.pilots.find((entry) => entry.id === member.pilotId)
    if (pilot?.status === 'flying') pilot.status = 'available'
  }
  const group = campaign.coalitions.player.flightGroups.find((g) => g.id === sortie.flightGroupId)
  if (group) {
    // Put the flight back exactly as it was planned, so standing down leaves no trace on the board.
    if (sortie.originalAircrafts) group.aircrafts = sortie.originalAircrafts
    if (sortie.originalWaypoints) group.flightplan.waypoints = sortie.originalWaypoints
    for (const aircraft of group.aircrafts) {
      if (aircraft.client) aircraft.client = false
    }
  }
  career.sortie = undefined
}

const NAVIGATION_ONLY_WAYPOINTS = new Set(['Ascend', 'Descent'])

/**
 * Thins a route to what the aircraft's navigation system holds. Pure navigation legs (climb-out and
 * descent points) go first, then other turn points, never the take-off, landing or task points.
 */
export function fitRouteToWaypointLimit<T extends { name: string; type: string }>(
  waypoints: T[],
  limit: number
): T[] {
  let route = [...waypoints]
  const dropFirst = (predicate: (waypoint: T, index: number) => boolean) => {
    while (route.length > limit) {
      const index = route.findIndex(
        (waypoint, i) => i > 0 && i < route.length - 1 && predicate(waypoint, i)
      )
      if (index === -1) return
      route = route.filter((_, i) => i !== index)
    }
  }
  dropFirst((waypoint) => NAVIGATION_ONLY_WAYPOINTS.has(waypoint.name))
  dropFirst((waypoint) => waypoint.type === 'Nav')
  return route
}

/**
 * Clears player slots on flights of the career's aircraft types that no sortie crewed, so they can
 * never be flown without stores from the stock (older saves, or slots set before the rule existed).
 */
export function releaseBareCareerSlots(campaign: Campaign) {
  const career = campaign.career
  if (!career) return
  const careerTypes = getCareerAircraftTypes(career)
  for (const group of campaign.coalitions.player.flightGroups) {
    if (career.sortie?.flightGroupId === group.id) continue
    const careerFlight =
      group.careerMission === true ||
      group.aircrafts.some((aircraft) => careerTypes.has(aircraft.aircraftName))
    if (!careerFlight) continue
    for (const aircraft of group.aircrafts) {
      if (aircraft.client) aircraft.client = false
    }
  }
}

/**
 * How far ahead an uncrewed mission of the player's keeps its takeoff. The slot floats with the
 * clock, so the mission waits for the player instead of leaving (or expiring) without them.
 */
const CAREER_MISSION_LEAD_MS = 20 * 60_000

function setTakeoff(group: FlightGroup, takeoff: Date) {
  const shift = takeoff.getTime() - new Date(group.flightplan.startTime).getTime()
  if (shift === 0) return
  group.flightplan.startTime = new Date(takeoff)
  if (group.tot) group.tot = new Date(new Date(group.tot).getTime() + shift)
}

/**
 * Turns a freshly planned manual flight into the player's own mission: a single slot for the
 * player's aircraft, waiting on the ground for them, and never flown by the AI.
 */
export function claimCareerMission(campaign: Campaign, flightGroupId: string) {
  const group = campaign.coalitions.player.flightGroups.find((g) => g.id === flightGroupId)
  if (!group) return
  group.careerMission = true
  group.aircrafts = group.aircrafts.slice(0, 1)
  setTakeoff(group, new Date(campaign.time.getTime() + CAREER_MISSION_LEAD_MS))
}

function removeFlightGroup(campaign: Campaign, flightGroupId: string) {
  const player = campaign.coalitions.player
  player.flightGroups = player.flightGroups.filter((group) => group.id !== flightGroupId)
  for (const missionPackage of player.packages) {
    missionPackage.members = missionPackage.members.filter(
      (member) => member.flightGroupId !== flightGroupId
    )
  }
  player.packages = player.packages.filter((missionPackage) => missionPackage.members.length > 0)
}

/** Deletes one of the player's own missions, standing its sortie down first if it was crewed. */
export function deleteCareerMission(campaign: Campaign, flightGroupId: string): CareerResult {
  const group = campaign.coalitions.player.flightGroups.find((g) => g.id === flightGroupId)
  if (!group?.careerMission) return fail('Only your own missions can be deleted')
  if (campaign.career?.sortie?.flightGroupId === flightGroupId) abortCareerSortie(campaign)
  removeFlightGroup(campaign, flightGroupId)
  return ok
}

/** Keeps the player's uncrewed missions on the ground, their takeoff always just ahead. */
function holdCareerMissions(campaign: Campaign) {
  const career = campaign.career
  if (!career) return
  const earliest = new Date(campaign.time.getTime() + CAREER_MISSION_LEAD_MS)
  for (const group of campaign.coalitions.player.flightGroups) {
    if (!group.careerMission || career.sortie?.flightGroupId === group.id) continue
    if (new Date(group.flightplan.startTime) < earliest) setTakeoff(group, earliest)
  }
}

function isEnemyOfPlayer(coalition: MissionState['lostUnits'][number]['coalition']) {
  // The player's coalition is always blue in the generated mission.
  return coalition === 'red' || coalition === 1
}

function killKind(unit: MissionState['lostUnits'][number]): CareerKillKind {
  const name = unit.categoryName
  if (name === 'plane' || unit.category === 0) return 'air'
  if (name === 'helicopter' || unit.category === 1) return 'helicopter'
  if (name === 'ship' || unit.category === 3) return 'ship'
  return 'ground'
}

const KILL_REWARDS: Record<CareerKillKind, number> = {
  air: careerRewards.airKill,
  helicopter: careerRewards.helicopterKill,
  ground: careerRewards.groundKill,
  ship: careerRewards.shipKill
}

/** A kill's reward, scaled by how much that kind of target is the aircraft's job. */
export function getKillReward(
  aircraft: CareerAircraft | undefined,
  unit: MissionState['lostUnits'][number]
) {
  const kind = killKind(unit)
  const multiplier = aircraft ? careerRoleMultipliers[aircraft.role][kind] : 1
  return Math.round(KILL_REWARDS[kind] * multiplier)
}

/** The bonus for completing a task; tasks without their own bonus pay the standard one. */
export function getTaskReward(task: FlightGroup['task'] | undefined) {
  return (task ? careerTaskRewards[task] : undefined) ?? careerRewards.taskCompleted
}

function findFriendlyAirfield(campaign: Campaign, theatre: Theatre, position: Position) {
  let best: string | undefined
  let bestDistance = AIRFIELD_LANDING_RADIUS
  for (const name of campaign.coalitions.player.airdromeNames) {
    const details = theatre.airdromeDetails[name]
    if (!details) continue
    const d = distance(details, position)
    if (d <= bestDistance) {
      bestDistance = d
      best = name
    }
  }
  return best
}

type MissionAmmo = NonNullable<MissionState['landedUnits'][number]['ammo']>

/** Stores still on the aircraft, by weapon id, or undefined when DCS did not report ammunition. */
function countRemainingStores(
  aircraft: CareerAircraft | undefined,
  loaded: Record<string, number>,
  ammo: MissionAmmo | undefined
) {
  if (!ammo || !aircraft) return undefined
  const remaining: Record<string, number> = {}
  for (const [weaponId, loadedCount] of Object.entries(loaded)) {
    const weapon = aircraft.weapons.find((entry) => entry.id === weaponId)
    if (!weapon) continue
    const names = new Set(weapon.ammoNames)
    const rounds = ammo
      .filter((entry) =>
        [entry.typeName, entry.displayName].some(
          (name) => name != null && names.has(normalizeAmmoName(name))
        )
      )
      .reduce((sum, entry) => sum + entry.count, 0)
    remaining[weaponId] = Math.min(loadedCount, Math.floor(rounds / weapon.roundsPerStore))
  }
  return remaining
}

function findMissionUnit(missionState: MissionState, name: string) {
  for (const side of ['blue', 'red'] as const) {
    for (const group of missionState.groupPositions?.[side]?.aircraft ?? []) {
      const unit = group.units.find((entry) => entry.name === name)
      if (unit) return unit
    }
  }
  return undefined
}

/**
 * DCS reports a unit as lost when it despawns, which happens when the player leaves the slot after
 * landing. Only a loss without a landing, or a real destruction after it, costs the aircraft.
 */
function wasDestroyed(
  lost: MissionState['lostUnits'][number],
  landed: MissionState['landedUnits'][number] | undefined
) {
  if (!landed) return true
  // state.lua keeps the first event and the last attribution, so check every destruction signal.
  const despawnOnly =
    lost.event === 'unit_lost' &&
    (lost.lossType == null || lost.lossType === 'lost') &&
    !lost.crashed &&
    !lost.pilotEjected &&
    !lost.killerUnitName
  return !despawnOnly && (lost.time ?? 0) >= (landed.time ?? 0)
}

function integrityFrom(life: number | undefined, life0: number | undefined) {
  if (life == null || life0 == null || life0 <= 0) return undefined
  return Math.max(0, Math.min(1, life / life0))
}

/**
 * Applies a flown mission to the career: losses, damage, where each aircraft ended up, stores
 * returned to the inventory, and the money earned. Returns the debrief lines for the player.
 */
export function settleCareerSortie(
  campaign: Campaign,
  missionState: MissionState,
  theatre: Theatre,
  options: { taskCompleted: boolean }
): string[] {
  const career = campaign.career
  const sortie = career?.sortie
  if (!career || !sortie) return []
  const aircraftName = sortie.aircraftName ?? career.preferredAircraft
  const aircraft = getCareerAircraft(aircraftName)
  const time = campaign.time
  const lines: string[] = []
  const memberNames = new Set(sortie.members.map((member) => member.unitName))

  for (const lost of missionState.lostUnits) {
    if (!lost.killerUnitName || !memberNames.has(lost.killerUnitName)) continue
    if (!isEnemyOfPlayer(lost.coalition)) continue
    const reward = getKillReward(aircraft, lost)
    addLedgerEntry(career, reward, `Kill: ${lost.type}`, time)
    lines.push(`+${reward} kill: ${lost.type}`)
  }
  if (options.taskCompleted) {
    const reward = getTaskReward(sortie.task)
    addLedgerEntry(career, reward, `${sortie.task ?? 'Task'} completed`, time)
    lines.push(`+${reward} ${sortie.task ?? 'task'} completed`)
  }

  for (const member of sortie.members) {
    const airframe = career.airframes.find((entry) => entry.id === member.airframeId)
    const pilot = member.pilotId
      ? career.pilots.find((entry) => entry.id === member.pilotId)
      : undefined
    if (!airframe) continue
    const who = pilot
      ? `${pilot.name} (#${airframe.tailNumber})`
      : `Your ${aircraft?.displayName ?? airframe.aircraftName} #${airframe.tailNumber}`
    const lost = missionState.lostUnits.find((unit) => unit.name === member.unitName)
    const landed = missionState.landedUnits.find((unit) => unit.name === member.unitName)
    const atEnd = findMissionUnit(missionState, member.unitName)

    if (lost && wasDestroyed(lost, landed)) {
      airframe.status = 'destroyed'
      airframe.integrity = 0
      if (pilot) pilot.status = lost.pilotEjected ? 'available' : 'dead'
      lines.push(
        pilot
          ? `${who} lost${lost.pilotEjected ? ', pilot ejected' : ', pilot killed'}`
          : `${who} destroyed`
      )
      continue
    }

    const endPosition = landed ?? (atEnd && atEnd.inAir === false ? atEnd : undefined)
    const endIntegrity =
      integrityFrom(landed?.life, landed?.life0) ?? integrityFrom(atEnd?.life, atEnd?.life0)
    if (endIntegrity != null) airframe.integrity = Math.min(airframe.integrity, endIntegrity)

    if (endPosition) {
      const airfield = findFriendlyAirfield(campaign, theatre, endPosition)
      if (!airfield) {
        airframe.status = 'destroyed'
        if (pilot) pilot.status = 'available'
        lines.push(`${who} landed away from a friendly airfield and was lost`)
        continue
      }
      if (airfield !== airframe.location) lines.push(`${who} now based at ${airfield}`)
      airframe.location = airfield
      if (!pilot && landed) {
        addLedgerEntry(career, careerRewards.safeReturn, 'Safe return', time)
        lines.push(`+${careerRewards.safeReturn} safe return`)
      }
    } else if (atEnd?.inAir) {
      lines.push(`${who} was still airborne at mission end and stays based at ${airframe.location}`)
    }

    const remaining = countRemainingStores(aircraft, member.loaded, landed?.ammo ?? atEnd?.ammo)
    if (remaining) {
      for (const [weaponId, count] of Object.entries(remaining)) {
        if (count > 0) addStock(career, aircraftName, weaponId, count)
      }
    } else if (!landed && !atEnd) {
      // The aircraft never showed up in the mission (slot left before spawning): nothing was used.
      for (const [weaponId, count] of Object.entries(member.loaded)) {
        addStock(career, aircraftName, weaponId, count)
      }
    } else {
      lines.push(`${who}: DCS reported no ammunition, unused stores were not returned`)
    }

    airframe.status = 'ready'
    if (pilot) pilot.status = 'available'
    if (airframe.integrity < 1) {
      lines.push(`${who} integrity ${Math.round(airframe.integrity * 100)}%`)
    }
  }

  career.sortie = undefined
  updateCareerReplacement(campaign)
  return lines
}

/**
 * The type command hands out to a broke, grounded player: the type of the aircraft lost last, or
 * the type the career screens open on, or any career aircraft as a last resort.
 */
export function getReplacementAircraft(career: Career): CareerAircraft | undefined {
  const lastLost = [...career.airframes].reverse().find((entry) => entry.status === 'destroyed')
  return (
    (lastLost ? getCareerAircraft(lastLost.aircraftName) : undefined) ??
    getCareerAircraft(career.preferredAircraft) ??
    careerAircraftCatalog[0]
  )
}

/** Arms the 24-hour wait for a free aircraft when the player can no longer fly or buy one. */
export function updateCareerReplacement(campaign: Campaign) {
  const career = campaign.career
  if (!career) return
  const aircraft = getReplacementAircraft(career)
  if (!aircraft) return
  const hasAircraft = career.airframes.some((airframe) => airframe.status !== 'destroyed')
  const canAfford = career.money >= aircraft.prices.usedRange[0]
  if (hasAircraft || canAfford) {
    career.replacementAvailableAt = undefined
    return
  }
  career.replacementAvailableAt ??= new Date(
    campaign.time.getTime() + careerStart.replacementDelayHours * 3_600_000
  )
}

/** The player's airfield farthest from the enemy, where deliveries go when their base fell. */
export function pickRearAirfield(campaign: Campaign, theatre: Theatre): string | undefined {
  const enemyPositions = campaign.coalitions.opponent.objectiveIds
    .map((id) => theatre.objectives.find((objective) => objective.name === id)?.position)
    .filter((position): position is Position => position != null)
  let best: string | undefined
  let bestDistance = Number.NEGATIVE_INFINITY
  for (const name of campaign.coalitions.player.airdromeNames) {
    const details = theatre.airdromeDetails[name]
    if (!details) continue
    const nearestEnemy = Math.min(...enemyPositions.map((p) => distance(p, details)))
    if (nearestEnemy > bestDistance) {
      bestDistance = nearestEnemy
      best = name
    }
  }
  return best ?? campaign.coalitions.player.airdromeNames[0]
}

/**
 * Hands over aircraft whose delivery time has come. One bound for an airfield the enemy took
 * goes to the rear instead. The first aircraft of a type the coalition flies lets the planner use
 * that type too; types from outside the coalition (arcade) stay the player's own.
 */
function deliverAirframes(campaign: Campaign, theatre: Theatre) {
  const career = campaign.career!
  const player = campaign.coalitions.player
  for (const airframe of career.airframes) {
    if (airframe.status !== 'delivering') continue
    if (airframe.arrivesAt && new Date(airframe.arrivesAt) > campaign.time) continue
    const aircraft = getCareerAircraft(airframe.aircraftName)
    if (!player.airdromeNames.includes(airframe.location)) {
      const rear = pickRearAirfield(campaign, theatre)
      if (!rear) continue
      airframe.location = rear
    }
    airframe.status = 'ready'
    airframe.arrivesAt = undefined
    addLedgerEntry(
      career,
      0,
      `${aircraft?.displayName ?? airframe.aircraftName} #${airframe.tailNumber} delivered at ${airframe.location}`,
      campaign.time
    )
    if (aircraft && isFactionCareerAircraft(aircraft, player.aircraftTypes)) {
      addCareerAircraftToTasks(player.aircraftTypes, aircraft)
    }
  }
}

/**
 * Campaign-time upkeep: bought aircraft arrive, aircraft parked at an airfield the enemy took are
 * lost, and a broke, grounded player receives a free used aircraft once the wait is over.
 */
export function updateCareer(campaign: Campaign, theatre: Theatre) {
  const career = campaign.career
  if (!career) return
  holdCareerMissions(campaign)
  releaseBareCareerSlots(campaign)
  deliverAirframes(campaign, theatre)
  const ownedAirfields = new Set(campaign.coalitions.player.airdromeNames)
  for (const airframe of career.airframes) {
    if (airframe.status !== 'ready' || ownedAirfields.has(airframe.location)) continue
    airframe.status = 'destroyed'
    career.ledger.push({
      id: crypto.randomUUID(),
      time: new Date(campaign.time),
      amount: 0,
      reason: `#${airframe.tailNumber} lost when ${airframe.location} fell`
    })
  }

  updateCareerReplacement(campaign)
  if (career.replacementAvailableAt && career.replacementAvailableAt <= campaign.time) {
    const aircraft = getReplacementAircraft(career)
    const location = pickCareerHomeBase(campaign, theatre)
    if (!aircraft || !location) return
    career.airframes.push(createAirframe(career, aircraft, 'used', location, campaign.time))
    career.ledger.push({
      id: crypto.randomUUID(),
      time: new Date(campaign.time),
      amount: 0,
      reason: `Command assigned a used ${aircraft.displayName} at ${location}`
    })
    career.replacementAvailableAt = undefined
  }
}

export type { Pilot as CareerPilot, Airframe as CareerAirframe }

/** Lets the planner generate flights for the career aircraft in every task it has a loadout for. */
export function addCareerAircraftToTasks(
  aircraftTypes: Campaign['coalitions']['player']['aircraftTypes'],
  aircraft: CareerAircraft
) {
  const tasks = new Set(aircraft.loadouts.flatMap((loadout) => loadout.tasks))
  for (const task of tasks) {
    const current = aircraftTypes[task] ?? []
    if (!current.includes(aircraft.aircraftName)) {
      aircraftTypes[task] = [...current, aircraft.aircraftName]
    }
  }
}
