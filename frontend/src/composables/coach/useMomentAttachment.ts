import { PutMomentImage } from '@/api-client'
import type { CoachMoment } from '@/match/coach/coach-moments'

/**
 * Take custody of a dropped frame and hand back the moment that points at it.
 *
 * Shared by both hosts — the player's journal and the film room's drafts —
 * because the two already own moment persistence separately and would
 * otherwise each grow their own idea of what attaching means. The upload is
 * content-addressed on the server, so re-attaching the same screenshot costs
 * one request and no extra storage.
 *
 * The moment is read through `latest` AFTER the upload, not before it: the
 * upload takes as long as it takes, and a snapshot taken at the drop wrote
 * back the text from before whatever was typed meanwhile — and resurrected a
 * moment deleted meanwhile. Null when the moment is gone; only the frame is
 * patched. Returns the updated moment rather than mutating: every writer here
 * treats a moment as a value, and a save is an upsert of the whole row.
 */
export async function attachFrame(file: File, latest: () => CoachMoment | undefined): Promise<CoachMoment | null> {
  const sha = await PutMomentImage(file)
  const now = latest()
  return now ? { ...now, imageSHA256: sha } : null
}
