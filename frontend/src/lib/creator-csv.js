// The creator program's report as a CSV (Admin → Creator codes → Export), for working out the
// commissions by hand: one row per code — and per month, for the whole program at once. Plus
// the store links a creator shares: Google Play's carries their code as the install referrer.
export const ANDROID_PACKAGE = 'fit.tiza.app'

// A cell as a spreadsheet reads it: quoted when it has to be, and never a formula (a label
// typed as "=…" would run in Excel).
const cell = v => {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",;\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export const CSV_HEAD = ['month', 'code', 'creator', 'extra_days', 'apple_offer_code', 'signups', 'trials_started', 'paying_customers', 'refunds']

/** The CSV for `rows` (GET /api/admin/creators): each row's own month, else `month`, else "all". */
export function creatorCsv(rows, month = null) {
  const lines = [CSV_HEAD, ...(rows || []).map(r => [r.month || month || 'all', r.code, r.label, r.days, r.appleOffer, r.signups, r.trials, r.paying, r.refunds])]
  return lines.map(l => l.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** The Google Play link with a creator's code as its install referrer (lib/install-referrer.js). */
export const playLink = (code, pkg = ANDROID_PACKAGE) => `https://play.google.com/store/apps/details?id=${pkg}&referrer=${encodeURIComponent('ref=' + code)}`
