export interface TurntableFrame {
  recordAngle: number
  armTravel: number
  armLift: number
  moving: boolean
}

interface Pose { travel: number; lift: number }
interface ArmStep { from: Pose; to: Pose; duration: number; elapsed: number }

const PARKED: Pose = { travel: 0, lift: 0 }
const LOWERED: Pose = { travel: 1, lift: 0 }
const ease = (fraction: number) => fraction * fraction * (3 - 2 * fraction)
const mix = (from: number, to: number, fraction: number) => from + (to - from) * fraction

/**
 * Angles are in degrees and time is in seconds. The record keeps its angle
 * when stopped. The arm can travel only while its needle is lifted.
 */
export function createTurntableMotion({ rpm = 100 / 3 }: { rpm?: number } = {}) {
  const fullSpeed = (Number.isFinite(rpm) ? Math.max(0, rpm) : 100 / 3) * 6
  let wanted: boolean | undefined
  let pose = PARKED
  let steps: ArmStep[] = []
  let speed = 0
  let recordAngle = 0

  function plan(active: boolean) {
    steps = []
    const target = active ? LOWERED : PARKED
    let from = pose

    function append(to: Pose, duration: number) {
      if (from.travel === to.travel && from.lift === to.lift) return
      steps.push({ from, to, duration, elapsed: 0 })
      from = to
    }

    if (active && pose.travel === 0 && pose.lift === 0 && speed === 0) {
      steps.push({ from, to: from, duration: .12, elapsed: 0 })
    }
    if (pose.travel !== target.travel) {
      append({ travel: pose.travel, lift: 1 }, .14 + .12 * (1 - pose.lift))
      append({ travel: target.travel, lift: 1 }, .19 + .35 * Math.abs(target.travel - pose.travel))
    }
    append(target, .14 + .13 * from.lift)
  }

  function advanceArm(delta: number) {
    let remaining = delta
    while (steps.length && remaining > 0) {
      const step = steps[0]
      const elapsed = Math.min(remaining, step.duration - step.elapsed)
      step.elapsed += elapsed
      remaining -= elapsed
      if (step.elapsed >= step.duration) {
        pose = step.to
        steps.shift()
      } else {
        const progress = ease(step.elapsed / step.duration)
        pose = { travel: mix(step.from.travel, step.to.travel, progress), lift: mix(step.from.lift, step.to.lift, progress) }
      }
    }
    return remaining
  }

  function rampRecord(target: number, delta: number, duration: number) {
    const acceleration = fullSpeed / duration
    const rampTime = acceleration ? Math.min(delta, Math.abs(target - speed) / acceleration) : 0
    const next = speed + Math.sign(target - speed) * acceleration * rampTime
    recordAngle = (recordAngle + (speed + next) * .5 * rampTime + next * (delta - rampTime)) % 360
    speed = Math.abs(target - next) < 1e-7 ? target : next
  }

  return {
    update(deltaSeconds: number, active: boolean, reducedMotion = false): TurntableFrame {
      if (reducedMotion) {
        pose = active ? LOWERED : PARKED
        steps = []
        speed = 0
        wanted = undefined
      } else {
        if (wanted !== active) {
          plan(active)
          wanted = active
        }
        // Bound the step after an inactive tab or a suspended device.
        const delta = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(.06, deltaSeconds)) : 0
        const parkedTime = advanceArm(delta)
        if (active) rampRecord(fullSpeed, delta, .72)
        else {
          recordAngle = (recordAngle + speed * (delta - parkedTime)) % 360
          rampRecord(0, parkedTime, .57)
        }
      }
      return { recordAngle, armTravel: pose.travel, armLift: pose.lift, moving: steps.length > 0 || speed > 0 || (active && !reducedMotion && fullSpeed > 0) }
    },
  }
}
