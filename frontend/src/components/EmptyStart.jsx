import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutineIds } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { startFlow } from '../sheets.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// A screen with nothing in it yet (F11): what will appear there, and the one thing that makes it
// appear. Without a plan that is making one (the guided first run); with one, today's session, or
// the choice of what to train when today has none.
export default function EmptyStart({ icon, title, text, card = false }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const noPlan = !(S.routines || []).length
  const go = () => {
    if (S.active) return nav('/workout')
    if (noPlan) return nav('/welcome')
    const today = effectiveRoutineIds(S, todayISO())
    return today.length ? startFlow(today) : nav('/workout')
  }
  return <div className={card ? 'card empty-start' : 'empty empty-start'}>
    <div className="ico"><Icon name={icon} /></div>
    <div className="empty-t">{title}</div>
    {text && <div className="empty-p">{text}</div>}
    <Button variant="primary" icon={noPlan ? 'sparkles' : 'play'} onClick={go}>{noPlan ? t('Make me a plan') : t('Start your workout')}</Button>
  </div>
}
