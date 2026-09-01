<script setup lang="ts">
import { computed, ref } from 'vue'

import { useRosterQuery, saveRosterMember, removeRosterMember } from '@/queries/roster'
import { useWriteGate } from '@/composables/shared/useWriteGate'

// The saved roster — the BattleTags you queue with, and the names you call
// those people.
//
// It is a LOOKUP, not a foreign key: a teammate tagged on a match before they
// were rostered keeps working, and removing somebody here leaves every match
// they played on untouched. That is why the copy says "stop showing a name"
// rather than "delete".
const { data: roster } = useRosterQuery()
const { writesLocked, lockReason, lockedTitle } = useWriteGate()

const members = computed(() => roster.value ?? [])

const tagDraft = ref('')
const nameDraft = ref('')
const noteDraft = ref('')
const busy = ref(false)
const error = ref('')

const canSave = computed(() => tagDraft.value.trim().length > 0 && !writesLocked.value && !busy.value)

async function add() {
  if (!canSave.value) return
  busy.value = true
  error.value = ''
  try {
    await saveRosterMember(tagDraft.value.trim(), nameDraft.value.trim(), noteDraft.value.trim())
    tagDraft.value = ''
    nameDraft.value = ''
    noteDraft.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function remove(tag: string) {
  busy.value = true
  error.value = ''
  try {
    await removeRosterMember(tag)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div id="sec-roster" class="settings-section">
    <div class="section-header">
      <span class="section-num">09</span>
      <span class="section-slash" aria-hidden="true">/</span>
      <h3 class="section-title">
        Roster
      </h3>
    </div>
    <div class="setting-rows">
      <div class="setting-row">
        <div class="setting-info">
          <h4 class="setting-label">
            People you queue with
          </h4>
          <p class="setting-desc">
            A BattleTag you save here shows up as the name you gave it wherever
            you tagged that person, and completes as you type in a match's Group
            field. Removing somebody stops showing their name — the matches they
            played on keep the tag.
          </p>
        </div>
        <div class="setting-control roster-control">
          <form class="roster-add" @submit.prevent="add">
            <label class="roster-field">
              <span class="eyebrow">BattleTag</span>
              <input
                v-model="tagDraft"
                class="setting-input mono"
                placeholder="Zed#2100"
                spellcheck="false"
                autocomplete="off"
                :disabled="writesLocked"
                :title="lockReason || undefined"
              >
            </label>
            <label class="roster-field">
              <span class="eyebrow">Name</span>
              <input
                v-model="nameDraft"
                class="setting-input"
                placeholder="Zed"
                :disabled="writesLocked"
                :title="lockReason || undefined"
              >
            </label>
            <label class="roster-field roster-field-wide">
              <span class="eyebrow">Note</span>
              <input
                v-model="noteDraft"
                class="setting-input"
                placeholder="main tank, Tuesdays"
                :disabled="writesLocked"
                :title="lockReason || undefined"
              >
            </label>
            <button
              type="submit"
              class="btn primary"
              :disabled="!canSave"
              :title="lockedTitle('Save this teammate')"
            >
              Save
            </button>
          </form>

          <p v-if="error" class="setting-desc roster-error" role="alert">
            {{ error }}
          </p>

          <p v-if="members.length === 0" class="setting-desc roster-empty">
            Nobody saved yet. Add the people you play with and their tags will
            read as names.
          </p>
          <ul v-else class="roster-list">
            <li v-for="m in members" :key="m.tag" class="roster-row">
              <span class="roster-name">{{ m.display_name }}</span>
              <span class="roster-tag mono">{{ m.tag }}</span>
              <span v-if="m.note" class="roster-note">{{ m.note }}</span>
              <button
                type="button"
                class="btn ghost roster-remove"
                :disabled="writesLocked || busy"
                :title="lockedTitle(`Stop showing a name for ${m.tag}`)"
                :aria-label="`Remove ${m.display_name} from the roster`"
                @click="remove(m.tag)"
              >
                Remove
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="./SettingsRoster.css"></style>
