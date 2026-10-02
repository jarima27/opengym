// node --test landing/test
// The whole site, built for real into a temp folder: the pages, what search engines read, and the
// checks that keep a broken page from going live.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from '../build.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tiza-site-'))
const read = (out, p) => fs.readFileSync(path.join(out, p), 'utf8')

test('the real site builds, in both languages, with nothing broken', () => {
  const out = tmp()
  const r = build({ root: ROOT, out })
  assert.deepEqual(r.errors, [])
  for (const p of ['/', '/en/', '/importar-desde-strong-y-hevy/', '/en/hevy-alternative/', '/app-5x5/']) assert.ok(r.pages.includes(p), p)
  // Drafts (the unfinished legal pages) stay out.
  assert.equal(r.pages.includes('/privacidad/'), false)
  assert.equal(fs.existsSync(path.join(out, 'privacidad')), false)

  const home = read(out, 'index.html')
  assert.match(home, /<html lang="es">/)
  assert.match(home, /<link rel="canonical" href="https:\/\/tiza\.fit\/">/)
  assert.match(home, /hreflang="en" href="https:\/\/tiza\.fit\/en\/"/)
  assert.match(home, /hreflang="x-default" href="https:\/\/tiza\.fit\/"/)
  assert.match(home, /"@type":"FAQPage"/)
  assert.match(home, /"@type":"SoftwareApplication"/)
  assert.match(home, /39,99\s€/, 'prices come from site.config.json, in the page’s own format')
  assert.match(read(out, 'en/index.html'), /€39\.99/)
  assert.doesNotMatch(home, /\{\{|RELLENAR/)

  const sitemap = read(out, 'sitemap.xml')
  assert.match(sitemap, /<loc>https:\/\/tiza\.fit\/alternativa-a-hevy\/<\/loc><xhtml:link rel="alternate" hreflang="es"[^>]*\/><xhtml:link rel="alternate" hreflang="en" href="https:\/\/tiza\.fit\/en\/hevy-alternative\/"\/>/)
  assert.doesNotMatch(sitemap, /404/)
  assert.match(read(out, 'robots.txt'), /Sitemap: https:\/\/tiza\.fit\/sitemap\.xml/)
  assert.match(read(out, '_redirects'), /^\/r\/:code \/\?ref=:code 302$/m)
  assert.ok(fs.existsSync(path.join(out, '404.html')))
  assert.match(read(out, '404.html'), /noindex/)
})

/** A copy of the site to break on purpose. */
function sandbox(edit) {
  const root = tmp()
  for (const d of ['assets', 'content', 'lib']) fs.cpSync(path.join(ROOT, d), path.join(root, d), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'site.config.json'), path.join(root, 'site.config.json'))
  edit(root)
  return build({ root, out: path.join(root, 'dist') })
}
const page = (root, name, src) => fs.writeFileSync(path.join(root, 'content', 'es', name), src)

test('a broken page stops the build, and says which and why', () => {
  const r = sandbox(root => {
    page(root, 'mala.md', '---\ntitle: Mala\n---\n\nVe a [otra](/no-existe/) por {{precio}}. [RELLENAR: algo]\n\n![x](phone:nada)\n')
  })
  const all = r.errors.join('\n')
  assert.match(all, /content\/es\/mala\.md: falta "description:"/)
  assert.match(all, /mala\.md: no sé qué es \{\{precio\}\}/)
  assert.match(all, /mala\.md: todavía tiene un \[RELLENAR/)
  assert.match(all, /mala\.md: no hay captura "phone:nada"/)
  assert.match(all, /mala\.md: enlace roto a \/no-existe\//)
  assert.deepEqual(r.pages, [], 'nothing is written when anything is wrong')
})

test('a new guide appears in the footer of every page of its language, and in the sitemap', () => {
  const root = tmp()
  for (const d of ['assets', 'content', 'lib']) fs.cpSync(path.join(ROOT, d), path.join(root, d), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'site.config.json'), path.join(root, 'site.config.json'))
  page(root, 'app-ppl.md', '---\ntitle: App para PPL · Tiza\ndescription: Entrena empuje, tirón y pierna con progresión automática y el plan incluido en Tiza.\nnav_title: App para PPL\nmenu: guias\n---\n\n# PPL\n\nTexto.\n')
  const out = path.join(root, 'dist')
  const r = build({ root, out })
  assert.deepEqual(r.errors, [])
  assert.match(read(out, 'index.html'), /<a href="\/app-ppl\/">App para PPL<\/a>/)
  assert.match(read(out, 'app-5x5/index.html'), /<a href="\/app-ppl\/">App para PPL<\/a>/)
  assert.match(read(out, 'sitemap.xml'), /https:\/\/tiza\.fit\/app-ppl\//)
  // An article gets the closing call to action and a breadcrumb.
  const ppl = read(out, 'app-ppl/index.html')
  assert.match(ppl, /class="sec sec-cta"/)
  assert.match(ppl, /"@type":"BreadcrumbList"/)
})
