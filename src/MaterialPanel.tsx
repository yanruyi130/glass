import { AmbienceControls, type AmbienceControlsProps } from './AmbienceControls'
import { GLASS_SHAPES, type ShapeId } from './shape'
import type { EffectiveMaterial, InkReading, LayerId, Material } from './material'
import { parkedTonearmTip, TURNTABLE } from './turntableLayout'
import './inspector.css'

type ParameterKey = keyof Material
type Control = {
  key: ParameterKey
  label: string
  min: number
  max: number
  step: number
  format: (value: number, effective: EffectiveMaterial) => string
}

const percentage = (value: number) => Math.round(value * 100) + '%'
const pixels = (value: number) => value + ' px'

const tintControl: Control = {
  key: 'tint',
  label: '染色浓度',
  min: 0,
  max: 2,
  step: .01,
  format: (_, effective) => percentage(effective.tint),
}

const layers: {
  id: LayerId
  name: string
  translation: string
  description: string
  controls: Control[]
}[] = [
  {
    id: 'shadow',
    name: 'Shadow',
    translation: '投影',
    description: '透明薄片投下柔和的阴影，表现玻璃与背景的距离。',
    controls: [
      { key: 'shadow', label: '阴影强度', min: 0, max: 1.5, step: .01, format: (_, effective) => percentage(effective.shadow) },
    ],
  },
  {
    id: 'blur',
    name: 'Blur & light',
    translation: '模糊与提亮',
    description: '保留背景色块与曲线，以轻微模糊、饱和度和亮度调整形成透射层。',
    controls: [
      { key: 'blur', label: '模糊半径', min: 0, max: 6, step: .25, format: (_, effective) => pixels(Number(effective.blur.toFixed(2))) },
      { key: 'saturation', label: '饱和度', min: .45, max: 1.45, step: .01, format: (_, effective) => percentage(effective.saturation) },
      { key: 'brightness', label: '亮度', min: .5, max: 1.45, step: .01, format: (_, effective) => percentage(effective.brightness) },
    ],
  },
  {
    id: 'rim',
    name: 'Rim lens',
    translation: '边缘折射',
    description: '曲线与色彩在轮廓边缘压缩、偏移并产生细微色散，位移向中央衰减。',
    controls: [
      { key: 'rimWidth', label: '折射边宽', min: 12, max: 68, step: 1, format: pixels },
      { key: 'edge', label: '位移倍率', min: 0, max: 1.8, step: .05, format: (value) => value.toFixed(2) + '×' },
      { key: 'power', label: '衰减指数', min: 1, max: 4, step: .1, format: (value) => value.toFixed(1) },
      { key: 'dispersion', label: '色散强度', min: 0, max: .3, step: .01, format: percentage },
    ],
  },
  {
    id: 'tint',
    name: 'Tint',
    translation: '染色',
    description: '薄膜随天气微调玻璃色调，底下的曲线依然可见。',
    controls: [tintControl],
  },
  {
    id: 'light',
    name: 'Rim light',
    translation: '边缘光',
    description: '沿左上边缘描出亮侧，并在内侧过渡到柔和的倒角光。',
    controls: [
      { key: 'light', label: '高光强度', min: 0, max: 1.5, step: .01, format: percentage },
    ],
  },
  {
    id: 'ink',
    name: 'Ink',
    translation: '文字与图标',
    description: '文字与线性图标浮在玻璃表面，随采样亮度切换明暗来保持对比。',
    controls: [],
  },
]

type PanelProps = {
  ambience: AmbienceControlsProps
  shape: ShapeId
  onShape: (shape: ShapeId) => void
  expanded: boolean
  selected: LayerId | null
  gap: number
  material: Material
  effective: EffectiveMaterial
  ink: InkReading
  samples: boolean
  rain: { amount: number; slideSpeed: number; onAmount: (value: number) => void; onSlideSpeed: (value: number) => void } | null
  frost: { coverage: number; onCoverage: (value: number) => void } | null
  onExpanded: (expanded: boolean) => void
  onSelect: (layer: LayerId | null) => void
  onGap: (gap: number) => void
  onParameter: (key: ParameterKey, value: number) => void
  onSamples: (visible: boolean) => void
}

function RangeControl({ label, display, value, min, max, step, onChange }: {
  label: string
  display: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label className="inspector-range">
      <span className="inspector-range__label">
        <span>{label}</span>
        <output aria-hidden="true">{display}</output>
      </span>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={display}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
    </label>
  )
}

