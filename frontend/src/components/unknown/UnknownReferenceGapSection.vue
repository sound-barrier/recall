<script setup lang="ts">
import { computed } from 'vue'
import type { MatchRecord } from '@/api-client'
import { useContextualCallout } from '@/composables/shared/useContextualCallout'
import ContextualCallout from '@/components/shared/ContextualCallout.vue'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'

// Reference-data gaps: records the parser OCR'd a hero/map name for but couldn't
// pin to the canonical YAML roster shipped with this release. Read-only — the fix
// is a new Recall release with an updated YAML; each card surfaces a "Fixed in
// v<X>" CTA when the latest release would recognise the captured name. Card chrome
// + the .reference-gap-* / .fix-* families live in the global unknown.css.
const matchesStore = useMatchesStore()
const appStore = useAppStore()

const referenceGapRecords = computed(() => matchesStore.referenceGapRecords)
const updateInfo = computed(() => appStore.updateInfo)

// First-appearance hint — fires the first time any record carries the gap signal
// (most users never hit one, so a static tour step would mis-time).
const refdataGapCallout = useContextualCallout({
  id:   'unknown.refdata',
  gate: () => matchesStore.referenceGapRecords.length > 0,
})

// The upgrade tip for a gap-card record IF the upcoming release would recognise
// its OCR'd name; null otherwise. Case-insensitive against the normalized raw
// token (mirrors the parser's normalize: lowercase + strip diacritics).
function recognisingRelease(rec: MatchRecord): { version: string; url: string; name: string; kind: 'hero' | 'map' } | null {
  const info = updateInfo.value
  if (!info?.checked || !info.available) return null
  const normalize = (s: string) => s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
  const heroRaw = rec.data?.hero_raw ?? ''
  if (heroRaw) {
    const hit = (info.latest_heroes ?? []).find((h) => normalize(h) === normalize(heroRaw))
    if (hit) return { version: info.latest, url: info.url, name: hit, kind: 'hero' }
  }
  const mapRaw = rec.data?.map_raw ?? ''
  if (mapRaw) {
    const hit = (info.latest_maps ?? []).find((m) => normalize(m) === normalize(mapRaw))
    if (hit) return { version: info.latest, url: info.url, name: hit, kind: 'map' }
  }
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
      Reference data gaps — {{ referenceGapRecords.length }}
    </h3>
    <p class="needs-review-desc">
      The parser captured an OCR'd hero or map name in these records but couldn't match it to the canonical roster shipped with this Recall release. They'll be picked up automatically on the next launch after a YAML update.
      <a class="unknown-section-link" href="https://github.com/sound-barrier/recall/releases/latest" target="_blank" rel="noopener noreferrer">View latest release ↗</a>
    </p>
    <article
      v-for="rec in referenceGapRecords"
      :key="rec.match_key"
      class="unknown-card reference-gap-card"
      :data-reference-gap-key="rec.match_key"
    >
      <div class="unknown-card-head">
        <div class="unknown-head-lhs">
          <span class="unknown-key-block">
            <span class="unknown-key mono">{{ rec.source_files?.[0] ?? rec.match_key }}</span>
            <span class="unknown-src-count">
              <template v-if="rec.data?.hero_raw">Unknown hero: <code>{{ rec.data.hero_raw }}</code></template>
              <template v-if="rec.data?.hero_raw && rec.data?.map_raw">  ·  </template>
              <template v-if="rec.data?.map_raw">Unknown map: <code>{{ rec.data.map_raw }}</code></template>
            </span>
          </span>
        </div>
      </div>
      <p
        v-if="recognisingRelease(rec)"
        class="reference-gap-fix"
        :data-fix-cta-key="rec.match_key"
      >
        <span class="fix-eyebrow">Fixed in</span>
        <a
          class="fix-link"
          :href="recognisingRelease(rec)!.url"
          target="_blank"
          rel="noopener noreferrer"
          :title="`Open release page for v${recognisingRelease(rec)!.version}`"
        >v{{ recognisingRelease(rec)!.version }} ↗</a>
        <span class="fix-copy">
          — will recognise
          <code>{{ recognisingRelease(rec)!.name }}</code>
        </span>
      </p>
    </article>
  </div>

  <!-- Just-in-time hint on the first appearance of a gap card. Most users never
       hit one — a static tour step would mis-time. Fires when the section
       materialises; dismisses on Esc / close / Got it. -->
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
