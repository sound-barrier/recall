<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import type { MatchRecord } from '@/api-client'
import { detectScreenshotSlots, screenshotURL } from '@/match/match-helpers'
import { formatParsedAt } from '@/match/match-time-helpers'
import { useArmedAction } from '@/composables/unknown/useArmedAction'
import { useUnknownSelection, unknownRowLabel } from '@/composables/unknown/useUnknownSelection'
import UnknownBulkBar from '@/components/unknown/UnknownBulkBar.vue'
import { useHoverThumbnail } from '@/composables/shared/media/useHoverThumbnail'
import type { CardStateApi } from '@/types/cardState'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'
import { useMatchActions } from '@/composables/matches/useMatchActions'

// The Unmatched section: cards for records with no parsed map (corrupted shot or
// a non-OW PNG in the watched folder). Each card shows a slot-chip strip + a field
// diagnostic + (on expand) source previews / parsed stats + a two-click Dismiss.
// A cursor-anchored hover thumbnail (mouse) / long-press peek (touch)
// gives a lower-friction triage glance. Card-expand/preview state comes from the
// parent via the cardState prop; the card chrome lives in the global unknown.css.
const props = defineProps<{ cardState: CardStateApi }>()

// Dismiss suppresses the card's files and wipes their rows — a write. And
// design rule 8: a coaching session loans records, never files, so every
// /_screenshot/ URL below would resolve against the COACH's own disk under
// the player's filenames. The strip says so instead of asking for bytes.
const { writesLocked, lockReason, sessionActive } = useWriteGate()

const matchesStore = useMatchesStore()
const uiStore = useUiStore()
const { onDismissFiles } = useMatchActions()
const preloadScreenshot = uiStore.preview.preload
const openLightbox = uiStore.preview.openLightbox

const unknownRecords = computed(() => matchesStore.unknownRecords)

// Dismiss arm/disarm — keyed by match_key so concurrent arms on multiple
// cards don't collide. A card is dismissed whole: EVERY source file it
// carries joins the suppress-list, or a two-screenshot card would come
// straight back on the surviving file.
const { trigger: triggerDismiss, isArmed: isDismissArmed } = useArmedAction()

// Bulk dismiss — the post-import cleanup spree, where a folder of desktop
// screenshots all deserve the same verdict. The checkbox on each card IS the
// affordance (no bulk mode); the bar appears while anything is ticked. Its
// selection is this section's alone.
const selection = useUnknownSelection({
  rows: () => unknownRecords.value.map((r) => ({ id: r.match_key, files: r.source_files ?? [] })),
  onDismissFiles: (files) => { void onDismissFiles(files) },
})

function selectLabel(rec: MatchRecord): string {
  return `Select ${unknownRowLabel(rec.source_files ?? [], rec.match_key)}`
}

function onDismissClick(rec: MatchRecord) {
  const files = rec.source_files ?? []
  if (files.length === 0) return
  triggerDismiss(rec.match_key, () => { void onDismissFiles(files) })
}

function dismissLabel(rec: MatchRecord): string {
  const files = rec.source_files ?? []
  const what = files.length === 1 ? (files[0] ?? '') : `${files.length} screenshots of ${rec.match_key}`
  return isDismissArmed(rec.match_key) ? `Confirm dismissing ${what}` : `Dismiss ${what}`
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
    if (sessionActive.value) return ''
    const rec = matchesStore.unknownRecords.find((r) => r.match_key === key)
    const first = rec?.source_files?.[0]
    return first ? screenshotURL(first, rec.source_dir_ids?.[first] ?? 0) : ''
  },
  // Suppress the peek while the card is expanded (its inline previews cover
  // it) and for a loaned record, which has no image on this machine.
  canShow: (key) => !sessionActive.value && !props.cardState.isSelected(key),
})
function onHoverUnknown(rec: MatchRecord, e: MouseEvent) { onHover(rec.match_key, e) }
function onMoveUnknown(rec: MatchRecord, e: MouseEvent) { onMove(rec.match_key, e) }

// Pre-fetch the first source file of every visible Unknown record via the shared
// composable's preload registry so the hover thumb shows from cache instantly.
// Idempotent — the composable dedupes URLs, so the in-card source-preview <img>'s
// later request reads from the same cached response.
function preloadVisibleScreenshots() {
  if (sessionActive.value) return
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
    <UnknownBulkBar
      :selection="selection"
      row-noun="card"
      select-all-label="Select all unmatched"
      :total-rows="unknownRecords.length"
    />
    <article
      v-for="(rec, idx) in unknownRecords"
      :key="rec.match_key"
      class="unknown-card"
      :class="{ expanded: cardState.isSelected(rec.match_key) }"
      :aria-label="`Unmatched screenshot ${rec.match_key}`"
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
          <button
            type="button"
            class="leaf-checkbox unknown-select"
            role="checkbox"
            :aria-checked="selection.isSelected(rec.match_key) ? 'true' : 'false'"
            :aria-label="selectLabel(rec)"
            :disabled="writesLocked"
            :title="lockReason"
            @click.stop="selection.toggleSelected(rec.match_key)"
          >
            <span class="leaf-checkbox-glyph" aria-hidden="true">{{ selection.isSelected(rec.match_key) ? '✓' : '' }}</span>
          </button>
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
          <p v-if="sessionActive" class="unknown-sources-in-session">
            Screenshots aren't included in a coaching session.
          </p>
          <div v-else-if="rec.source_files?.length" class="unknown-sources">
            <div class="eyebrow block-eyebrow">
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
            <div class="eyebrow block-eyebrow">
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

          <!-- Dismiss — destructive action zone. Two-click confirm: first
               click arms (red 3 s timer), second click suppresses every file
               the card carries. The files stay on disk; future parse runs
               skip them via the ignored_screenshots suppress-list, and each
               file's own rows get wiped in lockstep so the card disappears
               immediately. -->
          <div v-if="rec.source_files?.length" class="unknown-delete-zone">
            <button
              type="button"
              class="unknown-delete-btn"
              :class="{ armed: isDismissArmed(rec.match_key) }"
              :aria-label="dismissLabel(rec)"
              :data-ignore-btn="rec.match_key"
              :disabled="writesLocked"
              :title="lockReason || undefined"
              @click="onDismissClick(rec)"
            >
              {{ isDismissArmed(rec.match_key) ? 'Confirm dismiss?' : 'Dismiss' }}
            </button>
            <span class="unknown-delete-hint">
              Recall will skip these files on future parses. The files stay
              on disk — restore them anytime in Settings → Advanced →
              Manage ignored files.
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
