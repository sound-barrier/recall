import { onBeforeUnmount, onMounted, ref } from 'vue'

// Dropdown behaviour for the toolbar's split "Add match ▾" button: the full
// hand-entry form, or the leaver-exit quick-add. Per-instance (one toolbar, one
// menu), so this stays a composable rather than a store.
//
// Mirrors useAppMenu's dismiss contract — outside-mousedown closes, Escape
// closes AND returns focus to the trigger — because the two menus should feel
// identical. Kept separate rather than shared: useAppMenu also owns the
// macOS-native-menu gate and five fixed actions, none of which apply here.
export function useAddMatchMenu() {
  const open = ref(false)
  const triggerEl = ref<HTMLElement | null>(null)
  const menuEl = ref<HTMLElement | null>(null)

  function close() { open.value = false }
  function toggle() { open.value = !open.value }

  // Every item is fire-and-close.
  function run(action: () => void) { action(); close() }

  function onDocumentMousedown(e: MouseEvent) {
    if (!open.value) return
    const tgt = e.target as Node | null
    if (!tgt) return
    if (menuEl.value?.contains(tgt) || triggerEl.value?.contains(tgt)) return
    close()
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open.value) {
      close()
      triggerEl.value?.focus()
    }
  }

  onMounted(() => {
    document.addEventListener('mousedown', onDocumentMousedown)
    document.addEventListener('keydown', onKeydown)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocumentMousedown)
    document.removeEventListener('keydown', onKeydown)
  })

  return { open, triggerEl, menuEl, toggle, close, run }
}
