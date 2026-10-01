import { beforeAll, describe, expect, it, vi } from 'vitest'

let acc
beforeAll(async () => {
  vi.stubEnv('VITE_DEFAULT_SERVER', 'app.tiza.fit/')
  vi.stubEnv('VITE_GOOGLE_WEB_CLIENT_ID', 'web.apps.googleusercontent.com')
  vi.stubEnv('VITE_GOOGLE_IOS_CLIENT_ID', 'ios.apps.googleusercontent.com')
  acc = await import('./app-account.js')
})

const BASE = 'https://app.tiza.fit'
const httpAnswering = (status, data) => { const http = { post: vi.fn(async () => ({ status, data })) }; return http }

describe('the store app’s account', () => {
  it('belongs to the default server of the build', () => {
    expect(acc.DEFAULT_SERVER).toBe(BASE)
  })

  it('signs in over native HTTP and keeps the bearer token the server answers', async () => {
    const http = httpAnswering(200, { user: { id: 'u1', name: 'Ada' }, token: 'tok' })
    const s = await acc.passwordSignIn(BASE, { identifier: 'ada@x.es', password: 'pw' }, { http })
    expect(s).toEqual({ base: BASE, token: 'tok', user: { id: 'u1', name: 'Ada' }, created: false })
    const req = http.post.mock.calls[0][0]
    expect(req.url).toBe(BASE + '/api/login/password')
    expect(req.data).toEqual({ identifier: 'ada@x.es', password: 'pw', token: true })
    // No Origin: native HTTP sends none, which is what the server needs to hand over a token.
    expect(Object.keys(req.headers).map(h => h.toLowerCase())).not.toContain('origin')
  })

  it('an account made here asks for the token too, and an answer without one is refused', async () => {
    const http = httpAnswering(200, { user: { id: 'u2', name: 'Grace' }, token: 't2' })
    await acc.passwordSignUp(BASE, { name: 'Grace', email: 'g@x.es', password: 'long enough pw', src: { platform: 'ios' } }, { http })
    expect(http.post.mock.calls[0][0].data).toEqual({ name: 'Grace', email: 'g@x.es', password: 'long enough pw', token: true, src: { platform: 'ios' } })
    await expect(acc.passwordSignIn(BASE, { identifier: 'a', password: 'b' }, { http: httpAnswering(200, { user: { id: 'u' } }) })).rejects.toMatchObject({ code: 'bad-response' })
  })

  it('the server’s refusal comes back with its code, for the screen to word', async () => {
    const http = httpAnswering(401, JSON.stringify({ error: 'wrong name or password', code: 'bad-credentials' }))
    await expect(acc.passwordSignIn(BASE, { identifier: 'a', password: 'b' }, { http })).rejects.toMatchObject({ status: 401, code: 'bad-credentials', data: { code: 'bad-credentials' } })
    const offline = { post: vi.fn(async () => { throw new Error('no network') }) }
    await expect(acc.passwordSignIn(BASE, { identifier: 'a', password: 'b' }, { http: offline })).rejects.toMatchObject({ code: 'offline', status: 0 })
  })

  it('Apple or Google: the provider’s token goes to the server, with the name Apple gives once', async () => {
    const social = { initialize: vi.fn(async () => {}), login: vi.fn(async () => ({ result: { idToken: 'jwt', profile: { givenName: 'Ada', familyName: 'L' } } })) }
    const http = httpAnswering(200, { user: { id: 'u3', name: 'Ada L' }, token: 't3', created: true })
    const s = await acc.providerSignIn(BASE, 'apple', { social, http, src: { platform: 'ios' } })
    expect(s.created).toBe(true)
    expect(http.post.mock.calls[0][0].url).toBe(BASE + '/api/login/social')
    expect(http.post.mock.calls[0][0].data).toEqual({ provider: 'apple', idToken: 'jwt', token: true, name: 'Ada L', src: { platform: 'ios' } })
    await acc.providerSignIn(BASE, 'google', { social, http })
    expect(social.initialize).toHaveBeenLastCalledWith({ google: { webClientId: 'web.apps.googleusercontent.com', iOSClientId: 'ios.apps.googleusercontent.com', mode: 'online' } })
  })

  it('closing the provider’s sheet is not an error to show', async () => {
    const social = { initialize: vi.fn(async () => {}), login: vi.fn(async () => { throw new Error('The user canceled the sign-in flow.') }) }
    await expect(acc.providerSignIn(BASE, 'google', { social, http: httpAnswering(200, {}) })).rejects.toMatchObject({ code: 'cancelled' })
    const broken = { initialize: vi.fn(async () => {}), login: vi.fn(async () => ({ result: {} })) }
    await expect(acc.providerSignIn(BASE, 'google', { social: broken, http: httpAnswering(200, {}) })).rejects.toMatchObject({ code: 'provider' })
  })

  it('Apple only on iPhone; only what the server offers', () => {
    expect(acc.providersFor('ios', ['apple', 'google'])).toEqual(['apple', 'google'])
    expect(acc.providersFor('android', ['apple', 'google'])).toEqual(['google'])
    expect(acc.providersFor('ios', ['google'])).toEqual(['google'])
    expect(acc.providersFor('ios', [])).toEqual([])
  })
})
