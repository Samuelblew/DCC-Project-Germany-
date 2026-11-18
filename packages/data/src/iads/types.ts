export type AuthoredIadsKind = 'sam' | 'ewr' | 'hq' | 'aaa' | 'support' | 'airbase'

export type AuthoredIadsUnit = {
  name: string
  type: string
  x: number
  y: number
  heading: number
  category?: string
}

/**
 * One persistent site from an imported template (Sentry Germany, Caucasus 1988). `coalition` is
 * only the authored side; the side that operates it follows the nearest owned objective.
 */
export type AuthoredIadsSite = {
  id: string
  kind: AuthoredIadsKind
  coalition: 'player' | 'opponent'
  objectiveId: string
  x: number
  y: number
  range?: number
  campaignType?: 'Hawk' | 'Roland' | 'SA-2' | 'SA-3' | 'SA-5' | 'SA-6' | 'SA-10-300'
  units: AuthoredIadsUnit[]
}

export type AuthoredIadsNetwork = {
  theatreName: string
  sites: readonly AuthoredIadsSite[]
}

export type AuthoredIadsOwner = {
  x: number
  y: number
  coalition: 'player' | 'opponent'
}
