<script setup lang="ts">
// Update-check modal — single "Update game data" button + diff
// preview manifest.
//
// Two sections:
//   1. Recall app — current vs latest binary version + release
//      notes + "Open release page" link. Binary upgrade is the
//      maintainer's job; we just surface what's published.
//   2. Game data — the single, always-pulled-from-main channel that
//      lets users recognise newly-added heroes/maps without waiting
//      for a binary release. Shows a from→to freshness line, a
//      count headline, and a diff manifest of every changed name
//      grouped by kind (Hero / Map / Source).
//
// The "Release channel" sub-row this modal used to carry is gone —
// it was functionally redundant with "upgrade the binary".
//
// A11y: role="dialog" + aria-modal + focus trap + Esc-to-close +
// return-focus baseline mirrors MatchDetailPanel.vue. Reduced-motion
// collapses the slide-in.

import { ref, toRef, watch, computed } from 'vue'
import { useModalFocusTrap } from '../composables/useModalFocusTrap'
import {
  ApplyGameDataUpdate, OpenURL, ApiError,
  type UpdateInfo, type DataUpdateResult,
} from '../api'

const props = defineProps<{
  open:           boolean
  updateInfo:     UpdateInfo | null
  currentVersion: string
  checking:       boolean
}>()

const emit = defineEmits<{
  close:   []
  applied: [DataUpdateResult]
}>()

type ApplyState =
  | { kind: 'idle' }
  | { kind: 'applying' }
  | { kind: 'success', result: DataUpdateResult }
  | { kind: 'error',   message: string }

const applyState = ref<ApplyState>({ kind: 'idle' })

// Re-arm Apply when the modal re-opens.
watch(() => props.open, (isOpen) => {
  if (isOpen) applyState.value = { kind: 'idle' }
})

useModalFocusTrap(toRef(props, 'open'), {
  containerSelector: '.update-check-modal-box',
  onClose: () => emit('close'),
})

const info = computed(() => props.updateInfo)
const gameData = computed(() =>
  info.value?.game_data ?? { commit_sha: '', applied_commit: '', has_update: false })

// Counts headline — added/removed are separate because they read
// differently in the UI ("3 NEW · 1 RETIRED" splits visually into
// gain vs loss).
const addedCount = computed(() => {
  const g = gameData.value
  return (g.added_heroes?.length ?? 0) +
         (g.added_maps?.length ?? 0) +
         (g.added_sources?.length ?? 0)
})

const removedCount = computed(() => {
  const g = gameData.value
  return (g.removed_heroes?.length ?? 0) +
         (g.removed_maps?.length ?? 0) +
         (g.removed_sources?.length ?? 0)
})

const changeCount = computed(() => addedCount.value + removedCount.value)

// Diff manifest — every changed name, grouped by kind, in a single
// flat list the template iterates over. Order: added heroes → maps
// → sources, then removed heroes → maps → sources, so additions
// (the common case) sit at the top of the list.
type DiffRow = { kind: 'Hero' | 'Map' | 'Source', sign: '+' | '−', name: string }

const diffRows = computed<DiffRow[]>(() => {
  const g = gameData.value
  const rows: DiffRow[] = []
  for (const h of g.added_heroes   ?? []) rows.push({ kind: 'Hero',   sign: '+', name: h })
  for (const m of g.added_maps     ?? []) rows.push({ kind: 'Map',    sign: '+', name: m })
  for (const s of g.added_sources  ?? []) rows.push({ kind: 'Source', sign: '+', name: s })
  for (const h of g.removed_heroes ?? []) rows.push({ kind: 'Hero',   sign: '−', name: h })
  for (const m of g.removed_maps   ?? []) rows.push({ kind: 'Map',    sign: '−', name: m })
  for (const s of g.removed_sources?? []) rows.push({ kind: 'Source', sign: '−', name: s })
  return rows
})

// Freshness line: "MAIN @ abc1234 · 14 d ago" — surfaces the user's
// currently-applied commit so the diff has context.
//
// Returns the short SHA (or "embedded" when no commit applied yet)
// and a relative-age string. The relative-age helper handles the
// common "X minutes / hours / days ago" cases inline; for >365 d
// it falls back to an ISO date.
function relativeAge(iso?: string): string {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60)             return 'just now'
  if (seconds < 60 * 60)        return `${Math.floor(seconds / 60)} m ago`
  if (seconds < 60 * 60 * 24)   return `${Math.floor(seconds / 3600)} h ago`
  if (seconds < 60 * 60 * 24 * 365) return `${Math.floor(seconds / 86400)} d ago`
  return new Date(then).toISOString().slice(0, 10)
}

const appliedLabel = computed(() => {
  const g = gameData.value
  if (!g.applied_commit) return 'EMBEDDED'
  return `MAIN @ ${g.applied_commit}`
})

