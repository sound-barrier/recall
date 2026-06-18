import { computed } from 'vue'

import {
  type MatchAnnotationInput,
  type UserMatchDataInput,
  type ReviewedBy,
  type QueueType,
  type PlayMode,
  RevealScreenshotsDir,
  SetMatchAnnotation,
  HardDeleteMatch,
  SetMatchVisibility,
  MoveMatches,
  UpdateMatchData,
  ResetMatchData,
  SetMatchReview,
  SetMatchQueue,
  SetMatchPlayMode,
  BulkSetMatchPlayMode,
  BulkSetMatchQueue,
  ResolveAmbiguousMatch,
  IgnoreScreenshot,
} from '@/api'
import { useMatchesStore } from '@/stores/matches'
import { useAppStore } from '@/stores/app'

// Match-mutation handlers shared by the row context menu, the archive drawer's
// bulk-action bar, and the detail panel — copy replay/link, reveal the source
// folder, bulk-tag, (bulk) hard-delete, bulk-unhide, bulk-move-to-profile,
// per-match annotation/data/status edits, ambiguous-resolve, ignore-screenshot.
// Reads the matches + app stores directly and holds no state of its own, so any
// component can call useMatchActions() and get the same handlers (the detail
// panel does, to drop a pile of props/emits).
//
// Each handler does one job and surfaces failures through `onError`; the
// menu/bar is already closed by the time the action runs, so the user sees
// the action fail, not the menu. The pending detail-panel focus target lives
// in the UI store (useUiStore) since the panel reads it on mount.
export function useMatchActions() {
  const matchesStore = useMatchesStore()
  const appStore = useAppStore()
  const records = computed(() => matchesStore.records)
  const reload = () => matchesStore.load()
  const reloadIgnored = () => matchesStore.loadIgnored()
  const setError = (message: string) => appStore.setError(message)
  const onError = (raw: string) => appStore.setErrorFromRaw(raw)

  async function onCopyReplayCode(matchKey: string) {
    const r = records.value.find(x => x.match_key === matchKey)
    const code = (r?.annotation?.replay_code ?? '').trim()
    if (!code) {
      setError('No replay code on this match.')
      return
    }
    try {
      await navigator.clipboard.writeText(code)
    } catch (e) {
      onError(String(e))
    }
  }

  async function onCopyMatchLink(matchKey: string) {
    // The "match link" is just the key today — no recall:// deep-link
    // scheme yet, so the pasted text is what the user drops into Discord
    // for a teammate to grep against their corpus. Swap to a URL once one
    // exists.
    try {
      await navigator.clipboard.writeText(matchKey)
    } catch (e) {
      onError(String(e))
    }
  }

  async function onOpenSourceFolder(_matchKey: string) {
    // Reveals the configured screenshots dir — every match's source files
    // live there for new users. Per-record dir resolution is a follow-up;
    // _matchKey stays in the signature so the API is forward-compatible.
    try {
      await RevealScreenshotsDir()
    } catch (e) {
      onError(String(e))
    }
  }

  async function onBulkTag(matchKeys: string[], tag: string) {
    if (matchKeys.length === 0 || !tag) return
    const norm = tag.trim().toLowerCase()
    if (!norm) return
    try {
      // Snapshot records by key so each PUT carries the existing annotation
      // fields (the PUT replaces the whole annotation row, so a slim body
      // would clear note / replay_code / members / leaver).
      const byKey = new Map(records.value.map((r) => [r.match_key, r] as const))
      await Promise.all(matchKeys.map(async (key) => {
        const r = byKey.get(key)
        const existing = r?.annotation
        const existingTags = existing?.tags ?? []
        if (existingTags.includes(norm)) return // already tagged
        await SetMatchAnnotation(key, {
          leaver:      (existing?.leaver ?? '') as MatchAnnotationInput['leaver'],
          note:        existing?.note ?? undefined,
          replay_code: existing?.replay_code ?? undefined,
          members:     existing?.members ?? undefined,
          tags:        [...existingTags, norm],
        })
      }))
      await reload()
    } catch (e) {
      onError(String(e))
    }
  }

  // Hard-delete — drawer "Delete forever" after the two-step confirm.
  // Idempotent server-side, so a double-fire from a stale UI is safe.
  async function onHardDeleteMatch(matchKey: string) {
    try {
      await HardDeleteMatch(matchKey)
      await reload()
    } catch (e) {
      onError(String(e))
    }
  }

  // Bulk unhide — Archive drawer's bulk-action bar. Fan out in parallel,
  // single reload when all PUTs settle.
  async function onUnhideMatches(matchKeys: string[]) {
    if (matchKeys.length === 0) return
    try {
      await Promise.all(matchKeys.map((k) => SetMatchVisibility(k, false)))
      await reload()
    } catch (e) {
      onError(String(e))
    }
  }

  async function onHardDeleteMatches(matchKeys: string[]) {
    if (matchKeys.length === 0) return
    try {
      await Promise.all(matchKeys.map((k) => HardDeleteMatch(k)))
      await reload()
    } catch (e) {
      onError(String(e))
    }
  }

  // Bulk move-to-profile — server runs the two-phase transfer (write
  // target, delete source); reload after so moved rows leave the dossier.
  async function onMoveMatches(matchKeys: string[], targetProfile: string) {
    if (matchKeys.length === 0) return
    try {
      await MoveMatches(matchKeys, targetProfile)
      await reload()
    } catch (e) {
      onError(String(e))
    }
  }

  // ── Annotation + per-match data edits (detail panel / cards) ──────
  async function onSetLeaverAnnotation(matchKey: string, leaver: '' | 'self' | 'team' | 'enemy') {
    try {
      const rec = records.value.find(r => r.match_key === matchKey)
      const prev = rec?.annotation
      await SetMatchAnnotation(matchKey, {
        leaver:      leaver as MatchAnnotationInput['leaver'],
        note:        prev?.note ?? '',
        replay_code: prev?.replay_code ?? '',
        members:     prev?.members ?? [],
        tags:        prev?.tags ?? [],
      })
      await reload()
    } catch (e) { onError(String(e)) }
  }
  async function onSetMatchAnnotation(matchKey: string, input: MatchAnnotationInput) {
    try { await SetMatchAnnotation(matchKey, input); await reload() } catch (e) { onError(String(e)) }
  }
  async function onUpdateMatchData(matchKey: string, overrides: UserMatchDataInput) {
    try { await UpdateMatchData(matchKey, overrides); await reload() } catch (e) { onError(String(e)) }
  }
  async function onResetMatchData(matchKey: string) {
    try { await ResetMatchData(matchKey); await reload() } catch (e) { onError(String(e)) }
  }

  // ── Per-match status (hide / review / queue / play-mode) ──────────
  async function onSetMatchHidden(matchKey: string, hidden: boolean) {
    try { await SetMatchVisibility(matchKey, hidden); await reload() } catch (e) { onError(String(e)) }
  }
  async function onSetMatchReview(matchKey: string, reviewedBy: ReviewedBy) {
    try { await SetMatchReview(matchKey, reviewedBy); await reload() } catch (e) { onError(String(e)) }
  }
  async function onSetMatchQueue(matchKey: string, queueType: QueueType) {
    try { await SetMatchQueue(matchKey, queueType); await reload() } catch (e) { onError(String(e)) }
  }
  async function onSetMatchPlayMode(matchKey: string, playMode: PlayMode) {
    try { await SetMatchPlayMode(matchKey, playMode); await reload() } catch (e) { onError(String(e)) }
  }

  // ── Bulk (archive drawer) ─────────────────────────────────────────
  async function onHideMatches(matchKeys: string[]) {
    if (matchKeys.length === 0) return
    try { await Promise.all(matchKeys.map((k) => SetMatchVisibility(k, true))); await reload() } catch (e) { onError(String(e)) }
  }
  async function onBulkPlayMode(matchKeys: string[], playMode: PlayMode) {
    if (matchKeys.length === 0) return
    try { await BulkSetMatchPlayMode(matchKeys, playMode); await reload() } catch (e) { onError(String(e)) }
  }
  async function onBulkQueue(matchKeys: string[], queueType: QueueType) {
    if (matchKeys.length === 0) return
    try { await BulkSetMatchQueue(matchKeys, queueType); await reload() } catch (e) { onError(String(e)) }
  }

  // ── Unknown-tab resolution ────────────────────────────────────────
  async function onResolveAmbiguous(ambiguousKey: string, resolvedTo: string) {
    try { await ResolveAmbiguousMatch(ambiguousKey, resolvedTo); await reload() } catch (e) { onError(String(e)) }
  }
  // "Delete forever" — suppress the filename + wipe the unmatched row.
  async function onIgnoreScreenshot(filename: string) {
    try { await IgnoreScreenshot(filename); await reloadIgnored(); await reload() } catch (e) { onError(String(e)) }
  }

  return {
    onCopyReplayCode,
    onCopyMatchLink,
    onOpenSourceFolder,
    onBulkTag,
    onHardDeleteMatch,
    onUnhideMatches,
    onHardDeleteMatches,
    onMoveMatches,
    onSetLeaverAnnotation,
    onSetMatchAnnotation,
    onUpdateMatchData,
    onResetMatchData,
    onSetMatchHidden,
    onSetMatchReview,
    onSetMatchQueue,
    onSetMatchPlayMode,
    onHideMatches,
    onBulkPlayMode,
    onBulkQueue,
    onResolveAmbiguous,
    onIgnoreScreenshot,
  }
}
