<script setup lang="ts">
// About Recall — the app's identity + update hub, modeled on Chrome's "About
// Chrome" / Firefox's "About Firefox": the version, the update check, and the
// project links all live here. Opened from the native menu (macOS), the ⋮ kebab
// (Windows/Linux/browser), and the 90-day update-reminder banner.
//
// Two update sections (unchanged from the old Check-for-updates modal):
//   1. Recall app — current vs latest binary version + release notes.
//   2. Game data — the always-pulled-from-main hero/map channel + diff manifest.
// The update-section markup keeps its `update-check-modal-*` classes and
// `data-update-check-*` hooks verbatim so the update logic + tests are untouched.
//
// A11y: role="dialog" + aria-modal + focus trap + Esc-to-close + return-focus.

import { toRef, computed } from 'vue'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'
import { useGameDataUpdate } from '@/composables/shared/useGameDataUpdate'
import UpdateDiffManifest from '@/components/shared/UpdateDiffManifest.vue'
import { OpenURL, type UpdateInfo, type DataUpdateResult } from '@/api-client'
import { GITHUB_REPO_URL, LICENSE_URL, ISSUES_URL } from '@/app-links'

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

useModalFocusTrap(toRef(props, 'open'), {
  containerSelector: '.update-check-modal-box',
  onClose: () => emit('close'),
})

const info = computed(() => props.updateInfo)

// Game-data freshness / counts / diff manifest / apply state machine.
const {
  applyState,
  gameData,
  addedCount,
  removedCount,
  changeCount,
  diffRows,
  changeSummary,
  dataFreshnessLabel,
  canApply,
  onApply,
} = useGameDataUpdate(
  () => props.updateInfo,
  () => props.open,
  (result) => emit('applied', result),
)

function openReleasePage() {
  if (info.value?.url) OpenURL(info.value.url)
}
</script>

<template>
  <Transition name="update-check-modal">
    <div v-if="open" class="update-check-modal-overlay" @click.self="$emit('close')">
      <div
        class="update-check-modal-box"
        data-about-modal
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-check-modal-title"
      >
        <header class="update-check-modal-head">
          <h2 id="update-check-modal-title" class="update-check-modal-title">
            About Recall
          </h2>
          <button
            type="button"
            class="update-check-modal-close"
            aria-label="Close about"
            @click="$emit('close')"
          >
            ×
          </button>
        </header>

        <div class="update-check-modal-body">
          <!-- Identity — always shown, independent of the update roundtrip. -->
          <div class="about-identity">
            <p class="about-wordmark" aria-hidden="true">
              RE<span class="about-wordmark-accent">CALL</span>
            </p>
            <p class="about-version" data-about-version>
              {{ currentVersion ? `v${currentVersion}` : 'version unknown' }}
            </p>
            <p class="about-tagline">
              Personal telemetry · Match almanac
            </p>
          </div>

          <!-- Update status. Loading while CheckForUpdate is in flight. -->
          <div v-if="checking && !info" class="update-check-modal-body update-check-modal-loading">
            <span class="update-check-modal-spinner" aria-hidden="true" />
            <span>Checking GitHub releases…</span>
          </div>

          <!-- Network failure / pre-check state. -->
          <div v-else-if="!info" class="update-check-modal-body update-check-modal-loading">
            <span>Unable to reach GitHub. Please retry later.</span>
          </div>

          <template v-else>
            <!-- Section 1: Recall binary -->
            <section class="update-check-modal-section" aria-labelledby="recall-app-heading">
              <h3 id="recall-app-heading" class="update-check-modal-section-title">
                Recall app
              </h3>
              <!-- Dev build: the running version is HIGHER than the latest
                   release (release-please names the next version on main), so
                   frame it as a development build — not a misleading "behind". -->
              <div v-if="info.dev_build" class="update-check-modal-devbuild" data-update-check-devbuild>
                <p class="update-check-modal-devbuild-current">
                  Development build · {{ currentVersion ? `v${currentVersion}` : 'unknown' }}
                </p>
                <p class="update-check-modal-devbuild-note">
                  Ahead of the latest release (v{{ info.latest }})
                </p>
              </div>
              <!-- Release build with a newer release published. -->
              <div v-else-if="info.available" class="update-check-modal-rows" data-update-check-available>
                <div class="update-check-modal-row">
                  <span class="update-check-modal-row-label">Current</span>
                  <span class="update-check-modal-row-value">{{ currentVersion ? `v${currentVersion}` : 'unknown' }}</span>
                </div>
                <div class="update-check-modal-row">
                  <span class="update-check-modal-row-label">Latest</span>
                  <span class="update-check-modal-row-value">
                    v{{ info.latest }}
                    <span class="update-check-modal-update-flag">↑ update available</span>
                  </span>
                </div>
              </div>
              <!-- Release build, up to date. -->
              <p v-else class="update-check-modal-uptodate" data-update-check-uptodate>
                v{{ currentVersion || info.latest }} · You're on the latest release
              </p>
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
                   can't apply because we don't have anything to apply. -->
              <p v-if="!gameData.commit_sha" class="update-check-modal-empty" data-update-check-main-unreachable>
                MAIN UNREACHABLE · GITHUB PAGES DID NOT RESPOND
              </p>

              <template v-else>
                <!-- Plain-language headline + data age. -->
                <p
                  v-if="changeSummary"
                  class="update-check-modal-summary"
                  data-update-check-summary
                >
                  {{ changeSummary }}
                </p>
                <p class="update-check-modal-freshness" data-update-check-freshness>
                  {{ dataFreshnessLabel }}
                </p>

                <UpdateDiffManifest
                  :change-count="changeCount"
                  :added-count="addedCount"
                  :removed-count="removedCount"
                  :diff-rows="diffRows"
                  :applied="applyState.kind === 'success'"
                />

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
            </section>
          </template>

          <hr class="update-check-modal-rule">

          <!-- About meta — project links + the unofficial-fan-tool disclaimer.
               Always shown; independent of the update roundtrip. -->
          <section class="about-meta" aria-labelledby="about-meta-heading">
            <h3 id="about-meta-heading" class="update-check-modal-section-title">
              About
            </h3>
            <div class="about-links">
              <button type="button" class="about-link" data-about-github @click="OpenURL(GITHUB_REPO_URL)">
                Source on GitHub ↗
              </button>
              <button type="button" class="about-link" data-about-license @click="OpenURL(LICENSE_URL)">
                Apache-2.0 license ↗
              </button>
              <button type="button" class="about-link" data-about-issues @click="OpenURL(ISSUES_URL)">
                Report an issue ↗
              </button>
            </div>
            <p class="about-disclaimer" data-about-disclaimer>
              Unofficial fan-made tool — not affiliated with, endorsed, or sponsored by
              Blizzard Entertainment. Overwatch and all related marks are trademarks of
              Blizzard Entertainment, Inc.; hero, map, and mode names are used for
              identification only.
            </p>
          </section>

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

