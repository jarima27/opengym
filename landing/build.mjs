#!/usr/bin/env node
/* Builds the Tiza website into landing/dist from the Markdown in landing/content.
 *
 *   node landing/build.mjs            the site as it goes live
 *   node landing/build.mjs --drafts   drafts too (draft: true), to look at them locally
 *
 * No dependencies: Node 18 or later is all it needs, which is what a static host's build step
 * has. It refuses to build — so the live site stays as it was — when a page has no title or
 * description, links to a page that does not exist, uses a {{word}} it does not know, or still
 * has a [RELLENAR …] placeholder in it. See landing/README.md for how to write a page. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { frontMatter, escapeHtml, inline, plainText } from './lib/markdown.mjs'
import { renderPage } from './lib/render.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LOCALES = { es: 'es-ES', en: 'en-GB' }

/* ------------------------------ words and numbers ------------------------------ */

function tokens(cfg, lang, site) {
  const locale = LOCALES[lang] || lang
  const money = n => new Intl.NumberFormat(locale, { style: 'currency', currency: cfg.prices.currency }).format(n)
  const { monthly, annual } = cfg.prices
  return {
    name: cfg.name,
    domain: cfg.domain.replace(/^https?:\/\//, ''),
    'price.monthly': money(monthly),
    'price.annual': money(annual),
    'price.annualMonthly': money(Math.round((annual / 12) * 100) / 100),
    'price.saving': Math.round((1 - annual / (monthly * 12)) * 100) + (lang === 'en' ? '%' : '\u00a0%'),
    trial_days: String(cfg.prices.trialDays),
    year: String(new Date().getFullYear()),
    app: signupUrl(cfg),
    source: cfg.source,
    upstream: cfg.upstream.name,
    upstream_url: cfg.upstream.url,
    contact: cfg.contactEmail || '',
    ...Object.fromEntries(Object.entries(site).map(([k, v]) => ['site.' + k, String(v)]))
  }
}
const signupUrl = cfg => cfg.appUrl.replace(/\/+$/, '') + (cfg.appSignupPath || '/#/?signup=1')
const loginUrl = cfg => cfg.appUrl.replace(/\/+$/, '') + (cfg.appLoginPath || '/#/')

function fill(text, words, where, errors) {
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => {
    if (key in words) return words[key]
    errors.push(`${where}: no sé qué es {{${key}}} (válidos: ${Object.keys(words).filter(k => !k.startsWith('site.')).join(', ')})`)
    return m
  })
}

/* ------------------------------------ pages ------------------------------------ */

export function pagePath(cfg, lang, slug) {
  const prefix = lang === cfg.defaultLang ? '' : '/' + lang
  return prefix + (slug && slug !== 'index' ? `/${slug}/` : '/')
}

function readPages(root, cfg, drafts, errors) {
  const pages = []
  for (const lang of cfg.langs) {
    const dir = path.join(root, 'content', lang)
    if (!fs.existsSync(dir)) { errors.push(`falta la carpeta content/${lang}`); continue }
    const siteFile = path.join(dir, '_site.md')
    const site = fs.existsSync(siteFile) ? frontMatter(fs.readFileSync(siteFile, 'utf8')).data : {}
    const ctaFile = path.join(dir, '_cta.md')
    const cta = fs.existsSync(ctaFile) ? fs.readFileSync(ctaFile, 'utf8') : ''
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_')).sort()) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      const { data, body, bodyLine } = frontMatter(src)
      if (data.draft === true && !drafts) continue
      const slug = f.replace(/\.md$/, '')
      pages.push({
        lang, slug, file: `content/${lang}/${f}`, data, body, bodyLine, site, cta,
        path: slug === '404' ? (lang === cfg.defaultLang ? '/404.html' : `/${lang}/404.html`) : pagePath(cfg, lang, slug)
      })
    }
  }
  return pages
}

/* ------------------------------------ html ------------------------------------ */

