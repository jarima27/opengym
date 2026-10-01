// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readArrival, offerDue, readOffer, declineOffer, firstRunDay, listenForNotificationTaps } from './notify.js'

describe('readArrival', () => {
  it('reads the kind and the paywall mark, and gives back the rest of the query', () => {
    expect(readArrival('?n=weekly')).toEqual({ kind: 'weekly', paywall: null, search: '' })
    expect(readArrival('?paywall=trial&n=trial')).toEqual({ kind: 'trial', paywall: 'trial', search: '' })
    expect(readArrival('?tab=prs&n=day')).toEqual({ kind: 'day', paywall: null, search: '?tab=prs' })
  })
  it('a route without the mark, or with a mark that is not a kind, is not an arrival', () => {
    expect(readArrival('')).toBe(null)
    expect(readArrival('?paywall=trial')).toBe(null)
    expect(readArrival('?n=<script>')).toBe(null)
    expect(readArrival('?n=weekly&paywall=x<y').paywall).toBe(null)
  })
})

describe('offerDue', () => {
  it('after the first workout; declined, once more three workouts later; then never', () => {
    expect(offerDue(0, null)).toBe(false)
    expect(offerDue(1, null)).toBe(true)
    expect(offerDue(2, { declined: 1, at: 1 })).toBe(false)
    expect(offerDue(4, { declined: 1, at: 1 })).toBe(true)
    expect(offerDue(40, { declined: 2, at: 4 })).toBe(false)
    expect(offerDue(5, 'junk')).toBe(true)
  })
})

describe('what the device keeps', () => {
  beforeEach(() => { localStorage.clear() })
  it('counts declines', () => {
    expect(readOffer()).toBe(null)
    declineOffer(1)
    expect(readOffer()).toEqual({ declined: 1, at: 1 })
    declineOffer(4)
    expect(readOffer()).toEqual({ declined: 2, at: 4 })
    expect(offerDue(10, readOffer())).toBe(false)
  })
  it('remembers the first day it was asked about, not the day it is asked', () => {
    expect(firstRunDay('2026-10-01')).toBe('2026-10-01')
    expect(firstRunDay('2026-10-09')).toBe('2026-10-01')
  })
})

describe('listenForNotificationTaps', () => {
  it('moves the app to the route the service worker names, and to nothing else', () => {
    const listeners = new Set()
    const sw = { addEventListener: (_, f) => listeners.add(f), removeEventListener: (_, f) => listeners.delete(f) }
    Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true })
    const go = vi.fn()
    const stop = listenForNotificationTaps(go)
    for (const f of listeners) {
      f({ data: { type: 'open', hash: '#/stats?n=weekly' } })
      f({ data: { type: 'open', hash: 'https://evil.example/' } })
      f({ data: { type: 'other', hash: '#/home' } })
    }
    expect(go.mock.calls).toEqual([['/stats?n=weekly']])
    stop()
    expect(listeners.size).toBe(0)
  })
})
