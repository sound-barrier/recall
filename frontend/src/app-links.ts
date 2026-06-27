// Canonical external links for the app's chrome (About dialog + the ⋮ menu).
// The native macOS menu (pkg/cmd/wails.go) keeps its own copies Go-side; these
// are the browser/kebab equivalents so the two surfaces stay in lockstep.
export const GITHUB_REPO_URL = 'https://github.com/sound-barrier/recall'
export const DOCS_URL = 'https://sound-barrier.github.io/recall/'
export const ISSUES_URL = `${GITHUB_REPO_URL}/issues`
export const LICENSE_URL = `${GITHUB_REPO_URL}/blob/main/LICENSE`
