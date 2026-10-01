// @vitest-environment happy-dom
// The hosted version's exercise media (spec F10): YMove's studio video in place of the dataset's
// animation — never a Gym visual file, never an empty box.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: { gifSize: 'full' }, config: null, user: { id: 'u1' }, api: null }
  state.snapshot = () => ({ S: state.S, config: state.config, user: state.user, update: mut => { const n = structuredClone(state.S); mut(n); state.S = n } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../lib/api.js', () => ({ api: (...a) => mocks.api(...a) }))

const { default: Media, Thumb } = await import('./Media.jsx')
const em = await import('../lib/exercise-media.js')

const EX = { id: '0025', n: 'barbell bench press', gif: '0025-x.gif', img: '0025-x.jpg' }
const HOSTED = { exercise_media: { dataset: false, video: true } }
const VIDEO = { url: 'https://cdn.test/bench.mp4?token=1', poster: 'https://ymove.test/thumb/bench?crop=default' }
const fail = status => Object.assign(new Error('HTTP ' + status), { status })

let host, root
beforeEach(() => {
  localStorage.clear(); em._resetExerciseMedia()
  Object.assign(mocks, { S: { gifSize: 'full' }, config: HOSTED, user: { id: 'u1' }, api: vi.fn(() => Promise.resolve(VIDEO)) })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const mount = async el => { act(() => root.render(el)); await settle() }
const datasetFiles = () => [...host.querySelectorAll('img, video')].map(e => e.getAttribute('src') || '').filter(s => /(^|\/)(img|gif)\/|\.gif$|0025-x/.test(s))

describe('Media on the hosted version', () => {
  it('plays the studio video in black and white, and never asks for the dataset’s files', async () => {
    await mount(<Media ex={EX} minimizable />)
    const v = host.querySelector('.exmedia.studio video')
    expect(v).toBeTruthy()
    expect(v.getAttribute('src')).toBe(VIDEO.url)
    expect(v.getAttribute('poster')).toBe(VIDEO.poster)
    expect(v.muted).toBe(true)
    expect(v.hasAttribute('playsinline')).toBe(true)
    expect(datasetFiles()).toEqual([])
    expect(mocks.api).toHaveBeenCalledWith('/api/media/video/0025')
    // The workout's size control still works on it.
    act(() => host.querySelector('.giftoggle').click())
    expect(mocks.S.gifSize).toBe('mini')
  })

  it('no video for the exercise: nothing at all, so the card closes up on its text', async () => {
    mocks.api = vi.fn(() => Promise.reject(fail(404)))
    await mount(<Media ex={EX} />)
    expect(host.innerHTML).toBe('')
  })

  it('a URL that will not play is renewed once, then the still stays; a still that fails too leaves nothing', async () => {
    mocks.api = vi.fn()
      .mockResolvedValueOnce(VIDEO)
      .mockResolvedValueOnce({ url: 'https://cdn.test/bench.mp4?token=2', poster: VIDEO.poster })
    await mount(<Media ex={EX} />)
    await act(async () => { host.querySelector('video').dispatchEvent(new Event('error')) })
    await settle()
    expect(mocks.api).toHaveBeenLastCalledWith('/api/media/video/0025?refresh=1')
    expect(host.querySelector('video').getAttribute('src')).toBe('https://cdn.test/bench.mp4?token=2')
    await act(async () => { host.querySelector('video').dispatchEvent(new Event('error')) })
    expect(host.querySelector('video')).toBe(null)
    expect(host.querySelector('.exmedia.studio img').getAttribute('src')).toBe(VIDEO.poster)
    await act(async () => { host.querySelector('img').dispatchEvent(new Event('error')) })
    expect(host.innerHTML).toBe('')
  })

  it('switched off, or signed out: nothing — and still no dataset file', async () => {
    mocks.config = { exercise_media: { dataset: false, video: false } }
    await mount(<Media ex={EX} />)
    expect(host.innerHTML).toBe('')
    mocks.config = HOSTED; mocks.user = null
    await mount(<Media ex={EX} />)
    expect(host.innerHTML).toBe('')
    expect(mocks.api).not.toHaveBeenCalled()
  })

  it('lists: the square still once anybody has opened the exercise, else the neutral tile', async () => {
    mocks.api = vi.fn(p => Promise.resolve(p === '/api/media/posters' ? { posters: { '0025': 'https://ymove.test/thumb/bench?crop=square' } } : VIDEO))
    await mount(<><Thumb ex={EX} /><Thumb ex={{ ...EX, id: '0043' }} /></>)
    const imgs = host.querySelectorAll('img.thumb.studio')
    expect(imgs.length).toBe(1)
    expect(imgs[0].getAttribute('src')).toBe('https://ymove.test/thumb/bench?crop=square')
    expect(host.querySelectorAll('.thumb-x').length).toBe(1)
    expect(datasetFiles()).toEqual([])
  })

  it('a self-hosted instance is untouched: the dataset’s animation, as always', async () => {
    mocks.config = {}
    await mount(<Media ex={EX} />)
    expect(host.querySelector('.exmedia img').getAttribute('src')).toBe('gif/0025-x.gif')
    expect(mocks.api).not.toHaveBeenCalled()
  })
})
