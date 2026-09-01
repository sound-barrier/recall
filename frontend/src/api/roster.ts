import { unwrap, unwrapVoid } from '@/api-unwrap'
import * as sdk from '@/client/sdk.gen'
import type { RosterMember } from '@/client/types.gen'

// The player's saved roster: the BattleTags they queue with, and the names
// they actually call those people.
//
// A tagged teammate stays free text. This list supplies display names and
// completions — removing somebody from it does not touch the matches they
// played on.

/** Every saved teammate, ordered by display name. */
export function ListRoster(): Promise<RosterMember[]> {
  return unwrap(sdk.listRoster())
}

/**
 * Add or rename one teammate. The tag is the identity and travels in the
 * path; `display_name` defaults to it server-side when blank.
 */
export function SaveRosterMember(tag: string, displayName: string, note = ''): Promise<void> {
  return unwrapVoid(sdk.saveRosterMember({
    path: { tag },
    body: { display_name: displayName, note },
  }))
}

/** Drop one teammate. The matches they were tagged on keep the tag. */
export function DeleteRosterMember(tag: string): Promise<void> {
  return unwrapVoid(sdk.deleteRosterMember({ path: { tag } }))
}
