/**
 * Shared rig for the theme × view audit specs.
 *
 * Two specs cross every view against every theme — `a11y.spec.ts`
 * (axe-core) and `a11y-theme-snapshot.spec.ts` (structural + computed
 * design-system probes). Both need the same four things, so they live
 * here rather than being copy-pasted:
 *
 *   - VIEWS / THEMES        the matrix axes
 *   - pinTheme()            set `recall.theme` before first paint
 *   - settleView()          wait out a lazy view's entrance fade
 *   - seedMatches()         a record corpus so the DENSE UI renders
 *   - seedProfiles()        a fixed profile list, so leftover profiles
 *                           from other specs can't move the counts
 *
 * The two seeds exist for opposite reasons: seedMatches puts content IN
 * (an unseeded audit only ever sees empty states), seedProfiles keeps
 * other specs' leftovers OUT. Anything else this audit renders that
 * depends on accumulated server state wants the same treatment — the
 * suite shares one server and one HOME across every spec, so "what the
 * DB happens to contain by now" is never a stable baseline.
 *
 * Why seeding matters: the e2e server boots against an empty DB, so an
 * unseeded audit only ever sees empty states. The dossier widgets,
 * Campaign Log, leaf rows, rank block and unknown-map triage — which
 * between them own most of the app's small-text styling — never render,
 * and axe therefore never samples their contrast. The audit was green
 * for years while Day-theme eyebrows sat at 1.93:1.
 *
 * Underscore prefix keeps this file out of Playwright's *.spec.ts glob.
 */
import { expect, type Page, type Route } from '@playwright/test'

export const VIEWS: { name: string; tabId: string }[] = [
  { name: 'matches',  tabId: 'tab-matches' },
  { name: 'settings', tabId: 'tab-settings' },
  { name: 'ingest',   tabId: 'tab-ingest' },
  { name: 'unknown',  tabId: 'tab-unknown' },
  { name: 'compare',  tabId: 'tab-compare' },
  { name: 'elo',      tabId: 'tab-elo' },
]

// Every mode useTheme.applyTheme can write. Keep in sync with
// ThemeMode in composables/settings/useTheme.ts and with the
// VALID_MODES list in scripts/ci/check-css-theme-leak.sh.
export const THEMES = ['day', 'dark', 'night', 'high-contrast'] as const

/**
 * Build a YYYY-MM-DD string N days back from today using LOCAL date
 * components.
 *
 * Deliberately not `toISOString().slice(0, 10)`: that converts to UTC
 * first, so for any viewer west of Greenwich the "date" flips a day
 * early for part of every day, which has produced two separate
 * heatmap flakes in this suite. Fixtures also must not hard-code
 * calendar dates — the Campaign Log renders a trailing window, and a
 * pinned date silently rolls out of it and hangs the spec months
 * later.
 */
export function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type Result = 'victory' | 'defeat' | 'draw'

function match(
  key: string,
  hero: string,
  role: 'tank' | 'damage' | 'support',
  map: string,
  mode: string,
  result: Result,
  dayOffset: number,
  time: string,
) {
  const date = daysAgo(dayOffset)
  return {
    match_key:    key,
    source_files: [`${key}.png`],
    source_types: { [`${key}.png`]: 'summary' },
    data: {
      map,
      game_mode: mode,
      hero,
      role,
      result,
      date,
      finished_at: time,
      playlist: 'competitive',
      eliminations: 22,
      deaths: 7,
      assists: 11,
      heroes_played: [{ hero, play_time: '09:30', percent_played: 100 }],
    },
    parsed_at: `${date}T${time}:00Z`,
  }
}

/**
 * A corpus broad enough to light up the record-dense surfaces: all three
 * roles (so role-coloured chips render), all three results (win / loss /
 * draw tints), several maps and modes (so the breakdown widgets and the
 * Trends role series have >1 series), a rank update (the rank block), and
 * two records with no map (the Unknown triage view).
 *
 * Spread across ~40 days so the Campaign Log's trailing window and the
 * default dossier date range both include them.
 */
