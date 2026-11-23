import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { createBackground, type AudioInput } from './background'
import { WEATHER_PRESETS, blendClimate, type Climate, type WeatherId } from './climate'
import { createGlassRenderer, type SurfaceEffect } from './glassRenderer'
import { INITIAL_INK_READING, LAYERS, clamp, effectiveMaterial, mix, prefersLightInk, type EffectiveMaterial, type InkReading, type LayerId, type Material } from './material'
import { createMusicEnvelope } from './musicEnergy'
import { PITCH_RANGE, YAW_RANGE, hitLayer, makeProjection, projectedBounds, type Projection, type ViewRotation } from './projection'
import { GLASS_SHAPES, type Point, type ShapeId } from './shape'
import { createBackgroundSampler, sampleInkPositions } from './sampling'
import { createRainWaterField } from './rainWaterField'

export const BACKGROUNDS = { currents: createBackground }
export type BackgroundTheme = keyof typeof BACKGROUNDS
const DEFAULT_VIEW: ViewRotation = { pitch: 0, yaw: 0 }
const WEATHER_MS = 2000
const SCENE_FRAME_MS = 1000 / 30

interface Props {
  theme: BackgroundTheme
  shape: ShapeId
  weather: WeatherId
  rainAmount: number
  slideSpeed: number
  material: Material
  frostCoverage: number
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
  rotate: (dx: number, dy: number) => void
  resetOrientation: () => void
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
    const musicEnvelope = createMusicEnvelope()
    const rainWater = createRainWaterField()
    let renderer: ReturnType<typeof createGlassRenderer> | null = null
    let contextLost = false
    function installRenderer() {
      try {
        renderer = createGlassRenderer(canvas, shape)
      } catch (error) {
        console.error('Liquid glass renderer initialization failed', error)
      }
      setUnavailable(!renderer)
    }
    installRenderer()

