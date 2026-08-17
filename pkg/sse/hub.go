// Package sse is an in-memory fan-out for Server-Sent Events.
//
// A Hub holds one buffered channel per connected client and copies
// every broadcast into all of them. It carries no domain knowledge:
// an event is a name plus an opaque data string, and the only policy
// it implements is what to do when a client is not reading fast
// enough — drop for stream events, evict-and-deliver for terminal
// ones. See Broadcast and BroadcastData.
package sse

import "sync"

// Msg is one Server-Sent Event: the event name and its data payload,
// written verbatim into the wire format by the streaming handler.
type Msg struct{ Event, Data string }

// Hub manages a set of Server-Sent Events subscribers. Each connected
// browser tab gets its own buffered channel; Broadcast/BroadcastData
// deliver to all of them without blocking.
type Hub struct {
	mu      sync.Mutex
	clients map[chan Msg]struct{}
}

// NewHub returns a Hub with no subscribers.
func NewHub() *Hub {
	return &Hub{clients: make(map[chan Msg]struct{})}
}

// Subscribe registers a client and returns the buffered channel its events
// arrive on. The caller must Unsubscribe when it disconnects.
//
// NOT nil-receiver safe, deliberately, unlike Broadcast and BroadcastData.
// That asymmetry is load-bearing: pkg/cmd excludes the SSE route from the
// desktop mux precisely because Subscribe would panic there, and a panic is
// the loud failure that keeps it excluded. Returning a nil channel instead
// would be worse — a receive on a nil channel blocks forever, which is the
// goroutine leak the exclusion exists to prevent.
//
// The zero value is usable: exporting Hub made &sse.Hub{} constructible from
// anywhere, and a zero Hub's map is nil, so this used to panic with
// "assignment to entry in nil map" for any caller who did not know NewHub was
// the only valid constructor. A leaf package cannot rely on that knowledge.
func (h *Hub) Subscribe() chan Msg {
	ch := make(chan Msg, 16)
	h.mu.Lock()
	if h.clients == nil {
		h.clients = make(map[chan Msg]struct{})
	}
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

// Unsubscribe deregisters a client and closes its channel.
//
// Idempotent: a second call is a no-op rather than a close-of-closed panic.
// The registry membership check under the lock is what makes that safe — only
// the call that actually removes the channel closes it. Production has one
// caller with a single defer, but "safe because the only caller is careful"
// is not a property worth exporting.
func (h *Hub) Unsubscribe(ch chan Msg) {
	h.mu.Lock()
	_, registered := h.clients[ch]
	delete(h.clients, ch)
	h.mu.Unlock()
	if !registered {
		return
	}
	close(ch)
}

// Broadcast sends a no-payload event to all subscribers with
// guaranteed delivery: these are the terminal lifecycle events
// (parse-complete / parse-canceled) the client's spinner hangs on,
// so a full buffer evicts its oldest message rather than dropping
// the terminal one. Nil-safe: calling on a nil receiver is a no-op,
// so the parse loop can fire without a TOCTOU check between
// `if a.SSEHub != nil` and the actual call. The single `*Hub`
// field read at the call site is pointer-atomic on every supported
// architecture; a nil-safe method makes the racy "is it still
// non-nil after the check?" window disappear entirely. Same shape
// as `http.Handler.ServeHTTP` on a nil mux — Go convention is fine
// with this when the zero-value semantic is "do nothing."
func (h *Hub) Broadcast(event string) {
	if h == nil {
		return
	}
	h.send(Msg{event, "{}"}, true)
}

// BroadcastData sends an event with a JSON data payload, best-effort:
// stream events (parse-progress, match-updated, tesseract-status) are
// superseded by the next one or a reload, so a slow consumer's full
// buffer drops them rather than blocking the producer. Nil-safe; see
// `Broadcast` for the rationale.
func (h *Hub) BroadcastData(event, data string) {
	if h == nil {
		return
	}
	h.send(Msg{event, data}, false)
}

func (h *Hub) send(msg Msg, guaranteed bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- msg:
			continue
		default: // the client isn't reading fast enough
		}
		if !guaranteed {
			continue
		}
		// Make room by evicting the oldest buffered message. Only
		// send() fills client channels and it runs under h.mu, so
		// after one eviction the retry can only fail if the consumer
		// drained everything first — in which case it succeeds too.
		// The loop bound is defensive, not load-bearing.
		for range cap(ch) + 1 {
			select {
			case <-ch:
			default:
			}
			select {
			case ch <- msg:
			default:
				continue
			}
			break
		}
	}
}
