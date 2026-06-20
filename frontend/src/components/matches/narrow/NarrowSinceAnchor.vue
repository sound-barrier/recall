<script setup lang="ts">
import { computed } from 'vue'
import type { MatchRecord } from '@/api-client'
import type { useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'

// "Since this match" anchor toggle. The anchor is set/cleared from the match
// detail panel; this surfaces the on/off switch to scope the SET to matches after
// it, plus open/clear actions. anchorRecord is looked up in the full corpus (NOT
// narrowedRecords — the anchor is excluded once sinceAnchorActive). Emits
// open-match (open the anchor in the detail panel; the parent closes the popover)
// and clear-anchor. Chrome is global (narrow.css); no scoped styles.
type MatchesNarrowApi = ReturnType<typeof useMatchesNarrow>
const props = defineProps<{ narrow: MatchesNarrowApi; records: MatchRecord[] }>()
const emit = defineEmits<{ 'open-match': [matchKey: string]; 'clear-anchor': [] }>()

const { anchorKey, sinceAnchorActive } = props.narrow

const anchorRecord = computed(() => {
  if (anchorKey.value === '') return null
  return props.records.find((r) => r.match_key === anchorKey.value) ?? null
})

const anchorChipLabel = computed(() => {
  const r = anchorRecord.value
  if (!r) return ''
  const d = r.data?.date ?? ''
  const map = r.data?.map ?? '—'
  return d ? `${d} · ${map}` : map
})

function onOpenAnchor() {
  if (anchorKey.value === '') return
  emit('open-match', anchorKey.value)
}
</script>

<template>
  <!-- Since this match — anchor checkbox. The anchor itself is set/cleared from
       the match detail panel; this section is the on-off switch for the filter. -->
  <section class="np-section">
    <div class="np-section-head">
      <span class="np-section-eyebrow">Since this match</span>
      <span class="np-section-meta">
        {{ anchorRecord ? 'anchor set' : 'pick a match in the detail panel' }}
      </span>
    </div>
    <div v-if="anchorRecord" class="np-since-anchor">
      <label class="np-toggle-label">
        <input
          type="checkbox"
          data-since-anchor-toggle
          :checked="sinceAnchorActive"
          @change="sinceAnchorActive = ($event.target as HTMLInputElement).checked"
        >
        <span>Only matches after</span>
      </label>
      <p class="np-since-anchor-meta" data-since-anchor-label>
        <span class="np-since-anchor-date">{{ anchorChipLabel }}</span>
        <span class="np-since-anchor-actions">
          <button
            type="button"
            class="np-since-anchor-open"
            data-since-anchor-open
            title="Open the anchor's match in the detail panel."
            @click="onOpenAnchor"
          >
            ↗ open
          </button>
          <button
            type="button"
            class="np-since-anchor-clear"
            data-since-anchor-clear
            @click="emit('clear-anchor')"
          >
            Clear anchor
          </button>
        </span>
      </p>
    </div>
    <p v-else class="np-empty">
      Open a match → "Filter from this match" to mark a reference point, then return here to apply.
    </p>
  </section>
</template>
