import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { createBackground, type AudioInput } from './background'
import { createGlassRenderer, type SurfaceEffect } from './glassRenderer'
import { INITIAL_READING, LAYERS, effectiveMaterial, mix, pickMaterialMode, type EffectiveMaterial, type InkReading, type LayerId, type Material, type MaterialMode } from './material'
import { hitLayer, makeProjection, projectedBounds, type Projection } from './projection'
import { GLASS_SHAPES, type Point, type ShapeId } from './shape'
import { createBackgroundSampler, samplePositions } from './sampling'

export const BACKGROUNDS = { currents: createBackground }
export type BackgroundTheme = keyof typeof BACKGROUNDS

interface Props {
  theme: BackgroundTheme
  shape: ShapeId
  material: Material
  mode: MaterialMode
  expanded: boolean
  selected: LayerId | null
  gap: number
  samples: boolean
  playing: boolean
  reducedMotion: boolean
  reset: number
  audio?: AudioInput
  surfaceEffect?: SurfaceEffect
  onSelect: (layer: LayerId) => void
  onExpanded: (expanded: boolean) => void
  onEffective: (effective: EffectiveMaterial) => void
  onInk: (reading: InkReading) => void
}

interface StageSession {
  wake: () => void
  move: (dx: number, dy: number) => void
  recenter: () => void
  hit: (point: Point) => number
}