const hashOf = file => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8)
const abs = (cfg, p) => cfg.domain.replace(/\/+$/, '') + p
const ld = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`

function jsonLd(cfg, page, words, faq) {
  const out = []
  const home = page.slug === 'index'
  if (home) {
    out.push({ '@context': 'https://schema.org', '@type': 'Organization', name: cfg.name, url: abs(cfg, '/'), logo: abs(cfg, '/assets/img/icon-512.png') })
    out.push({
      '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: cfg.name, applicationCategory: 'HealthApplication',
      operatingSystem: 'Web, iOS, Android', url: abs(cfg, page.path), inLanguage: page.lang,
      description: page.data.description,
      offers: [
        { '@type': 'Offer', price: '0', priceCurrency: cfg.prices.currency, name: page.site.plan_free || 'Free' },
        { '@type': 'Offer', price: String(cfg.prices.monthly), priceCurrency: cfg.prices.currency, name: (page.site.plan_pro || 'Pro') + ' · 1 m' },
        { '@type': 'Offer', price: String(cfg.prices.annual), priceCurrency: cfg.prices.currency, name: (page.site.plan_pro || 'Pro') + ' · 12 m' }
      ]
    })
  } else if (!page.path.endsWith('.html')) {
    out.push({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: page.site.breadcrumb_home || cfg.name, item: abs(cfg, pagePath(cfg, page.lang, 'index')) },
        { '@type': 'ListItem', position: 2, name: page.data.nav_title || page.data.title, item: abs(cfg, page.path) }
      ]
    })
  }
  if (faq.length) {
    out.push({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
    })
  }
  return out.map(ld).join('\n')
}

function layout({ cfg, page, pages, main, words, faq, assets }) {
  const s = page.site
  const t = k => escapeHtml(s[k] ?? '')
  const home = pagePath(cfg, page.lang, 'index')
  const homeLink = anchor => (page.slug === 'index' ? `#${anchor}` : `${home}#${anchor}`)
  const title = page.data.title
  const desc = page.data.description
  const canonical = abs(cfg, page.path)
  const others = alternates(cfg, page, pages)
  const og = abs(cfg, page.data.image || `/assets/img/og-${page.lang}.png`)
  const ctx = { appUrl: cfg.appUrl, domain: cfg.domain }
  const guides = pages.filter(p => p.lang === page.lang && p.data.menu === 'guias')
  const legal = pages.filter(p => p.lang === page.lang && p.data.footer === 'legal')
  const tech = pages.find(p => p.lang === page.lang && p.data.footer === 'tech')
  const switchTo = others.filter(o => o.lang !== page.lang)
  const signup = escapeHtml(signupUrl(cfg))
  const noindex = page.data.noindex === true || page.path.endsWith('.html')
  const crumb = page.slug !== 'index' && !page.path.endsWith('.html')
    ? `<nav class="crumbs wrap narrow" aria-label="breadcrumb"><a href="${home}">${t('breadcrumb_home')}</a><span aria-hidden="true">›</span><span>${escapeHtml(page.data.nav_title || title)}</span></nav>` : ''

  return `<!doctype html>
<html lang="${page.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${canonical}">`}
${noindex ? '' : others.map(o => `<link rel="alternate" hreflang="${o.lang}" href="${abs(cfg, o.path)}">`).join('\n')}
${noindex || !others.length ? '' : `<link rel="alternate" hreflang="x-default" href="${abs(cfg, (others.find(o => o.lang === cfg.defaultLang) || others[0]).path)}">`}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(cfg.name)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${og}">
<meta property="og:locale" content="${(LOCALES[page.lang] || page.lang).replace('-', '_')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0b0d12">
<link rel="icon" href="/assets/img/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/img/icon-180.png">
<link rel="stylesheet" href="/assets/styles.css?v=${assets.css}">
${jsonLd(cfg, page, words, faq)}
${cfg.headHtml || ''}
</head>
<body data-app="${escapeHtml(cfg.appUrl)}" data-code-text="${t('code_banner')}" data-friend-text="${t('code_banner_friend')}" data-tester-text="${t('code_banner_tester')}" data-page="${escapeHtml(page.slug)}">
<a class="skip" href="#main">${t('skip')}</a>
<div class="code-banner" role="status" hidden></div>
<header class="top">
  <div class="wrap bar">
    <a class="brand" href="${home}" aria-label="${escapeHtml(cfg.name)}"><img src="/assets/img/logo.png" alt="" width="30" height="30"><span>${escapeHtml(cfg.name)}</span></a>
    <nav class="nav" id="nav" aria-label="${t('menu')}">
      <a href="${homeLink(s.anchor_features)}">${t('nav_features')}</a>
      <a href="${homeLink(s.anchor_import)}">${t('nav_import')}</a>
      <a href="${homeLink(s.anchor_pricing)}">${t('nav_pricing')}</a>
      <a href="${homeLink(s.anchor_faq)}">${t('nav_faq')}</a>
      ${switchTo.map(o => `<a class="lang" href="${o.path}" hreflang="${o.lang}" lang="${o.lang}">${escapeHtml(o.label)}</a>`).join('')}
      <a class="login" href="${escapeHtml(loginUrl(cfg))}" data-app>${t('login')}</a>
    </nav>
    <a class="btn btn-primary btn-sm" href="${signup}" data-app>${t('cta')}</a>
    <button class="menu-btn" type="button" aria-controls="nav" aria-expanded="false" aria-label="${t('menu')}"><span></span><span></span></button>
  </div>
