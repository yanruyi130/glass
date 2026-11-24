import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { createBackground } from './background'
import { WEATHER_PRESETS, blendClimate, type Climate, type WeatherId } from './climate'
import { createGlassRenderer, type SurfaceEffect } from './glassRenderer'
import { INITIAL_INK_READING, LAYERS, clamp, effectiveMaterial, mix, prefersLightInk, type EffectiveMaterial, type InkReading, type LayerId, type Material } from './material'
import { PITCH_RANGE, YAW_RANGE, hitLayer, inkPlaneTransform, makeProjection, projectedBounds, type Projection, type ViewRotation } from './projection'
import { GLASS_SHAPES, type Point, type ShapeId } from './shape'
import { createBackgroundSampler, sampleInkPositions } from './sampling'
import { createRainWaterField } from './rainWaterField'

export const BACKGROUNDS = { currents: createBackground }
export type BackgroundTheme = keyof typeof BACKGROUNDS
const DEFAULT_VIEW: ViewRotation = { pitch: 0, yaw: 0 }
const WEATHER_MS = 2000
const SHAPE_FADE_MS = 145
const SCENE_FRAME_MS = 1000 / 30
const MAX_BACKGROUND_STEP = .25
const REDUCED_MOTION_RATE = .42

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
  backgroundPlaying: boolean
  reducedMotion: boolean
  reset: number
  musicPlaying?: boolean
  renderPlayer?: (appearance: ShapeId) => ReactNode
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
  const playerPlane = useRef<HTMLDivElement>(null)
  const hitRegion = useRef<HTMLDivElement>(null)
  const sampleMarkers = useRef<HTMLDivElement>(null)
  const session = useRef<StageSession>(null)
  const latest = useRef(props)
  const tap = useRef<{ point: Point; time: number }>(null)
  const drag = useRef<{ id: number; start: Point; previous: Point; moved: boolean; layer: number }>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [displayedShape, setDisplayedShape] = useState(props.shape)

  const { theme } = props

  useLayoutEffect(() => {
    latest.current = props
    session.current?.wake()
  }, [props])

  useLayoutEffect(() => {
    const host = stage.current!
    const canvas = materialCanvas.current!
    const player = playerPlane.current!
    const focus = hitRegion.current!
    const markers = sampleMarkers.current!
    let shapeId = latest.current.shape
    let shape = GLASS_SHAPES[shapeId]
    let opacity = 1, fadeFrom = 1, fadeTo = 1
    let fadeAt: number | null = 0
    let reelAngle = 0, reelSpeed = 0, reelTick = 0, renderedReel = 0, reelFrame = -Infinity
    const background = BACKGROUNDS[theme](backgroundCanvas.current!)
    const read = createBackgroundSampler()
    const rainWater = createRainWaterField()
    let renderer: ReturnType<typeof createGlassRenderer> | null = null
    let contextLost = false
    function installRenderer() {
      try {
        renderer = createGlassRenderer(canvas)
      } catch (error) {
        console.error('Liquid glass renderer initialization failed', error)
      }
      setUnavailable(!renderer)
    }
    installRenderer()

    let frame = 0, width = 0, height = 0, pixelRatio = 1
    let resized = true, dirty = true, time = 0, cloudTime = 0, cloudDriftTime = 0
    let previousBackgroundTick: number | null = null
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
      if (!frame && !document.hidden) frame = requestAnimationFrame(tick)
    }
    function visibilityChanged() {
      previousBackgroundTick = null
      reelTick = 0
      if (!document.hidden) {
        wake()
        return
      }
      cancelAnimationFrame(frame)
      frame = 0
      window.clearTimeout(trailingSample)
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
      if (document.hidden || !width || !height) return
      const state = latest.current
      const fadeTarget = state.shape === shapeId ? 1 : 0
      if (fadeTo !== fadeTarget) {
        fadeFrom = opacity
        fadeTo = fadeTarget
        fadeAt = now
      }
      fadeAt ??= now
      const fadeProgress = clamp((now - fadeAt) / SHAPE_FADE_MS)
      const fade = fadeProgress * fadeProgress * (3 - 2 * fadeProgress)
      opacity = state.reducedMotion ? fadeTo : mix(fadeFrom, fadeTo, fade)
      if (opacity === 0 && state.shape !== shapeId) {
        shapeId = state.shape
        shape = GLASS_SHAPES[shapeId]
        setDisplayedShape(shapeId)
        fadeFrom = 0
        fadeTo = 1
        // Start fading in on the frame after the new mask and weather textures are ready.
        fadeAt = null
        sampled = -Infinity
        dirty = true
        focus.removeAttribute('data-on-shape')
        tap.current = null
        if (state.reducedMotion) opacity = 1
      }
      canvas.style.opacity = opacity === 1 ? '' : String(opacity)
      const shapeAnimating = opacity !== fadeTo
      const reelElapsed = reelTick ? Math.min(.06, Math.max(0, (now - reelTick) / 1000)) : 0
      reelTick = now
      const reelTarget = !state.reducedMotion && shapeId === 'cassette' && state.musicPlaying ? .62 : 0
      if (state.reducedMotion) reelSpeed = 0
      else reelSpeed += (reelTarget - reelSpeed) * -Math.expm1(-reelElapsed / .19)
      if (!reelTarget && reelSpeed < .012) reelSpeed = 0
      reelAngle = (reelAngle + reelSpeed * reelElapsed) % (Math.PI * 2)
      const reelChanged = shapeId === 'cassette' && Math.abs(reelAngle - renderedReel) > .014 && now - reelFrame >= SCENE_FRAME_MS - 1
      const elapsed = state.backgroundPlaying && previousBackgroundTick !== null
        ? Math.max(0, (now - previousBackgroundTick) / 1000)
        : 0
      previousBackgroundTick = state.backgroundPlaying ? now : null
      // Keep advancing on slow visible frames, while bounding any one visual step.
      const backgroundStep = Math.min(elapsed, MAX_BACKGROUND_STEP)
      const sceneStep = backgroundStep * (state.reducedMotion ? REDUCED_MOTION_RATE : 1)
      if (backgroundStep > 0 && detail === 1) {
        load = elapsed > .026 ? load + backgroundStep : Math.max(0, load - backgroundStep * .6)
        if (load > 1.5) {
          detail = .78
          background.resize(width, height, pixelRatio * detail)
          resized = true
        }
      }

      const lastCloudSpeed = climate.cloudSpeed
      const lastCloudDriftSpeed = lastCloudSpeed * climate.cloudDrift
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
      time += sceneStep
      cloudTime += sceneStep * (lastCloudSpeed + climate.cloudSpeed) / 2
      cloudDriftTime += sceneStep * (lastCloudDriftSpeed + climate.cloudSpeed * climate.cloudDrift) / 2

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

      const backdropChanged = resized || ((state.backgroundPlaying || climate !== renderedClimate) && now - previousBackground >= SCENE_FRAME_MS - 1)
      if (backdropChanged) {
        background.render({ time, cloudTime, cloudDriftTime, climate, detail })
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
        const { geometry } = projection
        player.style.width = geometry.width + 'px'
        player.style.height = geometry.height + 'px'
        player.style.transform = inkPlaneTransform(projection)
      }

      const tone = effectiveMaterial(state.material, renderedClimate.glass)
      sampleDirty ||= projectionChanged || backdropChanged
      if (sampleDirty && (resized || now - sampled >= 78)) {
        const [r, g, b] = renderedClimate.glass.tintColor
        const tintLuminance = .2126 * r + .7152 * g + .0722 * b
        const source = read(background.canvas, sampleInkPositions(projection, shape.id), width, height)
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
        sampleInkPositions(projection, shape.id).forEach((point, index) => {
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
      const contentWeight = state.selected && state.selected !== 'ink' ? 1 - .64 * openness : 1
      player.style.opacity = String(opacity * contentWeight)
      player.dataset.ink = inkBrightness >= .53 ? 'light' : 'dark'
      if (!contextLost && (projectionChanged || backdropChanged || inkChanged || reelChanged)) {
        const rainField = renderedClimate.surfaceRain > .002 && state.rainAmount > 0
          ? rainWater.sample(shape, projection.geometry, renderedTime, state.rainAmount, state.slideSpeed)
          : null
        renderer?.render(background.canvas, backdropChanged, {
          width, height, projection, material: state.material, effective: tone,
          frostCoverage: state.frostCoverage, inkBrightness, selected: state.selected, time: renderedTime, surfaceEffect: state.surfaceEffect ?? null,
          climate: renderedClimate, rainAmount: state.rainAmount, rainField, reelAngle,
        })
      }
      if (reelChanged) {
        renderedReel = reelAngle
        reelFrame = now
      }
      dirty = false
      resized = false
      if (state.backgroundPlaying || animating || shapeAnimating || reelTarget || reelSpeed || settling || climateFrom || climate !== renderedClimate) frame = requestAnimationFrame(tick)
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
        return projection ? hitLayer(projection, point) : -1
      },
    }

    const observer = new ResizeObserver(resize)
    observer.observe(host)
    document.addEventListener('visibilitychange', visibilityChanged)
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    resize()
    return () => {
      session.current = null
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.clearTimeout(trailingSample)
      renderer?.destroy()
      background.destroy()
      document.removeEventListener('visibilitychange', visibilityChanged)
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
    }
  }, [theme])

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
    const point = position(event)
    if (!active) {
      if (event.pointerType === 'mouse') {
        const overShape = (session.current?.hit(point) ?? -1) >= 0
        event.currentTarget.toggleAttribute('data-on-shape', overShape)
      }
      return
    }
    if (active.id !== event.pointerId) return
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

  return <div className="glass-stage" ref={stage} data-shape={props.shape} data-view={props.expanded ? 'expanded' : 'assembled'}>
    <canvas className="stage-canvas" ref={backgroundCanvas} aria-hidden="true" />
    <canvas className="stage-canvas" ref={materialCanvas} aria-hidden="true" />
    <div className="sample-markers" ref={sampleMarkers} hidden={!props.samples} aria-hidden="true">
      {Array.from({ length: 15 }, (_, index) => <i key={index} />)}
    </div>
    <div
      className="stage-hit-region" ref={hitRegion} role="group" tabIndex={0}
      aria-label={'Liquid Glass，' + GLASS_SHAPES[props.shape].label + '玻璃样本'} aria-describedby="stage-keys"
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd}
      onPointerCancel={event => pointerEnd(event, true)} onLostPointerCapture={event => pointerEnd(event, true)}
      onPointerLeave={event => event.currentTarget.removeAttribute('data-on-shape')} onKeyDown={keyboard}
    />
    <div className="stage-player-plane" ref={playerPlane}>
      {props.renderPlayer?.(displayedShape)}
    </div>
    <span className="sr-only" id="stage-keys">按住并拖动可旋转观察。方向键旋转，Home 恢复默认视角，回车或空格切换分层。</span>
    {unavailable && <p className="renderer-status" role="status">玻璃预览需要可用的 WebGL 2。</p>}
  </div>
}
