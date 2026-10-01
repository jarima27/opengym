// @vitest-environment happy-dom
// Where the Coach is sold (useCoachAccess.js sellsHere): the website and the store app, on an
// instance that charges, to an account. The store app used to be counted out with every other
// phone build — "nothing is sold in the phone app yet" — so its free accounts saw every pill of the
// Coach's card whole and were never offered Pro.
import { afterEach, describe, expect, it, vi } from 'vitest'

async function sellsHereIn({ mobile = false, server = '', demo = false }) {
  vi.resetModules()
  vi.doMock('../lib/mobile.js', async io => ({ ...(await io()), MOBILE: mobile }))
  vi.doMock('../lib/app-account.js', async io => ({ ...(await io()), DEFAULT_SERVER: server }))
  vi.doMock('../lib/demo.js', async io => ({ ...(await io()), DEMO: demo }))
  return (await import('./useCoachAccess.js')).sellsHere
}
afterEach(() => { vi.doUnmock('../lib/mobile.js'); vi.doUnmock('../lib/app-account.js'); vi.doUnmock('../lib/demo.js') })

describe('sellsHere', () => {
  it('the website sells to an account on an instance that charges, and to nobody else', async () => {
    const sells = await sellsHereIn({})
    expect(sells(true, 'u1')).toBe(true)
    expect(sells(false, 'u1')).toBe(false)
    expect(sells(true, null)).toBe(false)
  })
  it('the store app sells too, through its store', async () => {
    expect((await sellsHereIn({ mobile: true, server: 'https://app.tiza.fit' }))(true, 'u1')).toBe(true)
  })
  it('a phone build without a store sells nothing', async () => {
    expect((await sellsHereIn({ mobile: true }))(true, 'u1')).toBe(false)
  })
  it('the demo sells nothing (it shows the free view instead, from DEMO_STATUS)', async () => {
    expect((await sellsHereIn({ demo: true }))(true, 'u1')).toBe(false)
    const { DEMO_STATUS } = await import('./useCoachAccess.js')
    const { accessOf } = await import('../lib/billing.js')
    expect(accessOf(DEMO_STATUS)).toBe('free')
    expect(DEMO_STATUS.freePlan).toBe(true)
  })
})
