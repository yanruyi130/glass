import type { FrostClearRegion } from './frostPattern'

const slot = (x: number, y: number, width: number, height: number): FrostClearRegion => ({ x, y, width, height })

/** Mechanism coordinates use a 100-unit-wide viewBox. Control slots are normalized. */
export const TURNTABLE = {
  body: { width: 348, height: 94, corner: 12.5 },
  record: { x: 37.5, y: 39.5, radius: 29, labelRadius: 8.8, rpm: 100 / 3 },
  arm: { x: 83, y: 23, length: 43, parkAngle: 3, grooveAngle: 39 },
  controls: {
    mark: slot(.29, .33, .17, .18),
    trackText: slot(.105, .789, .51, .103),
    library: slot(.655, .792, .102, .104),
    progress: slot(.105, .905, .63, .042),
    transport: slot(.782, .797, .12, .12),
  },
  surfaceClearance: [
    slot(.776, .185, .103, .163),
    slot(.53, .503, .13, .138),
    slot(.752, .615, .112, .151),
    slot(.099, .786, .809, .161),
  ],
} as const

const { x, y, length, parkAngle } = TURNTABLE.arm
const parkRadians = parkAngle * Math.PI / 180
export const parkedTonearmTip = { x: x - length * Math.sin(parkRadians), y: y + length * Math.cos(parkRadians) }
