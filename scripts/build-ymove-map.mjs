#!/usr/bin/env node
/**
 * Build api/ymove-map.json — which YMove exercise video shows each exercise of our catalogue
 * (spec F10, api/ymove.js).
 *
 * Usage:
 *   YMOVE_API_KEY=ym_… node scripts/build-ymove-map.mjs [--report review.md]
 *   node scripts/build-ymove-map.mjs --catalogue ymove.json [--report review.md]
 *   YMOVE_API_KEY=ym_… node scripts/build-ymove-map.mjs --save-catalogue ymove.json
 *
 * YMove's catalogue is read in browse mode (excludeVideos=1): titles and equipment only, no
 * video URLs, nothing counted against the monthly cap. Only exercises with a studio take
 * (hasVideoWhite) are considered — the only videos the app shows.
 *
 * The matching is scripts/ymove-match.mjs: conservative, a missing video rather than a wrong one.
 * The most used lifts (REVIEW below) are decided by hand in REVIEWED, which wins over everything;
 * the report lists each of them with what was matched and the closest candidates, so the next
 * person reviewing can see at a glance what to confirm, change or rule out.
 *
 * The key is read from the environment or a local .env; it is never written anywhere.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EXDB } from '../frontend/src/lib/exercises-data.js'
import { buildMap, candidates } from './ymove-match.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'api/ymove-map.json')
const API = (process.env.YMOVE_API_BASE || 'https://exercise-api.ymove.app/api/v2').replace(/\/+$/, '')

/* Decided by hand: our id → YMove slug (or id), or null when YMove has nothing that is the same
   lift. Final — the automatic matching never overrides these. Fill from the report. */
export const REVIEWED = {
}

/* The ~50 most used lifts, reviewed by hand: everything in the starter plans and the structural
   balance lifts, then the classics people log most. */
export const REVIEW = [
  // Starter plans (lib/starter.js) and structural balance (lib/structuralBalanceTemplates.js).
  '0025', '0047', '0426', '0334', '0241', '0251', '2330', '0027', '1323', '0031', '0313', '0043',
  '0085', '0739', '0585', '0586', '0605', '0030', '1719', '0652', '0841', '1436', '0042', '0032',
  '0648', '0091', '1456', '1457', '0086', '0090', '0114', '0431', '3193', '0314', '3545', '0405',
  '0404', '0361', '0360',
  // The classics.
  '0289', '0662', '1326', '1409', '1760', '0336', '0117', '0861', '0292', '0227', '0596', '0095',
  '0472', '0274', '0203', '0378', '0599', '0743', '0070', '0194', '0060', '0410', '0294', '0577',
  '2137', '0573', '0054', '1460'
]

function apiKey() {
  const fromEnv = (process.env.YMOVE_API_KEY || '').trim()
  if (fromEnv) return fromEnv
  const envPath = join(ROOT, '.env')
  if (!existsSync(envPath)) return ''
  const m = readFileSync(envPath, 'utf8').match(/^YMOVE_API_KEY\s*=\s*(.*)$/m)
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : ''
}

/** Every exercise with a studio take, in browse mode: no video URLs, no quota spent. */
async function fetchCatalogue(key) {
  const all = []
  for (let page = 1; ; page++) {
    const u = `${API}/exercises?excludeVideos=1&includeVideos=false&hasVideoWhite=true&pageSize=50&page=${page}`
    const r = await fetch(u, { headers: { 'X-API-Key': key, Accept: 'application/json' } })
    if (r.status === 429) { await new Promise(res => setTimeout(res, 2000)); page--; continue }
    if (!r.ok) throw new Error(`YMove answered ${r.status} for page ${page}: ${(await r.text()).slice(0, 200)}`)
    const body = await r.json()
    if (body?.data?.some(e => e.videoUrl || e.videos?.some(v => v.videoUrl))) throw new Error('YMove sent video URLs: browse mode was not honoured, stopping before more quota is spent')
    for (const e of body.data || []) all.push({ id: e.id, slug: e.slug, title: e.title, equipment: e.equipment, muscleGroup: e.muscleGroup })
    if (page >= (body.pagination?.totalPages || 1)) break
  }
  return all
}

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }

async function main() {
  let ymoves
  const from = arg('--catalogue')
  if (from) ymoves = JSON.parse(readFileSync(from, 'utf8'))
  else {
    const key = apiKey()
    if (!key) { console.error('YMOVE_API_KEY is not set (environment or .env).'); process.exit(1) }
    ymoves = await fetchCatalogue(key)
    console.error(`YMove: ${ymoves.length} exercises with a studio video.`)
  }
  const save = arg('--save-catalogue')
  if (save) { writeFileSync(save, JSON.stringify(ymoves, null, 1)); console.error(`Catalogue saved to ${save}.`) }

  const map = buildMap(EXDB, ymoves, REVIEWED)
  const sorted = Object.fromEntries(Object.keys(map).sort().map(k => [k, map[k]]))
  const withVideo = Object.values(map).filter(e => e.ym).length
  const prev = JSON.parse(readFileSync(OUT, 'utf8'))
  writeFileSync(OUT, JSON.stringify({
    _about: prev._about,
    generated: new Date().toISOString().slice(0, 10),
    counts: { catalogue: EXDB.length, ymove: ymoves.length, withVideo, reviewed: Object.keys(REVIEWED).length },
    map: sorted
  }, null, 1) + '\n')
  console.error(`api/ymove-map.json: ${withVideo} of ${EXDB.length} exercises have a video (${Object.keys(REVIEWED).length} reviewed by hand).`)

  // The review sheet for the most used lifts.
  const byId = Object.fromEntries(EXDB.map(e => [e.id, e]))
  const lines = ['| id | our exercise | equipment | matched | by | closest in YMove |', '|---|---|---|---|---|---|']
  for (const id of REVIEW) {
    const ex = byId[id]
    if (!ex) continue
    const m = map[id]
    const near = candidates(ex, ymoves).map(c => `${c.y.slug} (${c.s.toFixed(2)}${c.fits ? '' : ', other equipment'})`).join('<br>')
    lines.push(`| ${id} | ${ex.n} | ${ex.eq} | ${m?.ym ? m.slug : '—'} | ${m?.by || ''} | ${near} |`)
  }
  const report = lines.join('\n') + '\n'
  const to = arg('--report')
  if (to) { writeFileSync(to, report); console.error(`Review sheet: ${to}`) } else process.stdout.write(report)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e.message); process.exit(1) })
}
