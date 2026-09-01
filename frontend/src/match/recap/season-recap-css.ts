import badges from '@/styles/badges.css?inline'
import paper from '@/styles/paper.css?inline'
import seasonRecap from '@/styles/season-recap.css?inline'
import themes from '@/styles/themes.css?inline'
import tokens from '@/styles/tokens.css?inline'

/**
 * The app's real stylesheets, as text, for embedding in the season recap.
 *
 * Same rules as the coach sheet's bundle, and for the same reasons: NO
 * `app.css` (an `@import` index, and an @import in a standalone file is an
 * external reach the CSP forbids) and NO `style.css` (its `@font-face` rules
 * carry Google `url()`s; the page falls back to a system stack, which is the
 * right trade for a file that must render with the network off).
 *
 * `badges.css` is in the list because the page's kicker and every headline
 * label is an `.eyebrow`, and that rule lives there — the one visual concept,
 * one rule discipline the app follows does not stop at the app's edge. Without
 * it the whole label-over-number hierarchy rendered as plain spans.
 *
 * Kept apart from `season-recap.ts` so the builder takes its CSS as an
 * argument and stays pure — under Vitest these imports resolve to the empty
 * string, so a builder that read them directly would make its own security
 * assertions vacuous.
 */
export const SEASON_RECAP_CSS = [tokens, themes, badges, paper, seasonRecap].join('\n')
