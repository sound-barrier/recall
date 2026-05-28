import { onScopeDispose } from 'vue'

// Document-level keyboard-shortcut dispatcher.
//
// Registers a single capture-phase keydown listener and routes each
// event through a registry of `Shortcut` records. The capture-phase
// install is deliberate: it runs BEFORE any descendant handlers, so
// the dispatcher gets first refusal on every keystroke and the
// per-shortcut input-gating rule (below) is enforced uniformly.
//
// Three semantics worth flagging at the top:
//
//   1. Input-gating. When `document.activeElement` is an INPUT /
//      TEXTAREA / SELECT or [contenteditable="true"] the dispatcher
//      SKIPS every shortcut except those tagged `allowInInput: true`.
//      Avoids the trap where typing `j` in the search box silently
//      moves card focus.
//
//   2. Modifier suppression. Ctrl / Meta / Alt held → no shortcut
//      fires. The user is mid-OS-shortcut (Cmd-A, Ctrl-R, …); we
//      get out of the way. Shift IS allowed because `?` is `Shift+/`
//      on a US keyboard.
//
//   3. Sequence prefix. A shortcut with `prefix: 'g'` only fires
//      when the prior keystroke was the literal `g` within
//      SEQUENCE_TIMEOUT_MS. Stale prefixes auto-clear so a
//      mid-tap+pause from the user isn't booby-trapped.
//
// Mirror: `useTabKeyboardNav.ts` for the document-listener idiom +
// the lifecycle hook (`onScopeDispose` here because the dispatcher
// lives in App.vue's setup and never unmounts during normal
// operation — explicit teardown keeps the unit tests honest).

export const SEQUENCE_TIMEOUT_MS = 1000

export interface Shortcut {
  // The key character to match (matches `KeyboardEvent.key`, so
  // single chars like 'j' / '/' / '?' or named keys like 'Escape').
  // Provide a string or an array of strings to match any of N.
  key: string | readonly string[]
  // Optional gate. If supplied and returns false, the shortcut is
  // skipped — useful for "only on the Matches view" / "only when a
  // card is focused".
  when?: () => boolean
  // What to do when the shortcut fires. `event.preventDefault()` is
  // called BEFORE the handler so handlers don't need to remember;
  // pass {preventDefault: false} to opt out.
  handler: (e: KeyboardEvent) => void
  // Sequence prefix. When set, this shortcut only fires if the
  // PREVIOUS keypress was the literal `prefix` key, within the
  // SEQUENCE_TIMEOUT_MS window. e.g. `prefix: 'g'` on a handler
  // with `key: 'm'` implements vim-style `g m`.
  prefix?: string
  // Allow the shortcut to fire even when focus is in an INPUT /
  // TEXTAREA / contenteditable. Reserve this for genuinely-global
  // keys (`?`, `Escape`); everything else stays off.
  allowInInput?: boolean
  // Skip the automatic preventDefault. Off by default.
  preventDefault?: boolean
}

// Same `prefix` value is used both for the prefix key itself
// (registered as a regular Shortcut) and for matching follow-up
// keys. We never register a handler for the prefix itself — pressing
// `g` alone is a no-op; it just primes the pending-prefix slot.

function isEditableTarget(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

function keyMatches(shortcut: Shortcut, key: string): boolean {
  const k = shortcut.key
  if (typeof k === 'string') return k === key
  return k.includes(key)
}

export function useKeyboardShortcuts(shortcuts: readonly Shortcut[]) {
  // Set of declared prefix keys — pressing one of these primes the
  // pending-prefix slot; nothing else happens until the next key.
  const prefixKeys = new Set<string>()
  for (const s of shortcuts) {
    if (s.prefix) prefixKeys.add(s.prefix)
  }

  let pendingPrefix: { key: string; expiresAt: number } | null = null

  function onKeydown(e: KeyboardEvent) {
    // Modifier suppression. Shift is allowed because `?` is
    // Shift+/ on US keyboards.
    if (e.ctrlKey || e.metaKey || e.altKey) return

    const key = e.key
    const editable = isEditableTarget()
    const now = Date.now()

    // Clear an expired pending prefix before any matching.
    if (pendingPrefix && pendingPrefix.expiresAt < now) {
      pendingPrefix = null
    }

    // Try matching a sequence shortcut first (prefix + key).
    if (pendingPrefix) {
      const sought = shortcuts.find(s =>
        s.prefix === pendingPrefix!.key &&
        keyMatches(s, key) &&
        (s.when ? s.when() : true) &&
        (editable ? !!s.allowInInput : true),
      )
      pendingPrefix = null
      if (sought) {
        if (sought.preventDefault !== false) e.preventDefault()
        sought.handler(e)
        return
      }
      // Fall through to standard matching — a stale prefix
      // shouldn't swallow a real shortcut on the next keypress.
    }

    // Prime a new prefix if this key is one of the declared
    // sequence prefixes — but only when no input is focused (so
    // typing a literal `g` in the search box doesn't enter
    // sequence mode).
    if (prefixKeys.has(key) && !editable) {
      pendingPrefix = { key, expiresAt: now + SEQUENCE_TIMEOUT_MS }
      e.preventDefault()
      return
    }

    // Standard (non-sequence) shortcut.
    const match = shortcuts.find(s =>
      !s.prefix &&
      keyMatches(s, key) &&
      (s.when ? s.when() : true) &&
      (editable ? !!s.allowInInput : true),
    )
    if (!match) return
    if (match.preventDefault !== false) e.preventDefault()
    match.handler(e)
  }

  document.addEventListener('keydown', onKeydown, { capture: true })

  // The dispatcher is normally installed once in App.vue and lives
  // for the page lifetime, but explicit teardown keeps the unit
  // tests honest and protects against re-mounting in HMR /
  // wails-dev edge cases.
  onScopeDispose(() => {
    document.removeEventListener('keydown', onKeydown, { capture: true })
  })

  // Exposed for tests + for any caller that wants to inspect / reset
  // pending-prefix state (e.g., flush on view change). Production
  // App.vue doesn't need either.
  return {
    hasPendingPrefix: () => pendingPrefix !== null,
    resetPrefix: () => { pendingPrefix = null },
  }
}
