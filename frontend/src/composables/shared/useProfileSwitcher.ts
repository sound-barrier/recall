import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { GetProfiles, SwitchProfile, CreateProfile, RenameProfile } from '@/api-client'

// Stateful logic for the masthead profile chip + dropdown: the profile
// list, the open/creating/rename UI state, and the create / rename / switch
// actions. Extracted from ProfileSwitcher.vue so the SFC holds the chip +
// dropdown markup and this composable holds the behaviour.
//
// Switching tears down the server's in-memory state for the previous
// profile, so every successful PUT/POST window.location.reload()s — every
// composable re-fetches against the new active profile in one clean sweep.
export function useProfileSwitcher() {
  const profiles  = ref<string[]>([])
  const active    = ref('')
  const open      = ref(false)
  const creating  = ref(false)
  const newName   = ref('')
  const error     = ref<string | null>(null)
  const busy      = ref(false)
  const dropdownEl = ref<HTMLElement | null>(null)
  const triggerEl  = ref<HTMLElement | null>(null)
  const inputEl    = ref<HTMLInputElement | null>(null)

  const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/

  const newNameValid = computed(() => NAME_RE.test(newName.value))

  async function refresh() {
    try {
      const res = await GetProfiles()
      profiles.value = res.profiles
      active.value   = res.active
    } catch (_) {
      profiles.value = []
      active.value   = ''
    }
  }

  function toggleOpen() {
    open.value = !open.value
    if (!open.value) {
      creating.value = false
      newName.value = ''
      error.value = null
    }
  }

  async function pickProfile(name: string) {
    if (busy.value) return
    if (name === active.value) {
      open.value = false
      return
    }
    busy.value = true
    try {
      await SwitchProfile(name)
      window.location.reload()
    } catch (e) {
      error.value = String(e)
      busy.value = false
    }
  }

  function beginCreate() {
    creating.value = true
    newName.value = ''
    error.value = null
    nextTick(() => inputEl.value?.focus())
  }

  async function confirmCreate() {
    if (busy.value || !newNameValid.value) return
    busy.value = true
    try {
      await CreateProfile(newName.value.trim())
      window.location.reload()
    } catch (e) {
      error.value = String(e)
      busy.value = false
    }
  }

  function cancelCreate() {
    creating.value = false
    newName.value = ''
    error.value = null
  }

  // ─── Rename ──────────────────────────────────────────────────────
  //
  // Each item carries a hover-revealed ✎ button. Clicking it swaps the
  // item's name span for an inline input pre-filled with the existing
  // name; Enter commits, Escape cancels. Only one row can be in rename
  // mode at a time (renameTarget ref).
  const renameTarget = ref<string | null>(null)
  const renameValue  = ref('')

  const renameValueValid = computed(() => NAME_RE.test(renameValue.value))
  const renameUnchanged  = computed(() => renameValue.value === renameTarget.value)

  function beginRename(name: string) {
    renameTarget.value = name
    renameValue.value  = name
    error.value = null
    // The input lives inside a v-for, so a template ref would collect an
    // array. Query the rendered DOM in nextTick — only one rename form is
    // ever rendered at a time, so the first match is the right input.
    nextTick(() => {
      const el = dropdownEl.value?.querySelector<HTMLInputElement>('.profile-rename-input')
      el?.focus()
      el?.select()
    })
  }

  function cancelRename() {
    renameTarget.value = null
    renameValue.value = ''
    error.value = null
  }

  async function confirmRename() {
    if (busy.value || renameTarget.value === null) return
    if (renameUnchanged.value) {
      cancelRename()
      return
    }
    if (!renameValueValid.value) return
    busy.value = true
    try {
      await RenameProfile(renameTarget.value, renameValue.value.trim())
      window.location.reload()
    } catch (e) {
      error.value = String(e)
      busy.value = false
    }
  }

  function onDocumentMousedown(e: MouseEvent) {
    if (!open.value) return
    const tgt = e.target as Node | null
    if (!tgt) return
    if (dropdownEl.value?.contains(tgt)) return
    if (triggerEl.value?.contains(tgt))  return
    open.value = false
    creating.value = false
    renameTarget.value = null
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open.value) {
      if (renameTarget.value !== null) {
        cancelRename()
        return
      }
      open.value = false
      creating.value = false
    }
  }

  onMounted(() => {
    refresh()
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
