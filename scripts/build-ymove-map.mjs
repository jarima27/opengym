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
  // Reviewed against YMove's catalogue, October 2026. Its studio takes have almost no cable or
  // machine exercises, so those lifts have no video (null) rather than a free-weight stand-in.
  // Presses
  '0025': 'barbell-bench-press-122b71',            // barbell bench press
  '0047': 'incline-barbell-press',                 // barbell incline bench press
  '0030': 'close-grip-bench-barbell',              // barbell close-grip bench press
  '1719': null,                                    // incline close-grip: no such take
  '0289': 'dumbbell-bench-press',                  // dumbbell bench press
  '0314': 'dumbbell-bench-press-incline-e51818',   // dumbbell incline bench press
  '3545': null,                                    // incline *alternate* press: not filmed
  '0091': 'seated-barbell-military-press',         // barbell seated overhead press
  '0086': null,                                    // behind-the-neck press: a different lift
  '1456': null, '1457': null,                      // close / wide grip military press: not filmed
  '0426': 'dumbbell-overhead-press',               // dumbbell standing overhead press
  '0405': 'seated-dumbbell-press',                 // dumbbell seated shoulder press
  '0404': null,                                    // parallel grip: not filmed
  '0361': 'dumbbell-one-arm-shoulder-press-r',     // dumbbell one arm shoulder press
  '0360': 'dumbbell-one-arm-shoulder-press-r',     // the same, v. 2
  '2137': 'dumbbell-arnold-press-4db2d1',          // dumbbell arnold press
  '0577': null,                                    // lever chest press: machine
  '0662': 'push-ups',                              // push-up
  '0251': 'dips',                                  // chest dip
  '0814': 'dips',                                  // triceps dip (parallel bars)
  // Squats, hinges, lunges
  '0043': 'barbell-full-squat',                    // barbell full squat
  '1461': 'barbell-full-squat',                    // the same, filmed from behind
  '1436': 'barbell-back-squat',                    // barbell high bar squat
  '0042': 'front-barbell-squat',                   // barbell front squat
  '1760': 'dumbbell-goblet-squat-202e4f',          // dumbbell goblet squat
  '0032': 'barbell-deadlift',                      // barbell deadlift
  '0085': 'barbell-romanian-deadlift-5c76c6',      // barbell romanian deadlift
  '0117': 'sumo-deadlift-925b68',                  // barbell sumo deadlift
  '0648': null,                                    // power clean: YMove's is a full clean
  '0090': 'seated-good-morning',                   // barbell seated good morning
  '1409': 'barbell-glute-bridge',                  // barbell glute bridge
  '0336': 'dumbbell-lunge',                        // dumbbell lunge
  '0054': 'barbell-lunge',                         // barbell lunge
  '1460': 'walking-lunges',                        // walking lunge
  '0410': 'bulgarian-split-squat-with-dumbbells',  // dumbbell single leg (Bulgarian) split squat
  '0431': 'dumbbell-step-ups-62cf41',              // dumbbell step-up
  '0114': null,                                    // barbell step-up: not filmed
  '3193': null,                                    // glute-ham raise: not filmed
  // Pulls
  '0027': 'bent-over-barbell-row',                 // barbell bent over row
  '0292': 'single-arm-dumbbell-bent-over-row',     // dumbbell one arm bent-over row
  '0652': 'pull-up-overhand-95eeae',               // pull-up
  '0841': 'pull-up-overhand-95eeae',               // weighted pull-up: the same movement
  '1326': null,                                    // chin-up: not filmed
  '0095': 'barbell-shrug',                         // barbell shrug
  '0378': 'bent-over-dumbbell-reverse-fly',        // dumbbell rear fly
  // Arms and shoulders
  '0334': 'dumbbell-lateral-raise-27a4de',         // dumbbell lateral raise
  '0031': 'barbell-curls',                         // barbell curl
  '0294': 'dumbbell-curl',                         // dumbbell biceps curl
  '0313': 'hammer-curls',                          // dumbbell hammer curl
  '0060': 'barbell-skull-crushers-f97e8d',         // barbell skull crusher
  '0061': 'barbell-skull-crushers-f97e8d',         // barbell lying triceps extension
  '0070': null,                                    // preacher curl: no bench take
  // Core
  '0274': 'crunches',                              // crunch floor
  '0472': 'ring-hanging-leg-raise',                // hanging leg raise (rings, same movement)
  // Matched automatically but not the same exercise, on review: no video rather than a wrong one.
  '0028': null,   // barbell clean and press ≠ Barbell Clean (no press)
  '0065': null,   // barbell one arm floor press ≠ Floor Press (two hands)
  '0475': null,   // hanging straight leg raise ≠ Straight Leg Raise (lying on a mat)
  '0624': null,   // march sit (wall) ≠ Wall Sit (no marching)
  '0717': null,   // side push-up ≠ Side to side push up
  '1022': null,   // band standing rear delt row ≠ Standing Band Row
  '3542': null,   // dumbbell incline t-raise ≠ T Raises (standing)
  '3313': null,   // weighted straight bar dip ≠ Weighted Dip (parallel bars)
  '0526': null,   // kettlebell double alternating hang clean ≠ Double Kettlebell Clean
  '0529': null,   // kettlebell double snatch ≠ Kettlebell Snatch (one bell)
  '0539': null,   // kettlebell one arm military press to the side ≠ One-Arm Kettlebell Military Press
  // Cables and machines: no studio take exists
  '0241': null, '2330': null, '1323': null, '0861': null, '0227': null, '0203': null,
  '0194': null, '0739': null, '0585': null, '0586': null, '0605': null, '0596': null,
  '0599': null, '0743': null, '0573': null
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
