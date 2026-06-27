<script setup lang="ts">
// The masthead ⋮ application menu (Windows / Linux / browser — macOS uses the
// native menu bar). Behaviour + the macOS-Wails gate live in useAppMenu; this
// SFC is the trigger + dropdown markup, mirroring ProfileSwitcher's pattern.
import { useAppMenu } from '@/composables/app/useAppMenu'

const {
  open,
  triggerEl,
  menuEl,
  showMenu,
  toggle,
  openAbout,
  openSettings,
  openShortcuts,
  openDocs,
  openIssues,
} = useAppMenu()
</script>

<template>
  <div v-if="showMenu" class="app-menu" :class="{ open }">
    <button
      ref="triggerEl"
      type="button"
      class="app-menu-trigger"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="menu"
      aria-label="Application menu"
      title="Menu"
      @click="toggle"
    >
      <span aria-hidden="true">⋮</span>
    </button>

    <div
      v-if="open"
      ref="menuEl"
      class="app-menu-dropdown"
      role="menu"
      aria-label="Application menu"
    >
      <button type="button" class="app-menu-item" role="menuitem" data-app-menu-about @click="openAbout">
        About Recall
      </button>
      <button type="button" class="app-menu-item" role="menuitem" data-app-menu-settings @click="openSettings">
        Settings…
      </button>
      <button type="button" class="app-menu-item" role="menuitem" data-app-menu-shortcuts @click="openShortcuts">
        Keyboard shortcuts
      </button>
      <div class="app-menu-sep" aria-hidden="true" />
      <button type="button" class="app-menu-item" role="menuitem" data-app-menu-docs @click="openDocs">
        Documentation <span class="app-menu-ext" aria-hidden="true">↗</span>
      </button>
      <button type="button" class="app-menu-item" role="menuitem" data-app-menu-issues @click="openIssues">
        Report an issue <span class="app-menu-ext" aria-hidden="true">↗</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.app-menu {
  position: relative;
  display: inline-flex;
}

.app-menu-trigger {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.7rem;
  height: 1.7rem;
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: 2px;
  font-size: 1rem;
  line-height: 1;
  color: var(--text);
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
}

.app-menu-trigger:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.app-menu.open .app-menu-trigger {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
  color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
}

.app-menu-dropdown {
  position: absolute;
  top: calc(100% + 0.35rem);
  right: 0;
  z-index: 50;
  min-width: 13rem;
  padding: 0.35rem;
  border: 1px solid var(--accent);
  background: var(--surface);
  border-radius: 2px;
  box-shadow:
    0 6px 22px color-mix(in srgb, var(--bg) 55%, transparent),
    0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent);
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.app-menu-item {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.4rem 0.6rem;
  border: 0;
  background: transparent;
  border-radius: 2px;
  cursor: pointer;
  text-align: left;
  font-family: var(--mono);
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text);
  font-weight: 700;
  line-height: 1.1;
}

.app-menu-item:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
}

.app-menu-ext {
  color: var(--text-faint);
  font-size: 0.7rem;
}

.app-menu-item:hover .app-menu-ext {
  color: var(--accent);
}

.app-menu-sep {
  height: 1px;
  background: color-mix(in srgb, var(--border) 70%, transparent);
  margin: 0.2rem 0;
}
</style>
