const SILHOUETTES: Record<string, string> = {
  Barrack: '<path d="M1.2 14.6 V7.1 L8 1.6 l6.8 5.5 v7.5 z"/>',
  Depot: '<path d="M1 14.6 V8.2 h14 v6.4 z"/><path d="M1 8.2 L8 3.4 15 8.2"/>',
  'Ammo Depot': '<path d="M2 6.2 h12 V14 h-12 z"/><path d="M5 6.2 V3 h2 v3.2 M9 6.2 V3 h2 v3.2"/>',
  Factory: '<path d="M1 14.6 V9.2 L4.2 6.4 V9.2 L7.4 6.4 V9.2 L10.2 6.6 V3.4 h4.6 V14.6 z"/>',
  'Factory 2':
    '<path d="M1 14.6 V10.2 L3.4 8 v2.2 L5.8 8 v2.2 L8.2 8 V5.2 h3.2 V2.6 h2.2 V5.2 H15 V14.6 z"/>',
  'Power Plant': '<path d="M3.2 14.6 C2.8 9.2 4.8 3.4 8 2.2 c3.2 1.2 5.2 7 4.8 12.4 z"/>',
  'Fuel Storage':
    '<ellipse cx="8" cy="4.2" rx="4.2" ry="1.7"/><path d="M3.8 4.2 v8.2 c0 1.3 8.4 1.3 8.4 0 V4.2"/>',
  'Oil Platform': '<path d="M2.4 14.6 6.6 2.4 h2.8 l4.2 12.2 h-2.6 L9.6 9.2 H6.4 L4.8 14.6 z"/>',
  'Command Center':
    '<path d="M8 1.4 9.7 6 h4.8 L10.6 8.8 12.2 13.6 8 10.8 3.8 13.6 5.4 8.8 1.5 6 h4.8 z"/>',
  Hospital: '<path d="M6.2 1.4 h3.6 V6 h4.6 v3.6 H9.8 v4.6 H6.2 V9.6 H1.6 V6 h4.6 z"/>',
  'Logistics Hub': '<path d="M1 6.4 h6.2 V14 H1 z M8.8 3.6 H15 V14 H8.8 z"/>',
  Farp: '<circle cx="8" cy="8" r="5.6"/><path d="M6.2 5.2 h1.2 V8 H8.8 V5.2 h1.2 V10.8 H8.8 V8.6 H7.4 v2.2 H6.2 z" fill="#0b0d12" stroke="none"/>',
  Prison: '<path d="M4.2 14.6 V4.2 h7.6 V14.6 z M3.2 4.2 h9.6 V2 h-9.6 z"/>'
}

function silhouette(body: string, fill: string, size: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"><g fill="${fill}" stroke="#0b0d12" stroke-width="0.65" stroke-linejoin="round">${body}</g></svg>`
}

/** Small unit-shaped marker. The town name opens on click, the same way a city does. */
export function structureMarkerSvg(
  structureType: string | undefined,
  coalition: 'player' | 'opponent',
  size = 16
): string | null {
  if (!structureType) return null
  const body = SILHOUETTES[structureType]
  if (!body) return null
  const fill = coalition === 'player' ? '#3d9df0' : '#ff4d4f'
  return silhouette(body, fill, size)
}
