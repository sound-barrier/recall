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
    <span class="queue-chooser-eyebrow" aria-hidden="true">Queue</span>
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
    <span class="play-mode-chooser-eyebrow" aria-hidden="true">Play mode</span>
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
    <span class="review-chooser-eyebrow" aria-hidden="true">Review status</span>
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

<style scoped>
/* ─── Review-status chooser (top of panel) ───────────────────

   The FIRST artefact in the panel body — a tri-segmented control
   that reads as a definitive metadata stamp. Visual vocabulary:
   tactical eyebrow + a high-contrast button group rendered as
   three sharp-cornered cells. The active cell carries an accent
   fill + an inset shadow so it reads as "stamped" rather than
   "selected". Inactive cells are ghosted, so the eye lands on the
   chosen state instantly.

   The eyebrow + chips share a thick double-strut border so the
   block reads as one "review console" — a stack ABOVE the
   meta-strip with its own architectural identity, not yet
   another row of chips. */

/* Queue-type chooser sits ABOVE the review chooser — the queue
   frames every downstream stat (5v5 winrate ≠ 6v6 winrate), so the
   user picks this first. Visually a sibling block to .review-chooser
   with the same chip grid; the two active accents distinguish "role"
   from "open" without implying one is better than the other. */
.queue-chooser {
  margin: 0 0 0.75rem;
  padding: 0.55rem 0.6rem 0.5rem;
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--accent) 6%, transparent) 0%,
      transparent 100%);
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.4rem;
}

.queue-chooser-eyebrow {
  display: block;
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--text-faint);
  border-bottom: 1px dashed var(--hairline);
  padding-bottom: 0.3rem;
}

.queue-chips {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.35rem;
}

.queue-chip {
  appearance: none;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.18rem;
  padding: 0.55rem 0.5rem 0.5rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 1px;
  font-family: var(--mono);
  color: var(--text-dim);
  cursor: pointer;
  position: relative;
  isolation: isolate;
  transition: color 140ms ease, background 140ms ease, border-color 140ms ease, transform 140ms ease, box-shadow 140ms ease;
}

.queue-chip:hover {
  color: var(--text);
  border-color: var(--text-faint);
  transform: translateY(-1px);
}

.queue-chip:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.queue-chip-glyph {
  font-size: 1rem;
  line-height: 1;
  color: var(--text-faint);
  transition: color 140ms ease, transform 140ms ease;
}

.queue-chip-label {
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.queue-chip[data-state="none"][aria-checked="true"] {
  color: var(--text);
  border-color: var(--text);
  background: var(--surface-2);
  box-shadow:
    inset 0 0 0 1px var(--text-faint),
    inset 0 1px 0 var(--hairline);
}

.queue-chip[data-state="role"][aria-checked="true"] {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow:
    inset 0 0 0 1px var(--accent),
    0 0 12px -6px var(--accent);
}

.queue-chip[data-state="open"][aria-checked="true"] {
  color: var(--win);
  border-color: var(--win-line);
  background: var(--win-soft, color-mix(in srgb, var(--win) 12%, transparent));
  box-shadow:
    inset 0 0 0 1px var(--win-line),
    0 0 14px -6px var(--win-line);
}

.queue-chip[aria-checked="true"] .queue-chip-glyph {
  color: currentcolor;
  transform: scale(1.08);
}

@media (prefers-reduced-motion: reduce) {
  .queue-chip,
  .queue-chip-glyph {
    transition: none;
  }
}

/* Play-mode chooser sits between the queue chooser and the review
   chooser. Visually parallel but with a tighter top margin so the
   two framing controls (queue + play mode) read as a unit. The
   active accents (quickplay / competitive) re-use the existing
   accent / win color tokens — same shape language as queue. */
.play-mode-chooser {
  margin: 0 0 0.75rem;
  padding: 0.55rem 0.6rem 0.5rem;
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--accent) 5%, transparent) 0%,
      transparent 100%);
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.4rem;
}

.play-mode-chooser-eyebrow {
  display: block;
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--text-faint);
  border-bottom: 1px dashed var(--hairline);
  padding-bottom: 0.3rem;
}

.play-mode-chips {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.35rem;
}

.play-mode-chip {
  appearance: none;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.18rem;
  padding: 0.55rem 0.5rem 0.5rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 1px;
  font-family: var(--mono);
  color: var(--text-dim);
  cursor: pointer;
  position: relative;
  isolation: isolate;
  transition: color 140ms ease, background 140ms ease, border-color 140ms ease, transform 140ms ease, box-shadow 140ms ease;
}

.play-mode-chip:hover {
  color: var(--text);
  border-color: var(--text-faint);
  transform: translateY(-1px);
}

.play-mode-chip:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.play-mode-chip-glyph {
  font-size: 1rem;
  line-height: 1;
  color: var(--text-faint);
  transition: color 140ms ease, transform 140ms ease;
}

