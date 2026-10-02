import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { confirmSheet } from '../sheets.jsx'
import { openPaywallPreview } from '../components/Paywall.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// The operator's side of selling the app: creator codes, and the paywall's words and prices.
// English-only like the rest of the dashboard. Each card hides itself on an instance where its
// routes do not exist (a 404: nothing is sold, and no analytics are kept).

/* ------------------------------ creator codes ------------------------------ */

export function CodesCard() {
  const toast = useUI(s => s.toast)
  const [data, setData] = useState(null)
  const [form, setForm] = useState({ code: '', label: '', days: 30 })
  const load = () => api('/api/admin/codes').then(setData).catch(e => setData(e.status === 404 ? false : { codes: [] }))
  useEffect(() => { load() }, [])
  if (data === null || data === false) return null
  const codes = data.codes.filter(c => c.kind !== 'tester')

  const link = code => `${location.origin}${location.pathname}?ref=${code}`
  const copy = text => { navigator.clipboard?.writeText(text).catch(() => {}); toast('Copied') }
  const create = () => api('/api/admin/codes', { method: 'POST', body: JSON.stringify(form) })
    .then(({ code }) => { copy(link(code.code)); setForm({ code: '', label: '', days: 30 }); load() })
    .catch(e => toast(e.message))
  const revoke = code => confirmSheet({
    title: 'Revoke ' + code + '?', message: 'New sign-ups with it stop getting the extra days. Everyone who already used it keeps them, and still counts under it.',
    confirmText: 'Revoke', danger: true,
    onConfirm: () => api('/api/admin/codes/revoke', { method: 'POST', body: JSON.stringify({ code }) }).then(load).catch(e => toast(e.message))
  })
  const f = data.friends

  return <div className="card">
    <h2 style={{ margin: 0 }}>Creator codes</h2>
    <div className="adm-lead">
      One code per creator or trainer. A sign-up through their link (<code>?ref=CODE</code>) gets the extra days on top of the trial and is counted
      under the code here and in your analytics. Creating a code copies its link.
    </div>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
      <input className="input" style={{ flex: '1 1 110px', textTransform: 'uppercase' }} placeholder="CODE" maxLength={24} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
      <input className="input" style={{ flex: '2 1 160px' }} placeholder="Who it is for" maxLength={80} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
      <input className="input" style={{ flex: '0 1 80px' }} type="number" min={0} max={365} value={form.days} onChange={e => setForm({ ...form, days: e.target.value })} aria-label="extra days" />
      <Button variant="primary" size="sm" icon="plus" onClick={create} disabled={!form.code.trim()}>Create</Button>
    </div>
    {codes.length ? codes.map(c => <div key={c.code} className={'row between' + (c.revoked ? ' dim' : '')} style={{ padding: '7px 0', borderBottom: 'var(--hair) solid var(--sep)', gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        <button className="adm-code" onClick={() => copy(link(c.code))} aria-label={'copy link for ' + c.code}>{c.code}</button>
        <span className="small muted" style={{ marginInlineStart: 8 }}>{c.label || '—'} · +{c.days} days{c.revoked ? ' · revoked' : ''}</span>
      </div>
      <div className="row" style={{ gap: 10, flex: 'none' }}>
        <span className="small"><strong>{c.signups}</strong> sign-ups · <strong>{c.paying}</strong> paying</span>
        {!c.revoked && <button className="iconbtn adm-iconbtn" style={{ color: 'var(--red)' }} onClick={() => revoke(c.code)} aria-label="revoke"><Icon name="trash" /></button>}
      </div>
    </div>) : <div className="adm-empty">No codes yet.</div>}
    {/* "Invite a friend": one code per person who opened it, summed up rather than listed. */}
    {f && <div className="small" style={{ marginTop: 12 }}>
      <strong>Friend invites</strong> · {f.codes} people sharing · <strong>{f.signups}</strong> sign-ups · <strong>{f.paying}</strong> paying · {f.rewarded} rewards of 30 days given
    </div>}
  </div>
}

/* ------------------------------ tester codes ------------------------------ */

// A code that makes whoever redeems it Pro for good (Settings → Subscription → Have a code?, or
// the sign-up link). For the closed test, partners, friends of the house.
export function TesterCodesCard() {
  const toast = useUI(s => s.toast)
  const [codes, setCodes] = useState(null)
  const [form, setForm] = useState({ code: '', label: '', max: '' })
  const load = () => api('/api/admin/codes').then(r => setCodes(r.codes.filter(c => c.kind === 'tester'))).catch(e => setCodes(e.status === 404 ? false : []))
  useEffect(() => { load() }, [])
  if (codes === null || codes === false) return null

  const copy = text => { navigator.clipboard?.writeText(text).catch(() => {}); toast('Copied') }
  const create = () => api('/api/admin/codes', { method: 'POST', body: JSON.stringify({ code: form.code, label: form.label, kind: 'tester', max: +form.max || 0 }) })
    .then(({ code }) => { copy(code.code); setForm({ code: '', label: '', max: '' }); load() })
    .catch(e => toast(e.message))
  const revoke = code => confirmSheet({
    title: 'Revoke ' + code + '?', message: 'Nobody new can redeem it. Everyone who already did keeps Pro.',
    confirmText: 'Revoke', danger: true,
    onConfirm: () => api('/api/admin/codes/revoke', { method: 'POST', body: JSON.stringify({ code }) }).then(load).catch(e => toast(e.message))
  })

  return <div className="card">
    <h2 style={{ margin: 0 }}>Tester codes</h2>
    <div className="adm-lead">
      Pro for good, free: whoever redeems the code in the app (Settings → Subscription → Have a code?) or signs up with its link is never
      charged. Leave the cap empty for no limit. Creating a code copies it.
    </div>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
      <input className="input" style={{ flex: '1 1 110px', textTransform: 'uppercase' }} placeholder="CODE" maxLength={24} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
      <input className="input" style={{ flex: '2 1 160px' }} placeholder="Who it is for" maxLength={80} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
      <input className="input" style={{ flex: '0 1 90px' }} type="number" min={0} placeholder="Cap" value={form.max} onChange={e => setForm({ ...form, max: e.target.value })} aria-label="maximum uses" />
      <Button variant="primary" size="sm" icon="plus" onClick={create} disabled={!form.code.trim()}>Create</Button>
    </div>
    {codes.length ? codes.map(c => <div key={c.code} className={'row between' + (c.revoked ? ' dim' : '')} style={{ padding: '7px 0', borderBottom: 'var(--hair) solid var(--sep)', gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        <button className="adm-code" onClick={() => copy(c.code)} aria-label={'copy ' + c.code}>{c.code}</button>
        <span className="small muted" style={{ marginInlineStart: 8 }}>{c.label || '—'}{c.revoked ? ' · revoked' : ''}</span>
      </div>
      <div className="row" style={{ gap: 10, flex: 'none' }}>
        <span className="small"><strong>{c.uses}</strong>{c.max ? ' / ' + c.max : ''} used</span>
        {!c.revoked && <button className="iconbtn adm-iconbtn" style={{ color: 'var(--red)' }} onClick={() => revoke(c.code)} aria-label="revoke"><Icon name="trash" /></button>}
      </div>
    </div>) : <div className="adm-empty">No tester codes yet.</div>}
  </div>
}

/* ------------------------------ paywall ------------------------------ */

const LABELS = {
  title: 'Title', titleStall: 'Title when a lift has stalled ({exercise}, {weeks})',
  titleComeback: 'Title when back after a few days off', titleDay7: 'Title a week after the free Coach plan',
  timeline: 'Trial timeline ({0} = reminder day, {1} = first charge day)', subtitle: 'Subtitle', bullets: 'Bullet points — one per line', cta: 'Button, when checking out starts a trial ({0} = days)',
  ctaNoTrial: 'Button, without a trial', monthlyLabel: 'Monthly plan name', annualLabel: 'Yearly plan name', annualBadge: 'Badge on the recommended plan',
  perMonth: 'Price per month ({0} = price)', perYear: 'Price per year ({0} = price)', footnote: 'Small print', later: 'Dismiss button',
  endTitle: 'Trial ended — title', endRecap: 'Trial ended — what the Coach did ({adjustments}, {gainKg}, {exercise})', endBody: 'Trial ended — text', endCta: 'Trial ended — button, without a trial'
}
const LONG = new Set(['subtitle', 'bullets', 'footnote', 'endBody', 'endRecap', 'timeline', 'titleDay7'])
const clone = o => JSON.parse(JSON.stringify(o))

export function PaywallCard() {
  const toast = useUI(s => s.toast)
  const [d, setD] = useState(null)
  const [pw, setPw] = useState(null)
  const [vi, setVi] = useState(0)
  const [lang, setLang] = useState('es')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api('/api/admin/paywall').then(r => { setD(r); setPw(clone(r.paywall)) }).catch(e => setD(e.status === 404 ? false : null))
  }, [])
  if (!d || !pw) return null

  const v = pw.variants[vi]
  const put = fn => setPw(p => { const n = clone(p); fn(n.variants[vi], n); return n })
  const copyOf = (variant, l) => variant.copy?.[l] || {}
  const setField = (f, value) => put(x => { x.copy = x.copy || {}; x.copy[lang] = { ...(x.copy[lang] || {}), [f]: f === 'bullets' ? value.split('\n') : value } })
  const langs = [...new Set(['es', 'en', ...Object.keys(v.copy || {})])]
  const total = pw.variants.reduce((n, x) => n + (+x.weight || 0), 0)
  const defaults = d.defaults[lang] || d.defaults.en

  const addVariant = () => {
    if (pw.variants.length >= 4) return
    const ids = pw.variants.map(x => x.id)
    const id = 'abcd'.split('').find(c => !ids.includes(c))
    setPw(p => ({ ...p, variants: [...p.variants, { ...clone(v), id, weight: 50 }] }))
    setVi(pw.variants.length)
  }
  const removeVariant = () => { if (pw.variants.length < 2) return; setPw(p => ({ ...p, variants: p.variants.filter((_, i) => i !== vi) })); setVi(0) }
  const save = () => {
    setBusy(true)
    api('/api/admin/paywall', { method: 'POST', body: JSON.stringify({ paywall: pw }) })
      .then(r => { setPw(clone(r.paywall)); toast('Paywall saved — live now') })
      .catch(e => toast(e.message))
      .finally(() => setBusy(false))
  }
  // What this variant looks like in this language, with the prices the paywall shows now.
  const preview = reason => {
    const own = copyOf(v, lang)
    const copy = {}
    for (const f of d.fields) copy[f] = (f === 'bullets' ? (own.bullets || []).filter(b => b.trim()) : own[f]) || defaults[f]
    if (!copy.bullets.length) copy.bullets = defaults.bullets
    openPaywallPreview({ copy, highlight: v.highlight, variant: v.id }, reason)
  }

  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Paywall</h2>
      <div className="row" style={{ gap: 6 }}>
        <Button size="sm" onClick={() => preview('preview')}>Preview</Button>
        <Button size="sm" onClick={() => preview('preview_end')}>Trial ended</Button>
        <Button variant="primary" size="sm" onClick={save} disabled={busy}>Save</Button>
      </div></div>
    <div className="adm-lead">
      The words on the website’s paywall and end-of-trial screen, and — for a test — each variant’s share of people and its own Stripe prices.
      Saved changes are live on the next paywall anyone opens. A field left empty uses the text shown in grey. Every paywall event in your
      analytics carries the experiment and the variant.
    </div>
    <div className="adm-lead">
      Any line can quote the person’s own data where the paywall opened from it: {'{exercise}'} and {'{weeks}'} (a stalled lift),
      {' {missed}'} (sessions missed last week), {'{gainKg}'} (a lift’s rise, with its unit), {'{adjustments}'} (changes the Coach made in the trial).
      A line whose data is missing is left out; a title falls back to the general one.
    </div>

    <label className="small dim">Experiment name — change it to start a new test with fresh groups</label>
    <input className="input" value={pw.experiment} onChange={e => setPw({ ...pw, experiment: e.target.value })} style={{ marginBottom: 12 }} />

    <div className="chips" style={{ marginBottom: 10 }}>
      {pw.variants.map((x, i) => <button key={i} className={'chip nocap' + (i === vi ? ' on' : '')} onClick={() => setVi(i)}>
        Variant {x.id} · {total ? Math.round((+x.weight || 0) * 100 / total) : 0}%</button>)}
      {pw.variants.length < 4 && <button className="chip nocap" onClick={addVariant}>+ Add a variant</button>}
    </div>

    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
      <label className="small" style={{ flex: '1 1 120px' }}>Share (weight)
        <input className="input" type="number" min={0} max={100} value={v.weight} onChange={e => put(x => { x.weight = e.target.value })} /></label>
      <label className="small" style={{ flex: '1 1 120px' }}>Recommended plan
        <select className="input" value={v.highlight} onChange={e => put(x => { x.highlight = e.target.value })}>
          <option value="annual">Yearly</option><option value="monthly">Monthly</option></select></label>
      <label className="small" style={{ flex: '1 1 160px' }}>App offering (RevenueCat)
        <input className="input" placeholder="default" value={v.offering || ''} onChange={e => put(x => { x.offering = e.target.value })} /></label>
    </div>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      <label className="small" style={{ flex: '1 1 200px' }}>Stripe monthly price
        <input className="input" placeholder={d.envPrices.monthly || 'price_…'} value={v.prices?.monthly || ''} onChange={e => put(x => { x.prices = { ...x.prices, monthly: e.target.value } })} /></label>
      <label className="small" style={{ flex: '1 1 200px' }}>Stripe yearly price
        <input className="input" placeholder={d.envPrices.annual || 'price_…'} value={v.prices?.annual || ''} onChange={e => put(x => { x.prices = { ...x.prices, annual: e.target.value } })} /></label>
    </div>

    <div className="chips" style={{ marginBottom: 10 }}>
      {langs.map(l => <button key={l} className={'chip nocap' + (l === lang ? ' on' : '')} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}
      <button className="chip nocap" onClick={() => { const l = (prompt('Language code (e.g. pt, de, fr)') || '').trim().toLowerCase(); if (/^[a-z]{2}$/.test(l)) setLang(l) }}>+ Language</button>
    </div>
    {d.fields.map(f => {
      const own = copyOf(v, lang)[f]
      const value = f === 'bullets' ? (own || []).join('\n') : own || ''
      const hint = f === 'bullets' ? (defaults.bullets || []).join('\n') : defaults[f] || ''
      return <label key={f} className="small" style={{ display: 'block', marginBottom: 8 }}>{LABELS[f] || f}
        {LONG.has(f)
          ? <textarea className="input" rows={f === 'bullets' ? 4 : 3} placeholder={hint} value={value} onChange={e => setField(f, e.target.value)} />
          : <input className="input" placeholder={hint} value={value} onChange={e => setField(f, e.target.value)} />}
      </label>
    })}
    {pw.variants.length > 1 && <Button variant="ghost" className="dim" onClick={removeVariant}>Remove variant {v.id}</Button>}
  </div>
}
