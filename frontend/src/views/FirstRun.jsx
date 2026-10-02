// F11 — the first run, guided to a first finished workout. Whoever opens the app for the first
// time is never left with a tool and no idea what to do today: six questions, one per screen and
// a tap each; the history from another app if there is one; a plan made from the answers (the
// Coach's free first plan where the Coach is there, a starter plan chosen by rule otherwise, with
// the reason in one sentence); starting weights without guessing (or a calibration session);
// reminders asked for with their reason; and then today's workout, or the day of the next one.
//
// Shown once, after signing up (or choosing to use the phone without an account): the welcome
// flag (lib/welcome.js) sends Home here until it is done. Its answers ride in sessionStorage, so
// a reload in the middle picks up where it was.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, exerciseNameFor, exerciseNameClass, dateLocale } from '../lib/i18n.js'
import { DAYN, todayISO } from '../lib/format.js'
import { EXIDX } from '../lib/exercises.js'
import {
  GOALS, EXPERIENCE, PLACES, LENGTHS, DAY_COUNTS, DEFAULT_DAYS, trainingDays, buildFirstPlan,
  recommendPlan, mainLifts, startingWeight, coachProfile, firstRunState, shiftWeekPast, postponeWeek
} from '../lib/first-run.js'
import { clearWelcome, markTrialOffer } from '../lib/welcome.js'
import { track } from '../lib/track.js'
import { importFromApp, importFromHevy, beginWorkout, PLAN_COPY, namedStarter } from '../sheets.jsx'
import { emptyCoach, coachAvailable, hasConsent, appendChat, CONSENT_VERSION } from '../lib/coach.js'
import { requestPlan } from '../lib/coach-api.js'
import { useCoachAccess, useFreePlan } from '../components/useCoachAccess.js'
import { canAsk, turnOnReminders } from '../components/NotifyOffer.jsx'
import { declineOffer } from '../lib/notify.js'
import { effectiveRoutineIds, nextTrainingDay, bestWeightFor } from '../lib/history.js'
import { weightIncrement } from '../lib/progression.js'
import { markUnknownLifts } from '../lib/calibration.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import Icon from '../components/Icon.jsx'
import { Button, TextArea, NumberField } from '../components/ui.jsx'
import { Choice, Consent } from './CoachIntake.jsx'
import '../coach.css'

const QUESTIONS = ['goal', 'experience', 'days', 'place', 'length', 'limits']
const SAVED = 'tiza_first_run'
const readSaved = () => { try { return JSON.parse(sessionStorage.getItem(SAVED) || 'null') } catch { return null } }
const save = v => { try { sessionStorage.setItem(SAVED, JSON.stringify(v)) } catch { /* private mode */ } }
const forget = () => { try { sessionStorage.removeItem(SAVED) } catch { /* nothing kept */ } }
// The weekday as a sentence says it ("on Thursday", "el jueves"): the browser's own word, not the
// capitalised label of the week strip.
const dayName = iso => new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long' })

