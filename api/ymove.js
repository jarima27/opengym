/* Exercise videos from YMove (https://ymove.app/exercise-api/docs) — spec F10.

   The hosted, paid version shows YMove's studio videos instead of the shipped dataset's
   animations, which are © Gym visual and may not be used there (NOTICE.md). Only the studio take
   (white background, the primary one), shown in black and white by the app, so every clip looks
   alike and the only colour on screen is the app's own.

   - The key (YMOVE_API_KEY) never leaves this server: the app asks GET /api/media/video/{id} and
     gets back a video URL that YMove has already signed, and a still to show meanwhile.
   - One URL per exercise, shared by everybody, renewed every 24 hours. YMove's signed URLs live 48
     hours, and its monthly cap counts distinct exercises, so asking for the same one again costs
     nothing either way; the cache is about not making every viewer wait on YMove.
   - Our catalogue ids map to YMove's through a table generated from YMove's catalogue in browse
     mode, which spends no quota, and reviewed by hand for the most used lifts
     (scripts/build-ymove-map.mjs → ymove-map.json). An exercise the table leaves out has no
     video, and the app shows its text.
   - YMOVE_VIDEOS=off is the switch: the app stops asking and drops what it kept. It is what the
     licence asks for the day YMove is cancelled.

   Pure but for the clock, the fetch and the file, all three passed in, so the tests can drive it
   against a fake YMove. */
import fs from 'node:fs';

const HOUR = 3600000;
// Renewed after this; YMove signs for 48 h, so a URL handed out at 23:59 still has a day to run.
export const URL_TTL_MS = 24 * HOUR;
// What a signed URL is good for, minus a margin for a clip someone has just started to watch.
const URL_USABLE_MS = 47 * HOUR;
// A video that failed to load may be asked for again with ?refresh=1, at most this often.
const REFRESH_MIN_MS = 10 * 60000;
// The monthly cap reached: YMove answers this exercise without its video until the 30-day window
// rolls on. Asked again a few hours later, not on every view.
const CAPPED_RETRY_MS = 6 * HOUR;
// YMove has no studio video for it (or no longer has the exercise): asked again in a week.
const NONE_RETRY_MS = 7 * 24 * HOUR;
const TIMEOUT_MS = 10000;

const OFF = /^(0|off|false|no)$/i;

/* What this instance does with exercise media.
   video    YMove's studio videos, through the routes below (a key, and the switch not off).
   dataset  the shipped dataset's images and animations. Never on an instance that sells access
            or serves YMove — the paid version — unless DATASET_MEDIA says otherwise; a
            self-hosted instance keeps them exactly as before. */
export function ymoveConfig(env = process.env, { selling = false } = {}) {
  const str = k => String(env[k] || '').trim();
  const key = str('YMOVE_API_KEY');
  const dataset = str('DATASET_MEDIA');
  return {
    key,
    apiBase: (str('YMOVE_API_BASE') || 'https://exercise-api.ymove.app/api/v2').replace(/\/+$/, ''),
    // Configured at all: the routes exist (and answer 410 while switched off).
    on: !!key,
    video: !!key && !OFF.test(str('YMOVE_VIDEOS')),
    dataset: dataset ? !OFF.test(dataset) : !(selling || key),
    // The table of ids. Only ever moved by the tests.
    mapFile: str('YMOVE_MAP_FILE') || new URL('./ymove-map.json', import.meta.url)
  };
}

/** The `exercise_media` block of GET /api/config, or null where nothing differs from before. */
export function exerciseMediaConfig(cfg) {
  return cfg.dataset && !cfg.on ? null : { dataset: cfg.dataset, video: cfg.video };
}

/* The studio take of one YMove exercise: its white-background video, the primary one first.
   A gym-shot video is never used, even as the only one there is. */
export function studioOf(ex) {
  const white = (Array.isArray(ex?.videos) ? ex.videos : []).filter(v => v && v.tag === 'white-background');
  const v = white.find(x => x.isPrimary) || white[0];
  if (!v) return null;
  const th = v.thumbnails || {};
  return {
    url: typeof v.videoUrl === 'string' ? v.videoUrl : null,
    // Static and cacheable (YMove's word): 3:4 behind the player, square in lists.
    poster: th.default || v.thumbnailUrl || null,
    thumb: th.square || th.default || v.thumbnailUrl || null
  };
}

/** ymove-map.json → { ourId: YMove id or slug }; entries reviewed out (null) are left out. */
export function loadMap(file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  const out = {};
  for (const [id, e] of Object.entries(raw?.map || {})) {
    const ym = typeof e === 'string' ? e : e?.ym;
    if (/^\d{4}$/.test(id) && typeof ym === 'string' && ym) out[id] = ym;
  }
  return out;
}

