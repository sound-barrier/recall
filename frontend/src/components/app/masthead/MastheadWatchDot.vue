<script setup lang="ts">
import { computed } from 'vue'
import type { WatchStateEnum } from '@/api-client'
import type { ParseProgressEvent, WatchActivityEvent } from '@/components/ingest/parse-progress'
import { formatIgnoredAt } from '@/match/match-time-helpers'

// The masthead's folder-watch pilot light: a dim-green "WATCHING" dot
// whenever the watcher is running, growing to "WATCHING · N NEW" as
// screenshots queue behind the debounce. While a parse is in flight the
// accent-pulsing MastheadParseChip owns the masthead slot, so the dot
// yields (same inFlight predicate the chip uses). The tooltip carries
// the most recent watcher activity — session-scoped: on reload the dot
// starts idle until the next watch-activity event. It follows what the
// watcher is DOING (watchState), not the Watch setting: with the folder
// gone it reads "FOLDER UNAVAILABLE" until the watcher finds it again.
const props = defineProps<{
  watchState: WatchStateEnum | undefined
  activity: WatchActivityEvent | null
  parseProgress: ParseProgressEvent | null
}>()

const parseInFlight = computed(() => {
  const p = props.parseProgress
  return !!p && p.total > 0 && p.done < p.total
})

const visible = computed(() =>
  (props.watchState === 'watching' || props.watchState === 'unavailable') && !parseInFlight.value)
const unavailable = computed(() => props.watchState === 'unavailable')
const pending = computed(() => (unavailable.value ? 0 : props.activity?.pending ?? 0))

const tooltip = computed(() => {
  if (unavailable.value) {
    return "Watch is on, but the screenshots folder can't be read — watching resumes when it's back"
  }
  const ts = props.activity?.last_seen_at
  if (!ts) return 'Watching the screenshots folder for new captures'
  return `Last new screenshot: ${formatIgnoredAt(ts)}`
})
</script>

<template>
  <span
    v-if="visible"
    class="masthead-watch-dot"
    :class="{ pending: pending > 0, unavailable }"
    :title="tooltip"
  >
    <span class="mwd-pip" aria-hidden="true" />
    <span v-if="unavailable" class="mwd-label">FOLDER UNAVAILABLE</span>
    <span v-else class="mwd-label">WATCHING<template v-if="pending > 0"> · {{ pending }} NEW</template></span>
  </span>
</template>

<style scoped>
.masthead-watch-dot {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-family: var(--mono);
  font-size: var(--type-2xs);
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--text-faint);
  white-space: nowrap;
}

.mwd-pip {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--win) 55%, transparent);
}

/* Files queued behind the debounce — the dot warms up toward the
   accent so the count reads as "something is about to happen". */
.masthead-watch-dot.pending {
  color: var(--text-dim);
}

.masthead-watch-dot.pending .mwd-pip {
  background: var(--accent);
}

/* Watch is on but there is no folder to watch — the pip goes hollow so the
   light reads as "not running", not as another shade of "running". */
.masthead-watch-dot.unavailable {
  color: var(--text-dim);
}

.masthead-watch-dot.unavailable .mwd-pip {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--loss);
}
</style>