.play-mode-chip-label {
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.play-mode-chip[data-state="none"][aria-checked="true"] {
  color: var(--text);
  border-color: var(--text);
  background: var(--surface-2);
  box-shadow:
    inset 0 0 0 1px var(--text-faint),
    inset 0 1px 0 var(--hairline);
}

.play-mode-chip[data-state="quickplay"][aria-checked="true"] {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow:
    inset 0 0 0 1px var(--accent),
    0 0 12px -6px var(--accent);
}

.play-mode-chip[data-state="competitive"][aria-checked="true"] {
  color: var(--win);
  border-color: var(--win-line);
  background: var(--win-soft, color-mix(in srgb, var(--win) 12%, transparent));
  box-shadow:
    inset 0 0 0 1px var(--win-line),
    0 0 14px -6px var(--win-line);
}

.play-mode-chip[aria-checked="true"] .play-mode-chip-glyph {
  color: currentcolor;
  transform: scale(1.08);
}

@media (prefers-reduced-motion: reduce) {
  .play-mode-chip,
  .play-mode-chip-glyph {
    transition: none;
  }
}

.review-chooser {
  margin: 0 0 1rem;
  padding: 0.55rem 0.6rem 0.5rem;
  border: 1px solid var(--border);
  border-left: 3px solid var(--text-faint);
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--surface-3) 60%, transparent) 0%,
      transparent 100%);
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.4rem;
}

/* "Since this match" anchor toggle. Sits right below the review
   chooser so the two timeline-adjacent affordances (mark as
   reviewed + mark as anchor) read as a unit. The active state uses
   the accent palette and a filled diamond glyph so the user can
   tell at a glance which match is the current anchor — useful when
   scanning a list and reopening the same panel later. */
.since-anchor-row {
  margin: -0.5rem 0 1rem;
  display: flex;
}

.since-anchor-btn {
  appearance: none;
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.6rem;
  padding: 0.5rem 0.7rem;
  font-family: var(--mono);
  color: var(--text-dim);
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: 2px;
  cursor: pointer;
  text-align: left;
  transition:
    background 140ms ease,
    color 140ms ease,
    border-color 140ms ease,
    box-shadow 140ms ease;
}

.since-anchor-copy {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.since-anchor-label {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  line-height: 1.1;
}

/* Inline subtitle that explains the consequence in plain language —
   tooltips don't reach touch + keyboard users, and "anchor" alone
   is jargon without context. Color is text-faint at idle, brighter
   on hover / when active. */
.since-anchor-sublabel {
  font-size: 0.62rem;
  letter-spacing: 0.04em;
  text-transform: none;
  font-weight: 500;
  color: var(--text-faint);
  line-height: 1.25;
}

.since-anchor-btn:hover {
  border-color: var(--accent);
  color: var(--text);
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.since-anchor-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}

.since-anchor-btn.is-anchor {
  border-style: solid;
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
}

.since-anchor-btn:hover .since-anchor-sublabel,
.since-anchor-btn.is-anchor .since-anchor-sublabel {
  color: var(--text-dim);
}

.since-anchor-glyph {
  font-size: 0.85rem;
  line-height: 1;
}

.review-chooser-eyebrow {
  display: block;
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--text-faint);
  border-bottom: 1px dashed var(--hairline);
  padding-bottom: 0.3rem;
}

.review-chips {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.35rem;
}

.review-chip {
  appearance: none;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.18rem;
  padding: 0.55rem 0.5rem 0.5rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 1px;
  font-family: var(--mono);
  color: var(--text-dim);
  cursor: pointer;
  position: relative;
  isolation: isolate;
  transition: color 140ms ease, background 140ms ease, border-color 140ms ease, transform 140ms ease, box-shadow 140ms ease;
}

.review-chip:hover {
  color: var(--text);
  border-color: var(--text-faint);
  transform: translateY(-1px);
}

.review-chip:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.review-chip-glyph {
  font-size: 1rem;
  line-height: 1;
  color: var(--text-faint);
  transition: color 140ms ease, transform 140ms ease;
}

.review-chip-label {
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

/* "Stamped" active state — each value gets its own accent. The
   `none` (default) chip reads as "the standing baseline" rather
   than a stamped pick: stronger border + inset shadow so the user
   sees it as the current state, but no accent colour fill (which
   would imply an affirmative action). */
.review-chip[data-state="none"][aria-checked="true"] {
  color: var(--text);
  border-color: var(--text);
  background: var(--surface-2);
  box-shadow:
    inset 0 0 0 1px var(--text-faint),
    inset 0 1px 0 var(--hairline);
}

.review-chip[data-state="self"][aria-checked="true"] {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow:
    inset 0 0 0 1px var(--accent),
    0 0 12px -6px var(--accent);
}

.review-chip[data-state="coach"][aria-checked="true"] {
  color: var(--win);
  border-color: var(--win-line);
  background: var(--win-soft, color-mix(in srgb, var(--win) 12%, transparent));
  box-shadow:
    inset 0 0 0 1px var(--win-line),
    0 0 14px -6px var(--win-line);
}

.review-chip[aria-checked="true"] .review-chip-glyph {
  color: currentcolor;
  transform: scale(1.08);
}

/* A thin "STAMPED" sticker rendered on the active chip — pure CSS,
   no extra DOM. Sits above the chip, anchored top-right. Stays
   hidden until the chip is the active radio. Deliberately scoped
   AWAY from data-state="none" — stamping "Not reviewed" with a ✓
   reads contradictorily ("checked Not reviewed" ≈ "yes, reviewed"). */
.review-chip[data-state="self"][aria-checked="true"]::after,
.review-chip[data-state="coach"][aria-checked="true"]::after {
  content: "✓";
  position: absolute;
  top: -1px;
  right: 4px;
  font-size: 0.6rem;
  font-weight: 700;
  color: currentcolor;
  letter-spacing: 0;
  opacity: 0.85;
}

@media (prefers-reduced-motion: reduce) {
  .review-chip,
  .review-chip-glyph {
    transition: none;
  }
}

</style>
