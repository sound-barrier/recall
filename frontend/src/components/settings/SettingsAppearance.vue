<script setup lang="ts">
import type { ThemeMode } from '@/composables/useTheme'

// Appearance panel of the Settings view — four theme swatches.
// Each preview card is a miniature of the theme's palette; clicking
// emits set-theme with the picked mode. Inactive swatches dim slightly
// so the active pick reads at a glance.
//
// Order: Day, Dark, Night, High contrast.
//
// Extracted from SettingsView so the swatch markup + the per-card
// CSS-variable palettes (day-swatch / dark-swatch / night-swatch /
// contrast-swatch) live with the component that owns the surface.

defineProps<{
  themeMode: ThemeMode
}>()

const emit = defineEmits<{
  'set-theme': [mode: ThemeMode]
}>()

function pick(mode: ThemeMode) {
  emit('set-theme', mode)
}
</script>

<template>
  <div id="sec-appearance" class="settings-section">
    <div class="section-header">
      <span class="section-num">03</span>
      <span class="section-slash" aria-hidden="true">/</span>
      <h3 class="section-title">
        Appearance
      </h3>
    </div>
    <div class="setting-rows">
      <div class="setting-row appearance-row">
        <div class="setting-info">
          <h4 class="setting-label">
            Theme
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About Theme</span>
              <span class="setting-help-pop" role="tooltip">
                Day grounds on Overwatch white (the cream from the post-match summary screen).
                Dark grounds on the OW brand gray #4A4A4A (the in-game scoreboard plate) with
                surfaces stepping up in luminance. Night is the editorial photographer's-darkroom
                palette — deep blue-charcoal with bright-orange highlights. High contrast is the
                tournament-booth / low-vision variant — pure black ground, white text, boosted
                gold accent. First-launch defaults to your OS light/dark preference (Day or
                Night); your pick after that survives reinstalls.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            Pick a preview to apply; the choice persists across launches and reinstalls.
            Fresh installs follow your OS light/dark preference.
          </p>
        </div>
        <div class="setting-control">
          <div class="theme-swatch-row" role="radiogroup" aria-label="Theme">
            <button
              type="button"
              class="theme-swatch day-swatch"
              role="radio"
              :aria-checked="themeMode === 'day'"
              :class="{ active: themeMode === 'day' }"
              @click="pick('day')"
            >
              <div class="swatch-preview" aria-hidden="true">
                <div class="swatch-mast" />
                <div class="swatch-body">
                  <div class="swatch-line w-70" />
                  <div class="swatch-line w-45" />
                  <div class="swatch-line w-60" />
                  <div class="swatch-tick" />
                </div>
              </div>
              <div class="swatch-label">
                <svg viewBox="0 0 24 24" class="swatch-icon" aria-hidden="true">
                  <!-- Sun with rays — the classic Day glyph; reads
                       at small sizes without relying on detail. -->
                  <circle cx="12" cy="12" r="4" fill="currentColor" />
                  <g stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
                    <line x1="12" y1="2" x2="12" y2="5" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                    <line x1="2" y1="12" x2="5" y2="12" />
                    <line x1="19" y1="12" x2="22" y2="12" />
                    <line x1="4.6" y1="4.6" x2="6.7" y2="6.7" />
                    <line x1="17.3" y1="17.3" x2="19.4" y2="19.4" />
                    <line x1="4.6" y1="19.4" x2="6.7" y2="17.3" />
                    <line x1="17.3" y1="6.7" x2="19.4" y2="4.6" />
                  </g>
                </svg>
                Day
              </div>
            </button>
            <button
              type="button"
              class="theme-swatch dark-swatch"
              role="radio"
              :aria-checked="themeMode === 'dark'"
              :class="{ active: themeMode === 'dark' }"
              @click="pick('dark')"
            >
              <div class="swatch-preview" aria-hidden="true">
                <div class="swatch-mast" />
                <div class="swatch-body">
                  <div class="swatch-line w-70" />
                  <div class="swatch-line w-45" />
                  <div class="swatch-line w-60" />
                  <div class="swatch-tick" />
                </div>
              </div>
              <div class="swatch-label">
                <svg viewBox="0 0 24 24" class="swatch-icon" aria-hidden="true">
                  <!-- Crescent over a bar — the "OW plate" reading,
                       distinct from Night's bare crescent so the two
                       darks read at a glance. -->
                  <path d="M21 12.8A8.5 8.5 0 0 1 11.2 3a7 7 0 1 0 9.8 9.8z" fill="currentColor" />
                  <rect x="3" y="20" width="18" height="1.6" fill="currentColor" />
                </svg>
                Dark
              </div>
            </button>
            <button
              type="button"
              class="theme-swatch night-swatch"
              role="radio"
              :aria-checked="themeMode === 'night'"
              :class="{ active: themeMode === 'night' }"
              @click="pick('night')"
            >
              <div class="swatch-preview" aria-hidden="true">
                <div class="swatch-mast" />
                <div class="swatch-body">
                  <div class="swatch-line w-70" />
                  <div class="swatch-line w-45" />
                  <div class="swatch-line w-60" />
                  <div class="swatch-tick" />
                </div>
              </div>
              <div class="swatch-label">
                <svg viewBox="0 0 24 24" class="swatch-icon" aria-hidden="true">
                  <!-- Bare crescent moon — the deep-night counterpart
                       to Day's sun. Distinct from Dark's
                       crescent-on-plate so the two darks read at a
                       glance. -->
                  <path d="M21 12.8A8.5 8.5 0 0 1 11.2 3a7 7 0 1 0 9.8 9.8z" fill="currentColor" />
                </svg>
                Night
              </div>
            </button>
            <button
              type="button"
              class="theme-swatch contrast-swatch"
              role="radio"
              :aria-checked="themeMode === 'high-contrast'"
              :class="{ active: themeMode === 'high-contrast' }"
              @click="pick('high-contrast')"
            >
              <div class="swatch-preview" aria-hidden="true">
                <div class="swatch-mast" />
                <div class="swatch-body">
                  <div class="swatch-line w-70" />
                  <div class="swatch-line w-45" />
                  <div class="swatch-line w-60" />
                  <div class="swatch-tick" />
                </div>
              </div>
              <div class="swatch-label">
                <svg viewBox="0 0 24 24" class="swatch-icon" aria-hidden="true">
                  <!-- Half-filled circle — the canonical "contrast"
                       glyph (top half filled with currentColor; bottom
                       half outlined). Reads at small sizes without
                       relying on detail. -->
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7" />
                  <path d="M12 3 A9 9 0 0 1 12 21 Z" fill="currentColor" />
                </svg>
                High contrast
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Four preview cards showing a miniature of each theme's palette.
   Active card gets the accent ring + glow. Each card sets its own
   CSS variables inline (via the .day-swatch / .dark-swatch /
   .night-swatch / .contrast-swatch class) so all four render their
   own palette regardless of the document's [data-theme]. */