</header>
<main id="main">
${crumb}
${main}
</main>
<footer class="foot">
  <div class="wrap cols">
    <div class="col brand-col">
      <a class="brand" href="${home}"><img src="/assets/img/logo.png" alt="" width="28" height="28"><span>${escapeHtml(cfg.name)}</span></a>
      <p class="dim">${escapeHtml(s.footer_tagline || '')}</p>
    </div>
    <div class="col"><h2>${t('footer_product')}</h2>
      <a href="${homeLink(s.anchor_features)}">${t('nav_features')}</a><a href="${homeLink(s.anchor_import)}">${t('nav_import')}</a>
      <a href="${homeLink(s.anchor_pricing)}">${t('nav_pricing')}</a><a href="${homeLink(s.anchor_faq)}">${t('nav_faq')}</a>
    </div>
    ${guides.length ? `<div class="col"><h2>${t('footer_guides')}</h2>${guides.map(g => `<a href="${g.path}">${escapeHtml(g.data.nav_title || g.data.title)}</a>`).join('')}</div>` : ''}
    <div class="col"><h2>${escapeHtml(cfg.name)}</h2>
      ${tech ? `<a href="${tech.path}">${escapeHtml(tech.data.nav_title || tech.data.title)}</a>` : ''}
      <a href="${escapeHtml(cfg.source)}" rel="noopener">${t('footer_source')}</a>
      ${legal.map(l => `<a href="${l.path}">${escapeHtml(l.data.nav_title || l.data.title)}</a>`).join('')}
      ${cfg.contactEmail ? `<a href="mailto:${escapeHtml(cfg.contactEmail)}">${escapeHtml(cfg.contactEmail)}</a>` : ''}
    </div>
  </div>
  ${s.footer_credit ? `<div class="wrap credit dim">${inline(fill(s.footer_credit, words, 'footer', []), ctx)}</div>` : ''}
