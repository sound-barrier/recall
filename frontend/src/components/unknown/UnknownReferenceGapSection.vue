<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MatchRecord } from '@/api-client'
import { useContextualCallout } from '@/composables/onboarding/useContextualCallout'
import ContextualCallout from '@/components/onboarding/ContextualCallout.vue'
import UnknownReferenceGapCard from '@/components/unknown/UnknownReferenceGapCard.vue'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useMatchActions } from '@/composables/matches/useMatchActions'
import { useWriteGate } from '@/composables/shared/useWriteGate'

// Reference-data gaps: records the parser OCR'd a hero/map name for but couldn't
// pin to the canonical YAML roster shipped with this release. The fix is a new
// Recall release with an updated YAML; each card surfaces a "Fixed in v<X>" CTA
// when the latest release would recognize the captured name. Dismiss here is
// ACKNOWLEDGE-only — the match keeps its rows (the promised YAML fix must still
// find them), the card just moves behind the "N acknowledged" disclosure, and a
// single click suffices because the action is reversible right there. Card
// chrome + the .reference-gap-* / .fix-* families live in the global unknown.css.
const matchesStore = useMatchesStore()
const appStore = useAppStore()
const { onSetReferenceGapAcknowledged } = useMatchActions()
const { writesLocked, lockReason } = useWriteGate()

const referenceGapRecords = computed(() => matchesStore.referenceGapRecords)
const activeGaps = computed(() => referenceGapRecords.value.filter((r) => !r.reference_gap_acknowledged))
const ackedGaps = computed(() => referenceGapRecords.value.filter((r) => r.reference_gap_acknowledged))
const showAcked = ref(false)
const updateInfo = computed(() => appStore.updateInfo)

// First-appearance hint — fires the first time any UNACKNOWLEDGED record
// carries the gap signal (most users never hit one, so a static tour
// step would mis-time; an all-acknowledged section needs no hint).
const refdataGapCallout = useContextualCallout({
  id:   'unknown.refdata',
  gate: () => activeGaps.value.length > 0,
})

// Case-insensitive against the normalized raw token (mirrors the
// parser's normalize: lowercase + strip diacritics).
const normalize = (s: string) => s
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .toLowerCase()
  .trim()

function findRecognizedName(raw: string | undefined, latest: string[] | undefined): string | null {
  if (!raw) return null
  return (latest ?? []).find((n) => normalize(n) === normalize(raw)) ?? null
}

// The upgrade tip for a gap-card record IF the upcoming release would recognize
// its OCR'd name; null otherwise.
function recognizingRelease(rec: MatchRecord): { version: string; url: string; name: string; kind: 'hero' | 'map' } | null {
  const info = updateInfo.value
  if (!info?.checked || !info.available) return null
  const hero = findRecognizedName(rec.data?.hero_raw, info.latest_heroes)
  if (hero) return { version: info.latest, url: info.url, name: hero, kind: 'hero' }
  const map = findRecognizedName(rec.data?.map_raw, info.latest_maps)
  if (map) return { version: info.latest, url: info.url, name: map, kind: 'map' }
  return null
}
</script>

<template>
  <!-- ─── REFERENCE-DATA GAPS: Unknown heroes / maps ──────────
       Records the parser captured but couldn't pin to the canonical YAML
       rosters (e.g. Miyazaki before heroes.yaml was updated). No edit
       affordance — the only path to fix is a new Recall release with an
       updated YAML. -->
  <div v-if="referenceGapRecords.length > 0" id="section-reference-gaps" class="unknown-list reference-gap-section">
    <h3 class="needs-review-heading" data-refgap-heading>
      Reference data gaps — {{ activeGaps.length > 0 ? activeGaps.length : 'all acknowledged' }}
    </h3>
    <p class="needs-review-desc">
      The parser captured an OCR'd hero or map name in these records but couldn't match it to the canonical roster shipped with this Recall release. They'll be picked up automatically on the next launch after a YAML update.
      <a class="unknown-section-link" href="https://github.com/sound-barrier/recall/releases/latest" target="_blank" rel="noopener noreferrer">View latest release ↗</a>
    </p>
    <UnknownReferenceGapCard
      v-for="rec in activeGaps"
      :key="rec.match_key"
      :rec="rec"
      :acknowledged="false"
      :recognizing="recognizingRelease(rec)"
      :writes-locked="writesLocked"
      :lock-reason="lockReason"
      @acknowledge="onSetReferenceGapAcknowledged(rec.match_key, $event)"
    />

    <template v-if="ackedGaps.length > 0">
      <button
        type="button"
        class="empty-link refgap-acked-toggle"
        :aria-expanded="showAcked"
        @click="showAcked = !showAcked"
      >
        {{ ackedGaps.length }} acknowledged — {{ showAcked ? 'hide' : 'show' }}
      </button>
      <UnknownReferenceGapCard
        v-for="rec in (showAcked ? ackedGaps : [])"
        :key="rec.match_key"
        :rec="rec"
        :acknowledged="true"
        :recognizing="null"
        :writes-locked="writesLocked"
        :lock-reason="lockReason"
        @acknowledge="onSetReferenceGapAcknowledged(rec.match_key, $event)"
      />
    </template>
  </div>

  <!-- Just-in-time hint on the first appearance of a gap card. Most users never
       hit one — a static tour step would mis-time. Fires when the section
       materializes; dismisses on Esc / close / Got it. -->
  <ContextualCallout
    v-if="refdataGapCallout.active()"
    target="[data-refgap-heading]"
    heading="Reference data gaps"
    body="Recall captured a hero or map name but couldn't match it to the canonical roster shipped with this release. They'll be picked up automatically once you update — every card below tells you if the fix is one release away."
    action-label="Got it"
    placement="top"
    @dismiss="refdataGapCallout.dismiss()"
    @action="refdataGapCallout.dismiss()"
  />
</template>

<style scoped>
.refgap-acked-toggle {
  align-self: flex-start;
}
</style>
