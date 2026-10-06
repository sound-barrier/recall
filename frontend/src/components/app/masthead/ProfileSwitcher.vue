<script setup lang="ts">
import { useProfileSwitcher } from '@/composables/profile/useProfileSwitcher'

// Masthead chip + dropdown for the multi-profile feature. Behavior (the
// profile list + open/create/rename state + switch/create/rename actions)
// lives in useProfileSwitcher; this SFC is the chip + dropdown markup.
const {
  profiles,
  active,
  open,
  creating,
  newName,
  error,
  busy,
  dropdownEl,
  triggerEl,
  inputEl,
  newNameValid,
  toggleOpen,
  pickProfile,
  beginCreate,
  confirmCreate,
  cancelCreate,
  renameTarget,
  renameValue,
  renameValueValid,
  renameUnchanged,
  beginRename,
  cancelRename,
  confirmRename,
} = useProfileSwitcher()

</script>

<template>
  <div class="profile-switcher" :class="{ open }">
    <button
      ref="triggerEl"
      type="button"
      class="profile-chip"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="menu"
      :title="`Active profile: ${active}`"
      @click="toggleOpen"
    >
      <span class="profile-glyph" aria-hidden="true">◉</span>
      <span class="profile-name">{{ active || '—' }}</span>
      <span class="profile-chev" aria-hidden="true">▾</span>
    </button>

    <div
      v-if="open"
      ref="dropdownEl"
      class="menu-panel profile-menu"
      role="menu"
    >
      <div
        v-for="p in profiles"
        :key="p"
        class="profile-item-row"
        :class="{ active: p === active, renaming: renameTarget === p }"
      >
        <template v-if="renameTarget !== p">
          <button
            type="button"
            class="menu-item menu-caps profile-item"
            :class="{ active: p === active }"
            role="menuitem"
            :aria-current="p === active || undefined"
            :disabled="busy"
            @click="pickProfile(p)"
          >
            <span class="profile-item-tick" aria-hidden="true">{{ p === active ? '✓' : '' }}</span>
            <span class="profile-item-name">{{ p }}</span>
          </button>
          <button
            type="button"
            class="profile-rename-trigger"
            :title="`Rename ${p}`"
            :aria-label="`Rename profile ${p}`"
            :disabled="busy"
            @click.stop="beginRename(p)"
          >
            <span aria-hidden="true">✎</span>
          </button>
        </template>
        <template v-else>
          <form class="profile-rename-form" @submit.prevent="confirmRename">
            <input
              v-model="renameValue"
              class="profile-rename-input"
              type="text"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              maxlength="40"
              :aria-label="`New name for profile ${p}`"
              @keydown.escape.stop="cancelRename"
            >
            <button
              type="submit"
              class="btn-mono is-primary"
              :disabled="busy || !renameValueValid || renameUnchanged"
              :title="renameUnchanged ? 'Type a new name first' : 'Save rename'"
            >
              {{ busy ? '…' : 'Save' }}
            </button>
            <button
              type="button"
              class="btn-mono"
              :disabled="busy"
              @click="cancelRename"
            >
              Cancel
            </button>
          </form>
        </template>
      </div>

      <div class="menu-sep" aria-hidden="true" />

      <template v-if="!creating">
        <button
          type="button"
          class="menu-item menu-caps profile-item profile-new-trigger"
          role="menuitem"
          :disabled="busy"
          @click="beginCreate"
        >
          <span class="profile-item-tick" aria-hidden="true">+</span>
          <span class="profile-item-name">New profile…</span>
        </button>
      </template>
      <template v-else>
        <form class="profile-new-form" @submit.prevent="confirmCreate">
          <input
            ref="inputEl"
            v-model="newName"
            class="profile-new-input"
            type="text"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            maxlength="40"
            placeholder="profile name"
            aria-label="New profile name"
            @keydown.escape.stop="cancelCreate"
          >
          <button
            type="submit"
            class="btn-mono is-primary profile-new-confirm"
            :disabled="!newNameValid || busy"
          >
            {{ busy ? '…' : 'Create' }}
          </button>
          <button
            type="button"
            class="btn-mono"
            :disabled="busy"
            @click="cancelCreate"
          >
            Cancel
          </button>
        </form>
        <p v-if="newName && !newNameValid" class="profile-new-hint">
          a–z, 0–9, _ or -, 1–40 chars, start alphanumeric
        </p>
      </template>

      <p v-if="error" class="profile-error">
        {{ error }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.profile-switcher {
  position: relative;
  display: inline-flex;
}

.profile-chip {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3) var(--space-1);
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: var(--radius);
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text);
  cursor: pointer;
  font-weight: 700;
  line-height: 1;
  transition: border-color var(--duration-instant) ease, color var(--duration-instant) ease, background var(--duration-instant) ease;
}

