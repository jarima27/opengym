// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { referrerAttribution, readInstallReferrer } from './install-referrer.js'
import { attribution } from './attribution.js'

beforeEach(() => { localStorage.clear() })

describe('the Google Play install referrer', () => {
  it('a creator’s code and campaign tags from a store link; nothing from an install without one', () => {
    expect(referrerAttribution('ref=lucia&utm_source=instagram&utm_campaign=launch')).toEqual({ ref: 'LUCIA', utm_source: 'instagram', utm_campaign: 'launch' })
    expect(referrerAttribution('utm_source=google-play&utm_medium=organic')).toBe(null)
    expect(referrerAttribution('')).toBe(null)
    expect(referrerAttribution(null)).toBe(null)
  })

  it('read once on the first start, and the sign-up carries the code', async () => {
    const plugin = { get: vi.fn(async () => ({ referrer: 'ref=LUCIA&utm_source=tiktok' })) }
    expect(await readInstallReferrer({ mobile: true, platform: 'android', plugin })).toEqual({ ref: 'LUCIA', utm_source: 'tiktok' })
    expect(attribution()).toMatchObject({ ref: 'LUCIA', utm_source: 'tiktok' })
    expect(await readInstallReferrer({ mobile: true, platform: 'android', plugin })).toBe(null)
    expect(plugin.get).toHaveBeenCalledTimes(1)
  })

  it('not on an iPhone, not in a browser, and never in the way', async () => {
    const plugin = { get: vi.fn(async () => ({ referrer: 'ref=LUCIA' })) }
    expect(await readInstallReferrer({ mobile: true, platform: 'ios', plugin })).toBe(null)
    expect(await readInstallReferrer({ mobile: false, platform: 'android', plugin })).toBe(null)
    expect(plugin.get).not.toHaveBeenCalled()
    const broken = { get: vi.fn(async () => { throw new Error('no Play') }) }
    expect(await readInstallReferrer({ mobile: true, platform: 'android', plugin: broken })).toBe(null)
  })
})
