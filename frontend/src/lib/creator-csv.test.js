import { describe, expect, it } from 'vitest'
import { creatorCsv, playLink, CSV_HEAD } from './creator-csv.js'
import { referrerAttribution } from './install-referrer.js'

describe('the creator program as a CSV', () => {
  const rows = [
    { code: 'LUCIA', label: 'Lucía, "fit"', days: 14, appleOffer: 'LUCIA30', signups: 3, trials: 2, paying: 1, refunds: 1 },
    { code: 'PACO', label: '=HYPERLINK("x")', days: 7, appleOffer: '', signups: 0, trials: 0, paying: 0, refunds: 0 }
  ]
  it('one row per code, quoted where it must be, never a formula', () => {
    const csv = creatorCsv(rows, '2026-10')
    expect(csv.split('\r\n')[0]).toBe(CSV_HEAD.join(','))
    expect(csv).toContain('2026-10,LUCIA,"Lucía, ""fit""",14,LUCIA30,3,2,1,1\r\n')
    expect(csv).toContain(`2026-10,PACO,"'=HYPERLINK(""x"")",7,,0,0,0,0\r\n`)
    expect(creatorCsv([{ ...rows[0], month: '2026-09' }]).split('\r\n')[1].startsWith('2026-09,LUCIA')).toBe(true)
    expect(creatorCsv(rows.slice(0, 1)).split('\r\n')[1].startsWith('all,LUCIA')).toBe(true)
  })
  it('the Play Store link carries the code, and the app reads it back', () => {
    const link = playLink('LUCIA')
    expect(link).toBe('https://play.google.com/store/apps/details?id=fit.tiza.app&referrer=ref%3DLUCIA')
    expect(referrerAttribution(new URL(link).searchParams.get('referrer'))).toEqual({ ref: 'LUCIA' })
  })
})