export const AUDIT_CORPUS = [
  match('a01', 'dva',      'tank',    'rialto',   'escort',     'victory', 2,  '19:05'),
  match('a02', 'dva',      'tank',    'rialto',   'escort',     'defeat',  3,  '20:15'),
  match('a03', 'winston',  'tank',    'busan',    'control',    'victory', 4,  '21:40'),
  match('a04', 'winston',  'tank',    'busan',    'control',    'draw',    5,  '18:20'),
  match('a05', 'tracer',   'damage',  'kings-row', 'hybrid',    'victory', 6,  '19:55'),
  match('a06', 'tracer',   'damage',  'kings-row', 'hybrid',    'defeat',  7,  '22:10'),
  match('a07', 'sojourn',  'damage',  'colosseo', 'push',       'victory', 8,  '20:30'),
  match('a08', 'sojourn',  'damage',  'colosseo', 'push',       'defeat',  9,  '21:05'),
  match('a09', 'ana',      'support', 'ilios',    'control',    'victory', 12, '19:15'),
  match('a10', 'ana',      'support', 'ilios',    'control',    'victory', 13, '20:45'),
  match('a11', 'kiriko',   'support', 'suravasa', 'flashpoint', 'defeat',  14, '21:25'),
  match('a12', 'kiriko',   'support', 'suravasa', 'flashpoint', 'victory', 15, '18:50'),
  match('a13', 'lucio',    'support', 'oasis',    'control',    'victory', 18, '19:35'),
  match('a14', 'lucio',    'support', 'oasis',    'control',    'defeat',  19, '20:05'),
  match('a15', 'reinhardt', 'tank',   'eichenwalde', 'hybrid',  'victory', 22, '21:50'),
  match('a16', 'reinhardt', 'tank',   'eichenwalde', 'hybrid',  'defeat',  23, '22:30'),
  match('a17', 'cassidy',  'damage',  'dorado',   'escort',     'victory', 26, '19:20'),
  match('a18', 'cassidy',  'damage',  'dorado',   'escort',     'draw',    27, '20:55'),
  match('a19', 'juno',     'support', 'runasapi', 'push',       'victory', 30, '21:10'),
  match('a20', 'juno',     'support', 'runasapi', 'push',       'defeat',  31, '18:40'),
  match('a21', 'orisa',    'tank',    'nepal',    'control',    'victory', 34, '19:45'),
  match('a22', 'orisa',    'tank',    'nepal',    'control',    'victory', 35, '20:25'),
  match('a23', 'genji',    'damage',  'hanaoka',  'clash',      'defeat',  38, '21:35'),
  match('a24', 'genji',    'damage',  'hanaoka',  'clash',      'victory', 39, '22:05'),

  // Rank update — renders the rank block + its modifier badges.
  {
    match_key:    'a25',
    source_files: ['a25.png', 'a25-rank.png'],
    source_types: { 'a25.png': 'summary', 'a25-rank.png': 'rank' },
    data: {
      map: 'lijiang-tower',
      game_mode: 'control',
      hero: 'ana',
      role: 'support',
      result: 'victory',
      date: daysAgo(1),
      finished_at: '20:00',
      playlist: 'competitive',
      // Field names matter: MatchRankBlock renders `data.rank` as the tier
      // CLASS (.rank-tier.diamond), which is what selects the per-tier
      // colour. An earlier version of this fixture said `rank_tier`, so the
      // block never rendered and the audit stayed blind to the tier palette
      // — which is precisely where six unreadable Day colours were hiding.
      rank: 'diamond',
      level: 3,
      rank_progress: 62,
      heroes_played: [{ hero: 'ana', play_time: '08:15', percent_played: 100 }],
    },
    parsed_at: `${daysAgo(1)}T20:00:00Z`,
  },

  // No `map` → surfaces in the Unknown Maps triage view.
  {
    match_key:    'u01',
    source_files: ['u01.png'],
    source_types: { 'u01.png': 'summary' },
    data: {
      hero: 'mercy',
      role: 'support',
      result: 'victory',
      date: daysAgo(10),
      finished_at: '19:00',
      playlist: 'competitive',
      heroes_played: [{ hero: 'mercy', play_time: '10:00', percent_played: 100 }],
    },
    parsed_at: `${daysAgo(10)}T19:00:00Z`,
  },
  {
    match_key:    'u02',
    source_files: ['u02.png'],
    source_types: { 'u02.png': 'summary' },
    data: {
      hero: 'zarya',
      role: 'tank',
      result: 'defeat',
      date: daysAgo(11),
      finished_at: '20:10',
      playlist: 'competitive',
      heroes_played: [{ hero: 'zarya', play_time: '11:00', percent_played: 100 }],
    },
    parsed_at: `${daysAgo(11)}T20:10:00Z`,
  },
]

