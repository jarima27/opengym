// The store app's first screen (mobile build with VITE_DEFAULT_SERVER — the hosted Tiza): an
// account with Apple, Google or an e-mail, or no account at all. Everything that needs no account
// (logging, progression, history, stats) works without one, on this phone only; an account keeps
// it in Tiza and brings the Coach. Someone with a server of their own can still pair with it.
//
// MobileOnboarding.jsx is what every other mobile build shows.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, getLang } from '../lib/i18n.js'
import { DEFAULT_SERVER, providerSignIn, passwordSignIn, passwordSignUp, providersFor } from '../lib/app-account.js'
import { markWelcome } from '../lib/welcome.js'
import { askAddDeviceData } from '../sheets.jsx'
import { Button } from '../components/ui.jsx'
import { passwordError, MIN_PASSWORD, looksLikeEmail } from '../components/PasswordAuth.jsx'
import { ConnectSheet } from './MobileOnboarding.jsx'

const ui = () => useUI.getState()

// What the hosted server offers before anyone is signed in: the "continue with" providers and
// whether e-mail and password is on. Read straight from it — nothing is paired yet.
async function serverOffer() {
  try {
    const r = await fetch(DEFAULT_SERVER + '/api/config', { signal: AbortSignal.timeout(10000) })
    const c = await r.json()
    return { social: Array.isArray(c.social) ? c.social : [], password: !!c.password_login }
  } catch { return null }
}
async function platform() {
  try { return (await import('@capacitor/core')).Capacitor.getPlatform() } catch { return 'web' }
}

async function signedIn(session) {
  await useStore.getState().connectAccount(session, askAddDeviceData)
  markWelcome()
  ui().toast(session.created ? t('Welcome, {0}', session.user.name) : t('Welcome back, {0}', session.user.name))
}

export default function AppWelcome() {
  return (
    <div className="narrow" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '82vh', textAlign: 'center' }}>
      <img src="icon-180.png" alt="" width="72" height="72" style={{ margin: '0 auto 8px', borderRadius: 18 }} onError={e => { e.currentTarget.style.display = 'none' }} />
      <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '6px 0 4px' }}>Tiza</h1>
      <div className="muted" style={{ marginBottom: 30 }}>{t('Your training, and a Coach that reads it.')}</div>
      <AccountChoice />
    </div>
  )
}

/** Apple, Google, an e-mail, or no account: this screen's buttons, and the end of the guided first
    run's (F12), where the account is made just before the paywall. */
export function AccountChoice({ own = true }) {
  const chooseLocalMode = useStore(s => s.chooseLocalMode)
  const [offer, setOffer] = useState(undefined)   // undefined: asking; null: no answer
  const [os, setOs] = useState('web')
  const [busy, setBusy] = useState(null)
  useEffect(() => { serverOffer().then(setOffer); platform().then(setOs) }, [])
  const providers = providersFor(os, offer?.social || [])

  const withProvider = async provider => {
    if (busy) return
    setBusy(provider)
    try { await signedIn(await providerSignIn(DEFAULT_SERVER, provider, { src: { platform: os, lang: getLang() } })) }
    catch (e) { if (e?.code !== 'cancelled') ui().toast(passwordError(e)) }
    finally { setBusy(null) }
  }
  const label = { apple: t('Continue with Apple'), google: t('Continue with Google') }
  const icon = { apple: 'person', google: 'globe' }

  return (
    <>
      {providers.map(p => <div key={p}>
        <Button variant={p === providers[0] ? 'primary' : undefined} icon={icon[p]} disabled={!!busy} onClick={() => withProvider(p)}>
          {busy === p ? t('Signing in…') : label[p]}
        </Button>
        <div style={{ height: 10 }} />
      </div>)}
      {(offer?.password || offer === null) && <>
        <Button variant={providers.length ? undefined : 'primary'} icon="envelope" disabled={!!busy}
          onClick={() => ui().openSheet(close => <EmailAccountSheet close={close} os={os} />)}>{t('Continue with e-mail')}</Button>
        <div style={{ height: 10 }} />
      </>}
      {offer === undefined && <div className="dim small" style={{ margin: '6px 0 16px' }}>{t('Loading…')}</div>}

      <Button variant="ghost" disabled={!!busy} onClick={() => { markWelcome(); chooseLocalMode() }}>{t('Use without an account')}</Button>
      <div className="dim small" style={{ marginTop: 14, lineHeight: 1.5 }}>
        {t('Without an account everything stays on this phone. With one it is kept safe in Tiza, on every device, and the Coach comes with it.')}
      </div>
      {own && <button type="button" className="linkish dim small" style={{ marginTop: 22, background: 'none', border: 0, color: 'var(--label-3)' }}
        onClick={() => ui().openSheet(close => <ConnectSheet close={close} />)}>{t('I have my own Tiza server')}</button>}
    </>
  )
}

