import { useRef, type CSSProperties, type SyntheticEvent } from 'react'
import type { useSoundscape } from './audio'
import { playerLayout } from './playerLayout'
import { GLASS_SHAPES, type ShapeId } from './shape'
import './playerControls.css'

interface Props {
  appearance: ShapeId
  player: ReturnType<typeof useSoundscape>
}

type Slot = { x: number; y: number; width: number; height: number }

const importOption = '__import_local__'

function slotStyle({ x, y, width, height }: Slot): CSSProperties {
  return { left: x * 100 + '%', top: y * 100 + '%', width: width * 100 + '%', height: height * 100 + '%' }
}

function formatTime(value: number) {
  const seconds = Math.floor(Math.max(0, value))
  const minutes = Math.floor(seconds / 60)
  return minutes + ':' + String(seconds % 60).padStart(2, '0')
}

function isolateControl(event: SyntheticEvent) {
  event.stopPropagation()
}

export function PlayerControls({ appearance, player }: Props) {
  const { mark, trackText, transport, progress, volume, library } = playerLayout(appearance)
  const card = appearance === 'rounded-rectangle'
  const fileInput = useRef<HTMLInputElement>(null)
  const selectedTrack = player.current?.source === 'local' ? player.current.id : ''
  const playable = player.current !== null && !player.loading
  const seekable = playable && player.duration > 0
  const time = formatTime(player.progress)
  const duration = formatTime(player.duration)
  const remaining = formatTime(player.duration - player.progress)
  const playLabel = player.playing ? '暂停音乐' : '播放音乐'
  const status = player.playing ? '播放中' : player.progress > 0 ? '已暂停' : '待播放'
  const volumePercent = Math.round(player.musicVolume * 100)

  return <div
    className={'deck-controls deck-controls--' + appearance}
    role="group" aria-label={GLASS_SHAPES[appearance].label + '播放器'}
    onPointerDown={isolateControl} onClick={isolateControl} onDoubleClick={isolateControl}
    onKeyDown={isolateControl} onKeyUp={isolateControl}
  >
    {card && <div className="deck-controls__slot deck-controls__cover" style={slotStyle(mark)} aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path d="M7 25c5-1 6-12 11-12 5 0 7 15 12 15l3-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M7 31c6 0 9-7 13-7s7 5 13 5M8 17h4m16-1h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity=".5" />
      </svg>
    </div>}
    <div className="deck-controls__slot deck-controls__readout" style={slotStyle(trackText)}>
      <span className="deck-controls__track" title={player.current?.title}>
        {player.current?.title ?? (player.loading ? '读取曲库…' : '未选择音频')}
      </span>
      {player.error
        ? <span className="deck-controls__time" title={player.error} role="status">{player.error}</span>
        : player.current && <span className="deck-controls__time" title={status + ' · ' + time + ' / ' + duration}>
          <span>{status}</span>{!card && <span aria-hidden="true">{time} / {duration}</span>}
        </span>}
    </div>
    <div className="deck-controls__slot deck-controls__progress-slot" style={slotStyle(progress)}>
      {card && <div className="deck-controls__elapsed" aria-hidden="true">
        <span>{time}</span><span>{seekable ? '−' + remaining : '0:00'}</span>
      </div>}
      <input className="deck-controls__progress" type="range" aria-label="播放进度"
        aria-valuetext={seekable ? time + ' / ' + duration : undefined}
        disabled={!seekable} min="0" max={seekable ? player.duration : 1} step="any"
        value={seekable ? Math.min(player.progress, player.duration) : 0}
        style={{ '--deck-position': (seekable ? 100 * player.progress / player.duration : 0) + '%' } as CSSProperties}
        onChange={event => player.seek(Number(event.currentTarget.value))} />
    </div>
    <div className="deck-controls__slot deck-controls__key-slot" style={slotStyle(transport)}>
      {card && <button className="deck-controls__skip" type="button" aria-label="上一首" title="上一首"
        disabled={player.loading || !player.previousTrack} onClick={player.previousTrack}>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6.5 6v12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="m17 6-9 6 9 6Z" fill="currentColor" />
        </svg>
      </button>}
      <button className="deck-controls__key" type="button"
        aria-label={playLabel} title={playLabel} disabled={!playable} data-playing={player.playing}
        onClick={player.togglePlay}>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {player.playing
            ? <path d="M9 6.5v11m6-11v11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            : <path d="M9 6.2a.6.6 0 0 0-1 .5v10.6a.6.6 0 0 0 1 .5l8.5-5.3a.6.6 0 0 0 0-1Z" fill="currentColor" />}
        </svg>
      </button>
      {card && <button className="deck-controls__skip" type="button" aria-label="下一首" title="下一首"
        disabled={player.loading || !player.nextTrack} onClick={player.nextTrack}>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M17.5 6v12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="m7 6 9 6-9 6Z" fill="currentColor" />
        </svg>
      </button>}
    </div>
    {volume && appearance === 'radio' && <div className="deck-controls__slot deck-controls__knob-slot" style={slotStyle(volume)}>
      <div className="deck-controls__knob" style={{ '--deck-turn': (player.musicVolume * 270 - 135) + 'deg' } as CSSProperties}>
        <span className="deck-controls__pointer" aria-hidden="true" />
        <input type="range" aria-label="音量" aria-valuetext={volumePercent + '%'} title={'音量 ' + volumePercent + '%'}
          min="0" max="1" step=".01" value={player.musicVolume}
          onChange={event => player.setMusicVolume(Number(event.currentTarget.value))} />
      </div>
    </div>}
    {library && <div className="deck-controls__slot deck-controls__library-slot" style={slotStyle(library)}>
      <div className="deck-controls__library">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.5 7.5V16a2 2 0 0 0 2 2H18a2 2 0 0 0 2-2V8.5a2 2 0 0 0-2-2h-6l-2-2h-4.5a2 2 0 0 0-2 2Z" />
          <path d="M11.75 10v5m-2.5-2.5h5" />
        </svg>
        <select aria-label="选择本地音乐" title="选择或导入本地音乐" value={selectedTrack}
          onChange={event => {
            const value = event.currentTarget.value
            if (value === importOption) {
              event.currentTarget.value = selectedTrack
              fileInput.current?.click()
            } else if (value) {
              player.select(value)
            }
          }}>
          <option value="" disabled>选择本地音乐</option>
          <option value={importOption}>导入本地音频…</option>
          {player.tracks.map(track => <option key={track.id} value={track.id}>{track.title}</option>)}
        </select>
      </div>
      <input ref={fileInput} hidden type="file" aria-label="导入本地音频" multiple
        accept="audio/*,.m4a,.aac,.flac,.opus,.aiff,.aif,.weba,.webm,.mp4"
        onChange={event => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          void player.upload(files)
        }} />
    </div>}
  </div>
}
