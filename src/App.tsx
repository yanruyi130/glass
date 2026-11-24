import { useState, useSyncExternalStore } from 'react'
import { GlassStage, type BackgroundTheme } from './GlassStage'
import { MaterialPanel } from './MaterialPanel'
import { PlayerControls } from './PlayerControls'
import { TurntableDeck } from './TurntableDeck'
import { TURNTABLE } from './turntableLayout'
import { createTurntableMotion } from './turntableMotion'
import { useSoundscape } from './audio'
import { usePreference } from './preferences'
import { DEFAULT_WEATHER, WEATHER_PRESETS, type WeatherId } from './climate'
import { DEFAULT_GAP, DEFAULT_MATERIAL, INITIAL_INK_READING, effectiveMaterial, type InkReading, type LayerId, type Material } from './material'
import { GLASS_SHAPES, type ShapeId } from './shape'

const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
const subscribeMotion = (callback: () => void) => {
  motionPreference.addEventListener('change', callback)
  return () => motionPreference.removeEventListener('change', callback)
}
const getReducedMotion = () => motionPreference.matches
const THEME: BackgroundTheme = 'currents'
const APPEARANCES = Object.keys(GLASS_SHAPES) as ShapeId[]
const FROST_COVERAGE_STORAGE_KEY = 'liquid-glass-lab:frost-coverage'
const WEATHER_OPTIONS = [
  { key: 'sunny', label: '晴天' },
  { key: 'cloudy', label: '阴天' },
  { key: 'rainy', label: '雨天' },
  { key: 'snow', label: '下雪' },
] as const satisfies ReadonlyArray<{ key: WeatherId; label: string }>

function loadFrostCoverage() {
  try {
    const stored = window.localStorage.getItem(FROST_COVERAGE_STORAGE_KEY)
    const value = Number(stored)
    if (stored?.trim() && Number.isInteger(value) && value >= 0 && value <= 60) return value
  } catch {
    // The slider remains available when browser storage is restricted.
  }
  return 20
}

function ToolbarIcon({ name }: { name: 'mark' | 'pause' | 'play' | 'reset' | WeatherId }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'mark' && <><rect x="6.5" y="4.5" width="13.5" height="11" rx="2.75" /><rect x="4" y="8.5" width="13.5" height="11" rx="2.75" /></>}
    {name === 'pause' && <><path d="M9 6v12M15 6v12" /></>}
    {name === 'play' && <path d="m9 6 9 6-9 6Z" />}
    {name === 'reset' && <path d="M4 12a8 8 0 1 1 2.5 5.8M4 6v6h6" />}
    {name === 'sunny' && <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2m0 15v2M2.5 12h2m15 0h2M5.3 5.3l1.4 1.4m10.6 10.6 1.4 1.4m0-13.4-1.4 1.4M6.7 17.3l-1.4 1.4" /></>}
    {name === 'cloudy' && <path d="M7 17.5a3.8 3.8 0 0 1-.4-7.6 5.2 5.2 0 0 1 10 1.2h.8a3.2 3.2 0 1 1 0 6.4Z" />}
    {name === 'rainy' && <><path d="M6.5 14.9a3.2 3.2 0 0 1-.3-6.3 4.9 4.9 0 0 1 9.3.8h1.9a2.8 2.8 0 1 1 0 5.5Z" /><path d="m8.5 17.8-1 2.7m4.9-2.7-1 2.7m4.9-2.7-1 2.7" /></>}
    {name === 'snow' && <path d="M12 3v18m-8-13.5 16 9m-16 0 16-9M9.8 5.2 12 7.4l2.2-2.2m-4.4 13.6 2.2-2.2 2.2 2.2m-9.4-8.3 3-.8-.8-3m12.2 6.8-3 .8.8 3m0-10.6-.8 3 3 .8M7 17.3l.8-3-3-.8" />}
  </svg>
}

