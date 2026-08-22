import { ref, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'

import {
  ApiError, GetCoachSession, GetCoachSessionMatches, ListCoachReturns,
  type CoachReturnSheet, type CoachSessionView,
} from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'
import { COACH_SESSION_RESUME_KEY } from '@/composables/shared/storageKeys'

// Server state for the coaching loop: the coach's open session (plus the
// records it loaned the app) and the player's inbox of returned notes.
//
// The session read is GATED. A coach spends almost every launch with no
// session open, and asking a server that would answer 404 is a round-trip
// nobody asked for — so the app only asks when it left one open, which the
// resume flag in localStorage records. Opening a session seeds this cache
// entry directly, so even the open path never pays a second GET.

function readResumeFlag(): boolean {
  try { return localStorage.getItem(COACH_SESSION_RESUME_KEY) === 'true' }
  catch (_) { return false }
}

const resumeArmed = ref(readResumeFlag())

/** Record whether a session is open, so the next boot knows to resume it. */
export function setCoachSessionResume(open: boolean): void {
  try {
    if (open) localStorage.setItem(COACH_SESSION_RESUME_KEY, 'true')
    else localStorage.removeItem(COACH_SESSION_RESUME_KEY)
  } catch (_) { /* private mode / sandboxed context — the flag is a hint */ }
  resumeArmed.value = open
}

// A 404 is the ordinary answer to "is a session open" — it means no, not
// that something failed. Anything else stays an error so a broken server
// can't read as a quietly closed session.
async function fetchSessionOrNull(): Promise<CoachSessionView | null> {
  try {
    return await GetCoachSession()
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

export function useCoachSessionQuery() {
  return useQuery({
    queryKey: qk.coach.session,
    queryFn: fetchSessionOrNull,
    enabled: resumeArmed,
  }, getQueryClient())
}

// The loaned records. Gated on the session so it can't fire before one
// exists — and so ending a session stops it dead rather than 404-ing.
export function useCoachSessionMatchesQuery(active: MaybeRefOrGetter<boolean>) {
  return useQuery({
    queryKey: qk.coach.matches,
    queryFn: GetCoachSessionMatches,
    enabled: () => toValue(active),
  }, getQueryClient())
}

// The player's staged returns. Unlike the session this is NOT gated: the
// Matches banner has to nag about undecided notes on a cold boot, and the
// sheets live server-side, so there is no local flag that could stand in
// for asking.
export function useCoachReturnsQuery() {
  return useQuery({ queryKey: qk.coach.returns, queryFn: ListCoachReturns }, getQueryClient())
}

/** Seed the session cache from a just-opened bundle — no GET follows. */
export function setCoachSessionData(view: CoachSessionView | null): void {
  getQueryClient().setQueryData(qk.coach.session, view)
}

// The loaned corpus is a SEPARATE query from the session view, cached with
// staleTime: Infinity because a bundle's matches never change while it is
// open. A replay session's do: the coach adds codes and describes what they
// saw, and both rewrite the records the reel and the card render. So the two
// mutations that touch the corpus refetch it, narrowly — the session view
// they already hold is seeded, only this needs re-reading.
export async function refreshCoachSessionMatches(): Promise<void> {
  await getQueryClient().invalidateQueries({ queryKey: qk.coach.matches })
}

// Ending a session writes the "no session" answer into the cache rather
// than removing the entry: null is the value every consumer already reads
// as closed, and it lands on the observers immediately — a removal leaves
// an active observer holding its last result for a tick, which is a tick of
// the app still painting the player's data.
export function clearCoachSessionData(): void {
  const client = getQueryClient()
  client.setQueryData(qk.coach.session, null)
  client.removeQueries({ queryKey: qk.coach.matches })
}

/** Merge a freshly staged or re-decided sheet into the cached inbox. */
export function upsertCoachReturn(sheet: CoachReturnSheet): void {
  getQueryClient().setQueryData<CoachReturnSheet[]>(qk.coach.returns, (current) => {
    const sheets = current ?? []
    const at = sheets.findIndex(s => s.id === sheet.id)
    if (at < 0) return [...sheets, sheet]
    return sheets.map(s => (s.id === sheet.id ? sheet : s))
  })
}

/** Drop a discarded sheet from the cached inbox, so the banner settles now. */
export function removeCoachReturn(id: number): void {
  getQueryClient().setQueryData<CoachReturnSheet[]>(qk.coach.returns, (current) =>
    (current ?? []).filter(s => s.id !== id))
}
