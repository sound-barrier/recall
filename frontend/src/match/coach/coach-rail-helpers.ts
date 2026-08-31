import type { MatchRecord } from '@/api-client'

// The film-room stat rail: what this player usually does on the hero and the
// map in front of the coach right now.
//
// The corpus is already loaned and already on screen; before this, reading a
// tendency off it meant leaving the room for the Matches tab, which is the
// one thing a coach mid-frame will not do. So the rail answers ONE question,
// twice — once for the frame's hero, once for its map.

// RAIL_LOW_SAMPLE is where a bucket stops being an accident. A bundle is
// six matches, so buckets of one or two are the NORM here, not the
// exception — presenting "100%" off a single game as a tendency would be
// the rail's most likely output and its least true one.
export const RAIL_LOW_SAMPLE = 4

// One dimension's tendency. `played` counts every match in the bucket;
// `w`/`l` and the rate count only decisive ones; `statSample` counts the
// matches that actually carried an E/A/D reading, which is a different and
// usually smaller number.
export interface RailTendency {
  key: string
  dimension: 'hero' | 'map'
  played: number
  w: number
  l: number
  winrate: number | null
  elims: number | null
  assists: number | null
  deaths: number | null
  statSample: number
  lowSample: boolean
}

interface FrameSubject {
  hero: string
  map: string
}

// railTendencies returns the hero row then the map row, skipping either
// dimension the frame cannot name — an empty key would pool every unread
// match into one meaningless bucket.
export function railTendencies(records: MatchRecord[], subject: FrameSubject): RailTendency[] {
  const rows: RailTendency[] = []
  if (subject.hero) {
    rows.push(tendency(records.filter((r) => r.data?.hero === subject.hero), subject.hero, 'hero'))
  }
  if (subject.map) {
    rows.push(tendency(records.filter((r) => r.data?.map === subject.map), subject.map, 'map'))
  }
  return rows
}

function tendency(bucket: MatchRecord[], key: string, dimension: 'hero' | 'map'): RailTendency {
  const w = bucket.filter((r) => r.data?.result === 'victory').length
  const l = bucket.filter((r) => r.data?.result === 'defeat').length
  const decided = w + l
  return {
    key,
    dimension,
    played: bucket.length,
    w,
    l,
    // A draw is not a loss, so an all-draws bucket has no rate to report.
    // 0% would read as "you lost every game".
    winrate: decided === 0 ? null : Math.round((w / decided) * 100),
    ...averageEAD(bucket),
    lowSample: decided < RAIL_LOW_SAMPLE,
  }
}

// averageEAD folds the RAW per-match eliminations / assists / deaths.
//
// Deliberately not performance.*.avg_per_10min, which the dossier's other
// surfaces use: those are a rate per ten minutes and these are a count per
// match, so averaging one set into the other produces a number that means
// nothing and looks fine. Raw E/A/D is also reconciled across TEAMS and
// SUMMARY at read time, so it is present far more often.
//
// Matches with no reading are skipped rather than counted as zero — a
// screenshot Recall could not read is not a game the player got no
// eliminations in.
function averageEAD(bucket: MatchRecord[]) {
  const readings = bucket.filter((r) => hasEAD(r))
  if (readings.length === 0) {
    return { elims: null, assists: null, deaths: null, statSample: 0 }
  }
  const mean = (pick: (r: MatchRecord) => number | undefined) =>
    Math.round((readings.reduce((sum, r) => sum + (pick(r) ?? 0), 0) / readings.length) * 10) / 10
  return {
    elims: mean((r) => r.data?.eliminations),
    assists: mean((r) => r.data?.assists),
    deaths: mean((r) => r.data?.deaths),
    statSample: readings.length,
  }
}

function hasEAD(r: MatchRecord): boolean {
  const d = r.data
  return d?.eliminations != null || d?.assists != null || d?.deaths != null
}
