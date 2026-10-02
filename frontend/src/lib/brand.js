// Who this build says it is. Tiza is a fork of openGym (AGPL-3.0, © Duarte Santos): the name,
// the addresses and the store identity are ours, the credit to upstream is not optional.
//
// Everything that names the product or links out of it reads from here, so a rename is one
// file and not a grep across the app.

export const NAME = 'Tiza'
export const SITE = 'https://tiza.fit'
export const SITE_HOST = 'tiza.fit'
// The hosted app, and the address that opens its sign-up form (the website's "Start free" uses
// the same one, landing/site.config.json): where the demo sends someone who wants their own account.
export const APP = 'https://app.tiza.fit'
export const SIGNUP = APP + '/#/?signup=1'
// Tiza Pro's offer as the website states it (landing/site.config.json, which a test holds this to):
// what the demo's paywall shows, since the demo has no server to ask. Amounts in cents; exitAnnual
// is the first year of the annual plan offered once, as the paywall after the plan is closed.
export const OFFER = { currency: 'EUR', monthly: 799, annual: 3999, exitAnnual: 2999, trialDays: 7 }
// AGPL §13: people using the hosted service must be able to get its source. This is that link.
export const SOURCE = 'https://github.com/jarima27/opengym'
export const UPSTREAM_NAME = 'openGym'
export const UPSTREAM = 'https://github.com/DuarteSantos8/openGym'

// The in-app APK updater (lib/update.js) is for side-loaded builds. Tiza ships through
// Google Play and the App Store, which update the app themselves — and Play does not allow an
// app to install its own updates — so the Updates section stays hidden.
export const APK_UPDATES = false
