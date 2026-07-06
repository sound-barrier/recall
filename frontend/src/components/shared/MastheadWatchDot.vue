<script setup lang="ts">
import { computed } from 'vue'
import type { ParseProgressEvent, WatchActivityEvent } from '@/components/ingest/parse-progress'
import { formatIgnoredAt } from '@/match/match-time-helpers'

// The masthead's folder-watch pilot light: a dim-green "WATCHING" dot
// whenever the watcher is enabled, growing to "WATCHING · N NEW" as
// screenshots queue behind the debounce. While a parse is in flight the
// accent-pulsing MastheadParseChip owns the masthead slot, so the dot
// yields (same inFlight predicate the chip uses). The tooltip carries
// the most recent watcher activity — session-scoped: on reload the dot
// starts idle until the next watch-activity event.
const props = defineProps<{
  watchEnabled: boolean
  activity: WatchActivityEvent | null
  parseProgress: ParseProgressEvent | null
}>()

const parseInFlight = computed(() => {
  const p = props.parseProgress
  return !!p && p.total > 0 && p.done < p.total
})

const visible = computed(() => props.watchEnabled && !parseInFlight.value)
const pending = computed(() => props.activity?.pending ?? 0)

const tooltip = computed(() => {
  const ts = props.activity?.last_seen_at
  if (!ts) return 'Watching the screenshots folder for new captures'
  return `Last new screenshot: ${formatIgnoredAt(ts)}`
})
</script>

<template>
  <span
    v-if="visible"
    class="masthead-watch-dot"
    :class="{ pending: pending > 0 }"
    :title="tooltip"
  >
    <span class="mwd-pip" aria-hidden="true" />
    <span class="mwd-label">WATCHING<template v-if="pending > 0"> · {{ pending }} NEW</template></span>
  </span>
</template>

<style scoped>
.masthead-watch-dot {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--mono);
  font-size: 0.58rem;
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
</style>
