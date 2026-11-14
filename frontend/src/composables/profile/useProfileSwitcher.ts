import { ref, computed, watchEffect, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { SwitchProfile, CreateProfile, RenameProfile, GetNewScreenshotCount } from '@/api-client'
import { cacheActiveProfile } from '@/composables/profile/profileStorage'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import { useProfilesData } from '@/queries/profiles'

// Stateful logic for the masthead profile chip + dropdown: the profile
// list, the open/creating/rename UI state, and the create / rename / switch
// actions. Extracted from ProfileSwitcher.vue so the SFC holds the chip +
// dropdown markup and this composable holds the behavior.
//
// Switching tears down the server's in-memory state for the previous
// profile, so every successful PUT/POST window.location.reload()s — every
// composable re-fetches against the new active profile in one clean sweep.
// ── The menu as one state ──────────────────────────────────────────
// Open, creating, renaming, the held switch, the in-flight request and its
// error used to be six flags, and nothing stopped the impossible mixes: the
// held-switch notice, the rename input and the create form all on screen at
// once; a second pick sent while the first was still reading its count; a
// count that resolved after Escape raising the notice into a closed menu.

type SwitcherAction = 'switch' | 'create' | 'rename'

/** Every state the masthead profile menu can be in. */
export type SwitcherState =
  | { status: 'closed' }
  | { status: 'browsing'; error: string | null }
  /** A pick is reading the unparsed count; `seq` names that read. */
  | { status: 'counting'; to: string; seq: number }
  /** The switch waits behind the unparsed-screenshots notice. */
  | { status: 'held'; to: string; unparsed: number; error: string | null }
  | { status: 'creating'; error: string | null }
  | { status: 'renaming'; target: string; error: string | null }
  /** The request is out; a reload follows success. `from` is where a failure returns. */
  | { status: 'submitting'; action: SwitcherAction; target: string; from: Exclude<SwitcherState, { status: 'submitting' | 'counting' | 'closed' }> }

export type SwitcherEvent =
  | { type: 'toggle' }
  | { type: 'close' }
  | { type: 'escape' }
  | { type: 'pick'; to: string; seq: number }
  | { type: 'counted'; seq: number; unparsed: number }
  | { type: 'begin-create' }
  | { type: 'cancel-create' }
  | { type: 'begin-rename'; target: string }
  | { type: 'cancel-rename' }
  | { type: 'submit'; action: SwitcherAction; target: string }
  | { type: 'failed'; error: string }

const CLOSED: SwitcherState = { status: 'closed' }
const BROWSING: SwitcherState = { status: 'browsing', error: null }

type Interactive = Extract<SwitcherState, { status: 'browsing' | 'held' | 'creating' | 'renaming' }>
const isInteractive = (s: SwitcherState): s is Interactive =>
  s.status === 'browsing' || s.status === 'held' || s.status === 'creating' || s.status === 'renaming'

// The action each interactive state may submit.
const SUBMITS: Record<Interactive['status'], SwitcherAction> = {
  browsing: 'switch', held: 'switch', creating: 'create', renaming: 'rename',
}

function counted(state: SwitcherState, seq: number, unparsed: number): SwitcherState | null {
  if (state.status !== 'counting' || state.seq !== seq) return null
  if (unparsed > 0) return { status: 'held', to: state.to, unparsed, error: null }
  return { status: 'submitting', action: 'switch', target: state.to, from: BROWSING as Interactive }
}

function submitted(state: SwitcherState, action: SwitcherAction, target: string): SwitcherState | null {
  if (!isInteractive(state) || SUBMITS[state.status] !== action) return null
  return { status: 'submitting', action, target, from: state }
}

function failed(state: SwitcherState, error: string): SwitcherState | null {
  return state.status === 'submitting' ? { ...state.from, error } : null
}

type Handlers = { [K in SwitcherEvent['type']]: (state: SwitcherState, event: Extract<SwitcherEvent, { type: K }>) => SwitcherState | null }

const notWhileSubmitting = (state: SwitcherState, next: SwitcherState): SwitcherState | null =>
  (state.status === 'submitting' ? null : next)

// One handler per event; each answers the next state or refuses with null.
const HANDLERS: Handlers = {
  'toggle': (state) => notWhileSubmitting(state, state.status === 'closed' ? BROWSING : CLOSED),
  'close': (state) => notWhileSubmitting(state, CLOSED),
  'escape': (state) => {
    if (state.status === 'renaming') return BROWSING
    return state.status === 'closed' ? null : notWhileSubmitting(state, CLOSED)
  },
  'pick': (state, event) => (state.status === 'browsing' || state.status === 'held'
    ? { status: 'counting', to: event.to, seq: event.seq } : null),
  'counted': (state, event) => counted(state, event.seq, event.unparsed),
  'begin-create': (state) => (isInteractive(state) ? { status: 'creating', error: null } : null),
  'cancel-create': (state) => (state.status === 'creating' ? BROWSING : null),
  'begin-rename': (state, event) => (isInteractive(state) ? { status: 'renaming', target: event.target, error: null } : null),
  'cancel-rename': (state) => (state.status === 'renaming' ? BROWSING : null),
  'submit': (state, event) => submitted(state, event.action, event.target),
  'failed': (state, event) => failed(state, event.error),
}

/** The one transition function; null refuses the event and changes nothing. */
function stepSwitcher(state: SwitcherState, event: SwitcherEvent): SwitcherState | null {
  // TypeScript cannot correlate an indexed handler with the event that
  // picked it; the map's mapped type is what guarantees the pairing.
  const handle = HANDLERS[event.type] as (state: SwitcherState, event: SwitcherEvent) => SwitcherState | null
  return handle(state, event)
}

export function useProfileSwitcher() {
  // The shared profiles derivation feeds the chip + dropdown; an error
  // leaves both empty (the chip renders unnamed), matching the old catch
  // path.
  const { query: profilesQuery, profiles, active } = useProfilesData()
  // Creating and renaming a profile write to the profile registry, so they
  // ask the gate. SWITCHING deliberately does not: it is navigation, and
  // blocking it on a locked state would strand the user
  // there with no way back to their own data.
  const { guardWrite } = useWriteGate()
  // Freshen the sync-readable scope for profile-scoped localStorage keys
  // (profileStorage.ts) — setup-time reads used the previous session's
  // cache; this heals any out-of-band change for the next boot.
  watchEffect(() => {
    const res = profilesQuery.data.value
    if (res) cacheActiveProfile(res.active)
  })

  const state = ref<SwitcherState>(CLOSED)
  function dispatch(event: SwitcherEvent): boolean {
    const next = stepSwitcher(state.value, event)
    if (next) state.value = next
    return next !== null
  }

  const newName   = ref('')
  const dropdownEl = ref<HTMLElement | null>(null)
  const triggerEl  = ref<HTMLElement | null>(null)
  const inputEl    = ref<HTMLInputElement | null>(null)

  const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/

  const newNameValid = computed(() => NAME_RE.test(newName.value))

  // What the template reads — all derived, none assignable.
  const open = computed(() => state.value.status !== 'closed')
  const busy = computed(() => state.value.status === 'submitting' || state.value.status === 'counting')
  const error = computed(() => ('error' in state.value ? state.value.error : null))
  const shown = computed(() => (state.value.status === 'submitting' ? state.value.from : state.value))
  const creating = computed(() => shown.value.status === 'creating')
  const renameTarget = computed(() => (shown.value.status === 'renaming' ? shown.value.target : null))
  // A switch held back because the active profile's folder has screenshots
  // nobody has parsed yet. They belong to no profile until one parses them,
  // so leaving now hands them to whichever profile parses next — the notice
  // says so before the switch goes through. Null = nothing held.
  const pendingSwitch = computed(() =>
    (shown.value.status === 'held' ? { to: shown.value.to, unparsed: shown.value.unparsed } : null))

  function toggleOpen() {
    if (dispatch({ type: 'toggle' }) && !open.value) newName.value = ''
  }

  let countSeq = 0
  async function pickProfile(name: string) {
    if (busy.value) return
    if (name === active.value) {
      dispatch({ type: 'close' })
      return
    }
    const seq = ++countSeq
    if (!dispatch({ type: 'pick', to: name, seq })) return
    const unparsed = await unparsedCount()
    // Escape, a click outside or another pick since: this count is stale.
    if (!dispatch({ type: 'counted', seq, unparsed })) return
    if (state.value.status === 'held') {
      void nextTick(() => dropdownEl.value?.querySelector<HTMLButtonElement>('.profile-switch-confirm')?.focus())
      return
    }
    await submit(() => SwitchProfile(name), name)
  }

  // The notice's one action: go ahead with the held switch.
  async function confirmPendingSwitch() {
    const held = state.value
    if (held.status !== 'held') return
    if (!dispatch({ type: 'submit', action: 'switch', target: held.to })) return
    await submit(() => SwitchProfile(held.to), held.to)
  }

  // Unparsed screenshots in the active profile's folder. A failed read
  // answers 0: switching is navigation, and a count we could not get must
  // never stand between the user and their other profile.
  async function unparsedCount(): Promise<number> {
    try {
      return (await GetNewScreenshotCount()).count
    } catch {
      return 0
    }
  }

  // The request behind a submitting state: on success the storage scope
  // moves (when `cacheAs` names the new active profile) and the page
  // reloads; on failure the menu returns to where it was, with the error.
  async function submit(request: () => Promise<unknown>, cacheAs: string | null) {
    try {
      await request()
      if (cacheAs !== null) cacheActiveProfile(cacheAs)
      window.location.reload()
    } catch (e) {
      dispatch({ type: 'failed', error: String(e) })
    }
  }

  function beginCreate() {
    if (!dispatch({ type: 'begin-create' })) return
    newName.value = ''
    void nextTick(() => inputEl.value?.focus())
  }

  async function confirmCreate() {
    if (!guardWrite()) return
    if (busy.value || !newNameValid.value) return
    // CreateProfile activates the new profile server-side.
    const created = newName.value.trim()
    if (!dispatch({ type: 'submit', action: 'create', target: created })) return
    await submit(() => CreateProfile(created), created)
  }

  function cancelCreate() {
    if (dispatch({ type: 'cancel-create' })) newName.value = ''
  }

  // ─── Rename ──────────────────────────────────────────────────────
  //
  // Each item carries a hover-revealed ✎ button. Clicking it swaps the
  // item's name span for an inline input pre-filled with the existing
  // name; Enter commits, Escape cancels. Only one row can be in rename
  // mode at a time — the state says which.
  const renameValue  = ref('')

  const renameValueValid = computed(() => NAME_RE.test(renameValue.value))
  const renameUnchanged  = computed(() => renameValue.value === renameTarget.value)

  function beginRename(name: string) {
    if (!dispatch({ type: 'begin-rename', target: name })) return
    renameValue.value  = name
    // The input lives inside a v-for, so a template ref would collect an
    // array. Query the rendered DOM in nextTick — only one rename form is
    // ever rendered at a time, so the first match is the right input.
    void nextTick(() => {
      const el = dropdownEl.value?.querySelector<HTMLInputElement>('.profile-rename-input')
      el?.focus()
      el?.select()
    })
  }

  function cancelRename() {
    if (dispatch({ type: 'cancel-rename' })) renameValue.value = ''
  }

  async function confirmRename() {
    if (!guardWrite()) return
    const target = renameTarget.value
    if (busy.value || target === null) return
    if (renameUnchanged.value) {
      cancelRename()
      return
    }
    if (!renameValueValid.value) return
    const renamed = renameValue.value.trim()
    if (!dispatch({ type: 'submit', action: 'rename', target })) return
    // Only a rename of the ACTIVE profile moves the storage scope.
    await submit(() => RenameProfile(target, renamed), target === active.value ? renamed : null)
  }

  function onDocumentMousedown(e: MouseEvent) {
    if (!open.value) return
    const tgt = e.target as Node | null
    if (!tgt) return
    if (dropdownEl.value?.contains(tgt)) return
    if (triggerEl.value?.contains(tgt))  return
    dispatch({ type: 'close' })
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') dispatch({ type: 'escape' })
  }

  onMounted(() => {
    document.addEventListener('mousedown', onDocumentMousedown)
    document.addEventListener('keydown', onKeydown)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocumentMousedown)
    document.removeEventListener('keydown', onKeydown)
  })

  return {
    profiles,
    active,
    open,
    creating,
    newName,
    error,
    busy,
    dropdownEl,
    triggerEl,
    inputEl,
    newNameValid,
    toggleOpen,
    pickProfile,
    pendingSwitch,
    confirmPendingSwitch,
    beginCreate,
    confirmCreate,
    cancelCreate,
    renameTarget,
    renameValue,
    renameValueValid,
    renameUnchanged,
    beginRename,
    cancelRename,
    confirmRename,
  }
}
