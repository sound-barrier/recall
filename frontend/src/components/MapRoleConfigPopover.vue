<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useMapRoleConfig, type MapRole } from '../composables/useMapRoleConfig'
import { useModalFocusTrap } from '../composables/useModalFocusTrap'
import { useOWData } from '../composables/useOWData'

// Gear popover for the Geography (Map × Role) band. Three live filter
// groups — roles, game modes, specific maps — applied to the band the
// instant they're toggled (no Save/Cancel; this is a view filter, so
// immediate feedback beats a commit step). "Empty = show all"; the
// Reset clears everything.
//
// Anchors to the gear rect + teleports to <body> (mirrors
// WidgetConfigPopover) so it stacks above the band without inheriting
// its clip. Focus trap + scroll-lock + Esc come from useModalFocusTrap.

const props = defineProps<{
  open: boolean
  anchor: DOMRect | null
}>()
const emit = defineEmits<{ close: [] }>()

const cfg = useMapRoleConfig()
const ow = useOWData()

const ROLES: { id: MapRole; label: string }[] = [
  { id: 'tank', label: 'Tank' },
  { id: 'dps', label: 'DPS' },
  { id: 'support', label: 'Support' },
]
const GAME_MODE_ORDER = ['control', 'escort', 'flashpoint', 'hybrid', 'push', 'clash']
const GAME_MODE_LABEL: Record<string, string> = {
  control: 'Control', escort: 'Escort', flashpoint: 'Flashpoint',
  hybrid: 'Hybrid', push: 'Push', clash: 'Clash',
}

// Map types actually present in the live roster, in canonical order.
const types = computed(() => {
  const present = new Set<string>()
  for (const [, { gameMode }] of ow.mapIndex.value) present.add(gameMode)
  return [...present].sort((a, b) => {
    const ai = GAME_MODE_ORDER.indexOf(a); const bi = GAME_MODE_ORDER.indexOf(b)
    return (ai < 0 ? GAME_MODE_ORDER.length : ai) - (bi < 0 ? GAME_MODE_ORDER.length : bi)
  })
})

// Every map's display name, alphabetised — the pickable roster.
const allMaps = computed(() => {
  const out: string[] = []
  for (const [, { display }] of ow.mapIndex.value) out.push(display)
  return out.sort((a, b) => a.localeCompare(b))
})

const mapQuery = ref('')
const filteredMaps = computed(() => {
  const q = mapQuery.value.trim().toLowerCase()
  if (!q) return allMaps.value
  return allMaps.value.filter((m) => m.toLowerCase().includes(q))
})

const roleSet = computed(() => new Set(cfg.config.value.roles))
const gameModeSet = computed(() => new Set(cfg.config.value.gameModes))
const mapSet = computed(() => new Set(cfg.config.value.maps))

const openRef = computed(() => props.open)
useModalFocusTrap(openRef, {
  containerSelector: '.mrc-popover',
  onClose: () => emit('close'),
})

// Click outside closes; ignore the gear trigger that mounted us.
const popoverRef = ref<HTMLDivElement | null>(null)
function onDocumentPointerDown(e: PointerEvent) {
  if (!props.open) return
  const t = e.target as HTMLElement | null
  if (!t) return
  if (popoverRef.value?.contains(t)) return
  if (t.closest('[data-mr-config-trigger]')) return
  emit('close')
}
onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown, true))

const POPOVER_WIDTH = 300
const POPOVER_HEIGHT_ESTIMATE = 380
const VIEWPORT_PADDING = 8

