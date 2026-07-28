// Leaf-row / table-row rendering of the two disruption annotations.
//
// Both `annotation.leavers` and `annotation.throwers` are sets of up to three
// sides, so a naive badge-per-side would put six glyphs on an already-dense
// row. Instead each kind gets ONE letter — `L` / `T` — and the sides collapse
// into a tint plus an accessible name. Colour is never the sole carrier: the
// name below is what assistive tech (and the tooltip) reads out, and the detail
// panel shows the full chips.

export type DisruptionKind = 'leavers' | 'throwers'

// 'own' — your side of the scoreboard is implicated (you or a teammate), which
// is the case that excuses a loss. 'enemy' — only the other team, which taints
// a win. 'both' — both teams, so neither reading applies cleanly.
export type DisruptionTint = 'own' | 'enemy' | 'both'

const SIDE_NAMES: Record<string, string> = {
  self:  'you',
  team:  'teammate',
  enemy: 'enemy',
}

// Canonical read order, so two matches with the same sides always render the
// same label regardless of the order the API happened to return them in.
const SIDE_ORDER = ['self', 'team', 'enemy']

function orderedSides(sides: string[]): string[] {
  return SIDE_ORDER.filter((s) => sides.includes(s))
}

export function disruptionTint(sides: string[] | undefined): DisruptionTint | null {
  if (!sides?.length) return null
  const own = sides.includes('self') || sides.includes('team')
  const enemy = sides.includes('enemy')
  if (own && enemy) return 'both'
  return own ? 'own' : 'enemy'
}

// The badge's accessible name and tooltip, e.g. "Leaver: you, teammate".
// Returns '' for an empty set so callers can bind it unconditionally.
export function disruptionLabel(kind: DisruptionKind, sides: string[] | undefined): string {
  if (!sides?.length) return ''
  const noun = kind === 'leavers' ? 'Leaver' : 'Thrower'
  return `${noun}: ${orderedSides(sides).map((s) => SIDE_NAMES[s] ?? s).join(', ')}`
}
