import { useQuery } from '@tanstack/vue-query'

import {
  CheckForUpdate, GetDataLocation, GetOWData, GetStartupError, GetVersion,
  type UpdateInfo,
} from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'

// Reference data is compiled into the parser binary — static for the
// session, so the global staleTime: Infinity is exactly right. Every
// consumer shares one cache entry (one GET per session);
// ApplyGameDataUpdate invalidates the key to refresh the roster in place.
export function useOWDataQuery() {
  return useQuery({ queryKey: qk.system.referenceData, queryFn: GetOWData }, getQueryClient())
}

export function useVersionQuery() {
  return useQuery({ queryKey: qk.system.version, queryFn: GetVersion }, getQueryClient())
}

export function useDataLocationQuery() {
  return useQuery({ queryKey: qk.system.dataLocation, queryFn: GetDataLocation }, getQueryClient())
}

// The GitHub release check is USER-PULLED only ("no network calls on mount
// unless the user asked") — the observer is permanently disabled and
// runUpdateCheck() is the single trigger. A result with checked:false (the
// backend couldn't complete the check) keeps the previous answer rather
// than clobbering it.
async function fetchUpdateInfoKeepingLast(): Promise<UpdateInfo | null> {
  const u = await CheckForUpdate()
  if (u.checked) return u
  return getQueryClient().getQueryData<UpdateInfo | null>(qk.system.update) ?? null
}

export function useUpdateCheckQuery() {
  return useQuery({
    queryKey: qk.system.update,
    queryFn: fetchUpdateInfoKeepingLast,
    enabled: false,
  }, getQueryClient())
}

// Imperative trigger — the About dialog's auto-check-on-open and its
// re-check button. staleTime 0 forces a real roundtrip per explicit ask
// while an in-flight one is joined, not duplicated (the old busy guard).
// Failures are silent: the dialog shows the cached result or its
// network-failure copy.
export function runUpdateCheck(): Promise<void> {
  return getQueryClient().fetchQuery({
    queryKey: qk.system.update,
    queryFn: fetchUpdateInfoKeepingLast,
    staleTime: 0,
  }).then(() => undefined, () => undefined)
}

// One-shot boot read for the startup-failure gate — no observer needed,
// the app store keeps the message.
export function fetchStartupError(): Promise<string> {
  return getQueryClient().fetchQuery({ queryKey: qk.system.startupError, queryFn: GetStartupError })
}
