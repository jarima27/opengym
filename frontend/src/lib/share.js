// The system's own share sheet, for a link (an invite) or an image (a record's card): the native
// one in the app (@capacitor/share, imported only there), the Web Share API in a browser that
// has it — with files where it can — and otherwise the clipboard for a link and a download for
// an image. Each says what happened: 'shared', 'copied', 'downloaded' or 'cancelled'.
import { MOBILE } from './mobile.js'

// The person closing the sheet is not a failure.
const cancelled = e => e?.name === 'AbortError' || /cancel/i.test(String(e?.message || e))

export async function shareLink({ title, text, url }) {
  try {
    if (MOBILE) {
      const { Share } = await import('@capacitor/share')
      await Share.share({ title, text, url })
      return 'shared'
    }
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title, text, url })
      return 'shared'
    }
  } catch (e) {
    if (cancelled(e)) return 'cancelled'
  }
  await navigator.clipboard?.writeText(text ? `${text} ${url}` : url)
  return 'copied'
}

export async function shareImage(blob, filename, { title, text } = {}) {
  try {
    if (MOBILE) {
      const { shareExportBlob } = await import('./mobile.js')
      await shareExportBlob(blob, filename)
      return 'shared'
    }
    const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type || 'image/png' }) : null
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title, text })
      return 'shared'
    }
  } catch (e) {
    if (cancelled(e)) return 'cancelled'
  }
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  return 'downloaded'
}
