export const cullingRadius = {
  defaultMeters: 10_000,
  minMeters: 5_000,
  maxMeters: 80_000,
  stepMeters: 5_000
}

export function resolveCullingRadiusMeters(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return cullingRadius.defaultMeters
  return Math.min(cullingRadius.maxMeters, Math.max(cullingRadius.minMeters, value))
}

export const aircraftCullingRadius = {
  defaultMeters: 150_000,
  minMeters: 50_000,
  maxMeters: 400_000,
  stepMeters: 25_000
}

export function resolveAircraftCullingRadiusMeters(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return aircraftCullingRadius.defaultMeters
  return Math.min(aircraftCullingRadius.maxMeters, Math.max(aircraftCullingRadius.minMeters, value))
}

/** Third culling band: long-range SAM batteries reach far past the ground corridor. */
export const samCullingRadius = {
  defaultMeters: 150_000,
  minMeters: 50_000,
  maxMeters: 300_000,
  stepMeters: 25_000
}

/** SAMs reaching at least this far use the SAM band; shorter-range air defence stays with ground units. */
export const longRangeSamMinRangeMeters = 20_000

export function resolveSamCullingRadiusMeters(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return samCullingRadius.defaultMeters
  return Math.min(samCullingRadius.maxMeters, Math.max(samCullingRadius.minMeters, value))
}

/**
 * Short-range air defence outside the route band still loads (anti-air units only) when it sits
 * this close to the band, so a battery just past its edge can still engage the player.
 */
export const shortRangeAirDefenseReachMeters = 15_000

/** Multiplier on how many AI air packages each side keeps active. */
export const airActivity = { default: 1, min: 0.5, max: 3, step: 0.25 }

export function resolveAirActivity(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return airActivity.default
  return Math.min(airActivity.max, Math.max(airActivity.min, value))
}

/** Prefix of every supply-convoy DCS group, so mission-state sync can find them. */
export const CONVOY_GROUP_PREFIX = 'DCC-CNV-'

export type ImmersionSettings = {
  civTraffic: 'off' | 'low' | 'medium' | 'high'
  groundCrew: boolean
  baseLife: boolean
  convoys: boolean
  ambientAir: boolean
}

const defaultImmersion: ImmersionSettings = {
  civTraffic: 'low',
  groundCrew: true,
  baseLife: true,
  convoys: true,
  ambientAir: true
}

export function resolveImmersion(value: Partial<ImmersionSettings> | undefined): ImmersionSettings {
  return {
    civTraffic: value?.civTraffic ?? defaultImmersion.civTraffic,
    groundCrew: value?.groundCrew ?? defaultImmersion.groundCrew,
    baseLife: value?.baseLife ?? defaultImmersion.baseLife,
    convoys: value?.convoys ?? defaultImmersion.convoys,
    ambientAir: value?.ambientAir ?? defaultImmersion.ambientAir
  }
}

