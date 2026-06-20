<script setup lang="ts">
// Left-side "Narrow this set" filter popover for the Matches view.
// Teleport'd to body so it slides in over every dossier-local
// stacking context; the trigger button stays in MatchesView's
// dossier-actions row. The whole filter UI — refs (popoverRef,
// searchInputRef, comboOpen), focus trap, document mousedown
// listener, '/' shortcut — lives in this SFC behind the `narrow`
// prop bundle so MatchesView doesn't have to wire any of it.

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'
import { useNarrowTabNav } from '@/composables/matches/useNarrowTabNav'
import type { useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'
import NarrowPresets from '@/components/matches/narrow/NarrowPresets.vue'
import type { MatchRecord } from '@/api-client'
import FilterCombobox from '@/components/shared/FilterCombobox.vue'

type MatchesNarrowApi = ReturnType<typeof useMatchesNarrow>

const props = defineProps<{
  // v-model:open. The trigger button lives in MatchesView; the
  // popover is self-contained otherwise. close → emit('update:open', false).
  // In rail mode `open` is forced true by MatchesView since the
  // panel is always visible as a column.
  open: boolean
  // The useMatchesNarrow return: every picked Set, every available
  // computed, every pick/reset function. Passing as a single prop
  // keeps the surface area honest — when a new dimension lands in
  // useMatchesNarrow it surfaces here without a per-field prop
  // update.
  narrow: MatchesNarrowApi
  // Full corpus, needed for the "Since this match" anchor lookup
  // (the anchor itself is excluded from narrowedRecords once the
  // since-filter is active).
  records: MatchRecord[]
  // Trigger button element; the outside-click handler exempts it so
  // clicking the trigger doesn't immediately re-close the popover.
  triggerEl?: HTMLElement | null
  // Render mode. 'popover' = teleport'd modal aside with focus trap
  // + backdrop + outside-click close (the historical mode).
  // 'rail' = always-visible static aside rendered inline, no
  // teleport, no focus trap, no backdrop, no outside-click. The
  // parent owns layout placement via its grid template.
  mode?: 'popover' | 'rail'
}>()

const emit = defineEmits<{
  'update:open':   [open: boolean]
  // Anchor's "↗ open" button click. Parent routes to App.vue's
  // open-match handler. Same wire as the row-click open-match flow,
  // just initiated from this surface.
  'open-match':    [matchKey: string]
  // Anchor's "Clear anchor" button click. Routes to App.vue's
  // useMatchAnchor().clearAnchor().
  'clear-anchor':  []
  // Open/close signal for App.vue's matchesNarrowOpen ref (drives
  // `inert` on the background container). Emitted synchronously on
  // every transition so the background tracks without a tick gap.
  'narrow-open':   [open: boolean]
}>()

// Destructure the bundle into top-level setup vars so the template
// auto-unwraps the refs. Same shape MatchesView used pre-extraction.
const {
  searchText,
  pickedMaps, pickedGameModes, pickedHeroes, pickedRoles, pickedResults, pickedTags, pickedMembers, pickedReviewedBy,
  pickedQueues, pickedPlayModes, pickedSources,
  pickedLeavers, pickedModifiers, pickedRanks,
  pickedRange, customFrom, customTo,
  leaverHandling, minPlayMinutes, minPlayPercent, includeUnknown,
  anchorKey, sinceAnchorActive,
  pickMap, pickGameMode, pickHero, pickRole, pickResult, pickTag, pickMember, pickReviewedBy, pickQueue, pickPlayMode, pickSource, pickRange,
  pickLeaver, pickModifier, pickRank,
  resetNarrow,
  activeClauseCount, anyNarrow,
  availableMaps, availableGameModes, availableHeroes, availableRoles, availableResults, availableTags, availableMembers,
  availableLeaverSides, availableModifiers, availableRanks,
  narrowedRecords,
} = props.narrow
void activeClauseCount; void anyNarrow

// Friendlier labels for the leaver-side chips (the raw enum is terse).
const LEAVER_LABELS: Record<'self' | 'team' | 'enemy', string> = {
  self: 'You left', team: 'Teammate', enemy: 'Enemy',
}


const popoverRef     = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const comboOpen      = ref<'map' | 'hero' | null>(null)

const isRail = computed(() => (props.mode ?? 'popover') === 'rail')

// In rail mode the panel is always visible (it's a peer column, not
// a modal); the parent doesn't toggle `open`. Setting open=false in
// rail mode would be a no-op anyway since there's no close
// affordance.
const isOpen = computed({
  get: () => isRail.value || props.open,
  set: (v: boolean) => {
    if (isRail.value) return
    emit('update:open', v)
  },
})

// Anchor lookup. `props.records` (full corpus) is the source, NOT
// `narrowedRecords`, because once `sinceAnchorActive` is true the
// anchor itself is excluded from narrowedRecords — we'd never find
// it. anchorChipLabel is the "date · map" form rendered next to the
// toggle.
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
  const key = anchorKey.value
  if (key === '') return
  isOpen.value = false
  emit('open-match', key)
}

