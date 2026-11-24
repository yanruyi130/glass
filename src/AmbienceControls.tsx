import { useId } from 'react'
import './ambienceControls.css'

export interface AmbienceControlsProps {
  enabled: boolean
  volume: number
  fireplace: boolean
  showFireplace: boolean
  status: 'off' | 'waiting' | 'playing' | 'error'
  onEnabledChange: (value: boolean) => void
  onVolumeChange: (value: number) => void
  onFireplaceChange: (value: boolean) => void
}

const statusText: Record<AmbienceControlsProps['status'], string> = {
  off: '已关闭',
  waiting: '等待播放 · 播放音乐或重新开启',
  playing: '正在播放',
  error: '播放失败 · 可重新开启重试',
}

export function AmbienceControls({
  enabled, volume, fireplace, showFireplace, status,
  onEnabledChange, onVolumeChange, onFireplaceChange,
}: AmbienceControlsProps) {
  const statusId = useId()
  const volumeLabel = Math.round(volume * 100) + '%'
  const message = status === 'playing' && volume === 0 ? '已静音' : statusText[status]

  return (
    <div className="ambience-controls" role="group" aria-label="天气氛围音设置">
      <div className="ambience-controls__main">
        <label className="inspector__sampling ambience-controls__switch">
          <input type="checkbox" role="switch" checked={enabled} aria-describedby={statusId}
            onChange={event => onEnabledChange(event.currentTarget.checked)} />
          <span className="inspector__switch" aria-hidden="true" />
          <span>天气氛围音</span>
        </label>
        <span className="ambience-controls__status" id={statusId} role="status">{message}</span>
      </div>
      <label className="inspector-range">
        <span className="inspector-range__label">
          <span>氛围音音量</span>
          <output aria-hidden="true">{volumeLabel}</output>
        </span>
        <input type="range" min={0} max={1} step={.01} value={volume}
          aria-label="氛围音音量" aria-valuetext={volumeLabel}
          onChange={event => onVolumeChange(event.currentTarget.valueAsNumber)} />
      </label>
      {showFireplace && (
        <label className="inspector__sampling ambience-controls__switch">
          <input type="checkbox" role="switch" checked={fireplace}
            onChange={event => onFireplaceChange(event.currentTarget.checked)} />
          <span className="inspector__switch" aria-hidden="true" />
          <span>壁炉声</span>
        </label>
      )}
    </div>
  )
}
