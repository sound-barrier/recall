import type { MatchRecord } from '@/api-client'
import type { Season } from '@/composables/shared/useOWData'
import { buildSeasonRecap, toRecapInput } from '@/match/recap/season-recap'
import { SEASON_RECAP_CSS } from '@/match/recap/season-recap-css'

/**
 * The one lazy entrypoint for building a season recap.
 *
 * Exists to be a CHUNK BOUNDARY, for the reason the coach sheet's twin
 * documents: importing the builder and the CSS separately lets Rollup hoist
 * the builder into the entry chunk whenever it shares a dependency with
 * startup code. One module is one unit the bundler can move, and it moves it.
 */
export function renderSeasonRecap(records: readonly MatchRecord[], season: Season): string {
  return buildSeasonRecap(toRecapInput(records, season), SEASON_RECAP_CSS)
}

/** A filename that sorts and reads: the season, slugified. */
export function seasonRecapFilename(season: Season): string {
  const slug = season.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `recall-recap-${slug || 'season'}.html`
}
