// Which exercise media this app shows, and the hosted version's studio videos (spec F10).
//
// Self-hosted, nothing changes: the shipped dataset's still and animation, as always. The hosted,
// paid version never shows those — they are © Gym visual and may not be used there (NOTICE.md) —
// and shows YMove's studio videos instead, through its own server (api/ymove.js), which keeps the
// key. Where there is no video for an exercise, the exercise shows its text: never an empty box.
//
//   the store app      built with VITE_DATASET_MEDIA=0: never the dataset's media, whatever happens
//   GET /api/config    `exercise_media: { dataset, video }` on an instance that departs from the
//                      default; remembered, so an offline start does not ask for the dataset either
//
// The stills YMove gives with each video are static and may be kept: they stand in while a video
// loads, offline, and in the app's lists. When the server switches videos off they are dropped,
// as YMove's licence asks.
import { api } from './api.js'
import { DEMO } from './demo.js'
import { MOBILE } from './mobile.js'

const ENV = import.meta.env || {}
/** False in a build that must never show the dataset's media (the store app). */
export const DATASET_BUILD = ENV.VITE_DATASET_MEDIA !== '0'

// 'on' | 'off': what the server said last time, so an offline start knows before it can ask.
const DATASET_KEY = 'tiza_dataset'
const STILLS_KEY = 'tiza_video_stills'

const read = k => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* not kept: asked again next time */ } }

/**
 * { dataset, video } for this build and this server's config — null while the config is not known
 * yet. Before the first answer from a server nothing is shown: the hosted version must not ask
 * for a single dataset file on someone's very first visit. After it, the last answer stands in
 * until the next one (an offline start). A build with no server of its own (the demo, an
 * unpaired phone) shows the dataset as it always has.
 */
export function exerciseMediaMode(config, { serverless = DEMO || MOBILE } = {}) {
  if (!DATASET_BUILD) return { dataset: false, video: !!config?.exercise_media?.video }
  const block = config?.exercise_media
  if (block) return { dataset: block.dataset !== false, video: !!block.video }
  if (config) return { dataset: true, video: false }
  const last = read(DATASET_KEY)
  return { dataset: last ? last === 'on' : serverless, video: false }
}

/** Called with every /api/config answer: remembers what holds offline, drops what must go. */
export function rememberExerciseMedia(config) {
  if (!config || typeof config !== 'object') return
  const block = config.exercise_media
  write(DATASET_KEY, block && block.dataset === false ? 'off' : 'on')
  if (!block?.video) dropStills()
}

/* ---------------- stills ---------------- */

// id → { poster (3:4, behind the player), thumb (square, in lists) }
let stills = null
const listeners = new Set()
function loadStills() {
  if (stills) return stills
  try { stills = JSON.parse(read(STILLS_KEY) || '{}') || {} } catch { stills = {} }
  return stills
}
function saveStills(next) {
  stills = next
  write(STILLS_KEY, Object.keys(next).length ? JSON.stringify(next) : null)
  listeners.forEach(f => f())
}
export function stillOf(id) { return loadStills()[id] || null }
export function subscribeStills(f) { listeners.add(f); return () => listeners.delete(f) }
export function dropStills() {
  memo.clear()
  postersAsked = false
  if (read(STILLS_KEY) != null || (stills && Object.keys(stills).length)) saveStills({})
}
function keepStill(id, patch) {
  const all = loadStills()
  const cur = all[id] || {}
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === 'string' && /^https:\/\//.test(v))) }
  if (JSON.stringify(next) !== JSON.stringify(cur)) saveStills({ ...all, [id]: next })
}

let postersAsked = false
/** The square stills of every exercise anybody on this server has opened, for the lists. Once. */
export async function loadPosters() {
  if (postersAsked) return
  postersAsked = true
  try {
    const { posters } = await api('/api/media/posters')
    const all = { ...loadStills() }
    let changed = false
    for (const [id, thumb] of Object.entries(posters || {})) {
      if (/^\d{4}$/.test(id) && typeof thumb === 'string' && /^https:\/\//.test(thumb) && all[id]?.thumb !== thumb) { all[id] = { ...all[id], thumb }; changed = true }
    }
    if (changed) saveStills(all)
  } catch (e) {
    if (e?.status === 410) dropStills()
    else postersAsked = false
  }
}

/* ---------------- videos ---------------- */

// id → { at, value: Promise<{ url, poster } | null> }. A signed URL is good for a day at least;
// asked again after half an hour so a long session does not hold one past its life.
const memo = new Map()
const KEEP_MS = 30 * 60000
const KEEP_NONE_MS = 6 * 3600000
const KEEP_FAILED_MS = 60000

/**
 * { url, poster } of one exercise's studio video — `url` null when only the still can be shown —
 * or null when there is none. Never throws. `refresh`: the last URL failed to load.
 */
export function videoFor(id, { refresh = false, now = Date.now } = {}) {
  const hit = memo.get(id)
  if (hit && !refresh && now() - hit.at < hit.keep) return hit.value
  const entry = { at: now(), keep: KEEP_MS, value: null }
  entry.value = api(`/api/media/video/${encodeURIComponent(id)}${refresh ? '?refresh=1' : ''}`).then(r => {
    keepStill(id, { poster: r.poster })
    const https = v => (typeof v === 'string' && /^https:\/\//.test(v) ? v : null)
    const url = https(r.url), poster = https(r.poster) || stillOf(id)?.poster || null
    return url || poster ? { url, poster } : null
  }, e => {
    if (e?.status === 410) { dropStills(); return null }
    if (e?.status === 404) { entry.keep = KEEP_NONE_MS; return null }
    // Busy, offline, a hiccup: the still if one is kept, and asked again soon.
    entry.keep = KEEP_FAILED_MS
    const poster = stillOf(id)?.poster
    return poster ? { url: null, poster } : null
  })
  memo.set(id, entry)
  return entry.value
}

/** Tests only: forget everything held in memory. */
export function _resetExerciseMedia() { memo.clear(); stills = null; postersAsked = false; listeners.clear() }
