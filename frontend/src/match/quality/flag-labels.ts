import type { FieldCheckEnum, FieldReading, FieldReadingOriginEnum, MatchRecord } from '@/api-client'

// The words the flagged-reading review uses: what a field is called, why the
// cross-check doubted it, and how each reading was made. Keyed lookups over
// the wire's closed vocabularies, so a new check or origin is a type error
// here until it has words.

const SCALAR_LABEL: Record<string, string> = {
  eliminations: 'Eliminations',
  assists: 'Assists',
  deaths: 'Deaths',
  damage: 'Damage',
  healing: 'Healing',
  mitigation: 'Mitigation',
  result: 'Result',
  level: 'Division',
  rank_progress: 'Rank progress',
  change_percent: 'Rank change',
  rank_percentile: 'Rank percentile',
  heroes_played: 'Heroes played',
}

/** Why the cross-check doubted a reading, one sentence per check. */
export const CHECK_LABEL: Record<FieldCheckEnum, string> = {
  perf_total_vs_rate: 'The total disagrees with its own per-10-minute rate over the time played.',
  hero_percent_vs_playtime: "The hero's share disagrees with its share of the listed play time.",
  plausible_range: 'No match can produce this value.',
  result_vs_rank_movement: 'The result disagrees with how the rank moved.',
  source_disagreement: 'Two screenshots of this match read it differently.',
  template_disagreement: 'The reference templates read the same pixels as something else.',
}

const ORIGIN_LABEL: Record<FieldReadingOriginEnum, (file: string) => string> = {
  ocr: (file) => `read by OCR from ${file}`,
  template: (file) => `matched by the reference templates on ${file}`,
  derived: (file) => `worked out from ${file}`,
}

/** How a reading was made and from which screenshot. */
export function readingSource(reading: FieldReading): string {
  return ORIGIN_LABEL[reading.origin](reading.source_file)
}

type HeroLabel = (hero: string, rest: string) => string | null

// Hero keys are matched whole against the record's own heroes, as the server
// matches them, since a key can hold the "." that separates path segments.
const HERO_PATHS: readonly HeroLabel[] = [
  (hero, rest) => (rest === `heroes_played.${hero}.percent_played` ? `${hero} share of play` : null),
  (hero, rest) => (rest === `heroes_played.${hero}` ? `Hero on the ${hero} card` : null),
  (hero, rest) => {
    const prefix = `heroes_played.${hero}.stats.`
    return rest.startsWith(prefix) ? `${hero} ${rest.slice(prefix.length).replaceAll('_', ' ')}` : null
  },
]

const SR_PATHS: readonly HeroLabel[] = [
  (hero, rest) => (rest === `sr.${hero}.sr` ? `${hero} SR` : null),
  (hero, rest) => (rest === `sr.${hero}` ? `Hero on the ${hero} rank card` : null),
]

function firstLabel(heroes: string[], rules: readonly HeroLabel[], rest: string): string | null {
  for (const hero of heroes) {
    for (const rule of rules) {
      const label = rule(hero, rest)
      if (label) return label
    }
  }
  return null
}

/** What the review calls a field; the path itself when it has no words for one. */
export function fieldLabel(path: string, data: Pick<MatchRecord['data'], 'heroes_played' | 'sr'>): string {
  if (!path.startsWith('data.')) return path
  const rest = path.slice('data.'.length)
  return SCALAR_LABEL[rest]
    ?? firstLabel((data.heroes_played ?? []).map((h) => h.hero), HERO_PATHS, rest)
    ?? firstLabel((data.sr ?? []).map((s) => s.hero), SR_PATHS, rest)
    ?? path
}
