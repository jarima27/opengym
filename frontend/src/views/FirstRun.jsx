// F11 — the first run, guided to a first finished workout; lengthened by F12 into the funnel the
// hosted app opens with. Whoever opens the app for the first time is never left with a tool and no
// idea what to do today: a short video and the promise; questions one per screen and a tap each
// (the ones that make the plan, and — where there is a Coach to read them — the ones only the
// Coach uses), with a screen of encouragement between blocks; the starting weights; a few seconds
// "putting the plan together"; the plan, with the main lift's estimated strength today and in
// eight weeks as the progression engine works it out; then the account (before it, in the hosted
// app), the paywall, the plan applied (the Coach improving it in the background, where it can),
// the history from another app, reminders, and today's workout.
//
// Shown before signing up in the hosted app (App.jsx, `pre`), and once after signing up anywhere
// else (the welcome flag, lib/welcome.js). Its answers ride in sessionStorage, so a reload — or a
// sign-up, or a trip to Stripe's checkout and back — picks up where it was. Every screen is
// reported as it is shown (onboarding_step), before the account under the device's own id.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, exerciseNameFor, exerciseNameClass, dateLocale } from '../lib/i18n.js'
import { DAYN, todayISO, fmtNum } from '../lib/format.js'
import { EXIDX } from '../lib/exercises.js'
import {
  GOALS, EXPERIENCE, PLACES, LENGTHS, DAY_COUNTS, DEFAULT_DAYS, HOLDBACKS, FOCUS, SLEEP, FEELINGS, WHEN, FLOW,
  QUESTION_STEPS, trainingDays, buildFirstPlan, recommendPlan, mainLifts, startingWeight, coachProfile, firstRunState,
  shiftWeekPast, postponeWeek, nextStep, stepShown, feelsGood
} from '../lib/first-run.js'
import { planProjection, PROJECTION_WEEKS } from '../lib/plan-projection.js'
import { clearWelcome, markWelcome } from '../lib/welcome.js'
import { track, trackStep } from '../lib/track.js'
import { askForReviewOnce } from '../lib/review-prompt.js'
import { importFromApp, importFromHevy, beginWorkout, PLAN_COPY, namedStarter } from '../sheets.jsx'
import { emptyCoach, coachAvailable, hasConsent, appendChat, CONSENT_VERSION } from '../lib/coach.js'
import { requestPlan } from '../lib/coach-api.js'
import { useCoachAccess, useFreePlan, sellsHere } from '../components/useCoachAccess.js'
import { billingCached } from '../lib/billing.js'
import { PaywallScreen } from '../components/Paywall.jsx'
import { canAsk, turnOnReminders } from '../components/NotifyOffer.jsx'
import { declineOffer } from '../lib/notify.js'
import { effectiveRoutineIds, nextTrainingDay, bestWeightFor } from '../lib/history.js'
import { weightIncrement } from '../lib/progression.js'
import { markUnknownLifts } from '../lib/calibration.js'
import { guestAllowed } from '../lib/guest.js'
import { DEFAULT_SERVER } from '../lib/app-account.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import Icon from '../components/Icon.jsx'
import { Button, TextArea, NumberField } from '../components/ui.jsx'
import { Choice, Consent } from './CoachIntake.jsx'
import { openRegister } from './Login.jsx'
import '../coach.css'

// The store app signs up with Apple, Google or an e-mail (views/AppWelcome.jsx), loaded only there.
const AccountChoice = lazy(() => import('./AppWelcome.jsx').then(m => ({ default: m.AccountChoice })))
const STORE = MOBILE && !!DEFAULT_SERVER
const REPORT = { base: STORE ? DEFAULT_SERVER : '', store: STORE }
// The short video of the app in use the first screen opens with: a file beside the app
// (public/intro.mp4), or the address a build is given. Without one, the promise alone.
const ENV = import.meta.env || {}
const INTRO_VIDEO = ENV.VITE_INTRO_VIDEO || (ENV.BASE_URL || '/') + 'intro.mp4'

const SAVED = 'tiza_first_run'
const readSaved = () => { try { return JSON.parse(sessionStorage.getItem(SAVED) || 'null') } catch { return null } }
const save = v => { try { sessionStorage.setItem(SAVED, JSON.stringify(v)) } catch { /* private mode */ } }
const forget = () => { try { sessionStorage.removeItem(SAVED) } catch { /* nothing kept */ } }
// The weekday as a sentence says it ("on Thursday", "el jueves"): the browser's own word, not the
// capitalised label of the week strip.
const dayName = iso => new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long' })
// The screens there is no going back from: the plan is applied, the account made, the paywall seen.
const NO_BACK = new Set(['intro', 'building', 'paywall', 'coach', 'import', 'notify', 'today'])

