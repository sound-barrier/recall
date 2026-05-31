import type { MatchRecord } from '../api'

// Hand-crafted demo MatchRecords for the onboarding tour. The tour
// overlay swaps the live records ref for these for the duration of
// the walkthrough so the user sees a realistic-feeling history even
// on a fresh install (the empty state would otherwise force every
// tour step that points at the matches list to land on nothing).
//
// Design rules for the corpus:
//
//   - Five matches across one evening session (newest first).
//   - Mix of victories / defeats / one ambiguous + one unknown so
//     every tour stop has something to land on. The Unknown card
//     uses `unmatched:tour-broken.png` so the existing UnknownMapsView
//     classifier handles it.
//   - Hero / map / mode / role values use names that resolve through
//     the real heroes.yaml / maps.yaml lookup tables so role chips
//     light up correctly.
//   - source_files use the literal `tour-N.png` naming. The tour
//     also installs a stub for the `/_screenshot/` handler that
//     returns a 1x1 PNG so inline previews don't 404.
//   - Stats are deliberately rounded numbers (17/14/7, 6500 damage,
//     etc.) so they read as "training-mode demo" rather than
//     realistic-but-imaginary noise.
//
// NEVER persisted. The tour is a UI-only overlay; the demo records
// never leave the Vue tree, never hit the API, never touch SQLite.

export const DEMO_MATCHES: readonly MatchRecord[] = [
  {
    match_key: 'demo:match:2026-05-10T22:21:11',
    source_files: ['tour-rialto-1.png', 'tour-rialto-2.png'],
    source_types: {
      'tour-rialto-1.png': 'scoreboard',
      'tour-rialto-2.png': 'summary',
    },
    source_parsed_at: {
      'tour-rialto-1.png': '2026-05-10T22:30:00Z',
      'tour-rialto-2.png': '2026-05-10T22:30:00Z',
    },
    data: {
      map: 'rialto',
      mode: 'competitive',
      type: 'escort',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '22:21',
      game_length: '12:40',
      eliminations: 17,
      assists: 16,
      deaths: 7,
      damage: 6500,
      healing: 9200,
      mitigation: 0,
      heroes_played: [
        { hero: 'lucio',  percent_played: 88, play_time: '11:10' },
        { hero: 'kiriko', percent_played: 12, play_time: '01:30' },
      ],
      performance: {
        eliminations: { total: 17, avg_per_10min: 12.5 },
        deaths:       { total: 7,  avg_per_10min: 5.5 },
        assists:      { total: 16, avg_per_10min: 12.7 },
      },
    },
    parsed_at: '2026-05-10T22:30:00Z',
  },
  {
    match_key: 'demo:match:2026-05-10T21:49:34',
    source_files: ['tour-aatlis-1.png', 'tour-aatlis-2.png', 'tour-aatlis-3.png'],
    source_types: {
      'tour-aatlis-1.png': 'scoreboard',
      'tour-aatlis-2.png': 'summary',
      'tour-aatlis-3.png': 'personal',
    },
    source_parsed_at: {
      'tour-aatlis-1.png': '2026-05-10T21:55:00Z',
      'tour-aatlis-2.png': '2026-05-10T21:55:00Z',
      'tour-aatlis-3.png': '2026-05-10T21:55:00Z',
    },
    data: {
      map: 'aatlis',
      mode: 'competitive',
      type: 'flashpoint',
      role: 'dps',
      hero: 'soldier-76',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '21:49',
      game_length: '14:00',
      eliminations: 24,
      assists: 9,
      deaths: 6,
      damage: 12400,
      healing: 0,
      mitigation: 0,
      heroes_played: [
        { hero: 'soldier-76', percent_played: 100, play_time: '14:00' },
      ],
      performance: {
        eliminations: { total: 24, avg_per_10min: 17.1 },
        deaths:       { total: 6,  avg_per_10min: 4.3 },
        assists:      { total: 9,  avg_per_10min: 6.4 },
      },
    },
    parsed_at: '2026-05-10T21:55:00Z',
  },
  {
    match_key: 'demo:match:2026-05-10T20:55:02',
    source_files: ['tour-suravasa-1.png'],
    source_types: { 'tour-suravasa-1.png': 'summary' },
    source_parsed_at: { 'tour-suravasa-1.png': '2026-05-10T21:00:00Z' },
    data: {
      map: 'suravasa',
      mode: 'competitive',
      type: 'flashpoint',
      role: 'tank',
      hero: 'reinhardt',
      result: 'defeat',
      date: '2026-05-10',
      finished_at: '20:55',
      game_length: '10:30',
      eliminations: 12,
      assists: 14,
      deaths: 9,
      damage: 8200,
      healing: 0,
      mitigation: 18400,
      heroes_played: [
        { hero: 'reinhardt', percent_played: 70, play_time: '07:20' },
        { hero: 'sigma',     percent_played: 30, play_time: '03:10' },
      ],
      performance: {
        eliminations: { total: 12, avg_per_10min: 11.4 },
        deaths:       { total: 9,  avg_per_10min: 8.6 },
        assists:      { total: 14, avg_per_10min: 13.3 },
      },
    },
    parsed_at: '2026-05-10T21:00:00Z',
  },
  {
    match_key: 'demo:match:2026-05-10T19:40:12',
    source_files: ['tour-numbani-1.png', 'tour-numbani-2.png'],
    source_types: {
      'tour-numbani-1.png': 'scoreboard',
      'tour-numbani-2.png': 'summary',
    },
    source_parsed_at: {
      'tour-numbani-1.png': '2026-05-10T19:51:00Z',
      'tour-numbani-2.png': '2026-05-10T19:51:00Z',
    },
    data: {
      map: 'numbani',
      mode: 'competitive',
      type: 'hybrid',
      role: 'dps',
      hero: 'tracer',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '19:40',
      game_length: '09:20',
      eliminations: 22,
      assists: 5,
      deaths: 11,
      damage: 9800,
      healing: 0,
      mitigation: 0,
      heroes_played: [
        { hero: 'tracer', percent_played: 100, play_time: '09:20' },
      ],
      performance: {
        eliminations: { total: 22, avg_per_10min: 23.6 },
        deaths:       { total: 11, avg_per_10min: 11.8 },
        assists:      { total: 5,  avg_per_10min: 5.4 },
      },
    },
    parsed_at: '2026-05-10T19:51:00Z',
  },
  // One unknown record so the Unknown tab stop has something to land
  // on. Match-key shape mirrors the real "unmatched:<file>" sentinel
  // App.vue's filter classifies as unknown.
  {
    match_key: 'unmatched:tour-broken.png',
    source_files: ['tour-broken.png'],
    // Unknown record carries no source_types — the parser couldn't
    // classify it (mirrors `unknown_screenshots` table semantics).
    source_types: {},
    source_parsed_at: { 'tour-broken.png': '2026-05-10T18:10:00Z' },
    data: {},
    parsed_at: '2026-05-10T18:10:00Z',
  },
]