// Modal focus trap, scoped to the popover itself. The composable
// auto-installs / removes Esc + Tab cycling when `open` is true.
// In rail mode the panel is a peer column, not a modal — skip the
// trap entirely (the composable handles Esc / focus return that
// don't make sense for an always-visible aside).
const focusTrapOpen = computed(() => !isRail.value && isOpen.value)
useModalFocusTrap(focusTrapOpen, {
  containerSelector: '.left-panel',
  onClose: () => { isOpen.value = false },
  keepOpenOnFieldEscape: true,
})

// Tab from an empty text input jumps to the next toggle (Shift+Tab to
// the previous) — see useNarrowTabNav. Scoped to this panel's root.
useNarrowTabNav(popoverRef)

function onDocumentMousedown(e: MouseEvent) {
  const tgt = e.target as HTMLElement | null
  if (!tgt) return

  // Close the combobox dropdown if the click landed outside its
  // container.
  if (comboOpen.value && !tgt.closest(`[data-combo-id="${comboOpen.value}"]`)) {
    comboOpen.value = null
  }

  // In rail mode the panel is always visible — no outside-click
  // close. The combobox close above still runs.
  if (isRail.value) return
  if (!isOpen.value) return
  if (popoverRef.value?.contains(tgt)) return
  if (props.triggerEl?.contains(tgt))  return
  isOpen.value = false
}

function onOpenShortcut(e: KeyboardEvent) {
  if (e.key !== '/') return
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  // Don't intercept while the right-side detail panel is in front
  // of us — every keystroke should stay inside that modal until the
  // user closes it.
  if (document.querySelector('aside.detail-panel')) return
  e.preventDefault()
  isOpen.value = true
  setTimeout(() => searchInputRef.value?.focus(), 0)
}

watch(() => props.open, (open) => {
  emit('narrow-open', open)
  if (open) setTimeout(() => searchInputRef.value?.focus(), 0)
  else comboOpen.value = null
})

onMounted(() => {
  document.addEventListener('mousedown', onDocumentMousedown)
  document.addEventListener('keydown', onOpenShortcut)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocumentMousedown)
  document.removeEventListener('keydown', onOpenShortcut)
})
</script>