export default function FirstRun({ pre = false, onSignIn }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const update = useStore(s => s.update)
  const kept = useMemo(readSaved, [])
  const [step, setStep] = useState(() => (kept?.step && (pre || kept.step !== 'intro') ? kept.step : pre ? 'intro' : 'goal'))
  const [a, setA] = useState(() => ({
    goal: null, experience: null, count: 3, days: DEFAULT_DAYS[3], place: null, sessionMin: null, limits: '',
    holdback: null, focus: [], bw: null, bwGoal: null, sleep: null, feeling: null, when: null, known: {},
    ...(kept?.answers || {})
  }))
  const [history, setHistory] = useState(kept?.history || [])
  useEffect(() => { save({ step, answers: a, history }) }, [step, a, history])
  // The first run starts the first week: its hints and its checklist read this. Not before there
  // is an account to keep it in.
  useEffect(() => { if (!pre && !useStore.getState().S.firstRun) update(s => { s.firstRun = firstRunState(Date.now()) }) }, [pre])

  // The plan by rule, from the answers so far: the starting weights ask for its lifts, the plan
  // screen shows it, and it is the plan applied once there is an account.
  const rules = useMemo(() => {
    const plan = buildFirstPlan(a, { weekday: new Date().getDay() })
    return { ...plan, routines: namedStarter(plan.routines) }
  }, [a.goal, a.experience, a.count, a.days, a.place, a.sessionMin])
  const lifts = useMemo(() => mainLifts(rules.routines).filter(id => !(bestWeightFor(S, id) > 0)), [rules])
  // The questions only the Coach reads are asked where there is one: the hosted app always has it.
  const coach = pre || coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })
  const ctx = { pre, lifts: lifts.length, coach }

  // Every screen, as it is shown: where people leave is the first thing the funnel is for.
  useEffect(() => { trackStep({ step, index: FLOW.indexOf(step), pre }, REPORT) }, [step])
  // Signed up from the account screen: on to what comes after it.
  useEffect(() => { if (step === 'account' && !pre) setStep(nextStep('account', ctx)) }, [step, pre])

  const go = (to = nextStep(step, ctx)) => {
    if (!to) return
    setHistory(h => [...h, step])
    setStep(to)
  }
  const back = () => {
    // Back past the few seconds of "putting your plan together", not into them.
    let h = history.slice()
    let to = h.pop()
    while (to === 'building' && h.length) to = h.pop()
    if (!to) return
    setStep(to); setHistory(h)
  }
  const answer = (key, value, label = value) => {
    const field = key === 'length' ? 'sessionMin' : key
    const next = { ...a, [field]: value }
    setA(next)
    trackStep({ step: key, answer: String(label) }, REPORT)
    if (key === 'feeling' && feelsGood(value)) askForReviewOnce('onboarding')
    go(nextStep(key, { ...ctx, lifts: mainLifts(buildFirstPlan(next).routines).filter(id => !(bestWeightFor(S, id) > 0)).length }))
  }
  const said = (key, label) => trackStep({ step: key, answer: String(label) }, REPORT)

  const shown = QUESTION_STEPS.filter(x => stepShown(x, ctx))
  const qi = shown.indexOf(step)
  const skip = { body: () => { setA(v => ({ ...v, bw: null, bwGoal: null })); said('body', 'skip'); go() },
    limits: () => { setA(v => ({ ...v, limits: '' })); said('limits', 'no'); go() } }[step]
  return <div className={'narrow ob alone' + (step === 'intro' ? ' ob-intro-wrap' : '')}>
    {step !== 'intro' && <div className="ob-top">
      {history.length && !NO_BACK.has(step) ? <button className="iconbtn" onClick={back} aria-label={t('Back')}><Icon name="chevronLeft" /></button> : <span style={{ width: 36 }} />}
      {qi >= 0 && <div className="ob-progress" aria-label={t('{0} of {1}', qi + 1, shown.length)}>
        <span className="ob-bar"><i style={{ width: `${((qi + 1) / shown.length) * 100}%` }} /></span>
        <span className="ob-count">{t('{0} of {1}', qi + 1, shown.length)}</span>
      </div>}
      {skip ? <button className="ob-skip" onClick={skip}>{t('Skip')}</button> : <span style={{ width: 36 }} />}
    </div>}
    <div className="ob-body">
      {step === 'intro' && <IntroStep onStart={() => go()} onSignIn={onSignIn} />}
      {step === 'goal' && <Question eyebrow={t('Your goal')} title={t('What are you training for?')}>
        {GOALS.map(g => <Choice key={g} on={a.goal === g} icon={GOAL_ICON[g]} title={goalText(g)} onClick={() => answer('goal', g)} />)}
      </Question>}
      {step === 'experience' && <Question eyebrow={t('Experience')} title={t('How long have you been training?')}>
        {EXPERIENCE.map(x => <Choice key={x} on={a.experience === x} icon={EXP_ICON[x]} title={experienceText(x)} onClick={() => answer('experience', x)} />)}
      </Question>}
      {step === 'holdback' && <Question eyebrow={t('About you')} title={t('What has held you back until now?')}>
        {HOLDBACKS.map(x => <Choice key={x} on={a.holdback === x} icon={HOLD_ICON[x]} title={holdbackText(x)} onClick={() => answer('holdback', x)} />)}
      </Question>}
      {step === 'focus' && <FocusStep a={a} setA={setA} onNext={() => { said('focus', a.focus.length ? a.focus.join(',') : 'balanced'); go() }} />}
      {step === 'boost1' && <BoostStep {...BOOST_GOAL[a.goal || 'general']()} onNext={() => go()} />}
      {step === 'body' && <BodyStep a={a} setA={setA} unit={S.unit} onNext={() => { said('body', a.bw > 0 ? (a.bwGoal > 0 ? 'both' : 'now') : 'skip'); go() }} />}
      {step === 'days' && <DaysStep a={a} setA={setA} onNext={() => { said('days', trainingDays(a).join(',')); go() }} />}
      {step === 'place' && <Question eyebrow={t('Equipment')} title={t('Where do you train?')}>
        {PLACES.map(p => <Choice key={p} on={a.place === p} icon={PLACE_ICON[p]} title={placeText(p)} onClick={() => answer('place', p)} />)}
      </Question>}
      {step === 'length' && <Question eyebrow={t('Session length')} title={t('How long is a session?')}>
        {LENGTHS.map(m => <Choice key={m} on={a.sessionMin === m} icon="timer" title={`${m} ${t('min')}`} onClick={() => answer('length', m)} />)}
      </Question>}
      {step === 'sleep' && <Question eyebrow={t('Recovery')} title={t('How much do you sleep?')}>
        {SLEEP.map(x => <Choice key={x} on={a.sleep === x} icon="moon" title={sleepText(x)} onClick={() => answer('sleep', x)} />)}
      </Question>}
      {step === 'feeling' && <Question eyebrow={t('Your progress')} title={t('How do you feel about your progress?')}>
        {FEELINGS.map(x => <Choice key={x} on={a.feeling === x} icon={FEEL_ICON[x]} title={feelingText(x)} onClick={() => answer('feeling', x)} />)}
      </Question>}
      {step === 'boost2' && <BoostStep {...BOOST_FEELING[a.feeling || 'new']()} onNext={() => go()} />}
      {step === 'when' && <Question eyebrow={t('Your goal')} title={t('When do you want to notice the change?')}>
        {WHEN.map(x => <Choice key={x} on={a.when === x} icon="calendar" title={whenText(x)} onClick={() => answer('when', x)} />)}
      </Question>}
      {step === 'limits' && <>
        <div className="ob-eyebrow">{t('Limits')}</div>
        <h1 className="ob-h">{t('Any injury or limitation?')}</h1>
        <p className="ob-p">{t('Optional. A knee that complains, a shoulder to look after — the plan works around it.')}</p>
        <div className="ob-field"><TextArea rows={3} maxLength={600} value={a.limits} onChange={e => setA(v => ({ ...v, limits: e.target.value }))}
          placeholder={t('e.g. “dodgy left shoulder — no barbell overhead press”')} /></div>
        <div className="ob-foot"><Button variant="primary" style={{ flex: 1 }} onClick={() => { said('limits', a.limits.trim() ? 'yes' : 'no'); go() }}>{t('Continue')}</Button></div>
      </>}
      {step === 'lifts' && <LiftsStep lifts={lifts} rules={rules} a={a} setA={setA} unit={S.unit}
        onNext={known => { const n = lifts.filter(id => known[id]?.w > 0).length; said('weights', `${n}/${lifts.length}`); go() }} />}
      {step === 'building' && <BuildingStep onDone={() => setStep(nextStep('building', ctx))} />}
      {step === 'plan' && <PlanReveal a={a} rules={rules} lifts={lifts} unit={S.unit} pre={pre} onNext={() => go()} />}
      {step === 'account' && pre && <AccountStep onSignIn={onSignIn} />}
      {step === 'paywall' && <PaywallStep onDone={outcome => { said('paywall', outcome); go() }}
        onLeave={() => save({ step: nextStep('paywall', ctx), answers: a, history: [] })} />}
      {step === 'coach' && <CoachStep a={a} rules={rules} lifts={lifts} onDone={() => go()} />}
      {step === 'import' && <ImportStep onDone={() => go()} />}
      {step === 'notify' && <NotifyStep user={user} onNext={() => go()} />}
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

