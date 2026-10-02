// A record, as an image for stories: 1080 × 1920, the record, the exercise, the Tiza mark and
// tiza.fit — made on a canvas in the app, shared with the system's own share sheet
// (components/PrCard.jsx). No library: the canvas is the browser's and the WebView's.
//
// What goes on it is worked out here, apart from the drawing, so it can be tested: which weight,
// for how many reps, against what it beat.
import { bestWeightFor, bestWeightForEntry } from './history.js'
import { betterWeight } from './exercises.js'
import { isWarmupRow } from './workout-model.js'

export const CARD_W = 1080
export const CARD_H = 1920

/**
 * The record `exId` set in workout `w`. kind 'weight': the heaviest work set and its reps, and
 * the best before this workout (null the first time it was ever logged with a load). kind
 * 'e1rm': the estimated one-rep max the summary reported (`est`), from that set.
 */
export function prCardData(S, w, exId, { kind = 'weight', est = null } = {}) {
  const entry = (w?.entries || []).find(e => e.id === exId)
  if (!entry) return null
  const sets = (entry.sets || []).filter(s => s.done && !isWarmupRow(s) && s.w > 0)
  const top = bestWeightForEntry(entry)
  const set = sets.filter(s => s.w === top).sort((a, b) => (b.r || 0) - (a.r || 0))[0] || sets[0] || null
  const others = { ...S, workouts: (S.workouts || []).filter(x => x !== w && (w.id == null || x.id !== w.id)) }
  const before = bestWeightFor(others, exId) || null
  const weight = kind === 'e1rm' ? Math.round((est || 0) * 10) / 10 : top
  const delta = kind === 'weight' && before ? Math.round(Math.abs(top - before) * 100) / 100 : null
  return {
    exId, kind, weight, unit: S.unit || 'kg',
    reps: set?.r || null,
    from: kind === 'e1rm' && set ? { w: set.w, r: set.r } : null,
    previous: kind === 'weight' ? before : null,
    // An assisted machine's record is less help; the delta is still how far it moved.
    better: kind === 'weight' && before ? betterWeight(exId, before, top) === top : null,
    delta,
    date: w.d || null
  }
}

/** Lines of `text` that fit `max` wide (by `measure`), at most `lines`, the last one cut with "…". */
export function wrapLines(measure, text, max, lines = 3) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const out = []
  let cur = ''
  for (const word of words) {
    const next = cur ? cur + ' ' + word : word
    if (measure(next) <= max || !cur) { cur = next; continue }
    out.push(cur)
    cur = word
  }
  if (cur) out.push(cur)
  if (out.length <= lines) return out
  const kept = out.slice(0, lines)
  let last = kept[lines - 1] + ' ' + out.slice(lines).join(' ')
  while (last.length > 1 && measure(last + '…') > max) last = last.slice(0, -1).trimEnd()
  kept[lines - 1] = last + '…'
  return kept
}

/** The biggest size from `sizes` at which `text` fits `max` wide, for the record's own number. */
export function fitSize(measureAt, text, max, sizes = [300, 260, 220, 190, 160, 130]) {
  return sizes.find(px => measureAt(px, text) <= max) || sizes[sizes.length - 1]
}

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
const ACC = '#FFD60A'

/**
 * Draws the card. `text`: the words, already in the person's language — { eyebrow, name, value,
 * sub, date, site }. `logo`: an image of the app's icon, or null.
 */
export function drawPrCard(ctx, text, logo = null) {
  const W = CARD_W, H = CARD_H, X = 96, INNER = W - 2 * X
  ctx.fillStyle = '#0B0C0F'
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.2, 40, W * 0.85, H * 0.2, W * 1.1)
  glow.addColorStop(0, 'rgba(255, 214, 10, 0.28)')
  glow.addColorStop(1, 'rgba(255, 214, 10, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // The mark, top left.
  let y = 150
  if (logo) {
    ctx.save()
    roundRect(ctx, X, y - 4, 112, 112, 26)
    ctx.clip()
    ctx.drawImage(logo, X, y - 4, 112, 112)
    ctx.restore()
  }
  ctx.fillStyle = '#FFFFFF'
  ctx.textBaseline = 'middle'
  ctx.font = `800 76px ${FONT}`
  ctx.fillText('Tiza', logo ? X + 140 : X, y + 52)

  // The record.
  ctx.textBaseline = 'alphabetic'
  y = 700
  ctx.fillStyle = ACC
  ctx.font = `800 46px ${FONT}`
  spaced(ctx, text.eyebrow.toUpperCase(), X, y, 6)
  y += 40
  ctx.fillStyle = '#FFFFFF'
  ctx.font = `800 88px ${FONT}`
  const nameLines = wrapLines(s => ctx.measureText(s).width, text.name, INNER, 3)
  for (const line of nameLines) { y += 100; ctx.fillText(line, X, y) }
  y += 40
  const px = fitSize((size, s) => { ctx.font = `900 ${size}px ${FONT}`; return ctx.measureText(s).width }, text.value, INNER)
  ctx.font = `900 ${px}px ${FONT}`
  ctx.fillStyle = ACC
  y += Math.round(px * 0.92)
  ctx.fillText(text.value, X - 6, y)
  if (text.sub) {
    ctx.fillStyle = 'rgba(255,255,255,0.78)'
    ctx.font = `600 52px ${FONT}`
    y += 96
    for (const line of wrapLines(s => ctx.measureText(s).width, text.sub, INNER, 2)) { ctx.fillText(line, X, y); y += 66 }
  }
  if (text.date) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.font = `500 44px ${FONT}`
    ctx.fillText(text.date, X, y + 30)
  }

  // tiza.fit, at the foot.
  ctx.fillStyle = 'rgba(255,255,255,0.14)'
  ctx.fillRect(X, H - 250, INNER, 3)
  ctx.fillStyle = '#FFFFFF'
  ctx.font = `800 60px ${FONT}`
  ctx.fillText(text.site, X, H - 150)
}

function spaced(ctx, s, x, y, gap) {
  for (const ch of s) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + gap }
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** The card as a PNG blob. */
export async function renderPrCard(text, logoUrl = null) {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const logo = logoUrl ? await new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = logoUrl
  }) : null
  drawPrCard(canvas.getContext('2d'), text, logo)
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'))
}
