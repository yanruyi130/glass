import type { WeatherId } from './climate'

export const BUILT_IN_MUSIC = {
  rainy: { id: 'builtin:rainy', title: 'Location', fileName: 'Location.mp3' },
  sunny: { id: 'builtin:sunny', title: 'Our Theme', fileName: 'Our Theme.mp3' },
  cloudy: { id: 'builtin:cloudy', title: 'River Flows in You', fileName: 'River Flows in You.mp3' },
  snow: { id: 'builtin:snow', title: 'Time To Paint You', fileName: 'Time To Paint You.mp3' },
} as const satisfies Record<WeatherId, { id: string; title: string; fileName: string }>

export function builtInMusicUrl(fileName: string) {
  return import.meta.env.BASE_URL + 'music/' + encodeURIComponent(fileName)
}