<template>
  <div>
    <!-- Backdrop: popover mode only. Rail mode is a peer column,
         no modal scrim. -->
    <Teleport to="body" :disabled="isRail">
      <Transition name="lp-fade">
        <div
          v-if="!isRail && open"
          class="lp-backdrop"
          aria-hidden="true"
          @click="isOpen = false"
        />
      </Transition>
    </Teleport>
    <!-- Panel: teleport in popover mode; render inline in rail mode
         so MatchesView's grid template places it in column 1. -->
    <Teleport to="body" :disabled="isRail">
      <Transition name="lp-slide">
        <aside
          v-if="isRail || open"
          id="narrow-popover"
          ref="popoverRef"
          class="left-panel"
          :class="{ 'left-panel-rail': isRail }"
          :role="isRail ? 'complementary' : 'dialog'"
          :aria-modal="isRail ? undefined : 'true'"
          aria-label="Filter matches"
        >
          <header class="np-head">
            <span class="np-eyebrow">Narrow</span>
            <h4 class="np-title">
              Filter the set
            </h4>
            <span class="np-meta">{{ narrowedRecords.length }} / {{ records.length }} matches</span>
            <button v-if="!isRail" class="np-close" aria-label="Close filter panel" @click="isOpen = false">
              ×
            </button>
          </header>

          <!-- Search row, full-width. -->
          <section class="np-section np-search-section">
            <label class="np-section-eyebrow" for="np-search">Search</label>
            <div class="np-search-row">
              <span class="np-search-glyph" aria-hidden="true">⌕</span>
              <input
                id="np-search"
                ref="searchInputRef"
                v-model="searchText"
                type="search"
                class="np-search-input"
                placeholder="text · note: tag: member: replay:"
                autocomplete="off"
                spellcheck="false"
              >
              <kbd class="np-search-kbd">/</kbd>
            </div>
          </section>

          <!-- Time scope — preset + custom dates side-by-side. -->
          <section class="np-section">
            <div class="np-section-head">
              <span class="np-section-eyebrow">Time scope</span>
              <span class="np-section-meta">
                <template v-if="customFrom || customTo">{{ customFrom || '…' }} → {{ customTo || '…' }}</template>
                <template v-else-if="pickedRange !== 'all'">last {{ pickedRange }}</template>
                <template v-else>all time</template>
              </span>
            </div>
            <div class="np-chips">
              <button
                v-for="opt in (['all', '7d', '30d', '90d'] as const)"
                :key="opt"
                class="np-chip"
                :class="{ picked: pickedRange === opt && !customFrom && !customTo }"
                @click="pickRange(opt)"
              >
                {{ opt === 'all' ? 'All time' : `Last ${opt}` }}
              </button>
            </div>
            <div class="np-daterange">
              <label class="np-date-label">
                <span>From</span>
                <input
                  type="date"
                  class="np-date"
                  :value="customFrom"
                  @input="customFrom = ($event.target as HTMLInputElement).value; pickedRange = 'custom'"
                >
              </label>
              <label class="np-date-label">
                <span>To</span>
                <input
                  type="date"
                  class="np-date"
                  :value="customTo"
                  @input="customTo = ($event.target as HTMLInputElement).value; pickedRange = 'custom'"
                >
              </label>
              <button
                v-if="customFrom || customTo"
                class="np-date-clear"
                @click="customFrom = ''; customTo = ''; pickedRange = 'all'"
              >
                Clear dates
              </button>
            </div>
          </section>

          <!-- Two-column body — match context (left) + outcome / refinement (right). -->
          <div class="np-cols">
            <div class="np-col">
              <!-- Map — combobox (31 maps, too many for chip cloud) -->
              <section class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">Map</span>
                  <span class="np-section-meta">
                    {{ pickedMaps.size ? `${pickedMaps.size} picked` : 'any' }}
                    · {{ availableMaps.length }} available
                  </span>
                </div>
                <FilterCombobox
                  combo-id="map"
                  label="Maps"
                  :options="availableMaps"
                  :picked="pickedMaps"
                  :open="comboOpen === 'map'"
                  :placeholder="`type to search ${availableMaps.length} maps…`"
                  empty-message="no maps match"
                  @toggle="pickMap"
                  @open="comboOpen = 'map'"
                  @close="comboOpen = null"
                />
              </section>

              <!-- Game Mode -->
              <section class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">Game Mode</span>
                  <span class="np-section-meta">{{ pickedGameModes.size ? `${pickedGameModes.size} picked` : 'any' }}</span>
                </div>
                <div class="np-chips">
                  <button
                    v-for="t in availableGameModes"
                    :key="t"
                    class="np-chip"
                    :class="{ picked: pickedGameModes.has(t) }"
                    @click="pickGameMode(t)"
                  >
                    {{ t }}
                  </button>
                  <span v-if="!availableGameModes.length" class="np-empty">none in corpus</span>
                </div>
              </section>

              <!-- Hero — combobox (51 heroes, broad-match against heroes_played) -->
              <section class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">Hero</span>
                  <span class="np-section-meta">
                    {{ pickedHeroes.size ? `${pickedHeroes.size} picked` : 'any' }}
                    · {{ availableHeroes.length }} available · matches any played
                  </span>
                </div>
                <FilterCombobox
                  combo-id="hero"
                  label="Heroes"
                  :options="availableHeroes"
                  :picked="pickedHeroes"
                  :open="comboOpen === 'hero'"
                  :placeholder="`type to search ${availableHeroes.length} heroes…`"
                  empty-message="no heroes match"
                  @toggle="pickHero"
                  @open="comboOpen = 'hero'"
                  @close="comboOpen = null"
                />
              </section>

              <!-- Role -->
              <section class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">Role</span>
                  <span class="np-section-meta">{{ pickedRoles.size ? `${pickedRoles.size} picked` : 'any' }}</span>
                </div>
                <div class="np-chips">
                  <button
                    v-for="r in availableRoles"
                    :key="r"
                    class="np-chip"
                    :class="{ picked: pickedRoles.has(r) }"
                    @click="pickRole(r)"
                  >
                    {{ r }}
                  </button>
                  <span v-if="!availableRoles.length" class="np-empty">none in corpus</span>
                </div>
              </section>
            </div>

            <div class="np-col">
              <!-- Result -->
              <section class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">Result</span>
                  <span class="np-section-meta">{{ pickedResults.size ? `${pickedResults.size} picked` : 'any' }}</span>
                </div>
                <div class="np-chips">
                  <button
                    v-for="r in availableResults"
                    :key="r"
                    class="np-chip"
                    :class="{ picked: pickedResults.has(r) }"
                    @click="pickResult(r)"
                  >
                    {{ r }}
                  </button>
                </div>
              </section>

              <!-- Rank / tier — multi-select; only ranks present show. -->
              <section v-if="availableRanks.length" class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">Rank</span>
                  <span class="np-section-meta">{{ pickedRanks.size ? `${pickedRanks.size} picked` : 'any' }}</span>
                </div>
                <div class="np-chips">
                  <button
                    v-for="rank in availableRanks"
                    :key="rank"
                    class="np-chip"
                    :class="{ picked: pickedRanks.has(rank) }"
                    @click="pickRank(rank)"
                  >
                    {{ rank }}
                  </button>
                </div>
              </section>

              <!-- Modifiers — multi-select OR; a match carries several
                   rank-update pills, so a pick surfaces every game that
                   had any of them. -->
              <section v-if="availableModifiers.length" class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">Modifiers</span>
                  <span class="np-section-meta">{{ pickedModifiers.size ? `${pickedModifiers.size} picked` : 'any' }}</span>
                </div>
                <div class="np-chips">
                  <button
                    v-for="m in availableModifiers"
                    :key="m"
                    class="np-chip"
                    :class="{ picked: pickedModifiers.has(m) }"
                    @click="pickModifier(m)"
                  >
                    {{ m }}
                  </button>
                </div>
              </section>

              <!-- Queue type — multi-select OR across role/open.
                   Empty selection = no filter; either pick excludes
                   matches whose queue_type hasn't been set. -->
              <section class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">Queue</span>
                  <span class="np-section-meta">
                    {{ pickedQueues.size === 0 ? 'any' : `${pickedQueues.size} selected` }}
                  </span>
                </div>
                <div class="np-chips">
                  <button
                    class="np-chip"
                    :class="{ picked: pickedQueues.has('role') }"
                    data-queue-type="role"
                    @click="pickQueue('role')"
                  >
                    Role Queue
                  </button>
                  <button
                    class="np-chip"
                    :class="{ picked: pickedQueues.has('open') }"
                    data-queue-type="open"
                    @click="pickQueue('open')"
                  >
                    Open Queue
                  </button>
                  <button
                    class="np-chip"
                    :class="{ picked: pickedQueues.has('unknown') }"
                    data-queue-type="unknown"
                    @click="pickQueue('unknown')"
                  >
                    Unknown mode type
                  </button>
                </div>
              </section>

              <!-- Play mode — multi-select OR across quickplay /
                   competitive. Same semantics as Queue. Matches with
                   no play_mode (after the aggregator's fallback
                   chain) drop out when any pick is active. -->
              <section class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">Play mode</span>
                  <span class="np-section-meta">
                    {{ pickedPlayModes.size === 0 ? 'any' : `${pickedPlayModes.size} selected` }}
                  </span>
                </div>
                <div class="np-chips">
                  <button
                    class="np-chip"
                    :class="{ picked: pickedPlayModes.has('quickplay') }"
                    data-play-mode="quickplay"
                    @click="pickPlayMode('quickplay')"
                  >
                    Quickplay
                  </button>
                  <button
                    class="np-chip"
                    :class="{ picked: pickedPlayModes.has('competitive') }"
                    data-play-mode="competitive"
                    @click="pickPlayMode('competitive')"
                  >
                    Competitive
                  </button>
                  <button
                    class="np-chip"
                    :class="{ picked: pickedPlayModes.has('unknown') }"
                    data-play-mode="unknown"
                    @click="pickPlayMode('unknown')"
                  >
                    Unknown mode
                  </button>
                </div>
              </section>

              <!-- Tags -->
              <section class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">Tags</span>
                  <span class="np-section-meta">{{ pickedTags.size ? `${pickedTags.size} picked` : 'any' }}</span>
                </div>
                <div class="np-chips">
                  <button
                    v-for="t in availableTags"
                    :key="t"
                    class="np-chip"
                    :class="{ picked: pickedTags.has(t) }"
                    @click="pickTag(t)"
                  >
                    #{{ t }}
                  </button>
                  <span v-if="!availableTags.length" class="np-empty">no tags yet — add via match annotation</span>
                </div>
              </section>

              <!-- Teammates — picking >1 is AND (the exact stack) -->
              <section class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">Teammates</span>
                  <span class="np-section-meta">{{ pickedMembers.size ? `${pickedMembers.size} picked` : 'any' }}</span>
                </div>
                <div class="np-chips">
                  <button
                    v-for="m in availableMembers"
                    :key="m"
                    class="np-chip"
                    :class="{ picked: pickedMembers.has(m) }"
                    :data-member="m"
                    @click="pickMember(m)"
                  >
                    {{ m }}
                  </button>
                  <span v-if="!availableMembers.length" class="np-empty">no teammates yet — tag them via match annotation</span>
                </div>
              </section>

              <!-- Leavers -->
              <section class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">Leavers</span>
                  <span class="np-section-meta">{{ leaverHandling }}</span>
                </div>
                <div class="np-chips">
                  <button class="np-chip" :class="{ picked: leaverHandling === 'include' }" @click="leaverHandling = 'include'">
                    Include
                  </button>
                  <button class="np-chip" :class="{ picked: leaverHandling === 'exclude-tally' }" @click="leaverHandling = 'exclude-tally'">
                    Drop from tally
                  </button>
                  <button class="np-chip" :class="{ picked: leaverHandling === 'hide' }" @click="leaverHandling = 'hide'">
                    Hide entirely
                  </button>
                </div>
              </section>

              <!-- With a leaver — scope the SET to matches that carried a
                   leaver, by side. Distinct from the handling control
                   above (which only governs the W/L tally). -->
              <section v-if="availableLeaverSides.length" class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">With a leaver</span>
                  <span class="np-section-meta">{{ pickedLeavers.size ? `${pickedLeavers.size} picked` : 'any' }}</span>
                </div>
                <div class="np-chips">
                  <button
                    v-for="side in availableLeaverSides"
                    :key="side"
                    class="np-chip"
                    :class="{ picked: pickedLeavers.has(side) }"
                    @click="pickLeaver(side)"
                  >
                    {{ LEAVER_LABELS[side] }}
                  </button>
                </div>
              </section>

              <!-- Reviewed by — multi-select OR across self, coach,
                   and unreviewed. Empty selection = no filter. -->
              <section class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">Reviewed by</span>
                  <span class="np-section-meta">
                    {{ pickedReviewedBy.size === 0 ? 'any' : `${pickedReviewedBy.size} selected` }}
                  </span>
                </div>
                <div class="np-chips">
                  <button
                    class="np-chip"
                    :class="{ picked: pickedReviewedBy.has('self') }"
                    data-reviewed-by="self"
                    @click="pickReviewedBy('self')"
                  >
                    Self
                  </button>
                  <button
                    class="np-chip"
                    :class="{ picked: pickedReviewedBy.has('coach') }"
                    data-reviewed-by="coach"
                    @click="pickReviewedBy('coach')"
                  >
                    Coach
                  </button>
                  <button
                    class="np-chip"
                    :class="{ picked: pickedReviewedBy.has('unreviewed') }"
                    data-reviewed-by="unreviewed"
                    @click="pickReviewedBy('unreviewed')"
                  >
                    Unreviewed
                  </button>
                </div>
              </section>

              <!-- Provenance — narrow to records the user touched.
                   Empty = any source. "Edited" = parsed then
                   corrected; "User entered" = hand-logged, no
                   screenshots. Picking either drops pure-OCR rows. -->
              <section class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">Provenance</span>
                  <span class="np-section-meta">
                    {{ pickedSources.size === 0 ? 'any' : `${pickedSources.size} selected` }}
                  </span>
                </div>
                <div class="np-chips">
                  <button
                    class="np-chip"
                    :class="{ picked: pickedSources.has('ocr_edited') }"
                    data-source="ocr_edited"
                    @click="pickSource('ocr_edited')"
                  >
                    Edited
                  </button>
                  <button
                    class="np-chip"
                    :class="{ picked: pickedSources.has('manual') }"
                    data-source="manual"
                    @click="pickSource('manual')"
                  >
                    User entered
                  </button>
                </div>
              </section>

              <!-- Since this match — anchor checkbox. The anchor
                   itself is set/cleared from the match detail panel;
                   this section is the on-off switch for the filter. -->
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

              <!-- Min play threshold (both minutes + percent; OR semantics) + unknown toggle -->
              <section class="np-section">
                <div class="np-section-head">
                  <span class="np-section-eyebrow">Refinement</span>
                  <span class="np-section-meta">applies to picked heroes</span>
                </div>
                <div class="np-refine-row">
                  <p class="np-refine-hint">
                    Picked hero must meet at least one threshold in a match's heroes-played row.
                  </p>
                  <div class="np-thresholds">
                    <label class="np-num-label">
                      <span>Min play time</span>
                      <div class="np-num-input">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          class="np-num"
                          :value="minPlayMinutes"
                          @input="minPlayMinutes = parseInt(($event.target as HTMLInputElement).value || '0', 10) || 0"
                        >
                        <span class="np-num-unit">min</span>
                      </div>
                    </label>
                    <span class="np-thresholds-or">or</span>
                    <label class="np-num-label">
                      <span>Min played %</span>
                      <div class="np-num-input">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="5"
                          class="np-num"
                          :value="minPlayPercent"
                          @input="minPlayPercent = Math.max(0, Math.min(100, parseInt(($event.target as HTMLInputElement).value || '0', 10) || 0))"
                        >
                        <span class="np-num-unit">%</span>
                      </div>
                    </label>
                  </div>
                  <label class="np-toggle-label">
                    <input
                      type="checkbox"
                      :checked="includeUnknown"
                      @change="includeUnknown = ($event.target as HTMLInputElement).checked"
                    >
                    <span>Show unknown-map matches</span>
                  </label>
                </div>
              </section>
            </div>
          </div>

          <NarrowPresets :narrow="narrow" />

          <footer class="np-foot">
            <span class="np-foot-status">
              {{ narrowedRecords.length }} match<span v-if="narrowedRecords.length !== 1">es</span> in this view
            </span>
            <div class="np-foot-actions">
              <button class="np-btn ghost" :disabled="!anyNarrow" @click="resetNarrow">
                Reset
              </button>
              <button class="np-btn primary" @click="isOpen = false">
                Done
              </button>
            </div>
          </footer>
        </aside>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.lp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  backdrop-filter: blur(2px);
}

