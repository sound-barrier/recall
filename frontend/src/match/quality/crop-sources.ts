import type { FieldFlag, FieldRegion, MatchRecord } from '@/api-client'
import { sourceType, sshotTypeLabel } from '@/match/match-helpers'

// The crops a value's "Show source" reveals. A field read on two screens has
// two crops stacked beside one value, so each says which screen it was cut
// from — and, for a flagged value, what that screen read there.

/** One crop beside a value, with what it says it is. */
export interface CaptionedCrop {
  region: FieldRegion
  caption: string
}

/** Where a value was read, as far as it has been asked; nothing shows until the disclosure opens. */
export type StatSource =
  | { status: 'pending' }
  | { status: 'error' }
  | { status: 'ready'; crops: readonly CaptionedCrop[] }

/**
 * What a crop of `file` says it is: the screen it was cut from, and what
 * that screen read when the value is flagged. A reading worked out from the
 * screen was not read at those pixels, so it is not one of them.
 */
export function cropCaption(
  rec: Pick<MatchRecord, 'source_types'>,
  file: string,
  flag: Pick<FieldFlag, 'readings'> | null,
): string {
  const type = sourceType(rec, file)
  const screen = type ? sshotTypeLabel(type) : file
  const read = new Set((flag?.readings ?? [])
    .filter((r) => r.source_file === file && r.origin !== 'derived')
    .map((r) => r.value))
  return read.size > 0 ? `${screen} · read ${[...read].join(' or ')}` : screen
}

/** The crops of the field at `path` among a match's regions, each captioned. */
export function captionedCrops(
  rec: Pick<MatchRecord, 'source_types'>,
  regions: readonly FieldRegion[],
  path: string,
  flag: Pick<FieldFlag, 'readings'> | null,
): CaptionedCrop[] {
  return regions
    .filter((region) => region.field === path)
    .map((region) => ({ region, caption: cropCaption(rec, region.source_file, flag) }))
}