export class YmoveDown extends Error {}

/* The shared cache of signed URLs and stills, persisted so a restart does not ask YMove for
   everything again. `persist(obj)` writes it; `saved` is what it last wrote. */
export function createVideoStore({ cfg, map, saved = null, persist = () => {}, fetchImpl = globalThis.fetch, now = Date.now, log = console }) {
  const entries = new Map(Object.entries(saved?.entries || {}).filter(([id]) => map[id]));
  const inflight = new Map();
  let refused = false;
  const save = () => { try { persist({ v: 1, entries: Object.fromEntries(entries) }); } catch (e) { log.error('ymove: could not save the cache', e.message); } };

  const view = e => ({ url: e.url && now() - e.at < URL_USABLE_MS ? e.url : null, poster: e.poster || null });

  /** Whether answering for `id` now would ask YMove (what a viewer's budget is spent on). */
  function needsFetch(id, { refresh = false } = {}) {
    if (!cfg.video || !map[id]) return false;
    const e = entries.get(id), t = now();
    if (!e) return true;
    if (e.state === 'ok' && e.url && t - e.at < URL_TTL_MS) return refresh && t - (e.tried || e.at) >= REFRESH_MIN_MS;
    return !(e.retryAt && t < e.retryAt);
  }

  async function ask(id) {
    const ym = map[id];
    const t = now();
    const prev = entries.get(id) || null;
    let r;
    try {
      r = await fetchImpl(`${cfg.apiBase}/exercises/${encodeURIComponent(ym)}`, {
        headers: { 'X-API-Key': cfg.key, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (e) { throw new YmoveDown(e.message); }
    if (r.status === 401 || r.status === 403) {
      if (!refused) { refused = true; log.error('ymove: the API refused YMOVE_API_KEY (' + r.status + ')'); }
      throw new YmoveDown('key refused');
    }
    if (r.status === 404) {
      entries.set(id, { state: 'none', retryAt: t + NONE_RETRY_MS, poster: prev?.poster || null, thumb: prev?.thumb || null });
      save();
      return entries.get(id);
    }
    if (!r.ok) throw new YmoveDown('YMove answered ' + r.status);
    let body;
    try { body = await r.json(); } catch { throw new YmoveDown('not JSON'); }
    refused = false;
    const s = studioOf(body?.data);
    if (s?.url) {
      entries.set(id, { state: 'ok', url: s.url, at: t, tried: t, poster: s.poster || prev?.poster || null, thumb: s.thumb || prev?.thumb || null });
    } else if (body?._warning) {
      // Over the monthly cap: keep what still works — a URL that has not run out, the still.
      entries.set(id, { ...(prev || {}), state: 'capped', retryAt: t + CAPPED_RETRY_MS, poster: s?.poster || prev?.poster || null, thumb: s?.thumb || prev?.thumb || null });
    } else {
      entries.set(id, { state: 'none', retryAt: t + NONE_RETRY_MS, poster: prev?.poster || null, thumb: prev?.thumb || null });
    }
    save();
    return entries.get(id);
  }

  /**
   * { url, poster } for one of our exercise ids — `url` null when there is only the still — or
   * null when there is no video for it at all. Throws YmoveDown when YMove cannot be asked and
   * nothing kept can stand in.
   */
  async function get(id, { refresh = false } = {}) {
    if (!cfg.video || !map[id]) return null;
    const cached = entries.get(id);
    if (!needsFetch(id, { refresh })) {
      if (!cached || cached.state === 'none') return null;
      return view(cached);
    }
    if (refresh && cached) { cached.tried = now(); }
    let p = inflight.get(id);
    if (!p) {
      p = ask(id).finally(() => inflight.delete(id));
      inflight.set(id, p);
    }
    try {
      const e = await p;
      return e.state === 'none' ? null : view(e);
    } catch (err) {
      if (!(err instanceof YmoveDown)) throw err;
      // YMove down or busy: what is kept and still good stands in for it.
      if (cached && cached.state !== 'none' && (cached.poster || view(cached).url)) return view(cached);
      throw err;
    }
  }

  /** The stills known so far, square, by our id: free to hand out, they cost YMove nothing. */
  function thumbs() {
    const out = {};
    for (const [id, e] of entries) if (e.thumb) out[id] = e.thumb;
    return out;
  }

  return { get, needsFetch, thumbs, get size() { return entries.size; } };
}
