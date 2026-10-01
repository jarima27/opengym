import { useEffect, useState } from 'react'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { localTZ } from '../lib/format.js'
import { DEMO } from '../lib/demo.js'
import { track } from '../lib/track.js'
import { pushSupported, enablePush } from '../lib/push.js'
import { MOBILE, syncReminder, notificationPermission } from '../lib/mobile.js'
import { offerDue, readOffer, declineOffer } from '../lib/notify.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

// The offer to turn reminders on, on the workout-complete screen (sheets.jsx FinishSummary): the
// first time, the moment the app has shown what it is for. The browser's own permission prompt
// comes only after a yes here, so a "not now" costs nothing — a "block" in the browser's dialog
// would be for good. Yes turns on the day reminder and, with it, the smart reminders
// (api/coach/core/nudges.js); both stay adjustable in Settings → Notifications.
//
// Shown only where it can work and has not been answered: the phone, or a signed-in browser
// that supports Web Push and has never been asked.
export async function canAsk(user) {
  if (MOBILE) return (await notificationPermission()) === 'prompt'
  return !!user && pushSupported() && Notification.permission === 'default'
}

/** Asks for the permission and turns the day reminder on with it. Throws when it is refused. */
export async function turnOnReminders(from, count = 0) {
  const { S, update } = useStore.getState()
  if (MOBILE) {
    const ok = await syncReminder({ ...S, reminder: { ...(S.reminder || DEF.reminder), on: true } }, true)
    if (!ok) throw new Error(t('Could not change notification settings'))
  } else {
    await enablePush()
  }
  update(s => { s.reminder = { ...(s.reminder || DEF.reminder), on: true, tz: localTZ() } })
  track('notifications_enabled', { from, count })
}

export default function NotifyOffer({ count }) {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (DEMO || !offerDue(count, readOffer())) return
    let gone = false
    canAsk(user).then(ok => {
      if (gone || !ok) return
      setShow(true)
      track('notifications_prompted', { count })
    }).catch(() => {})
    return () => { gone = true }
  }, [])

  if (!show) return null

  const turnOn = async () => {
    setBusy(true)
    try {
      await turnOnReminders('finish', count)
      toast(t('Reminders on'))
      setShow(false)
    } catch (e) {
      // A "block" in the system dialog lands here too; the offer has had its answer.
      toast(t('Could not change notification settings'))
      setShow(false)
    }
    setBusy(false)
  }
  const later = () => { declineOffer(count); setShow(false) }

  return (
    <div className="card" style={{ textAlign: 'start', margin: '0 0 14px', padding: 14 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <Icon name="bell" style={{ color: 'var(--acc)', fontSize: 18 }} />
        <strong>{t('Don’t let a workout slip by')}</strong>
      </div>
      <div className="small" style={{ color: 'var(--label-2)', marginBottom: 12 }}>
        {t('Tiza reminds you on the days you have a workout planned, and checks in that evening if it slipped by. Change it anytime in Settings.')}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <Button variant="primary" size="sm" icon="bell" disabled={busy} onClick={turnOn}>{t('Turn on reminders')}</Button>
        <Button size="sm" disabled={busy} onClick={later}>{t('Not now')}</Button>
      </div>
    </div>
  )
}