/* ---------- coming from another app? ---------- */
function ImportStep({ onDone }) {
  const update = useStore(s => s.update)
  const strong = useRef(null), hevy = useRef(null), other = useRef(null)
  useEffect(() => { track('onboarding_import_shown') }, [])
  const came = (source, imported) => update(s => {
    s.firstRun = { ...(s.firstRun || firstRunState()), fromApp: source, ...(imported ? { imported: true } : {}) }
    // The plan is already applied: a lift the history now knows needs no finding in the first session.
    if (imported) for (const r of s.routines) if ((s.firstRun.routineIds || []).includes(r.id)) {
      for (const e of r.ex) if (e.calibrate && bestWeightFor(s, e.id) > 0) delete e.calibrate
    }
  })
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

/* ---------- the opening: the video and the promise ---------- */
function IntroStep({ onStart, onSignIn }) {
  const [video, setVideo] = useState(true)
  return <div className="ob-intro">
    {video
      ? <video className="ob-video" src={INTRO_VIDEO} autoPlay muted loop playsInline preload="auto" onError={() => setVideo(false)} aria-hidden="true" />
      : <img className="ob-intro-icon" src={(ENV.BASE_URL || '/') + 'icon-180.png'} alt="" width="84" height="84" onError={e => { e.currentTarget.style.display = 'none' }} />}
    <h1 className="ob-h ob-promise">{t('Your personal AI Coach. It knows what to lift today.')}</h1>
    <p className="ob-p" style={{ textAlign: 'center' }}>{t('Answer a few questions and get a plan made for you. Then Tiza tells you what to lift, every session.')}</p>
    <div className="ob-foot" style={{ flexDirection: 'column' }}>
      <Button variant="primary" onClick={onStart}>{t('Get started')}</Button>
      {onSignIn && <button type="button" className="pw-free" onClick={onSignIn}>{t('I already have an account')}</button>}
    </div>
  </div>
}

/* ---------- the questions only the Coach reads ---------- */
const HOLD_ICON = { time: 'clock', plan: 'clipboard', results: 'chartLine', motivation: 'flame', injury: 'shield', none: 'sparkles' }
const holdbackText = x => ({
  time: t('Not having the time'), plan: t('Not knowing what to do'), results: t('Not seeing results'),
  motivation: t('Not sticking with it'), injury: t('Injuries or pain'), none: t('Nothing — I just want to get better')
})[x]
const FOCUS_ICON = { chest: 'barbell', back: 'pullup', shoulders: 'dumbbell', arms: 'arm', legs: 'legs', glutes: 'figureRun', core: 'abs' }
const focusText = x => ({ chest: t('Chest'), back: t('Back muscles'), shoulders: t('Shoulders'), arms: t('Arms'), legs: t('Legs'), glutes: t('Glutes'), core: t('Core') })[x]
const sleepText = x => ({ lt6: t('Less than 6 hours'), '6to7': t('6–7 hours'), '7to8': t('7–8 hours'), gt8: t('More than 8 hours') })[x]
const FEEL_ICON = { great: 'rocket', ok: 'chartLine', stuck: 'warning', new: 'sparkles' }
const feelingText = x => ({ great: t('Great — I want more'), ok: t('Good, but it could be better'), stuck: t('Stuck'), new: t('I haven’t started yet') })[x]
const whenText = x => ({ '4w': t('In 4 weeks'), '8w': t('In 8 weeks'), '3m': t('In 3 months'), any: t('No rush') })[x]

function FocusStep({ a, setA, onNext }) {
  const toggle = m => setA(v => ({ ...v, focus: v.focus.includes(m) ? v.focus.filter(x => x !== m) : [...v.focus, m] }))
  return <>
    <div className="ob-eyebrow">{t('Priorities')}</div>
    <h1 className="ob-h">{t('Which muscles do you want to bring up first?')}</h1>
    <p className="ob-p">{t('Pick as many as you like, or none. Your Coach takes them into account.')}</p>
    <div className="ob-focus">
      {FOCUS.map(m => <button key={m} type="button" className={'ob-choice' + (a.focus.includes(m) ? ' on' : '')} onClick={() => toggle(m)} aria-pressed={a.focus.includes(m)}>
        <Icon name={FOCUS_ICON[m]} /><span className="ob-choice-t">{focusText(m)}</span><Icon name="check" className="ob-k" />
      </button>)}
    </div>
    <div className="ob-foot"><Button variant="primary" style={{ flex: 1 }} onClick={onNext}>{a.focus.length ? t('Continue') : t('All of them equally')}</Button></div>
  </>
}

/* ---------- between blocks: encouragement, never a number nobody measured ---------- */
const BOOST_GOAL = {
  strength: () => ({ icon: 'barbell', title: t('Getting stronger is about consistency, not luck'), body: t('Tiza raises the weight when you’ve earned it, session by session, so every workout counts.') }),
  muscle: () => ({ icon: 'arm', title: t('Muscle grows with work, week after week'), body: t('Tiza keeps count of your sets and raises the load when you’re ready for it.') }),
  fatloss: () => ({ icon: 'flame', title: t('Strength training helps you keep your muscle while you lose fat'), body: t('Tiza tells you what to lift each day: all you have to do is show up.') }),
  general: () => ({ icon: 'heart', title: t('What matters is starting, and not stopping'), body: t('Tiza tells you what’s on today, so you don’t have to think about it.') })
}
const BOOST_FEELING = {
  great: () => ({ icon: 'rocket', title: t('Let’s keep it going'), body: t('With a plan that adjusts itself, every session builds on the last one.') }),
  ok: () => ({ icon: 'chartLine', title: t('Better is within reach'), body: t('Small, steady increases add up. Tiza plans them for you.') }),
  stuck: () => ({ icon: 'reset', title: t('Being stuck is normal, and it can be fixed'), body: t('Tiza notices when a lift stalls and tells you what to change.') }),
  new: () => ({ icon: 'sparkles', title: t('Starting is the hardest part'), body: t('And you’re already doing it. Tiza guides you from the first session.') })
}
function BoostStep({ icon, title, body, onNext }) {
  return <>
    <div className="ob-big-icon"><Icon name={icon} /></div>
    <h1 className="ob-h" style={{ textAlign: 'center' }}>{title}</h1>
    <p className="ob-p" style={{ textAlign: 'center' }}>{body}</p>
    <div className="ob-foot"><Button variant="primary" style={{ flex: 1 }} onClick={onNext}>{t('Continue')}</Button></div>
  </>
}

/* ---------- body weight: the log's first entry, and the goal for the Coach ---------- */
function BodyStep({ a, setA, unit, onNext }) {
  return <>
    <div className="ob-eyebrow">{t('Body weight')}</div>
    <h1 className="ob-h">{t('What do you weigh, and what are you aiming for?')}</h1>
    <p className="ob-p">{t('Optional. Your weight starts your body-weight log; your Coach takes the goal into account.')}</p>
    <div className="ob-lifts">
      <div className="ob-lift"><div className="ob-lift-n">{t('Now')}</div>
        <div className="ob-lift-r"><span className="ob-lift-f"><NumberField decimal value={a.bw ?? ''} placeholder={unit} onChange={v => setA(x => ({ ...x, bw: v > 0 ? v : null }))} /></span><span className="dim">{unit}</span></div></div>
      <div className="ob-lift"><div className="ob-lift-n">{t('Goal')}</div>
        <div className="ob-lift-r"><span className="ob-lift-f"><NumberField decimal value={a.bwGoal ?? ''} placeholder={unit} onChange={v => setA(x => ({ ...x, bwGoal: v > 0 ? v : null }))} /></span><span className="dim">{unit}</span></div></div>
    </div>
    <div className="ob-foot"><Button variant="primary" style={{ flex: 1 }} onClick={onNext}>{t('Continue')}</Button></div>
  </>
}

/* ---------- starting weights, without fear ---------- */
function LiftsStep({ lifts, rules, a, setA, unit, onNext }) {
  const asked = lifts.slice(0, 4)
  // The reps start at the plan's own, the set most people know ("I squat 60 for 5").
  const planReps = id => rules.routines.flatMap(r => r.ex).find(e => e.id === id)?.reps || 8
  const known = a.known || {}
  const set = (id, patch) => setA(v => ({ ...v, known: { ...v.known, [id]: { ...(v.known?.[id] || { w: null, r: planReps(id) }), ...patch } } }))
  const unknown = id => setA(v => { const k = { ...v.known }; delete k[id]; return { ...v, known: k } })
  return <>
    <div className="ob-eyebrow">{t('Starting weights')}</div>
    <h1 className="ob-h">{t('Do you know how much you lift?')}</h1>
    <p className="ob-p">{t('If you don’t, no problem: your first session starts light and Tiza helps you find your weight, set by set.')}</p>
    <div className="ob-lifts">
      {asked.map(id => {
        const k = known[id]
        return <div key={id} className="ob-lift">
          <div className={'ob-lift-n ' + exerciseNameClass(EXIDX[id])}>{EXIDX[id] ? exerciseNameFor(EXIDX[id]) : id}</div>
          <div className="ob-lift-r">
            <span className="ob-lift-f"><NumberField decimal value={k?.w ?? ''} placeholder={unit} onChange={v => set(id, { w: v })} /></span>
            <span className="dim">×</span>
            <span className="ob-lift-f small"><NumberField decimal={false} value={k?.r ?? planReps(id)} onChange={v => set(id, { r: v })} /></span>
            <button type="button" className={'chip' + (!(k?.w > 0) ? ' on' : '')} onClick={() => unknown(id)}>{t('I don’t know')}</button>
          </div>
        </div>
      })}
    </div>
    <div className="ob-foot"><Button variant="primary" style={{ flex: 1 }} onClick={() => onNext(known)}>{t('Continue')}</Button></div>
  </>
}

/* ---------- a few seconds while the plan is put together ---------- */
const BUILD_MS = 3600
function BuildingStep({ onDone }) {
  const lines = [t('Reading your answers'), t('Choosing your exercises'), t('Spreading out your week'), t('Working out your weights')]
  const [n, setN] = useState(0)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const every = BUILD_MS / (lines.length + 1)
    const tick = setInterval(() => setN(x => Math.min(lines.length, x + 1)), every)
    const end = setTimeout(() => done.current(), BUILD_MS)
    return () => { clearInterval(tick); clearTimeout(end) }
  }, [])
  return <div className="ob-wait">
    <div className="ob-spin"><Icon name="sparkles" /></div>
    <h1 className="ob-h" style={{ textAlign: 'center' }}>{t('Putting your plan together…')}</h1>
    <div className="ob-build-bar"><i style={{ animationDuration: BUILD_MS + 'ms' }} /></div>
    <div className="ob-build">
      {lines.map((l, i) => <div key={i} className={'ob-build-l' + (i < n ? ' on' : '')}><Icon name={i < n ? 'checkCircle' : 'circle'} /><span>{l}</span></div>)}
    </div>
  </div>
}