export const config = {
  packages: {
    'Pinpoint Strike': {
      maxActive: {
        player: 2,
        opponent: 2
      },
      maxDistance: 300_000,
      aircraftsPerGroup: 2
    },
    'Strategic Strike': {
      maxActive: {
        player: 1,
        opponent: 1
      },
      maxDistance: 650_000,
      minAircraftsPerGroup: 1,
      maxAircraftsPerGroup: 4,
      cooldownMinMs: 40 * 60 * 1000,
      cooldownMaxMs: 90 * 60 * 1000
    },
    SEAD: {
      maxActive: {
        player: 2,
        opponent: 2
      },
      maxDistance: 300_000,
      aircraftsPerGroup: 2,
      leadTime: 2 * 60 * 1000 // 2 minutes before strike ToT
    },
    DEAD: {
      maxActive: {
        player: 1,
        opponent: 1
      },
      maxDistance: 300_000,
      aircraftsPerGroup: 2,
      leadTime: 60 * 1000 // 1 minute before strike ToT when escorting a package
    },
    'Antiship Strike': {
      maxActive: {
        player: 1,
        opponent: 1
      },
      maxDistance: 350_000,
      aircraftsPerGroup: 2
    },
    CAS: {
      maxActive: {
        player: 2,
        opponent: 2
      },
      maxDistance: 250_000,
      aircraftsPerGroup: 2
    },
    'Ground Attack': {
      maxActive: {
        player: 2,
        opponent: 2
      },
      maxDistance: 250_000,
      aircraftsPerGroup: 2
    },
    'Air Assault': {
      maxActive: {
        player: 2,
        opponent: 2
      },
      maxDistance: 250_000,
      aircraftsPerGroup: 2
    },
    CAP: {
      maxActive: {
        player: 2,
        opponent: 2
      },
      maxDistance: 200_000,
      aircraftsPerGroup: 2,
      engagementRange: 80_000, // Radar + missile range for A2A engagement
      patrolDuration: 60 * 60 * 1000, // 1 hour patrol time
      escortLeadTime: 8 * 60 * 1000 // on station before strike ToT
    },
    AWACS: {
      maxActive: {
        player: 1,
        opponent: 1
      },
      maxDistance: 400_000,
      aircraftsPerGroup: 1,
      patrolDuration: 4 * 60 * 60 * 1000 // 4 campaign hours on station
    },
    ECM: {
      maxActive: {
        player: 1,
        opponent: 1
      },
      maxDistance: 250_000,
      aircraftsPerGroup: 1,
      patrolDuration: 60 * 60 * 1000
    },
    Intercept: {
      maxActive: {
        player: 1,
        opponent: 1
      },
      maxDistance: 250_000,
      aircraftsPerGroup: 2,
      engagementRange: 80_000
    },
    'Runway Attack': {
      maxActive: {
        player: 1,
        opponent: 1
      },
      maxDistance: 300_000,
      aircraftsPerGroup: 2,
      recoveryMs: 4 * 60 * 60 * 1000 // cratered field stays quiet for 4 campaign hours
    },
    'Fighter Sweep': {
      maxActive: {
        player: 1,
        opponent: 1
      },
      maxDistance: 250_000,
      aircraftsPerGroup: 2,
      conflictSeparation: 25_000,
      engagementZoneRadius: 40_000
    },
    Training: {
      aircraftsPerGroup: 2,
      routeRadius: 35_000
    },
    CSAR: {
      maxActive: {
        player: 2,
        opponent: 2
      },
      maxDistance: 30_000,
      aircraftsPerGroup: 1,
      pilotSurvivalChance: 0.5,
      pilotLifetimeMs: 60 * 60 * 1000,
      pickupRadius: 150
    },
    CASEVAC: {
      maxActive: {
        player: 2,
        opponent: 2
      },
      maxDistance: 80_000,
      aircraftsPerGroup: 1,
      pickupRadius: 150,
      woundedChance: 0.5,
      casualtyLifetimeMs: 120 * 60 * 1000,
      recoveryTimeMs: 24 * 60 * 60 * 1000
    },
    'Troop Extraction': {
      maxActive: {
        player: 1,
        opponent: 1
      },
      maxDistance: 80_000,
      aircraftsPerGroup: 1,
      pickupRadius: 150,
      retryCooldownMs: 30 * 60 * 1000,
      surrenderDelayMs: 120 * 60 * 1000
    },
    Transport: {
      maxActive: {
        player: 3,
        opponent: 3
      },
      maxDistance: 400_000, // 400km strategic range
      tacticalMaxDistance: 80_000, // 80km for CH-47
      c130CargoCapacity: 5000,
      ch47CargoCapacity: 1500,
      emergencyCargoCapacity: 750,
      aircraftsPerGroup: 1
    }
  },
  structureExclusionRange: 40_000,
  structureExclusionRanges: {
    Depot: 60_000,
    'Logistics Hub': 40_000,
    'Factory 2': 35_000,
    Factory: 35_000,
    'Command Center': 60_000,
    Hospital: 80_000,
    Prison: 80_000
  }
}
