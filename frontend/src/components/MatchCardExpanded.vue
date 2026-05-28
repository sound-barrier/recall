<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { MatchRecord, MatchAnnotationInput } from '../api'
import {
  screenshotURL,
  detectScreenshotSlots,
  missingRequiredSlots,
  missingOptionalSlots,
  sshotTypeLabel,
  sourceType,
  formatParsedAt,
  highlightSubstrings,
} from '../match-helpers'
import { highlightTermsFor, type SearchClause } from '../search-query'
import { useOWData } from '../composables/useOWData'
import { useHeroesExpanded } from '../composables/useHeroesExpanded'
import MatchCardDanger from './MatchCardDanger.vue'

// Expanded match-card body: leaver chooser → free-text annotation
// (Note / Replay / Group members) → stats grid → rank block →
// heroes-played → sources → danger row. Owns the annotation draft
// state so the user can edit the three text fields without lifting
// every keystroke up to MatchCard.vue.
//
// Extracted from MatchCard.vue so the collapsed-view and the
// expanded-view live in separate SFCs. Mounted only when the user
// clicks the chev to expand — collapsing destroys the component,
// which clears uncommitted drafts (commit on blur is required to
// persist).

const ow = useOWData()

// Global Heroes-Played collapse preference. Persists once the user
// flips it on any card; default expanded preserves the long-standing
// open-by-default behaviour.
const { heroesExpanded, toggleHeroesExpanded } = useHeroesExpanded()

const props = defineProps<{
  record: MatchRecord
  isSourcesOpen: boolean
  previewOpen: Record<string, boolean>
  previewError: Record<string, boolean>
  isActive: (field: string, value: string) => boolean
  // Parsed search clauses from the FilterRail. The expanded note
  // preview renders `<mark>` around every hit whose clause either
  // targets the note field or is unscoped (matches any field).
  // Optional — older mount sites omit it and the preview renders
  // without hits.
  searchClauses?: SearchClause[]
}>()

const emit = defineEmits<{
  'toggle-sources': []
  'toggle-preview': [filename: string]
  'preview-error':  [filename: string]
  'filter-toggle':  [field: string, value: string]
  // User clicks one of the four leaver-chooser buttons. App.vue
  // listens, routes through SetMatchAnnotation with the existing
  // annotation fields preserved, and re-loads records so the new
  // Annotation reflects on the next render.
  'set-leaver-annotation': [matchKey: string, leaver: '' | 'self' | 'team' | 'enemy']
  // User edits the note / replay code / members and confirms the
  // change (debounced or on blur). App.vue calls SetMatchAnnotation
  // which writes the whole row in a single round-trip so the three
  // free-text fields can't drift independently.
  'set-match-annotation':  [matchKey: string, input: MatchAnnotationInput]
  // User pressed Hide (after confirming) or Unhide on the expanded
  // danger row.
  'set-match-hidden':      [matchKey: string, hidden: boolean]
}>()

// Local draft state for the free-text annotation fields. Hydrates
// from props.record.annotation when the card opens or the underlying
// record changes; the user types here and we emit on commit
// (blur for note/replay, Enter for chip-add inputs).
const noteDraft       = ref(props.record.annotation?.note ?? '')
const replayDraft     = ref(props.record.annotation?.replay_code ?? '')
const memberInput     = ref('')
const memberDraft     = ref<string[]>(props.record.annotation?.members ?? [])
const tagInput        = ref('')
const tagDraft        = ref<string[]>(props.record.annotation?.tags ?? [])
// Track which annotation field, if any, just saved so a "saved ✓"
// pulse can render without stomping on the active editor's value.
const savedFlash      = ref<'' | 'note' | 'replay' | 'members' | 'tags'>('')

// The three conventional tags. Order here is presentation order in
// the quick-add row; the user can still add anything via free-form.
const NAMED_TAGS = ['stack', 'stream', 'placement'] as const

watch(
  () => props.record.annotation,
  (next) => {
    noteDraft.value = next?.note ?? ''
    replayDraft.value = next?.replay_code ?? ''
    memberDraft.value = next?.members ?? []
    tagDraft.value = next?.tags ?? []
  },
  { immediate: false },
)

const hasAnyNote = computed(
  () => !!(noteDraft.value.trim() || replayDraft.value.trim() || memberDraft.value.length || tagDraft.value.length),
)

// Top heroes by percent_played for the collapsed Heroes-Played
// summary line. Two is enough to fit on one row alongside the count
// + chev without wrapping on the common card width; the user opens
// the block if they need the long tail.
const topHeroesPlayed = computed(() => {
  const all = props.record.data?.heroes_played ?? []
  return [...all]
    .sort((a, b) => (b.percent_played ?? 0) - (a.percent_played ?? 0))
    .slice(0, 2)
})

// Click-to-edit state for the Note row. The preview is the default
// surface when the note is non-empty: a div renders the note text
// with <mark> around the live FilterRail substring matches. Click
// promotes to the existing textarea editor (focused at the click
// position via the cached caret offset); blur reverts to preview.
//
// An empty note skips the preview swap entirely — the textarea
// stays mounted so the user can type their first character without
// an extra click.
const isEditingNote   = ref(false)
const noteTextareaRef = ref<HTMLTextAreaElement | null>(null)
let pendingCaretPos: number | null = null

const noteHighlightSegments = computed(() =>
  highlightSubstrings(noteDraft.value, highlightTermsFor('note', props.searchClauses ?? [])),
)

// Compute a 0-based offset into `text` from a click DOM position
// (node + offset-inside-node) inside a preview container whose
// children are a flat list of text nodes and <mark> wrappers (each
// containing exactly one text node). Walks descendants in document
// order, summing the lengths of preceding text content until the
// click target is reached. Returns null when the click landed on
// something we can't translate (defensive — falls back to focusing
// the end of the textarea).
function caretOffsetFromClick(
  container: HTMLElement,
  node: Node,
  offsetInNode: number,
): number | null {
  let acc = 0
  let found = false
  const walk = (n: Node): void => {
    if (found) return
    if (n === node) {
      acc += offsetInNode
      found = true
      return
    }
    if (n.nodeType === Node.TEXT_NODE) {
      acc += (n.textContent ?? '').length
      return
    }
    if (!container.contains(n) && n !== container) return
    n.childNodes.forEach(walk)
  }
  walk(container)
  return found ? acc : null
}

