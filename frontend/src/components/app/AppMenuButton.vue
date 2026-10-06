<script setup lang="ts">
// The masthead ⋮ application menu (Windows / Linux / browser — macOS uses the
// native menu bar). Behavior + the macOS-Wails gate live in useAppMenu; this
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
      class="menu-panel app-menu-dropdown"
      role="menu"
      aria-label="Application menu"
    >
      <button type="button" class="menu-item menu-caps app-menu-item" role="menuitem" data-app-menu-about @click="openAbout">
        About Recall
      </button>
      <button type="button" class="menu-item menu-caps app-menu-item" role="menuitem" data-app-menu-settings @click="openSettings">
        Settings…
      </button>
      <button type="button" class="menu-item menu-caps app-menu-item" role="menuitem" data-app-menu-shortcuts @click="openShortcuts">
        Keyboard shortcuts
      </button>
      <div class="menu-sep" aria-hidden="true" />
      <button type="button" class="menu-item menu-caps app-menu-item" role="menuitem" data-app-menu-docs @click="openDocs">
        Documentation <span class="app-menu-ext" aria-hidden="true">↗</span>
      </button>
      <button type="button" class="menu-item menu-caps app-menu-item" role="menuitem" data-app-menu-issues @click="openIssues">
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
  border-radius: var(--radius);
  font-size: var(--type-2xl);
  line-height: 1;
  color: var(--text);
  cursor: pointer;
  transition: border-color var(--duration-instant) ease, color var(--duration-instant) ease, background var(--duration-instant) ease;
}

.app-menu-trigger:hover {
  border-color: var(--accent);
  color: var(--accent-text);
}

.app-menu.open .app-menu-trigger {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
  color: var(--accent-text);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
}

.app-menu-dropdown {
  position: absolute;
  top: calc(100% + var(--space-1));
  right: 0;
  z-index: 50;
  min-width: 13rem;
}

.app-menu-ext {
  color: var(--text-faint);
  font-size: var(--type-sm);
}

.app-menu-item:hover .app-menu-ext {
  color: var(--accent-text);
}

</style>