const popoverStyle = computed(() => {
  const a = props.anchor
  if (!a) return { display: 'none' }
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 720
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024
  const roomBelow = viewportH - (a.bottom + 6)
  const flipAbove = roomBelow < POPOVER_HEIGHT_ESTIMATE && a.top - 6 > roomBelow
  const top = flipAbove
    ? Math.max(VIEWPORT_PADDING, a.top - 6 - POPOVER_HEIGHT_ESTIMATE)
    : Math.max(VIEWPORT_PADDING, a.bottom + 6)
  const left = Math.max(VIEWPORT_PADDING, Math.min(a.right - POPOVER_WIDTH, viewportW - POPOVER_WIDTH - VIEWPORT_PADDING))
  return {
    top: `${top}px`,
    left: `${left}px`,
    maxHeight: `${viewportH - top - VIEWPORT_PADDING}px`,
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="mrc-fade">
      <div
        v-if="open"
        ref="popoverRef"
        class="mrc-popover"
        data-testid="map-role-config"
        role="dialog"
        aria-label="Geography filters"
        :style="popoverStyle"
      >
        <header class="mrc-head">
          <span class="mrc-eyebrow">Geography filters</span>
          <button
            type="button"
            class="mrc-reset"
            data-mr-reset
            :disabled="cfg.isDefault.value"
            @click="cfg.reset()"
          >
            Reset
          </button>
        </header>

        <section class="mrc-group" aria-label="Roles">
          <span class="mrc-label">Roles</span>
          <div class="mrc-pills">
            <button
              v-for="r in ROLES"
              :key="r.id"
              type="button"
              class="mrc-pill"
              :class="{ on: roleSet.has(r.id) }"
              :data-mr-role="r.id"
              :aria-pressed="roleSet.has(r.id)"
              @click="cfg.toggleRole(r.id)"
            >
              {{ r.label }}
            </button>
          </div>
        </section>

        <section class="mrc-group" aria-label="Map types">
          <span class="mrc-label">Map types</span>
          <div class="mrc-pills">
            <button
              v-for="t in types"
              :key="t"
              type="button"
              class="mrc-pill"
              :class="{ on: gameModeSet.has(t) }"
              :data-mr-game-mode="t"
              :aria-pressed="gameModeSet.has(t)"
              @click="cfg.toggleGameMode(t)"
            >
              {{ GAME_MODE_LABEL[t] ?? t }}
            </button>
          </div>
        </section>

        <section class="mrc-group" aria-label="Maps">
          <span class="mrc-label">
            Maps
            <span v-if="mapSet.size" class="mrc-count">{{ mapSet.size }}</span>
          </span>
          <input
            v-model="mapQuery"
            type="search"
            class="mrc-search"
            data-mr-map-search
            placeholder="Find a map…"
            aria-label="Search maps"
          >
          <ul class="mrc-maps" role="listbox" aria-multiselectable="true">
            <li v-for="m in filteredMaps" :key="m">
              <button
                type="button"
                class="mrc-map"
                :class="{ on: mapSet.has(m) }"
                :data-mr-map="m"
                role="option"
                :aria-selected="mapSet.has(m)"
                @click="cfg.toggleMap(m)"
              >
                <span class="mrc-check" aria-hidden="true">{{ mapSet.has(m) ? '✓' : '' }}</span>
                {{ m }}
              </button>
            </li>
            <li v-if="filteredMaps.length === 0" class="mrc-empty">
              No maps match.
            </li>
          </ul>
        </section>

        <p class="mrc-hint">
          Nothing selected shows everything.
        </p>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mrc-popover {
  position: fixed;
  z-index: 80;
  width: 300px;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.75rem 0.8rem 0.7rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 2px;
  box-shadow: 0 22px 48px -20px rgb(0 0 0 / 55%);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.mrc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mrc-eyebrow {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.mrc-reset {
  appearance: none;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 0.22rem 0.5rem;
  border-radius: 2px;
  cursor: pointer;
  transition: color 130ms ease, border-color 130ms ease;
}
.mrc-reset:hover:not(:disabled) { color: var(--loss); border-color: var(--loss-line, var(--loss)); }
.mrc-reset:disabled { opacity: 0.4; cursor: default; }
.mrc-reset:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }

.mrc-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.mrc-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--mono);
  font-size: 0.56rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 700;
}

.mrc-count {
  font-size: 0.55rem;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 999px;
  padding: 0 0.35rem;
  letter-spacing: 0;
}

.mrc-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.mrc-pill {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-dim);
  font-family: var(--display);
  font-style: italic;
  font-size: 0.82rem;
  letter-spacing: 0.02em;
  padding: 0.18rem 0.6rem;
  border-radius: 2px;
  cursor: pointer;
  transition: color 130ms ease, border-color 130ms ease, background 130ms ease;
}
.mrc-pill:hover { color: var(--text); border-color: var(--border-strong, var(--border)); }

.mrc-pill.on {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}
.mrc-pill:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }

.mrc-search {
  appearance: none;
  width: 100%;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.72rem;
  padding: 0.32rem 0.45rem;
  border-radius: 2px;
}
.mrc-search:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }

.mrc-maps {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 9.5rem;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 2px;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.mrc-map {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  appearance: none;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  background: transparent;
  color: var(--text-dim);
  font-family: var(--display);
  font-style: italic;
  font-size: 0.86rem;
  letter-spacing: 0.01em;
  text-align: left;
  padding: 0.26rem 0.45rem;
  cursor: pointer;
  transition: background 110ms ease, color 110ms ease;
}
.mrc-maps li:last-child .mrc-map { border-bottom: 0; }
.mrc-map:hover { background: var(--surface-2); color: var(--text); }
.mrc-map.on { color: var(--accent); }
.mrc-map:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--accent-soft); }

.mrc-check {
  display: inline-flex;
  justify-content: center;
  width: 0.9rem;
  color: var(--accent);
  font-family: var(--mono);
  font-size: 0.8rem;
}

.mrc-empty {
  padding: 0.4rem 0.45rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-faint);
  font-style: italic;
}

.mrc-hint {
  margin: 0;
  font-size: 0.68rem;
  color: var(--text-faint);
  font-style: italic;
}

.mrc-fade-enter-active,
.mrc-fade-leave-active { transition: opacity 140ms ease, transform 140ms ease; }

.mrc-fade-enter-from,
.mrc-fade-leave-to { opacity: 0; transform: translateY(-6px); }

@media (prefers-reduced-motion: reduce) {
  .mrc-fade-enter-active,
  .mrc-fade-leave-active,
  .mrc-pill,
  .mrc-map { transition: none; }
}
</style>