.left-panel {
  position: fixed;
  left: 0; top: 0;
  z-index: 100;
  width: min(420px, 100vw);
  height: 100vh;
  background: var(--surface);
  border-right: 1px solid var(--accent);
  box-shadow: 28px 0 60px -24px rgb(0 0 0 / 65%);
  padding: 0.9rem 1rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  overflow-y: auto;
}

/* Rail mode — peer column in MatchesView's grid. Drops the modal
   chrome (fixed position, slide-from-edge shadow) and lives where
   the grid puts it. The 3 px accent strip on the left edge
   (`::before`) stays as the brand signal. Sticky inside its column
   so it pins to the top while the right column scrolls. */
.left-panel-rail {
  position: sticky;
  top: 0;
  left: auto;
  z-index: auto;
  width: 320px;
  height: calc(100vh - 1rem);
  border-right: 1px solid var(--border-soft);
  box-shadow: none;
  padding: 0.7rem 0.85rem 0;
}

.left-panel::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--accent);
}

.lp-slide-enter-active,
.lp-slide-leave-active { transition: transform 240ms ease, opacity 240ms ease; }
.lp-slide-enter-from   { transform: translateX(-100%); opacity: 0; }
.lp-slide-leave-to     { transform: translateX(-100%); opacity: 0; }

