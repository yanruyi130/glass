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

const REEL_SCALE = 1.28 * 1.3
const REEL_WIDTH = .158 * REEL_SCALE
const REEL_HEIGHT = .255 * REEL_SCALE
const cassetteReel = (centerX: number) => region(centerX - REEL_WIDTH / 2, .4625 - REEL_HEIGHT / 2, REEL_WIDTH, REEL_HEIGHT)

/** Normalized glass-local coordinates with a top-left origin. */
const layouts: Record<ShapeId, PlayerLayout> = {
  'rounded-rectangle': {
    mark: region(.10, .153, .185, .284),
    trackText: region(.322, .163, .43, .259),
    library: region(.783, .187, .116, .178),
    progress: region(.10, .474, .80, .217),
    transport: region(.19, .719, .62, .18),
  },
  cassette: {
    mark: region(.073, .115, .045, .10),
    trackText: region(.14, .074, .54, .16),
    library: region(.8175, .04, .125, .15),
    reels: [cassetteReel(.324), cassetteReel(.676)],
    tapePath: region(.17, .235, .66, .455),
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