const appliedAgeLabel = computed(() => relativeAge(gameData.value.applied_at))

const incomingLabel = computed(() => {
  const g = gameData.value
  if (!g.commit_sha) return ''
  return `MAIN @ ${g.commit_sha}`
})

const incomingAgeLabel = computed(() => {
  const g = gameData.value
  return relativeAge(g.committed_at) || 'live'
})

const canApply = computed(() => {
  const g = gameData.value
  return g.has_update && !!g.commit_sha
})

async function onApply() {
  if (!canApply.value) return
  applyState.value = { kind: 'applying' }
  try {
    const result = await ApplyGameDataUpdate()
    applyState.value = { kind: 'success', result }
    emit('applied', result)
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : null
    const message = apiErr
      ? apiErr.body || `Apply failed (HTTP ${apiErr.status})`
      : (err instanceof Error ? err.message : String(err))
    applyState.value = { kind: 'error', message }
  }
}

function openReleasePage() {
  if (info.value?.url) OpenURL(info.value.url)
}
</script>

<template>
  <Transition name="update-check-modal">
    <div v-if="open" class="update-check-modal-overlay" @click.self="$emit('close')">
      <div
        class="update-check-modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-check-modal-title"
      >
        <header class="update-check-modal-head">
          <h2 id="update-check-modal-title" class="update-check-modal-title">
            Check for updates
          </h2>
          <button
            type="button"
            class="update-check-modal-close"
            aria-label="Close update check"
            @click="$emit('close')"
          >
            ×
          </button>
        </header>

        <!-- Loading state while CheckForUpdate is in flight. -->
        <div v-if="checking && !info" class="update-check-modal-body update-check-modal-loading">
          <span class="update-check-modal-spinner" aria-hidden="true" />
          <span>Checking GitHub releases…</span>
        </div>

        <!-- Network failure / pre-check state. -->
        <div v-else-if="!info" class="update-check-modal-body update-check-modal-loading">
          <span>Unable to reach GitHub. Please retry later.</span>
        </div>

        <div v-else class="update-check-modal-body">
          <!-- Section 1: Recall binary -->
          <section class="update-check-modal-section" aria-labelledby="recall-app-heading">
            <h3 id="recall-app-heading" class="update-check-modal-section-title">
              Recall app
            </h3>
            <div class="update-check-modal-rows">
              <div class="update-check-modal-row">
                <span class="update-check-modal-row-label">Current</span>
                <span class="update-check-modal-row-value">{{ currentVersion ? `v${currentVersion}` : 'unknown' }}</span>
              </div>
              <div class="update-check-modal-row">
                <span class="update-check-modal-row-label">Latest</span>
                <span class="update-check-modal-row-value">v{{ info.latest }}</span>
              </div>
            </div>
            <p v-if="info.release_notes" class="update-check-modal-notes">
              {{ info.release_notes }}
            </p>
            <button
              type="button"
              class="update-check-modal-btn update-check-modal-btn-ghost"
              data-update-check-open-release
              :disabled="!info.url"
              @click="openReleasePage"
            >
              Open release page
            </button>
          </section>

          <hr class="update-check-modal-rule">

          <!-- Section 2: Game data — single channel, single button. -->
          <section class="update-check-modal-section update-check-modal-game-data" aria-labelledby="game-data-heading">
            <h3 id="game-data-heading" class="update-check-modal-section-title">
              Game data
            </h3>

            <!-- Pages-unreachable state — main fetch failed; user
                 can't apply because we don't have anything to apply.
                 Surface the cause; don't pretend it's a "no
                 changes" state. -->
            <p v-if="!gameData.commit_sha" class="update-check-modal-empty" data-update-check-main-unreachable>
              MAIN UNREACHABLE · GITHUB PAGES DID NOT RESPOND
            </p>

            <template v-else>
              <!-- Freshness line: where you are → where you'd land. -->
              <p class="update-check-modal-freshness" data-update-check-freshness>
                <span class="update-check-modal-freshness-from">
                  {{ appliedLabel }}<template v-if="appliedAgeLabel"> · {{ appliedAgeLabel }}</template>
                </span>
                <span class="update-check-modal-freshness-arrow" aria-hidden="true">→</span>
                <span class="update-check-modal-freshness-to">
                  {{ incomingLabel }} · {{ incomingAgeLabel }}
                </span>
              </p>

              <!-- Counts headline — display font; the modal's hero
                   element after the redesign. -->
              <p
                v-if="changeCount > 0"
                class="update-check-modal-counts"
                :class="{ 'update-check-modal-counts-applied': applyState.kind === 'success' }"
                data-update-check-counts
              >
                <span v-if="addedCount > 0" class="update-check-modal-counts-added">
                  {{ addedCount }} NEW
                </span>
                <span v-if="addedCount > 0 && removedCount > 0" class="update-check-modal-counts-sep">·</span>
                <span v-if="removedCount > 0" class="update-check-modal-counts-removed">
                  {{ removedCount }} RETIRED
                </span>
              </p>

              <!-- Diff manifest. -->
              <ul
                v-if="changeCount > 0"
                class="update-check-modal-manifest"
                :class="{ 'update-check-modal-manifest-applied': applyState.kind === 'success' }"
                data-update-check-manifest
              >
                <li
                  v-for="row in diffRows"
                  :key="`${row.kind}-${row.sign}-${row.name}`"
                  class="update-check-modal-manifest-row"
                  :class="{
                    'update-check-modal-manifest-row-added': row.sign === '+',
                    'update-check-modal-manifest-row-removed': row.sign === '−',
                  }"
                >
                  <span class="update-check-modal-manifest-kind">{{ row.kind }}</span>
                  <span class="update-check-modal-manifest-sign" aria-hidden="true">{{ row.sign }}</span>
                  <span class="update-check-modal-manifest-name">{{ row.name }}</span>
                </li>
              </ul>

              <!-- Empty state. -->
              <p v-if="changeCount === 0 && !gameData.has_update" class="update-check-modal-empty">
                ALL CURRENT
              </p>

              <p v-if="applyState.kind === 'error'" class="update-check-modal-error" role="alert">
                {{ applyState.message }}
              </p>

              <!-- Apply button — full-width footer of the section. -->
              <div v-if="canApply || applyState.kind === 'success'" class="update-check-modal-apply-row">
                <button
                  type="button"
                  class="update-check-modal-btn update-check-modal-btn-primary update-check-modal-btn-wide"
                  data-update-check-apply
                  :disabled="applyState.kind === 'applying' || (!canApply && applyState.kind !== 'success')"
                  @click="onApply"
                >
                  <span v-if="applyState.kind === 'applying'">
                    <span class="update-check-modal-spinner" aria-hidden="true" />
                    Verifying SHA-256…
                  </span>
                  <span v-else-if="applyState.kind === 'success'">Applied</span>
                  <span v-else>Update game data</span>
                </button>
              </div>
            </template>

            <div class="update-check-modal-actions update-check-modal-actions-footer">
              <button
                type="button"
                class="update-check-modal-btn update-check-modal-btn-ghost"
                data-update-check-close
                @click="$emit('close')"
              >
                Close
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.update-check-modal-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  backdrop-filter: blur(6px);
  display: grid;
  place-items: center;
  z-index: 1000;
  padding: 1.5rem;
}