function enterEditMode(e: MouseEvent) {
  const container = e.currentTarget as HTMLElement
  // Prefer the standard API; fall back to the WebKit-only name.
  type CaretPositionFromPoint = (x: number, y: number) => { offsetNode: Node, offset: number } | null
  type CaretRangeFromPoint = (x: number, y: number) => Range | null
  type DocWithCaretAPIs = Document & {
    caretPositionFromPoint?: CaretPositionFromPoint
    caretRangeFromPoint?: CaretRangeFromPoint
  }
  const doc: DocWithCaretAPIs = document
  let clickedNode: Node | null = null
  let clickedOffset = 0
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(e.clientX, e.clientY)
    if (pos) { clickedNode = pos.offsetNode; clickedOffset = pos.offset }
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(e.clientX, e.clientY)
    if (range) { clickedNode = range.startContainer; clickedOffset = range.startOffset }
  }
  pendingCaretPos = clickedNode
    ? caretOffsetFromClick(container, clickedNode, clickedOffset)
    : null

  isEditingNote.value = true
  void nextTick(() => {
    const ta = noteTextareaRef.value
    if (!ta) return
    ta.focus()
    const len = ta.value.length
    const pos = pendingCaretPos === null ? len : Math.max(0, Math.min(pendingCaretPos, len))
    ta.setSelectionRange(pos, pos)
    pendingCaretPos = null
  })
}

function exitNoteEditMode() {
  commitAnnotation('note')
  isEditingNote.value = false
}

// Commits the current draft to the parent. Always writes ALL FIVE
// annotation fields so the unified setter doesn't accidentally null
// something the user typed in another input. Leaver is read from the
// existing annotation (the chooser owns that field independently).
function commitAnnotation(field: 'note' | 'replay' | 'members' | 'tags') {
  emit('set-match-annotation', props.record.match_key, {
    leaver:      (props.record.annotation?.leaver ?? '') as MatchAnnotationInput['leaver'],
    note:        noteDraft.value.trim(),
    replay_code: replayDraft.value.trim(),
    members:     memberDraft.value,
    tags:        tagDraft.value,
  })
  savedFlash.value = field
  setTimeout(() => { if (savedFlash.value === field) savedFlash.value = '' }, 900)
}

function addMember() {
  const v = memberInput.value.trim()
  if (!v || memberDraft.value.includes(v)) {
    memberInput.value = ''
    return
  }
  memberDraft.value = [...memberDraft.value, v]
  memberInput.value = ''
  commitAnnotation('members')
}

function removeMember(name: string) {
  memberDraft.value = memberDraft.value.filter(m => m !== name)
  commitAnnotation('members')
}

// Keydown handler for the member input. Enter/comma both commit the
// chip (Vue's v-on doesn't support the `comma` key modifier so we
// have to read e.key by hand). Backspace on an empty input removes
// the last chip — standard tagify-style behaviour.
function onMemberKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    addMember()
    return
  }
  if (e.key === 'Backspace' && memberInput.value === '' && memberDraft.value.length > 0) {
    e.preventDefault()
    removeMember(memberDraft.value[memberDraft.value.length - 1]!)
  }
}

// Tags mirror the members editor pattern (chip list + free-form
// input) but with three quick-add toggles for the conventional tag
// vocabulary. The server lowercases + dedupes on persist; the
// client mirrors so the optimistic UI matches the round-tripped
// state byte-for-byte.
function normalizeTagLabel(t: string): string {
  return t.trim().toLowerCase()
}

function hasTag(t: string): boolean {
  return tagDraft.value.includes(normalizeTagLabel(t))
}

function toggleNamedTag(t: string) {
  const v = normalizeTagLabel(t)
  if (!v) return
  tagDraft.value = hasTag(v)
    ? tagDraft.value.filter(x => x !== v)
    : [...tagDraft.value, v]
  commitAnnotation('tags')
}

function addCustomTag() {
  const v = normalizeTagLabel(tagInput.value)
  if (!v) {
    tagInput.value = ''
    return
  }
  if (!tagDraft.value.includes(v)) {
    tagDraft.value = [...tagDraft.value, v]
    commitAnnotation('tags')
  }
  tagInput.value = ''
}

function removeTag(t: string) {
  tagDraft.value = tagDraft.value.filter(x => x !== t)
  commitAnnotation('tags')
}

function onTagKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    addCustomTag()
    return
  }
  if (e.key === 'Backspace' && tagInput.value === '' && tagDraft.value.length > 0) {
    e.preventDefault()
    removeTag(tagDraft.value[tagDraft.value.length - 1]!)
  }
}
</script>

