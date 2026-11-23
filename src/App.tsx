import { useState, useSyncExternalStore } from 'react'
import { GlassStage, type BackgroundTheme } from './GlassStage'
import { MaterialPanel } from './MaterialPanel'
import { DEFAULT_GAP, DEFAULT_MATERIAL, INITIAL_READING, effectiveMaterial, type InkReading, type LayerId, type Material, type MaterialMode } from './material'
import type { ShapeId } from './shape'

const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
const subscribeMotion = (callback: () => void) => {
  motionPreference.addEventListener('change', callback)
  return () => motionPreference.removeEventListener('change', callback)
}
const getReducedMotion = () => motionPreference.matches
const SCENE: { theme: BackgroundTheme; shape: ShapeId } = { theme: 'currents', shape: 'rounded-rectangle' }
const MODES = [{ key: 'auto', label: '自动' }, { key: 'light', label: '浅色' }, { key: 'dark', label: '深色' }] as const

function ToolbarIcon({ name }: { name: 'mark' | 'pause' | 'play' | 'reset' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'mark' && <><rect x="6.5" y="4.5" width="13.5" height="11" rx="2.75" /><rect x="4" y="8.5" width="13.5" height="11" rx="2.75" /></>}
    {name === 'pause' && <><path d="M9 6v12M15 6v12" /></>}
    {name === 'play' && <path d="m9 6 9 6-9 6Z" />}
    {name === 'reset' && <path d="M4 12a8 8 0 1 1 2.5 5.8M4 6v6h6" />}
  </svg>
}

export function App() {
  const reducedMotion = useSyncExternalStore(subscribeMotion, getReducedMotion)
  const [material, setMaterial] = useState(DEFAULT_MATERIAL)
  const [mode, setMode] = useState<MaterialMode>('auto')
  const [playback, setPlayback] = useState<boolean | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<LayerId | null>(null)
  const [gap, setGap] = useState(DEFAULT_GAP)
  const [samples, setSamples] = useState(false)
  const [reset, setReset] = useState(0)
  const [effective, setEffective] = useState(() => effectiveMaterial(DEFAULT_MATERIAL, INITIAL_READING, true))
  const [ink, setInk] = useState<InkReading>({ luminance: INITIAL_READING.luminance, lightInk: true })
  const playing = playback ?? !reducedMotion

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
    setMode('auto')
    setPlayback(null)
    setView(false)
    setGap(DEFAULT_GAP)
    setSamples(false)
    setReset(token => token + 1)
  }

  function setParameter(key: keyof Material, value: number) {
    setMaterial(previous => ({ ...previous, [key]: value }))
  }

  return <main>
    <section className="specimen" aria-labelledby="lab-title">
      <GlassStage
        {...SCENE} material={material} mode={mode} playing={playing} expanded={expanded} selected={selected}
        gap={gap} samples={samples} reset={reset} reducedMotion={reducedMotion}
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
          <div className="mode-switch" role="group" aria-label="材质模式">
            {MODES.map(({ key, label }) => <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>)}
          </div>
          <button type="button" className="stage-icon" onClick={() => setPlayback(!playing)}
            aria-label={playing ? '暂停背景' : '播放背景'} title={playing ? '暂停背景' : '播放背景'}>
            <ToolbarIcon name={playing ? 'pause' : 'play'} />
          </button>
          <button type="button" className="stage-icon" onClick={resetAll} aria-label="复位全部参数" title="复位全部参数">
            <ToolbarIcon name="reset" />
          </button>
        </div>
      </header>
      <div className="stage-caption" aria-hidden="true">
        <span><span className="stage-caption-dot" />{expanded ? '六层展开' : '玻璃样本'}</span>
        <span>{expanded ? '拖动整体 · 点击薄片' : '拖动玻璃 · 双击归位'}</span>
      </div>
    </section>
    <MaterialPanel expanded={expanded} selected={selected} gap={gap} material={material} effective={effective} ink={ink}
      samples={samples} onExpanded={setView} onSelect={selectLayer} onGap={changeGap} onParameter={setParameter} onSamples={setSamples} />
  </main>
}