.update-check-modal-box {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  width: min(540px, 100%);
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 24px 60px color-mix(in srgb, var(--bg) 50%, transparent);
}

.update-check-modal-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.9rem 1.1rem 0.55rem;
  border-bottom: 1px solid var(--border-soft);
}

.update-check-modal-title {
  flex: 1 1 auto;
  font-family: var(--display);
  font-size: 1.4rem;
  font-weight: 400;
  letter-spacing: 0.06em;
  margin: 0;
  color: var(--text);
}

.update-check-modal-close {
  appearance: none;
  border: 1px solid var(--border-soft);
  background: transparent;
  color: var(--text-dim);
  font-size: 1.1rem;
  width: 1.8rem;
  height: 1.8rem;
  border-radius: 2px;
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease;
}

.update-check-modal-close:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.update-check-modal-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem 1.1rem 1.2rem;
}

.update-check-modal-loading {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 0.75rem;
}

.update-check-modal-section-title {
  font-family: var(--mono);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  margin: 0 0 0.5rem;
}

.update-check-modal-rows {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.25rem 0.85rem;
  margin-bottom: 0.5rem;
}

.update-check-modal-row {
  display: contents;
}

.update-check-modal-row-label {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
  align-self: center;
}

.update-check-modal-row-value {
  font-family: var(--mono);
  font-size: 0.8rem;
  color: var(--text);
}

.update-check-modal-notes {
  font-size: 0.75rem;
  color: var(--text-dim);
  line-height: 1.45;
  margin: 0.25rem 0 0.5rem;
  white-space: pre-line;
}

.update-check-modal-empty {
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  color: var(--text-dim);
  margin: 0.3rem 0;
}

.update-check-modal-error {
  background: color-mix(in srgb, var(--loss) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--loss) 50%, transparent);
  border-radius: 2px;
  padding: 0.55rem 0.7rem;
  color: var(--loss);
  font-family: var(--mono);
  font-size: 0.7rem;
  margin: 0.5rem 0;
}

.update-check-modal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.5rem;
}

