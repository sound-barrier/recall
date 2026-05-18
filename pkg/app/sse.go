package app

import "sync"

// SSEHub manages a set of Server-Sent Events subscribers. Each connected
// browser tab gets its own buffered channel; Broadcast delivers to all of
// them without blocking.
type SSEHub struct {
	mu      sync.Mutex
	clients map[chan string]struct{}
}

func NewSSEHub() *SSEHub {
	return &SSEHub{clients: make(map[chan string]struct{})}
}

func (h *SSEHub) Subscribe() chan string {
	ch := make(chan string, 8)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *SSEHub) Unsubscribe(ch chan string) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
	close(ch)
}

func (h *SSEHub) Broadcast(event string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- event:
		default: // drop if the client isn't reading fast enough
		}
	}
}
