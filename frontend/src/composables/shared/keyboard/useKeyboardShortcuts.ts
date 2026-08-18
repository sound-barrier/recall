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
  // Require the platform's command modifier (Ctrl on Windows/Linux, Cmd on
  // macOS). Off by default, and the default is the important half: every other
  // shortcut in this app is a bare key, so a modifier chord must be declared
  // rather than inferred. A shortcut WITHOUT this never fires while a modifier
  // is held, which is what keeps Ctrl+F, Ctrl+R and friends working.
  mod?: true
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

// The uniform per-shortcut gate: key match + `when` predicate +
// input-gating (skip unless allowInInput while focus is editable).
// `modHeld` partitions the registry: a chord selects only `mod` shortcuts, a
// bare press only non-mod ones. Neither can fire the other's keys.
function shortcutApplies(s: Shortcut, key: string, editable: boolean, modHeld = false): boolean {
  if (!!s.mod !== modHeld) return false
  return keyMatches(s, key) && (s.when ? s.when() : true) && (editable ? !!s.allowInInput : true)
}

// `event.preventDefault()` is called BEFORE the handler so handlers
// don't need to remember; {preventDefault: false} opts out.
function fire(s: Shortcut, e: KeyboardEvent): void {
  if (s.preventDefault !== false) e.preventDefault()
  s.handler(e)
}

// Options bag for `useKeyboardShortcuts`. `suppressed` is read by
// the dispatcher on every keydown — when its `.value` is true the
// dispatcher early-exits without matching anything, modal-eats-
// everything style. Used by the cheatsheet so opening it instantly
// disables global shortcuts (g→m view nav, `/` search, etc.) without
// each shortcut needing its own `when:` predicate. The `?`/Esc
// modal-control keys are handled by the cheatsheet itself.
export interface UseKeyboardShortcutsOptions {
  suppressed?: { value: boolean }
}

export function useKeyboardShortcuts(
  shortcuts: readonly Shortcut[],
  opts: UseKeyboardShortcutsOptions = {},
) {
  // Set of declared prefix keys — pressing one of these primes the
  // pending-prefix slot; nothing else happens until the next key.
  const prefixKeys = new Set<string>()
  for (const s of shortcuts) {
    if (s.prefix) prefixKeys.add(s.prefix)
  }

  let pendingPrefix: { key: string; expiresAt: number } | null = null

  // Try matching a sequence shortcut (prefix + key). The pending prefix
  // is consumed either way; returns true when a shortcut fired. Expired
  // prefixes are cleared first so a mid-tap+pause isn't booby-trapped,
  // and a miss falls through to standard matching — a stale prefix
  // shouldn't swallow a real shortcut on the next keypress.
  function matchSequence(e: KeyboardEvent, key: string, editable: boolean): boolean {
    if (pendingPrefix && pendingPrefix.expiresAt < Date.now()) pendingPrefix = null
    if (!pendingPrefix) return false
    const sought = shortcuts.find(s =>
      s.prefix === pendingPrefix!.key && shortcutApplies(s, key, editable),
    )
    pendingPrefix = null
    if (!sought) return false
    fire(sought, e)
    return true
  }

  // A chord never participates in a key SEQUENCE (g m and friends) and never
  // primes one: those are bare-key vocabulary, so this neither reads nor
  // clears the pending prefix.
  function matchChord(e: KeyboardEvent, key: string, editable: boolean) {
    const chord = shortcuts.find(s => !s.prefix && shortcutApplies(s, key, editable, true))
    if (chord) fire(chord, e)
  }

  function onKeydown(e: KeyboardEvent) {
    // Modal suppression — bail before any matching so a pending
    // sequence prefix from before the modal opened doesn't get
    // consumed by a key the user typed inside the modal.
    if (opts.suppressed?.value) {
      pendingPrefix = null
      return
    }

    // Modifier partition. Shift is allowed throughout because `?` is Shift+/
    // on US keyboards.
    //
    // A held Ctrl/Cmd selects the `mod` shortcuts and EXCLUDES every bare one;
    // no modifier selects the bare ones and excludes the chords. Alt is never a
    // trigger. Without the partition a browser accelerator (Ctrl+F) would fire
    // the app's `f`, which is why the original bail existed — this narrows it
    // rather than removing it.
    const modHeld = e.ctrlKey || e.metaKey
    if (e.altKey) return

    const key = e.key
    const editable = isEditableTarget()

    if (modHeld) {
      matchChord(e, key, editable)
      return
    }

    if (matchSequence(e, key, editable)) return

    // Prime a new prefix if this key is one of the declared
    // sequence prefixes — but only when no input is focused (so
    // typing a literal `g` in the search box doesn't enter
    // sequence mode).
    if (prefixKeys.has(key) && !editable) {
      pendingPrefix = { key, expiresAt: Date.now() + SEQUENCE_TIMEOUT_MS }
      e.preventDefault()
      return
    }

    // Standard (non-sequence) shortcut.
    const match = shortcuts.find(s => !s.prefix && shortcutApplies(s, key, editable))
    if (!match) return
    fire(match, e)
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
