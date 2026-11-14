import { onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { fetchStartupError } from '@/queries/system'
import { useAppStore } from '@/stores/app'
import { coachSessionResumeArmed } from '@/queries/coach'
import { useCoachStore } from '@/stores/coach'
import { useParseStore } from '@/stores/parse'
import { useModalFocusTrap } from '@/composables/shared/keyboard/useModalFocusTrap'
import { useNativeMenu } from '@/composables/app/useNativeMenu'

// App boot coordinator. On mount it fires the remaining store loaders (the
// matches feed + ignored-screenshot list + last-parse stamp — the version /
// settings / candidates reads hydrate from their queries at store setup) —
// each fire-and-forget so one subsystem's failure doesn't block the others —
// and surfaces any captured Startup failure into the app store's
// startup-error gate. Owns that modal's focus trap. Lives in a composable
// rather than a store action so App.vue stays free of orchestration and
// there's no app↔domain store import cycle.
export function useAppBoot() {
  const appStore = useAppStore()
  const parseStore = useParseStore()
  const { showStartupErrorModal } = storeToRefs(appStore)

  // Non-dismissible: Escape is a no-op — a Startup failure means the store
  // never initialized, so restart is the only recovery.
  useModalFocusTrap(showStartupErrorModal, {
    containerSelector: '.modal-box.startup-error',
    onClose: () => {},
  })

  // Native menu bar (macOS) → in-app dialogs. No-op on other platforms.
  useNativeMenu()

  // A resumed coaching session lands ON the Reviews tab, which is where the
  // film room lives. The session survived the reload; the view did not, so
  // the coach was returned to Matches and had to find their way back every
  // time — with their own history read-only and no explanation on the tab
  // they were looking at.
  //
  // Decided by the boot read's ANSWER, once: watching for the first session
  // this window ever saw also caught one opened later in ANOTHER window, and
  // yanked this window off whatever tab it was on. A window that booted with
  // no session to resume has nothing to land on.
  //
  // `once` rather than a stop handle called from inside the callback: that
  // form reads the const while defining it, so adding `immediate` later — or
  // any change that makes the watcher fire during creation — is a
  // temporal-dead-zone crash at boot, with the whole app blank behind it.
  const coachStore = useCoachStore()
  if (coachSessionResumeArmed()) {
    watch(() => coachStore.sessionSettled, (settled) => {
      if (settled && coachStore.sessionActive) void appStore.goToView('reviews')
    }, { once: true })
  }

  onMounted(() => {
    parseStore.restoreLastParsedAt()
    // No matchesStore.load() here: the store-setup query observers ARE the
    // boot fetch — a refetch on top would cancel their in-flight requests
    // and re-issue all three GETs (6 requests where 3 do).
    void parseStore.loadIgnored()
    fetchStartupError()
      .then(msg => { if (msg) appStore.setStartupError(msg) })
      .catch(() => {})
  })
}
