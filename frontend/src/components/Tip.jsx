import { useStore } from '../store/useStore.js'
import { tipDue } from '../lib/first-run.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// One of the first workout's three hints (F11): shown once, during the first workout of someone
// who came through the guided first run, and gone for good with a tap (S.firstRun.tips).
export const closeTip = key => useStore.getState().update(s => {
  if (s.firstRun && !s.firstRun.tips?.[key]) s.firstRun = { ...s.firstRun, tips: { ...(s.firstRun.tips || {}), [key]: true } }
})

export default function Tip({ k, after = [], className = '', children }) {
  // `after`: hints that have to be closed before this one shows, so they come one at a time.
  const due = useStore(s => tipDue(s.S, k) && after.every(a => s.S.firstRun?.tips?.[a]))
  if (!due) return null
  return <div className={'tip ' + className} role="note" onClick={() => closeTip(k)}>
    <Icon name="lightbulb" /><span>{children}</span><button type="button">{t('Got it')}</button>
  </div>
}