/** Serve AUDIT_CORPUS for the match-list endpoint. */
export async function seedMatches(page: Page): Promise<void> {
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(AUDIT_CORPUS),
    })
  })
}

/**
 * Pin the profile list to a single active profile.
 *
 * The suite shares ONE server and one HOME across every spec, and
 * profiles live on disk — so whatever a profile-creating spec leaves
 * behind is still there when the audit runs. The onboarding tour's
 * read-only `test` sample (POST /profiles/test/seed) is the one that
 * bit: `SettingsProfiles` renders a row per profile and gives every
 * NON-active row a Delete button, so the moment `test` exists the
 * Settings view gains a 42nd button. The structural snapshot's
 * `designSystem.button.count` then flips 41↔42 depending on which
 * specs happened to run first — and it survives Playwright's retry,
 * because the retry re-reads the same on-disk state.
 *
 * That produced a real red CI job on four separate PRs (three
 * dependabot npm bumps plus a dependency sweep) with byte-identical
 * trees passing on one run and failing on the next. Every other value
 * in the snapshot was unchanged: only the raw count moved, because the
 * extra Delete button computes to styles already in the set.
 *
 * Stubbing the endpoint makes the audit independent of suite ordering,
 * exactly as seedMatches makes it independent of the DB. Keep it to
 * GET — `POST /api/v1/profiles` creates one, and the audit must not
 * swallow a write it never makes.
 */
export async function seedProfiles(page: Page): Promise<void> {
  await page.route('**/api/v1/profiles', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ active: 'main', profiles: ['main'], immutable: [] }),
    })
  })
}

/** Set the persisted theme before any of the page's own scripts run. */
export async function pinTheme(page: Page, theme: string): Promise<void> {
  await page.addInitScript((t) => {
    try { localStorage.setItem('recall.theme', t) } catch (_) { /* sandboxed context */ }
  }, theme)
}

/**
 * Wait for a freshly-mounted lazy view to finish its entrance fade.
 *
 * The views are `defineAsyncComponent`s, so clicking a tab flips its
 * `aria-selected` synchronously but the panel mounts a beat later and
 * runs the `view-fade-in` keyframes (opacity 0→1). Playwright treats an
 * opacity:0 element as "visible", so `toBeVisible()` can return mid-fade
 * — axe then reads the ramped alpha and reports dozens of false
 * color-contrast violations. Awaiting the subtree's finite animations
 * settles that deterministically; the `iterations !== Infinity` filter
 * skips looping animations (e.g. the `pulse-dot` spinner) so the wait
 * can never hang.
 */
export async function settleView(page: Page, tabId: string): Promise<void> {
  const panel = page.locator(`#${tabId.replace('tab-', 'panel-')}`)
  await expect(panel).toBeVisible()
  await panel.evaluate((el) =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  )
}

/** Navigate to a view with the theme pinned and the corpus seeded. */
export async function openView(page: Page, tabId: string, theme: string): Promise<void> {
  await pinTheme(page, theme)
  await seedMatches(page)
  await seedProfiles(page)
  await page.goto('/')
  await page.locator(`#${tabId}`).click()
  await expect(page.locator(`#${tabId}`)).toHaveAttribute('aria-selected', 'true')
  await settleView(page, tabId)
}