export function App() {
  const reducedMotion = useSyncExternalStore(subscribeMotion, getReducedMotion)
  const [shape, setShape] = usePreference('appearance', APPEARANCES, 'rounded-rectangle')
  const [material, setMaterial] = useState(DEFAULT_MATERIAL)
  const [backgroundPlayback, setBackgroundPlayback] = useState<boolean | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<LayerId | null>(null)
  const [gap, setGap] = useState(DEFAULT_GAP)
  const [samples, setSamples] = useState(false)
  const [reset, setReset] = useState(0)
  const [effective, setEffective] = useState(() => effectiveMaterial(DEFAULT_MATERIAL, WEATHER_PRESETS[DEFAULT_WEATHER].glass))
  const [ink, setInk] = useState<InkReading>(INITIAL_INK_READING)
  const [weather, setWeather] = useState<WeatherId>(DEFAULT_WEATHER)
  const [rainAmount, setRainAmount] = useState(1)
  const [slideSpeed, setSlideSpeed] = useState(1)
  const [frostCoverage, setFrostCoverage] = useState(loadFrostCoverage)
  const backgroundPlaying = backgroundPlayback ?? !reducedMotion
  const backgroundAction = backgroundPlaying ? '暂停背景' : '播放背景'
  const soundscape = useSoundscape(weather)
  const [turntableMotion] = useState(() => createTurntableMotion({ rpm: TURNTABLE.record.rpm }))

  function setView(value: boolean) {
    setExpanded(value)
    if (!value) setSelected(null)
  }

  function selectLayer(layer: LayerId | null) {
    setExpanded(true)
    setSelected(layer)
  }

  function changeGap(value: number) {
    setGap(value)
    setExpanded(true)
  }

  function resetAll() {
    setMaterial(DEFAULT_MATERIAL)
    setBackgroundPlayback(null)
    setView(false)
    setGap(DEFAULT_GAP)
    setSamples(false)
    setRainAmount(1)
    setSlideSpeed(1)
    setReset(token => token + 1)
  }

  function changeFrostCoverage(value: number) {
    setFrostCoverage(value)
    try {
      window.localStorage.setItem(FROST_COVERAGE_STORAGE_KEY, String(value))
    } catch {
      // Keep the in-memory setting if storage is unavailable.
    }
  }

  function setParameter(key: keyof Material, value: number) {
    setMaterial(previous => ({ ...previous, [key]: value }))
  }

  return <main>
    <section className="specimen" data-weather={weather} aria-labelledby="lab-title">
      <GlassStage
        theme={THEME} shape={shape} material={material} backgroundPlaying={backgroundPlaying} expanded={expanded} selected={selected}
        gap={gap} samples={samples} reset={reset} reducedMotion={reducedMotion}
        weather={weather} rainAmount={rainAmount} slideSpeed={slideSpeed} frostCoverage={frostCoverage / 100}
        musicBands={soundscape.bands} musicPlaying={soundscape.playing}
        renderPlayer={appearance => appearance === 'turntable'
          ? <TurntableDeck player={soundscape} motion={turntableMotion} reducedMotion={reducedMotion} />
          : <PlayerControls appearance={appearance} player={soundscape} />}
        onSelect={selectLayer} onExpanded={setView} onEffective={setEffective} onInk={setInk}
      />
      <header className="stage-toolbar">
        <div className="lab-brand">
          <span className="lab-mark"><ToolbarIcon name="mark" /></span>
          <div>
            <h1 id="lab-title">液态玻璃实验台</h1>
            <p>LIQUID GLASS LAB</p>
          </div>
        </div>
        <div className="stage-actions">
          <div className="stage-transport">
            <button type="button" className="stage-icon" onClick={() => setBackgroundPlayback(!backgroundPlaying)}
              aria-label={backgroundAction} title={backgroundAction}>
              <ToolbarIcon name={backgroundPlaying ? 'pause' : 'play'} />
            </button>
            <button type="button" className="stage-icon" onClick={resetAll} aria-label="复位全部参数" title="复位全部参数">
              <ToolbarIcon name="reset" />
            </button>
          </div>
          <div className="weather-switch" role="group" aria-label="天气氛围">
            {WEATHER_OPTIONS.map(({ key, label }) => <button key={key} type="button" aria-label={label} title={label}
              aria-pressed={weather === key} onClick={() => setWeather(key)}>
              <ToolbarIcon name={key} />
            </button>)}
          </div>
        </div>
      </header>
      <div className="stage-caption" aria-hidden="true">
        <span><span className="stage-caption-dot" />{expanded ? '六层展开' : '玻璃样本'}</span>
        <span>{expanded ? '按住拖动旋转 · 点击薄片' : '按住拖动旋转 · 双击复位'}</span>
      </div>
    </section>
    <MaterialPanel shape={shape} onShape={setShape} expanded={expanded} selected={selected} gap={gap} material={material} effective={effective} ink={ink}
      rain={weather === 'rainy' ? { amount: rainAmount, slideSpeed, onAmount: setRainAmount, onSlideSpeed: setSlideSpeed } : null}
      frost={weather === 'snow' ? { coverage: frostCoverage, onCoverage: changeFrostCoverage } : null}
      samples={samples} onExpanded={setView} onSelect={selectLayer} onGap={changeGap} onParameter={setParameter} onSamples={setSamples} />
  </main>
}