<template>
  <div class="match-expanded">
    <!-- Leaver annotation chooser. Three scenario buttons + a
         Clear option. Active button gets the accent ring; the
         others are tactical-grey ghosts. Wired bottom-up: this
         component emits set-leaver-annotation, App.vue persists
         via SetMatchAnnotation with the other annotation fields
         preserved. -->
    <div class="leaver-chooser" role="group" aria-label="Leaver annotation">
      <span class="leaver-chooser-label" aria-hidden="true">Leaver?</span>
      <button
        type="button"
        class="leaver-chip"
        :class="{ active: record.annotation?.leaver === 'self' }"
        :aria-pressed="record.annotation?.leaver === 'self'"
        title="Tag this match as: I left the game (data is incomplete)."
        @click="emit('set-leaver-annotation', record.match_key, record.annotation?.leaver === 'self' ? '' : 'self')"
      >
        <span class="leaver-chip-glyph leaver-self" aria-hidden="true">⊘</span>
        I left
      </button>
      <button
        type="button"
        class="leaver-chip"
        :class="{ active: record.annotation?.leaver === 'team' }"
        :aria-pressed="record.annotation?.leaver === 'team'"
        title="Tag this match as: an ally left."
        @click="emit('set-leaver-annotation', record.match_key, record.annotation?.leaver === 'team' ? '' : 'team')"
      >
        <span class="leaver-chip-glyph leaver-team" aria-hidden="true">↙</span>
        Ally left
      </button>
      <button
        type="button"
        class="leaver-chip"
        :class="{ active: record.annotation?.leaver === 'enemy' }"
        :aria-pressed="record.annotation?.leaver === 'enemy'"
        title="Tag this match as: an enemy left."
        @click="emit('set-leaver-annotation', record.match_key, record.annotation?.leaver === 'enemy' ? '' : 'enemy')"
      >
        <span class="leaver-chip-glyph leaver-enemy" aria-hidden="true">↗</span>
        Enemy left
      </button>
      <button
        v-if="record.annotation?.leaver"
        type="button"
        class="leaver-chip leaver-clear"
        title="Remove the leaver annotation."
        @click="emit('set-leaver-annotation', record.match_key, '')"
      >
        × Clear
      </button>
    </div>

    <!-- MATCH JOURNAL — the user's notes about the match. Four cells
         in a hierarchy: Note (primary, full-width), Replay code +
         Squad (secondary, two-column row), Tags (full-width pill
         tray). Each cell commits independently on blur / Enter / chip
         add; the savedFlash class pulses the cell border instead of
         taking a 3rd grid column. -->
    <section
      class="match-journal"
      :class="{ populated: hasAnyNote }"
      :aria-label="`Match journal — ${hasAnyNote ? 'has annotations' : 'empty'}`"
    >
      <div class="journal-head">
        <span class="journal-head-title">MATCH JOURNAL</span>
        <span class="journal-head-meta" :data-status="hasAnyNote ? 'logged' : 'empty'">
          <span class="journal-head-pip" aria-hidden="true" />
          {{ hasAnyNote ? 'LOGGED' : 'AWAITING ENTRY' }}
        </span>
      </div>

      <div class="journal-body">
        <!-- Note (primary) — same click-to-edit preview + textarea
             swap as before, just hosted inside the journal cell shell. -->
        <div
          class="journal-cell journal-cell-note"
          :class="{ saved: savedFlash === 'note', filled: !!noteDraft.trim() }"
        >
          <label class="journal-eyebrow" :for="`note-${record.match_key}`">Note</label>
          <div
            v-if="!isEditingNote && noteDraft"
            class="match-notes-preview"
            :class="{ 'has-hits': noteHighlightSegments.some(s => s.hit) }"
            role="textbox"
            aria-readonly="true"
            tabindex="0"
            title="Click to edit"
            @click="enterEditMode"
            @keydown.enter.prevent="enterEditMode($event as unknown as MouseEvent)"
            @keydown.space.prevent="enterEditMode($event as unknown as MouseEvent)"
          >
            <template v-for="(seg, i) in noteHighlightSegments" :key="i">
              <mark v-if="seg.hit" class="note-hit">{{ seg.text }}</mark>
              <template v-else>{{ seg.text }}</template>
            </template>
          </div>
          <textarea
            v-else
            :id="`note-${record.match_key}`"
            ref="noteTextareaRef"
            v-model="noteDraft"
            class="match-notes-textarea"
            rows="2"
            placeholder="What happened this match? Mistakes, wins, who was carrying…"
            @blur="exitNoteEditMode"
          />
        </div>

        <!-- Replay + Squad on one row — the replay code is intrinsically
             short (~10 chars), so pairing it with the wider Squad chip
             tray reclaims the vertical space the 4-row layout wasted. -->
        <div class="journal-row-2col">
          <div
            class="journal-cell journal-cell-replay"
            :class="{ saved: savedFlash === 'replay', filled: !!replayDraft.trim() }"
          >
            <label class="journal-eyebrow" :for="`replay-${record.match_key}`">Replay code</label>
            <input
              :id="`replay-${record.match_key}`"
              v-model="replayDraft"
              class="match-notes-input mono"
              placeholder="e.g. 7H1K9P"
              spellcheck="false"
              autocomplete="off"
              maxlength="32"
              @blur="commitAnnotation('replay')"
              @keydown.enter.prevent="commitAnnotation('replay')"
            >
          </div>

          <div
            class="journal-cell journal-cell-squad"
            :class="{ saved: savedFlash === 'members', filled: memberDraft.length > 0 }"
          >
            <label class="journal-eyebrow" :for="`members-${record.match_key}`">
              Group
              <span v-if="memberDraft.length" class="journal-eyebrow-count">· {{ memberDraft.length }}</span>
            </label>
            <div class="match-notes-members">
              <span
                v-for="m in memberDraft"
                :key="m"
                class="member-chip"
              >
                <span class="member-chip-tag">{{ m }}</span>
                <button
                  type="button"
                  class="member-chip-remove"
                  :aria-label="`Remove ${m} from group`"
                  @click="removeMember(m)"
                >
                  ×
                </button>
              </span>
              <input
                :id="`members-${record.match_key}`"
                v-model="memberInput"
                class="match-notes-input member-input mono"
                :placeholder="memberDraft.length ? 'Add BattleTag…' : 'Add BattleTag · Enter to confirm'"
                spellcheck="false"
                autocomplete="off"
                @keydown="onMemberKeydown"
                @blur="addMember"
              >
            </div>
          </div>
        </div>

        <!-- Tags — three quick-add toggles for the conventional vocabulary,
             a chip list of currently-applied custom tags, and a free-form
             input. Backspace on an empty input removes the last chip. -->
        <div
          class="journal-cell journal-cell-tags"
          :class="{ saved: savedFlash === 'tags', filled: tagDraft.length > 0 }"
        >
          <span class="journal-eyebrow">
            Tags
            <span v-if="tagDraft.length" class="journal-eyebrow-count">· {{ tagDraft.length }}</span>
          </span>
          <div class="match-tags-editor">
            <button
              v-for="t in NAMED_TAGS"
              :key="t"
              type="button"
              class="match-tag-toggle"
              :class="{ active: hasTag(t) }"
              :data-tag="t"
              :data-tag-add="t"
              :aria-pressed="hasTag(t)"
              @click="toggleNamedTag(t)"
            >
              <span class="match-tag-mark" aria-hidden="true" />
              <span class="match-tag-text">{{ t }}</span>
            </button>
            <span
              v-for="t in tagDraft.filter(x => !(NAMED_TAGS as readonly string[]).includes(x))"
              :key="t"
              class="match-tag removable"
              :data-tag="t"
            >
              <span class="match-tag-mark" aria-hidden="true" />
              <span class="match-tag-text">{{ t }}</span>
              <button
                type="button"
                class="match-tag-x"
                :aria-label="`Remove ${t} tag`"
                @click="removeTag(t)"
              >×</button>
            </span>
            <input
              :id="`tags-${record.match_key}`"
              v-model="tagInput"
              class="match-tag-input"
              placeholder="add tag"
              spellcheck="false"
              autocomplete="off"
              @keydown="onTagKeydown"
              @blur="addCustomTag"
            >
          </div>
        </div>
      </div>
    </section>

    <div v-if="record.data?.final_score" class="meta-row">
      <span class="meta-eyebrow">Final Score</span>
      <span class="meta-value">{{ record.data.final_score }}</span>
    </div>

    <div v-if="record.parsed_at" class="meta-row meta-row-parsed">
      <span class="meta-eyebrow">Parsed</span>
      <span class="meta-value" :title="record.parsed_at">{{ formatParsedAt(record.parsed_at) }}</span>
    </div>

    <div class="stats">
      <div class="stat">
        <span class="stat-value">{{ record.data?.eliminations ?? '—' }}</span>
        <span class="stat-label">Elims</span>
      </div>
      <div class="stat">
        <span class="stat-value">{{ record.data?.assists ?? '—' }}</span>
        <span class="stat-label">Assists</span>
      </div>
      <div class="stat">
        <span class="stat-value">{{ record.data?.deaths ?? '—' }}</span>
        <span class="stat-label">Deaths</span>
      </div>
      <div class="stat">
        <span class="stat-value">{{ record.data?.damage != null ? record.data.damage.toLocaleString() : '—' }}</span>
        <span class="stat-label">Damage</span>
      </div>
      <div class="stat">
        <span class="stat-value">{{ record.data?.healing != null ? record.data.healing.toLocaleString() : '—' }}</span>
        <span class="stat-label">Healing</span>
      </div>
      <div class="stat">
        <span class="stat-value">{{ record.data?.mitigation != null ? record.data.mitigation.toLocaleString() : '—' }}</span>
        <span class="stat-label">Mitigation</span>
      </div>
    </div>

    <div v-if="record.data?.rank" class="rank-block">
      <div class="block-eyebrow">
        Rank
      </div>
      <div class="rank-line">
        <span class="rank-tier" :class="record.data.rank">{{ record.data.rank }} {{ record.data.level }}</span>
        <span v-if="record.data.rank_progress" class="rank-progress">{{ record.data.rank_progress }}% progress</span>
        <span v-if="record.data.change_percent" class="rank-change">+{{ record.data.change_percent }}%</span>
        <span v-for="m in record.data.modifiers" :key="m" class="rank-modifier">{{ m }}</span>
      </div>
      <div v-if="record.data.sr?.length" class="sr-line">
        <span v-for="s in record.data.sr" :key="s.hero" class="sr-entry">
          <span class="sr-hero">{{ ow.heroDisplayName(s.hero) }}</span>
          <span class="sr-value">{{ s.sr }}</span>
          <span class="sr-delta" :class="s.change >= 0 ? 'up' : 'down'">{{ s.change >= 0 ? '+' : '' }}{{ s.change }}</span>
        </span>
      </div>
    </div>

    <div v-if="record.data?.heroes_played?.length" class="heroes-played" :class="{ collapsed: !heroesExpanded }">
      <button
        type="button"
        class="heroes-played-toggle"
        :aria-expanded="heroesExpanded"
        :aria-controls="`heroes-played-${record.match_key}`"
        :title="heroesExpanded ? 'Collapse heroes played' : 'Expand heroes played'"
        @click="toggleHeroesExpanded"
      >
        <span class="chev small" :class="{ open: heroesExpanded }" aria-hidden="true">›</span>
        <span class="block-eyebrow">Heroes Played</span>
        <span class="heroes-count" aria-hidden="true">{{ record.data.heroes_played.length }}</span>
        <span v-if="!heroesExpanded" class="heroes-summary">
          <span
            v-for="(hp, idx) in topHeroesPlayed"
            :key="hp.hero"
            class="heroes-summary-entry"
          >
            <span v-if="idx > 0" class="heroes-summary-sep" aria-hidden="true">·</span>
            <span class="heroes-summary-name">{{ ow.heroDisplayName(hp.hero) }}</span>
            <span class="heroes-summary-pct">{{ hp.percent_played }}%</span>
          </span>
          <span v-if="(record.data.heroes_played.length ?? 0) > topHeroesPlayed.length" class="heroes-summary-more">
            +{{ (record.data.heroes_played.length ?? 0) - topHeroesPlayed.length }}
          </span>
        </span>
      </button>
      <div
        v-if="heroesExpanded"
        :id="`heroes-played-${record.match_key}`"
        class="heroes-played-items"
      >
        <div v-for="hp in record.data.heroes_played" :key="hp.hero" class="hero-block">
          <div class="hero-header">
            <button
              type="button"
              class="hero-name clickable"
              :class="{ active: isActive('hero', hp.hero) }"
              :aria-label="`Filter by hero: ${ow.heroDisplayName(hp.hero)}`"
              :aria-pressed="isActive('hero', hp.hero)"
              @click="emit('filter-toggle', 'hero', hp.hero)"
            >
              {{ ow.heroDisplayName(hp.hero) }}
            </button>
            <span class="hero-pct">{{ hp.percent_played }}%</span>
            <span v-if="hp.play_time" class="hero-time">{{ hp.play_time }}</span>
          </div>
          <div v-if="hp.stats && Object.keys(hp.stats).length" class="personal-grid">
            <div v-for="(v, k) in hp.stats" :key="k" class="personal-item">
              <span class="personal-label">{{ k.replace(/_/g, ' ') }}</span>
              <span class="personal-value">{{ v }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="record.source_files?.length" class="sources-block">
      <div class="sources-toggle" @click="emit('toggle-sources')">
        <span class="chev small" :class="{ open: isSourcesOpen }">›</span>
        <span class="sources-label">Source Screenshots</span>
        <span class="sources-count">{{ record.source_files.length }}</span>
        <span class="sources-coverage" :title="`${detectScreenshotSlots(record).filter(s => s.present).length} of ${detectScreenshotSlots(record).length} screenshot types captured`">
          <component
            :is="slot.present ? 'button' : 'span'"
            v-for="slot in detectScreenshotSlots(record)"
            :key="slot.key"
            :type="slot.present ? 'button' : undefined"
            class="slot-chip"
            :class="{
              present: slot.present,
              absent: !slot.present,
              optional: !slot.required,
              'absent-required': !slot.present && slot.required,
              clickable: slot.present,
              active: slot.present && isActive('sshot', slot.key),
            }"
            :title="slot.present ? `Click to filter to matches that have a ${slot.label} screenshot. ${slot.hint}` : slot.hint"
            :aria-label="slot.present ? `Filter by source: ${slot.label} present` : `${slot.label} screenshot not captured`"
            :aria-pressed="slot.present ? isActive('sshot', slot.key) : undefined"
            @click.stop="slot.present && emit('filter-toggle', 'sshot', slot.key)"
          >
            <span class="slot-dot" aria-hidden="true" />
            {{ slot.label }}
            <span v-if="!slot.required" class="slot-optional-tag">opt</span>
          </component>
        </span>
      </div>
      <div v-if="isSourcesOpen" class="sources">
        <div v-for="f in record.source_files" :key="f" class="source-file">
          <div class="source-row">
            <a
              class="source-name"
              :href="screenshotURL(f)"
              :title="props.previewOpen[f] ? 'Hide preview' : 'Show preview'"
              @click.prevent="emit('toggle-preview', f)"
            >
              <span class="chev small" :class="{ open: props.previewOpen[f] }">›</span>
              <span class="source-name-text">{{ f }}</span>
            </a>
            <button
              type="button"
              class="source-type-chip clickable"
              :class="[
                `source-type-${sourceType(record, f)}`,
                { active: isActive('sshot', sourceType(record, f)) },
              ]"
              :aria-label="`Filter by source type: ${sshotTypeLabel(sourceType(record, f))}`"
              :aria-pressed="isActive('sshot', sourceType(record, f))"
              @click.stop="emit('filter-toggle', 'sshot', sourceType(record, f))"
            >
              {{ sshotTypeLabel(sourceType(record, f)) }}
            </button>
            <span
              v-if="record.source_parsed_at?.[f]"
              class="source-parsed-chip"
              :title="`Inserted into the database at ${record.source_parsed_at[f]} (UTC)`"
            >{{ formatParsedAt(record.source_parsed_at[f]) }}</span>
          </div>
          <img
            v-if="props.previewOpen[f] && !props.previewError[f]"
            :src="screenshotURL(f)"
            :alt="f"
            class="source-preview"
            @error="emit('preview-error', f)"
          >
          <div v-if="props.previewOpen[f] && props.previewError[f]" class="source-preview-error">
            Could not load image — check screenshots folder in Settings.
          </div>
        </div>
      </div>

      <div v-if="isSourcesOpen && (missingRequiredSlots(record).length || missingOptionalSlots(record).length)" class="sources-explain">
        <p v-for="slot in missingRequiredSlots(record)" :key="slot.key" class="coverage-line required">
          <span class="coverage-line-tag">⚠ {{ slot.label }} missing</span>
          <span class="coverage-line-text">
            Capture the post-match <strong>{{ slot.label }}</strong> tab and re-parse to recover: {{ slot.missing }}.
          </span>
        </p>
        <p v-for="slot in missingOptionalSlots(record)" :key="slot.key" class="coverage-line optional">
          <span class="coverage-line-tag">· {{ slot.label }} not captured</span>
          <span class="coverage-line-text">
            Optional — recommended for ranked matches. Provides: {{ slot.missing }}.
          </span>
        </p>
      </div>
    </div>

    <!-- Soft-delete row. Hide is destructive in user intent
         ("I don't want to see this match"), but reversible at the
         data layer (no rows are dropped), so we use an inline
         two-step confirm instead of a modal. Unhide is one-click —
         strictly restorative. -->
    <MatchCardDanger
      :match-key="record.match_key"
      :hidden="!!record.hidden"
      @set-hidden="(k: string, h: boolean) => emit('set-match-hidden', k, h)"
    />
  </div>
