import { useId, useLayoutEffect, useRef } from 'react'
import { PlayerControls } from './PlayerControls'
import type { useSoundscape } from './audio'
import { parkedTonearmTip, TURNTABLE } from './turntableLayout'
import type { createTurntableMotion } from './turntableMotion'
import './turntable.css'

type Motion = ReturnType<typeof createTurntableMotion>

interface Props {
  player: ReturnType<typeof useSoundscape>
  reducedMotion: boolean
  motion: Motion
  artworkUrl?: string
}

const { arm, record, body } = TURNTABLE
const grooveRadii = Array.from({ length: 38 }, (_, index) => 10.1 + index * .475)

function TurntableArt({ motion, active, reducedMotion, artworkUrl }: {
  motion: Motion; active: boolean; reducedMotion: boolean; artworkUrl?: string
}) {
  const disc = useRef<SVGGElement>(null)
  const needle = useRef<SVGGElement>(null)
  const shadow = useRef<SVGGElement>(null)
  const uid = useId()
  const paint = (name: string) => 'url(#' + uid + name + ')'

  useLayoutEffect(() => {
    const diskGroup = disc.current
    const armGroup = needle.current
    const shadowGroup = shadow.current
    if (!diskGroup || !armGroup || !shadowGroup) return
    let timer = 0
    let previous = performance.now()

    function draw(now: number) {
      if (!diskGroup || !armGroup || !shadowGroup) return
      const frame = motion.update((now - previous) / 1000, active, reducedMotion)
      previous = now
      const angle = arm.parkAngle + (arm.grooveAngle - arm.parkAngle) * frame.armTravel
      const pose = 'translate(' + arm.x + ' ' + arm.y + ') rotate(' + angle + ')'
      diskGroup.setAttribute('transform', 'rotate(' + frame.recordAngle + ' ' + record.x + ' ' + record.y + ')')
      armGroup.setAttribute('transform', pose + ' scale(1 ' + (1 - .045 * frame.armLift) + ')')
      shadowGroup.setAttribute('transform', 'translate(' + (.38 + .6 * frame.armLift) + ' ' + (.48 + 1.35 * frame.armLift) + ') ' + pose)
      shadowGroup.setAttribute('opacity', String(.26 - .095 * frame.armLift))
      if (frame.moving) timer = requestAnimationFrame(draw)
    }

    draw(previous)
    return () => cancelAnimationFrame(timer)
  }, [motion, active, reducedMotion])

  return <svg className="turntable-art" viewBox={'0 0 100 ' + body.height} aria-hidden="true">
    <defs>
      <linearGradient id={uid + 'record'} x1="16%" y1="0%" x2="80%" y2="95%">
        <stop stopColor="#4f555c" stopOpacity=".65" />
        <stop offset=".48" stopColor="#272a31" stopOpacity=".68" />
        <stop offset="1" stopColor="#36383e" stopOpacity=".77" />
      </linearGradient>
      <linearGradient id={uid + 'arm'} x1="0%" y1="0%" x2="100%" y2="0%">
        <stop stopColor="#687279" />
        <stop offset=".3" stopColor="#eef3f4" />
        <stop offset=".64" stopColor="#bec7ca" />
        <stop offset="1" stopColor="#616c73" />
      </linearGradient>
      <radialGradient id={uid + 'label'} cx=".32" cy=".24" r=".9">
        <stop stopColor="#d9e1e0" stopOpacity=".94" />
        <stop offset="1" stopColor="#869194" stopOpacity=".9" />
      </radialGradient>
      <clipPath id={uid + 'cover'}>
        <circle cx={record.x} cy={record.y} r={record.labelRadius} />
      </clipPath>
    </defs>

    <circle className="turntable-platter-shadow" cx={record.x + .25} cy={record.y + .68} r={record.radius + 1.4} />
    <circle className="turntable-platter-edge" cx={record.x} cy={record.y} r={record.radius + .82} />
    <g ref={disc} className="turntable-disc">
      <circle cx={record.x} cy={record.y} r={record.radius} fill={paint('record')} />
      <g transform={'translate(' + record.x + ' ' + record.y + ')'}>
        {grooveRadii.map((radius, index) => <circle className="turntable-groove" key={radius} r={radius}
          opacity={index % 7 === 0 ? .28 : .08 + (index % 4) * .025} />)}
        <circle className="turntable-lip" r={record.radius - .46} />
        <path className="turntable-disc-glint" d="M-26.6-1.6c6.7-4.6 13.6-6.6 19.6-7.1M11 11.8c4.1 4 8.6 6.4 14.6 7.2" />
      </g>
      <circle cx={record.x} cy={record.y} r={record.labelRadius} fill={paint('label')} />
      {artworkUrl
        ? <image href={artworkUrl} x={record.x - record.labelRadius} y={record.y - record.labelRadius}
            width={2 * record.labelRadius} height={2 * record.labelRadius}
            preserveAspectRatio="xMidYMid slice" clipPath={paint('cover')} />
        : <g className="turntable-badge" transform={'translate(' + record.x + ' ' + record.y + ')'}>
            <circle r="7.8" />
            <path d="M-5.2 1.7c2.1 0 2.8-3.9 4.5-3.9 1.7 0 2.3 3.9 4.3 3.9h1.6M-4.1 3.8c1.3 0 2.8-1.4 4.1-1.4 1.4 0 2.6 1.4 3.8 1.4" />
            <circle cx="3.5" cy="-3.4" r=".62" className="turntable-badge-dot" />
          </g>}
      <circle className="turntable-spindle" cx={record.x} cy={record.y} r=".74" />
    </g>

    <g className="turntable-rest" transform={'translate(' + parkedTonearmTip.x + ' ' + (parkedTonearmTip.y - 5.8) + ') rotate(' + arm.parkAngle + ')'}>
      <rect x="-2.05" y="-2" width="4.1" height="5" rx=".86" />
      <path d="M-1.65-.5h3.3M-1.65 1.7h3.3" />
    </g>
    <circle className="turntable-pivot-shell" cx={arm.x} cy={arm.y} r="5.15" />
    <circle className="turntable-pivot-ring" cx={arm.x} cy={arm.y} r="3.82" />
    <g ref={shadow} className="turntable-arm-shadow">
      <path d="M0 7.5v22q0 3.9-.55 6.2L0 41" />
      <rect x="-1.45" y={arm.length - 4.8} width="2.9" height="5.25" rx=".68" />
    </g>
    <g ref={needle} className="turntable-tonearm">
      <rect className="turntable-counterweight" x="-2.15" y="-9.2" width="4.3" height="5.55" rx="1.02" fill={paint('arm')} />
      <path className="turntable-arm-rim" d="M0-5v34.5q0 3.9-.55 6.2L0 40" />
      <path d="M0-5v34.5q0 3.9-.55 6.2L0 40" stroke={paint('arm')} strokeWidth="1.43" fill="none" />
      <rect className="turntable-headshell" x="-1.52" y={arm.length - 5.15} width="3.04" height="4.65" rx=".61" fill={paint('arm')} />
      <path className="turntable-needle" d={'M0 ' + (arm.length - .5) + 'v.73'} />
    </g>
    <circle className="turntable-pivot-cap" cx={arm.x} cy={arm.y} r="1.98" fill={paint('arm')} />
    <path className="turntable-control-divider" d="M10.5 72.5h79" />
  </svg>
}

export function TurntableDeck({ player, reducedMotion, motion, artworkUrl }: Props) {
  return <div className="turntable-deck">
    <TurntableArt motion={motion} active={player.playing} reducedMotion={reducedMotion} artworkUrl={artworkUrl} />
    <PlayerControls appearance="turntable" player={player} />
  </div>
}
