// node --test landing/test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markdown, frontMatter, inline, slugify, isCtaRow } from '../lib/markdown.mjs'
import { renderPage } from '../lib/render.mjs'

const ctx = { lang: 'es', appUrl: 'https://app.tiza.fit', appSignup: 'https://app.tiza.fit/#/?signup=1', appLogin: 'https://app.tiza.fit/#/', stores: { ios: '', android: 'https://play.google.com/x' }, site: { badge_featured: 'El más elegido' } }

test('front matter: text, booleans, comments; the body after it', () => {
  const { data, body } = frontMatter('---\ntitle: Hola: mundo\ndraft: true\n# nota\nx: "y"\n---\n# Cuerpo\n')
  assert.deepEqual(data, { title: 'Hola: mundo', draft: true, x: 'y' })
  assert.equal(body, '# Cuerpo\n')
})

test('the Markdown a page needs, escaped where it is text', () => {
  const html = markdown('## Precios claros\n\nUn **gran** día *de* <b>verdad</b>.\n\n- uno\n- dos\n\n1. a\n2. b\n\n> cita\n\n| a | b |\n|---|---|\n| 1 | 2 |', ctx)
  assert.match(html, /<h2 id="precios-claros">Precios claros<\/h2>/)
  assert.match(html, /<p>Un <strong>gran<\/strong> día <em>de<\/em> &lt;b&gt;verdad&lt;\/b&gt;\.<\/p>/)
  assert.match(html, /<ul><li>uno<\/li><li>dos<\/li><\/ul>/)
  assert.match(html, /<ol><li>a<\/li><li>b<\/li><\/ol>/)
  assert.match(html, /<blockquote><p>cita<\/p><\/blockquote>/)
  assert.match(html, /<th>a<\/th><th>b<\/th>.*<td>1<\/td><td>2<\/td>/)
})

test('a line of only links is a row of buttons, the first one the main one', () => {
  assert.equal(isCtaRow('[Empieza](app) [Mira](#x)'), true)
  assert.equal(isCtaRow('Texto con [un enlace](app)'), false)
  const html = markdown('[Empieza gratis](app) [Guía](/importar/)', ctx)
  assert.match(html, /<p class="cta-row"><a class="btn btn-primary" href="https:\/\/app\.tiza\.fit\/#\/\?signup=1" data-app>Empieza gratis<\/a> <a class="btn btn-ghost" href="\/importar\/">Guía<\/a><\/p>/)
})

test('app, store and phone links resolve; a store that is not live loses its link, not its words', () => {
  assert.match(inline('[Entrar](app:login)', ctx), /href="https:\/\/app\.tiza\.fit\/#\/"/)
  assert.match(inline('[Android](android)', ctx), /href="https:\/\/play\.google\.com\/x" rel="noopener" target="_blank"/)
  assert.equal(inline('[iPhone](ios)', ctx), '<span class="soon">iPhone</span>')
  assert.match(inline('![Coach](phone:coach)', ctx), /<span class="phone"><img src="\/assets\/screens\/es-coach\.webp" alt="Coach"/)
})

test('headings get ids without accents, unique on the page', () => {
  assert.equal(slugify('¿Qué pasa al acabar la prueba?'), 'que-pasa-al-acabar-la-prueba')
  const { html } = renderPage('::: plain id=precios\n## Precios\n## Precios\n:::\n', ctx)
  assert.match(html, /id="precios"[\s\S]*id="precios-2"[\s\S]*id="precios-3"/)
})

test('sections: cards with a featured one, steps, faq for Google, testimonials only when real', () => {
  const body = [
    '::: cards pricing id=precios', '## Precios', '### Gratis', '- a', '### Pro {.featured}', '**34,99 €** al año {.price}', ':::',
    '::: steps', '### Exporta', 'Texto.', '### Importa', 'Texto.', ':::',
    '::: faq', '### ¿Es gratis?', 'Sí, *siempre*.', ':::',
    '::: testimonials', '## Opiniones', '<!-- > «Inventado» -->', ':::'
  ].join('\n')
  const r = renderPage(body, ctx)
  assert.match(r.html, /<section class="sec sec-cards sec-pricing" id="precios">/)
  assert.match(r.html, /<div class="card is-featured"><span class="badge">El más elegido<\/span><h3 id="pro">Pro<\/h3><p class="price"><strong>34,99 €<\/strong> al año<\/p>/)
  assert.match(r.html, /<li class="step"><span class="num" aria-hidden="true">2<\/span>/)
  assert.match(r.html, /<details class="qa"><summary>¿Es gratis\?<\/summary><div class="answer"><p>Sí, <em>siempre<\/em>\.<\/p><\/div><\/details>/)
  assert.deepEqual(r.faq, [{ q: '¿Es gratis?', a: 'Sí, siempre.' }])
  assert.doesNotMatch(r.html, /Opiniones|Inventado/, 'no testimonials, no section')
})

test('mistakes say where they are', () => {
  assert.throws(() => renderPage('::: carrusel\nhola\n:::', ctx), e => /unknown section "::: carrusel"/.test(e.message) && e.line === 1)
  assert.throws(() => renderPage('texto\n\n::: cards\n### a\n', ctx), e => /never closed/.test(e.message) && e.line === 3)
  assert.throws(() => renderPage(':::\n', ctx), /closes nothing/)
})
