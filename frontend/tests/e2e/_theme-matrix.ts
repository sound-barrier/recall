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
 *   - settleLayout()        wait out the frame AFTER that, where the
 *                           browser is still sizing what just mounted
 *   - seedMatches()         a record corpus so the DENSE UI renders
 *   - seedProfiles()        a fixed profile list, so leftover profiles
 *                           from other specs can't move the counts
 *   - silenceParseEvents()  an inert SSE stream, so a parse another
 *                           spec started can't paint transient chrome
 *
 * The seeds exist for opposite reasons: seedMatches puts content IN
 * (an unseeded audit only ever sees empty states), seedProfiles and
 * silenceParseEvents keep other specs' side effects OUT. Anything else
 * this audit renders that depends on shared server state wants the same
 * treatment — the suite shares one server and one HOME across every
 * spec, so "whatever the server happens to be doing by now" is never a
 * stable baseline. Note the two OUT seeds block different channels:
 * seedProfiles covers state read over HTTP, silenceParseEvents covers
 * state PUSHED over the event stream. A new stub has to ask which.
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
 * roles (so role-colored chips render), all three results (win / loss /
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
      // color. An earlier version of this fixture said `rank_tier`, so the
      // block never rendered and the audit stayed blind to the tier palette
      // — which is precisely where six unreadable Day colors were hiding.
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

/**
 * Wait until the painted-element census stops moving.
 *
 * settleView only waits out ANIMATIONS. That is not the same as
 * "layout is finished": a subtree can mount, pass its entrance fade,
 * and still have children the browser has not laid out yet. Settings
 * →Advanced does exactly that — the Database-health row's first
 * button measures 0×0 for one frame after settleView resolves, while
 * its two siblings are already 131×37, then pops to full size on the
 * very next rAF (fonts loaded, readyState complete — this is layout
 * timing, nothing else).
 *
 * captureStructure counts only elements with a non-zero box, so
 * whether that one button is in the census is decided by whether the
 * capture won a one-frame race. That is how `button.count` on the
 * Settings cells flips 41↔42 with a byte-identical tree, and why it
 * moves between themes as the runner's scheduling shifts — the count
 * is not measuring the UI, it is measuring the scheduler.
 *
 * So: poll the census (element total + painted total) and return once
 * two consecutive frames agree. The bound is a safety valve, not an
 * expected path — a page that never settles should fail on the
 * snapshot, not hang here. Any always-painted element the old capture
 * happened to miss legitimately joins the baseline.
 */
export async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const census = () => {
      const all = document.querySelectorAll('*')
      let painted = 0
      for (const el of all) {
        const r = (el as HTMLElement).getBoundingClientRect()
        if (r.width > 0 && r.height > 0) painted++
      }
      return `${all.length}:${painted}`
    }
    let previous = ''
    for (let frame = 0; frame < 60; frame++) {
      const current = census()
      if (current === previous) return
      previous = current
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    }
  })
}

/**
 * Replace EventSource with an inert stub, so the audit never observes a
 * parse another spec started.
 *
 * In server mode the app opens ONE `EventSource('/api/v1/events')` and
 * feeds `parse-progress` into the matches store. That stream is the
 * live SERVER's, shared by the whole suite — so while any spec is
 * parsing, every other open page sees the ticks too. `ParseStatusBar`
 * then slides in and renders its ABORT kill-switch, and the masthead
 * grows a parse-queue chip: transient chrome this audit never asked
 * for, on a page that is only looking at Settings.
 *
 * That is what flipped `designSystem.button.count` 41↔42 on the
 * high-contrast Settings cell — the ABORT button. Same signature as
 * the profile-leak this file's seedProfiles fixes, and just as
 * ordering-dependent: which cell (if any) catches the parse depends
 * purely on how the workers interleave, so it moves between themes as
 * the runner's scheduling changes and survives retry when it lands.
 * Every other value in the snapshot stayed put, because the extra
 * button computes to styles already in the set.
 *
 * A no-op stub rather than a `page.route` fulfill: an aborted or
 * empty-bodied SSE response puts EventSource into its reconnect loop,
 * which is just a quieter form of the same nondeterminism. Nothing in
 * this audit depends on receiving an event — the corpus arrives via
 * seedMatches — so the stream is dead weight here.
 */
export async function silenceParseEvents(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class InertEventSource {
      url: string
      readyState = 1
      onerror: ((e: Event) => void) | null = null
      onmessage: ((e: MessageEvent) => void) | null = null
      onopen: ((e: Event) => void) | null = null
      constructor(url: string) { this.url = url }
      addEventListener() { /* the audit listens to nothing */ }
      removeEventListener() { /* nothing to remove */ }
      close() { this.readyState = 2 }
      dispatchEvent(_e: Event): boolean { return true }
    }
    ;(window as unknown as { EventSource: typeof EventSource }).EventSource =
      InertEventSource as unknown as typeof EventSource
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
  await silenceParseEvents(page)
  await seedMatches(page)
  await seedProfiles(page)
  await page.goto('/')
  await page.locator(`#${tabId}`).click()
  await expect(page.locator(`#${tabId}`)).toHaveAttribute('aria-selected', 'true')
  await settleView(page, tabId)
  await settleLayout(page)
}
