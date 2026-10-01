import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { imgSrc, gifSrc } from '../lib/exercises.js'
import { exerciseMediaMode, videoFor, stillOf, subscribeStills, loadPosters } from '../lib/exercise-media.js'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import CustomMedia, { CustomThumb } from './CustomMedia.jsx'

// An exercise's picture, wherever one shows. A custom exercise goes to CustomMedia.jsx — its own
// photo, GIF, video or link, from the local media store — and never through imgSrc/gifSrc, which
// name files of the shipped dataset (a stray img/gif on a custom exercise, written by a fork, is
// ignored). The split is by component, not by branch, so each side keeps its own hooks in order.
export default function Media(p) {
  return p.ex?.custom ? <CustomMedia {...p} /> : <CatalogueMedia {...p} />
}

// A catalogue exercise: the dataset's animation where this instance shows it, the studio video
// where it serves YMove's instead (lib/exercise-media.js), and nothing at all otherwise — the
// card closes up and the exercise reads from its text.
function CatalogueMedia(p) {
  const mode = useMediaMode()
  if (mode.dataset) return <BuiltinMedia {...p} />
  return mode.video ? <StudioVideo {...p} /> : null
}
function useMediaMode() {
  const config = useStore(s => s.config)
  const signedIn = useStore(s => !!s.user)
  const m = exerciseMediaMode(config)
  // The videos come through the account's own server: a guest has none.
  return { dataset: m.dataset, video: m.video && signedIn }
}
const useStill = id => useSyncExternalStore(subscribeStills, () => stillOf(id))

// Big autoplaying animation; tap toggles to the still frame. `compact` shrinks it (superset cards).
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts (issue #12). Settings can also turn workout media off entirely
// (gifSize 'off') — then nothing renders here and the exercise card closes up, exactly like
// an exercise without media. Any other/legacy value behaves as 'full'.
function BuiltinMedia({ ex, id, compact, minimizable }) {
  const [playing, setPlaying] = useState(true)
  // 'gif' → the animation failed, the still is showing; 'all' → the still failed too. Media is
  // fetched from wherever the build points (a mount, a CDN): a dropped connection, an expired
  // session on a gated instance or a CDN hiccup used to leave the browser's broken-image glyph
  // on a white block. Now the still stands in for the animation, a neutral tile stands in for
  // both, and a tap tries again — no text, so nothing new to translate.
  const [failed, setFailed] = useState(null)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  if (!ex.gif) return null
  if (minimizable && gifSize === 'off') return null
  const mini = minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  const showGif = playing && failed == null
  const onError = () => setFailed(showGif ? 'gif' : 'all')
  const onTap = () => {
    if (failed) { setFailed(null); setPlaying(true); return }
    setPlaying(p => !p)
  }
  return (
    <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '') + (failed === 'all' ? ' broken' : '')} id={id} onClick={onTap}>
      {failed === 'all'
        ? <div className="exmedia-x"><Icon name="dumbbell" /></div>
        : <img decoding="async" draggable={false} src={showGif ? gifSrc(ex) : imgSrc(ex)} alt={exerciseNameFor(ex)} onError={onError} />}
      {minimizable && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {!mini && !failed && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
  )
}

// YMove's studio take, in black and white (index.css .studio), muted and looping like the
// animations it replaces. The still kept from an earlier visit shows at once; the video takes
// over when it arrives. A URL that will not play is asked for once more, then the still stays;
// a still that will not load either leaves nothing — never a broken box.
function StudioVideo({ ex, id, compact, minimizable }) {
  const kept = useStill(ex.id)
  const [v, setV] = useState(undefined)            // undefined: not known yet; null: no video
  const [broken, setBroken] = useState(0)          // 1: the video failed once; 2: the still too
  const [playing, setPlaying] = useState(true)
  const asked = useRef(false)
  const ref = useRef(null)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  useEffect(() => {
    let live = true
    setV(undefined); setBroken(0); asked.current = false
    videoFor(ex.id).then(r => { if (live) setV(r) })
    return () => { live = false }
  }, [ex.id])
  if (minimizable && gifSize === 'off') return null
  const poster = v?.poster || kept?.poster || null
  const url = v?.url && broken === 0 ? v.url : null
  if (v === null || (!url && (!poster || broken === 2))) return null
  const mini = minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  const onVideoError = () => {
    if (asked.current) { setBroken(1); return }
    asked.current = true
    videoFor(ex.id, { refresh: true }).then(r => { if (r?.url && r.url !== v?.url) setV(r); else setBroken(1) })
  }
  const onTap = () => {
    const el = ref.current
    if (!el) return
    if (el.paused) { el.play().catch(() => {}); setPlaying(true) } else { el.pause(); setPlaying(false) }
  }
  return (
    <div className={'exmedia studio' + (compact ? ' compact' : '') + (mini ? ' mini' : '')} id={id} onClick={onTap}>
      {url
        ? <video ref={ref} src={url} poster={poster || undefined} autoPlay muted loop playsInline preload="metadata"
          disablePictureInPicture aria-label={exerciseNameFor(ex)} onError={onVideoError} />
        : <img decoding="async" draggable={false} src={poster} alt={exerciseNameFor(ex)} onError={() => setBroken(2)} />}
      {minimizable && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {!mini && url && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
  )
}

// A still that will not load (offline and never cached, a lapsed session on a gated instance, a
// CDN hiccup) gets the same neutral tile as an exercise without media, instead of the browser's
// broken-image glyph in a list of them (#281). The failure is remembered per image, so a list
// that re-renders does not ask again; a new exercise in the same slot tries its own.
export function Thumb(p) {
  return p.ex?.custom ? <CustomThumb {...p} /> : <CatalogueThumb {...p} />
}
function CatalogueThumb(p) {
  const mode = useMediaMode()
  if (mode.dataset) return <BuiltinThumb {...p} />
  return <StudioThumb {...p} video={mode.video} />
}
// Where the dataset is not shown: the square still of the exercise's studio video when anybody
// on this server has opened it, else the same neutral tile as an exercise without media.
function StudioThumb({ ex, video }) {
  const still = useStill(ex.id)
  const [broken, setBroken] = useState(null)
  useEffect(() => { if (video) loadPosters() }, [video])
  const src = video ? still?.thumb || still?.poster || null : null
  if (!src || broken === src) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  return <img className="thumb studio" loading="lazy" decoding="async" draggable={false} src={src} alt="" onError={() => setBroken(src)} />
}
function BuiltinThumb({ ex }) {
  const src = ex.img ? imgSrc(ex) : null
  const [broken, setBroken] = useState(null)
  if (!src || broken === src) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  return <img className="thumb" loading="lazy" decoding="async" draggable={false} src={src} alt="" onError={() => setBroken(src)} />
}
