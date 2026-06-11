import type { MatchRecord } from '../api'

// Hand-crafted demo MatchRecords for the onboarding tour. The tour
// overlay swaps the live records ref for these for the duration of
// the walkthrough so the user sees a realistic-feeling history even
// on a fresh install (the empty state would otherwise force every
// tour step that points at the matches list to land on nothing).
//
// Design rules for the corpus:
//
//   - Six records across one evening session (newest first).
//   - Mix of victories / defeats / one ambiguous + one unknown so
//     every tour stop has something to land on. The Unknown card
//     uses `unmatched:tour-broken.png` so the existing UnknownMapsView
//     classifier handles it. The ambiguous card uses
//     `ambiguous:tour-aatlis-ambig.png` with one candidate pointing
//     at the aatlis demo match so the "Needs your review" subsection
//     + the candidate picker actually render during the tour.
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
      playlist: 'competitive',
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
      playlist: 'competitive',
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
      playlist: 'competitive',
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
      playlist: 'competitive',
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
  // One AMBIGUOUS record so the Unknown tab's "Needs your review"
  // subsection + the .ambiguous-card / .candidate-picker UI lights
  // up during the tour. Match-key shape mirrors the real
  // "ambiguous-<filename>" sentinel App.vue's filter classifies as
  // ambiguous (records.filter(r => r.ambiguous)).
  //
  // The single candidate points at the aatlis demo match (one of
  // the entries above), so when the tour user expands this card the
  // candidate picker shows "demo:match:…21:49:34 · 12 min apart ·
  // aatlis · soldier-76 · 2026-05-10". A second candidate would be
  // more realistic, but the picker already conveys the contract
  // with one — and the heading "1 candidate match" reads naturally.
  //
  // Stats deliberately mirror the aatlis match's EAD (24/9/6) so the
  // story holds together: "two screenshots with the same E/A/D
  // signature inside the 30-min window — Recall asks you to attach."
  {
    match_key: 'ambiguous-tour-aatlis-ambig.png',
    source_files: ['tour-aatlis-ambig.png'],
    source_types: { 'tour-aatlis-ambig.png': 'scoreboard' },
    source_parsed_at: { 'tour-aatlis-ambig.png': '2026-05-10T22:01:00Z' },
    data: {
      playlist: 'competitive',
      hero: 'soldier-76',
      eliminations: 24,
      assists: 9,
      deaths: 6,
    },
    parsed_at: '2026-05-10T22:01:00Z',
    ambiguous: true,
    candidates: [
      {
        match_key: 'demo:match:2026-05-10T21:49:34',
        distance_seconds: 720,
      },
    ],
  },
  // One unknown record so the rest of the Unknown tab (below the
  // ambiguous subsection) has something to land on. Match-key shape
  // mirrors the real "unmatched-<file>" sentinel App.vue's filter
  // classifies as unknown.
  {
    match_key: 'unmatched-tour-broken.png',
    source_files: ['tour-broken.png'],
    // Unknown record carries no source_types — the parser couldn't
    // classify it (mirrors `unknown_screenshots` table semantics).
    source_types: {},
    source_parsed_at: { 'tour-broken.png': '2026-05-10T18:10:00Z' },
    data: {},
    parsed_at: '2026-05-10T18:10:00Z',
  },
]

// Note: the tour deliberately does NOT advance through any step
// that opens the lightbox or inline preview, so the demo records'
// "tour-*.png" filenames never get served. If a future iteration
// adds a "click the source-preview" step, drop in a screenshot
// stub here (data:image/svg+xml ...) and route App.vue's
// screenshotURL helper through it for tour-prefixed names.
