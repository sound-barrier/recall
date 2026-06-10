# Bundle-size budget history

The four byte budgets in `scripts/check-bundle-size.sh` get bumped
when real features need the room. This is the running record of why
each bump happened, so a future maintainer doesn't have to
`git blame` a single overgrown comment.

Append a row to the table when you bump a budget. Date in ISO 8601;
the **PR** column is whichever PR landed the bump; the **JS** /
**CSS** columns are the **total** budgets after the change (in
bytes — same units the script asserts against). One-line rationale,
no soft-pedalling. Numbers that go down get a row too.

| Date | PR | Init JS | Init CSS | Total JS | Total CSS | Rationale |
|---|---|---|---|---|---|---|
| 2026-06-10 | map-role-band | 161000 | 63000 | 476000 | 274000 | feat(matches): Geography Map × Role performance band (full-width heatmap after the Campaign Log) + 1M window option on both heatmaps. New `MatchMapRoleBand.vue` (3 role rows × all-maps-grouped-by-type grid) + `mapRoleCounts` windowed dossier aggregate. Net ~3.7 KB total JS + ~3.4 KB total CSS — all in the lazy MatchesView chunk. Initial budgets UNCHANGED: `winrateVolumeFill` was deliberately split into `match-heatmap-helpers.ts` (band-only import) instead of `match-helpers.ts`, which App.vue pulls into the initial chunk — keeping the initial JS flat (160857 B, under the 161000 cap). |
| 2026-06-10 | design-system-tightening | 161000 | 63000 | 470000 | 268000 | refactor(ui): design system tightening (1.0 plan §C subset). Settings section dividers (1 selector + 4 lines) + Day theme pulse halo (box-shadow on records-pulse keyframes) + danger-confirm pulse keyframe + reduced-motion fallback in MatchCardDanger.vue. Net 30 B over the prior CSS cap (62030 vs 62000). Bumped to 63000 for headroom on PR #8 (split large components) which will shuffle some CSS between scoped blocks. |
| 2026-06-10 | ux-first-run-and-error-states | 161000 | 62000 | 470000 | 268000 | fix(ux): first-run + error states (1.0 plan §C). New `error-helpers.ts::plainLanguageError` translator (~7 raw-Go regex → CTA mappings) imported synchronously by App.vue + `setError`/`setErrorFromRaw`/`clearError`/`errorRetry` seams + Retry/Dismiss banner DOM. Net 264 B over the prior cap (160264 vs 160000). Bumped to 161000 for headroom on this PR's follow-ups in the same area; the translator is intentionally NOT lazy because it's called on every error-setting site at the top of App.vue. |
| 2026-06-09 | single-button-game-data | 160000 | 62000 | 470000 | 268000 | feat(updates)!: single "Update game data" button + diff preview manifest. UpdateCheckModal rewritten — Release sub-row deleted (smaller), but new freshness header + counts headline (display-font sizing) + manifest grid (3-col + kind chips + ± color states) add ~5 KB of CSS net. Total JS actually drops slightly because the release-channel state machine + ApplyDataUpdate wrapper are gone. |
| 2026-06-09 | live-data-channel | 160000 | 62000 | 470000 | 263000 | feat(updates): from-main YAML channel + Sync from main UI. UpdateCheckModal grew a second sub-row + state machine + ApplyMainDataUpdate wrapper + extended UpdateInfo with MainStatus. Net ~3 KB total JS over the previous bump (modal still lazy; the extra bytes are in the lazy chunk, not initial). |
| 2026-06-09 | updates-modal-banner | 160000 | 62000 | 465000 | 263000 | feat(updates)!: replace silent roster fetch with explicit modal + reminder. UpdateCheckModal (lazy ~6.6 KB JS + ~3 KB CSS) + UpdateReminderBanner (~2 KB JS + ~2 KB CSS) + useUpdateReminder + extended UpdateInfo wiring. Net ~6.5 KB total JS / ~8 KB total CSS / ~1.5 KB initial CSS (banner styles in App.vue). |
| 2026-06-08 | leaf-virtual-integration | 160000 | 60000 | 458000 | 254000 | Item 1 integration — useVirtualWindow wired into MatchesView for the flat (groupBy='none') leaf-row path. Net ~3 KB JS (window-mode geometry + spacer template branch + auto-scroll-into-view + measureLeafHeight). |
| 2026-06-08 | source-picker-callout | 160000 | 60000 | 455000 | 254000 | Item 13 surface B — ContextualCallout + useContextualCallout primitives landed in PR #235 but didn't ship in any chunk until a consumer (ScreenshotSourcePicker) wired them in. Net ~2 KB JS (callout SFC + composable) + ~1.2 KB CSS (callout styles). |
| 2026-06-08 | hero-maptype-heatmap | 160000 | 60000 | 450000 | 252000 | Item 2 — Hero × map-type heatmap dossier widget + the new provideNarrow/useNarrow injection seam wiring. Net ~3 KB JS (widget SFC + helper + narrow seam) + ~0.5 KB CSS (grid styles). |
| 2026-06-08 | ui-polish-set | 160000 | 60000 | 445000 | 250000 | UI polish set (items 3 / 4 / 5 / 6 / 7 / 8 / 10 / 12 from UI_RECOMMENDATIONS.md): TypeaheadDropdown + inline tag autocomplete + bulk-tag + extended right-click menu + leaf hover preview + smart-empty suggestions + saved-set presets + supported-formats surface + re-parse progress. Combined ~22 KB JS + ~8 KB CSS — CSS budget bumped during commit 7 (saved-set presets footer surface). |
| 2026-06-08 | technical-debt-sweep | 156000 | 60000 | 422000 | 242000 | match-helpers.ts split into 5 topic files. Total JS dropped slightly, but Vite's chunking heuristic hoisted the smaller new modules into the initial chunk, lifting initial JS ~10 KB. Tradeoff is intentional — readability of the topic split outweighs the chunk-boundary shift; total stays under cap. |
| 2026-06-08 | #227 | 146000 | 60000 | 422000 | 242000 | Parser tightening (length-gated fuzzy Pass-2) + the Reference-data-gaps UI on the Unknown tab landed alongside the screenshot-source picker. Combined coverage. |
| 2026-06-08 | #226 | 146000 | 60000 | 422000 | 242000 | Windows screenshot source picker (4-card grid) — net JS +14 KB across `ScreenshotSourcePicker.vue` + first-run wiring. CSS bumped to absorb the picker grid styles. |
| 2026-06-05 | #224 | 146000 | 60000 | 408000 | 230000 | Parser fuzzy fix + `hero_raw`/`map_raw` schema + Unknown-hero leaf chip + detail-panel gap banner. |
| pre-2026-06 | — | varies | varies | varies | varies | Prior bumps stacked one-line rationales onto the comment in `scripts/check-bundle-size.sh`. Anyone curious can `git log -p scripts/check-bundle-size.sh` to walk the older bumps; representative ones include `19febaf chore(bundle): bump JS+CSS budgets for the PR 6 sort+group dropdown` and the various PR D/E/F dashboard waves. |

## When to bump

- **A real feature needs the room.** The 2026-06-08 audit reset the
  floor lower than the previous "just bump it" drift; future bumps
  should be specific and justified.
- **Substantial modal surfaces should ride
  `defineAsyncComponent(() => import(...))`** so they land in their
  own chunk and stay out of the initial budget. The detail panel,
  screenshot lightbox, and cheatsheet are the pattern to mirror.
  `App.lazy-views.test.ts` is the regression guard that fails if a
  static import sneaks back in.
- **Don't bump to silence noise.** If a non-feature PR is pushing
  the budget, that's a bug — investigate before lifting the cap.

## Where this is checked

- `scripts/check-bundle-size.sh` — the assertion. Run by CI's
  "Enforce bundle-size budget" step + lefthook's pre-push.
- `.github/workflows/ci.yml` — the CI invocation.
- `lefthook.yml` — the pre-push invocation (uses the script's
  defaults, no env overrides).
