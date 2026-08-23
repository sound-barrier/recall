import { unwrap, unwrapVoid } from '@/api-unwrap'
import * as sdk from '@/client/sdk.gen'
import type {
  ProfilesResponse,
  SeedTestProfileResponse,
} from '@/client/types.gen'

// Re-exported wire types — consumers import these instead of reaching into
// the generated module directly.

// ─── Profiles ──────────────────────────────────────────────────────────────
//
// Each profile is its own settings + SQLite DB under
// <base>/profiles/<name>/. Switching tears down the server's in-memory
// state and re-initializes — the SPA reloads after each Create/Switch so
// every consumer re-fetches against the new active profile.

export function GetProfiles(): Promise<ProfilesResponse> {
  return unwrap(sdk.getProfiles())
}

// Create-and-activate. Server returns the new state; caller reloads.
export function CreateProfile(name: string): Promise<ProfilesResponse> {
  return unwrap(sdk.createProfile({ body: { name } }))
}

// Onboarding helper: create + seed the sample "test" profile so the
// walkthrough can run on real data. Idempotent (reuses an already-seeded
// "test"). Does NOT switch the active profile — the caller does that via
// SwitchProfile afterwards.
export function SeedTestProfile(): Promise<SeedTestProfileResponse> {
  return unwrap(sdk.seedTestProfile())
}

// Switch the active profile. Returns the new state for callers that want
// to read it before reloading.
export function SwitchProfile(name: string): Promise<ProfilesResponse> {
  return unwrap(sdk.switchProfile({ body: { name } }))
}

// Rename a profile. The server handles the directory rename + the
// active-store close/re-open dance when the renamed profile is active.
export function RenameProfile(oldName: string, newName: string): Promise<ProfilesResponse> {
  return unwrap(sdk.renameProfile({ path: { name: oldName }, body: { new_name: newName } }))
}

// Delete a profile and wipe its directory tree. Cannot target the active
// profile (409). The DELETE echoes nothing (204); the caller refreshes
// the list via the profiles-query invalidation — chasing a GET here would
// turn a transient read failure into a user-facing error for a delete
// that succeeded.
export function DeleteProfile(name: string): Promise<void> {
  return unwrapVoid(sdk.deleteProfile({ path: { name } }))
}
