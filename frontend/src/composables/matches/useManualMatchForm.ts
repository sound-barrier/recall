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

  // Optional annotation fields — replay code, a note, free-form tags, and the
  // group (teammates) the user queued with. All ride the match annotation.
  const replayCode = ref('')
  const note = ref('')
  const tags = ref<string[]>([])
  const tagDraft = ref('')
  const members = ref<string[]>([])
  const memberDraft = ref('')

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

  // Tags are lowercased (the app's tag convention); members are kept verbatim
  // so `Apollo#11234` and `apollo#11234` stay distinct. Both dedupe.
  function addTag(name?: string) {
    const t = (name ?? tagDraft.value).trim().toLowerCase()
    if (t && !tags.value.includes(t)) tags.value.push(t)
    tagDraft.value = ''
  }
  function removeTag(name: string) {
    tags.value = tags.value.filter((t) => t !== name)
  }
  function addMember(name?: string) {
    const m = (name ?? memberDraft.value).trim()
    if (m && !members.value.includes(m)) members.value.push(m)
    memberDraft.value = ''
  }
  function removeMember(name: string) {
    members.value = members.value.filter((m) => m !== name)
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

  // Rank is only sent for a competitive match with a tier picked (see toInput).
  // When it is, progress and RR change are free-typed numbers, so validate them
  // against the bounds the server enforces (the selects already constrain tier
  // and division). An invalid rank blocks submit and surfaces rankError.
  const rankActive = computed(() => isCompetitive.value && rankTier.value.trim() !== '')
  const rankError = computed(() => {
    if (!rankActive.value) return ''
    const p = rankProgress.value
    const c = rankChange.value
    if (Number.isNaN(p) || p < 0 || p > 100) return 'Progress must be between 0 and 100.'
    if (Number.isNaN(c) || c < -1_000_000 || c > 1_000_000) return 'RR change must be within ±1,000,000.'
    return ''
  })
  const rankValid = computed(() => rankError.value === '')

  const canSubmit = computed(() => missingRequired.value.length === 0 && rankValid.value)

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
    // Optional annotation fields — only sent when the user filled them in.
    if (replayCode.value.trim()) input.replay_code = replayCode.value.trim()
    if (note.value.trim()) input.note = note.value.trim()
    if (tags.value.length) input.tags = [...tags.value]
    if (members.value.length) input.members = [...members.value]
    return input
  }

  return {
    map, playMode, queueType, roleCategory, heroes, heroDraft, result, leaver, playedAt,
    replayCode, note, tags, tagDraft, members, memberDraft,
    rankTier, rankDivision, rankProgress, rankChange, demotionProtection,
    isCompetitive, isRoleQueue, primaryHero,
    addHero, removeHero, addTag, removeTag, addMember, removeMember,
    canSubmit, missingRequired, rankActive, rankError, rankValid, toInput,
  }
}