export function MaterialPanel({
  ambience, shape, onShape, expanded, selected, gap, material, effective, ink, samples, rain, frost,
  onExpanded, onSelect, onGap, onParameter, onSamples,
}: PanelProps) {
  const current = layers.find((layer) => layer.id === selected)
  const visibleControls = current?.controls ?? [tintControl]

  return (
    <section className="inspector" aria-labelledby="material-inspector-title">
      <div className="inspector__inner">
        <header className="inspector__header">
          <h2 id="material-inspector-title">材质解析</h2>
          <div className="inspector__toolbar">
            <div className="inspector__segments" role="group" aria-label="层展示方式">
              <button type="button" aria-pressed={!expanded} onClick={() => onExpanded(false)}>合拢</button>
              <button type="button" aria-pressed={expanded} onClick={() => onExpanded(true)}>分层</button>
            </div>
            <RangeControl
              label="层间距"
              display={pixels(gap)}
              value={gap}
              min={20}
              max={56}
              step={1}
              onChange={onGap}
            />
          </div>
        </header>

        <div className="inspector__shapes" role="group" aria-label="玻璃外观">
          <span className="inspector__shapes-label" aria-hidden="true">外观</span>
          <div className="inspector__shape-options">
            {Object.values(GLASS_SHAPES).map(option => (
              <button className="inspector-shape" key={option.id} type="button" aria-label={option.label} aria-pressed={option.id === shape}
                onClick={() => onShape(option.id)}>
                <svg viewBox={option.preview.viewBox} aria-hidden="true">
                  <path d={option.preview.path} vectorEffect="non-scaling-stroke" />
                  {option.id === 'cassette' && <path d="M20 31a12 12 0 1 0 24 0a12 12 0 1 0 -24 0M56 31a12 12 0 1 0 24 0a12 12 0 1 0 -24 0" vectorEffect="non-scaling-stroke" />}
                  {option.id === 'turntable' && <g className="inspector-shape__mechanism">
                    <circle cx={TURNTABLE.record.x} cy={TURNTABLE.record.y} r={TURNTABLE.record.radius} vectorEffect="non-scaling-stroke" />
                    <circle cx={TURNTABLE.arm.x} cy={TURNTABLE.arm.y} r="4" vectorEffect="non-scaling-stroke" />
                    <path d={`M${TURNTABLE.arm.x} ${TURNTABLE.arm.y + 4}L${parkedTonearmTip.x} ${parkedTonearmTip.y}M16 77h68`}
                      vectorEffect="non-scaling-stroke" />
                  </g>}
                  {option.id === 'radio' && <path d="M14 15h18m-18 8h18m-18 8h18m12-15h23m-23 14h21m10-7a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" vectorEffect="non-scaling-stroke" />}
                </svg>
                <span>{option.id === 'cassette' ? '磁带' : option.id === 'radio' ? '收音机' : option.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="inspector__body">
          <div className="inspector__navigation">
            <ul className="inspector__layers" aria-label="玻璃材质层">
              {layers.map((layer, index) => (
                <li key={layer.id}>
                  <button
                    type="button"
                    className="inspector-layer"
                    aria-pressed={selected === layer.id}
                    aria-controls="material-inspector-detail"
                    onClick={() => onSelect(layer.id)}
                  >
                    <span className="inspector-layer__number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    <span className="inspector-layer__name">{layer.name}</span>
                    <span className="inspector-layer__translation">{layer.translation}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button className="inspector__view-all" type="button" onClick={() => onSelect(null)}>查看全部层</button>
          </div>

          <div className="inspector__detail" id="material-inspector-detail">
            <div className="inspector__detail-heading" aria-live="polite">
              <h3>
                {current?.name ?? (expanded ? '全部材质层' : '复合玻璃')}
                {current && <span>{current.translation}</span>}
              </h3>
              <p>{current?.description ?? (expanded
                ? '选择薄片或层名称，查看它在玻璃中的作用。'
                : '调整染色浓度，或展开玻璃查看各层如何构成它。')}</p>
            </div>
            {visibleControls.length > 0 && (
              <div className="inspector__parameters">
                {visibleControls.map((control) => (
                  <RangeControl
                    key={control.key}
                    label={control.label}
                    display={control.format(material[control.key], effective)}
                    value={material[control.key]}
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    onChange={(value) => onParameter(control.key, value)}
                  />
                ))}
              </div>
            )}
            {current?.id === 'ink' && <dl className="inspector__ink-readings">
              <div><dt>文字下方亮度</dt><dd>{percentage(ink.luminance)}</dd></div>
              <div><dt>当前墨色</dt><dd>{ink.lightInk ? '浅色' : '深色'}</dd></div>
            </dl>}
            {rain && <div className="inspector__parameters inspector__surface-weather" role="group" aria-label="表面雨滴">
              <RangeControl
                label="雨量" display={rain.amount.toFixed(2) + '×'} value={rain.amount}
                min={0} max={2} step={.05} onChange={rain.onAmount}
              />
              <RangeControl
                label="滑落速度" display={rain.slideSpeed.toFixed(2) + '×'} value={rain.slideSpeed}
                min={.25} max={2} step={.05} onChange={rain.onSlideSpeed}
              />
            </div>}
            {frost && <div className="inspector__parameters inspector__surface-weather" role="group" aria-label="玻璃表面霜与冰花">
              <RangeControl
                label="霜与冰花覆盖面积" display={frost.coverage + '%'} value={frost.coverage}
                min={0} max={60} step={1} onChange={frost.onCoverage}
              />
            </div>}
            <AmbienceControls {...ambience} />
            <label className="inspector__sampling">
              <input type="checkbox" role="switch" checked={samples} onChange={(event) => onSamples(event.currentTarget.checked)} />
              <span className="inspector__switch" aria-hidden="true" />
              <span>显示采样点</span>
            </label>
          </div>
        </div>
      </div>
    </section>
  )
}