.theme-swatch-row {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.7rem;
}

.theme-swatch {
  appearance: none;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.55rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  cursor: pointer;
  text-align: left;
  transition: border-color 160ms ease, box-shadow 200ms ease, transform 140ms ease;
  font: inherit;
  color: var(--text-dim);
}

.theme-swatch:hover:not(.active) {
  border-color: var(--border-strong);
  transform: translateY(-1px);
}

.theme-swatch:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.theme-swatch.active {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px var(--accent),
    0 6px 24px -12px var(--accent-glow);
  color: var(--accent);
}

.swatch-preview {
  position: relative;
  width: 132px;
  height: 78px;
  border-radius: 1px;
  overflow: hidden;
  background: var(--swatch-bg);
  border: 1px solid var(--swatch-border);
}

.swatch-mast {
  height: 11px;
  background: var(--swatch-mast);
  border-bottom: 1px solid var(--swatch-border);
}

.swatch-body {
  position: relative;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.swatch-line {
  height: 5px;
  border-radius: 1px;
  background: var(--swatch-text);
  opacity: 0.7;
}

.swatch-line.w-70 { width: 70%; }
.swatch-line.w-45 { width: 45%; }
.swatch-line.w-60 { width: 60%; }

.swatch-tick {
  position: absolute;
  right: 9px;
  bottom: 8px;
  width: 14px;
  height: 3px;
  background: var(--swatch-accent);
  box-shadow: 0 0 8px var(--swatch-accent);
}

.swatch-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: var(--mono);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.swatch-icon {
  width: 13px;
  height: 13px;
  display: block;
}

/* Day swatch — Overwatch white background, brand-gray border (the
   in-game scoreboard plate read), pure OW orange accent. The mast
   strip stays close to the bg so the preview reads as "single
   ground" with a darker plate ring around it. */
.day-swatch {
  --swatch-bg:     #efede6;
  --swatch-mast:   #e3e0d6;
  --swatch-border: #4a4a4a;
  --swatch-text:   #1a1a1a;
  --swatch-accent: #fa9c1b;
}

/* Dark swatch — OW brand-gray background (#4A4A4A, the live plate
   gray), borders tinted with the OW orange so the preview reads as
   "game UI structural" rather than "muted dashboard." Mast bumps
   slightly darker to mark it as a heading bar. */
.dark-swatch {
  --swatch-bg:     #4a4a4a;
  --swatch-mast:   #3a3a3a;
  --swatch-border: #fa9c1b;
  --swatch-text:   #f0f0f0;
  --swatch-accent: #fa9c1b;
}

/* The Dark tick rides on a mid-gray ground; lift the glow a touch
   so the orange bar still pops. */
.dark-swatch .swatch-tick {
  box-shadow: 0 0 10px var(--swatch-accent);
}

/* Night swatch (frozen — matches the editorial photographer's-
   darkroom :root palette in app.css; if those tokens drift, refresh
   these). Deep blue-charcoal bg with bright orange. */
.night-swatch {
  --swatch-bg:     #15161a;
  --swatch-mast:   #1d1f24;
  --swatch-border: #2a2d33;
  --swatch-text:   #d8d9de;
  --swatch-accent: #ff7a3a;
}

/* Contrast swatch (frozen — matches the live high-contrast theme:
   pure black surfaces, white text, boosted gold accent. The mast is
   a touch above pure black so the strip reads as a divider in the
   miniature). */
.contrast-swatch {
  --swatch-bg:     #000;
  --swatch-mast:   #0e0e0e;
  --swatch-border: #fff;
  --swatch-text:   #fff;
  --swatch-accent: #fa3;
}

/* The contrast swatch's brighter accent benefits from a slightly
   thicker tick — the bar's glow gets clipped against pure black if
   the bar itself is too thin. */
.contrast-swatch .swatch-tick {
  height: 4px;
  box-shadow: 0 0 10px var(--swatch-accent);
}
</style>
