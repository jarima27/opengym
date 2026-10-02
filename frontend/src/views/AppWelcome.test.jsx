// @vitest-environment happy-dom
// The store app's first screen: an account with Apple (iPhone only), Google or an e-mail, or none.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ platform: 'ios', provider: null, connect: null, local: null, toast: null }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => mocks.platform } }))
vi.mock('../lib/app-account.js', () => ({
  DEFAULT_SERVER: 'https://app.tiza.fit',
  providersFor: (os, offered) => offered.filter(p => p !== 'apple' || os === 'ios'),
  providerSignIn: (...a) => mocks.provider(...a),
  passwordSignIn: vi.fn(), passwordSignUp: vi.fn()
}))
vi.mock('../store/useStore.js', () => {
  const state = () => ({ chooseLocalMode: mocks.local, connectAccount: mocks.connect })
  const useStore = sel => sel(state())
  useStore.getState = state
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = sel => sel({})
  useUI.getState = () => ({ toast: mocks.toast, openSheet: vi.fn() })
  return { useUI }
})
vi.mock('../lib/welcome.js', () => ({ markWelcome: vi.fn() }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))

const { default: AppWelcome } = await import('./AppWelcome.jsx')

let host, root
beforeEach(() => {
  Object.assign(mocks, { platform: 'ios', provider: vi.fn(), connect: vi.fn(async () => {}), local: vi.fn(), toast: vi.fn() })
  globalThis.fetch = vi.fn(async () => ({ json: async () => ({ social: ['apple', 'google'], password_login: true }) }))
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = async () => { await act(async () => { root.render(<AppWelcome />) }); await act(async () => {}) }
const buttons = () => [...host.querySelectorAll('button')].map(b => b.textContent)

describe('AppWelcome', () => {
  it('iPhone: Apple, Google, e-mail — and always a way in without an account', async () => {
    await mount()
    expect(globalThis.fetch).toHaveBeenCalledWith('https://app.tiza.fit/api/config', expect.anything())
    expect(buttons()).toEqual(expect.arrayContaining(['Continue with Apple', 'Continue with Google', 'Continue with e-mail', 'Use without an account', 'I have my own Tiza server']))
  })

  it('Android: no Apple', async () => {
    mocks.platform = 'android'
    await mount()
    expect(buttons()).not.toContain('Continue with Apple')
    expect(buttons()).toContain('Continue with Google')
  })

  it('a provider sign-in is kept as the account; closing the provider’s sheet says nothing', async () => {
    const session = { base: 'https://app.tiza.fit', token: 't', user: { id: 'u1', name: 'Ada' }, created: true }
    mocks.provider.mockResolvedValueOnce(session).mockRejectedValueOnce(Object.assign(new Error(''), { code: 'cancelled' }))
    await mount()
    const apple = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Continue with Apple')
    await act(async () => { apple().click() })
    expect(mocks.provider).toHaveBeenCalledWith('https://app.tiza.fit', 'apple', { src: { platform: 'ios', lang: 'en' } })
    expect(mocks.connect).toHaveBeenCalledWith(session, expect.any(Function))
    expect(mocks.toast).toHaveBeenCalledWith('Welcome, Ada')
    mocks.toast.mockClear()
    await act(async () => { apple().click() })
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('without an account: this phone only', async () => {
    await mount()
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Use without an account').click() })
    expect(mocks.local).toHaveBeenCalled()
  })
})
