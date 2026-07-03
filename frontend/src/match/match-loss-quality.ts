// Loss-quality classification (audit product gap): was that loss a
// nail-biter or a stomp? Derived read-side from the OCR'd
// final_score — nothing is stored, so a corrected score re-classifies
// on the next render.
//
// The rule is deliberately mode-agnostic (control plays to 2,
// flashpoint to 3, clash to 5 — absolute margins don't compare):
//   - margin 1                    → close   (one fight from winning)
//   - shutout (loser scored 0)
//     or margin ≥ 3               → stomp
//   - everything else            → normal
// Victories and draws never classify; a missing or unparseable score
// returns null (the widget reports those as unscored).
//
// game_length was considered as a secondary signal (short + lopsided
// = stomp) and deliberately left out of v1: score margin alone is
// explainable at a glance, and mode-relative length baselines aren't.

export type LossQuality = 'close' | 'normal' | 'stomp'

const SCORE_RE = /^(\d+)\s*-\s*(\d+)$/

// lossQuality classifies a defeat's final score. Returns null for
// non-defeats or scores that don't parse as "X-Y".
export function lossQuality(result: string | undefined, finalScore: string | undefined): LossQuality | null {
  if (result !== 'defeat' || !finalScore) return null
  const m = SCORE_RE.exec(finalScore.trim())
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  const margin = Math.abs(a - b)
  const loserScore = Math.min(a, b)
  if (loserScore === 0 || margin >= 3) return 'stomp'
  if (margin === 1) return 'close'
  return 'normal'
}
