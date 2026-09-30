import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

// Settings → Delete account. The App Store requires that anyone who can create an account in
// the app can also delete it there. Typing the profile's name is the confirmation the server
// asks for (POST /api/account/delete), so one stray tap cannot do it.
export default function DeleteAccountSheet({ name, close, done }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useUI(s => s.toast)
  const go = async () => {
    setBusy(true)
    try {
      await api('/api/account/delete', { method: 'POST', body: JSON.stringify({ confirm: typed.trim() }) })
      await useStore.getState().accountDeleted()
      close()
      toast(t('Your account has been deleted'))
      done && done()
    } catch (e) {
      toast(e.data?.code === 'last-admin' ? t('The last admin cannot delete their own account.') : t('Could not delete the account'))
      setBusy(false)
    }
  }
  return <>
    <h3>{t('Delete account?')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('Your profile, your workouts, your body weight and your photos are deleted from the server. This cannot be undone — export a backup first if you want to keep them.')}
      <br /><br />
      {t('A subscription paid on this website is cancelled. One bought in the App Store or Google Play is not: cancel it there.')}
    </div>
    <input className="input" placeholder={t('Type “{0}” to confirm', name)} value={typed} onChange={e => setTyped(e.target.value)}
      autoCapitalize="none" autoCorrect="off" />
    <div style={{ height: 12 }} />
    <Button variant="danger" onClick={go} disabled={busy || typed.trim() !== name}>{busy ? t('Deleting…') : t('Delete account')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