export default function FirstRun() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const update = useStore(s => s.update)
  const access = useCoachAccess()
  const freePlan = useFreePlan()
  const kept = useMemo(readSaved, [])
  const [step, setStep] = useState(kept?.step || 'goal')
  const [a, setA] = useState(() => ({ goal: null, experience: null, count: 3, days: DEFAULT_DAYS[3], place: null, sessionMin: null, limits: '', ...(kept?.answers || {}) }))
  const [history, setHistory] = useState(kept?.history || [])
  useEffect(() => { save({ step, answers: a, history }) }, [step, a, history])
  // The first run starts the first week: its hints and its checklist read this.
  useEffect(() => { if (!useStore.getState().S.firstRun) update(s => { s.firstRun = firstRunState(Date.now()) }) }, [])

  const go = next => { setHistory(h => [...h, step]); setStep(next) }
  const back = () => {
    if (!history.length) return
    setStep(history[history.length - 1]); setHistory(h => h.slice(0, -1))
  }
  const answer = (key, value, label = value) => {
    setA(v => ({ ...v, [key === 'length' ? 'sessionMin' : key]: value }))
    track('onboarding_step', { step: key, answer: String(label) })
    go(QUESTIONS[QUESTIONS.indexOf(key) + 1] || 'import')
  }

  const qi = QUESTIONS.indexOf(step)
  return <div className="narrow ob alone">
    <div className="ob-top">
      {history.length ? <button className="iconbtn" onClick={back} aria-label={t('Back')}><Icon name="chevronLeft" /></button> : <span style={{ width: 36 }} />}
      {qi >= 0 && <div className="ob-progress" aria-label={t('{0} of {1}', qi + 1, QUESTIONS.length)}>
        <span className="ob-bar"><i style={{ width: `${((qi + 1) / QUESTIONS.length) * 100}%` }} /></span>
        <span className="ob-count">{t('{0} of {1}', qi + 1, QUESTIONS.length)}</span>
      </div>}
      {step === 'limits' ? <button className="ob-skip" onClick={() => { setA(v => ({ ...v, limits: '' })); go('import') }}>{t('Skip')}</button> : <span style={{ width: 36 }} />}
    </div>
    <div className="ob-body">
      {step === 'goal' && <Question eyebrow={t('Your goal')} title={t('What are you training for?')}>
        {GOALS.map(g => <Choice key={g} on={a.goal === g} icon={GOAL_ICON[g]} title={goalText(g)} onClick={() => answer('goal', g)} />)}
      </Question>}
      {step === 'experience' && <Question eyebrow={t('Experience')} title={t('How long have you been training?')}>
        {EXPERIENCE.map(x => <Choice key={x} on={a.experience === x} icon={EXP_ICON[x]} title={experienceText(x)} onClick={() => answer('experience', x)} />)}
      </Question>}
      {step === 'days' && <DaysStep a={a} setA={setA} onNext={() => { track('onboarding_step', { step: 'days', answer: trainingDays(a).join(',') }); go('place') }} />}
      {step === 'place' && <Question eyebrow={t('Equipment')} title={t('Where do you train?')}>
        {PLACES.map(p => <Choice key={p} on={a.place === p} icon={PLACE_ICON[p]} title={placeText(p)} onClick={() => answer('place', p)} />)}
      </Question>}
      {step === 'length' && <Question eyebrow={t('Session length')} title={t('How long is a session?')}>
        {LENGTHS.map(m => <Choice key={m} on={a.sessionMin === m} icon="timer" title={`${m} ${t('min')}`} onClick={() => answer('length', m)} />)}
      </Question>}
      {step === 'limits' && <>
        <div className="ob-eyebrow">{t('Limits')}</div>
        <h1 className="ob-h">{t('Any injury or limitation?')}</h1>
        <p className="ob-p">{t('Optional. A knee that complains, a shoulder to look after — the plan works around it.')}</p>
        <div className="ob-field"><TextArea rows={3} maxLength={600} value={a.limits} onChange={e => setA(v => ({ ...v, limits: e.target.value }))}
          placeholder={t('e.g. “dodgy left shoulder — no barbell overhead press”')} /></div>
        <div className="ob-foot"><Button variant="primary" style={{ flex: 1 }} onClick={() => { track('onboarding_step', { step: 'limits', answer: a.limits.trim() ? 'yes' : 'no' }); go('import') }}>{t('Continue')}</Button></div>
      </>}
      {step === 'import' && <ImportStep onDone={() => go('plan')} />}
      {step === 'plan' && <PlanStep a={a} access={access} freePlan={freePlan}
        coachOn={coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })}
        onApplied={lifts => go(lifts.length ? 'weights' : 'notify')} />}
      {step === 'weights' && <WeightsStep onNext={() => go('notify')} />}
      {step === 'notify' && <NotifyStep user={user} onNext={() => go('today')} />}
      {step === 'today' && <TodayStep onDone={dest => { forget(); clearWelcome(); track('onboarding_done'); nav(dest, { replace: true }) }} />}
    </div>
  </div>
}

const GOAL_ICON = { strength: 'barbell', muscle: 'arm', fatloss: 'flame', general: 'heart' }
const EXP_ICON = { starting: 'sparkles', lt1: 'reset', '1to3': 'chartLine', gt3: 'trophy' }
const PLACE_ICON = { gym: 'barbell', basic: 'dumbbell', dumbbells: 'dumbbell', bodyweight: 'figureStrength' }
const goalText = g => ({ strength: t('Get stronger'), muscle: t('Build muscle'), fatloss: t('Lose fat'), general: t('Get fit') })[g]
const experienceText = x => ({ starting: t('I’m just starting'), lt1: t('Less than a year'), '1to3': t('1–3 years'), gt3: t('More than 3 years') })[x]
const placeText = p => ({ gym: t('A full gym'), basic: t('A basic gym'), dumbbells: t('At home, with dumbbells'), bodyweight: t('Bodyweight only') })[p]

