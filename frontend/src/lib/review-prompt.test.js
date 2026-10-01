// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ track: vi.fn() }))
vi.mock('./track.js', () => ({ track: (...a) => mocks.track(...a) }))
const { reviewDue, maybeAskForReview, REVIEW_AFTER } = await import('./review-prompt.js')

beforeEach(() => { localStorage.clear(); mocks.track.mockClear() })

describe('the store review prompt', () => {
  it('is due from the third finished workout, and only if never asked', () => {
    expect(REVIEW_AFTER).toBe(3)
    expect(reviewDue(2, false)).toBe(false)
    expect(reviewDue(3, false)).toBe(true)
    expect(reviewDue(9, false)).toBe(true)
    expect(reviewDue(3, true)).toBe(false)
  })

  it('asks the OS once, in the app only', async () => {
    const plugin = { requestReview: vi.fn(async () => {}) }
    expect(await maybeAskForReview(3, { mobile: false, plugin })).toBe(false)
    expect(await maybeAskForReview(2, { mobile: true, plugin })).toBe(false)
    expect(plugin.requestReview).not.toHaveBeenCalled()
    expect(await maybeAskForReview(3, { mobile: true, plugin })).toBe(true)
    expect(mocks.track).toHaveBeenCalledWith('review_prompted', { count: 3 })
    expect(await maybeAskForReview(4, { mobile: true, plugin })).toBe(false)
    expect(plugin.requestReview).toHaveBeenCalledTimes(1)
  })

  it('a plugin that fails costs nothing, and is not retried every workout', async () => {
    const plugin = { requestReview: vi.fn(async () => { throw new Error('no store') }) }
    expect(await maybeAskForReview(3, { mobile: true, plugin })).toBe(false)
    expect(await maybeAskForReview(4, { mobile: true, plugin })).toBe(false)
    expect(plugin.requestReview).toHaveBeenCalledTimes(1)
  })
})
