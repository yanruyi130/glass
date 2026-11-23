import type { FrostClearRegion } from './frostPattern'

/** Normalized glass-local coordinates with a top-left origin. */
export const PLAYER_LAYOUT = {
  mark: { x: .066, y: .115, width: .145, height: .175 },
  trackText: { x: .069, y: .64, width: .532, height: .246 },
  transport: { x: .674, y: .675, width: .246, height: .210 },
  progress: { x: .082, y: .907, width: .836, height: .042 },
} satisfies Record<string, FrostClearRegion>

export const PLAYER_CLEAR_REGIONS: readonly FrostClearRegion[] = Object.values(PLAYER_LAYOUT)