/* ---------- the plan, shown before it is anyone's ---------- */
const REASON = {
  'two-days': () => t('With two days, the whole body each time: every muscle gets worked twice a week.'),
  'three-new': () => t('Starting out, the whole body three times a week is the quickest way to progress.'),
  'three-strength': () => t('Few lifts, heavy and simple: the classic way to get stronger when you start.'),
  'three-trained': () => t('You already train: a day each for pushing, pulling and legs gives every muscle more work.'),
  four: () => t('Upper and lower body twice a week each, with time to recover in between.'),
  'five-six': () => t('Push, pull and legs in turn: every muscle twice a week, with the volume you are used to.')
}

function PlanReveal({ a, rules, lifts, unit, pre, onNext }) {
  const days = rules.schedule.map(x => x.day)
  const routineOn = d => rules.routines.find(r => r.id === rules.schedule.find(x => x.day === d)?.routineId)
  const today = new Date().getDay()
  const order = [0, 1, 2, 3, 4, 5, 6].map(i => (today + i) % 7)
  const first = routineOn(order.find(d => days.includes(d)))
  const name = PLAN_COPY[rules.plan]().name
  const why = REASON[recommendPlan(a).reason]?.()
  // Only from a weight they gave: no starting point, no projection.
  const proj = useMemo(() => planProjection(rules, lifts, a.known, { unit: unit === 'lb' ? 'lb' : 'kg' }), [rules, lifts, a.known, unit])
  return <>
    <div className="ob-eyebrow">{t('Your plan')}</div>
    <h1 className="ob-h">{name}</h1>
    {why && <p className="ob-p">{why}</p>}
    {proj && <ProjectionChart proj={proj} />}
    <div className="ob-sub" style={{ marginTop: proj ? 14 : 0 }}>{t('Your days')}</div>
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
    <div className="ob-foot"><Button variant="primary" style={{ flex: 1 }} icon="checkCircle" onClick={onNext}>{pre ? t('Save my plan') : t('Continue')}</Button></div>
  </>
}

