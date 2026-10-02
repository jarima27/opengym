import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor, exerciseNameClass, dateLocale } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { EXIDX } from '../lib/exercises.js'
import { SITE_HOST } from '../lib/brand.js'
import { prCardData, renderPrCard } from '../lib/pr-card.js'
import { shareImage } from '../lib/share.js'
import { track } from '../lib/track.js'
import { Button } from './ui.jsx'

// A record, shared as an image for stories (lib/pr-card.js): opened from the finished workout's
// "New PR" lines, shown first, then handed to the system's share sheet.
export function openPrCard({ w, exId, kind = 'weight', est = null }) {
  useUI.getState().openSheet(close => <PrCardSheet w={w} exId={exId} kind={kind} est={est} close={close} />)
}

// The exercise's name as the app shows it — without the English one in brackets, which a card
// for stories has no room for — and capitalised the way CSS does it in the app, which a canvas
// cannot.
const nameOf = ex => {
  let n = ex ? exerciseNameFor(ex) : ''
  if (ex?.n && n.endsWith(` (${ex.n})`)) n = n.slice(0, -(ex.n.length + 3))
  return exerciseNameClass(ex) === 'capitalize' ? n.replace(/(^|\s|\()(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : n
}

/** The card's words, in the person's language. */
export function prCardText(d) {
  const unit = d.unit
  const kg = v => `${fmtNum(v)} ${unit}`
  const parts = []
  if (d.kind === 'e1rm') {
    if (d.from) parts.push(t('from {0} × {1}', kg(d.from.w), d.from.r))
  } else {
    if (d.reps) parts.push(t(d.reps === 1 ? '1 rep' : '{0} reps', d.reps))
    if (d.previous) parts.push(t('before: {0}', kg(d.previous)) + (d.delta ? ` (${d.better === false ? '−' : '+'}${fmtNum(d.delta)})` : ''))
    else parts.push(t('First time logged'))
  }
  return {
    eyebrow: d.kind === 'e1rm' ? t('Estimated 1RM record') : t('New record'),
    name: nameOf(EXIDX[d.exId]) || d.exId,
    value: kg(d.weight),
    sub: parts.join(' · '),
    date: d.date ? new Date(d.date + 'T12:00:00').toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' }) : '',
    site: SITE_HOST
  }
}

function PrCardSheet({ w, exId, kind, est, close }) {
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const [blob, setBlob] = useState(null)
  const [url, setUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const d = prCardData(S, w, exId, { kind, est })
    if (!d) return
    let gone = false, made = null
    renderPrCard(prCardText(d), import.meta.env.BASE_URL + 'icon-512.png')
      .then(b => { if (gone) return; made = URL.createObjectURL(b); setBlob(b); setUrl(made) })
      .catch(() => toast(t('Could not make the image.')))
    return () => { gone = true; if (made) URL.revokeObjectURL(made) }
  }, [])
  const share = async () => {
    if (!blob || busy) return
    setBusy(true)
    const how = await shareImage(blob, 'tiza-record.png', { title: t('New record'), text: SITE_HOST })
    setBusy(false)
    if (how === 'downloaded') toast(t('Image saved'))
    if (how !== 'cancelled') track('pr_card_shared', { kind, how })
  }
  return <div style={{ textAlign: 'center' }}>
    <h3 style={{ marginTop: 0 }}>{t('Share your record')}</h3>
    <div className="pr-card-preview">{url ? <img src={url} alt={t('New record')} /> : <div className="pr-card-wait" />}</div>
    <Button variant="primary" icon="share" disabled={!blob || busy} onClick={share}>{t('Share')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </div>
}
