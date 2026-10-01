// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ MOBILE: true, perm: 'prompt', sync: null, track: null }))
vi.mock('../lib/mobile.js', async importOriginal => ({
  ...(await importOriginal()),
  get MOBILE() { return mocks.MOBILE },
  notificationPermission: () => Promise.resolve(mocks.perm),
  syncReminder: (...a) => mocks.sync(...a),
}))
vi.mock('../lib/track.js', () => ({ track: (...a) => mocks.track(...a) }))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn() }))

const { default: NotifyOffer } = await import('./NotifyOffer.jsx')

let host, root, originalS
beforeEach(() => {
  localStorage.clear()
  mocks.MOBILE = true
  mocks.perm = 'prompt'
  mocks.sync = vi.fn(() => Promise.resolve(true))
  mocks.track = vi.fn()
  originalS = useStore.getState().S
  useStore.setState({ S: { ...originalS, reminder: { on: false, time: '08:00', tz: null } } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.render(null))
  useStore.setState({ S: originalS })
  host.remove()
})

const mount = async count => { await act(async () => { root.render(<NotifyOffer count={count} />) }) }
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)

describe('NotifyOffer', () => {
  it('after the first workout, a yes asks the phone and turns the reminders on', async () => {
    await mount(1)
    expect(host.textContent).toContain('Don’t let a workout slip by')
    expect(mocks.track).toHaveBeenCalledWith('notifications_prompted', { count: 1 })
    await act(async () => { button('Turn on reminders').click() })
    expect(mocks.sync).toHaveBeenCalledTimes(1)
    const [asked, interactive] = mocks.sync.mock.calls[0]
    expect(asked.reminder.on).toBe(true)
    expect(interactive).toBe(true)
    expect(useStore.getState().S.reminder.on).toBe(true)
    expect(useStore.getState().S.reminder.tz).toBeTruthy()
    expect(mocks.track).toHaveBeenCalledWith('notifications_enabled', { from: 'finish', count: 1 })
    expect(host.textContent).toBe('')
  })

  it('"Not now" is remembered, and the next workouts do not ask again until three later', async () => {
    await mount(1)
    await act(async () => { button('Not now').click() })
    expect(host.textContent).toBe('')
    expect(mocks.sync).not.toHaveBeenCalled()
    act(() => root.render(null))
    await mount(2)
    expect(host.textContent).toBe('')
    act(() => root.render(null))
    await mount(4)
    expect(host.textContent).toContain('Turn on reminders')
  })

  it('stays away where it cannot work or has had its answer', async () => {
    await mount(0)
    expect(host.textContent).toBe('')
    mocks.perm = 'granted'
    await mount(3)
    expect(host.textContent).toBe('')
    // a browser without Web Push
    mocks.MOBILE = false
    mocks.perm = 'prompt'
    act(() => root.render(null))
    await mount(1)
    expect(host.textContent).toBe('')
    expect(mocks.track).not.toHaveBeenCalled()
  })
})
