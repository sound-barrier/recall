// Event payloads for a parse run — emitted over the SSE / Wails event
// stream and surfaced by the ingest progress panel, the masthead chip, and
// the Settings → Advanced re-parse line. The shapes are the generated wire
// contract (api/openapi.yaml `components.schemas`, referenced from the
// events operation's x-event-payloads) — aliased here so consumers keep a
// stable import path outside the generated tree, and because a type
// exported from an SFC `<script>` can't be resolved by typescript-eslint.
//
// ParseProgressEvent: `matches_updated` / `hero_corrections` /
// `map_corrections` are cumulative re-parse counters ("X of Y matches
// updated") — always absent on a regular Parse run, so consumers that
// don't read them silently ignore.
//
// WatchActivityEvent: drives the masthead's "watching · N new" dot;
// `last_seen_at` (RFC 3339) feeds its tooltip. Session-scoped by design:
// there is no resync endpoint, the dot simply starts idle on reload.
//
// ParseRunSummary rides parse-complete: the finished run's own tally
// ("X read · Y failed to read"). A toast, not durable state — a client
// that reconnects after missing the event gets no replay.
export type { ParseProgressEvent, ParseRunSummary, WatchActivityEvent } from '@/client/types.gen'
