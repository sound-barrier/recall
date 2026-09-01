#!/usr/bin/env bash
# scripts/ci/check-bundle-size.sh — assert the Vite-built frontend bundle
# stays under the per-chunk + total byte budgets.
#
# Why this script exists: the budgets were previously inlined as a
# shell block in .github/workflows/ci.yml, which meant the only place
# a contributor could trip the gate was on a push to GitHub. Pulling
# the logic out lets lefthook's pre-push hook reuse the same check
# locally — same script, same budgets, same exit code. CI just builds
# first then calls this; lefthook builds + calls in one shot via
# `--build`.
#
# Budgets live in env vars so a bump is a one-line change. CI exports
# them inline next to the call; lefthook inherits from the script's
# defaults. Keeping the numbers in this script (defaults) means the
# budgets travel WITH the assertion — no risk of CI and pre-push
# drifting apart silently.
#
# Usage:
#   bash scripts/ci/check-bundle-size.sh           # assume frontend/dist/ exists
#   bash scripts/ci/check-bundle-size.sh --build   # run `npm run build` first
#
# Override a budget:
#   MAX_TOTAL_JS_BYTES=300000 bash scripts/ci/check-bundle-size.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST_DIR="${REPO_ROOT}/frontend/dist/assets"

# Default budgets. Per-PR bump rationale lives in
# scripts/ci/bundle-size-budget-history.md — append a row there when
# you change a number here. Bump deliberately; don't lift caps to
# silence noise.
# 2026-08: 190500 → 319000 — METRIC CHANGE, not a regression. "Initial JS"
# now measures the whole entry graph (index.html's entry script + every
# chunk it modulepreloads) instead of index-*.js alone; the old number was
# only ever a slice of what the browser downloads, and it under-reported
# by ~240KB the moment the bundler hoisted shared eager code into its own
# chunk. Numbers in rows above are NOT comparable to this one.
# 2026-08: 319000 → 331000 — the coaching session's EAGER surface: the
# coach store, the write gate every writer now calls, and the api facade
# wrappers (measured 325565B). The film room, the return sheet, the loan
# slip and the nav strip are all lazy chunks and cost nothing here —
# App.lazy-views.test.ts pins that. ~5KB headroom.
# 2026-08: 331000 → 332500 — the coaching session store, which is EAGER by
# construction: the app must know whether a session is open before any view
# renders, so everything that store holds is in the first-paint graph. The
# moments it now tracks (what has actually been written, so a removal can tell
# an abandoned draft from a stored row) live there for that reason, not by
# accident. Measured 331207B.
# 2026-08: 332500 -> 336000 -- the coaching INBOX, eager for the same reason
# the session store above it is: the app must know a review is waiting before
# any view renders. The banner used to live inside the lazy Matches view, so a
# player who imported notes and went to Settings, Parse or Unknown had no sign
# on three of six tabs that anything was waiting for them. Measured 335003B --
# 1793B of it the inbox banner + its returns store, 568B the receipt strip that
# says where an exported file went. Both are first-paint by construction.
# 2026-08: 336000 -> 340000 -- the self-review SITTING store joins the coach
# session store in the eager shell, for the one reason an overlay needs it:
# the keyboard cheatsheet (AppOverlays, eager) advertises the film room's reel
# bindings only while the room is open, and the room opens for a sitting as
# well as a session. Measured 338381B — the store, its query module and the
# SDK surface the Phase 3 bump already noted as the first-paint cost.
# 2026-08: 348500 -> 352500 -- coaching from replay codes, in two parts, and
# worth recording that the FIRST part shipped over this line unnoticed. The
# bundle gate is not in `task lint`, only in CI, so the replay-session commit
# landed at 350174B against a 348500B cap. The cost is the coach store, which
# is eager by construction (the app must know whether a session is open before
# any view renders): four new session methods, the observed-context writer,
# and the api.ts facades for three new routes -- api.ts being one eager
# module. The second part adds ~1.4KB more: the store's fold from session refs
# into the sheet's input shape. Measured 351570B.
#
# What is NOT here, and was nearly: the sheet BUILDER and the app's inlined
# stylesheets. `await import()` is not by itself a promise a module stays out
# of the entry -- Rollup hoists a dynamically-imported module whose deps are
# already in the main graph, and it did exactly that to the builder because it
# shares render-markdown with eager code. Routing both through one module
# (coach-sheet-export.ts) gave the bundler a single unit to move, and it moved
# it: a 15KB lazy chunk nobody who never exports a review will fetch.
# 2026-08: 340000 -> 344000 -- the reviews-UX pass's eager tail (measured
# 340821B): the palette's "Review my last session" action + runner (the
# palette is eager chrome), the masthead's what's-new gate (the strip itself
# is a lazy chunk that a dismissed pointer never fetches), the ui-store
# pick-hint flag, the reviewSet narrow clause, and the api.ts facades for
# the two new routes (api.ts is one eager module).
# 2026-08: 344000 -> 348000 -- the focus nudge's wiring is eager by
# construction (measured 345268B). The toast itself is a lazy overlay
# chunk, but AppOverlays is eager and calls useFocusNudge in its setup —
# it has to, because the nudge can be raised on any tab by a parse that
# lands anywhere. What that pulls in is the composable, queries/focus.ts
# and the focus-list helpers; the rest (the band, the item editor, the
# widget) rides lazy chunks. Plus api.ts's facades for four new routes,
# api.ts being one eager module. ~2.7KB headroom.
# 2026-08-21 — 348000 → 348500. The coach room's corpus became one RoomApi
# bundle instead of six props and four emits spelled at two call sites, and the
# bundle is built where the data lives: in useCoachStore and useSelfReviewStore,
# both of which App.vue reaches statically. So ~400B of genuinely new code lands
# in the entry graph while the savings land in the lazy views that no longer
# spell the clump out. A real trade, made deliberately.
#
# The other 2.5KB this work first added was NOT a trade, and is worth recording
# because the mistake is easy: a nine-line `pluralize` helper was put beside the
# review labels that mostly use it, and CoachInboxBanner — which App.vue imports
# statically — pulled it from there, dragging reviews-helpers → coach-time →
# match-time-helpers into the entry chunk. The helper now lives in
# match-label-helpers.ts, which imports nothing at runtime. A leaf that costs
# nothing to import is worth more than a leaf that sits beside its callers.
# 2026-08-22 — 352500 → 356500. The standards-debt remediation. Six new
# authored modules land in the entry graph, and every one of them is a
# boundary that did not exist before: widget-schemas.ts (severing the
# 45-cycle widget/registry knot), useNarrowCellFilter (one registry replacing
# two drifted if-chains), useExternalLinks / useDiagnosticBundle /
# useDatabaseHealth (components no longer reaching for the api seam), and
# ProbeChip.vue (one chip instead of three). Plus AGG_SPECS, which is a
# Record where five switches used to be.
#
# This is the trade the 2026-08-10 file-size wave already recorded and named:
# module boundaries cost bytes, and the rule is to bump deliberately rather
# than shave structure to fit a number. What was bought is measurable —
# runtime import cycles 45 → 0, and an unhandled aggregation or screenshot
# type is now a compile error rather than an empty column or a garbage row.
#
# Measured 355512B; ~1KB headroom, per the sizing convention here.
# 2026-08: 356500 -> 358000 -- the coaching S-campaign's EAGER surface: the
# coach store's kind threading + the roster/dossier invalidation hooks
# (the query module was already eager via the sitting store; only the
# store's own code grew). Everything visible -- the fork, the dossier, the
# drawer -- is lazy. Measured 356830B.
# 2026-08: 358000 -> 360000 -- honest parse accounting's eager slice: the
# {count, parked} pending shape through the store, the parse-complete
# summary threading (event narrowing + finishParseRun's toast state),
# and the Run Parse copy states. The outcome toast itself is a lazy
# overlay chunk; only the lifecycle plumbing rides the entry graph.
# Measured 358152B.
# 2026-08: 360000 -> 362000 -- the seven-feature wave's eager slice, which is
# almost entirely the matches store and its helpers: the exclusion-reason
# predicate threaded through countsInTally and every dossier base, the
# duplicate link on the record, setShareKeys/dropShareKey on the share
# composable, and the ListCoachPlayerSessions binding. Everything the user
# SEES is lazy -- the chooser, the chip, the rail, the suggestions and the
# dossier's session list all ride view or overlay chunks. Two regressions
# found while measuring went the other way: the annotation-chooser family
# and the whole toast family had been routed through app.css, which put
# 5.0KB of chrome for six lazily-loaded toasts and a detail-panel control
# in the INITIAL stylesheet; both are sibling stylesheets in their own
# chunks now, and initial CSS came in UNDER its unchanged budget.
# Measured 360811B.
# 2026-08: 362000 -> 364000 -- the analytics kernels, which are EAGER by
# construction: they hang off useMatchesMomentum, which the matches store
# builds during setup, so everything the store can answer is in the first-paint
# graph whether or not a widget asks. The four widgets themselves are not —
# they live in the dashboard registry the Matches view lazy-loads. Measured
# 362688B.
: "${MAX_INITIAL_JS_BYTES:=364000}"
# 2026-07: 67000 → 68000 — the Phase-5 sample-size caveat chip
# (.bd-low-n in components.css) landed the initial CSS 192B over the
# old point. ~1KB headroom, same ratchet spirit: bump deliberately
# with a rationale, never to absorb accidental bloat.
# 2026-07: 69000 → 73000 — design-token adoption. 646 font-size, 327
# border-radius, 205 duration and 91 spacing declarations became
# `var(--token)` references; a reference is ~11B longer than the literal
# and lightningcss can't fold it, so RAW CSS grows ~4%. GZIPPED it is
# +234B (token names repeat and compress), which is the number that
# reaches a user. Paying 4% of an uncompressed metric for a single
# source of truth on type/radius/motion. Set with ~3KB headroom rather
# than to the byte: landing on a razor-thin margin just means the next
# one-line change fails the gate for no useful reason.
# 2026-08: 76000 → 80000 — paper.css, the coaching session's ink-on-paper
# surface, plus its token family across four themes (measured 78007B).
# It is eager because the loan slip and session rule appear on every tab
# while a session is open. ~2KB headroom.
# 2026-08: 80000 -> 82000 -- the .sheet-* family in styles/system-alert.css:
# the capped dialog with a pinned head, a scrolling middle and pinned actions.
# It moves bytes from lazy chunks INTO the eager sheet by design — two dialogs
# had spelled that shape out separately, and one of them had it wrong enough
# to be a trap at any window under ~840px. Total CSS went DOWN paying for this
# (see the total's own row); the initial graph is where a cross-cutting family
# belongs. Measured 80213B; ~1.8KB headroom.
: "${MAX_INITIAL_CSS_BYTES:=82000}"
# The Matches "Trends" charts pull in ECharts (tree-shaken to line + bar
# charts, grid/tooltip/legend/markline/data-zoom/brush components, canvas
# renderer). It rides in its own lazily-loaded chunk (TrendChart-*.js),
# loaded only when the user expands the Trends section, so INITIAL JS is
# unaffected — but it counts toward the TOTAL.
# 2026-07: +14KB headroom over the prior 1256000 ratchet point — the
# audit Phase-3 refactors (narrow clause registry, shared band header,
# per-store boot loaders) net-added ~0.3KB of lazy-chunk JS and landed
# exactly 318B over. The ratchet stays tight: bump deliberately with a
# rationale here, never to absorb accidental bloat.
# 2026-07: 1270000 → 1320000 — echarts 5.6 → 6.1 (with vue-echarts 8),
# the dependabot major that fixes CVE-2026-45249, adds ~44KB to the
# lazy TrendChart chunk (total-only; initial JS untouched). Security
# upgrade, not bloat absorption.
# 2026-07: 1320000 → 1360000 — the "Best times to play" heatmap card
# registers two more tree-shaken ECharts pieces (HeatmapChart +
# VisualMapComponent) in the lazy TrendChart chunk, ~37.5KB total-only
# (initial JS untouched). The approved flagship 6.1 chart, not bloat.
# 2026-07: 1385000 → 1402000 — the Season Comparison tab (SeasonCompareView +
# match-compare-helpers + match-compare-aggregate: per-role/hero/mode/queue
# breakdowns, sectioned table) adds a new lazy view chunk, ~13.5KB total-only.
# It's a defineAsyncComponent, so initial JS is untouched; a whole new feature
# tab with a rich metric set, not bloat absorption.
# 2026-07: 1402000 → 1424000 — the Compare tab's Form mode (FormCompareView +
# form slices/verdict + drill-through), ~16KB in the same lazy compare chunk
# (initial JS untouched). A second full comparison mode, not bloat.
# 2026-07: 1424000 → 1430000 — hero-swap discipline pair (Heroes per match +
# Hero pool widgets + match-hero-pool-helpers + Compare rows), ~1.3KB in the
# MatchesView/compare chunks (initial JS untouched). New feature.
# 2026-07: 1430000 -> 1465000 - the Elo Calculator tab (lazy chunk: view +
# projection math + chart options), ~28KB. New feature.
# 2026-07: 1465000 -> 1475000 - the Hero Pool band rebuild (3-mode toggle,
# per-role pools, pool-membership narrow), ~5KB in the MatchesView chunk. New feature.
# 2026-07: 1520000 -> 1528000 - disruption tracking (thrower facet + clause,
# multi-side leaver/thrower choosers, match-disruption row-stamp helper,
# leaver:/thrower: search fields, and the leaver-exit quick-add's split menu +
# stripped modal mode), ~5.9KB across the MatchesView chunk. New feature; the
# spare ~2KB is the deliberate headroom the note above asks for, not slack.
# 2026-08: 1528000 -> 1534000 - Elo statistical-coherence pass (verdict engine
# + ceiling ranges + decay-aware sim + the honest low-n copy), net +0.5KB in
# the lazy Elo chunk after deleting the IG-mixture layer; the rest is the
# deliberate ~5KB headroom the note above asks for.
# 2026-08: 1534000 -> 1542000 - climb-focused dossier (Recent form /
# After-N-losses / Session depth widgets, form + loss-streak metrics, layout
# migration v2, KDA + Source table columns), ~3.4KB in the MatchesView chunk;
# the rest is the deliberate ~5KB headroom. New feature.
# 2026-08: 1581000 -> 1593000 - routing the five binary endpoints through
# the generated SDK (backup/restore/export-bundle/export-diagnostic/import)
# pulls their generated operations + the blob/serializer paths in, net
# +12.4KB after deleting the hand-rolled fetch/Content-Disposition/error
# code they replaced. Buys compile-time-checked request bodies on the
# endpoints that previously hand-built snake_case JSON.
# 2026-08: 1593000 -> 1605000 - accessibility markup from the full-testing
# campaign: role="progressbar" + the aria-value triple on 18 meter fills,
# accessible names on previously-unlabeled chip glyphs / count badges /
# unknown-map cards, and the judgment vocabulary the tinted surfaces now
# speak (JUDGMENT_LABEL + the band helpers in match-heatmap-helpers).
# Measured +6.0KB total JS against main, all of it compiled render-function
# text for labels a screen-reader user could not previously get at; initial
# JS did not move (313.4KB against a 319KB budget). The rest is the
# deliberate ~6KB headroom the note above asks for - main had drifted to
# 552B of slack, which is what made this a gate failure rather than a
# rounding error.
# 2026-08: 1605000 → 1660000 — the coaching feature's lazy chunks: the
# film room (reel/desk/sheet/editor), the return sheet, and the slip and
# strip (measured 1647634B).
# 2026-08: 1660000 → 1667000 — the season-4 rank percentile: the "Ranked
# above" dossier widget, the layout v3 migration step, the Elo panel line
# and the Compare standing row (measured 1661002B, i.e. 1002B over the old
# ceiling — the previous bump left ~12KB of slack and the campaigns since
# have spent it). Restores the deliberate ~6KB headroom the note above
# asks for; initial JS is unmoved at 324.7KB against a 331KB budget,
# because every one of these lands in an already-lazy view chunk.
# 2026-08: 1667000 → 1674000 — the usability campaign's phase 2 insights: the
# "Ranked above" trends chart (its own series + option builder), the Elo
# "Where do I stand?" card and the percentile trail behind it (measured
# 1668012B, 1012B over the old ceiling). The previous bump restored ~6KB of
# headroom and this spent it, which is what a bump is for; 7000 puts ~6KB back
# rather than shaving the ceiling to the measurement, so the next feature trips
# the gate on its own merits instead of inheriting a wall. Initial JS is
# unmoved at 325.7KB against 331KB — both surfaces live in already-lazy view
# chunks.
# 2026-08: 1674000 → 1682000 — phase 2's three climb-insight widgets and the
# trailing-window kernel behind them (measured 1674414B). Same shape as the bump
# above: keep ~7KB of headroom rather than shaving the ceiling to the
# measurement, so the next feature trips the gate on its own growth instead of
# inheriting a wall. Initial JS unmoved — all three are dossier widgets inside
# the already-lazy Matches chunk.
# 2026-08: 1682000 → 1690000 — the command palette and its two pure helpers
# (subsequence scorer, item corpus), measured 1683092B. Hand-written rather than
# a dependency, which is why this is ~1KB and not ~15KB. It is lazy-loaded, so
# INITIAL JS is unmoved; this is the total, where a modal nobody has opened still
# counts.
# 2026-08: 1690000 → 1698000 — the cue strip (the coach's timestamped
# moments: the strip, its row, the pure placement helpers). Rides the coach
# room's lazy chunk, so INITIAL JS is unmoved; this is the total, where a room
# nobody has opened still counts.
# 2026-08: 1698000 → 1703000 — the rest of the moments feature: the PLAYER's
# own cue strip in the match journal (its draft-override state and debounced
# per-moment save queue), the returned-note rendering, and the palette's
# coaching actions. Measured 1700179B. INITIAL JS is unmoved at 332192B — the
# journal rides the already-lazy match-detail chunk and the room its own, which
# is the number that would have moved if any of it had drifted eager.
# 2026-08: 1703000 -> 1706000 -- the same two, plus the Settings player-handle
# row and the return sheet's discard flow. Measured 1702966B, which left 34
# bytes of headroom: a budget that tight trips the next honest change instead
# of the next careless one.
# 2026-08: 1706000 -> 1710000 -- the 07 Reviews tab: its view, the shelf
# index and one pure helper, as one lazy chunk (measured 1706142B). INITIAL JS
# went DOWN, 335320B -> 331896B: the film room's props/emits wiring, useOWData
# and the roving-tab special case all left App.vue for the lazy view when the
# room moved inside the tab. A tab that shrinks first paint is the right kind.
# 2026-08: 1710000 -> 1726000 -- self review: the sitting store, the shared
# draft rules carved out of the coach store (useReviewDrafts — the coach
# store got smaller by the same rules), the sheet pieces (record, tally,
# summary) the coach sheet and the sitting's sheet now both compose, the
# sitting's sheet and shelf card, and eleven SDK functions (measured
# 1723547B). All but the SDK rides the lazy Reviews / room chunks; INITIAL JS
# moved 331896B -> 335802B, the SDK surface and the bulk bar's new button.
# 2026-08: 1726000 -> 1736000 -- the reviews-UX pass: the index's quick-pick
# starts (latestSessionKeys + the last-N sort), the reviewSet narrow clause,
# the palette's "Review my last session" action + runner, the pick-hint strip,
# the armed states on the shelf card and the journal block, and the room's
# voice threading (measured 1731092B). The index/room bytes ride the lazy
# Reviews chunk; what reached the initial graph is the palette action, the
# ui-store hint flag and the narrow clause.
# 2026-08: 1736000 -> 1742000 -- the pass's Tier 2/3 tail: the sent ledger
# and coach-roster queries + strips, remove-a-match from the desk, the
# read-again surfaces, the sitting's nav-strip mode, and the lazy what's-new
# strip (measured 1738978B).
# 2026-08: 1742000 -> 1760000 -- the review-surfaces pass: two markdown
# renderers (the note grammar in TS, mirroring pkg/coach for the ledger),
# the note toolbar, the shared focus-list editor and its pure edits, the
# band on 07, the session nudge, the focus-now widget, the focus query,
# and the SDK surface for four new routes. Then the adversarial reviews'
# fixes on top: focus management and per-item accessible names on the band,
# the widget's failed-read state, the session-expiry timer on the nudge
# (measured 1759793B). Set at 1768000 rather than to the byte — landing on
# a razor-thin margin just fails the gate on the next one-line change.
# 2026-08: 1768000 -> 2124000 -- the note editor. This is the largest single
# dependency the app has ever taken and it deserves the arithmetic written out:
# +350782B raw over the previous measurement, of which 345591B is ONE chunk,
# NoteRichText-*.js — ProseMirror (view/model/transform/state/commands/history/
# inputrules/keymap/schema-list), @tiptap/core and the eleven extensions.
# Gzipped, which is what a reader actually waits for, that chunk is 102KB.
#
# What it buys: notes have always been markdown typed into a bare textarea, so
# you wrote **hold the angle** and looked at asterisks, and the only way to
# find out what your coach received was to leave the room and open the note
# block. The editor renders as you type now, against the same grammar the
# exported ledger renders, pinned case-for-case by the shared fixture.
#
# Note what did NOT move: MAX_INITIAL_JS_BYTES. The editor is behind a dynamic
# import inside NoteWriter, which sits behind two already-lazy views, so it
# never enters index.html's modulepreload graph — measured 347482B initial,
# still inside the 348000 ceiling. That boundary is fragile in a way a budget
# cannot see: a single static import of note-tiptap.ts from NoteWriter (for a
# length constant, in the first draft of this work) pulled the whole editor
# into a chunk that was no longer lazy, with the defineAsyncComponent still
# sitting there doing nothing. App.lazy-views.test.ts now asserts the module
# graph directly — exactly two files may import @tiptap — so that mistake
# fails a test rather than a budget.
#
# Measured 2117506B; set ~6.5KB above it per the sizing convention.
# 2026-08-22 — briefly 2152000 → 2158000 for the remediation's extractions,
# then handed straight back. Splitting api.ts into one module per endpoint
# family let the bundler drop what each importer does not use: total JS went
# 2156606B → 2151855B, back under the ORIGINAL ceiling. The bump is reverted
# rather than kept as headroom, because a budget nobody needs is a budget
# nobody defends.
# 2026-08: 2152000 -> 2166000 -- the film-room audit campaign: fifty-one UX
# fixes spread across the review flow's LAZY chunks (verdict roving + armed
# confirms on the return sheet, the draft stash + fold cue in the send
# dialog, disclosures/undo/autogrow in the film room, the codes modal's
# restyle). Nothing eager moved -- initial JS stands. Measured 2160078B.
# 2026-08: 2166000 -> 2174000 -- the coaching S-campaign's lazy chunks: the
# identity fork + typeahead, the player dossier and its notes query, the
# earlier-notes drawer, the team-voice branches. Measured 2168268B.
# 2026-08: 2174000 -> 2177000 -- the dismiss-and-parse-accounting campaign's
# lazy chunks: the ParseOutcomeToast overlay, the Unknown tab's Dismiss
# extension (every-file loop + the ambiguous card's zone), the ref-gap
# acknowledge disclosure, the parked badge + Retry. Measured 2175021B.
# 2026-08: 2177000 -> 2191000 -- the seven-feature wave, all of it in lazy
# chunks: the exclusion chooser and its narrow control, the duplicate chip
# on both row renderers, the replay-code staleness note and the loan-slip
# warning, the film-room stat rail and its kernel, the send dialog's two
# suggestions plus per-row removal, the dossier's session list, and the
# team notes file's addressee. Measured 2188972B.
# 2026-08: 2191000 -> 2199000 -- the expanded writing surface, and one more
# surface reaching the shared editor. NoteWriter grew the teleported dialog,
# the word count and the Markdown-mode preview pane, and the send-to-coach
# message moved off its bare textarea onto it -- which puts the writer chunk
# (9696B, shared, not duplicated) in the reviews path as well as the matches
# and coach ones. All lazy: initial JS measured 360160B against an unchanged
# 362000 budget. Measured 2195094B.
# 2026-08: 2199000 -> 2208000 -- the analytics wave's lazy half: four widgets
# (SR climb rate, SR by role, effective hero pool, fresh-vs-tilted queue) and
# the attachment UI on the cue row. Measured 2203885B.
: "${MAX_TOTAL_JS_BYTES:=2208000}"
# 2026-07: 322000 → 325000 — the Season Comparison view's scoped styles
# (the A/B/Δ table, scope toggle, controls) add ~2KB. New feature.
# 2026-07: 325000 → 332000 — Form-mode scoped styles (verdict card, preset
# chips, pairing controls, sparklines), ~5KB. New feature.
# 2026-07: 332000 -> 335000 - the Hero Pool band's scoped styles (three-column
# layout, bars, gear), ~1KB. New feature.
# 2026-07: 335000 -> 345000 - Elo Calculator scoped styles (form, cards,
# evidence grid, chart frame), ~5.5KB. New feature.
# 2026-07: 355000 → 368000 — same design-token adoption as the initial
# CSS bump above; total raw 347710 → 362389, total gzipped +674B (1.3%).
# 2026-08: 372000 → 396000 — the film room's geometry plus the paper
# family's per-theme values (measured 389658B).
# 2026-08: 396000 → 400000 — the palette's scoped styles (measured 396218B).
# 2026-08: 400000 → 404000 — the cue strip's own sheet (measured 401396B).
# 2026-08: 404000 → 402000, DOWN. Most of that bump paid for a duplicate: the
# strip and its row both imported one sheet with `scoped src`, and Vue emits
# every rule once per scope hash, so ~2.6KB shipped twice. Each component owns
# its own selectors now; measured 400321B.
# 2026-08: 402000 -> 404000 -- the Reviews tab's scoped sheet: the waiting
# rows, the shelf grid, the paper review card (measured 402432B). Nothing in
# styles/ moved; the tab wears the .settings shell and the paper family.
# 2026-08: 404000 -> 406000 -- the sitting's sheet and shelf card (the reel's
# rail at label size, the title input) and the desk card's "already said"
# quotes (measured 404323B). The sheet pieces' styles moved from the coach
# sheet to the extracted components — moved, not doubled.
# 2026-08: 406000 -> 409000 -- the reviews-UX pass: the index's start block
# and received-card title face, the card's ink rail marks + armed-warning
# body, the pick-hint strip (measured 406134B).
# 2026-08: 409000 -> 415000 -- the review-surfaces pass: the focus-list
# editor rows and their tool chips, the band on 07 (rows, provenance,
# the retired fold), the session nudge toast, the focus-now widget, and
# the ledger's flexed clock row (measured 412644B).
# 2026-08: 415000 -> 418000 -- the Send-to-Coach dialog: its manifest rows,
# replay-code gaps and the fix-these panel. Its dialog CHROME costs nothing,
# because extracting the shared .sheet-* family took 1165B of duplicate back
# out at the same time (416393B before the extraction, 415228B after). New
# surface; ~2.8KB headroom.
# 2026-08: 419000 -> 423000 -- the same campaign's scoped styles: verdict
# chips, the sticky fold cue, the numbers disclosure, visible blocked-reason
# lines, the codes dialog joining the send dialog's grammar. Measured 421518B.
# 2026-08: 423000 -> 427000 -- the same campaign's scoped styles: the
# dossier panel, the orphan drawer, the fork row. Measured 424565B.
: "${MAX_TOTAL_CSS_BYTES:=427000}"

