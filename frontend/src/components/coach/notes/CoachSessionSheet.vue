<script setup lang="ts">
import SheetFocusTally from '@/components/sheet/SheetFocusTally.vue'
import SheetRecord from '@/components/sheet/SheetRecord.vue'
import SheetFocusItems from '@/components/sheet/SheetFocusItems.vue'
import type { FocusItem } from '@/api'
import type { CoachPlayerView, CoachSaveState } from '@/components/coach/room/coach-room-props'
import type { FocusCount } from '@/match/coach/coach-notes'
import type { WLDTally } from '@/match/match-stats-helpers'

// The session sheet: who is being reviewed, how the session went, and
// what the coach wants them to work on. Written on paper — the plate
// re-maps the app's text / verdict tokens inside itself, so .eyebrow,
// .score-num and the rest render here with no parallel rules. The record,
// the focus tally and the focus list are the pieces every sheet shares
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
  /** What this player is being told to work on, in the coach's order. */
  focusItems: FocusItem[]
  /** Where the focus list's own autosave stands. */
  focusSaveState?: CoachSaveState
  canExport?: boolean
  /** Why Export is unavailable — shown as its title, per the write-gate copy. */
  exportReason?: string
  /**
   * Non-empty when the list cannot be saved yet — the session names no
   * player, so the server has nowhere to key it. The rows refuse typing for
   * the same reason the note editor does: accepting words every PUT will
   * refuse loses them.
   */
  blockedReason?: string
}>(), {
  canExport: true, exportReason: undefined, blockedReason: '',
  endArmed: false, focusSaveState: 'idle',
})

const emit = defineEmits<{
  'keep-working': []
  'update-focus-items': [items: FocusItem[]]
  /** Re-open the room's "who is this?" prompt — the bundle only suggested. */
  'change-player': []
  export: []
  /** The one-page copy — for a player who does not run Recall. */
  'export-sheet': []
  end: []
}>()
</script>

<template>
  <section class="paper coach-sheet" aria-label="Session sheet">
    <div class="sheet-head">
      <h2 class="sheet-title">
        Reviewing {{ player.handle || 'the player' }}
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
    <SheetFocusItems
      id="coach-session-focus"
      :items="focusItems"
      :save-state="focusSaveState"
      :blocked-reason="blockedReason"
      @update="(items: FocusItem[]) => emit('update-focus-items', items)"
    />

    <p class="sheet-persist">
      These matches are on loan — nothing here joins your history. They leave when the session ends; your notes stay with you and travel as a file.
    </p>

    <footer class="sheet-actions">
      <button
        type="button"
        class="paper-btn primary"
        :disabled="!canExport"
        :title="canExport ? undefined : exportReason"
        @click="emit('export')"
      >
        1 · Export notes file — for their Recall
      </button>
      <!-- The pairing the loan slip offers, here where the export decision
           is framed: a coach whose player does not run Recall never learned
           the browser-openable page existed unless they read the masthead. -->
      <button
        type="button"
        class="paper-btn"
        :disabled="!canExport"
        :title="canExport ? undefined : exportReason"
        @click="emit('export-sheet')"
      >
        Save a web page — read-only
      </button>
      <!-- Routes through the same armed question the loan slip asks. -->
      <button type="button" class="paper-btn" @click="emit('end')">
        {{ endArmed ? 'End anyway — notes not exported' : '2 · End session' }}
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
    <p v-if="!canExport && exportReason" class="sheet-blocked">
      {{ exportReason }}
    </p>
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