/* E-mail and password: a new account, or signing in to one. A name too for a new one — it is
   what the app greets you with, and what the server knows the profile by. */
export function EmailAccountSheet({ close, os, base = DEFAULT_SERVER }) {
  const [mode, setMode] = useState('signup')   // 'signup' | 'signin'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const first = useRef(null)
  useEffect(() => { setTimeout(() => first.current?.focus(), 250) }, [mode])
  const signup = mode === 'signup'
  const submit = async ev => {
    ev.preventDefault()
    if (busy) return
    const mail = email.trim()
    const bad = signup && !name.trim() ? t('Enter a name')
      : !mail ? t('Enter your e-mail.')
      : signup && !looksLikeEmail(mail) ? t('That is not an e-mail address.')
      : !pw ? t('Enter your password.')
      : signup && [...pw].length < MIN_PASSWORD ? t('Use at least {0} characters.', MIN_PASSWORD)
      : null
    if (bad) { setErr(bad); return }
    setBusy(true); setErr(null)
    try {
      const session = signup
        ? await passwordSignUp(base, { name: name.trim(), email: mail, password: pw, src: { platform: os, lang: getLang() } })
        : await passwordSignIn(base, { identifier: mail, password: pw })
      close()
      await signedIn(session)
    } catch (e) { setErr(passwordError(e)) }
    finally { setBusy(false) }
  }
  const field = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }
  return <>
    <h3>{signup ? t('Create your account') : t('Sign in')}</h3>
    <form onSubmit={submit} noValidate>
      {signup && <>
        <input ref={first} className="input" name="name" autoComplete="given-name" placeholder={t('Your name')} maxLength={40}
          value={name} onChange={e => setName(e.target.value)} />
        <div style={{ height: 10 }} />
      </>}
      <input ref={signup ? undefined : first} className="input" type="email" name="email" autoComplete={signup ? 'email' : 'username'} inputMode="email"
        placeholder={t('E-mail')} maxLength={254} value={email} onChange={e => setEmail(e.target.value)} {...field} />
      <div style={{ height: 10 }} />
      <input className="input" type="password" name="password" autoComplete={signup ? 'new-password' : 'current-password'} placeholder={t('Password')}
        value={pw} onChange={e => setPw(e.target.value)} />
      {signup && <div className="dim small" style={{ marginTop: 6 }}>{t('At least {0} characters. A few unrelated words make a good one.', MIN_PASSWORD)}</div>}
      {err && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
      <div style={{ height: 12 }} />
      <Button type="submit" variant="primary" disabled={busy}>{busy ? (signup ? t('Creating your account…') : t('Signing in…')) : signup ? t('Create account') : t('Sign in')}</Button>
    </form>
    <div style={{ height: 8 }} />
    <Button type="button" variant="ghost" className="dim" onClick={() => { setErr(null); setMode(signup ? 'signin' : 'signup') }}>
      {signup ? t('I already have an account') : t('Create an account instead')}
    </Button>
  </>
}
