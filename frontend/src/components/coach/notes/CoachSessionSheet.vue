<script setup lang="ts">
import SheetFocusTally from '@/components/coach/notes/SheetFocusTally.vue'
import SheetRecord from '@/components/coach/notes/SheetRecord.vue'
import SheetSummary from '@/components/coach/notes/SheetSummary.vue'
import type { CoachPlayerView, CoachSaveState } from '@/components/coach/room/coach-room-props'
import type { FocusCount } from '@/match/coach/coach-notes'
import type { WLDTally } from '@/match/match-stats-helpers'

// The session sheet: who is being reviewed, how the session went, and
// what the coach wants them to work on. Written on paper — the plate
// re-maps the app's text / verdict tokens inside itself, so .eyebrow,
// .score-num and the rest render here with no parallel rules. The record,
// the focus tally and the summary box are the pieces every sheet shares
// (the player's own review sitting composes its own from them); what is
// left here is the coach's: who, the message, Export, End.

withDefaults(defineProps<{
  player: CoachPlayerView
  wld: WLDTally
  winRate: number | null
  focusTally: FocusCount[]
  /** True once ending has been asked about and not yet confirmed. */
  endArmed?: boolean
  /** "7 notes · 19 moments · 1 reviewed only · Ordo" — from notesSummaryLine(). */
  notesLine: string
  summary: string
  /** Where the summary's own autosave stands. */
  summarySaveState?: CoachSaveState
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
}>(), {
  canExport: true, exportReason: undefined, blockedReason: '',
  endArmed: false, summarySaveState: 'idle',
})

const emit = defineEmits<{
  'keep-working': []
  'update-summary': [text: string]
  /** Re-open the room's "who is this?" prompt — the bundle only suggested. */
  'change-player': []
  export: []
  end: []
}>()
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

    <SheetRecord :wld="wld" :win-rate="winRate" />
    <SheetFocusTally :focus-tally="focusTally" :notes-line="notesLine" />
    <SheetSummary
      id="coach-session-summary"
      :summary="summary"
      :save-state="summarySaveState"
      :blocked-reason="blockedReason"
      @update="(text: string) => emit('update-summary', text)"
    />

    <p class="sheet-persist">
      Nothing here is saved to your profile. Their matches leave when the session ends; your notes stay with you and travel as a file.
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
      <!-- Routes through the same armed question the loan slip asks. -->
      <button type="button" class="paper-btn" @click="emit('end')">
        {{ endArmed ? 'End anyway — notes not exported' : 'End session' }}
      </button>
      <button
        v-if="endArmed"
        type="button"
        class="paper-btn"
        @click="emit('keep-working')"
      >
        Keep working
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