.profile-chip:hover {
  border-color: var(--accent);
  color: var(--accent-text);
}

.profile-switcher.open .profile-chip {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
  color: var(--accent-text);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
}

.profile-glyph {
  font-size: var(--type-sm);
  line-height: 1;
  color: var(--accent-text);
}

.profile-name {
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-readonly {
  font-size: var(--type-sm);
  line-height: 1;
}

.profile-chev {
  font-size: var(--type-lg);
  color: var(--text-dim);
  transition: transform var(--duration-instant) ease;
  transform-origin: center;
}

.profile-switcher.open .profile-chev {
  transform: rotate(180deg);
  color: var(--accent-text);
}

.profile-menu {
  position: absolute;
  top: calc(100% + var(--space-1));
  right: 0;
  z-index: 50;
  min-width: 14rem;
}

.profile-item {
  display: grid;
  grid-template-columns: 1.1rem 1fr;
}

.profile-item.active {
  color: var(--accent-text);
}

.profile-item:disabled {
  opacity: 0.6;
  cursor: progress;
}

.profile-item-tick {
  font-size: var(--type-lg);
  color: var(--accent-text);
  text-align: center;
  line-height: 1;
}

.profile-item-name {
  text-align: left;
  font-style: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-new-form {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--space-1);
  align-items: center;
  padding: var(--space-1);
}

.profile-new-input {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: var(--radius);
  padding: var(--space-1) var(--space-2);
  font-family: var(--mono);
  font-size: var(--type-sm);
  color: var(--text);
  letter-spacing: 0.04em;
  text-transform: lowercase;
  line-height: 1;
  width: 100%;
}

.profile-new-input:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.profile-new-hint {
  margin: 0 var(--space-2) var(--space-1);
  font-family: var(--mono);
  font-size: var(--type-3xs);
  letter-spacing: 0.1em;
  color: var(--text-faint);
  line-height: 1.3;
}

.profile-item-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--space-1);
}

.profile-item-row.renaming {
  grid-template-columns: 1fr;
}

.profile-rename-trigger {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  font-size: var(--type-md);
  line-height: 1;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius);
  opacity: 0;
  transition: opacity var(--duration-instant) ease, color var(--duration-instant) ease, background var(--duration-instant) ease;
}

.profile-item-row:hover .profile-rename-trigger,
.profile-rename-trigger:focus-visible {
  opacity: 1;
}

.profile-rename-trigger:hover {
  color: var(--accent-text);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.profile-rename-form {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--space-1);
  align-items: center;
  padding: var(--space-1);
}

.profile-rename-input {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: var(--radius);
  padding: var(--space-1) var(--space-2);
  font-family: var(--mono);
  font-size: var(--type-sm);
  color: var(--text);
  letter-spacing: 0.04em;
  line-height: 1;
  width: 100%;
}

.profile-rename-input:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.profile-error {
  margin: var(--space-1) var(--space-2) var(--space-0-5);
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.06em;
  color: var(--loss);
  overflow-wrap: anywhere;
}
</style>
