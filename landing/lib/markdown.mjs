/* The Markdown the landing's pages are written in, turned into HTML — no dependency, and only as
 * much Markdown as a marketing page needs, so what it does is easy to predict:
 *
 *   # to ####            headings (each gets an id to link to: "## Precios" → #precios)
 *   paragraphs, - lists, 1. lists, > quotes, --- rules, | tables |
 *   **bold**  *italic*  `code`  [link](url)  ![image](src)
 *   <html>               a line that starts with a tag is passed through as it is
 *   <!-- note -->        comments are dropped: notes for whoever edits the page
 *   ::: name args        a section, closed by a line with only ::: (see render.mjs)
 *
 * And three things that exist for conversion:
 *
 *   a paragraph that is only links is a row of buttons — the first one the main one
 *   [text](app)          the app's sign-up; (app:login) signs in; (ios) and (android) the stores
 *   ![alt](phone:coach)  a real screenshot of the app in a phone frame, in the page's language
 *
 * `### Heading {.featured}` puts a class on what the heading starts (a card, in a section).
 */

export const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function slugify(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-')
}

/** `---` key: value `---` at the top of a file. Values are text; true/false are booleans. */
export function frontMatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
  if (!m) return { data: {}, body: src, bodyLine: 1 }
  const data = {}
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i < 1 || line.trim().startsWith('#')) continue
    const key = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1)
    data[key] = v === 'true' ? true : v === 'false' ? false : v
  }
  return { data, body: src.slice(m[0].length), bodyLine: m[0].split('\n').length }
}

/* ------------------------------------ inline ------------------------------------ */

/** What a link's address really is: app / app:login / ios / android / phone:… resolved. */
export function resolveUrl(url, ctx) {
  if (url === 'app') return ctx.appSignup
  if (url === 'app:login') return ctx.appLogin
  if (url === 'ios' || url === 'android') return ctx.stores?.[url] || ''
  return url
}

export function inline(text, ctx = {}) {
  const slots = []
  const keep = html => `\u0000${slots.push(html) - 1}\u0000`
  let s = String(text)
  // Code first: nothing inside it is Markdown.
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${escapeHtml(c)}</code>`))
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => keep(image(alt, src, ctx)))
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => keep(link(label, url, ctx)))
  s = escapeHtml(s)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[+i])
}

function link(label, url, ctx) {
  const href = resolveUrl(url, ctx)
  const inner = inline(label, ctx)
  // A store that is not live yet: the words stay, the link goes.
  if (!href) return `<span class="soon">${inner}</span>`
  const external = /^https?:/.test(href) && !(ctx.appUrl && href.startsWith(ctx.appUrl)) && !(ctx.domain && href.startsWith(ctx.domain))
  const toApp = ctx.appUrl && href.startsWith(ctx.appUrl)
  return `<a href="${escapeHtml(href)}"${toApp ? ' data-app' : ''}${external ? ' rel="noopener" target="_blank"' : ''}>${inner}</a>`
}

export function image(alt, src, ctx) {
  if (src.startsWith('phone:')) {
    const name = src.slice(6)
    ctx.used?.add?.(name)
    const file = `/assets/screens/${ctx.lang || 'es'}-${name}.webp`
    const eager = ctx.eager?.() ? ' fetchpriority="high"' : ' loading="lazy"'
    return `<span class="phone"><img src="${file}" alt="${escapeHtml(alt)}" width="320" height="693"${eager} decoding="async"></span>`
  }
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`
}

/* ------------------------------------ blocks ------------------------------------ */

const ATTR = /\s*\{\.([\w-]+(?:\s+\.[\w-]+)*)\}\s*$/

