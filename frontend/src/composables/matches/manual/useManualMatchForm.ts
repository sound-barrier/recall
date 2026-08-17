import { computed, ref, type InjectionKey, type Ref } from 'vue'
import type { DisruptionSide, ManualMatchInput } from '@/api-client'

// Form state + light validation for hand-entering a match (no OCR). Required:
// map, play mode, queue, result, ≥1 hero (heroes[0] is the primary). Rank is
// competitive-only and optional. `roleCategory` is UI-only — it narrows the
// hero picker on role queue; the server derives role from the primary hero.

function localNowValue(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// localOffsetISO turns the datetime-local input value ('YYYY-MM-DDTHH:MM',
// naive local) into RFC3339 WITH the local offset for that instant
// ('YYYY-MM-DDTHH:MM:00±HH:MM') — never toISOString(), which converts to
// UTC and shifts the wall clock. The Go side derives match key / date /
// finished_at from the STATED wall clock, keeping manual rows on the same
// naive-local time axis as OCR rows. The offset is computed from the
// entered instant itself, so it is DST-correct for that date.
function localOffsetISO(dtLocal: string): string {
  const offsetMin = -new Date(dtLocal).getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dtLocal}:00${sign}${pad(Math.trunc(abs / 60))}:${pad(abs % 60)}`
}

// 'full' is the complete hand-entry form. 'leaver-exit' is the quick-add for a
// match Overwatch erased from history: map + result and nothing else, because
// that is genuinely all the user knows. It pre-tags both leaver sides — a
// teammate left, which is what let you leave, and then you did.
export type ManualMatchMode = 'full' | 'leaver-exit'

export function useManualMatchForm(mode: ManualMatchMode = 'full') {
  const map = ref('')
  const playMode = ref<'' | 'quickplay' | 'competitive'>('')
  const queueType = ref<'' | 'role' | 'open'>('')
  const roleCategory = ref<'' | 'tank' | 'damage' | 'support'>('')
  const heroes = ref<string[]>([])
  const heroDraft = ref('')
  const result = ref<'' | 'victory' | 'defeat' | 'draw'>('')
  // Disruption sides are SETS — "a teammate left, then I left" is both. The
  // leaver-exit quick-add seeds exactly that pair.
  const leavers = ref<DisruptionSide[]>(mode === 'leaver-exit' ? ['team', 'self'] : [])
  const throwers = ref<DisruptionSide[]>([])
  const toggleSide = (set: Ref<DisruptionSide[]>, side: DisruptionSide) => {
    set.value = set.value.includes(side)
      ? set.value.filter((s) => s !== side)
      : [...set.value, side]
  }
  const toggleLeaver = (side: DisruptionSide) => toggleSide(leavers, side)
  const toggleThrower = (side: DisruptionSide) => toggleSide(throwers, side)
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
    // The quick-add asks for two things only; everything below is either
    // unknown to the user or irrelevant to a match they walked out of.
    if (mode === 'leaver-exit') {
      if (result.value === '') out.push('result')
      return out
    }
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

  // Rank is only sent for a competitive match with a tier picked.
  function applyRank(input: ManualMatchInput): void {
    if (isCompetitive.value && rankTier.value.trim() !== '') {
      input.rank = {
        tier: rankTier.value.trim(),
        division: rankDivision.value,
        progress: rankProgress.value,
        change_percent: rankChange.value,
        demotion_protection: demotionProtection.value,
      }
    }
  }

  // Optional annotation fields — only sent when the user filled them in.
  function applyAnnotationFields(input: ManualMatchInput): void {
    if (leavers.value.length) input.leavers = [...leavers.value]
    if (throwers.value.length) input.throwers = [...throwers.value]
    if (replayCode.value.trim()) input.replay_code = replayCode.value.trim()
    if (note.value.trim()) input.note = note.value.trim()
    if (tags.value.length) input.tags = [...tags.value]
    if (members.value.length) input.members = [...members.value]
  }

  // Assemble the wire payload. Pre-condition: canSubmit (the casts below are
  // safe once the required enums are non-empty).
  function toInput(): ManualMatchInput {
    const input: ManualMatchInput = {
      map: map.value.trim(),
      result: result.value as 'victory' | 'defeat' | 'draw',
    }
    // Omitted rather than sent empty: the server treats an absent mode / queue
    // / hero as "not recorded", which is the truth for a quick-add.
    if (playMode.value !== '') input.play_mode = playMode.value
    if (queueType.value !== '') input.queue_type = queueType.value
    if (heroes.value.length) input.heroes = [...heroes.value]
    if (playedAt.value) {
      input.played_at = localOffsetISO(playedAt.value)
    }
    applyRank(input)
    applyAnnotationFields(input)
    return input
  }

  return {
    map, playMode, queueType, roleCategory, heroes, heroDraft, result, playedAt,
    leavers, throwers, toggleLeaver, toggleThrower,
    replayCode, note, tags, tagDraft, members, memberDraft,
    rankTier, rankDivision, rankProgress, rankChange, demotionProtection,
    isCompetitive, isRoleQueue, primaryHero,
    addHero, removeHero, addTag, removeTag, addMember, removeMember,
    mode, canSubmit, missingRequired, rankActive, rankError, rankValid, toInput,
  }
}

export type ManualMatchForm = ReturnType<typeof useManualMatchForm>

// Provide/inject seam: ManualMatchModal owns the single form instance and shares
// it with ManualMatchForm through this key, so the form child can mutate the
// reactive bundle directly (vue/no-mutating-props would flag the same bundle
// passed as a prop).
export const manualMatchFormKey: InjectionKey<ManualMatchForm> = Symbol('manualMatchForm')
