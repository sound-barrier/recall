import { computed, ref } from 'vue'

import { GetProfiles } from '../api'

// Persisted flag for the first-run "Main account name" modal. Two
// signals decide whether the modal shows on launch:
//
//   1. localStorage flag (`recall.firstRunAccountNamed`) — set when
//      the user dismisses the modal on this browser/device. Same
//      persisted-preference shape as useTheme / useWeekStart.
//
//   2. Active profile name — if the user already renamed their
//      profile away from the default 'main', the modal's purpose is
//      satisfied even on a device that's never seen the flag. This
//      covers the cleared-browser-storage / new-machine / server-mode
//      / different-browser cases the localStorage gate alone misses
//      (TECHNICAL_DEBT.md item 16).
//
// The composable starts from the localStorage flag synchronously so
// the very first paint is correct, then fetches GetProfiles() once
// to learn the active profile name. Consumers AND the exposed
// `pending` computed with their own gates (e.g. `!tourActive` in
// App.vue).

const STORAGE_KEY = 'recall.firstRunAccountNamed'
const DEFAULT_PROFILE_NAME = 'main'

export function useFirstRunAcknowledged() {
  const acknowledged = ref(readFlag())
  // Defaults true so the modal stays gated until GetProfiles()
  // resolves authoritatively. If the fetch fails (offline mid-launch
  // or pre-init server), the localStorage path still works — we only
  // fall through to "show the modal" when neither signal acknowledges.
  const profileIsDefault = ref(true)

  // Fire-and-forget. The modal's first paint sees profileIsDefault=true,
  // so if `acknowledged` is false the modal shows immediately; once
  // the fetch resolves and the active profile is non-default the
  // computed flips false and the modal closes — acceptable for the
  // covered cases (cleared storage / new device) because the user's
  // already named their profile elsewhere, so a brief flash of the
  // modal is a non-issue.
  GetProfiles().then((r) => {
    profileIsDefault.value = (r.active ?? DEFAULT_PROFILE_NAME) === DEFAULT_PROFILE_NAME
  }).catch(() => {
    // Network failure: leave profileIsDefault=true so the localStorage
    // gate still governs.
  })

  function ack() {
    acknowledged.value = true
    try { localStorage.setItem(STORAGE_KEY, 'true') } catch (_) { /* ignore */ }
  }

  const pending = computed(() => !acknowledged.value && profileIsDefault.value)

  return { acknowledged, pending, ack }
}

function readFlag(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch (_) {
    return false
  }
}
