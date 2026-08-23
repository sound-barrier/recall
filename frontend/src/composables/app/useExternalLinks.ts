import { OpenURL } from '@/api-client'
import { DOCS_URL, GITHUB_REPO_URL, ISSUES_URL, LICENSE_URL } from '@/app-links'

/**
 * The app's outbound links, opened the way this app opens links: through
 * OpenURL, so Wails mode hands the URL to the OS browser instead of navigating
 * the WebView away from the app.
 *
 * A composable rather than components calling OpenURL themselves. It is not
 * server state, so section 16 of TECHNICAL_DEBT.md is not literally about it —
 * but the rule that came out of section 16 is that components render and the
 * layer beneath them talks to the outside, and "open the OS browser" is
 * outside. Keeping it here also means the URL and the opener stay together,
 * rather than each caller importing both halves and pairing them itself.
 */
export function useExternalLinks() {
  return {
    openRepo: () => { OpenURL(GITHUB_REPO_URL) },
    openDocs: () => { OpenURL(DOCS_URL) },
    openIssues: () => { OpenURL(ISSUES_URL) },
    openLicense: () => { OpenURL(LICENSE_URL) },
    /** An update's release page — the URL comes from the server, not app-links. */
    openReleaseNotes: (url: string) => { OpenURL(url) },
  }
}
