<script setup lang="ts">
import type { CoachPlayerView } from '@/components/coach/coach-room-props'
import { focusTagLabel, type FocusCount } from '@/match/coach/coach-notes'
import type { WLDTally } from '@/match/match-stats-helpers'

// The session sheet: who is being reviewed, how the session went, and
// what the coach wants her to work on. Written on paper — the plate
// re-maps the app's text / verdict tokens inside itself, so .eyebrow,
// .score-num and the rest render here with no parallel rules.

withDefaults(defineProps<{
  player: CoachPlayerView
  wld: WLDTally
  winRate: number | null
  focusTally: FocusCount[]
  /** "7 notes · 1 reviewed only · Ordo" — from notesSummaryLine(). */
  notesLine: string
  summary: string
  canExport?: boolean
  /** Why Export is unavailable — shown as its title, per the write-gate copy. */
  exportReason?: string
  /**
   * Non-empty when the summary cannot be saved yet — the session names no
   * player, so the server has nowhere to key it. The box refuses typing for
   * the same reason the note editor does: accepting a paragraph every PUT
   * will refuse loses it.
   */
  blockedReason?: string
}>(), { canExport: true, exportReason: undefined, blockedReason: '' })

const emit = defineEmits<{
  'update-summary': [text: string]
  /** Re-open the room's "who is this?" prompt — the bundle only suggested. */
  'change-player': []
  export: []
  end: []
}>()

function onSummaryInput(e: Event): void {
  if (!(e.target instanceof HTMLTextAreaElement)) return
  emit('update-summary', e.target.value)
}
</script>

<template>
  <section class="paper coach-sheet" aria-label="Session sheet">
    <div class="sheet-head">
      <h2 class="sheet-title">
        Reviewing {{ player.handle || 'nobody yet' }}
      </h2>
      <button
        type="button"
        class="paper-btn sheet-change"
        title="The bundle only suggested this name — file the notes under a different player"
        @click="emit('change-player')"
      >
        Change player
      </button>
    </div>
    <blockquote v-if="player.message" class="sheet-message">
      {{ player.message }}
    </blockquote>

    <div class="sheet-record" role="group" aria-label="Session record">
      <div class="score-cell">
        <span class="score-num win">{{ wld.w }}</span>
        <span class="score-label">Won</span>
      </div>
      <div class="score-cell">
        <span class="score-num loss">{{ wld.l }}</span>
        <span class="score-label">Lost</span>
      </div>
      <div class="score-cell">
        <span class="score-num draw">{{ wld.d }}</span>
        <span class="score-label">Drew</span>
      </div>
      <p class="sheet-rate">
        <span class="sheet-rate-num">{{ winRate === null ? '—' : `${winRate}%` }}</span>
        <span class="score-label">Win rate</span>
      </p>
    </div>

    <div class="sheet-block">
      <span class="eyebrow ink">Focus so far</span>
      <ul v-if="focusTally.length" class="sheet-tally" aria-label="Focus tally">
        <li v-for="row in focusTally" :key="row.tag" class="tally-row">
          <span class="tally-tag">{{ focusTagLabel(row.tag) }}</span>
          <span class="tally-count">{{ row.count }}</span>
        </li>
      </ul>
      <p v-else class="sheet-quiet">
        No focus tags yet.
      </p>
      <p class="sheet-notes-line">
        {{ notesLine }}
      </p>
    </div>

    <div class="sheet-block">
      <label class="eyebrow ink" for="coach-session-summary">What to work on</label>
      <textarea
        id="coach-session-summary"
        class="sheet-summary"
        rows="5"
        :value="summary"
        :disabled="blockedReason !== ''"
        :title="blockedReason || undefined"
        placeholder="The one thing to take into the next session…"
        @input="onSummaryInput"
      />
      <p v-if="blockedReason" class="sheet-blocked">
        {{ blockedReason }}
      </p>
    </div>

    <p class="sheet-persist">
      Nothing here is saved to your profile. Her matches leave when the session ends; your notes stay with you and travel as a file.
    </p>

    <footer class="sheet-actions">
      <button
        type="button"
        class="paper-btn primary"
        :disabled="!canExport"
        :title="canExport ? undefined : exportReason"
        @click="emit('export')"
      >
        Export notes
      </button>
      <button type="button" class="paper-btn" @click="emit('end')">
        End session
      </button>
    </footer>
  </section>
</template>

<style scoped>
.coach-sheet {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 1rem 1.05rem 1.1rem;
}

.sheet-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.sheet-change {
  flex: none;
  padding: 0.25rem 0.5rem;
  font-size: var(--type-xs);
  letter-spacing: 0.06em;
}

.sheet-title {
  margin: 0;
  font-family: var(--display);
  font-style: italic;
  font-size: 1.9rem;
  font-weight: 800;
  line-height: 1;
  color: var(--ink);
  text-transform: uppercase;
}

.sheet-message {
  margin: 0;
  padding-left: 0.6rem;
  font-size: var(--type-lg);
  line-height: 1.5;
  color: var(--ink-dim);
  border-left: 2px solid var(--paper-rule);
}

.sheet-record {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.9rem;
  padding: 0.5rem 0;
  border-top: 1px solid var(--paper-rule);
  border-bottom: 1px solid var(--paper-rule);
}

/* .score-num / .score-cell / .score-label are the masthead scoreboard's
   family (masthead.css); on paper they take the ink palette from the
   plate, so only the rate needs a rule of its own here. */
.sheet-rate {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  margin: 0 0 0 auto;
}

.sheet-rate-num {
  font-family: var(--mono);
  font-size: var(--type-4xl);
  font-weight: 700;
  color: var(--ink);
  font-feature-settings: "tnum";
}

.sheet-block {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.sheet-tally {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tally-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.12rem 0;
  border-bottom: 1px dotted var(--paper-rule);
}

.tally-tag {
  font-size: var(--type-lg);
  color: var(--ink-dim);
}

.tally-count {
  font-family: var(--mono);
  font-size: var(--type-md);
  color: var(--ink);
  font-feature-settings: "tnum";
}

.sheet-quiet, .sheet-notes-line {
  margin: 0;
  font-size: var(--type-md);
  color: var(--ink-faint);
}

.sheet-notes-line { margin-top: 0.3rem; }

.sheet-summary {
  padding: 0.5rem 0.6rem;
  font-family: var(--body);
  font-size: var(--type-lg);
  line-height: 1.5;
  color: var(--ink);
  background: var(--paper-2);
  border: 1px solid var(--ink-faint);
  border-radius: var(--radius);
  resize: vertical;
}

.sheet-persist {
  margin: 0;
  font-size: var(--type-2xs);
  line-height: 1.45;
  color: var(--ink-faint);
}

.sheet-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--paper-rule);
}

.sheet-blocked {
  margin: 0.3rem 0 0;
  font-size: var(--type-xs);
  line-height: 1.4;
  color: var(--ink-dim);
}
</style>
