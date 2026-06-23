<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { MatchRecord } from '@/api-client'
import { detectScreenshotSlots, screenshotURL } from '@/match/match-helpers'
import { formatParsedAt } from '@/match/match-time-helpers'
import { useHoverThumbnail } from '@/composables/shared/useHoverThumbnail'
import type { CardStateApi } from '@/types/cardState'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'
import { useMatchActions } from '@/composables/matches/useMatchActions'

// The Unmatched section: cards for records with no parsed map (corrupted shot or
// a non-OW PNG in the watched folder). Each card shows a slot-chip strip + a field
// diagnostic + (on expand) source previews / parsed stats + a two-click "Delete
// forever". A cursor-anchored hover thumbnail (mouse) / long-press peek (touch)
// gives a lower-friction triage glance. Card-expand/preview state comes from the
// parent via the cardState prop; the card chrome lives in the global unknown.css.
const props = defineProps<{ cardState: CardStateApi }>()

const matchesStore = useMatchesStore()
const uiStore = useUiStore()
const { onIgnoreScreenshot } = useMatchActions()
const preloadScreenshot = uiStore.preview.preload
const openLightbox = uiStore.preview.openLightbox

const unknownRecords = computed(() => matchesStore.unknownRecords)

// "Delete forever" arm/disarm — mirrors DashboardEditBanner's destructive-confirm
// pattern. First click on a card's button flips it to an armed "Confirm delete?"
// state with a 3 s auto-disarm timer; the second click within that window fires
// the ignore. Keyed by match_key so concurrent arms on multiple cards don't collide.
const IGNORE_ARM_MS = 3000
const armedIgnore = ref<Set<string>>(new Set())
const armTimers: Record<string, ReturnType<typeof setTimeout>> = {}

function disarmIgnore(matchKey: string) {
  const t = armTimers[matchKey]
  if (t !== undefined) {
    clearTimeout(t)
    delete armTimers[matchKey]
  }
  if (armedIgnore.value.has(matchKey)) {
    const next = new Set(armedIgnore.value)
    next.delete(matchKey)
    armedIgnore.value = next
  }
}

function onIgnoreClick(rec: MatchRecord) {
  const filename = rec.source_files?.[0]
  if (!filename) return
  if (!armedIgnore.value.has(rec.match_key)) {
    const next = new Set(armedIgnore.value)
    next.add(rec.match_key)
    armedIgnore.value = next
    armTimers[rec.match_key] = setTimeout(() => disarmIgnore(rec.match_key), IGNORE_ARM_MS)
    return
  }
  disarmIgnore(rec.match_key)
  void onIgnoreScreenshot(filename)
}

function isIgnoreArmed(matchKey: string): boolean {
  return armedIgnore.value.has(matchKey)
}

// Hover-preview state for the Unknown card list. Mouseenter on a collapsed card
// sets the hovered key → the floating thumbnail renders next to the cursor
// (Teleport'd to body so it sits above every other surface) and follows mousemove
// until the user leaves the row. Suppressed when the card is expanded (the
// per-source-file thumbnails already cover that need) and when the record has no
// source files. State + position math live in the shared useHoverThumbnail.
const {
  hoveredSrc: hoveredUnknownSrc,
  thumbX,
  thumbY,
  showThumb: showHoverThumb,
  onHover,
  onMove,
  onLeave: onLeaveUnknown,
} = useHoverThumbnail({
  isVisible: () => true,
  srcFor: (key) => {
    const rec = matchesStore.unknownRecords.find((r) => r.match_key === key)
    const first = rec?.source_files?.[0]
    return first ? screenshotURL(first, rec.source_dir_ids?.[first] ?? 0) : ''
  },
  // Suppress the peek while the card is expanded (its inline previews cover it).
  canShow: (key) => !props.cardState.isSelected(key),
})
function onHoverUnknown(rec: MatchRecord, e: MouseEvent) { onHover(rec.match_key, e) }
function onMoveUnknown(rec: MatchRecord, e: MouseEvent) { onMove(rec.match_key, e) }

// Pre-fetch the first source file of every visible Unknown record via the shared
// composable's preload registry so the hover thumb shows from cache instantly.
// Idempotent — the composable dedupes URLs, so the in-card source-preview <img>'s
// later request reads from the same cached response.
function preloadVisibleScreenshots() {
  for (const rec of matchesStore.unknownRecords) {
    const first = rec.source_files?.[0]
    if (!first) continue
    preloadScreenshot(screenshotURL(first, rec.source_dir_ids?.[first] ?? 0))
  }
}

onMounted(preloadVisibleScreenshots)
watch(() => matchesStore.unknownRecords, preloadVisibleScreenshots, { deep: false })

