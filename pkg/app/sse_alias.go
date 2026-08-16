package app

import "recall/pkg/sse"

// The Server-Sent Events fan-out lives in pkg/sse (carved out per the
// decomposition plan). These aliases keep App.SSEHub's field type,
// pkg/cmd's RunServer wiring and /api/v1/events handler, and every
// emit* call site byte-identical.

// SSEHub is the in-memory fan-out backing server mode's SSE stream.
type SSEHub = sse.Hub

// NewSSEHub returns a hub with no subscribers. Kept at package level
// for pkg/cmd's RunServer wiring.
func NewSSEHub() *SSEHub { return sse.NewHub() }
