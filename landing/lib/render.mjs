/* A page's Markdown, sections included, into the HTML of its <main>.
 *
 * A section is Markdown between `::: name` and `:::`. What each name draws:
 *
 *   hero image=NAME         the top of a page: words on one side, a real screenshot on the other
 *   split image=NAME        the same, further down; `reverse` puts the screenshot first
 *   strip                   a list drawn as a row of short facts
 *   cards [features|pricing] one card per ### heading; `### Name {.featured}` is the highlighted one
 *   steps                   one numbered step per ### heading
 *   faq                     one question per ### heading, its answer below; also sent to Google
 *   testimonials            one card per > quote — drawn only when there is one (real ones only)
 *   cta                     the closing band with the main button
 *   note                    a boxed aside
 *   plain                   just a width-limited block
 *
 * Anything before the first ### of a cards / steps / faq section is its introduction. An `id=`
 * on any section is the anchor menus link to (::: cards pricing id=precios). */
import { blockHtml, escapeHtml, plainText, parseBlocks } from './markdown.mjs'

export const SECTIONS = ['hero', 'split', 'strip', 'cards', 'steps', 'faq', 'testimonials', 'cta', 'note', 'plain']

const html = (blocks, ctx) => blocks.map(b => (b.type === 'section' ? section(b, ctx) : blockHtml(b, ctx))).join('\n')

/** Blocks split at each ### : [intro, [{ heading, blocks }...]]. */
function byH3(children) {
  const intro = []
  const items = []
  for (const b of children) {
    if (b.type === 'heading' && b.depth === 3) items.push({ heading: b, blocks: [] })
    else if (items.length) items[items.length - 1].blocks.push(b)
    else intro.push(b)
  }
  return [intro, items]
}

function phone(name, alt, ctx) {
  if (!name) return ''
  return blockHtml({ type: 'para', text: `![${alt || ''}](phone:${name})` }, ctx).replace(/^<p>|<\/p>$/g, '')
}

function open(node, extra = '') {
  const flags = Object.entries(node.args).filter(([k, v]) => v === true && k !== 'reverse').map(([k]) => 'sec-' + k)
  const cls = ['sec', 'sec-' + node.name, ...flags, node.args.reverse ? 'is-reverse' : '', extra].filter(Boolean).join(' ')
  return `<section class="${cls}"${node.args.id ? ` id="${escapeHtml(node.args.id)}"` : ''}>`
}

function section(node, ctx) {
  if (!SECTIONS.includes(node.name)) {
    throw Object.assign(new Error(`unknown section "::: ${node.name}" — use one of: ${SECTIONS.join(', ')}`), { line: node.line })
  }
  if (node.children.some(c => c.type === 'section')) {
    throw Object.assign(new Error(`"::: ${node.name}" has another section inside it — close it with ::: first`), { line: node.line })
  }
  const alt = node.args.alt ? String(node.args.alt).replace(/_/g, ' ') : (ctx.site?.screenshot_alt || '')
  switch (node.name) {
    case 'hero':
    case 'split': {
      const media = phone(node.args.image, alt, ctx)
      return `${open(node, media ? 'has-media' : '')}<div class="wrap grid"><div class="copy">${html(node.children, ctx)}</div>` +
        (media ? `<div class="media">${media}</div>` : '') + `</div></section>`
    }
    case 'strip': {
      const list = node.children.find(c => c.type === 'list')
      const items = list ? list.items : []
      return `${open(node)}<div class="wrap"><ul class="facts">${items.map(i => `<li>${blockHtml({ type: 'para', text: i }, ctx).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul></div></section>`
    }
    case 'cards':
    case 'steps': {
      const [intro, items] = byH3(node.children)
      const tag = node.name === 'steps' ? 'ol' : 'div'
      const cards = items.map(({ heading, blocks }, i) => {
        const featured = /\bfeatured\b/.test(heading.cls || '')
        const badge = featured && ctx.site?.badge_featured ? `<span class="badge">${escapeHtml(ctx.site.badge_featured)}</span>` : ''
        const inner = `${badge}${blockHtml({ ...heading, cls: null }, ctx)}${html(blocks, ctx)}`
        return node.name === 'steps'
          ? `<li class="step"><span class="num" aria-hidden="true">${i + 1}</span><div>${inner}</div></li>`
          : `<div class="card${featured ? ' is-featured' : ''}">${inner}</div>`
      }).join('')
      return `${open(node)}<div class="wrap">${intro.length ? `<div class="intro">${html(intro, ctx)}</div>` : ''}<${tag} class="${node.name === 'steps' ? 'steps' : 'cards'}">${cards}</${tag}></div></section>`
    }
    case 'faq': {
      const [intro, items] = byH3(node.children)
      const qas = items.map(({ heading, blocks }) => {
        const answer = html(blocks, ctx)
        ctx.faq?.push({ q: plainText(heading.text), a: plainText(answer) })
        return `<details class="qa"><summary>${blockHtml({ ...heading, depth: 3 }, ctx).replace(/^<h3[^>]*>|<\/h3>$/g, '')}</summary><div class="answer">${answer}</div></details>`
      }).join('')
      return `${open(node)}<div class="wrap narrow">${intro.length ? `<div class="intro">${html(intro, ctx)}</div>` : ''}${qas}</div></section>`
    }
    case 'testimonials': {
      const quotes = node.children.filter(c => c.type === 'quote')
      if (!quotes.length) return ''
      const [intro] = byH3(node.children.filter(c => c.type !== 'quote'))
      return `${open(node)}<div class="wrap">${intro.length ? `<div class="intro">${html(intro, ctx)}</div>` : ''}<div class="cards">${quotes.map(q => `<figure class="card quote">${blockHtml(q, ctx)}</figure>`).join('')}</div></div></section>`
    }
    case 'cta':
      return `${open(node)}<div class="wrap narrow center">${html(node.children, ctx)}</div></section>`
    case 'note':
      return `<aside class="note">${html(node.children, ctx)}</aside>`
    case 'plain':
      return `${open(node)}<div class="wrap narrow">${html(node.children, ctx)}</div></section>`
  }
}

/** A page body → { html, faq, phones }. `ctx` carries the language, the app's links and the
    site's own words (content/<lang>/_site.md). */
export function renderPage(body, ctx, firstLine = 1) {
  let first = true
  const faq = []
  const phones = new Set()
  const c = { ...ctx, faq, used: phones, ids: new Set(), eager: () => { const f = first; first = false; return f } }
  const blocks = parseBlocks(body, firstLine)
  // Explicit section anchors are taken first, so a heading never steals one.
  const walk = list => list.forEach(b => { if (b.type === 'section') { if (b.args.id) c.ids.add(String(b.args.id)); walk(b.children) } })
  walk(blocks)
  // A page that is not built of sections is an article: its Markdown sits in one column.
  const sectioned = blocks.some(b => b.type === 'section')
  let out
  if (!sectioned) out = `<article class="wrap narrow prose">${html(blocks, c)}</article>`
  else {
    // Loose Markdown between sections still reads as an article column.
    const parts = []
    let run = []
    const flush = () => { if (run.length) parts.push(`<div class="wrap narrow prose">${html(run, c)}</div>`); run = [] }
    for (const b of blocks) { if (b.type === 'section') { flush(); parts.push(section(b, c)) } else run.push(b) }
    flush()
    out = parts.join('\n')
  }
  return { html: out, faq, phones, sectioned }
}
