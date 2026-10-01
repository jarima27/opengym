// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest'
import { readAttribution, captureAttribution, attribution, clearAttribution, pendingCode } from './attribution.js'

describe('readAttribution', () => {
  it('reads a creator code and campaign tags before or after the hash', () => {
    expect(readAttribution('https://app.example/?ref=lucia&utm_source=instagram#/')).toEqual({ ref: 'LUCIA', utm_source: 'instagram' })
    expect(readAttribution('https://app.example/#/home?ref=Lucia&utm_campaign=launch')).toEqual({ ref: 'LUCIA', utm_campaign: 'launch' })
    expect(readAttribution('https://app.example/?code=PT_MARTA')).toEqual({ ref: 'PT_MARTA' })
  })
  it('keeps nothing from a link that carries nothing, or a malformed code', () => {
    expect(readAttribution('https://app.example/#/settings')).toBe(null)
    expect(readAttribution('https://app.example/?ref=<script>')).toBe(null)
    expect(readAttribution('not a url')).toBe(null)
  })
})

describe('the remembered link', () => {
  beforeEach(() => clearAttribution())
  it('is kept until the sign-up, and the last link with something on it wins', () => {
    expect(attribution()).toEqual({ platform: 'web' })
    captureAttribution('https://app.example/?ref=LUCIA')
    captureAttribution('https://app.example/#/plan')   // an ordinary visit changes nothing
    expect(pendingCode()).toBe('LUCIA')
    captureAttribution('https://app.example/?ref=MARTA&utm_source=tiktok')
    expect(attribution()).toEqual({ platform: 'web', ref: 'MARTA', utm_source: 'tiktok' })
    clearAttribution()
    expect(pendingCode()).toBe(null)
  })
})

describe('the website’s sign-up link', async () => {
  const { wantsSignup } = await import('../views/Login.jsx')
  it('opens the sign-up form when the link asks for it, before or after the hash', () => {
    expect(wantsSignup('https://app.tiza.fit/#/?signup=1')).toBe(true)
    expect(wantsSignup('https://app.tiza.fit/?utm_source=tiza.fit&signup=1#/')).toBe(true)
    expect(wantsSignup('https://app.tiza.fit/?ref=LUCIA#/')).toBe(false)
    expect(wantsSignup('not a url')).toBe(false)
  })
})