/** Markdown lines → a list of blocks, sections included. Each carries the line it started on. */
export function parseBlocks(src, firstLine = 1) {
  const lines = String(src).replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, '')).split(/\r?\n/)
  const root = { type: 'root', children: [] }
  const stack = [root]
  const top = () => stack[stack.length - 1]
  let i = 0
  const lineNo = () => firstLine + i

  while (i < lines.length) {
    const line = lines[i]
    const t = line.trim()
    if (!t) { i++; continue }

    let m
    if ((m = /^:::\s*([\w-]+)(.*)$/.exec(t))) {
      const node = { type: 'section', name: m[1], args: parseArgs(m[2]), children: [], line: lineNo() }
      top().children.push(node)
      stack.push(node)
      i++; continue
    }
    if (t === ':::') {
      if (stack.length === 1) throw Object.assign(new Error('a ::: that closes nothing'), { line: lineNo() })
      stack.pop(); i++; continue
    }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(t))) {
      let text = m[2], cls = null
      const a = ATTR.exec(text)
      if (a) { cls = a[1].split(/\s+\./).join(' '); text = text.slice(0, a.index) }
      top().children.push({ type: 'heading', depth: m[1].length, text, cls, line: lineNo() })
      i++; continue
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) { top().children.push({ type: 'hr' }); i++; continue }
    if (t.startsWith('<')) {
      const html = []
      while (i < lines.length && lines[i].trim()) html.push(lines[i++])
      top().children.push({ type: 'html', html: html.join('\n') })
      continue
    }
    if (t.startsWith('>')) {
      const q = []
      while (i < lines.length && lines[i].trim().startsWith('>')) q.push(lines[i++].trim().replace(/^>\s?/, ''))
      top().children.push({ type: 'quote', lines: q })
      continue
    }
    if (t.startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++].trim())
      top().children.push(table(rows))
      continue
    }
    if (/^[-*]\s+/.test(t) || /^\d+[.)]\s+/.test(t)) {
      const ordered = /^\d/.test(t)
      const items = []
      while (i < lines.length) {
        const l = lines[i].trim()
        if (!l) break
        if (ordered ? /^\d+[.)]\s+/.test(l) : /^[-*]\s+/.test(l)) items.push(l.replace(/^([-*]|\d+[.)])\s+/, ''))
        else if (items.length && /^\s{2,}/.test(lines[i])) items[items.length - 1] += ' ' + l
        else break
        i++
      }
      top().children.push({ type: 'list', ordered, items })
      continue
    }
    const para = []
    while (i < lines.length) {
      const l = lines[i].trim()
      if (!l || /^(#{1,4}\s|:::|[-*]\s|\d+[.)]\s|>|\||<)/.test(l)) break
      para.push(l); i++
    }
    let text = para.join(' '), cls = null
    const a = ATTR.exec(text)
    if (a) { cls = a[1].split(/\s+\./).join(' '); text = text.slice(0, a.index) }
    top().children.push({ type: 'para', text, cls })
  }
  if (stack.length > 1) throw Object.assign(new Error(`the section "::: ${top().name}" is never closed with :::`), { line: top().line })
  return root.children
}

function parseArgs(s) {
  const args = {}
  for (const w of String(s).trim().split(/\s+/).filter(Boolean)) {
    const i = w.indexOf('=')
    if (i > 0) args[w.slice(0, i)] = w.slice(i + 1)
    else args[w] = true
  }
  return args
}

function table(rows) {
  const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
  const head = cells(rows[0])
  const body = rows.slice(rows[1] && /^\|?[\s:-]+\|/.test(rows[1]) ? 2 : 1).map(cells)
  return { type: 'table', head, body }
}

/** Ids are unique on a page: the second "## Precios" is #precios-2, and an explicit section id
    wins over a heading's. */
export function uniqueId(ctx, id) {
  if (!ctx || !ctx.ids) return id
  let out = id, n = 2
  while (ctx.ids.has(out)) out = `${id}-${n++}`
  ctx.ids.add(out)
  return out
}

/** Only links (and the spaces between them): a row of buttons. */
export const isCtaRow = text => /^(\s*!?\[[^\]]+\]\([^)\s]+\)\s*)+$/.test(text) && !/^\s*!\[/.test(text)

export function blockHtml(b, ctx) {
  switch (b.type) {
    case 'heading': {
      const id = uniqueId(ctx, slugify(b.text))
      return `<h${b.depth} id="${id}"${b.cls ? ` class="${b.cls}"` : ''}>${inline(b.text, ctx)}</h${b.depth}>`
    }
    case 'para':
      if (isCtaRow(b.text)) {
        let n = 0
        const btns = b.text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
          const html = link(label, url, ctx)
          const cls = n++ === 0 ? 'btn btn-primary' : 'btn btn-ghost'
          return html.replace(/^<(a|span)/, `<$1 class="${cls}"`)
        })
        return `<p class="cta-row${b.cls ? ' ' + b.cls : ''}">${btns}</p>`
      }
      return `<p${b.cls ? ` class="${b.cls}"` : ''}>${inline(b.text, ctx)}</p>`
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul'
      return `<${tag}>${b.items.map(it => `<li>${inline(it, ctx)}</li>`).join('')}</${tag}>`
    }
    case 'quote': return `<blockquote>${b.lines.filter(Boolean).map(l => `<p>${inline(l, ctx)}</p>`).join('')}</blockquote>`
    case 'table':
      return `<div class="table-wrap"><table><thead><tr>${b.head.map(h => `<th>${inline(h, ctx)}</th>`).join('')}</tr></thead>` +
        `<tbody>${b.body.map(r => `<tr>${r.map(c => `<td>${inline(c, ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    case 'hr': return '<hr>'
    case 'html': return b.html
    default: return ''
  }
}

/** Plain Markdown (no sections) → HTML. The sections are render.mjs's business. */
export function markdown(src, ctx = {}) {
  return parseBlocks(src).map(b => blockHtml(b, ctx)).join('\n')
}

/** The text of a run of blocks, for meta descriptions and FAQ answers in JSON-LD. */
export const plainText = html => String(html).replace(/<\/(p|li|h\d|div|td|th|blockquote)>|<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
