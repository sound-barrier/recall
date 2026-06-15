import { computed, ref } from 'vue'
import type { ManualMatchInput } from '@/api'

// Form state + light validation for hand-entering a match (no OCR). Required:
// map, play mode, queue, result, ≥1 hero (heroes[0] is the primary). Rank is
// competitive-only and optional. `roleCategory` is UI-only — it narrows the
// hero picker on role queue; the server derives role from the primary hero.

function localNowValue(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function useManualMatchForm() {
  const map = ref('')
  const playMode = ref<'' | 'quickplay' | 'competitive'>('')
  const queueType = ref<'' | 'role' | 'open'>('')
  const roleCategory = ref<'' | 'tank' | 'damage' | 'support'>('')
  const heroes = ref<string[]>([])
  const heroDraft = ref('')
  const result = ref<'' | 'victory' | 'defeat' | 'draw'>('')
  const leaver = ref<'' | 'self' | 'team' | 'enemy'>('')
  const playedAt = ref(localNowValue())

  const rankTier = ref('')
  const rankDivision = ref(1)
  const rankProgress = ref(0)
  const rankChange = ref(0)
  const demotionProtection = ref(false)

  const isCompetitive = computed(() => playMode.value === 'competitive')
  const isRoleQueue = computed(() => queueType.value === 'role')
  const primaryHero = computed(() => heroes.value[0] ?? '')

  function addHero(name?: string) {
    const h = (name ?? heroDraft.value).trim()
    if (h && !heroes.value.includes(h)) heroes.value.push(h)
    heroDraft.value = ''
  }

  function removeHero(name: string) {
    heroes.value = heroes.value.filter((h) => h !== name)
  }

  // Required fields, in display order — drives both canSubmit and the footer's
  // "still needed" hint so the user knows why Add is disabled.
  const missingRequired = computed(() => {
    const out: string[] = []
    if (map.value.trim() === '') out.push('map')
    if (playMode.value === '') out.push('mode')
    if (queueType.value === '') out.push('queue')
    // Role queue is a single-role queue: you play one role the whole match, so
    // the category is mandatory and constrains the hero list. Open queue lets
    // you swap across roles freely, so it's not required there.
    if (queueType.value === 'role' && roleCategory.value === '') out.push('role')
    if (result.value === '') out.push('result')
    if (heroes.value.length === 0) out.push('a hero')
    return out
  })

  const canSubmit = computed(() => missingRequired.value.length === 0)

  // Assemble the wire payload. Pre-condition: canSubmit (the casts below are
  // safe once the required enums are non-empty).
  function toInput(): ManualMatchInput {
    const input: ManualMatchInput = {
      map: map.value.trim(),
      play_mode: playMode.value as 'quickplay' | 'competitive',
      queue_type: queueType.value as 'role' | 'open',
      heroes: [...heroes.value],
      result: result.value as 'victory' | 'defeat' | 'draw',
    }
    if (playedAt.value) {
      input.played_at = new Date(playedAt.value).toISOString()
    }
    if (isCompetitive.value && rankTier.value.trim() !== '') {
      input.rank = {
        tier: rankTier.value.trim(),
        division: rankDivision.value,
        progress: rankProgress.value,
        change_percent: rankChange.value,
        demotion_protection: demotionProtection.value,
      }
    }
    if (leaver.value) {
      input.leaver = leaver.value
    }
    return input
  }

  return {
    map, playMode, queueType, roleCategory, heroes, heroDraft, result, leaver, playedAt,
    rankTier, rankDivision, rankProgress, rankChange, demotionProtection,
    isCompetitive, isRoleQueue, primaryHero,
    addHero, removeHero, canSubmit, missingRequired, toInput,
  }
}
