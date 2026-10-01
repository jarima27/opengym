import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXDB } from './exercises-data.js'
import { buildMap, candidates, equipmentFits, words } from '../../../scripts/ymove-match.mjs'
import { REVIEW, REVIEWED } from '../../../scripts/build-ymove-map.mjs'

// A few exercises the way YMove's catalogue lists them (titles and equipment, browse mode).
const y = (slug, title, equipment) => ({ id: 'uuid-' + slug, slug, title, equipment })
const YM = [
  y('barbell-bench-press', 'Barbell Bench Press', 'barbell'),
  y('dumbbell-bench-press', 'Dumbbell Bench Press', 'dumbbell'),
  y('barbell-back-squat', 'Barbell Back Squat', 'barbell'),
  y('push-up', 'Push-Up', 'bodyweight'),
  y('pull-up', 'Pull-Up', 'bodyweight'),
  y('dumbbell-lateral-raise', 'Dumbbell Lateral Raise', 'dumbbell'),
  y('cable-lateral-raise', 'Cable Lateral Raise', 'cable'),
  y('barbell-curl', 'Barbell Curl', 'barbell'),
  y('barbell-deadlift', 'Barbell Deadlift', 'barbell'),
  y('romanian-deadlift', 'Romanian Deadlift', 'dumbbell')
]
const byId = Object.fromEntries(EXDB.map(e => [e.id, e]))

describe('ymove-match', () => {
  it('reads titles the same way whichever side spells them', () => {
    expect(words('Push-Up')).toEqual(['push', 'up'])
    expect(words('push-up')).toEqual(['push', 'up'])
    expect(words('Cable Triceps Pushdown (V-Bar)')).toEqual(['cable', 'tricep', 'pushdown', 'bar'])
  })

  it('equipment has to be compatible: a dumbbell video never shows a barbell lift', () => {
    expect(equipmentFits('barbell', 'barbell')).toBe(true)
    expect(equipmentFits('barbell', 'dumbbell')).toBe(false)
    expect(equipmentFits('leverage machine', 'machine')).toBe(true)
    expect(equipmentFits('body weight', 'bodyweight')).toBe(true)
    expect(equipmentFits('anything', 'something-new')).toBe(true)
  })

  it('matches the obvious, one to one, and leaves out what is not clearly the same lift', () => {
    const map = buildMap(EXDB, YM)
    expect(map['0025']).toMatchObject({ ym: 'uuid-barbell-bench-press', by: 'auto' })   // barbell bench press
    expect(map['0289']).toMatchObject({ ym: 'uuid-dumbbell-bench-press' })              // dumbbell bench press
    expect(map['0662']).toMatchObject({ ym: 'uuid-push-up' })                           // push-up
    expect(map['0652']).toMatchObject({ ym: 'uuid-pull-up' })                           // pull-up
    expect(map['0334']).toMatchObject({ ym: 'uuid-dumbbell-lateral-raise' })            // dumbbell lateral raise
    expect(map['0031']).toMatchObject({ ym: 'uuid-barbell-curl' })                      // barbell curl
    expect(map['0032']).toMatchObject({ ym: 'uuid-barbell-deadlift' })                  // barbell deadlift
    // Ours is "barbell full squat": close, not the same words — for the review, not a guess. And
    // never "barbell full squat (back pov)", whose "back" is where the camera stood.
    expect(map['0043']).toBeUndefined()
    expect(Object.values(map).some(e => e.ym === 'uuid-barbell-back-squat')).toBe(false)
    // A dumbbell Romanian deadlift is not our barbell one.
    expect(map['0085']).toBeUndefined()
    // No YMove exercise is given to two of ours.
    const used = Object.values(map).map(e => e.ym).filter(Boolean)
    expect(new Set(used).size).toBe(used.length)
  })

  it('a decision by hand wins, including "no video"', () => {
    const map = buildMap(EXDB, YM, { '0043': 'barbell-back-squat', '0025': null })
    expect(map['0043']).toEqual({ ym: 'uuid-barbell-back-squat', slug: 'barbell-back-squat', title: 'Barbell Back Squat', by: 'review' })
    expect(map['0025']).toEqual({ ym: null, by: 'review' })
    // And what was taken by hand is not matched again elsewhere.
    expect(Object.entries(map).filter(([, e]) => e.ym === 'uuid-barbell-back-squat').map(([id]) => id)).toEqual(['0043'])
    expect(() => buildMap(EXDB, YM, { '0043': 'no-such-slug' })).toThrow(/no such YMove exercise/)
  })

  it('offers the closest candidates for the review, compatible equipment first', () => {
    const c = candidates(byId['0043'], YM)
    expect(c[0].y.slug).toBe('barbell-back-squat')
    expect(c.every((x, i) => i === 0 || c[i - 1].fits >= x.fits)).toBe(true)
  })

  it('the review list and the committed table name real exercises of the catalogue', () => {
    expect(REVIEW.length).toBeGreaterThanOrEqual(50)
    for (const id of [...REVIEW, ...Object.keys(REVIEWED)]) expect(byId[id], id).toBeTruthy()
    const table = JSON.parse(readFileSync(new URL('../../../api/ymove-map.json', import.meta.url), 'utf8'))
    for (const id of Object.keys(table.map)) expect(byId[id], id).toBeTruthy()
  })
})
