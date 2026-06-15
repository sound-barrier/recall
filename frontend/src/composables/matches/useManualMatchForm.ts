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

  const canSubmit = computed(
    () =>
      map.value.trim() !== '' &&
      playMode.value !== '' &&
      queueType.value !== '' &&
      result.value !== '' &&
      heroes.value.length > 0,
  )

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
    return input
  }

  return {
    map, playMode, queueType, roleCategory, heroes, heroDraft, result, playedAt,
    rankTier, rankDivision, rankProgress, rankChange, demotionProtection,
    isCompetitive, isRoleQueue, primaryHero,
    addHero, removeHero, canSubmit, toInput,
  }
}
