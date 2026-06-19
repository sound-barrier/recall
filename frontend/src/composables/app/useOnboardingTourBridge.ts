import { nextTick } from 'vue'

import { SeedTestProfile, SwitchProfile } from '@/api'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { ONBOARDING_RESUME_KEY } from '@/composables/shared/storageKeys'

// Bridges the OnboardingTour overlay to the live app: each step drives the real
// surfaces (tab nav, the narrow popover, the narrow filter picks) the same way a
// user would, so the tour exercises the actual state machines end-to-end. The
// open/close-narrow handlers click the real trigger buttons; the filter mutators
// write straight to the shared matchesNarrowState refs so narrowedRecords + the
// panel update in one pass. Lives in a composable because it reaches into the DOM.
export function useOnboardingTourBridge() {
  const appStore = useAppStore()
  const narrowState = useMatchesStore().matchesNarrowState

  // Seed + switch to the demo "test" profile, parking the step to resume on.
  // SwitchProfile reloads the SPA, so the tour reopens at resumeStepIndex (now
  // in the test profile) via the resume key.
  async function onTourSeedAndSwitch(resumeStepIndex: number): Promise<void> {
    await SeedTestProfile()
    try { localStorage.setItem(ONBOARDING_RESUME_KEY, String(resumeStepIndex)) } catch (_) { /* ignore */ }
    await SwitchProfile('test')
    window.location.reload()
  }

  async function onTourOpenNarrow() {
    if (appStore.view !== 'matches') await appStore.goToView('matches')
    await nextTick()
    document.querySelector<HTMLButtonElement>('.dossier-actions .dossier-btn.primary')?.click()
  }

  async function onTourCloseNarrow() {
    await nextTick()
    document.querySelector<HTMLButtonElement>('#narrow-popover .np-close')?.click()
  }

  function onTourApplyHeroFilter(hero: string) {
    narrowState.pickedHeroes.value = new Set([hero])
  }

  function onTourClearFilters() {
    narrowState.searchText.value = ''
    narrowState.pickedMaps.value = new Set()
    narrowState.pickedGameModes.value = new Set()
    narrowState.pickedHeroes.value = new Set()
    narrowState.pickedRoles.value = new Set()
    narrowState.pickedResults.value = new Set()
    narrowState.pickedTags.value = new Set()
    narrowState.pickedRange.value = 'all'
    narrowState.customFrom.value = ''
    narrowState.customTo.value = ''
  }

  return {
    onTourSeedAndSwitch,
    onTourOpenNarrow,
    onTourCloseNarrow,
    onTourApplyHeroFilter,
    onTourClearFilters,
  }
}