.lp-fade-enter-active,
.lp-fade-leave-active { transition: opacity 200ms ease, backdrop-filter 200ms ease; }

.lp-fade-enter-from,
.lp-fade-leave-to { opacity: 0; backdrop-filter: none; }

@media (prefers-reduced-motion: reduce) {
  .lp-slide-enter-active,
  .lp-slide-leave-active,
  .lp-fade-enter-active,
  .lp-fade-leave-active { transition: none; }
}

.np-head {
  display: flex;
  align-items: baseline;
  gap: 0.65rem;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid var(--border);
}

.np-eyebrow {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.np-title {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  margin: 0;
}

.np-meta {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
}

.np-close {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--text-faint);
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.3rem;
}

.np-close:hover { color: var(--accent); }

.np-section {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.np-section-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.np-section-eyebrow {
  font-family: var(--mono);
  font-size: 0.56rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 700;
}

.np-section-meta {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text-dim);
  margin-left: auto;
  text-transform: lowercase;
}

.np-search-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: 2px;
}

.np-search-glyph {
  color: var(--text-faint);
  font-size: 0.95rem;
}

.np-search-input {
  appearance: none;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.78rem;
  width: 100%;
  padding: 0.1rem 0;
}

.np-search-input::placeholder { color: var(--text-faint); }

