// The coach's note vocabulary and the pure draft logic behind the Film
// Room's editor, reel marks, and session sheet. A draft is the editor's
// in-memory shape; toNoteInput / fromWireNote translate at the API seam.

/** The fixed focus vocabulary, in chip order. The server validates focus_tags against the same list. */
export const FOCUS_TAGS = [
  'positioning',
  'ult_economy',
  'target_priority',
  'cooldowns',
  'hero_pick',
  'comms',
  'mechanics',
  'mental',
] as const

type FocusTag = (typeof FOCUS_TAGS)[number]

const FOCUS_TAG_LABELS: Record<FocusTag, string> = {
  positioning: 'positioning',
  ult_economy: 'ult economy',
  target_priority: 'target priority',
  cooldowns: 'cooldowns',
  hero_pick: 'hero pick',
  comms: 'comms',
  mechanics: 'mechanics',
  mental: 'mental',
}

function isFocusTag(tag: string): tag is FocusTag {
  return Object.hasOwn(FOCUS_TAG_LABELS, tag)
}

/** The human label a chip carries; a freeform extra tag is its own label. */
export function focusTagLabel(tag: string): string {
  return isFocusTag(tag) ? FOCUS_TAG_LABELS[tag] : tag
}

type CoachNoteKind = 'note' | 'reviewed_only'

export interface CoachNoteDraft {
  kind: CoachNoteKind
  text: string
  focusTags: string[]
  extraTags: string[]
  matchClock: string
}

export type NoteMark = 'written' | 'reviewed'

export function emptyDraft(): CoachNoteDraft {
  return { kind: 'note', text: '', focusTags: [], extraTags: [], matchClock: '' }
}

// A clock alone is not a note: something has to be said (text) or pointed
// at (a tag) for the frame to carry a mark and the draft to be saved.
function saysSomething(d: CoachNoteDraft): boolean {
  return d.text.trim() !== '' || d.focusTags.length > 0 || d.extraTags.length > 0
}

/** What the reel frame shows for this draft: 'reviewed' for a reviewed-only mark, 'written' for a note that says something, null otherwise. */
export function noteMark(d: CoachNoteDraft | undefined): NoteMark | null {
  if (!d) return null
  if (d.kind === 'reviewed_only') return 'reviewed'
  return saysSomething(d) ? 'written' : null
}

/** True when there is nothing to save — the autosave sends a DELETE instead of a PUT. */
export function isEmptyDraft(d: CoachNoteDraft): boolean {
  return noteMark(d) === null
}

/** The suffix appended to a reel frame's accessible name: " — note written", " — reviewed", or "". */
export function frameNameSuffix(d: CoachNoteDraft | undefined): string {
  const mark = noteMark(d)
  if (mark === 'written') return ' — note written'
  if (mark === 'reviewed') return ' — reviewed'
  return ''
}

const MATCH_CLOCK = /^(\d{1,2}):([0-5]\d)$/

/** Normalize an in-match clock ("4:12" / "04:12") to "MM:SS"; null when it is not a clock. */
export function parseMatchClock(raw: string): string | null {
  const m = raw.trim().match(MATCH_CLOCK)
  if (!m) return null
  return `${m[1]!.padStart(2, '0')}:${m[2]!}`
}

export interface FocusCount {
  tag: string
  count: number
}

// Vocabulary tags sort in chip order; extras follow them alphabetically,
// so the tally reads the same however the notes object was assembled.
function tagRank(tag: string): number {
  const at = (FOCUS_TAGS as readonly string[]).indexOf(tag)
  return at < 0 ? FOCUS_TAGS.length : at
}

function compareFocusCounts(a: FocusCount, b: FocusCount): number {
  if (a.count !== b.count) return b.count - a.count
  const rank = tagRank(a.tag) - tagRank(b.tag)
  if (rank !== 0) return rank
  if (a.tag === b.tag) return 0
  return a.tag < b.tag ? -1 : 1
}

/** Per-tag counts across the session's notes (vocabulary and extras alike), most-used first. */
export function tallyFocus(notes: Record<string, CoachNoteDraft>): FocusCount[] {
  const counts = new Map<string, number>()
  for (const d of Object.values(notes)) {
    for (const tag of [...d.focusTags, ...d.extraTags]) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts].map(([tag, count]) => ({ tag, count })).sort(compareFocusCounts)
}

/** "7 notes · 1 reviewed only · Ordo" — the reviewed clause only when there are any, the coach only when named. */
export function notesSummaryLine(notes: Record<string, CoachNoteDraft>, coachName: string): string {
  const marks = Object.values(notes).map(noteMark).filter((m) => m !== null)
  const reviewed = marks.filter((m) => m === 'reviewed').length
  const parts = [`${marks.length} note${marks.length === 1 ? '' : 's'}`]
  if (reviewed > 0) parts.push(`${reviewed} reviewed only`)
  if (coachName) parts.push(coachName)
  return parts.join(' · ')
}

/** The note as the API carries it — the PUT body, and the shape a session view hydrates from. */
export interface CoachNoteWire {
  kind: CoachNoteKind
  text: string
  focus_tags: string[]
  extra_tags: string[]
  match_clock: string
}

export function toNoteInput(d: CoachNoteDraft): CoachNoteWire {
  return {
    kind: d.kind,
    text: d.text,
    focus_tags: [...d.focusTags],
    extra_tags: [...d.extraTags],
    match_clock: d.matchClock,
  }
}

/** Hydrate a draft from a wire note; only `kind` is required so a response with omitted empties still maps. */
export function fromWireNote(n: Pick<CoachNoteWire, 'kind'> & Partial<CoachNoteWire>): CoachNoteDraft {
  return {
    kind: n.kind,
    text: n.text ?? '',
    focusTags: [...(n.focus_tags ?? [])],
    extraTags: [...(n.extra_tags ?? [])],
    matchClock: n.match_clock ?? '',
  }
}
