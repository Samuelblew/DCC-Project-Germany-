import { describe, expect, test } from 'vitest'

import { tryDcsPositionToLngLat, tryLngLatToDcsPosition } from './dcs-coordinates'

describe('tryDcsPositionToLngLat', () => {
  test('converts positions inside the theatre coordinate grid', () => {
    expect(tryDcsPositionToLngLat('SouthAtlantic', 87_610, 184_267)).toEqual({
      lat: expect.any(Number),
      lng: expect.any(Number)
    })
  })

  test('returns undefined for positions outside the theatre coordinate grid', () => {
    expect(tryDcsPositionToLngLat('SouthAtlantic', 87_402, 206_382)).toBeUndefined()
  })

  test('places Cold War Germany airfields over western Germany', () => {
    expect(tryDcsPositionToLngLat('Cold War Germany', -498_857.6875, -933_510.6875)).toEqual({
      lat: expect.closeTo(49.44, 2),
      lng: expect.closeTo(7.62, 2)
    })
  })
})

describe('tryLngLatToDcsPosition', () => {
  test.each([
    ['Ramstein', -498_857.6875, -933_510.6875],
    ['Leipzig Mockau', -332_672.875, -561_152.8125],
    ['Kiel', 18_619.0859375, -668_838.1875]
  ])('round-trips Cold War Germany map points near %s', (_name, x, y) => {
    const lngLat = tryDcsPositionToLngLat('Cold War Germany', x, y)
    expect(lngLat).toBeDefined()
    const back = tryLngLatToDcsPosition('Cold War Germany', lngLat!.lng, lngLat!.lat)
    expect(back?.x).toBeCloseTo(x, 0)
    expect(back?.y).toBeCloseTo(y, 0)
  })

  test('round-trips library theatres', () => {
    const lngLat = tryDcsPositionToLngLat('Caucasus', -281_000, 647_000)
    expect(lngLat).toBeDefined()
    const back = tryLngLatToDcsPosition('Caucasus', lngLat!.lng, lngLat!.lat)
    expect(Math.abs((back?.x ?? 0) - -281_000)).toBeLessThan(50)
    expect(Math.abs((back?.y ?? 0) - 647_000)).toBeLessThan(50)
  })
})

describe('Caucasus terrain projection', () => {
  // Beacons from Mods/terrains/Caucasus/Beacons.lua: Batumi, and one near Rostov past 46°N.
  const beacons = [
    { x: -356584.8125, z: 618472.4375, lat: 41.601731, lng: 41.612203 },
    { x: 251346.78125, z: 341832.1875, lat: 47.249909, lng: 38.833317 }
  ]

  test.each(['Caucasus', 'Cold War Caucasus'])('%s matches the DCS beacons both ways', (name) => {
    for (const beacon of beacons) {
      const lngLat = tryDcsPositionToLngLat(name, beacon.x, beacon.z)
      expect(lngLat?.lat).toBeCloseTo(beacon.lat, 5)
      expect(lngLat?.lng).toBeCloseTo(beacon.lng, 5)
      const back = tryLngLatToDcsPosition(name, beacon.lng, beacon.lat)
      expect(Math.hypot(back!.x - beacon.x, back!.y - beacon.z)).toBeLessThan(1)
    }
  })
})
