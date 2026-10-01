/**
 * Our catalogue → YMove's: which YMove exercise shows each of ours (spec F10). Pure, so the
 * generator (build-ymove-map.mjs) and its test agree on every decision.
 *
 * Conservative on purpose. A wrong video is worse than none: the app shows the exercise's text
 * when there is no video, but a dumbbell press filmed for a barbell press teaches the wrong lift.
 * So an automatic match needs the same movement words and compatible equipment, and has to be
 * clearly the best candidate on both sides; anything less is left out. The most used lifts are
 * decided by hand (REVIEWED in the generator) and those decisions win over everything here.
 */
import { matchExercise } from '../frontend/src/lib/import-csv.js'

// YMove's equipment → the equipment names of our catalogue that it can stand for.
const EQUIPMENT = {
  bodyweight: ['body weight', 'weighted', 'assisted'],
  dumbbell: ['dumbbell'],
  barbell: ['barbell', 'ez barbell', 'olympic barbell', 'trap bar'],
  'trap-bar': ['trap bar'],
  cable: ['cable'],
  machine: ['leverage machine', 'sled machine', 'smith machine'],
  'smith-machine': ['smith machine'],
  kettlebell: ['kettlebell'],
  band: ['band', 'resistance band'],
  'mini-band': ['band', 'resistance band'],
  'stability-ball': ['stability ball'],
  'medicine-ball': ['medicine ball'],
  'bosu': ['bosu ball'],
  'weighted-vest': ['weighted'],
  'dip-bar': ['body weight', 'weighted', 'assisted'],
  rings: ['body weight']
}
const eqKey = s => String(s || '').toLowerCase().trim().replace(/[\s_]+/g, '-')

/** Whether a YMove exercise's equipment can be the equipment of ours. Unknown: not a conflict. */
export function equipmentFits(ourEq, ymEquipment) {
  const allowed = EQUIPMENT[eqKey(ymEquipment)]
  return !allowed || allowed.includes(String(ourEq || '').toLowerCase())
}

const STOP = new Set(['the', 'a', 'an', 'with', 'and', 'on', 'of', 'to', 'v', 'male', 'female'])
// Spellings that differ only in form.
const SAME = { pushup: 'push up', pullup: 'pull up', chinup: 'chin up', situp: 'sit up', 'step-up': 'step up', biceps: 'bicep', triceps: 'tricep', raises: 'raise', curls: 'curl', rows: 'row', presses: 'press', squats: 'squat', lunges: 'lunge', 'skull-crusher': 'skull crusher' }
export function words(s) {
  return String(s || '').toLowerCase()
    // How the clip was shot, not what is lifted: "(back pov)" is a camera angle, not a back squat.
    .replace(/\((?:[a-z ]*\bpov|male|female)\)/g, ' ')
    .replace(/\(.*?\)/g, m => ' ' + m.slice(1, -1) + ' ')
    .split(/[^a-z0-9-]+/).flatMap(w => (SAME[w] || w).split(/[-\s]+/))
    .map(w => SAME[w] || w).filter(w => w && !STOP.has(w) && !/^\d+$/.test(w))
}
// Equipment words go into the comparison too, from whichever side names them.
const EQ_WORDS = { 'body weight': [], weighted: ['weighted'], 'leverage machine': ['machine'], 'sled machine': ['machine'], 'smith machine': ['smith', 'machine'] }
const memo = fn => { const m = new WeakMap(); return o => (m.has(o) ? m.get(o) : m.set(o, fn(o)).get(o)) }
const ourWords = memo(ex => new Set([...words(ex.n), ...(EQ_WORDS[ex.eq] ?? words(ex.eq))]))
const ymWords = memo(ym => new Set([...words(ym.title), ...(eqKey(ym.equipment) === 'bodyweight' ? [] : words(ym.equipment))]))

/** Jaccard similarity of the two word bags, 0..1. */
export function similarity(ex, ym) {
  const a = ourWords(ex), b = ymWords(ym)
  let common = 0
  for (const w of a) if (b.has(w)) common++
  return common / (a.size + b.size - common || 1)
}

// What an automatic match needs: near-identical words, and a clear lead over the runner-up.
export const AUTO_MIN = 0.8
const AUTO_MARGIN = 0.15
const STRICT_MIN = 0.6

/**
 * { ourId: { ym, slug, title, by } } for the whole catalogue.
 * `reviewed`: ourId → YMove slug (or id), or null for "no video" — decided by hand, final.
 */
export function buildMap(catalogue, ymoves, reviewed = {}) {
  const ours = catalogue.filter(e => e && e.id && !e.custom)
  const bySlug = new Map()
  for (const y of ymoves) { bySlug.set(y.slug, y); bySlug.set(y.id, y) }
  const out = {}
  const taken = new Set()

  for (const [id, ref] of Object.entries(reviewed)) {
    if (ref == null) { out[id] = { ym: null, by: 'review' }; continue }
    const y = bySlug.get(ref)
    if (!y) throw new Error(`REVIEWED ${id} → ${ref}: no such YMove exercise`)
    out[id] = { ym: y.id, slug: y.slug, title: y.title, by: 'review' }
    taken.add(y.id)
  }

  // Each YMove exercise, scored against each of ours it could be.
  const pairs = []
  for (const y of ymoves) {
    if (taken.has(y.id)) continue
    const strict = matchExercise(y.title) || matchExercise(`${y.equipment || ''} ${y.title}`)
    for (const ex of ours) {
      if (ex.id in out || !equipmentFits(ex.eq, y.equipment)) continue
      const s = similarity(ex, y)
      // The importer's own matcher counts as a strong hint, not as proof: it allows two extra
      // words, which is how "barbell back squat" once found "barbell full squat (back pov)".
      const hinted = ex.id === strict && s >= STRICT_MIN
      if (s >= AUTO_MIN || hinted) pairs.push({ ex, y, s: hinted ? Math.max(s, AUTO_MIN) : s })
    }
  }
  // Clearly the best on both sides, or nothing.
  const best = (list, key) => {
    const m = new Map()
    for (const p of list) { const k = key(p); (m.get(k) || m.set(k, []).get(k)).push(p) }
    for (const l of m.values()) l.sort((a, b) => b.s - a.s)
    return m
  }
  const forOur = best(pairs, p => p.ex.id), forYm = best(pairs, p => p.y.id)
  const clear = (l, p) => l[0] === p && (l.length === 1 || l[0].s - l[1].s >= AUTO_MARGIN)
  for (const p of pairs) {
    if (out[p.ex.id] || taken.has(p.y.id)) continue
    if (!clear(forOur.get(p.ex.id), p) || !clear(forYm.get(p.y.id), p)) continue
    out[p.ex.id] = { ym: p.y.id, slug: p.y.slug, title: p.y.title, by: 'auto' }
    taken.add(p.y.id)
  }
  return out
}

/** The three closest YMove exercises to one of ours, for the person reviewing the table. */
export function candidates(ex, ymoves, n = 3) {
  return ymoves.map(y => ({ y, s: similarity(ex, y), fits: equipmentFits(ex.eq, y.equipment) }))
    .sort((a, b) => (b.fits - a.fits) || (b.s - a.s)).slice(0, n)
}
