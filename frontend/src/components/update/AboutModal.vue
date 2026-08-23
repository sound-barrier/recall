<script setup lang="ts">
// About Recall — the app's identity + update hub, modeled on Chrome's "About
// Chrome" / Firefox's "About Firefox": the version, the update check, and the
// project links all live here. Opened from the native menu (macOS), the ⋮ kebab
// (Windows/Linux/browser), and the 90-day update-reminder banner.
//
// Two update sections (unchanged from the old Check-for-updates modal):
//   1. Recall app — current vs latest binary version + release notes; the
//      in-app self-update CTA is the SelfUpdateCta child.
//   2. Game data — the always-pulled-from-main hero/map channel + diff manifest.
// The update-section markup keeps its `update-check-modal-*` classes and
// `data-update-check-*` hooks verbatim so the update logic + tests are untouched.
//
// A11y: role="dialog" + aria-modal + focus trap + Esc-to-close + return-focus.

import { toRef, computed } from 'vue'
import { useModalFocusTrap } from '@/composables/shared/keyboard/useModalFocusTrap'
import { useGameDataUpdate } from '@/composables/update/useGameDataUpdate'
import UpdateDiffManifest from '@/components/update/UpdateDiffManifest.vue'
import SelfUpdateCta from '@/components/update/SelfUpdateCta.vue'
import type { UpdateInfo, DataUpdateResult } from '@/api-client'
import { useExternalLinks } from '@/composables/app/useExternalLinks'
import type { SelfUpdateState } from '@/self-update-events'

const { openRepo, openIssues, openLicense, openReleaseNotes } = useExternalLinks()

const props = withDefaults(defineProps<{
  open:           boolean
  updateInfo:     UpdateInfo | null
  currentVersion: string
  checking:       boolean
  // In-app self-update lifecycle, owned by the app store. Rendered inside
  // the "available" branch only when updateInfo.can_self_update is true.
  // Optional so prop-driven unit tests that don't exercise self-update can
  // omit it; the store always supplies the live state in production.
  selfUpdate?:    SelfUpdateState
}>(), {
  selfUpdate: () => ({ phase: 'idle', pct: null, error: '' }),
})

const emit = defineEmits<{
  close:   []
  applied: [DataUpdateResult]
  install: []
  restart: []
}>()

// Whether this install can swap its own binary (updateInfo.can_self_update).
const canSelfUpdate = computed(() => props.updateInfo?.can_self_update === true)

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
  if (info.value?.url) openReleaseNotes(info.value.url)
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

              <!-- In-app self-update — only when this install can swap its
                   own binary (Windows/Linux, writable, non-dev). Otherwise
                   the release-page link below is the only path. -->
              <SelfUpdateCta
                v-if="info.available && canSelfUpdate"
                :state="selfUpdate"
                @install="emit('install')"
                @restart="emit('restart')"
              />

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
              <button type="button" class="about-link" data-about-github @click="openRepo">
                Source on GitHub ↗
              </button>
              <button type="button" class="about-link" data-about-license @click="openLicense">
                Apache-2.0 license ↗
              </button>
              <button type="button" class="about-link" data-about-issues @click="openIssues">
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

<style scoped src="./about-modal.css"></style>
