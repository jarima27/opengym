// The website's only script. Three jobs, none of them tracking, nothing stored on the device:
//
//  1. Links into the app carry where the visit came from. A creator's code (?ref=LUCIA) and any
//     campaign tags (?utm_*) in this page's address are added to every link into the app and to
//     every link to another page of the site, so they survive browsing until the sign-up, where
//     the app records them. A visit with no campaign says which page sent it (utm_content).
//     Links to Google Play carry them as the install referrer, which the Android app reads on
//     its first start and signs up with — the creator's code applied on its own.
//  2. With a creator's code, a banner says what it gives — once the app confirms it exists.
//  3. The menu on phones, and the button that stays at the bottom once the top one is gone.
(() => {
  const body = document.body
  const app = (body.dataset.app || '').replace(/\/+$/, '')
  const KEEP = ['ref', 'code', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
  const here = new URLSearchParams(location.search)
  const carry = KEEP.filter(k => here.get(k)).map(k => [k, here.get(k)])
  const hasCampaign = carry.some(([k]) => k === 'utm_source')
  const page = body.dataset.page || 'index'

  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href')
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) continue
    let u
    try { u = new URL(href, location.href) } catch { continue }
    if (u.hostname === 'play.google.com' && carry.length && !u.searchParams.has('referrer')) {
      u.searchParams.set('referrer', new URLSearchParams(carry).toString())
      a.href = u.toString()
      continue
    }
    const toApp = app && u.href.startsWith(app)
    const internal = u.origin === location.origin
    if (!toApp && !internal) continue
    for (const [k, v] of carry) if (!u.searchParams.has(k)) u.searchParams.set(k, v)
    if (toApp && !hasCampaign) {
      u.searchParams.set('utm_source', location.hostname || 'web')
      u.searchParams.set('utm_medium', 'landing')
      u.searchParams.set('utm_content', page)
    }
    if (toApp || carry.length) a.href = u.toString()
  }

  const ref = (here.get('ref') || here.get('code') || '').trim()
  const banner = document.querySelector('.code-banner')
  if (ref && banner && app && /^[\w-]{2,24}$/.test(ref)) {
    fetch(`${app}/api/code?c=${encodeURIComponent(ref)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(c => {
        if (!c || (!c.days && c.kind !== 'tester')) return
        // A creator's code, a friend's invite (api/growth.js), or a tester's: Pro for good.
        const text = c.kind === 'friend' ? body.dataset.friendText : c.kind === 'tester' ? body.dataset.testerText : body.dataset.codeText
        banner.textContent = (text || body.dataset.codeText || '{0}: +{1}').replace('{0}', c.code).replace('{1}', c.days)
        banner.hidden = false
      })
      .catch(() => {})
  }

  const btn = document.querySelector('.menu-btn')
  const nav = document.getElementById('nav')
  if (btn && nav) {
    btn.addEventListener('click', () => {
      const open = body.classList.toggle('nav-open')
      btn.setAttribute('aria-expanded', String(open))
    })
    nav.addEventListener('click', e => { if (e.target.closest('a')) { body.classList.remove('nav-open'); btn.setAttribute('aria-expanded', 'false') } })
  }

  const hero = document.querySelector('.sec-hero')
  const sticky = on => body.classList.toggle('show-sticky', on)
  if (hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => sticky(!e.isIntersecting && e.boundingClientRect.top < 0)).observe(hero)
  } else {
    addEventListener('scroll', () => sticky(scrollY > 500), { passive: true })
  }
})()