</footer>
<div class="sticky-cta"><a class="btn btn-primary" href="${signup}" data-app>${t('cta')}</a><span>${escapeHtml(fill(s.sticky_note || '', words, 'sticky', []))}</span></div>
<script src="/assets/site.js?v=${assets.js}" defer></script>
</body>
</html>
`
}

/** The same page in every language it exists in: itself, and whatever its `translation` names. */
function alternates(cfg, page, pages) {
  const label = lang => (pages.find(p => p.lang === lang)?.site.lang_name) || lang
  if (page.path.endsWith('.html')) return []
  const list = [{ lang: page.lang, path: page.path, label: label(page.lang) }]
  const t = page.data.translation
  if (t) {
    const other = pages.find(p => p.path === t)
    if (other) list.push({ lang: other.lang, path: other.path, label: label(other.lang) })
  } else if (page.slug === 'index') {
    for (const l of cfg.langs) if (l !== page.lang) list.push({ lang: l, path: pagePath(cfg, l, 'index'), label: label(l) })
  }
  // A page with no translation still offers the other language's home in the switcher.
  for (const l of cfg.langs) if (!list.some(o => o.lang === l)) list.push({ lang: l, path: pagePath(cfg, l, 'index'), label: label(l), home: true })
  return list
}

/* ------------------------------------ build ------------------------------------ */

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name)
    if (e.isDirectory()) copyDir(a, b)
    else fs.copyFileSync(a, b)
  }
}

export function build({ root = HERE, out = path.join(root, 'dist'), drafts = false } = {}) {
  const errors = [], warnings = []
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'site.config.json'), 'utf8'))
  const pages = readPages(root, cfg, drafts, errors)
  const paths = new Set(pages.map(p => p.path))
  const assets = { css: hashOf(path.join(root, 'assets', 'styles.css')), js: hashOf(path.join(root, 'assets', 'site.js')) }
  const rendered = []

  for (const page of pages) {
    const where = page.file
    const words = tokens(cfg, page.lang, page.site)
    for (const k of ['title', 'description']) {
      if (!page.data[k]) errors.push(`${where}: falta "${k}:" arriba del todo (entre las líneas ---)`)
      else page.data[k] = fill(page.data[k], words, where, errors)
    }
    if (page.data.title?.length > 65) warnings.push(`${where}: el título tiene ${page.data.title.length} caracteres; Google corta hacia los 60`)
    if (page.data.description && (page.data.description.length > 160 || page.data.description.length < 50)) {
      warnings.push(`${where}: la descripción tiene ${page.data.description.length} caracteres; mejor entre 50 y 160`)
    }
    // Comments are notes for whoever edits the page: never shown, never checked.
    let body = fill(page.body.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, '')), words, where, errors)
    const auto = page.data.cta !== false && page.slug !== 'index' && page.slug !== '404' && page.cta
    if (auto) body += '\n\n' + fill(page.cta, words, `content/${page.lang}/_cta.md`, errors)
    if (/\[RELLENAR/i.test(body) && page.data.draft !== true) errors.push(`${where}: todavía tiene un [RELLENAR …]`)
    const ctx = { lang: page.lang, appUrl: cfg.appUrl, appSignup: signupUrl(cfg), appLogin: loginUrl(cfg), stores: cfg.stores, domain: cfg.domain, site: page.site }
    let r
    try { r = renderPage(body, ctx, page.bodyLine) }
    catch (e) { errors.push(`${where}${e.line ? `, línea ${e.line}` : ''}: ${e.message}`); continue }
    for (const name of r.phones) {
      if (!fs.existsSync(path.join(root, 'assets', 'screens', `${page.lang}-${name}.webp`))) errors.push(`${where}: no hay captura "phone:${name}" (assets/screens/${page.lang}-${name}.webp)`)
    }
    if (page.data.translation && !paths.has(page.data.translation)) warnings.push(`${where}: translation: ${page.data.translation} no es ninguna página`)
    rendered.push({ page, words, r })
  }

  // Every internal link must land on a page or a file of the site.
  for (const { page, r } of rendered) {
    for (const m of r.html.matchAll(/href="(\/[^"#?]*)/g)) {
      const target = m[1]
      if (target.startsWith('/assets/') ? fs.existsSync(path.join(root, target)) : paths.has(target) || paths.has(target + '/')) continue
      errors.push(`${page.file}: enlace roto a ${target}`)
    }
  }
  if (errors.length) return { errors, warnings, pages: [] }

  fs.rmSync(out, { recursive: true, force: true })
  copyDir(path.join(root, 'assets'), path.join(out, 'assets'))
  for (const { page, words, r } of rendered) {
    const html = layout({ cfg, page, pages, main: r.html, words, faq: r.faq, assets })
    const file = page.path.endsWith('.html') ? path.join(out, page.path) : path.join(out, page.path, 'index.html')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, html)
  }

  // For search engines, and for the assistants people now ask instead.
  const listed = rendered.filter(({ page }) => page.data.noindex !== true && !page.path.endsWith('.html'))
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${listed.map(({ page }) => `<url><loc>${abs(cfg, page.path)}</loc>${page.data.updated ? `<lastmod>${page.data.updated}</lastmod>` : ''}${alternates(cfg, page, pages).filter(o => !o.home).map(o => `<xhtml:link rel="alternate" hreflang="${o.lang}" href="${abs(cfg, o.path)}"/>`).join('')}</url>`).join('\n')}
</urlset>
`
  fs.writeFileSync(path.join(out, 'sitemap.xml'), sitemap)
  fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${abs(cfg, '/sitemap.xml')}\n`)
  const home = rendered.find(({ page }) => page.slug === 'index' && page.lang === cfg.defaultLang)
  fs.writeFileSync(path.join(out, 'llms.txt'), `# ${cfg.name}\n\n> ${home ? home.page.data.description : ''}\n\n` +
    cfg.langs.map(l => `## ${l}\n\n` + listed.filter(({ page }) => page.lang === l).map(({ page }) => `- [${page.data.title}](${abs(cfg, page.path)}): ${page.data.description}`).join('\n')).join('\n\n') + '\n')
  // Cloudflare Pages / Netlify: short creator links (/r/LUCIA) and caching.
  fs.writeFileSync(path.join(out, '_redirects'), cfg.langs.map(l => `${l === cfg.defaultLang ? '' : '/' + l}/r/:code ${l === cfg.defaultLang ? '' : '/' + l}/?ref=:code 302`).join('\n') + '\n')
  fs.writeFileSync(path.join(out, '_headers'), `/assets/*.css\n  Cache-Control: public, max-age=31536000, immutable\n/assets/*.js\n  Cache-Control: public, max-age=31536000, immutable\n/assets/*\n  Cache-Control: public, max-age=604800\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`)
  return { errors, warnings, pages: rendered.map(({ page }) => page.path) }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const drafts = process.argv.includes('--drafts')
  const r = build({ drafts })
  for (const w of r.warnings) console.warn('aviso: ' + w)
  if (r.errors.length) {
    for (const e of r.errors) console.error('ERROR: ' + e)
    console.error(`\nNo se ha publicado nada: ${r.errors.length} error(es). La web que está en línea no cambia.`)
    process.exit(1)
  }
  console.log(`${r.pages.length} páginas en landing/dist${drafts ? ' (con borradores)' : ''}.`)
}
