<script setup lang="ts">
import { useProfileSwitcher } from '@/composables/shared/useProfileSwitcher'

// Masthead chip + dropdown for the multi-profile feature. Behaviour (the
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
      class="profile-menu"
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
            class="profile-item"
            :class="{ active: p === active }"
            role="menuitem"
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
              maxlength="40"
              :aria-label="`New name for profile ${p}`"
              @keydown.escape.stop="cancelRename"
            >
            <button
              type="submit"
              class="profile-rename-confirm"
              :disabled="busy || !renameValueValid || renameUnchanged"
              :title="renameUnchanged ? 'Type a new name first' : 'Save rename'"
            >
              {{ busy ? '…' : 'Save' }}
            </button>
            <button
              type="button"
              class="profile-rename-cancel"
              :disabled="busy"
              @click="cancelRename"
            >
              Cancel
            </button>
          </form>
        </template>
      </div>

      <div class="profile-menu-sep" aria-hidden="true" />

      <template v-if="!creating">
        <button
          type="button"
          class="profile-item profile-new-trigger"
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
            maxlength="40"
            placeholder="profile name"
            aria-label="New profile name"
            @keydown.escape.stop="cancelCreate"
          >
          <button
            type="submit"
            class="profile-new-confirm"
            :disabled="!newNameValid || busy"
          >
            {{ busy ? '…' : 'Create' }}
          </button>
          <button
            type="button"
            class="profile-new-cancel"
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
  gap: 0.4rem;
  padding: 0.32rem 0.65rem 0.3rem;
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text);
  cursor: pointer;
  font-weight: 700;
  line-height: 1;
  transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
}

.profile-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.profile-switcher.open .profile-chip {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
  color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
}

.profile-glyph {
  font-size: 0.7rem;
  line-height: 1;
  color: var(--accent);
}

.profile-name {
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-chev {
  font-size: 0.85rem;
  color: var(--text-dim);
  transition: transform 120ms ease;
  transform-origin: center;
}

.profile-switcher.open .profile-chev {
  transform: rotate(180deg);
  color: var(--accent);
}

.profile-menu {
  position: absolute;
  top: calc(100% + 0.35rem);
  right: 0;
  z-index: 50;
  min-width: 14rem;
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

.profile-item {
  appearance: none;
  display: grid;
  grid-template-columns: 1.1rem 1fr;
  gap: 0.5rem;
  align-items: center;
  width: 100%;
  padding: 0.4rem 0.55rem;
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

.profile-item:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
}

.profile-item.active {
  color: var(--accent);
}

.profile-item:disabled {
  opacity: 0.6;
  cursor: progress;
}

.profile-item-tick {
  font-size: 0.85rem;
  color: var(--accent);
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

.profile-menu-sep {
  height: 1px;
  background: color-mix(in srgb, var(--border) 70%, transparent);
  margin: 0.2rem 0;
}

.profile-new-form {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 0.3rem;
  align-items: center;
  padding: 0.35rem;
}

.profile-new-input {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: 2px;
  padding: 0.32rem 0.4rem;
  font-family: var(--mono);
  font-size: 0.7rem;
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

.profile-new-confirm,
.profile-new-cancel {
  appearance: none;
  border-radius: 2px;
  padding: 0.32rem 0.55rem;
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  cursor: pointer;
  line-height: 1;
}

.profile-new-confirm {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--primary-text-on-accent, #111);
}

.profile-new-confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.profile-new-cancel {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
}

.profile-new-cancel:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text);
}

.profile-new-hint {
  margin: 0 0.5rem 0.2rem;
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.1em;
  color: var(--text-faint);
  line-height: 1.3;
}

.profile-item-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0.2rem;
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
  font-size: 0.78rem;
  line-height: 1;
  padding: 0.3rem 0.4rem;
  border-radius: 2px;
  opacity: 0;
  transition: opacity 100ms ease, color 100ms ease, background 100ms ease;
}

.profile-item-row:hover .profile-rename-trigger,
.profile-rename-trigger:focus-visible {
  opacity: 1;
}

.profile-rename-trigger:hover {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.profile-rename-form {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 0.3rem;
  align-items: center;
  padding: 0.25rem;
}

.profile-rename-input {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: 2px;
  padding: 0.32rem 0.4rem;
  font-family: var(--mono);
  font-size: 0.7rem;
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

.profile-rename-confirm,
.profile-rename-cancel {
  appearance: none;
  border-radius: 2px;
  padding: 0.32rem 0.55rem;
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  cursor: pointer;
  line-height: 1;
}

.profile-rename-confirm {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--primary-text-on-accent, #111);
}

.profile-rename-confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.profile-rename-cancel {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
}

.profile-rename-cancel:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text);
}

.profile-error {
  margin: 0.35rem 0.5rem 0.1rem;
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.06em;
  color: var(--loss);
  overflow-wrap: anywhere;
}
</style>
