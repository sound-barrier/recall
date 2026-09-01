import { computed, ref } from 'vue'

import type { MatchRecord } from '@/api-client'
import { ExportWebPage } from '@/api-client'
import { usePersistedRef } from '@/composables/shared/usePersistedRef'
import type { Season } from '@/composables/shared/useOWData'
import { currentSeason } from '@/match/match-season-helpers'

// The season recap: a page the player keeps, for any season they played.
//
// The ROLLOVER prompt is a nudge onto a permanent surface, not the feature
// itself. A detector-only recap would be unreachable for eleven months of the
// year and untestable without clock games; this way the page is always there
// and the notice merely says a season just ended.
//
// The detector is local: it compares the season the calendar is in against a
// persisted last-seen name. It cannot come from the update check —
// useUpdateCheckQuery is permanently `enabled: false` under the
// no-network-on-mount rule — and it must not come from a season's `end`,
// which seasons.yaml marks as an estimate.

const LAST_SEEN_KEY = 'recall.lastSeenSeason'

export function useSeasonRecap(
  records: () => readonly MatchRecord[],
  seasons: () => Season[],
  now: () => number = () => Date.now(),
) {
  const { value: lastSeen, set: setLastSeen } = usePersistedRef<string>({
    key: LAST_SEEN_KEY,
    defaultValue: '',
    parse: (raw) => raw,
  })

  const saving = ref(false)
  const savedAs = ref('')
  const error = ref('')

  const active = computed(() => currentSeason(seasons(), now()))

  /**
   * The season that just ended, or null.
   *
   * It has to be a season the ROSTER still carries, and that single condition
   * covers three cases at once: a first run has seen nothing, so there is no
   * season to find; a season renamed or dropped by a data update is not a
   * rollover but a name this app can no longer place; and a stale string put
   * in front of the player would be worse than silence in both.
   */
  const endedSeason = computed<Season | null>(() => {
    const nowSeason = active.value
    if (nowSeason === null || nowSeason.name === lastSeen.value) return null
    return seasons().find((s) => s.name === lastSeen.value) ?? null
  })

  /** Acknowledge the rollover. Called by dismissing the notice or opening it. */
  function markSeen(): void {
    if (active.value !== null) setLastSeen(active.value.name)
  }

  // Seeds the marker on a first run so the FIRST rollover the player sees is
  // a real one. Idempotent: after this, markSeen only moves it forward.
  function seedIfUnseen(): void {
    if (lastSeen.value === '') markSeen()
  }

  async function save(season: Season): Promise<void> {
    saving.value = true
    error.value = ''
    savedAs.value = ''
    try {
      // Lazy: the builder and the app's inlined stylesheets are a chunk this
      // tab should not pay for until somebody asks for a recap.
      const { renderSeasonRecap, seasonRecapFilename } = await import('@/match/recap/season-recap-export')
      const name = await ExportWebPage(
        renderSeasonRecap(records(), season),
        seasonRecapFilename(season),
        `Save ${season.name} recap (web page)`,
      )
      // "" is a CANCEL — the native dialog resolves empty rather than
      // throwing. Treating it as a save wrote nothing, said nothing, and
      // answered the rollover notice for the rest of the season.
      if (name === '') return
      savedAs.value = name
      markSeen()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      saving.value = false
    }
  }

  return { active, endedSeason, saving, savedAs, error, save, markSeen, seedIfUnseen }
}
