import type { MatchRecord } from '@/api-client'
import { matchTime } from '@/match/match-time-helpers'

// What to send a coach, proposed.
//
// The send dialog opens over whatever the user had selected, which means
// the work of choosing happens BEFORE the dialog — scrolling the list,
// ticking boxes, remembering what already went out. These two suggestions
// do the remembering, and the user edits the result.

// SUGGESTION_LIMIT keeps a proposal reviewable. A suggestion is a starting
// point somebody reads before sending, not a bulk export — and a coach who
// receives forty matches reviews none of them.
export const SUGGESTION_LIMIT = 12

export interface ShareSuggestion {
  id: 'since-last-send' | 'focus-losses'
  label: string
  keys: string[]
}

export interface SuggestionInputs {
  records: MatchRecord[]
  /** Every key that has gone out in a previous bundle. */
  alreadySent: string[]
  /** The text of the OPEN focus items — what the player is working on. */
  focusText: string[]
  /** The canonical names the roster knows, lowercase. */
  names: { heroes: string[]; maps: string[] }
}

// shareSuggestions returns the proposals that have something to propose;
// one with nothing in it is left out rather than offered empty.
export function shareSuggestions(input: SuggestionInputs): ShareSuggestion[] {
  // Filtered ONCE, at the top, because it is the rule both proposals must
  // obey: a suggestion that lands the user in the dialog's own refusal —
  // "N of these have no replay code" — costs them a click and teaches them
  // the button is broken.
  const loadable = input.records.filter((r) => (r.annotation?.replay_code ?? '') !== '')
  const out: ShareSuggestion[] = []

  const sent = new Set(input.alreadySent)
  const unsent = newestFirst(loadable.filter((r) => !sent.has(r.match_key)))
  if (unsent.length > 0) {
    out.push({
      id: 'since-last-send',
      label: `Everything since your last send · ${capped(unsent).length}`,
      keys: capped(unsent),
    })
  }

  const subjects = namesInText(input.focusText, input.names)
  if (subjects.size > 0) {
    const losses = newestFirst(loadable.filter((r) =>
      r.data?.result === 'defeat'
      && (subjects.has(r.data?.hero ?? '') || subjects.has(r.data?.map ?? ''))))
    if (losses.length > 0) {
      out.push({
        id: 'focus-losses',
        label: `Recent losses on what you're working on · ${capped(losses).length}`,
        keys: capped(losses),
      })
    }
  }
  return out
}

function capped(records: MatchRecord[]): string[] {
  return records.slice(0, SUGGESTION_LIMIT).map((r) => r.match_key)
}

// Newest first — a review is about what happened lately, and a cap that
// took the oldest twelve would propose exactly the wrong dozen.
function newestFirst(records: MatchRecord[]): MatchRecord[] {
  return [...records].sort((a, b) => matchTime(b).localeCompare(matchTime(a)))
}

// namesInText finds the canonical hero and map names a focus item mentions.
//
// A focus item stores no hero and no map — it is a sentence somebody wrote
// ("Hold high ground longer on Ana"). Reading the names back out of that
// sentence is what ties the two features together without making every
// coach re-tag their items, and it costs nothing when it finds nothing.
//
// Whole names only. A name buried inside another word is a coincidence —
// "panicking" contains no advice about Ana — so each candidate is checked
// against the token sequence rather than by substring.
function namesInText(texts: string[], names: { heroes: string[]; maps: string[] }): Set<string> {
  const found = new Set<string>()
  const haystacks = texts.map((t) => ` ${tokenize(t)} `)
  for (const name of [...names.heroes, ...names.maps]) {
    const needle = ` ${tokenize(name)} `
    if (haystacks.some((h) => h.includes(needle))) found.add(name)
  }
  return found
}

// Lowercase, and every run of non-letter/digit characters collapsed to one
// space — so "King's Row" in an item matches the stored "king's row", and
// "Soldier: 76" matches whichever way either side punctuated it.
function tokenize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