// The main lift's estimated one-rep max, today and each week for eight, as the progression engine
// works it out (lib/plan-projection.js) — labelled as the estimate it is.
function ProjectionChart({ proj }) {
  const W = 300, H = 120, P = 10
  const ys = proj.points.map(p => p.e1rm)
  const lo = Math.min(...ys), hi = Math.max(...ys)
  const x = i => P + (i / (proj.points.length - 1)) * (W - 2 * P)
  const y = v => (hi === lo ? H / 2 : H - P - ((v - lo) / (hi - lo)) * (H - 2 * P))
  const line = proj.points.map((p, i) => `${x(i).toFixed(1)},${y(p.e1rm).toFixed(1)}`).join(' ')
  const ex = EXIDX[proj.exId]
  const kg = v => `${fmtNum(v)} ${proj.unit}`
  return <div className="card ob-proj">
    <div className="row between" style={{ alignItems: 'baseline', gap: 8 }}>
      <strong className={exerciseNameClass(ex)}>{ex ? exerciseNameFor(ex) : proj.exId}</strong>
      <span className="chip nocap ob-proj-tag">{t('Estimate')}</span>
    </div>
    <div className="dim small">{t('Estimated 1RM')}</div>
    <svg viewBox={`0 0 ${W} ${H}`} className="ob-proj-svg" role="img" aria-label={t('From {0} today to {1} in {2} weeks', kg(proj.start.e1rm), kg(proj.end.e1rm), PROJECTION_WEEKS)}>
      <polyline points={line} fill="none" stroke="var(--acc)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(0)} cy={y(proj.start.e1rm)} r="4.5" fill="var(--acc)" />
      <circle cx={x(proj.points.length - 1)} cy={y(proj.end.e1rm)} r="4.5" fill="var(--acc)" />
    </svg>
    <div className="row between small">
      <span><span className="dim">{t('Today')}</span> <strong>{kg(proj.start.e1rm)}</strong></span>
      <span><span className="dim">{t('Week {0}', PROJECTION_WEEKS)}</span> <strong>{kg(proj.end.e1rm)}</strong></span>
    </div>
    <div className="dim small" style={{ marginTop: 8, lineHeight: 1.45 }}>
      {t('Worked out by Tiza’s progression engine, as if you complete every set of every session. When a session doesn’t go to plan, the plan repeats the weight or eases off: your real progress is set by your sessions.')}
    </div>
  </div>
}