.np-search-kbd {
  font-family: var(--mono);
  font-size: 0.62rem;
  padding: 0.05rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  color: var(--text-faint);
  background: var(--surface);
}

.np-search-input:focus + .np-search-kbd,
.np-search-row:focus-within { border-color: var(--accent); }

.np-daterange {
  display: flex;
  gap: 0.4rem;
  align-items: end;
  flex-wrap: wrap;
}

.np-date-label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.np-date {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.25rem 0.4rem;
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text);
  outline: 0;
  color-scheme: dark light;
}

.np-date:focus { border-color: var(--accent); }

.np-date-clear {
  appearance: none;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.25rem 0.5rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
}

.np-date-clear:hover { color: var(--accent); border-color: var(--accent); }

.np-cols {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.np-col {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.np-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.np-chip {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.22rem 0.5rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text-dim);
  cursor: pointer;
  letter-spacing: 0.04em;
  text-transform: lowercase;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

.np-chip:hover {
  border-color: var(--accent-soft, var(--accent));
  color: var(--text);
}

.np-chip.picked {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 700;
}

.np-empty {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text-faint);
  font-style: italic;
}

.np-refine-row {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.np-refine-hint {
  margin: 0;
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text-faint);
  line-height: 1.4;
}

.np-thresholds {
  display: inline-flex;
  align-items: end;
  gap: 0.6rem;
}

.np-thresholds-or {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  padding-bottom: 0.3rem;
  font-weight: 700;
}

.np-num-label, .np-toggle-label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.np-num-input {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.2rem 0.45rem;
  width: max-content;
}

.np-num {
  appearance: textfield;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.78rem;
  width: 3.5rem;
}

.np-num::-webkit-outer-spin-button,
.np-num::-webkit-inner-spin-button { appearance: none; margin: 0; }

.np-num-unit { font-family: var(--mono); font-size: 0.6rem; color: var(--text-dim); }

.np-toggle-label {
  flex-direction: row;
  align-items: center;
  gap: 0.45rem;
  text-transform: none;
  letter-spacing: 0.02em;
  font-size: 0.72rem;
  color: var(--text);
}

.np-toggle-label input[type="checkbox"] { accent-color: var(--accent); }

.np-since-anchor {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.np-since-anchor-meta {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-dim);
  flex-wrap: wrap;
}

.np-since-anchor-date {
  color: var(--accent);
  font-weight: 700;
  letter-spacing: 0.04em;
}

.np-since-anchor-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.np-since-anchor-open,
.np-since-anchor-clear {
  appearance: none;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 0.25rem 0.55rem;
  border-radius: 2px;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}

.np-since-anchor-open:hover,
.np-since-anchor-clear:hover {
  border-color: var(--accent);
  color: var(--text);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.np-since-anchor-open:focus-visible,
.np-since-anchor-clear:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}

.np-foot {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  position: sticky;
  bottom: 0;
  background: var(--surface);
  margin: 0 -1rem;
  padding: 0.55rem 1rem;
  border-top: 1px solid var(--border);
  z-index: 1;
}

.np-foot-status {
  font-family: var(--mono);
  font-size: 0.66rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
}

.np-foot-actions {
  margin-left: auto;
  display: inline-flex;
  gap: 0.4rem;
}

.np-btn {
  appearance: none;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.35rem 0.75rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text-dim);
  cursor: pointer;
}

.np-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.np-btn.ghost:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }

.np-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--surface);
}
</style>
