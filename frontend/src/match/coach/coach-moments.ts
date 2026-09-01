
/**
 * A coach's timestamped moment: its shape, when it is worth saving, and how it
 * crosses the wire.
 *
 * The strip's LAYOUT math (where a cue sits on the rail, whether a stamp runs
 * past the end of the match) lives in coach-cue-geometry — this module is
 * loaded on every boot because the session store imports it, and the geometry
 * is only ever run by the film room.
 */

/** One timestamped observation, as the strip renders it. */
export interface CoachMoment {
  momentId: string
  matchClock: string
  text: string
  focusTag: string
  /**
   * The frame this moment is about, by content digest — served from
   * `/_moment-image/<sha>`. Empty when there is no picture.
   *
   * A digest rather than a URL because the same screenshot pinned to three
   * moments is one stored copy, and because the reference survives a match
   * rename, which a filename would not.
   */
  imageSHA256: string
}

/** A moment being typed, before it says enough to save. */
export function emptyMoment(momentId: string): CoachMoment {
  return { momentId, matchClock: '', text: '', focusTag: '', imageSHA256: '' }
}

// isSavable lives in coach-notes, beside parseMatchClock — its only
// dependency, and the module the session tally also needs it from. Re-exported
// here because a moment's savability is a moment concept, and this is where a
// reader looks for it.
export { isSavable } from '@/match/coach/coach-notes'

/** The moment as the API carries it — the PUT body. */
export interface CoachMomentWire {
  match_clock: string
  text: string
  focus_tag?: string
  image_sha256?: string
}

export function toMomentInput(m: CoachMoment): CoachMomentWire {
  return {
    match_clock: m.matchClock,
    text: m.text,
    // Omitted rather than empty: the enum has no "none" member, and sending
    // one would be a 400 on a field the coach simply left alone.
    ...(m.focusTag ? { focus_tag: m.focusTag } : {}),
    // Sent even when empty, because that is how a picture is REMOVED — an
    // omitted field would read as "leave it alone" and the frame would stay.
    image_sha256: m.imageSHA256,
  }
}

export function fromWireMoment(
  m: { moment_id: string; match_clock: string; text: string; focus_tag?: string; image_sha256?: string },
): CoachMoment {
  return {
    momentId: m.moment_id,
    matchClock: m.match_clock,
    text: m.text,
    focusTag: m.focus_tag ?? '',
    imageSHA256: m.image_sha256 ?? '',
  }
}

/** Where the app serves a stored attachment from. */
export function momentImageURL(sha: string): string {
  return `/_moment-image/${sha}`
}

/**
 * The autosave queue's key for one moment.
 *
 * Namespaced so a moment id can never collide with a match key or with the
 * summary's own key — the queue is a pure mechanism over opaque strings, and
 * whoever owns them decides what they mean.
 */
export function momentSaveKey(momentId: string): string {
  return `moment:${momentId}`
}
