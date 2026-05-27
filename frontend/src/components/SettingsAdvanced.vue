<script setup lang="ts">
// Advanced collapsible at the bottom of Settings — Grafana streaming
// toggle + destructive Clear Database flow. Native <details> gives
// free keyboard support; the styled <summary> mirrors a section
// header for visual continuity.
//
// Extracted from SettingsView so the section-specific styles
// (.advanced-*, .big-switch) live with the component that owns the
// markup. The destructive-row styles (`.setting-row.danger-row` +
// `.clear-confirm-group`) stay in SettingsView because they're
// shared with the Backup/Restore section's Import-arm flow.

defineProps<{
  prometheusEnabled: boolean
  clearingDB?: boolean
  clearConfirm?: boolean
  matchedCount?: number
  unknownCount?: number
}>()

const emit = defineEmits<{
  'toggle-prometheus': []
  'arm-clear':         []
  'cancel-clear':      []
  'clear-database':    []
}>()
</script>

<template>
  <details id="sec-advanced" class="settings-section advanced-section">
    <summary class="advanced-summary">
      <span class="section-num">06</span>
      <span class="section-slash" aria-hidden="true">/</span>
      <span class="section-title">Advanced</span>
      <span class="advanced-chev" aria-hidden="true">›</span>
    </summary>
    <div class="setting-rows advanced-rows">
      <div class="setting-row">
        <div class="setting-info">
          <h4 class="setting-label">
            Stream to Grafana
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About Grafana streaming</span>
              <span class="setting-help-pop" role="tooltip">
                Exposes Prometheus metrics on <code>localhost:9091/metrics</code> so the bundled Grafana dashboard can chart your trends. Requires the docker-compose stack to be running locally.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            Expose match history on <code>localhost:9091/metrics</code> so the bundled Prometheus container can scrape it. Off by default — no port is opened until you enable this.
          </p>
        </div>
        <div class="setting-control">
          <label class="big-switch" :class="{ on: prometheusEnabled }">
            <input type="checkbox" :checked="prometheusEnabled" @change="emit('toggle-prometheus')">
            <span class="big-switch-track"><span class="big-switch-knob" /></span>
            <span class="big-switch-state">{{ prometheusEnabled ? 'Live' : 'Off' }}</span>
          </label>
        </div>
      </div>

      <div class="setting-row" :class="{ 'danger-row': clearConfirm }">
        <div class="setting-info">
          <h4 class="setting-label">
            Clear Parse Database
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About Clear Database</span>
              <span class="setting-help-pop" role="tooltip">
                Wipes every parsed match. Settings and screenshots stay; you can re-parse to rebuild. Two-step arm/confirm prevents accidental data loss.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            Permanently delete all {{ (matchedCount ?? 0) + (unknownCount ?? 0) }} parsed match record{{ ((matchedCount ?? 0) + (unknownCount ?? 0)) === 1 ? '' : 's' }} from the local database. Settings and screenshots are untouched — you can re-parse at any time to rebuild from scratch.
          </p>
          <p v-if="clearConfirm" class="setting-meta blocked">
            <span class="block-mark" aria-hidden="true">⚠</span>
            This cannot be undone.
          </p>
        </div>
        <div class="setting-control">
          <template v-if="!clearConfirm">
            <button
              class="btn danger-outline"
              :disabled="clearingDB || ((matchedCount ?? 0) + (unknownCount ?? 0)) === 0"
              @click="emit('arm-clear')"
            >
              Clear Database…
            </button>
          </template>
          <template v-else>
            <div class="clear-confirm-group">
              <button
                class="btn danger"
                :disabled="clearingDB"
                @click="emit('clear-database')"
              >
                <span v-if="clearingDB">Deleting…</span>
                <span v-else>Delete {{ (matchedCount ?? 0) + (unknownCount ?? 0) }} Record{{ ((matchedCount ?? 0) + (unknownCount ?? 0)) === 1 ? '' : 's' }}</span>
              </button>
              <button class="btn ghost" :disabled="clearingDB" @click="emit('cancel-clear')">
                Cancel
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </details>
</template>

<style scoped>
.advanced-section {
  margin-top: 2.6rem;
}

/* Strip native disclosure triangle — replaced by our own ›. */
.advanced-section > summary {
  list-style: none;
}

.advanced-section > summary::-webkit-details-marker {
  display: none;
}

.advanced-summary {
  display: flex;
  align-items: baseline;
  gap: 0.7rem;
  padding-bottom: 0.85rem;
  margin-bottom: 0.4rem;
  border-bottom: 1px solid var(--brand-gray);
  cursor: pointer;
  position: relative;
  user-select: none;
  transition: border-color 160ms ease;
}

.advanced-summary:hover {
  border-color: var(--border-strong);
}

.advanced-summary:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 2px 0 var(--accent);
}

.advanced-summary::after {
  /* Same orange tick as `.section-header` — visual continuity. The
     light-mode override (rust + no glow) lives in app.css as a
     properly-scoped global rule. */
  content: '';
  position: absolute;
  right: 0;
  bottom: -1px;
  width: 28px;
  height: 3px;
  background: var(--accent);
  box-shadow: 0 0 12px var(--accent-glow);
}

.advanced-summary .section-num,
.advanced-summary .section-title {
  /* Reuse the global section-header typography directly. */
  transform: translateY(2px);
}

.advanced-chev {
  margin-left: auto;
  font-family: var(--display);
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--text-faint);
  line-height: 1;
  transition: transform 200ms ease, color 200ms ease;
}

.advanced-section[open] .advanced-chev {
  transform: rotate(90deg);
  color: var(--accent);
}

.advanced-rows {
  /* Subtle fade-in when the user expands. Reduced-motion clobbers it
     via the @media block at the bottom of SettingsView's \3c style>. */
  animation: advanced-reveal 240ms ease;
}

@keyframes advanced-reveal {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ─── Big-switch (Grafana toggle) ────────────────────────── */

.big-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.85rem;
  cursor: pointer;
  user-select: none;
}

.big-switch input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.big-switch-track {
  position: relative;
  width: 56px;
  height: 30px;
  background: var(--surface-3);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  transition: background 240ms ease, border-color 240ms ease, box-shadow 240ms ease;
}

.big-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 24px;
  height: 24px;
  background: var(--text-faint);
  border-radius: 50%;
  transition:
    transform 260ms cubic-bezier(0.4, 0, 0.2, 1),
    background 240ms ease,
    box-shadow 240ms ease;
}

.big-switch.on .big-switch-track {
  background: var(--accent-soft);
  border-color: var(--accent);
  box-shadow: 0 0 18px -2px var(--accent-glow);
}

.big-switch.on .big-switch-track .big-switch-knob {
  background: var(--accent);
  box-shadow: 0 0 14px var(--accent-glow);
  transform: translateX(26px);
}

.big-switch-state {
  min-width: 3.6rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--text-faint);
  transition: color 220ms ease;
}

.big-switch.on .big-switch-state {
  color: var(--accent);
}

.big-switch:focus-within .big-switch-track {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-soft), 0 0 18px -2px var(--accent-glow);
}
</style>