function Question({ eyebrow, title, children }) {
  return <>
    <div className="ob-eyebrow">{eyebrow}</div>
    <h1 className="ob-h">{title}</h1>
    <div className="ob-choices" style={{ marginTop: 18 }}>{children}</div>
  </>
}

function DaysStep({ a, setA, onNext }) {
  const days = trainingDays(a)
  const setCount = n => setA(v => ({ ...v, count: n, days: DEFAULT_DAYS[n] }))
  const toggle = d => setA(v => {
    const cur = trainingDays(v)
    const next = cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d]
    return { ...v, days: next, count: next.length }
  })
  const ok = days.length >= 2 && days.length <= 6
  return <>
    <div className="ob-eyebrow">{t('Schedule')}</div>
    <h1 className="ob-h">{t('How many days a week?')}</h1>
    <div className="ob-days five">
      {DAY_COUNTS.map(n => <button key={n} className={'ob-day' + (days.length === n ? ' on' : '')} onClick={() => setCount(n)}>{n}</button>)}
    </div>
    <div className="ob-sub">{t('Which days?')}</div>
    <div className="ob-week">
      {[1, 2, 3, 4, 5, 6, 0].map(d => <button key={d} className={'ob-wd' + (days.includes(d) ? ' on' : '')} onClick={() => toggle(d)}>{t(DAYN[d]).slice(0, 2)}</button>)}
    </div>
    <div className="ob-foot"><Button variant="primary" style={{ flex: 1 }} disabled={!ok} onClick={onNext}>{t('Continue')}</Button></div>
    {!ok && <div className="ob-hint">{t('Pick between 2 and 6 days.')}</div>}
  </>
}

/* ---------- 2. coming from another app? ---------- */
function ImportStep({ onDone }) {
  const update = useStore(s => s.update)
  const strong = useRef(null), hevy = useRef(null), other = useRef(null)
  useEffect(() => { track('onboarding_import_shown') }, [])
  const came = (source, imported) => update(s => { s.firstRun = { ...(s.firstRun || firstRunState()), fromApp: source, ...(imported ? { imported: true } : {}) } })
  const picked = source => e => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    came(source, false)
    importFromApp(f, () => { came(source, true); track('onboarding_import_picked', { source }); onDone() })
  }
  const option = (icon, title, help, onClick) => <button type="button" className="ob-choice" onClick={onClick}>
    <Icon name={icon} /><span className="ob-choice-t">{title}{help && <span className="ob-choice-s">{help}</span>}</span>
  </button>
  const file = (ref, source) => <input ref={ref} type="file" accept=".csv,text/csv,text/plain" hidden onChange={picked(source)} />
  return <>
    <div className="ob-eyebrow">{t('Your history')}</div>
    <h1 className="ob-h">{t('Coming from another app?')}</h1>
    <p className="ob-p">{t('Bring your history: workouts, weights and records. It takes a minute, and your progression picks up where you left off.')}</p>
    <div className="ob-choices">
      {option('upload', t('Import from Strong'), t('In Strong: Settings → Export Strong Data. Then pick the file here.'), () => strong.current?.click())}
      {option('upload', t('Import from Hevy'), t('In Hevy: Settings → Export & Import Data → Export Workouts. Then pick the file here.'), () => hevy.current?.click())}
      {option('folder', t('Another app or a spreadsheet (CSV)'), null, () => other.current?.click())}
    </div>
    {file(strong, 'strong')}{file(hevy, 'hevy')}{file(other, 'csv')}
    <div style={{ height: 6 }} />
    <Button variant="ghost" className="dim small" onClick={() => { came('hevy', true); importFromHevy(); onDone() }}>{t('Hevy Pro? Import with your API key instead')}</Button>
    <div className="ob-foot"><Button variant="primary" style={{ flex: 1 }} onClick={() => { track('onboarding_import_skipped'); onDone() }}>{t('Start from scratch')}</Button></div>
  </>
}

