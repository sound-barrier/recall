import { ref } from 'vue'

// Persisted flag for the first-run "Main account name" modal. When
// the flag is absent (fresh install) the modal renders; once the
// user dismisses it (either path), the flag is set and the modal
// never returns on subsequent launches.
//
// Same persisted-preference shape as useTheme / useWeekStart /
// useIncludeUndated — `ref(default)` + a setter that writes
// localStorage + `onMounted` reader. Default is `false` so the
// modal surfaces on a brand-new install; mountApp tests can pre-seed
// the localStorage key via MountOverrides to bypass.

const STORAGE_KEY = 'recall.firstRunAccountNamed'

export function useFirstRunAcknowledged() {
  // Read synchronously so the modal's visibility is correct on the
  // very first paint — an onMounted-deferred read would cause a flash
  // of the modal followed by it disappearing once mounted.
  const acknowledged = ref(readFlag())

  function ack() {
    acknowledged.value = true
    try { localStorage.setItem(STORAGE_KEY, 'true') } catch (_) { /* ignore */ }
  }

  return { acknowledged, ack }
}

function readFlag(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch (_) {
    return false
  }
}
