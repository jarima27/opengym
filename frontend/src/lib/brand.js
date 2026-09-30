// Who this build says it is. Tiza is a fork of openGym (AGPL-3.0, © Duarte Santos): the name,
// the addresses and the store identity are ours, the credit to upstream is not optional.
//
// Everything that names the product or links out of it reads from here, so a rename is one
// file and not a grep across the app.

export const NAME = 'Tiza'
export const SITE = 'https://tiza.fit'
export const SITE_HOST = 'tiza.fit'
// AGPL §13: people using the hosted service must be able to get its source. This is that link.
export const SOURCE = 'https://github.com/jarima27/opengym'
export const UPSTREAM_NAME = 'openGym'
export const UPSTREAM = 'https://github.com/DuarteSantos8/openGym'

// The in-app APK updater (lib/update.js) is for side-loaded builds. Tiza ships through
// Google Play and the App Store, which update the app themselves — and Play does not allow an
// app to install its own updates — so the Updates section stays hidden.
export const APK_UPDATES = false
