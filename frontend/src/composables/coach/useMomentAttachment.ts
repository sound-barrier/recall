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
 * Returns the UPDATED moment rather than mutating: every writer here treats a
 * moment as a value, and a save is an upsert of the whole row.
 */
export async function attachFrame(moment: CoachMoment, file: File): Promise<CoachMoment> {
  const sha = await PutMomentImage(file)
  return { ...moment, imageSHA256: sha }
}
