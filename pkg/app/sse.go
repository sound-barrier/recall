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

// Broadcast sends a no-payload event to all subscribers.
func (h *SSEHub) Broadcast(event string) {
	h.send(sseMsg{event, "{}"})
}

// BroadcastData sends an event with a JSON data payload.
func (h *SSEHub) BroadcastData(event, data string) {
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