if [[ "${1:-}" == "--build" ]]; then
  # Build into a PID-suffixed staging dir and measure THERE — never
  # frontend/dist. lefthook runs pre-push hooks in parallel, and
  # vite's empty-at-start on the real dist raced any concurrent
  # lint-go-full / coverage hook compiling
  # `//go:embed all:frontend/dist` (the same class the smoke hook was
  # cured of by its isolated worktree). CI calls this script WITHOUT
  # --build and keeps reading the real dist it built one step earlier.
  STAGE_DIR="/tmp/recall-bundle-stage-$$"
  trap 'rm -rf "$STAGE_DIR"' EXIT
  echo "==> building frontend into ${STAGE_DIR} (staged)…"
  npm --prefix "${REPO_ROOT}/frontend" run build -- --outDir "$STAGE_DIR" --emptyOutDir >/dev/null
  DIST_DIR="${STAGE_DIR}/assets"
fi

if [[ ! -d "${DIST_DIR}" ]]; then
  echo "::error::frontend/dist/assets/ not found — run with --build or build first" >&2
  exit 1
fi

# Initial JS = the ENTRY GRAPH the browser downloads before first paint:
# the entry script plus every chunk index.html modulepreloads (Vite emits
# one link per statically-imported chunk). Measuring index-*.js alone
# undercounts the moment the bundler hoists shared eager code into its own
# chunk — which it does as soon as two eager modules share a dependency,
# and which silently made this gate report a 112KB "improvement" that no
# user ever saw.
INDEX_HTML="$(dirname "${DIST_DIR}")/index.html"
if [[ -f "${INDEX_HTML}" ]]; then
  # Collect first, sum second. Under `set -euo pipefail` a grep that matches
  # nothing (exit 1) or a missing chunk in the loop would otherwise kill the
  # script with a bare "exit 1" and no clue why — and an EMPTY index.html is a
  # real artifact here: prepare-frontend-dist's stub path touches one for jobs
  # that only need the //go:embed to resolve.
  entry_files=$(grep -oE '(src|href)="[^"]*/assets/[^"]+\.js"' "${INDEX_HTML}" \
    | sed -E 's/.*\/assets\/([^"]+)"/\1/' | sort -u || true)
  if [[ -z "${entry_files}" ]]; then
    echo "::error::${INDEX_HTML} references no /assets/*.js — stub or failed build?" >&2
    exit 1
  fi
  init_js=0
  # Here-string, not a pipe: a `while read` in a pipeline runs in a subshell
  # and the accumulator would not survive it.
  while read -r f; do
    [[ -n "${f}" ]] || continue
    if [[ ! -f "${DIST_DIR}/${f}" ]]; then
      echo "::error::${INDEX_HTML} references ${f}, absent from ${DIST_DIR} — stale dist?" >&2
      exit 1
    fi
    init_js=$((init_js + $(wc -c <"${DIST_DIR}/${f}")))
  done <<<"${entry_files}"