.update-check-modal-actions-footer {
  border-top: 1px solid var(--border-soft);
  padding-top: 0.7rem;
  margin-top: 0.85rem;
}

.update-check-modal-btn {
  appearance: none;
  font-family: var(--mono);
  font-weight: 700;
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 0.38rem 0.85rem;
  border-radius: 2px;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}

.update-check-modal-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.update-check-modal-btn-ghost {
  background: transparent;
  border: 1px solid var(--border-strong);
  color: var(--text);
}

.update-check-modal-btn-ghost:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.update-check-modal-btn-primary {
  background: var(--accent);
  border: 1px solid var(--accent);
  color: var(--surface);
}

.update-check-modal-btn-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 80%, var(--text));
}

.update-check-modal-btn-wide {
  width: 100%;
  padding: 0.6rem 0.85rem;
  font-size: 0.7rem;
  letter-spacing: 0.22em;
}

.update-check-modal-rule {
  border: none;
  border-top: 1px solid var(--border-soft);
  margin: 0;
}

.update-check-modal-spinner {
  display: inline-block;
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-top-color: var(--accent);
  vertical-align: -2px;
  margin-right: 0.4rem;
  animation: update-check-modal-spin 0.9s linear infinite;
}

@keyframes update-check-modal-spin {
  to { transform: rotate(360deg); }
}

/* ────────────────────────────────────────────────────────────────
   Game-data section: freshness line + counts headline + manifest
   ──────────────────────────────────────────────────────────────── */

.update-check-modal-game-data {
  display: flex;
  flex-direction: column;
}

.update-check-modal-freshness {
  font-family: var(--mono);
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  color: var(--text-dim);
  margin: 0 0 0.6rem;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.update-check-modal-freshness-from,
.update-check-modal-freshness-to {
  white-space: nowrap;
}

.update-check-modal-freshness-from {
  color: var(--text-dim);
}

.update-check-modal-freshness-arrow {
  color: var(--accent);
  font-weight: 700;
}

.update-check-modal-freshness-to {
  color: var(--text);
}

.update-check-modal-counts {
  font-family: var(--display);
  font-size: 1.85rem;
  font-weight: 400;
  letter-spacing: 0.06em;
  margin: 0.2rem 0 0.65rem;
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  line-height: 1.05;
  transition: opacity 280ms ease;
}

.update-check-modal-counts-added {
  color: var(--win, #4ade80);
}

.update-check-modal-counts-removed {
  color: var(--loss);
}

.update-check-modal-counts-sep {
  color: var(--text-dim);
}

.update-check-modal-counts-applied {
  opacity: 0.55;
}

.update-check-modal-manifest {
  list-style: none;
  margin: 0 0 0.6rem;
  padding: 0;
  display: grid;
  grid-template-columns: max-content max-content 1fr;
  gap: 0.18rem 0.7rem;
  transition: opacity 280ms ease;
}

.update-check-modal-manifest-applied {
  opacity: 0.55;
}

.update-check-modal-manifest-row {
  display: contents;
}

.update-check-modal-manifest-kind {
  font-family: var(--mono);
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent);
  align-self: center;
  padding: 0.1rem 0.4rem;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 2px;
  background: color-mix(in srgb, var(--accent) 4%, transparent);
  text-align: center;
  min-width: 3.6em;
}

.update-check-modal-manifest-sign {
  font-family: var(--mono);
  font-size: 0.95rem;
  font-weight: 700;
  align-self: center;
  text-align: center;
  width: 1ch;
}

.update-check-modal-manifest-row-added .update-check-modal-manifest-sign {
  color: var(--win, #4ade80);
}

.update-check-modal-manifest-row-removed .update-check-modal-manifest-sign {
  color: var(--loss);
}

.update-check-modal-manifest-name {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text);
  align-self: center;
}

.update-check-modal-apply-row {
  margin-top: 0.4rem;
}

.update-check-modal-enter-active,
.update-check-modal-leave-active {
  transition: opacity 180ms ease;
}

.update-check-modal-enter-from,
.update-check-modal-leave-to {
  opacity: 0;
}

.update-check-modal-enter-active .update-check-modal-box,
.update-check-modal-leave-active .update-check-modal-box {
  transition: transform 220ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.update-check-modal-enter-from .update-check-modal-box,
.update-check-modal-leave-to .update-check-modal-box {
  transform: translateY(-12px);
}

@media (prefers-reduced-motion: reduce) {
  .update-check-modal-spinner { animation: none; }

  .update-check-modal-enter-active,
  .update-check-modal-leave-active { transition: none; }

  .update-check-modal-enter-active .update-check-modal-box,
  .update-check-modal-leave-active .update-check-modal-box { transition: none; }

  .update-check-modal-counts,
  .update-check-modal-manifest { transition: none; }
}
</style>
