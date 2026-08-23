<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import type { FailedFile } from '@/api-client'
import { screenshotURL } from '@/match/match-helpers'
import { formatParsedAt } from '@/match/match-time-helpers'
import { useDiagnosticBundle } from '@/composables/ingest/useDiagnosticBundle'
import { useHoverThumbnail } from '@/composables/shared/media/useHoverThumbnail'
import { useParseStore } from '@/stores/parse'
import { useMatchActions } from '@/composables/matches/useMatchActions'

// The "Failed to read" section: screenshots whose OCR attempt failed
// outright. These have NO MatchRecord (nothing was stored), so they ride
// the failed-files ledger instead of the records array. Each row shows
// the filename, the parser's error verbatim, and the attempt tally —
// plus the same two-click "Delete forever" suppression the unmatched
// cards use. Failed files are re-attempted on every parse run; the
// section copy says so, because that's why the run counter keeps
// including them.

const parseStore = useParseStore()
const { onIgnoreScreenshot } = useMatchActions()

const failedFiles = computed(() => parseStore.failedFiles)

// "Save diagnostic bundle" — one click, one zip (failed screenshots +
// logs + environment manifest) for bug reports. Wails saves via the
// native dialog; server mode blob-downloads. An empty saved-name means
// the user canceled the dialog — stay silent.
const {
  savedAs: bundleSavedAs,
  busy: bundleBusy,
  exportBundle: onSaveDiagnosticBundle,
} = useDiagnosticBundle()

// "Delete forever" arm/disarm — the UnknownUnmatchedSection pattern,
// keyed by filename (failed rows have no match_key).
const IGNORE_ARM_MS = 3000
const armedIgnore = ref<Set<string>>(new Set())
const armTimers: Record<string, ReturnType<typeof setTimeout>> = {}

function disarmIgnore(filename: string) {
  const t = armTimers[filename]
  if (t !== undefined) {
    clearTimeout(t)
    delete armTimers[filename]
  }
  if (armedIgnore.value.has(filename)) {
    const next = new Set(armedIgnore.value)
    next.delete(filename)
    armedIgnore.value = next
  }
}

function onIgnoreClick(row: FailedFile) {
  if (!armedIgnore.value.has(row.filename)) {
    const next = new Set(armedIgnore.value)
    next.add(row.filename)
    armedIgnore.value = next
    armTimers[row.filename] = setTimeout(() => disarmIgnore(row.filename), IGNORE_ARM_MS)
    return
  }
  disarmIgnore(row.filename)
  void onIgnoreScreenshot(row.filename)
}

function isIgnoreArmed(filename: string): boolean {
  return armedIgnore.value.has(filename)
}

// Cursor-anchored hover thumbnail, same peek the unmatched cards give.
// Failed files carry no dir id on the wire — they were seen in the
// configured screenshots folder, which is exactly what dir id 0 resolves.
const { hoveredSrc, thumbX, thumbY, showThumb, onHover, onMove, onLeave } = useHoverThumbnail({
  isVisible: () => true,
  srcFor: (filename) => screenshotURL(filename, 0),
  canShow: () => true,
})

// "Delete forever" suppresses the file and wipes its row — a write.
const { writesLocked, lockReason } = useWriteGate()
</script>

<template>
  <div v-if="failedFiles.length > 0" id="section-failed" class="unknown-list">
    <div class="failed-section-head">
      <div class="failed-head-row">
        <h3 class="failed-heading">
          Failed to read ({{ failedFiles.length }})
        </h3>
        <button
          type="button"
          class="btn failed-bundle-btn"
          data-diagnostic-bundle
          :disabled="bundleBusy"
          @click="onSaveDiagnosticBundle"
        >
          {{ bundleBusy ? 'Building…' : 'Save diagnostic bundle' }}
        </button>
      </div>
      <p class="failed-blurb">
        Recall could not read these screenshots at all — they are retried on every parse run.
        Delete one forever to stop retrying it, or save a diagnostic bundle
        (these images + logs + version info) to attach to a bug report.
      </p>
      <p v-if="bundleSavedAs" class="failed-bundle-saved" role="status">
        ✓ Saved {{ bundleSavedAs }}
      </p>
    </div>

    <article
      v-for="(row, idx) in failedFiles"
      :key="row.filename"
      class="unknown-card failed-card"
      @mouseenter="(e) => onHover(row.filename, e)"
      @mousemove="(e) => onMove(row.filename, e)"
      @mouseleave="onLeave"
    >
      <div class="unknown-card-head failed-card-head">
        <div class="unknown-head-lhs">
          <span class="unknown-idx">{{ String(idx + 1).padStart(2, '0') }}</span>
          <div class="unknown-key-block">
            <span class="unknown-key mono">{{ row.filename }}</span>
            <span class="unknown-src-count">
              {{ row.attempts }} attempt{{ row.attempts === 1 ? '' : 's' }} · last {{ formatParsedAt(row.last_failed_at) }}
            </span>
          </div>
        </div>
        <div class="unknown-head-rhs">
          <button
            type="button"
            class="unknown-delete-btn"
            :class="{ armed: isIgnoreArmed(row.filename) }"
            :aria-label="isIgnoreArmed(row.filename)
              ? `Confirm permanently ignoring ${row.filename}`
              : `Permanently ignore ${row.filename}`"
            :data-failed-ignore="row.filename"
            :disabled="writesLocked"
            :title="lockReason || undefined"
            @click="onIgnoreClick(row)"
          >
            {{ isIgnoreArmed(row.filename) ? 'Confirm delete?' : 'Delete forever' }}
          </button>
        </div>
      </div>
      <p class="failed-error mono">
        {{ row.error }}
      </p>
    </article>
  </div>

  <Teleport to="body">
    <img
      v-if="showThumb"
      class="unknown-hover-thumb"
      :src="hoveredSrc"
      :style="{ left: thumbX + 'px', top: thumbY + 'px' }"
      alt=""
      aria-hidden="true"
    >
  </Teleport>
</template>

<style scoped>
.failed-section-head {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin-bottom: 0.35rem;
}

.failed-heading {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--type-sm);
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.failed-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

.failed-bundle-btn {
  flex-shrink: 0;
}

.failed-bundle-saved {
  margin: 0;
  font-size: var(--type-sm);
  color: var(--win);
}

.failed-blurb {
  margin: 0;
  font-size: var(--type-sm);
  color: var(--text-faint);
}

.failed-card {
  padding-bottom: 0.5rem;
}

.failed-card-head {
  cursor: default;
}

.failed-error {
  margin: 0;
  padding: 0 0.8rem;
  font-size: var(--type-sm);
  color: var(--loss);
  overflow-wrap: anywhere;
}
</style>