/* ---------- 3. your plan, made for you ---------- */
const REASON = {
  'two-days': () => t('With two days, the whole body each time: every muscle gets worked twice a week.'),
  'three-new': () => t('Starting out, the whole body three times a week is the quickest way to progress.'),
  'three-strength': () => t('Few lifts, heavy and simple: the classic way to get stronger when you start.'),
  'three-trained': () => t('You already train: a day each for pushing, pulling and legs gives every muscle more work.'),
  four: () => t('Upper and lower body twice a week each, with time to recover in between.'),
  'five-six': () => t('Push, pull and legs in turn: every muscle twice a week, with the volume you are used to.')
}

function PlanStep({ a, access, freePlan, coachOn, onApplied }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const rules = useMemo(() => {
    const plan = buildFirstPlan(a, { weekday: new Date().getDay() })
    return { ...plan, routines: namedStarter(plan.routines) }
  }, [a])
  // The Coach makes the first plan where it can: there for this account (free, Pro, trial, or an
  // instance that does not charge), and with its gift still unused when it is the gift. Nobody
  // waits for it: the plan by rule is shown and started at once, and the Coach is asked in the
  // background (components/CoachPlanWatcher.jsx swaps its plan in when it arrives).
  const coachFits = coachOn && (access === 'open' || access === 'pro' || (access === 'free' && freePlan))
  const [mode, setMode] = useState(null)   // 'consent' | 'rules'
  const [coaching, setCoaching] = useState(false)
  useEffect(() => {
    if (mode || access === null) return
    if (coachFits && !hasConsent(S)) { setMode('consent'); return }
    setCoaching(coachFits)
    setMode('rules')
  }, [access, coachFits, mode])

  const agree = () => {
    update(s => { s.coach = { ...(s.coach || emptyCoach()), consent: { agreedAt: new Date().toISOString(), version: CONSENT_VERSION } } })
    setCoaching(true)
    setMode('rules')
  }

  // Asked once per first run, with the same answers: the watcher takes it from here.
  const askCoach = () => {
    if (useStore.getState().S.firstRun?.coach) return
    const profile = coachProfile(a)
    update(s => {
      const c = (s.coach = s.coach || emptyCoach())
      c.profile = profile
      if (!(c.chat || []).some(m => m.kind === 'intake')) appendChat(s, { role: 'user', kind: 'intake' })
      s.firstRun = { ...(s.firstRun || firstRunState()), coach: { state: 'asking' } }
    })
    const mark = state => update(s => { s.firstRun = { ...s.firstRun, coach: { ...(s.firstRun?.coach || {}), state, askedAt: Date.now() } } })
    // 'asked' only once the job exists, so the watcher's first look cannot find nothing running.
    requestPlan(profile).then(() => mark('asked'), () => mark('failed'))
  }

  const start = () => {
    update(s => {
      s.routines.push(...rules.routines)
      rules.schedule.forEach(({ day, routineId }) => { s.week[day] = [routineId] })
    })
    const ids = rules.routines.map(r => r.id)
    update(s => {
      markUnknownLifts(s.routines.filter(r => ids.includes(r.id)), id => bestWeightFor(s, id) > 0)
      s.firstRun = { ...(s.firstRun || firstRunState()), routineIds: ids }
    })
    track('onboarding_step', { step: 'plan', answer: rules.plan, coach: coaching })
    if (coaching) askCoach()
    const st = useStore.getState().S
    const routines = st.routines.filter(r => ids.includes(r.id))
    onApplied(mainLifts(routines).filter(id => !(bestWeightFor(st, id) > 0)))
  }

  // Only while this account's access to the Coach is being looked up — a moment, not the Coach.
  if (!mode) return <div className="ob-wait">
    <div className="ob-spin"><Icon name="sparkles" /></div>
    <h1 className="ob-h" style={{ textAlign: 'center' }}>{t('Putting your plan together…')}</h1>
  </div>
  if (mode === 'consent') return <Consent onAgree={agree} onDecline={() => setMode('rules')} />

  // What the summary shows: the plan's name and reason, its days, and the first session.
  const days = rules.schedule.map(x => x.day)
  const routineOn = d => rules.routines.find(r => r.id === rules.schedule.find(x => x.day === d)?.routineId)
  const today = new Date().getDay()
  const order = [0, 1, 2, 3, 4, 5, 6].map(i => (today + i) % 7)
  const first = routineOn(order.find(d => days.includes(d)))
  const name = PLAN_COPY[rules.plan]().name
  const why = REASON[recommendPlan(a).reason]?.()

  return <>
    <div className="ob-eyebrow">{t('Your plan')}</div>
    <h1 className="ob-h">{name}</h1>
    {why && <p className="ob-p">{why}</p>}
    {coaching && <div className="ob-coaching"><Icon name="sparkles" /><span>{t('Your Coach is fine-tuning this plan with your answers. Start now; we’ll let you know when it’s ready.')}</span></div>}
    <div className="ob-sub" style={{ marginTop: 0 }}>{t('Your days')}</div>
    <div className="ob-week static">
      {[1, 2, 3, 4, 5, 6, 0].map(d => <span key={d} className={'ob-wd' + (days.includes(d) ? ' on' : '')}>{t(DAYN[d]).slice(0, 2)}</span>)}
    </div>
    {first && <>
      <div className="ob-sub">{t('First session: {0}', first.name)}</div>
      <div className="ob-list">
        {first.ex.map((e, i) => <div key={i} className="ob-list-row">
          <span className={exerciseNameClass(EXIDX[e.id])}>{EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : e.id}</span>
          <span className="dim">{e.sets} × {e.reps || '—'}</span>
        </div>)}
      </div>
    </>}
    <div className="ob-note">{t('You can change it whenever you like.')}</div>
    <div className="ob-foot"><Button variant="primary" style={{ flex: 1 }} icon="checkCircle" onClick={start}>{t('Start my plan')}</Button></div>
  </>
}

