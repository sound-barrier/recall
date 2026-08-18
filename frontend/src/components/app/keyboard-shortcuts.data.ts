import type { ViewId } from '@/composables/shared/keyboard/useTabKeyboardNav'

// Binding catalog for the "?" cheat-sheet modal. Data only — the modal
// SFC owns the context gating and rendering.

/**
 * Discriminates when a group is visible:
 *   - 'always'           → render unconditionally
 *   - 'matches-no-panel' → only on the Matches view AND no panel up
 *   - 'panel'            → only when the detail panel is open
 *   - <ViewId>           → only on that view (the film room included)
 * The Matches/Detail-panel pair flips on `panelOpen` because
 * Matches-view bindings (j / k card focus) are suppressed while the
 * panel is up — the panel takes over those keys.
 */
type ShortcutContext = 'always' | 'matches-no-panel' | 'panel' | ViewId

/** One key→action row in the cheat-sheet. */
interface ShortcutBinding {
  keys: readonly string[]
  action: string
  // How the multiple keys relate: a SEQUENCE you press in order (vim
  // `g` then `m`) → joined with "then"; otherwise the keys are
  // interchangeable ALTERNATIVES (`j` or `↓`) → joined with "or".
  // Defaults to alternatives.
  seq?: boolean
}

/** A titled scope of bindings, gated by its context. */
export interface ShortcutBindingGroup {
  scope: string
  context: ShortcutContext
  bindings: readonly ShortcutBinding[]
}

/** Every binding the app exposes, grouped by scope. */
export const SHORTCUT_GROUPS: readonly ShortcutBindingGroup[] = [
  {
    scope: 'Global',
    context: 'always',
    bindings: [
      { keys: ['/'],            action: 'Focus the match-search input' },
      { keys: ['Esc'],          action: 'Clear & blur the match-search input (when focused)' },
      { keys: ['Enter'],        action: 'Open first hit in the detail panel (from match-search)' },
      { keys: ['g', 'm'],       action: 'Go to Matches view', seq: true },
      { keys: ['g', 'i'],       action: 'Go to Parse view', seq: true },
      { keys: ['g', 's'],       action: 'Go to Settings view', seq: true },
      { keys: ['g', 'u'],       action: 'Go to Unknown view', seq: true },
      { keys: ['g', 'c'],       action: 'Go to Compare view', seq: true },
      { keys: ['g', 'e'],       action: 'Go to Elo Calculator view', seq: true },
      { keys: ['g', 'f'],       action: 'Go to the film room (during a coaching session)', seq: true },
      { keys: ['Ctrl/Cmd', 'K'], action: 'Open the command palette — jump to a view or a match' },
      { keys: ['?'],            action: 'Show this cheatsheet' },
    ],
  },
  {
    // Only reachable while a player's bundle is open, so the group only
    // shows there. The bracket keys work from anywhere IN the room — the
    // coach's hands are on the note, not the reel.
    scope: 'Film room',
    context: 'coach',
    bindings: [
      { keys: ['j', '↓'],       action: 'Next frame on the reel' },
      { keys: ['k', '↑'],       action: 'Previous frame on the reel' },
      { keys: [']'],            action: 'Next frame, from anywhere in the room' },
      { keys: ['['],            action: 'Previous frame, from anywhere in the room' },
      { keys: ['Home'],         action: 'First frame' },
      { keys: ['End'],          action: 'Last frame' },
    ],
  },
  {
    scope: 'Matches view',
    context: 'matches-no-panel',
    bindings: [
      { keys: ['j', '↓'],       action: 'Focus the next match card' },
      { keys: ['k', '↑'],       action: 'Focus the previous match card' },
      { keys: ['g', 'g'],       action: 'Focus the first card', seq: true },
      { keys: ['G'],            action: 'Focus the last card' },
      { keys: ['n'],            action: 'Jump to the next group section' },
      { keys: ['N'],            action: 'Jump to the previous group section' },
      { keys: ['l', '→'],       action: 'Open the detail panel for the focused card' },
      { keys: ['e'],            action: 'Open / close the detail panel for the focused card' },
      { keys: ['t'],            action: 'Focus the tags editor (auto-opens the detail panel)' },
    ],
  },
  {
    scope: 'Narrow panel (filters)',
    context: 'matches-no-panel',
    bindings: [
      { keys: ['/'],            action: 'Open the panel & focus search' },
      { keys: ['Tab'],          action: 'From an empty field, jump to the next toggle' },
      { keys: ['⇧', 'Tab'],     action: 'From an empty field, jump to the previous toggle', seq: true },
      { keys: ['Esc'],          action: 'Close the panel' },
    ],
  },
  {
    scope: 'Detail panel',
    context: 'panel',
    bindings: [
      // `<` and `>` glyphs lead the row so the user reads "go back /
      // go forward" at a glance. The actual key tokens follow.
      { keys: ['<', '←', 'h', 'k'], action: 'Previous match (timeline ←)' },
      { keys: ['>', '→', 'l', 'j'], action: 'Next match (timeline →)' },
      { keys: ['↓'],            action: 'Scroll panel body down' },
      { keys: ['↑'],            action: 'Scroll panel body up' },
      { keys: ['PgDn', 'Space'], action: 'Scroll panel body one page down' },
      { keys: ['PgUp'],         action: 'Scroll panel body one page up' },
      { keys: ['Home'],         action: 'Jump to top of panel body' },
      { keys: ['End'],          action: 'Jump to bottom of panel body' },
      { keys: ['Esc'],          action: 'Close the detail panel' },
    ],
  },
  {
    // New group — surfaces when the panel is open (which is also when
    // the lightbox can be reached). Explicit "only for the same
    // match" copy so the user doesn't conflate this with the panel's
    // own prev/next-match shortcut.
    scope: 'Screenshots (in the fullscreen lightbox)',
    context: 'panel',
    bindings: [
      { keys: ['<', '←', 'h'], action: 'Previous screenshot — only for the same match' },
      { keys: ['>', '→', 'l'], action: 'Next screenshot — only for the same match' },
      { keys: ['Esc'],         action: 'Close the lightbox (returns to the panel)' },
    ],
  },
  {
    scope: 'Tablist + modals',
    context: 'always',
    bindings: [
      // `<` / `>` glyphs lead the row for consistency with the panel
      // and lightbox rows above.
      { keys: ['<', '←', 'h'], action: 'Previous tab (focus a tab button first)' },
      { keys: ['>', '→', 'l'], action: 'Next tab (focus a tab button first)' },
      { keys: ['Home'],         action: 'First tab' },
      { keys: ['End'],          action: 'Last tab' },
      { keys: ['Tab'],          action: 'Cycle focusable elements (Shift+Tab reverses)' },
      { keys: ['Esc'],          action: 'Close the active modal / cheatsheet' },
    ],
  },
]