// Stub data URL for screenshot previews during the tour. A single 1×1
// PNG keeps the lightbox + inline previews from 404'ing while the
// tour points at them — we never want to ship the user's real
// screenshot folder URL while the demo records own the records ref.
//
// Generated from a 100×60 pixel mock with an accent gradient (so the
// inline preview thumbnail reads as "a screenshot" not "a broken
// image icon"). Inlined here so the tour is fully self-contained.
export const DEMO_SCREENSHOT_DATA_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1d1d1d" />
          <stop offset="1" stop-color="#2a2a2a" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#g)" />
      <rect x="14" y="14" width="48" height="6" fill="#d96a2e" />
      <rect x="14" y="28" width="160" height="4" fill="#525252" />
      <rect x="14" y="38" width="100" height="4" fill="#525252" />
      <g font-family="ui-monospace, monospace" font-size="11" fill="#8a8a8a" letter-spacing="0.06em">
        <text x="14" y="158">RECALL · TOUR PREVIEW</text>
      </g>
      <g stroke="#d96a2e" stroke-width="1" fill="none" opacity="0.6">
        <path d="M 220 70 L 290 70 L 290 140 L 220 140 Z" />
        <path d="M 226 76 L 284 76 L 284 134 L 226 134 Z" stroke-dasharray="3 4" />
      </g>
    </svg>`,
  )

// Returns the demo screenshot data URL for any tour-prefixed filename
// so the App.vue screenshotURL substitution can recognise tour assets
// without leaking through to the real handler.
export function isDemoScreenshot(filename: string | null | undefined): boolean {
  if (!filename) return false
  return filename.startsWith('tour-')
}