/* ---------- 4. starting weights, without fear ---------- */
function WeightsStep({ onNext }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const lifts = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const r of S.routines) for (const e of r.ex.slice(0, 2)) {
      if (seen.has(e.id) || out.length >= 4 || bestWeightFor(S, e.id) > 0) continue
      if (!mainLifts([{ ex: [e] }]).length) continue
      seen.add(e.id); out.push(e.id)
    }
    return out
  }, [])
  const [known, setKnown] = useState({})   // id → { w, r } once a number is typed
  // The reps start at the plan's own, the set most people know ("I squat 60 for 5").
  const planReps = id => S.routines.flatMap(r => r.ex).find(e => e.id === id)?.reps || 8
  const set = (id, patch) => setKnown(k => ({ ...k, [id]: { ...(k[id] || { w: null, r: planReps(id) }), ...patch } }))
  const done = () => {
    let calibrated = 0
    update(s => {
      // Kept for the Coach's plan, should it arrive: it starts these lifts from the same sets.
      const sets = Object.fromEntries(Object.entries(known).filter(([, k]) => k?.w > 0 && k?.r > 0))
      if (Object.keys(sets).length) s.firstRun = { ...(s.firstRun || firstRunState()), known: sets }
      for (const id of lifts) {
        const k = known[id]
        for (const r of s.routines) for (const e of r.ex) {
          if (e.id !== id) continue
          const w = k ? startingWeight(k.w, k.r, e.reps, weightIncrement(e, s.unit)) : null
          if (w) { e.weight = w; delete e.calibrate } else { e.calibrate = true }
        }
        if (!(k && k.w > 0)) calibrated++
      }
    })
    track('onboarding_step', { step: 'weights', answer: `${lifts.length - calibrated}/${lifts.length}` })
    if (calibrated) track('calibration_used', { count: calibrated })
    onNext()
  }
  return <>
    <div className="ob-eyebrow">{t('Starting weights')}</div>
    <h1 className="ob-h">{t('Do you know how much you lift?')}</h1>
    <p className="ob-p">{t('If you don’t, no problem: your first session starts light and Tiza helps you find your weight, set by set.')}</p>
    <div className="ob-lifts">
      {lifts.map(id => {
        const k = known[id]
        return <div key={id} className="ob-lift">
          <div className={'ob-lift-n ' + exerciseNameClass(EXIDX[id])}>{EXIDX[id] ? exerciseNameFor(EXIDX[id]) : id}</div>
          <div className="ob-lift-r">
            <span className="ob-lift-f"><NumberField decimal value={k?.w ?? ''} placeholder={S.unit} onChange={v => set(id, { w: v })} /></span>
            <span className="dim">×</span>
            <span className="ob-lift-f small"><NumberField decimal={false} value={k?.r ?? planReps(id)} onChange={v => set(id, { r: v })} /></span>
            <button type="button" className={'chip' + (!(k?.w > 0) ? ' on' : '')} onClick={() => setKnown(x => { const n = { ...x }; delete n[id]; return n })}>{t('I don’t know')}</button>
          </div>
        </div>
      })}
    </div>
    <div className="ob-foot"><Button variant="primary" style={{ flex: 1 }} onClick={done}>{t('Continue')}</Button></div>
  </>
}

