// @vitest-environment happy-dom
// "Send feedback", "Invite a friend" and "Have a code?" against a mocked server: what each sends,
// what each says back — in the person's words, whatever the server's reason.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [])
const answers = vi.hoisted(() => ({}))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(async (path, opts = {}) => {
    calls.push([path, opts.body ? JSON.parse(opts.body) : null])
    const a = answers[path]
    if (a instanceof Error) throw a
    return typeof a === 'function' ? a() : a
  })
}))
const tracked = vi.hoisted(() => [])
vi.mock('../lib/track.js', () => ({ track: (n, p) => tracked.push([n, p]) }))
const shared = vi.hoisted(() => [])
vi.mock('../lib/share.js', () => ({ shareLink: vi.fn(async x => { shared.push(x); return 'shared' }), shareImage: vi.fn(async () => 'shared') }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.__APP_VERSION__ = '9.9.9'

const { useUI } = await import('../store/useUI.js')
const { openFeedback } = await import('./Feedback.jsx')
const { openInvite, openRedeem, inviteLink } = await import('./Invite.jsx')

let host, root
const text = () => host.textContent
// The top sheet, rendered the way Modals renders it.
const renderSheet = () => {
  const sheet = useUI.getState().sheets.at(-1)
  act(() => root.render(sheet ? sheet.render(() => useUI.getState().closeSheet(sheet.id)) : null))
}
const tap = async label => {
  const b = [...host.querySelectorAll('button')].find(x => x.textContent.trim() === label)
  if (!b) throw new Error(`no "${label}" in: ${text()}`)
  await act(async () => { b.click() })
  await act(async () => {})
}
const type = (el, v) => act(() => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const err = (status, code) => Object.assign(new Error('x'), { status, data: { code } })

beforeEach(() => {
  calls.length = 0; tracked.length = 0; shared.length = 0
  for (const k of Object.keys(answers)) delete answers[k]
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Send feedback', () => {
  it('sends the text with the version, the platform and the screen, and thanks', async () => {
    answers['/api/feedback'] = { ok: true }
    openFeedback('first-workout'); renderSheet()
    expect(text()).toContain('Send feedback')
    type(host.querySelector('textarea'), 'The rest timer is too quiet')
    renderSheet()
    await tap('Send')
    expect(calls[0]).toEqual(['/api/feedback', { text: 'The rest timer is too quiet', screen: 'first-workout', version: '9.9.9', platform: 'web', lang: expect.any(String) }])
    expect(useUI.getState().toastMsg).toBe('Thank you! We read every message.')
    expect(useUI.getState().sheets.length).toBe(0)
  })
})

describe('Invite a friend', () => {
  it('shows the code and its link, and shares them with the system sheet', async () => {
    answers['/api/invite'] = { code: 'ANA-7K3P', active: true, days: 30, max: 12, signups: 2, rewarded: 2 }
    openInvite(); renderSheet()
    await act(async () => {})
    renderSheet()
    expect(text()).toContain('ANA-7K3P')
    expect(text()).toContain(inviteLink('ANA-7K3P'))
    expect(inviteLink('ANA-7K3P')).toBe('https://tiza.fit/r/ANA-7K3P')
    expect(text()).toContain('2 friends have joined.')
    expect(text()).toContain('60 extra days earned so far.')
    await tap('Share invite')
    expect(shared[0]).toMatchObject({ url: 'https://tiza.fit/r/ANA-7K3P' })
    expect(shared[0].text).toContain('ANA-7K3P')
    expect(tracked).toContainEqual(['invite_shared', { how: 'shared' }])
  })
})

describe('Have a code?', () => {
  const redeem = async code => {
    type(host.querySelector('input'), code)
    renderSheet()
    await tap('Redeem')
    renderSheet()
  }
  it('a tester code: Pro for good, and the profile’s access handed back', async () => {
    const access = { on: true, plan: 'free', ai: true }
    answers['/api/redeem'] = { ok: true, kind: 'tester', days: 0, access }
    const done = vi.fn()
    openRedeem(done); renderSheet()
    await redeem('beta')
    expect(calls.at(-1)).toEqual(['/api/redeem', { code: 'BETA' }])
    expect(useUI.getState().toastMsg).toBe('Done! You have Pro free for good.')
    expect(done).toHaveBeenCalledWith(access)
  })
  it('says why a code does not work, in the person’s words', async () => {
    openRedeem(); renderSheet()
    for (const [status, code, said] of [
      [409, 'late', 'That code only works in your first week. Codes for testers work any time.'],
      [409, 'own', 'That’s your own code — share it with a friend instead.'],
      [409, 'full', 'That code has no places left.'],
      [404, 'unknown', 'That code doesn’t exist or no longer works.'],
      [429, null, 'Too many tries. Try again in an hour.']
    ]) {
      answers['/api/redeem'] = err(status, code)
      await redeem('X' + code)
      expect(host.querySelector('[role="alert"]').textContent).toBe(said)
    }
  })
})