</template>

<style scoped>
/* Strip browser button chrome on the chip buttons inside the
   expanded view. :where() keeps specificity at 0 so existing
   .hero-name / .source-type-chip / .slot-chip rules continue to
   win. */
:where(
  button.hero-name,
  button.source-type-chip,
  button.slot-chip
) {
  appearance: none;
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  padding: 0;
  margin: 0;
  text-align: inherit;
}

.hero-name.clickable:focus-visible,
.slot-chip.clickable:focus-visible,
.source-type-chip.clickable:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.match-expanded {
  margin-top: 0.95rem;
  padding-top: 0.95rem;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.meta-row {
  display: flex;
  align-items: baseline;
  gap: 0.7rem;
}

.meta-eyebrow {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.22em;
}

.meta-value {
  font-family: var(--display);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

/* Match-level "Parsed" meta row: same shape as the existing Final
   Score meta row; the parsed row gets a touch of breathing room
   so the two stack cleanly when both render. */
.meta-row-parsed {
  margin-top: 0.18rem;
}

/* ─── Coverage explainer (below sources) ─────────────────── */

.coverage-line {
  display: grid;
  grid-template-columns: minmax(9.5rem, max-content) 1fr;
  gap: 0.7rem;
  align-items: baseline;
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.4;
}

.coverage-line-tag {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-weight: 700;
  white-space: nowrap;
}

.coverage-line.required .coverage-line-tag { color: var(--accent-bright); }
.coverage-line.optional .coverage-line-tag { color: var(--text-faint); }

.coverage-line-text {
  color: var(--text-dim);
}

.coverage-line.required .coverage-line-text strong {
  color: var(--accent-bright);
  font-weight: 700;
}

/* Light-mode `.coverage-line.required` overrides live in app.css —
   the `:global([data-theme="light"]) .x` form miscompiles in Vue
   scoped CSS, see CLAUDE.md "Vue scoped miscompiles". */

@media (width <= 720px) {
  .coverage-line {
    grid-template-columns: 1fr;
    gap: 0.2rem;
  }
}

/* ─── Rank block ─────────────────────────────────────────── */

.rank-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  align-items: center;
  margin-bottom: 0.5rem;
}

.rank-tier {
  font-family: var(--display);
  font-size: 0.95rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.2rem 0.6rem;
  border-radius: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
}
.rank-tier.bronze    { color: #d18a4a; border-color: rgb(209 138 74 / 45%); }
.rank-tier.silver    { color: #d6d6d6; border-color: rgb(214 214 214 / 40%); }
.rank-tier.gold      { color: #ffd770; border-color: rgb(255 215 112 / 45%); }
.rank-tier.platinum  { color: #7befd9; border-color: rgb(123 239 217 / 45%); }
.rank-tier.diamond   { color: #c2e6ff; border-color: rgb(194 230 255 / 45%); }
.rank-tier.master    { color: #d6b4ff; border-color: rgb(214 180 255 / 45%); }
.rank-tier.grandmaster, .rank-tier.champion { color: var(--loss); border-color: var(--loss-line); }

.rank-progress {
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
}

.rank-change {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--win);
  font-weight: 600;
  font-feature-settings: "tnum";
}

.rank-modifier {
  font-size: 0.62rem;
  padding: 0.18rem 0.5rem;
  background: var(--surface-3);
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 2px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.sr-line { display: flex; flex-wrap: wrap; gap: 0.7rem; }

.sr-entry {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.25rem 0.55rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  font-size: 0.78rem;
}
.sr-hero  { color: var(--text-dim); text-transform: capitalize; font-size: 0.75rem; }
.sr-value { font-family: var(--mono); color: var(--text); font-weight: 600; font-feature-settings: "tnum"; }
.sr-delta { font-family: var(--mono); font-size: 0.7rem; font-weight: 600; font-feature-settings: "tnum"; }
.sr-delta.up   { color: var(--win); }
.sr-delta.down { color: var(--loss); }

/* ─── Heroes Played list ─────────────────────────────────── */

/* Collapsible block — when collapsed the entire .hero-block grid is
   gone from the DOM (v-if), but the header eyebrow stays as a
   single-line summary so the user reads the count + top heroes
   without expanding. Default is expanded; the preference persists in
   localStorage via useHeroesExpanded so a user with very long match
   histories collapses once and the choice survives every subsequent
   card open. */

.heroes-played.collapsed { margin-bottom: -0.2rem; }

.heroes-played-toggle {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.35rem 0.45rem 0.35rem 0.1rem;
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 2px;
  margin-bottom: 0.55rem;
  transition: background 140ms ease;
}

.heroes-played-toggle:hover { background: var(--surface-2); }

.heroes-played-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.heroes-played .chev.small {
  display: inline-block;
  font-family: var(--mono);
  color: var(--accent);
  transition: transform 200ms ease;
  transform: rotate(90deg);
  width: 0.9rem;
  text-align: center;
}

.heroes-played .chev.small.open { transform: rotate(90deg); }
.heroes-played.collapsed .chev.small { transform: rotate(0deg); }

.heroes-played-toggle .block-eyebrow {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.heroes-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.1rem;
  padding: 0 0.32rem;
  background: var(--surface-3);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  border-radius: 1px;
  font-feature-settings: "tnum";
}

.heroes-summary {
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-left: 0.35rem;
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-mute);
  font-feature-settings: "tnum";
}

.heroes-summary-entry {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
}

.heroes-summary-sep { color: var(--text-faint); }

.heroes-summary-name {
  font-family: var(--display);
  font-style: italic;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.heroes-summary-pct {
  color: var(--text);
  font-weight: 600;
}

.heroes-summary-more {
  padding: 0.05rem 0.32rem;
  background: var(--surface-3);
  border: 1px dashed var(--border);
  color: var(--text-faint);
  font-size: 0.6rem;
  letter-spacing: 0.06em;
  border-radius: 1px;
}

.heroes-played-items {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  animation: heroes-items-in 200ms ease both;
}

@keyframes heroes-items-in {
  from { opacity: 0; transform: translateY(-2px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .heroes-played-items { animation: none; }
}

.hero-block {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-left: 2px solid var(--accent-soft);
  border-radius: 2px;
  padding: 0.75rem 0.9rem;
}

.hero-header {
  display: flex;
  gap: 0.7rem;
  align-items: baseline;
  margin-bottom: 0.55rem;
}

.hero-name {
  font-family: var(--display);
  font-style: italic;
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0 0.15rem;
  cursor: pointer;
  transition: color 160ms ease, text-shadow 200ms ease;
}
.hero-name:hover { color: var(--accent-bright); text-shadow: 0 0 16px var(--accent-glow); }
.hero-name.active { text-shadow: 0 0 14px var(--accent-glow); }

.hero-pct {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
}

.hero-time {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-faint);
}

.personal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(165px, 1fr));
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
}

.personal-item {
  background: var(--surface);
  padding: 0.45rem 0.7rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.personal-label {
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.personal-value {
  font-family: var(--mono);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text);
  font-feature-settings: "tnum";
}

/* ─── Sources block ──────────────────────────────────────── */

.sources-block {
  margin-top: 0.2rem;
  border-top: 1px dashed var(--border);
  padding-top: 0.85rem;
}

.sources-toggle {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  cursor: pointer;
  user-select: none;
  font-family: var(--mono);
  font-size: 0.65rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.18em;
  transition: color 160ms ease;
}
.sources-toggle:hover { color: var(--text-dim); }

.sources-count {
  font-family: var(--mono);
  background: var(--surface-3);
  color: var(--text-dim);
  padding: 0.05rem 0.4rem;
  border-radius: 2px;
  font-size: 0.6rem;
  letter-spacing: 0;
  margin-left: 0.2rem;
}

/* Coverage chips on the Sources toggle row — same .slot-chip styling
   as the legacy coverage-block, but pushed to the right of the
   "Source Screenshots · 5" label. */
.sources-coverage {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  margin-left: auto;
}

.sources-coverage .slot-chip.clickable {
  cursor: pointer;
}

.sources-coverage .slot-chip.clickable:hover {
  filter: brightness(1.12);
  transform: translateY(-1px);
}

.sources-coverage .slot-chip.active {
  box-shadow: 0 0 0 1px var(--accent), 0 0 0 3px var(--accent-soft);
}

.sources {
  margin-top: 0.55rem;
  padding: 0.65rem 0.75rem;
  background: rgb(0 0 0 / 30%);
  border: 1px solid var(--border-soft);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.72rem;
}

/* .source-file / .source-name-text / .source-parsed-chip live in
   app.css — they're also used by UnknownMapsView. .source-row stays
   here (MatchCardExpanded-only). */

.source-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.source-type-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.18rem 0.5rem;
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  border: 1px solid transparent;
  flex-shrink: 0;
  cursor: default;
  user-select: none;
  transition: filter 140ms ease, transform 140ms ease, box-shadow 140ms ease;
}

.source-type-chip.clickable { cursor: pointer; }

.source-type-chip.clickable:hover {
  filter: brightness(1.15);
  transform: translateY(-1px);
}

.source-type-chip.active {
  box-shadow: 0 0 0 1px var(--accent), 0 0 0 3px var(--accent-soft);
}

.source-type-summary {
  background: var(--accent-soft);
  border-color: rgb(245 166 35 / 50%);
  color: var(--accent-bright);
}

.source-type-scoreboard {
  background: rgb(106 184 255 / 12%);
  border-color: rgb(106 184 255 / 50%);
  color: var(--tank);
}

.source-type-personal {
  background: rgb(125 255 172 / 12%);
  border-color: rgb(125 255 172 / 50%);
  color: var(--support);
}

.source-type-rank {
  background: rgb(255 201 77 / 14%);
  border-color: rgb(255 201 77 / 50%);
  color: var(--draw);
}

/* Light-mode `.source-type-summary` / `.hero-name` / `.sources`
   overrides live in app.css — the `:global([data-theme="light"]) .x`
   form miscompiles in Vue scoped CSS, see CLAUDE.md. */

.sources-explain {
  margin-top: 0.7rem;
  padding-top: 0.65rem;
  border-top: 1px dashed var(--hairline);
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

/* ─── Leaver chooser (expanded view) ────────────────────── */

/* Sits at the top of `.match-expanded` so the user reaches it
   without scrolling past stats / heroes. The label is
   mono-eyebrow style; the chips reuse the .badge visual
   vocabulary but are explicitly tagged with their own classes so
   they can be styled independently of the filter chips above. */
.leaver-chooser {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  margin: 0 0 0.85rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px dashed var(--border);
}

.leaver-chooser-label {
  margin-right: 0.4rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.leaver-chip {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.22rem 0.6rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  color: var(--text-dim);
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease, border-color 140ms ease, transform 140ms ease;
}

.leaver-chip:hover {
  color: var(--text);
  border-color: var(--text-faint);
  transform: translateY(-1px);
}

.leaver-chip.active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent);
}

.leaver-chip.leaver-clear {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.leaver-chip.leaver-clear:hover {
  color: var(--loss);
  border-color: var(--loss-line);
  background: var(--loss-soft);
}

.leaver-chip-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  line-height: 1;
}
.leaver-chip-glyph.leaver-self  { color: var(--loss); }
.leaver-chip-glyph.leaver-team  { color: var(--loss); }
.leaver-chip-glyph.leaver-enemy { color: var(--win); }
.leaver-chip.active .leaver-chip-glyph { color: var(--accent); }

/* ─── Match Journal ──────────────────────────────────────── */

/* The user's annotations on a match — Note, Replay code, Group
   members, Tags. Promoted to its own panel because (a) the user
   explicitly flagged the section as important, and (b) the previous
   one-input-per-row layout took 4× the vertical space the data
   actually needs. New layout:
     1. Striped header strip → reads as a dossier / after-action
        report rather than a generic form.
     2. Cells with their own eyebrow + inline focus-within glow →
        each field feels distinct without forcing 4 horizontal labels.
     3. Replay + Group share a row → reclaims one row of vertical
        space because the replay code is intrinsically narrow.
     4. saved✓ pulse on the cell border (not a 3rd grid column) → no
        layout shift when commit confirms; the affordance lives on
        the cell it confirms. */

.match-journal {
  position: relative;
  margin: 0 0 0.85rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  overflow: hidden;
  transition: border-color 220ms ease, box-shadow 220ms ease;
}

.match-journal.populated {
  border-color: var(--accent-soft);
  box-shadow: inset 2px 0 0 0 var(--accent);
}

/* Corner ticks — fade in when the panel has content so the user gets
   a soft "active dossier" affordance. Off when empty so the empty
   state stays calm. */
.match-journal::before,
.match-journal::after {
  content: '';
  position: absolute;
  width: 8px;
  height: 8px;
  border: 1px solid var(--accent);
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease;
}

.match-journal::before {
  top: -1px; right: -1px;
  border-left: none; border-bottom: none;
}

.match-journal::after {
  bottom: -1px; left: -1px;
  border-right: none; border-top: none;
}

.match-journal.populated::before,
.match-journal.populated::after { opacity: 0.7; }

.journal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.7rem;
  padding: 0.4rem 0.7rem 0.4rem 0.75rem;
  background: repeating-linear-gradient(135deg, var(--surface-3) 0 14px, var(--surface-2) 14px 28px);
  border-bottom: 1px solid var(--border);
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

.journal-head-title {
  color: var(--text);
  font-weight: 700;
}

.journal-head-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.58rem;
  letter-spacing: 0.2em;
  color: var(--text-faint);
}

.journal-head-pip {
  width: 6px;
  height: 6px;
  background: currentcolor;
  transform: rotate(45deg);
  opacity: 0.7;
}

.match-journal.populated .journal-head-meta { color: var(--accent); }
.match-journal.populated .journal-head-meta .journal-head-pip { opacity: 1; }

.journal-body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.7rem 0.75rem 0.8rem;
}

/* Replay + Group share a row; the replay code is short, group is
   wide. On narrow widths the grid collapses to a single column so
   the chip list doesn't squeeze. */
.journal-row-2col {
  display: grid;
  grid-template-columns: minmax(11rem, 0.45fr) 1fr;
  gap: 0.55rem;
}

@media (width <= 720px) {
  .journal-row-2col { grid-template-columns: 1fr; }
}

/* Each cell is a self-contained mini-card: eyebrow up top, control
   below. Focus-within glows the cell with the accent ring so the
   user always knows which field they're editing. */
.journal-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.5rem 0.6rem 0.55rem;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 2px;
  transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
}

.journal-cell:focus-within {
  border-color: var(--accent);
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--accent-soft);
}

.journal-cell.filled { border-color: var(--border); }

/* Confirmation pulse — the parent flips the `saved` class for 900 ms
   after a commit. Border + tiny corner tick fade through accent
   then back. No layout shift; replaces the prior "saved ✓" text
   column. */
.journal-cell.saved {
  animation: journal-cell-saved 900ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
}

.journal-cell.saved::after {
  content: '';
  position: absolute;
  top: -1px;
  right: -1px;
  width: 14px;
  height: 14px;
  background:
    linear-gradient(135deg, transparent 50%, var(--accent) 50%);
  animation: journal-cell-tick 900ms ease both;
  pointer-events: none;
}

@keyframes journal-cell-saved {
  0%   { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft), 0 0 22px -2px var(--accent-glow); }
  100% { border-color: var(--border); box-shadow: 0 0 0 0 transparent; }
}

@keyframes journal-cell-tick {
  0%   { opacity: 0; transform: translate(-2px, 2px); }
  20%  { opacity: 1; transform: translate(0, 0); }
  100% { opacity: 0; transform: translate(0, 0); }
}

@media (prefers-reduced-motion: reduce) {
  .journal-cell.saved { animation: none; }
  .journal-cell.saved::after { animation: none; opacity: 0; }
}

.journal-eyebrow {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
  user-select: none;
}

.journal-cell.filled .journal-eyebrow { color: var(--text-dim); }
.journal-cell:focus-within .journal-eyebrow { color: var(--accent); }

.journal-eyebrow-count {
  font-size: 0.58rem;
  letter-spacing: 0.12em;
  color: var(--accent);
  font-feature-settings: "tnum";
}

.journal-cell-note { grid-column: 1 / -1; }

/* The note + replay + members fields all share the same control
   chrome — borderless inputs that sit flush inside their journal
   cell. The cell IS the visual frame; the input is just text. */
.match-notes-textarea,
.match-notes-input,
.match-notes-preview {
  width: 100%;
  padding: 0.25rem 0;
  background: transparent;
  border: 0;
  color: var(--text);
  font: inherit;
  font-size: 0.85rem;
  line-height: 1.45;
}

.match-notes-textarea,
.match-notes-preview {
  min-height: 2.2rem;
  font-family: var(--body);
}

.match-notes-textarea {
  resize: vertical;
  outline: none;
}

.match-notes-input { outline: none; }

/* HUD-style preview — cursor: text + the focus-within glow on the
   parent cell signal "editable" without a pencil icon. The ⌕ pinned
   right confirms the active match-search query landed at least one
   hit inside this note. */
.match-notes-preview {
  position: relative;
  padding-right: 1.6rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  cursor: text;
}

.match-notes-preview:focus-visible { outline: none; }

.match-notes-preview.has-hits::after {
  content: "⌕";
  position: absolute;
  top: 0.05rem;
  right: 0.1rem;
  font-family: var(--mono);
  font-size: 0.8rem;
  color: var(--accent);
  opacity: 0.9;
  pointer-events: none;
}

/* "Target acquired" mark: accent-soft fill + 2px accent under-rule,
   sharp corners (OW HUD, not notion soft-pill). decoration-break
   makes wrap-to-next-line marks get the under-rule too. */
.match-notes-preview :deep(mark.note-hit) {
  background: var(--accent-soft);
  color: var(--text);
  border-radius: 0;
  padding: 0 2px;
  margin: 0 1px;
  box-shadow: inset 0 -2px 0 0 var(--accent);
  box-decoration-break: clone;
}

@media (prefers-reduced-motion: no-preference) {
  .match-notes-preview :deep(mark.note-hit) {
    animation: note-hit-acquire 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
}

@keyframes note-hit-acquire {
  from { background: transparent; box-shadow: inset 0 -2px 0 0 transparent; }
}

.match-notes-input.mono {
  font-family: var(--mono);
  letter-spacing: 0.04em;
}

/* Members chip list — flex-wraps so chips reflow on narrow widths.
   The host journal cell owns the border + focus glow, so the chip
   tray itself is borderless. */
.match-notes-members {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
  padding: 0.05rem 0;
}

.member-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.18rem 0.2rem 0.18rem 0.5rem;
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.02em;
  color: var(--accent);
}

.member-chip-tag {
  white-space: nowrap;
}

.member-chip-remove {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0 0.2rem;
  color: currentcolor;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
  border-radius: 1px;
  transition: background 140ms ease;
}

.member-chip-remove:hover {
  background: color-mix(in srgb, currentcolor 18%, transparent);
}

.member-input {
  flex: 1 1 11rem;
  min-width: 8rem;
  padding: 0.15rem 0;
  background: transparent;
  border: 0;
  font-size: 0.78rem;
  outline: none;
}

/* Tags editor sits flush inside .journal-cell-tags — kill the
   margin-top app.css adds since the parent journal cell already
   provides the gap. */
.journal-cell-tags .match-tags-editor { margin-top: 0; }
</style>
