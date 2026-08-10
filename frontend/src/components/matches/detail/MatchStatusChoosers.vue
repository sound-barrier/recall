<script setup lang="ts">
import { computed } from 'vue'
import type { MatchRecord, PlayMode, QueueType, ReviewedBy } from '@/api-client'

// The match-status pickers at the top of the expanded card: queue type,
// play mode, and review status (three ARIA radiogroups) plus the "since
// this match" anchor toggle. Extracted from MatchCardExpanded so the card
// sheds their template + scoped CSS; the card passes the record + current
// anchor down and forwards the four set-* events back up. Multi-root by
// design — the choosers stay direct flex children of .match-expanded.
const props = defineProps<{
  record: MatchRecord
  anchorKey?: string
}>()

const emit = defineEmits<{
  'set-match-queue':     [matchKey: string, queueType: QueueType]
  'set-match-play-mode': [matchKey: string, playMode: PlayMode]
  'set-match-review':    [matchKey: string, reviewedBy: ReviewedBy]
  'set-anchor':          [matchKey: string]
}>()

// When this card's record IS the active anchor, the toggle shows the
// "filtering from here" state instead of the "set me" state.
const isAnchor = computed(() => props.anchorKey === props.record.match_key)
</script>

<template>
  <!-- Queue-type chooser. Frames every downstream stat (winrate,
         hero pool, SR delta) — surfaces FIRST so the user makes the
         5v5/6v6 call before reading anything else. Three
         mutually-exclusive states: "Not set" (default — no
         match_queue row), "Role Queue" (5v5), "Open Queue" (6v6).
         Mirrors the review-status radiogroup pattern below. -->
  <div
    class="queue-chooser"
    role="radiogroup"
    aria-label="Match queue type"
  >
    <span class="eyebrow queue-chooser-eyebrow" aria-hidden="true">Queue</span>
    <div class="queue-chips">
      <button
        type="button"
        class="queue-chip"
        data-state="none"
        role="radio"
        :aria-checked="!record.queue_type"
        :tabindex="!record.queue_type ? 0 : -1"
        title="Queue type not set."
        @click="!record.queue_type || emit('set-match-queue', record.match_key, '')"
      >
        <span class="queue-chip-glyph" aria-hidden="true">⬡</span>
        <span class="queue-chip-label">Not set</span>
      </button>
      <button
        type="button"
        class="queue-chip"
        data-state="role"
        role="radio"
        :aria-checked="record.queue_type === 'role'"
        :tabindex="record.queue_type === 'role' ? 0 : -1"
        title="5v5 role queue (locked 1-2-2 composition)."
        @click="emit('set-match-queue', record.match_key, record.queue_type === 'role' ? '' : 'role')"
      >
        <span class="queue-chip-glyph" aria-hidden="true">▣</span>
        <span class="queue-chip-label">Role Queue</span>
      </button>
      <button
        type="button"
        class="queue-chip"
        data-state="open"
        role="radio"
        :aria-checked="record.queue_type === 'open'"
        :tabindex="record.queue_type === 'open' ? 0 : -1"
        title="6v6 open queue (any composition)."
        @click="emit('set-match-queue', record.match_key, record.queue_type === 'open' ? '' : 'open')"
      >
        <span class="queue-chip-glyph" aria-hidden="true">◇</span>
        <span class="queue-chip-label">Open Queue</span>
      </button>
    </div>
  </div>

  <!-- Play-mode chooser. Sits right below the queue chooser
         because the two axes together frame every downstream stat
         (a "Quickplay role queue" winrate has nothing to do with a
         "Competitive open queue" winrate). Three mutually-exclusive
         states: "Not set" (default — no override; aggregator falls
         back to data.playlist + rank-row presence), "Quickplay"
         (casual), "Competitive" (ranked). -->
  <div
    class="play-mode-chooser"
    role="radiogroup"
    aria-label="Match play mode"
  >
    <span class="eyebrow play-mode-chooser-eyebrow" aria-hidden="true">Play mode</span>
    <div class="play-mode-chips">
      <button
        type="button"
        class="play-mode-chip"
        data-state="none"
        role="radio"
        :aria-checked="!record.play_mode"
        :tabindex="!record.play_mode ? 0 : -1"
        title="No play mode set."
        @click="!record.play_mode || emit('set-match-play-mode', record.match_key, '')"
      >
        <span class="play-mode-chip-glyph" aria-hidden="true">⬡</span>
        <span class="play-mode-chip-label">Not set</span>
      </button>
      <button
        type="button"
        class="play-mode-chip"
        data-state="quickplay"
        role="radio"
        :aria-checked="record.play_mode === 'quickplay'"
        :tabindex="record.play_mode === 'quickplay' ? 0 : -1"
        title="Casual game (no SR / rank progress)."
        @click="emit('set-match-play-mode', record.match_key, record.play_mode === 'quickplay' ? '' : 'quickplay')"
      >
        <span class="play-mode-chip-glyph" aria-hidden="true">◎</span>
        <span class="play-mode-chip-label">Quickplay</span>
      </button>
      <button
        type="button"
        class="play-mode-chip"
        data-state="competitive"
        role="radio"
        :aria-checked="record.play_mode === 'competitive'"
        :tabindex="record.play_mode === 'competitive' ? 0 : -1"
        title="Ranked game (SR + rank progress applies)."
        @click="emit('set-match-play-mode', record.match_key, record.play_mode === 'competitive' ? '' : 'competitive')"
      >
        <span class="play-mode-chip-glyph" aria-hidden="true">◆</span>
        <span class="play-mode-chip-label">Competitive</span>
      </button>
    </div>
  </div>

  <!-- Review-status chooser. Three mutually-exclusive states the
         user can stamp on a match: "Not reviewed" (default — no
         match_reviews row), "Self-reviewed" (the user reviewed the
         VOD themselves), "Coach-reviewed" (a coach reviewed it).
         Implemented as an ARIA radiogroup so screen readers announce
         the chosen segment + the two alternatives. Sits at the
         absolute top of the panel body — this is the FIRST thing the
         user sees because reviewing matches is a core review loop. -->
  <div
    class="review-chooser"
    role="radiogroup"
    aria-label="Match review status"
  >
    <span class="eyebrow review-chooser-eyebrow" aria-hidden="true">Review status</span>
    <div class="review-chips">
      <button
        type="button"
        class="review-chip"
        data-state="none"
        role="radio"
        :aria-checked="!record.reviewed_by"
        :tabindex="!record.reviewed_by ? 0 : -1"
        title="Not yet reviewed."
        @click="!record.reviewed_by || emit('set-match-review', record.match_key, '')"
      >
        <span class="review-chip-glyph" aria-hidden="true">⬡</span>
        <span class="review-chip-label">Not reviewed</span>
      </button>
      <button
        type="button"
        class="review-chip"
        data-state="self"
        role="radio"
        :aria-checked="record.reviewed_by === 'self'"
        :tabindex="record.reviewed_by === 'self' ? 0 : -1"
        title="You reviewed the VOD yourself."
        @click="emit('set-match-review', record.match_key, record.reviewed_by === 'self' ? '' : 'self')"
      >
        <span class="review-chip-glyph" aria-hidden="true">◐</span>
        <span class="review-chip-label">Self</span>
      </button>
      <button
        type="button"
        class="review-chip"
        data-state="coach"
        role="radio"
        :aria-checked="record.reviewed_by === 'coach'"
        :tabindex="record.reviewed_by === 'coach' ? 0 : -1"
        title="A coach reviewed the VOD with you."
        @click="emit('set-match-review', record.match_key, record.reviewed_by === 'coach' ? '' : 'coach')"
      >
        <span class="review-chip-glyph" aria-hidden="true">★</span>
        <span class="review-chip-label">Coach</span>
      </button>
    </div>
  </div>

  <!-- "Since this match" anchor toggle. Marks the match as the
         reference point for the Matches narrow panel's "Since {match}"
         filter so the user (or their coach) can ask "how have I done
         since this checkpoint?" — independent of whether the match
         itself was reviewed. Only one anchor can be set at a time;
         clicking on a non-anchor match displaces the previous anchor.
         The sublabel explains the consequence inline because a
         tooltip-only explanation fails for touch + keyboard users. -->
  <div class="since-anchor-row">
    <button
      type="button"
      class="since-anchor-btn"
      :class="{ 'is-anchor': isAnchor }"
      :data-anchor-set="isAnchor || undefined"
      data-set-anchor
      :title="isAnchor
        ? 'This match is your reference point. Click to clear.'
        : 'Mark this match as your reference — the Matches view can then filter to matches after this one.'"
      @click="emit('set-anchor', isAnchor ? '' : record.match_key)"
    >
      <span class="since-anchor-glyph" aria-hidden="true">{{ isAnchor ? '◆' : '◇' }}</span>
      <span class="since-anchor-copy">
        <span class="since-anchor-label">
          {{ isAnchor ? 'Filtering from this match' : 'Filter from this match' }}
        </span>
        <span class="since-anchor-sublabel">
          {{ isAnchor
            ? 'Reference set. Click to clear. Toggle the filter in Narrow → Since this match.'
            : 'Marks this as your reference point. Use Narrow → Since this match to apply.' }}
        </span>
      </span>
    </button>
  </div>
</template>

<style scoped src="./match-status-choosers.css"></style>