// Touch-pointer long-press fallback for the hover thumbnail. Mouse users get
// instant peek on hover; touch users have no hover, so a long-press (~500 ms held
// without movement) shows the same thumb anchored to the touch point. A short tap
// still falls through to click-to-expand. Skipped on small viewports (< 600 px)
// where the thumb wouldn't fit usefully.
const LONG_PRESS_MS = 500
const PRESS_MOVE_TOLERANCE = 10

let pressTimer: ReturnType<typeof setTimeout> | null = null
let pressStartX = 0
let pressStartY = 0
let longPressFired = false

function clearPressTimer() {
  if (pressTimer !== null) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function shouldEnableTouchPeek(): boolean {
  if (typeof window === 'undefined') return false
  if (window.innerWidth < 600) return false
  return true
}

function onPointerDownUnknown(rec: MatchRecord, e: PointerEvent) {
  if (e.pointerType !== 'touch') return
  if (!shouldEnableTouchPeek()) return
  if (props.cardState.isSelected(rec.match_key)) return
  const first = rec.source_files?.[0]
  if (!first) return

  longPressFired = false
  pressStartX = e.clientX
  pressStartY = e.clientY
  clearPressTimer()
  pressTimer = setTimeout(() => {
    longPressFired = true
    // Anchor the thumb at the touch point via the shared hover composable.
    onHover(rec.match_key, { clientX: pressStartX, clientY: pressStartY } as MouseEvent)
  }, LONG_PRESS_MS)
}

function onPointerMoveUnknown(e: PointerEvent) {
  if (e.pointerType !== 'touch') return
  if (pressTimer === null) return
  const dx = Math.abs(e.clientX - pressStartX)
  const dy = Math.abs(e.clientY - pressStartY)
  if (dx > PRESS_MOVE_TOLERANCE || dy > PRESS_MOVE_TOLERANCE) clearPressTimer()
}

function onPointerEndUnknown() {
  clearPressTimer()
  if (longPressFired) {
    onLeaveUnknown()
  }
}

// Wrap the card-head click so a long-press that fired the peek doesn't ALSO toggle
// expand on touch release. `longPressFired` resets here so the next tap behaves.
function onCardHeadClick(rec: MatchRecord) {
  if (longPressFired) {
    longPressFired = false
    return
  }
  props.cardState.toggleExpand(rec.match_key)
}
</script>

<template>
  <div v-if="unknownRecords.length > 0" id="section-unmatched" class="unknown-list">
    <article
      v-for="(rec, idx) in unknownRecords"
      :key="rec.match_key"
      class="unknown-card"
      :class="{ expanded: cardState.isSelected(rec.match_key) }"
      @mouseenter="(e) => onHoverUnknown(rec, e)"
      @mousemove="(e) => onMoveUnknown(rec, e)"
      @mouseleave="onLeaveUnknown"
      @pointerdown="(e) => onPointerDownUnknown(rec, e)"
      @pointermove="(e) => onPointerMoveUnknown(e)"
      @pointerup="onPointerEndUnknown"
      @pointercancel="onPointerEndUnknown"
    >
      <!-- Card header: index + match key + slot chips + chevron -->
      <div class="unknown-card-head" @click="onCardHeadClick(rec)">
        <div class="unknown-head-lhs">
          <span class="unknown-idx">{{ String(idx + 1).padStart(2, '0') }}</span>
          <div class="unknown-key-block">
            <span class="unknown-key mono">{{ rec.match_key }}</span>
            <span class="unknown-src-count">{{ rec.source_files?.length || 0 }} screenshot{{ (rec.source_files?.length || 0) === 1 ? '' : 's' }}</span>
          </div>
        </div>
        <div class="unknown-head-rhs">
          <div class="slot-row" @click.stop>
            <span
              v-for="slot in detectScreenshotSlots(rec)"
              :key="slot.key"
              class="slot-chip"
              :class="{ present: slot.present, absent: !slot.present }"
              :title="slot.hint"
            >
              <span class="slot-dot" aria-hidden="true" />
              {{ slot.label }}
            </span>
          </div>
          <span class="chev" :class="{ open: cardState.isSelected(rec.match_key) }" aria-hidden="true">›</span>
        </div>
      </div>

      <!-- Field diagnostic strip — always visible -->
      <div class="unknown-fields">
        <div
          v-for="fd in [
            { label: 'Map', value: rec.data?.map },
            { label: 'Mode', value: rec.data?.playlist },
            { label: 'Type', value: rec.data?.game_mode },
            { label: 'Result', value: rec.data?.result },
            { label: 'Date', value: rec.data?.date },
            { label: 'Time', value: rec.data?.finished_at },
            { label: 'Length', value: rec.data?.game_length },
            { label: 'E/A/D', value: rec.data?.eliminations != null ? `${rec.data.eliminations} / ${rec.data.assists} / ${rec.data.deaths}` : null },
          ]"
          :key="fd.label"
          class="field-cell"
          :class="{ filled: !!fd.value, vacant: !fd.value }"
        >
          <span class="field-label">{{ fd.label }}</span>
          <span class="field-value">{{ fd.value || '—' }}</span>
        </div>
      </div>

      <!-- Expanded: source files + previews + any stats that parsed -->
      <template v-if="cardState.isSelected(rec.match_key)">
        <div class="unknown-expanded">
          <div v-if="rec.source_files?.length" class="unknown-sources">
            <div class="block-eyebrow">
              Source Files
            </div>
            <div v-for="f in rec.source_files" :key="f" class="source-file">
              <a
                class="source-name"
                :href="screenshotURL(f, rec.source_dir_ids?.[f] ?? 0)"
                :title="cardState.isPreviewOpen(f) ? 'Hide preview' : 'Show preview'"
                @click.prevent="cardState.togglePreview(f)"
              >
                <span class="chev small" :class="{ open: cardState.isPreviewOpen(f) }">›</span>
                <span class="source-name-text">{{ f }}</span>
              </a>
              <span
                v-if="rec.source_parsed_at?.[f]"
                class="source-parsed-chip"
                :title="`Inserted into the database at ${rec.source_parsed_at[f]} (UTC)`"
              >{{ formatParsedAt(rec.source_parsed_at[f]) }}</span>
              <img
                v-if="cardState.isPreviewOpen(f) && !cardState.hasPreviewError(f)"
                :src="screenshotURL(f, rec.source_dir_ids?.[f] ?? 0)"
                :alt="f"
                class="source-preview"
                title="Click to view fullscreen"
                @click="openLightbox(f, rec.source_files ?? [], rec.source_dir_ids ?? {})"
                @error="cardState.onPreviewError(f)"
              >
              <div v-if="cardState.isPreviewOpen(f) && cardState.hasPreviewError(f)" class="source-preview-error">
                Could not load image — check screenshots folder in Settings.
              </div>
            </div>
          </div>

          <div v-if="rec.data?.eliminations != null || rec.data?.damage != null" class="unknown-stats">
            <div class="block-eyebrow">
              Parsed Stats
            </div>
            <div class="stats">
              <div class="stat">
                <span class="stat-value">{{ rec.data.eliminations ?? '—' }}</span>
                <span class="stat-label">Elims</span>
              </div>
              <div class="stat">
                <span class="stat-value">{{ rec.data.assists ?? '—' }}</span>
                <span class="stat-label">Assists</span>
              </div>
              <div class="stat">
                <span class="stat-value">{{ rec.data.deaths ?? '—' }}</span>
                <span class="stat-label">Deaths</span>
              </div>
              <div class="stat">
                <span class="stat-value">{{ rec.data.damage != null ? rec.data.damage.toLocaleString() : '—' }}</span>
                <span class="stat-label">Damage</span>
              </div>
              <div class="stat">
                <span class="stat-value">{{ rec.data.healing != null ? rec.data.healing.toLocaleString() : '—' }}</span>
                <span class="stat-label">Healing</span>
              </div>
              <div class="stat">
                <span class="stat-value">{{ rec.data.mitigation != null ? rec.data.mitigation.toLocaleString() : '—' }}</span>
                <span class="stat-label">Mitigation</span>
              </div>
            </div>
          </div>

          <!-- "Delete forever" — destructive action zone. Two-click confirm: first
               click arms (red 3 s timer), second click fires IgnoreScreenshot. The
               file stays on disk; future parse runs skip it via the
               ignored_screenshots suppress-list, and the unmatched-<filename> match
               row gets wiped in lockstep so the card disappears immediately. -->
          <div v-if="rec.source_files?.length" class="unknown-delete-zone">
            <button
              type="button"
              class="unknown-delete-btn"
              :class="{ armed: isIgnoreArmed(rec.match_key) }"
              :aria-label="isIgnoreArmed(rec.match_key)
                ? `Confirm permanently ignoring ${rec.source_files[0]}`
                : `Permanently ignore ${rec.source_files[0]}`"
              :data-ignore-btn="rec.match_key"
              @click="onIgnoreClick(rec)"
            >
              {{ isIgnoreArmed(rec.match_key) ? 'Confirm delete?' : 'Delete forever' }}
            </button>
            <span class="unknown-delete-hint">
              Recall will skip this file on future parses. The file
              stays on disk.
            </span>
          </div>
        </div>
      </template>
    </article>
  </div>

  <!-- Hover-only floating thumbnail anchored to the cursor. Teleport'd to body so
       the fixed-position thumb sits above the masthead, status bar, and every
       other layer — and so the card's `overflow: hidden` clip never crops it.
       Renders only while a card is hovered + collapsed + the record has a
       source_file. The expanded view has its own per-file thumbnails. -->
  <Teleport to="body">
    <img
      v-if="showHoverThumb"
      class="unknown-hover-thumb"
      :src="hoveredUnknownSrc"
      :style="{ left: thumbX + 'px', top: thumbY + 'px' }"
      alt=""
      aria-hidden="true"
    >
  </Teleport>
</template>