/* ---------- 5. reminders, with their reason ---------- */
function NotifyStep({ user, onNext }) {
  const [can, setCan] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useUI(s => s.toast)
  useEffect(() => { if (DEMO) { onNext(); return } canAsk(user).then(ok => (ok ? setCan(true) : onNext())).catch(() => onNext()) }, [])
  if (!can) return null
  const yes = async () => {
    setBusy(true)
    try { await turnOnReminders('onboarding'); track('onboarding_step', { step: 'notify', answer: 'yes' }) }
    catch { toast(t('Could not change notification settings')) }
    onNext()
  }
  const no = () => { declineOffer(0); track('onboarding_step', { step: 'notify', answer: 'no' }); onNext() }
  return <>
    <div className="ob-big-icon"><Icon name="bell" /></div>
    <h1 className="ob-h" style={{ textAlign: 'center' }}>{t('Shall we remind you?')}</h1>
    <p className="ob-p" style={{ textAlign: 'center' }}>{t('We let you know on the days you train, and when your rest is over.')}</p>
    <div className="ob-foot" style={{ flexDirection: 'column' }}>
      <Button variant="primary" icon="bell" disabled={busy} onClick={yes}>{t('Turn on reminders')}</Button>
      <Button disabled={busy} onClick={no}>{t('Not now')}</Button>
    </div>
  </>
}

/* ---------- 6. today, or the next training day ---------- */
function TodayStep({ onDone }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [later, setLater] = useState(false)
  const [time, setTime] = useState(S.reminder?.time || '18:00')
  const today = todayISO()
  const train = () => {
    const planned = effectiveRoutineIds(S, today)
    // Not a planned day: the plan's first session, today anyway.
    const ids = planned.length ? planned : [nextTrainingDay(S, today)?.routine?.id || S.routines[0]?.id].filter(Boolean)
    // ...brought forward, so the next training day goes on to the session after it.
    if (!planned.length && ids.length) update(s => { s.week = shiftWeekPast(s.week, new Date().getDay(), ids[0]) })
    track('onboarding_step', { step: 'today', answer: 'yes' })
    onDone('/home')
    setTimeout(() => beginWorkout(ids, null), 0)
  }
  // Not today, on a day with a session: today rests, and the plan's first session waits for the
  // next training day rather than being skipped.
  const notToday = () => {
    track('onboarding_step', { step: 'today', answer: 'no' })
    if (effectiveRoutineIds(S, today).length) update(s => {
      s.week = postponeWeek(s.week, new Date().getDay())
      s.dayPlan = { ...(s.dayPlan || {}), [today]: 'rest' }
    })
    setLater(true)
  }
  if (!later) return <>
    <div className="ob-big-icon"><Icon name="dumbbell" /></div>
    <h1 className="ob-h" style={{ textAlign: 'center' }}>{t('Are you training today?')}</h1>
    <div className="ob-foot" style={{ flexDirection: 'column' }}>
      <Button variant="primary" icon="play" onClick={train}>{t('Yes, let’s start')}</Button>
      <Button onClick={notToday}>{t('Not today')}</Button>
    </div>
  </>
  const next = nextTrainingDay(S, today)
  const reminds = !!S.reminder?.on
  const finish = () => {
    if (reminds) update(s => { s.reminder = { ...s.reminder, time } })
    markTrialOffer()
    onDone('/home')
  }
  return <>
    <div className="ob-big-icon"><Icon name="calendar" /></div>
    <h1 className="ob-h" style={{ textAlign: 'center' }}>
      {next ? (reminds ? t('We’ll remind you on {0} at {1}', dayName(next.iso), time) : t('Your next session: {0}', dayName(next.iso))) : t('Your plan is ready')}
    </h1>
    {next && <p className="ob-p" style={{ textAlign: 'center' }}>{next.routine.name}</p>}
    {next && reminds && <div className="ob-time" style={{ justifyContent: 'center' }}>
      <input type="time" value={time} aria-label={t('Reminder time')} onChange={e => setTime(e.target.value || '18:00')} />
    </div>}
    <div className="ob-foot"><Button variant="primary" style={{ flex: 1 }} onClick={finish}>{t('Done')}</Button></div>
  </>
}
