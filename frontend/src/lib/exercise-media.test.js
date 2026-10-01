// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ api: null }))
vi.mock('./api.js', () => ({ api: (...a) => mocks.api(...a) }))
const em = await import('./exercise-media.js')

const T0 = Date.parse('2026-10-01T12:00:00Z')
const fail = (status, code) => Object.assign(new Error('HTTP ' + status), { status, code })
const VIDEO = { url: 'https://cdn.test/v.mp4?token=1', poster: 'https://ymove.test/thumb/v?crop=default' }

beforeEach(() => { localStorage.clear(); em._resetExerciseMedia(); mocks.api = vi.fn() })
afterEach(() => localStorage.clear())

describe('exerciseMediaMode', () => {
  it('a server that says nothing shows the dataset as always, and no video', () => {
    expect(em.exerciseMediaMode({ invite_only: false })).toEqual({ dataset: true, video: false })
  })
  it('before the first answer from a server: nothing — unless the build has no server of its own', () => {
    expect(em.exerciseMediaMode(null)).toEqual({ dataset: false, video: false })
    expect(em.exerciseMediaMode(null, { serverless: true })).toEqual({ dataset: true, video: false })
    em.rememberExerciseMedia({})
    expect(em.exerciseMediaMode(null)).toEqual({ dataset: true, video: false })
  })
  it('the hosted version: no dataset, videos where served — and it holds on an offline start', () => {
    const hosted = { exercise_media: { dataset: false, video: true } }
    expect(em.exerciseMediaMode(hosted)).toEqual({ dataset: false, video: true })
    em.rememberExerciseMedia(hosted)
    expect(em.exerciseMediaMode(null).dataset).toBe(false)
    // A server that shows it again (or another one) clears the mark.
    em.rememberExerciseMedia({})
    expect(em.exerciseMediaMode(null).dataset).toBe(true)
  })
})

describe('videoFor', () => {
  it('asks once, keeps the still, and hands the same answer to everyone for a while', async () => {
    mocks.api.mockResolvedValue(VIDEO)
    const now = () => T0
    expect(await em.videoFor('0025', { now })).toEqual(VIDEO)
    expect(await em.videoFor('0025', { now })).toEqual(VIDEO)
    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(mocks.api).toHaveBeenCalledWith('/api/media/video/0025')
    expect(em.stillOf('0025')).toEqual({ poster: VIDEO.poster })
    // Half an hour on, asked again; a failed URL asks with refresh.
    expect(await em.videoFor('0025', { now: () => T0 + 31 * 60000 })).toEqual(VIDEO)
    await em.videoFor('0025', { refresh: true, now: () => T0 + 31 * 60000 })
    expect(mocks.api).toHaveBeenLastCalledWith('/api/media/video/0025?refresh=1')
  })

  it('no video: null, and not asked again soon', async () => {
    mocks.api.mockRejectedValue(fail(404, 'none'))
    expect(await em.videoFor('0043', { now: () => T0 })).toBe(null)
    expect(await em.videoFor('0043', { now: () => T0 + 3600000 })).toBe(null)
    expect(mocks.api).toHaveBeenCalledTimes(1)
  })

  it('busy or offline: the kept still, never an error', async () => {
    mocks.api.mockResolvedValueOnce(VIDEO).mockRejectedValue(fail(0, 'offline'))
    await em.videoFor('0025', { now: () => T0 })
    expect(await em.videoFor('0025', { refresh: true, now: () => T0 })).toEqual({ url: null, poster: VIDEO.poster })
    expect(await em.videoFor('0032', { now: () => T0 })).toBe(null)
  })

  it('switched off on the server: what was kept is dropped', async () => {
    mocks.api.mockResolvedValueOnce(VIDEO).mockRejectedValue(fail(410, 'off'))
    await em.videoFor('0025', { now: () => T0 })
    expect(em.stillOf('0025')).toBeTruthy()
    expect(await em.videoFor('0025', { refresh: true, now: () => T0 })).toBe(null)
    expect(em.stillOf('0025')).toBe(null)
    expect(localStorage.getItem('tiza_video_stills')).toBe(null)
  })

  it('a config without videos drops the stills too', async () => {
    mocks.api.mockResolvedValue(VIDEO)
    await em.videoFor('0025', { now: () => T0 })
    em.rememberExerciseMedia({ exercise_media: { dataset: false, video: false } })
    expect(em.stillOf('0025')).toBe(null)
  })

  it('only https URLs are kept or played', async () => {
    mocks.api.mockResolvedValue({ url: 'javascript:alert(1)', poster: 'http://x.test/p.jpg' })
    expect(await em.videoFor('0025', { now: () => T0 })).toBe(null)
    expect(em.stillOf('0025')).toBe(null)
  })
})

describe('loadPosters', () => {
  it('fills the lists’ stills once per session', async () => {
    mocks.api.mockResolvedValue({ posters: { '0025': 'https://ymove.test/thumb/v?crop=square', bad: 'https://x', '0043': 'http://plain' } })
    const seen = vi.fn()
    em.subscribeStills(seen)
    await em.loadPosters()
    await em.loadPosters()
    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(em.stillOf('0025')).toEqual({ thumb: 'https://ymove.test/thumb/v?crop=square' })
    expect(em.stillOf('0043')).toBe(null)
    expect(seen).toHaveBeenCalled()
  })
})
