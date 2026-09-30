import { describe, expect, it } from 'vitest'
import { fill, money, annualSaving, planLines, ctaText } from './paywall.js'

const copy = { perMonth: '{0}/mes', perYear: '{0}/año', cta: 'Empezar {0} días gratis', ctaNoTrial: 'Suscribirme', endCta: 'Seguir con el Coach IA' }
const plans = { monthly: { amount: 499, currency: 'EUR', interval: 'month' }, annual: { amount: 3499, currency: 'EUR', interval: 'year' } }

describe('paywall sums', () => {
  it('fills the blanks it has, and leaves the others', () => {
    expect(fill('Empezar {0} días gratis', 30)).toBe('Empezar 30 días gratis')
    expect(fill('{0} y {1}', 'a')).toBe('a y {1}')
  })

  it('prices in the reader’s own format', () => {
    expect(money(plans.monthly, 'es-ES')).toMatch(/^4,99\s€$/)
    expect(money(plans.monthly, 'en-US')).toBe('€4.99')
    expect(money(null, 'es-ES')).toBe('')
  })

  it('34,99 a year against 4,99 a month is 42 % off, and a year is 2,92 a month', () => {
    expect(annualSaving(plans)).toBe(42)
    expect(annualSaving({ monthly: plans.monthly })).toBe(null)
    expect(annualSaving({ monthly: plans.monthly, annual: { amount: 6000, currency: 'EUR' } })).toBe(null)
    expect(annualSaving({ monthly: plans.monthly, annual: { amount: 3499, currency: 'USD' } })).toBe(null)
    const y = planLines('annual', plans.annual, copy, 'es-ES')
    expect(y.main).toMatch(/^34,99\s€\/año$/)
    expect(y.sub).toMatch(/^2,92\s€\/mes$/)
    expect(planLines('monthly', plans.monthly, copy, 'es-ES')).toEqual({ main: expect.stringMatching(/^4,99\s€\/mes$/), sub: '' })
  })

  it('the call to action names the trial only when checking out starts one', () => {
    expect(ctaText({ cardTrialDays: 30, copy }, false)).toBe('Empezar 30 días gratis')
    expect(ctaText({ cardTrialDays: 0, copy }, false)).toBe('Suscribirme')
    expect(ctaText({ cardTrialDays: 0, copy }, true)).toBe('Seguir con el Coach IA')
  })
})
