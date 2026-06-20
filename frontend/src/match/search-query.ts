// Match-search query parser. The FilterRail's search input takes a
// vim/less-style query string with two shapes:
//
//   • bare token        → matches anywhere in note/replay/members/tags
//   • <field>:<value>   → matches only that field (note, replay,
//                         member[s], tag[s])
//
// Multiple tokens AND together. Values may be quoted with `"..."` to
// preserve internal whitespace. Unknown field names fall through as
// bare text (so a typo like `nots:foo` still searches, just less
// usefully). The parser is pure + side-effect-free so the live
// reactive filter can re-parse on every keystroke without ceremony.

export type SearchField = 'note' | 'replay' | 'member' | 'tag'

export interface SearchClause {
  // null = bare clause (matches any field); otherwise the canonical
  // field name. Plurals collapse: `tags:` and `tag:` both produce
  // `field: 'tag'`.
  field: SearchField | null
  // Lower-cased; whitespace within quoted values is preserved.
  value: string
}

const FIELD_ALIASES: Record<string, SearchField> = {
  note:    'note',
  notes:   'note',
  replay:  'replay',
  replays: 'replay',
  member:  'member',
  members: 'member',
  tag:     'tag',
  tags:    'tag',
}

// Detect a `<field>:` prefix at `i` — the run of non-space/colon/quote chars up
// to the first colon, if it maps to a known field. Returns the canonical field
// (or null for a bare token) and the index where the value starts.
function detectField(raw: string, i: number, len: number): { field: SearchField | null; valueStart: number } {
  let scan = i
  while (scan < len && raw[scan] !== ' ' && raw[scan] !== ':' && raw[scan] !== '"') scan++
  if (scan < len && raw[scan] === ':' && scan > i) {
    const mapped = FIELD_ALIASES[raw.slice(i, scan).toLowerCase()]
    if (mapped) return { field: mapped, valueStart: scan + 1 }
  }
  return { field: null, valueStart: i }
}

// Consume the value starting at `valueStart`: a `"..."` quoted run (internal
// whitespace preserved, up to the closing quote or end of input) or a bare run
// up to the next space. Returns the value + the index to resume scanning from.
function consumeValue(raw: string, valueStart: number, len: number): { value: string; nextIndex: number } {
  if (raw[valueStart] === '"') {
    const end = raw.indexOf('"', valueStart + 1)
    if (end < 0) return { value: raw.slice(valueStart + 1), nextIndex: len }
    return { value: raw.slice(valueStart + 1, end), nextIndex: end + 1 }
  }
  let end = valueStart
  while (end < len && raw[end] !== ' ') end++
  return { value: raw.slice(valueStart, end), nextIndex: end }
}

// parseSearchQuery turns the raw input string into a list of clauses. Empty
// input returns an empty array (no filter active). Multiple tokens AND together.
export function parseSearchQuery(raw: string): SearchClause[] {
  const out: SearchClause[] = []
  const len = raw.length
  let i = 0
  while (i < len) {
    while (i < len && raw[i] === ' ') i++ // skip whitespace between tokens
    if (i >= len) break
    const { field, valueStart } = detectField(raw, i, len)
    const { value, nextIndex } = consumeValue(raw, valueStart, len)
    i = nextIndex
    // Empty values (e.g. a trailing `note:` while the user is mid-typing) stay
    // inert — drop them so the filter waits for something to match against.
    if (value) out.push({ field, value: value.toLowerCase() })
  }
  return out
}

// Returns the substrings to highlight inside a given field's content
// for the current set of clauses. Bare clauses contribute their value
// to every field's highlight set; scoped clauses only contribute to
// the matching field. The returned strings are deduped + lower-cased,
// ready to feed into `highlightSubstring`-style renderers.
export function highlightTermsFor(field: SearchField, clauses: SearchClause[]): string[] {
  const set = new Set<string>()
  for (const c of clauses) {
    if (c.field === null || c.field === field) set.add(c.value)
  }
  return [...set]
}
