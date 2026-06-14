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

// parseSearchQuery turns the raw input string into a list of clauses.
// Empty input returns an empty array (no filter active).
export function parseSearchQuery(raw: string): SearchClause[] {
  const out: SearchClause[] = []
  const len = raw.length
  let i = 0
  while (i < len) {
    // Skip leading whitespace between tokens.
    while (i < len && raw[i] === ' ') i++
    if (i >= len) break

    // Try to detect a `<field>:` prefix BEFORE the value starts. The
    // field name is the run of alphanumerics up to the first colon.
    // If there's no colon before the next space (or no recognised
    // field name) the whole token is bare.
    let field: SearchField | null = null
    let valueStart = i
    let scan = i
    while (scan < len && raw[scan] !== ' ' && raw[scan] !== ':' && raw[scan] !== '"') scan++
    if (scan < len && raw[scan] === ':' && scan > i) {
      const candidate = raw.slice(i, scan).toLowerCase()
      const mapped = FIELD_ALIASES[candidate]
      if (mapped) {
        field = mapped
        valueStart = scan + 1
      }
    }

    // Consume the value. Quoted strings preserve internal whitespace
    // and consume up to the closing quote (or end of input).
    let value = ''
    if (raw[valueStart] === '"') {
      const end = raw.indexOf('"', valueStart + 1)
      if (end < 0) {
        value = raw.slice(valueStart + 1)
        i = len
      } else {
        value = raw.slice(valueStart + 1, end)
        i = end + 1
      }
    } else {
      let end = valueStart
      while (end < len && raw[end] !== ' ') end++
      value = raw.slice(valueStart, end)
      i = end
    }

    // Empty values are useless — e.g. a trailing `note:` with no
    // following text is the user mid-typing. Drop them so the filter
    // stays inert until the user gives us something to match against.
    if (!value) continue
    out.push({ field, value: value.toLowerCase() })
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