function easing(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function GlassStage(props: Props) {
  const stage = useRef<HTMLDivElement>(null)
  const backgroundCanvas = useRef<HTMLCanvasElement>(null)
  const materialCanvas = useRef<HTMLCanvasElement>(null)
  const hitRegion = useRef<HTMLDivElement>(null)
  const sampleMarkers = useRef<HTMLDivElement>(null)
  const session = useRef<StageSession>(null)
  const latest = useRef(props)
  const tap = useRef<{ point: Point; time: number }>(null)
  const drag = useRef<{ id: number; start: Point; previous: Point; moved: boolean; layer: number }>(null)
  const [unavailable, setUnavailable] = useState(false)

  const { theme, shape: shapeId } = props

  useLayoutEffect(() => {
    latest.current = props
    session.current?.wake()
  }, [props])

  useLayoutEffect(() => {
    const host = stage.current!
    const canvas = materialCanvas.current!
    const focus = hitRegion.current!
    const markers = sampleMarkers.current!
    const shape = GLASS_SHAPES[shapeId]
    const background = BACKGROUNDS[theme](backgroundCanvas.current!)
    const read = createBackgroundSampler()
    let renderer: ReturnType<typeof createGlassRenderer> = null
    function installRenderer() {
      try {
        renderer = createGlassRenderer(canvas, shape)
      } catch (error) {
        console.error('Liquid glass shader initialization failed', error)
      }
      setUnavailable(!renderer)
    }
    installRenderer()

    let frame = 0, width = 0, height = 0
    let resized = true, dirty = true, time = 0, previousBackground = 0, sampled = -Infinity
    let sampleDirty = true, trailingSample = 0
    let resetToken = latest.current.reset
    let offset: Point = { x: 0, y: 0 }
    let projection: Projection | null = null
    let openness = Number(latest.current.expanded), openFrom = openness, openTo = openness, openAt = 0
    let reading = INITIAL_READING, autoDark: boolean | undefined
    let inkDark: boolean | undefined, inkBrightness = 1
    let currentTone: EffectiveMaterial | null = null, darkness = 1
    let displayed: EffectiveMaterial | null = null
    let displayedInk: InkReading | null = null

    function wake() {
      dirty = true
      if (!frame) frame = requestAnimationFrame(tick)
    }
    function resize() {
      width = host.clientWidth
      height = host.clientHeight
      if (width < 1 || height < 1) return
      const ratio = Math.min(window.devicePixelRatio || 1, 1.6, 1900 / width)
      background.resize(width, height, ratio)
      renderer?.resize(width, height, ratio)
      resized = true
      wake()
    }
    function lost(event: Event) {
      event.preventDefault()
      renderer = null
      setUnavailable(true)
    }
    function restored() {
      installRenderer()
      resize()
    }

    function tick(now: number) {
      frame = 0
      window.clearTimeout(trailingSample)
      if (!width || !height) return
      const state = latest.current
      if (resetToken !== state.reset) {
        resetToken = state.reset
        offset = { x: 0, y: 0 }
        reading = INITIAL_READING
        autoDark = undefined
        inkDark = undefined
        time = 0
        resized = true
      }
      const target = Number(state.expanded)
      if (openTo !== target) {
        openFrom = openness
        openTo = target
        openAt = now
      }
      const progress = state.reducedMotion ? 1 : Math.min(1, (now - openAt) / 850)
      const animating = progress < 1 && openFrom !== openTo
      const previousOpenness = openness
      openness = mix(openFrom, openTo, easing(progress))

      const backdropChanged = resized || (state.playing && (!previousBackground || now - previousBackground >= 31))
      if (backdropChanged) {
        if (state.playing && previousBackground && !resized) time += Math.min(.065, (now - previousBackground) / 1000)
        background.render(time, state.audio)
        previousBackground = now
      } else if (!state.playing) {
        previousBackground = 0
      }

      const placementChanged = dirty || openness !== previousOpenness || !projection
      if (placementChanged || !projection) {
        projection = makeProjection(width, height, shape, openness, state.gap, offset)
        const bounds = projectedBounds(projection)
        focus.style.left = bounds.left + 'px'
        focus.style.top = bounds.top + 'px'
        focus.style.width = (bounds.right - bounds.left) + 'px'
        focus.style.height = (bounds.bottom - bounds.top) + 'px'
      }

      sampleDirty ||= placementChanged || backdropChanged
      if (sampleDirty && (resized || now - sampled >= 78)) {
        const points = samplePositions(projection)
        reading = read(background.canvas, points, width, height)
        const inkReading = read(background.canvas, samplePositions(projection, 'ink'), width, height)
        const hadReading = autoDark !== undefined
        autoDark = pickMaterialMode(reading.luminance, autoDark)
        inkDark = pickMaterialMode(inkReading.luminance, inkDark)
        if (!displayedInk || displayedInk.lightInk !== inkDark || Math.abs(displayedInk.luminance - inkReading.luminance) > .01) {
          displayedInk = { luminance: inkReading.luminance, lightInk: inkDark }
          state.onInk(displayedInk)
        }
        if (!hadReading) currentTone = null
        sampled = now
        sampleDirty = false
      }
      if (state.samples && (dirty || animating || openness !== previousOpenness)) {
        samplePositions(projection).forEach((point, index) => {
          const marker = markers.children[index] as HTMLElement
          marker.style.transform = 'translate(' + point.x + 'px,' + point.y + 'px)'
        })
      }

      const tone = effectiveMaterial(state.material, reading, state.mode === 'auto' ? (autoDark ?? true) : state.mode === 'dark')
      const blend = currentTone && !state.reducedMotion ? .19 : 1
      const previousTone = currentTone
      const previousDarkness = darkness
      const previousInkBrightness = inkBrightness
      currentTone = {
        dark: tone.dark,
        tint: mix(currentTone?.tint ?? tone.tint, tone.tint, blend),
        brightness: mix(currentTone?.brightness ?? tone.brightness, tone.brightness, blend),
        saturation: mix(currentTone?.saturation ?? tone.saturation, tone.saturation, blend),
      }
      darkness = previousTone ? mix(darkness, Number(tone.dark), blend) : Number(tone.dark)
      const targetInk = Number(inkDark ?? tone.dark)
      inkBrightness = previousTone ? mix(inkBrightness, targetInk, blend) : targetInk
      const settling = Math.abs(currentTone.tint - tone.tint) > .001 || Math.abs(currentTone.brightness - tone.brightness) > .001
        || Math.abs(currentTone.saturation - tone.saturation) > .001 || Math.abs(darkness - Number(tone.dark)) > .001
        || Math.abs(inkBrightness - targetInk) > .001
      if (!settling) {
        currentTone = tone
        darkness = Number(tone.dark)
        inkBrightness = targetInk
      }
      if (!displayed || displayed.dark !== tone.dark || Math.abs(displayed.tint - tone.tint) > .003
        || Math.abs(displayed.saturation - tone.saturation) > .007 || Math.abs(displayed.brightness - tone.brightness) > .007) {
        displayed = tone
        state.onEffective(tone)
      }
      const toneChanged = !previousTone || previousTone.tint !== currentTone.tint || previousTone.brightness !== currentTone.brightness
        || previousTone.saturation !== currentTone.saturation || previousDarkness !== darkness || previousInkBrightness !== inkBrightness
      if (placementChanged || backdropChanged || toneChanged) {
        const material = state.audio ? {
          ...state.material,
          edge: state.material.edge * (1 + state.audio.low * .1),
          light: state.material.light * (1 + state.audio.high * .16),
        } : state.material
        renderer?.render(background.canvas, backdropChanged, {
          width, height, projection, material, effective: currentTone,
          darkness, inkBrightness, selected: state.selected, time, surfaceEffect: state.surfaceEffect ?? null,
        })
      }
      dirty = false
      resized = false
      if (state.playing || animating || settling) frame = requestAnimationFrame(tick)
      else if (sampleDirty) trailingSample = window.setTimeout(wake, Math.max(0, sampled + 78 - now))
    }

    session.current = {
      wake,
      move(dx, dy) {
        if (!projection) return
        offset = { x: projection.center.x - width / 2 + dx, y: projection.center.y - height * .5 + dy }
        projection = makeProjection(width, height, shape, openness, latest.current.gap, offset)
        wake()
      },
      recenter() {
        offset = { x: 0, y: 0 }
        wake()
      },
      hit(point) {
        return projection ? hitLayer(projection, shape, point) : -1
      },
    }

    const observer = new ResizeObserver(resize)
    observer.observe(host)
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    resize()
    return () => {
      session.current = null
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.clearTimeout(trailingSample)
      renderer?.destroy()
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
    }
  }, [theme, shapeId])

  function position(event: PointerEvent<HTMLDivElement>) {
    const bounds = stage.current!.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return
    const point = position(event)
    const layer = session.current?.hit(point) ?? -1
    if (layer < 0) return
    drag.current = { id: event.pointerId, start: point, previous: point, moved: false, layer }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current
    if (!active || active.id !== event.pointerId) return
    const point = position(event)
    if (!active.moved && Math.hypot(point.x - active.start.x, point.y - active.start.y) < 4) return
    active.moved = true
    event.currentTarget.dataset.dragging = 'true'
    session.current?.move(point.x - active.previous.x, point.y - active.previous.y)
    active.previous = point
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const active = drag.current
    if (!active || active.id !== event.pointerId) return
    drag.current = null
    delete event.currentTarget.dataset.dragging
    if (cancelled || active.moved) {
      tap.current = null
      return
    }
    const point = position(event)
    const last = tap.current
    const at = performance.now()
    if (last && at - last.time < 350 && Math.hypot(point.x - last.point.x, point.y - last.point.y) < 21) {
      session.current?.recenter()
      tap.current = null
      return
    }
    tap.current = { point, time: at }
    if (props.expanded) props.onSelect(LAYERS[active.layer])
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 24 : 8
    const directions = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const direction = directions[event.key as keyof typeof directions]
    if (direction) session.current?.move(direction[0], direction[1])
    else if (event.key === 'Home') session.current?.recenter()
    else if (event.key === 'Enter' || event.key === ' ') props.onExpanded(!props.expanded)
    else return
    event.preventDefault()
  }

  return <div className="glass-stage" ref={stage} data-view={props.expanded ? 'expanded' : 'assembled'}>
    <canvas className="stage-canvas" ref={backgroundCanvas} aria-hidden="true" />
    <canvas className="stage-canvas" ref={materialCanvas} aria-hidden="true" />
    <div className="sample-markers" ref={sampleMarkers} hidden={!props.samples} aria-hidden="true">
      {Array.from({ length: 15 }, (_, index) => <i key={index} />)}
    </div>
    <div
      className="stage-hit-region" ref={hitRegion} role="group" tabIndex={0}
      aria-label="Liquid Glass，圆角矩形玻璃样本" aria-describedby="stage-keys"
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd}
      onPointerCancel={event => pointerEnd(event, true)} onLostPointerCapture={event => pointerEnd(event, true)}
      onDoubleClick={() => session.current?.recenter()} onKeyDown={keyboard}
    />
    <span className="sr-only" id="stage-keys">方向键移动，Home 归位，回车或空格切换分层。</span>
    {unavailable && <p className="renderer-status" role="status">此浏览器的 WebGL 当前不可用。</p>}
  </div>
}
