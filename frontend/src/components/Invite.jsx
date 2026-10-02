import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { SITE, NAME } from '../lib/brand.js'
import { shareLink } from '../lib/share.js'
import { track } from '../lib/track.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// "Invite a friend" (GET /api/invite): the profile's own code, the link that carries it, and the
// system's share sheet. A friend who signs up with it gets 30 days of Pro, and so does whoever
// shared it (api/growth.js) — on the trial, or as a charge moved back.
export function openInvite() {
  useUI.getState().openSheet(close => <InviteSheet close={close} />)
}

// The website's short link for a code (landing: /r/CODE → ?ref=CODE, which shows the days and
// hands the code to the app).
export const inviteLink = code => `${SITE}/r/${encodeURIComponent(code)}`

function InviteSheet({ close }) {
  const toast = useUI(s => s.toast)
  const [inv, setInv] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { api('/api/invite').then(setInv).catch(() => setFailed(true)) }, [])
  const link = inv ? inviteLink(inv.code) : ''
  const share = async () => {
    const how = await shareLink({
      title: NAME,
      text: t('I train with {0}. Sign up with my code {1} and we both get {2} days of Pro free:', NAME, inv.code, inv.days),
      url: link
    })
    if (how === 'copied') toast(t('Link copied'))
    if (how !== 'cancelled') track('invite_shared', { how })
  }
  const copy = () => { navigator.clipboard?.writeText(link).catch(() => {}); toast(t('Link copied')) }
  const left = inv ? Math.max(0, inv.max - inv.rewarded) : 0

  return <div style={{ textAlign: 'center' }}>
    <div style={{ fontSize: 40, color: 'var(--acc)', display: 'flex', justifyContent: 'center', marginTop: 4 }}><Icon name="gift" /></div>
    <h3 style={{ margin: '8px 0 6px' }}>{t('Invite a friend')}</h3>
    <p className="muted small" style={{ margin: '0 auto 16px', maxWidth: 320 }}>
      {t('When a friend signs up with your code, you both get {0} days of Pro free.', inv?.days || 30)}
    </p>
    {failed && <div className="muted small" style={{ marginBottom: 14 }}>{t('Could not load your code. Check your connection and try again.')}</div>}
    {inv && <>
      <button type="button" className="invite-code" onClick={copy} aria-label={t('Copy link')}>{inv.code}</button>
      <div className="dim small" style={{ margin: '8px 0 16px', wordBreak: 'break-all' }}>{link}</div>
      <Button variant="primary" icon="share" onClick={share} disabled={!inv.active}>{t('Share invite')}</Button>
      <div style={{ height: 8 }} />
      <Button icon="link" onClick={copy}>{t('Copy link')}</Button>
      <div className="small muted" style={{ marginTop: 14 }}>
        {inv.signups === 0 ? t('No friends have joined yet.')
          : t(inv.signups === 1 ? '1 friend has joined.' : '{0} friends have joined.', inv.signups)}
        {inv.rewarded > 0 && ' ' + t('{0} extra days earned so far.', inv.rewarded * inv.days)}
        {left === 0 && ' ' + t('You have earned every reward there is — thank you!')}
      </div>
    </>}
    <div style={{ height: 10 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </div>
}

// "Have a code?" (POST /api/redeem): a tester's code makes the profile Pro for good, at any time;
// a creator's or a friend's still counts during the first week — the store app has no link that
// could have carried it through the install. `done(access)`: what the profile has now.
export function openRedeem(done) {
  useUI.getState().openSheet(close => <RedeemSheet close={close} done={done} />)
}

const REFUSED = {
  unknown: () => t('That code doesn’t exist or no longer works.'),
  revoked: () => t('That code doesn’t exist or no longer works.'),
  full: () => t('That code has no places left.'),
  already: () => t('You already have Pro free for good.'),
  own: () => t('That’s your own code — share it with a friend instead.'),
  used: () => t('A code already counts for your account.'),
  late: () => t('That code only works in your first week. Codes for testers work any time.')
}

function RedeemSheet({ close, done }) {
  const toast = useUI(s => s.toast)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const redeem = async () => {
    if (busy || !code.trim()) return
    setBusy(true); setError('')
    try {
      const r = await api('/api/redeem', { method: 'POST', body: JSON.stringify({ code: code.trim() }) })
      close()
      toast(r.kind === 'tester' ? t('Done! You have Pro free for good.') : t('Done! {0} extra days of Pro free.', r.days))
      import('../lib/billing.js').then(m => m.forgetCoachAccess?.()).catch(() => {})
      done?.(r.access)
    } catch (e) {
      setBusy(false)
      setError(e?.status === 429 ? t('Too many tries. Try again in an hour.') : (REFUSED[e?.data?.code] || (() => t('Could not check the code. Check your connection and try again.')))())
    }
  }
  return <>
    <h3 style={{ marginTop: 0 }}>{t('Redeem a code')}</h3>
    <p className="muted small" style={{ marginTop: -4 }}>{t('A tester’s code, a creator’s or a friend’s.')}</p>
    <input className="input" autoFocus maxLength={24} value={code} placeholder={t('Code')}
      onChange={e => { setCode(e.target.value.toUpperCase()); setError('') }}
      onKeyDown={e => { if (e.key === 'Enter') redeem() }}
      style={{ width: '100%', letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
    {error && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: 8 }}>{error}</div>}
    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={busy || !code.trim()} onClick={redeem}>{busy ? t('Checking…') : t('Redeem')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