/* ---------- the account, just before the paywall (hosted app) ---------- */
function AccountStep({ onSignIn }) {
  const config = useStore(s => s.config)
  const setGuest = useStore(s => s.setGuest)
  const canGuest = !STORE && guestAllowed(config)
  return <>
    <div className="ob-big-icon"><Icon name="lock" /></div>
    <h1 className="ob-h" style={{ textAlign: 'center' }}>{t('Save your plan')}</h1>
    <p className="ob-p" style={{ textAlign: 'center' }}>{t('Create your account to keep your plan and your progress safe, on all your devices.')}</p>
    <div className="ob-account">
      {STORE
        ? <Suspense fallback={<div className="dim small">{t('Loading…')}</div>}><AccountChoice own={false} /></Suspense>
        : <>
          <Button variant="primary" icon="person" onClick={openRegister}>{t('Create account')}</Button>
          {canGuest && <><div style={{ height: 10 }} /><Button variant="ghost" className="dim" onClick={() => { markWelcome(); setGuest(true) }}>{t('Continue without account')}</Button></>}
        </>}
      {onSignIn && <button type="button" className="pw-free" onClick={onSignIn}>{t('I already have an account')}</button>}
    </div>
  </>
}

/* ---------- the paywall, right after the plan ---------- */
// Only where something is sold to this profile (an instance that charges, an account, a build
// that sells) and it has not got Pro already — a tester's code, a subscription on another device.
function PaywallStep({ onDone, onLeave }) {
  const charging = !!useStore(s => s.config?.billing)
  const uid = useStore(s => s.user?.id)
  const [open, setOpen] = useState(null)
  useEffect(() => {
    if (DEMO || !sellsHere(charging, uid)) { onDone('skipped'); return }
    let live = true
    billingCached().then(st => {
      if (!live) return
      if (st && ['none', 'trial', 'expired'].includes(st.plan)) setOpen(true)
      else onDone('skipped')
    }).catch(() => { if (live) onDone('skipped') })
    return () => { live = false }
  }, [])
  if (!open) return <div className="ob-wait"><div className="ob-spin"><Icon name="sparkles" /></div></div>
  return <PaywallScreen onDone={onDone} onLeave={onLeave} />
}

