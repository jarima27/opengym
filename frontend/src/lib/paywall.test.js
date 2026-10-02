import { describe, expect, it } from 'vitest'
import { fill, money, annualSaving, planLines, ctaText, fillNamed, titleFor, timelineText, perWeek, badgeText, exitLines } from './paywall.js'

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

describe('F12: the price a week, the saving, the offer made once', () => {
  const c = { ...copy, perWeek: '{0}/semana', annualBadge: 'Ahorra un {0} %', exitTitle: 'Antes de irte: {0} el primer año',
    exitBody: 'Con la misma prueba de {0} días gratis. Después, {1} el primer año y {2} a partir del segundo.' }
  const now = { monthly: { amount: 799, currency: 'EUR', interval: 'month' }, annual: { amount: 3999, currency: 'EUR', interval: 'year' } }
  it('39,99 a year is 0,77 a week and 58 % off twelve months of 7,99 (1,84 a week)', () => {
    expect(perWeek('annual', now.annual)).toEqual({ amount: 77, currency: 'EUR' })
    expect(perWeek('monthly', now.monthly)).toEqual({ amount: 184, currency: 'EUR' })
    expect(annualSaving(now)).toBe(58)
    expect(badgeText(c, 58)).toBe('Ahorra un 58 %')
    expect(badgeText(c, null)).toBe('', 'no saving to state, no badge')
    expect(badgeText({ annualBadge: 'Ahorra más' }, 58)).toBe('Ahorra más · −58%')
    const y = planLines('annual', now.annual, c, 'es-ES')
    expect(y.main).toMatch(/^0,77\s€\/semana$/)
    expect(y.sub).toMatch(/^39,99\s€\/año$/)
    const m = planLines('monthly', now.monthly, c, 'es-ES')
    expect(m.main).toMatch(/^1,84\s€\/semana$/)
    expect(m.sub).toMatch(/^7,99\s€\/mes$/)
  })
  it('the exit offer quotes the first year and the full price, and the trial only when there is one', () => {
    const first = { amount: 2999, currency: 'EUR' }
    const e = exitLines(c, { first, full: now.annual, trialDays: 7 }, 'es-ES')
    expect(e.title).toMatch(/^Antes de irte: 29,99\s€ el primer año$/)
    expect(e.body).toMatch(/^Con la misma prueba de 7 días gratis\. Después, 29,99\s€ el primer año y 39,99\s€ a partir del segundo\.$/)
    expect(exitLines(c, { first, full: now.annual, trialDays: 0 }, 'es-ES').body).toBe('')
    expect(exitLines(c, { first: null, full: now.annual }, 'es-ES')).toBe(null)
  })
})

describe('the person’s own data on the paywall', () => {
  const c = {
    title: 'Un Coach que revisa tu semana', titleStall: 'Deja de estancarte en {exercise}',
    titleComeback: '¿Unos días fuera? El Coach puede reajustar tu semana.', titleDay7: 'Tu plan ha funcionado esta semana.',
    timeline: 'Hoy: todo Pro desbloqueado · Día {0}: te avisamos · Día {1}: empieza el pago.'
  }
  it('fills named blanks, and gives up on a line whose blank has no data', () => {
    expect(fillNamed('Deja de estancarte en {exercise}', { exercise: 'Sentadilla' })).toBe('Deja de estancarte en Sentadilla')
    expect(fillNamed('{missed} sesiones sin hacer', {})).toBe(null)
    expect(fillNamed('{missed} sesiones', { missed: 0 })).toBe('0 sesiones')
    expect(fillNamed('Empezar {0} días gratis', {})).toBe('Empezar {0} días gratis')
    expect(fillNamed('', {})).toBe(null)
  })
  it('the moment’s own title when it can be filled, the general one otherwise', () => {
    expect(titleFor(c, 'stall', { exercise: 'Sentadilla' })).toBe('Deja de estancarte en Sentadilla')
    expect(titleFor(c, 'pill:stall', { exercise: 'Press banca' })).toBe('Deja de estancarte en Press banca')
    expect(titleFor(c, 'stall', {})).toBe('Un Coach que revisa tu semana')
    expect(titleFor(c, 'comeback')).toBe('¿Unos días fuera? El Coach puede reajustar tu semana.')
    expect(titleFor(c, 'settings')).toBe('Un Coach que revisa tu semana')
  })
  it('the trial’s timeline: the reminder two days before the first charge, only with a trial', () => {
    expect(timelineText(c, 7)).toBe('Hoy: todo Pro desbloqueado · Día 5: te avisamos · Día 7: empieza el pago.')
    expect(timelineText(c, 0)).toBe(null)
    expect(timelineText({}, 30)).toBe(null)
  })
})
