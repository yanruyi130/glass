import type { FrostClearRegion } from './frostPattern'
import type { ShapeId } from './shape'

export interface PlayerLayout {
  mark: FrostClearRegion
  trackText: FrostClearRegion
  transport: FrostClearRegion
  progress: FrostClearRegion
  volume?: FrostClearRegion
  library?: FrostClearRegion
  reels?: readonly [FrostClearRegion, FrostClearRegion]
  tapePath?: FrostClearRegion
  grille?: FrostClearRegion
  display?: FrostClearRegion
}

const region = (x: number, y: number, width: number, height: number): FrostClearRegion => ({ x, y, width, height })

/** Normalized glass-local coordinates with a top-left origin. */
const layouts: Record<ShapeId, PlayerLayout> = {
  'rounded-rectangle': {
    mark: region(.066, .115, .145, .175),
    trackText: region(.069, .64, .532, .246),
    transport: region(.674, .675, .246, .210),
    progress: region(.082, .907, .836, .042),
    volume: region(.815, .692, .104, .14),
  },
  cassette: {
    mark: region(.073, .115, .045, .10),
    trackText: region(.14, .097, .54, .16),
    library: region(.729, .10, .145, .135),
    reels: [region(.245, .335, .158, .255), region(.597, .335, .158, .255)],
    tapePath: region(.19, .29, .62, .345),
    progress: region(.14, .704, .72, .047),
    transport: region(.44, .793, .12, .158),
  },
  radio: {
    mark: region(.408, .149, .031, .09),
    grille: region(.071, .159, .315, .674),
    display: region(.429, .118, .495, .384),
    trackText: region(.461, .135, .316, .182),
    progress: region(.46, .434, .425, .046),
    library: region(.791, .149, .102, .138),
    transport: region(.477, .620, .112, .234),
    volume: region(.662, .64, .244, .218),
  },
}

export function playerLayout(appearance: ShapeId) {
  return layouts[appearance]
}

export function playerClearRegions(appearance: ShapeId): readonly FrostClearRegion[] {
  const { mark, trackText, transport, progress, volume, library } = playerLayout(appearance)
  return [mark, trackText, transport, progress, volume, library].filter(slot => slot !== undefined)
}
