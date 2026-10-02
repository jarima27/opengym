import { useState } from 'react'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t, getLang } from '../lib/i18n.js'
import { platform } from '../lib/attribution.js'
import { Button, TextArea } from './ui.jsx'

// "Send feedback" — from Settings, and from the first workout's summary. Free text, sent with the
// app's version, the platform and the screen it came from (POST /api/feedback); the operator reads
// it in the admin dashboard. Only for a signed-in profile: without a server there is no one to
// send it to.
export function openFeedback(screen) {
  useUI.getState().openSheet(close => <FeedbackSheet screen={screen} close={close} />)
}

export function sendFeedback(text, screen) {
  return api('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({ text, screen, version: __APP_VERSION__, platform: platform(), lang: getLang() })
  })
}

function FeedbackSheet({ screen, close }) {
  const toast = useUI(s => s.toast)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (busy || !text.trim()) return
    setBusy(true)
    try {
      await sendFeedback(text.trim(), screen)
      close()
      toast(t('Thank you! We read every message.'))
    } catch (e) {
      setBusy(false)
      toast(e?.status === 429 ? t('That’s a lot of messages for one hour — try again later.') : t('Could not send it. Check your connection and try again.'))
    }
  }
  return <>
    <h3 style={{ marginTop: 0 }}>{t('Send feedback')}</h3>
    <p className="muted small" style={{ marginTop: -4 }}>{t('What you like, what fails, what you miss. Every message is read by the people who make Tiza.')}</p>
    <TextArea rows={6} maxLength={2000} autoFocus value={text} onChange={e => setText(e.target.value)}
      placeholder={t('e.g. “The rest timer is too quiet in the gym”')} />
    <div className="dim small" style={{ margin: '6px 0 14px' }}>{t('Sent with the app’s version, your device type and this screen, to help us find it.')}</div>
    <Button variant="primary" icon="chat" disabled={busy || !text.trim()} onClick={send}>{busy ? t('Sending…') : t('Send')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
