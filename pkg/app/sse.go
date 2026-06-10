package app

import "sync"

type sseMsg struct{ Event, Data string }

// SSEHub manages a set of Server-Sent Events subscribers. Each connected
// browser tab gets its own buffered channel; Broadcast/BroadcastData
// deliver to all of them without blocking.
type SSEHub struct {
	mu      sync.Mutex
	clients map[chan sseMsg]struct{}
}

func NewSSEHub() *SSEHub {
	return &SSEHub{clients: make(map[chan sseMsg]struct{})}
}

func (h *SSEHub) Subscribe() chan sseMsg {
	ch := make(chan sseMsg, 16)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *SSEHub) Unsubscribe(ch chan sseMsg) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
	close(ch)
}

// Broadcast sends a no-payload event to all subscribers. Nil-safe:
// calling on a nil receiver is a no-op, so the parse loop can fire
// without a TOCTOU check between `if a.SSEHub != nil` and the actual
// call. The single `*SSEHub` field read at the call site is
// pointer-atomic on every supported architecture; a nil-safe method
// makes the racy "is it still non-nil after the check?" window
// disappear entirely. Same shape as `http.Handler.ServeHTTP` on a
// nil mux — Go convention is fine with this when the zero-value
// semantic is "do nothing."
func (h *SSEHub) Broadcast(event string) {
	if h == nil {
		return
	}
	h.send(sseMsg{event, "{}"})
}

// BroadcastData sends an event with a JSON data payload. Nil-safe;
// see `Broadcast` for the rationale.
func (h *SSEHub) BroadcastData(event, data string) {
	if h == nil {
		return
	}
	h.send(sseMsg{event, data})
}

func (h *SSEHub) send(msg sseMsg) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- msg:
		default: // drop if the client isn't reading fast enough
		}
	}
}