    let frame = 0, width = 0, height = 0, pixelRatio = 1
    let resized = true, dirty = true, time = 0, phase = 0, cloudTime = 0, previousTick = 0
    let previousBackground = -Infinity, sampled = -Infinity
    let detail = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 ? .76 : 1
    let load = 0
    let weather = latest.current.weather
    let climate = WEATHER_PRESETS[weather]
    let weatherStarted = 0
    let climateFrom: Climate | null = null
    let renderedClimate = climate, renderedTime = time
    let sampleDirty = true, trailingSample = 0
    let resetToken = latest.current.reset
    let view = DEFAULT_VIEW
    let projection: Projection | null = null
    let openness = Number(latest.current.expanded), openFrom = openness, openTo = openness, openAt = 0
    let lightInk: boolean | undefined, inkBrightness = Number(INITIAL_INK_READING.lightInk)
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
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6, 1900 / width)
      background.resize(width, height, pixelRatio * detail)
      if (!contextLost) renderer?.resize(width, height, pixelRatio)
      resized = true
      wake()
    }
    function lost(event: Event) {
      event.preventDefault()
      contextLost = true
      setUnavailable(true)
    }
    function restored() {
      contextLost = false
      if (renderer) setUnavailable(false)
      else installRenderer()
      resize()
    }

    function tick(now: number) {
      frame = 0
      window.clearTimeout(trailingSample)
      if (!width || !height) return
      const state = latest.current
      const elapsed = state.playing && previousTick ? (now - previousTick) / 1000 : 0
      previousTick = state.playing ? now : 0
      const delta = elapsed > .20 ? 0 : Math.min(elapsed, .075)
      if (elapsed > 0 && elapsed < .12 && detail === 1) {
        load = elapsed > .026 ? load + elapsed : Math.max(0, load - elapsed * .6)
        if (load > 1.5) {
          detail = .78
          background.resize(width, height, pixelRatio * detail)
          resized = true
        }
      }

      const lastSpeed = climate.flowSpeed
      const lastCloudSpeed = climate.cloudSpeed
      if (weather !== state.weather) {
        weather = state.weather
        climateFrom = climate
        weatherStarted = now
      }
      if (climateFrom) {
        const amount = state.reducedMotion ? 1 : Math.min(1, (now - weatherStarted) / WEATHER_MS)
        if (amount === 1) {
          climate = WEATHER_PRESETS[weather]
          climateFrom = null
        } else {
          climate = blendClimate(climateFrom, WEATHER_PRESETS[weather], easing(amount))
        }
      }
      time += delta
      phase += delta * (lastSpeed + climate.flowSpeed) / 2
      cloudTime += delta * (lastCloudSpeed + climate.cloudSpeed) / 2
      const audio = musicEnvelope(delta, state.audio)

      if (resetToken !== state.reset) {
        resetToken = state.reset
        view = DEFAULT_VIEW
        lightInk = undefined
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

      const backdropChanged = resized || ((state.playing || climate !== renderedClimate) && now - previousBackground >= SCENE_FRAME_MS - 1)
      if (backdropChanged) {
        background.render({ time, phase, cloudTime, climate, audio, detail })
        renderedClimate = climate
        renderedTime = time
        previousBackground = now
      }

      const projectionChanged = dirty || openness !== previousOpenness || !projection
      if (projectionChanged || !projection) {
        projection = makeProjection(width, height, shape, openness, state.gap, view)
        const bounds = projectedBounds(projection)
        focus.style.left = bounds.left + 'px'
        focus.style.top = bounds.top + 'px'
        focus.style.width = (bounds.right - bounds.left) + 'px'
        focus.style.height = (bounds.bottom - bounds.top) + 'px'
      }

      const tone = effectiveMaterial(state.material, renderedClimate.glass)
      sampleDirty ||= projectionChanged || backdropChanged
      if (sampleDirty && (resized || now - sampled >= 78)) {
        const [r, g, b] = renderedClimate.glass.tintColor
        const tintLuminance = .2126 * r + .7152 * g + .0722 * b
        const source = read(background.canvas, sampleInkPositions(projection), width, height)
        const luminance = mix(clamp(source * tone.brightness), tintLuminance, tone.tint)
        const firstReading = lightInk === undefined
        lightInk = prefersLightInk(luminance, lightInk)
        if (firstReading) inkBrightness = Number(lightInk)
        if (!displayedInk || displayedInk.lightInk !== lightInk || Math.abs(displayedInk.luminance - luminance) > .01) {
          displayedInk = { luminance, lightInk }
          state.onInk(displayedInk)
        }
        sampled = now
        sampleDirty = false
      }
      if (state.samples && projectionChanged) {
        sampleInkPositions(projection).forEach((point, index) => {
          const marker = markers.children[index] as HTMLElement
          marker.style.transform = 'translate(' + point.x + 'px,' + point.y + 'px)'
        })
      }

      const previousInkBrightness = inkBrightness
      const targetInk = Number(lightInk ?? INITIAL_INK_READING.lightInk)
      inkBrightness = state.reducedMotion ? targetInk : mix(inkBrightness, targetInk, .19)
      const settling = Math.abs(inkBrightness - targetInk) > .001
      if (!settling) inkBrightness = targetInk
      if (!displayed || Math.abs(displayed.tint - tone.tint) > .003
        || Math.abs(displayed.saturation - tone.saturation) > .007 || Math.abs(displayed.brightness - tone.brightness) > .007
        || Math.abs(displayed.blur - tone.blur) > .009 || Math.abs(displayed.shadow - tone.shadow) > .003) {
        displayed = tone
        state.onEffective(tone)
      }
      const inkChanged = previousInkBrightness !== inkBrightness
      if (!contextLost && (projectionChanged || backdropChanged || inkChanged)) {
        const rainField = renderedClimate.surfaceRain > .002 && state.rainAmount > 0
          ? rainWater.sample(projection.geometry, renderedTime, state.rainAmount, state.slideSpeed)
          : null
        renderer?.render(background.canvas, backdropChanged, {
          width, height, projection, material: state.material, effective: tone,
          frostCoverage: state.frostCoverage, inkBrightness, selected: state.selected, time: renderedTime, surfaceEffect: state.surfaceEffect ?? null,
          climate: renderedClimate, rainAmount: state.rainAmount, rainField,
        })
      }
      dirty = false
      resized = false
      if (state.playing || animating || settling || climateFrom || climate !== renderedClimate) frame = requestAnimationFrame(tick)
      else if (sampleDirty) trailingSample = window.setTimeout(wake, Math.max(0, sampled + 78 - now))
    }

    session.current = {
      wake,
      rotate(dx, dy) {
        view = {
          pitch: clamp(view.pitch + dy * .01, -PITCH_RANGE, PITCH_RANGE),
          yaw: clamp(view.yaw + dx * .01, -YAW_RANGE, YAW_RANGE),
        }
        wake()
      },
      resetOrientation() {
        view = DEFAULT_VIEW
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
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
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
    session.current?.rotate(point.x - active.previous.x, active.previous.y - point.y)
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
      session.current?.resetOrientation()
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
    if (direction) session.current?.rotate(direction[0], direction[1])
    else if (event.key === 'Home') session.current?.resetOrientation()
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
      onDoubleClick={() => session.current?.resetOrientation()} onKeyDown={keyboard}
    />
    <span className="sr-only" id="stage-keys">按住并拖动可旋转观察。方向键旋转，Home 恢复默认视角，回车或空格切换分层。</span>
    {unavailable && <p className="renderer-status" role="status">玻璃预览需要可用的 WebGL 2。</p>}
  </div>
}