else
  echo "::warning::${INDEX_HTML} not found — falling back to index-*.js only" >&2
  init_js=$(find "${DIST_DIR}" -name 'index-*.js' -exec wc -c {} + | awk 'END{print $1}')
fi
init_css=$(find "${DIST_DIR}" -name 'index-*.css' -exec wc -c {} + | awk 'END{print $1}')
total_js=$(find "${DIST_DIR}" -name '*.js' -exec wc -c {} + | awk 'END{print $1}')
total_css=$(find "${DIST_DIR}" -name '*.css' -exec wc -c {} + | awk 'END{print $1}')
# Default to 0 when a glob matches nothing so the integer comparisons
# below don't choke on an empty string ("[[ '' -gt N ]]" is a fatal
# bash error). DIST_DIR is always populated post-build in CI; this is a
# guard against the empty edge, not a silent pass.
: "${init_js:=0}"
: "${init_css:=0}"
: "${total_js:=0}"
: "${total_css:=0}"

printf 'Bundle sizes: initial JS=%sB CSS=%sB  total JS=%sB CSS=%sB\n' \
  "${init_js}" "${init_css}" "${total_js}" "${total_css}"
printf 'Budgets:      initial JS=%sB CSS=%sB  total JS=%sB CSS=%sB\n' \
  "${MAX_INITIAL_JS_BYTES}" "${MAX_INITIAL_CSS_BYTES}" "${MAX_TOTAL_JS_BYTES}" "${MAX_TOTAL_CSS_BYTES}"

fail=0
if [[ "${init_js}" -gt "${MAX_INITIAL_JS_BYTES}" ]]; then
  echo "::error::Initial JS chunk ${init_js}B exceeds budget ${MAX_INITIAL_JS_BYTES}B" >&2
  fail=1
fi
if [[ "${init_css}" -gt "${MAX_INITIAL_CSS_BYTES}" ]]; then
  echo "::error::Initial CSS chunk ${init_css}B exceeds budget ${MAX_INITIAL_CSS_BYTES}B" >&2
  fail=1
fi
if [[ "${total_js}" -gt "${MAX_TOTAL_JS_BYTES}" ]]; then
  echo "::error::Total JS ${total_js}B exceeds budget ${MAX_TOTAL_JS_BYTES}B" >&2
  fail=1
fi
if [[ "${total_css}" -gt "${MAX_TOTAL_CSS_BYTES}" ]]; then
  echo "::error::Total CSS ${total_css}B exceeds budget ${MAX_TOTAL_CSS_BYTES}B" >&2
  fail=1
fi
exit "${fail}"