/* ---------- the plan applied, and the Coach asked to improve it ---------- */
function CoachStep({ a, rules, lifts, onDone }) {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const update = useStore(s => s.update)
  const access = useCoachAccess()
  const freePlan = useFreePlan()
  // The Coach makes the plan better where it can: there for this account (free, Pro, trial, or an
  // instance that does not charge), and with its gift still unused when it is the gift. Nobody
  // waits for it: the plan by rule is applied now, and the Coach is asked in the background
  // (components/CoachPlanWatcher.jsx swaps its plan in when it arrives).
  const coachOn = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })
  const coachFits = coachOn && (access === 'open' || access === 'pro' || (access === 'free' && freePlan))
  const [consent, setConsent] = useState(false)
  const applied = useRef(false)

  // Asked once per first run, with the same answers: the watcher takes it from here.
  const askCoach = () => {
    if (useStore.getState().S.firstRun?.coach) return
    const profile = coachProfile({ ...a, unit: useStore.getState().S.unit })
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

  const apply = coaching => {
    if (applied.current) return
    applied.current = true
    // Applied already: a reload on this screen.
    if (useStore.getState().S.firstRun?.routineIds?.length) { onDone(); return }
    const today = todayISO()
    update(s => {
      s.routines.push(...rules.routines)
      rules.schedule.forEach(({ day, routineId }) => { s.week[day] = [routineId] })
    })
    const ids = rules.routines.map(r => r.id)
    let unknown = 0
    update(s => {
      const own = s.routines.filter(r => ids.includes(r.id))
      markUnknownLifts(own, id => bestWeightFor(s, id) > 0)
      // The weights they gave: each lift starts from its set, carried to the plan's reps.
      const sets = Object.fromEntries(Object.entries(a.known || {}).filter(([, k]) => k?.w > 0 && k?.r > 0))
      for (const id of lifts.slice(0, 4)) {
        const k = sets[id]
        for (const r of own) for (const e of r.ex) {
          if (e.id !== id) continue
          const w = k ? startingWeight(k.w, k.r, e.reps, weightIncrement(e, s.unit)) : null
          if (w) { e.weight = w; delete e.calibrate } else e.calibrate = true
        }
        if (!k) unknown++
      }
      // Kept for the Coach's plan, should it arrive: it starts these lifts from the same sets.
      s.firstRun = { ...(s.firstRun || firstRunState()), routineIds: ids, ...(Object.keys(sets).length ? { known: sets } : {}) }
      // The body weight they gave starts the log.
      if (a.bw > 0 && !(s.bodyweight || []).some(x => x.d === today)) s.bodyweight = [...(s.bodyweight || []), { d: today, w: a.bw, t: Date.now() }]
    })
    track('onboarding_step', { step: 'plan', answer: rules.plan, coach: coaching })
    if (unknown) track('calibration_used', { count: unknown })
    if (coaching) askCoach()
    onDone()
  }

  useEffect(() => {
    if (consent || access === null) return
    if (coachFits && !hasConsent(S)) { setConsent(true); return }
    apply(coachFits)
  }, [access, coachFits, consent])

  const agree = () => {
    update(s => { s.coach = { ...(s.coach || emptyCoach()), consent: { agreedAt: new Date().toISOString(), version: CONSENT_VERSION } } })
    apply(true)
  }
  if (consent) return <Consent onAgree={agree} onDecline={() => apply(false)} />
  // Only while this account's access to the Coach is being looked up — a moment.
  return <div className="ob-wait"><div className="ob-spin"><Icon name="sparkles" /></div></div>
}

/* ---------- reminders, with their reason ---------- */
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

/* ---------- today, or the next training day ---------- */
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
