// F11 — the moment a finished workout is for: what the next session asks of each lift. "Squat:
// next time 62.5 kg (+2.5)" is worked out by the same engine that will build that session
// (lib/progression.js nextPrescription), on the state with this workout already in it, so the
// number promised here is the number on the bar next time.
import { nextPrescription } from './progression.js'
import { entryRoutineId, modeOf, isBw } from './history.js'
import { isWarmupRow } from './workout-model.js'

const round1 = v => Math.round(v * 10) / 10

/**
 * One line per lift of `w` that belongs to a routine still in the plan: `{ id, kind, weight,
 * delta }` for a loaded lift, `{ id, kind, reps, delta }` for bodyweight work that climbs reps.
 * `delta` compares with the heaviest set done today (or its most reps). Lifts going up come
 * first, then the rest in the order trained; at most `max`.
 */
export function nextTimeLines(S, w, max = 4) {
  const out = []
  for (const e of w?.entries || []) {
    const work = (e.sets || []).filter(s => s.done && !isWarmupRow(s))
    if (!work.length) continue
    const rid = entryRoutineId(w, e)
    const routine = rid ? (S.routines || []).find(r => r.id === rid) : null
    const cfg = routine?.ex?.find(x => x.id === e.id)
    if (!cfg || modeOf(cfg) !== 'reps' || routine.excludeFromProgression || e.noProg) continue
    const p = nextPrescription(S, cfg, routine)
    if (!p || p.kind === 'off') continue
    const heaviest = Math.max(0, ...work.map(s => s.w || 0))
    if (p.weight > 0) {
      out.push({ id: e.id, kind: p.kind, weight: p.weight, delta: round1(p.weight - heaviest) })
    } else if (isBw({ ...cfg, id: e.id }) && p.reps > 0) {
      const most = Math.max(0, ...work.map(s => s.r || 0))
      out.push({ id: e.id, kind: p.kind, reps: p.reps, delta: p.reps - most })
    }
  }
  const up = out.filter(l => l.delta > 0)
  return [...up, ...out.filter(l => !(l.delta > 0))].slice(0, max)
}