.update-check-modal-update-flag {
  color: var(--accent);
  font-weight: 700;
  margin-left: 0.4rem;
}

.update-check-modal-devbuild-current {
  font-family: var(--mono);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text);
  margin: 0 0 0.15rem;
}

.update-check-modal-devbuild-note,
.update-check-modal-uptodate {
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  color: var(--text-dim);
  margin: 0 0 0.45rem;
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
   About identity + meta (new in the About dialog)
   ──────────────────────────────────────────────────────────────── */

.about-identity {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  text-align: center;
  padding: 0.3rem 0 0.6rem;
  border-bottom: 1px solid var(--border-soft);
}

.about-wordmark {
  font-family: var(--brand);
  font-size: 1.9rem;
  letter-spacing: 0.04em;
  color: var(--text);
  margin: 0;
  line-height: 1;
}

.about-wordmark-accent {
  color: var(--accent);
}

.about-version {
  font-family: var(--mono);
  font-size: 0.74rem;
  letter-spacing: 0.08em;
  color: var(--text-dim);
  margin: 0.15rem 0 0;
}

.about-tagline {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  margin: 0;
}

.about-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.85rem;
  margin-bottom: 0.55rem;
}

.about-link {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0;
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  color: var(--accent);
  cursor: pointer;
  text-decoration: none;
}

.about-link:hover {
  text-decoration: underline;
}

.about-disclaimer {
  font-size: 0.68rem;
  line-height: 1.5;
  color: var(--text-faint);
  margin: 0;
}

/* ────────────────────────────────────────────────────────────────
   Game-data section: freshness line + counts headline + manifest
   ──────────────────────────────────────────────────────────────── */

.update-check-modal-game-data {
  display: flex;
  flex-direction: column;
}

.update-check-modal-summary {
  font-family: var(--display);
  font-size: 1.45rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  line-height: 1.15;
  color: var(--text);
  margin: 0.1rem 0 0.25rem;
}

.update-check-modal-freshness {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  color: var(--text-dim);
  margin: 0 0 0.7rem;
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
}
</style>
