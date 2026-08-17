package sse_test

import (
	"testing"

	"recall/pkg/sse"
)

// Exporting Hub made &sse.Hub{} writable from anywhere, and its zero value has
// a nil clients map — Subscribe would panic on "assignment to entry in nil
// map". NewHub was the only valid constructor and nothing said so. A leaf
// package cannot rely on every caller knowing that.
func TestHub_ZeroValueIsUsable(t *testing.T) {
	var h sse.Hub

	ch := h.Subscribe()
	if ch == nil {
		t.Fatal("Subscribe on a zero-value Hub returned nil")
	}
	h.BroadcastData("probe", "payload")
	select {
	case msg := <-ch:
		if msg.Event != "probe" {
			t.Errorf("event = %q, want probe", msg.Event)
		}
	default:
		t.Error("zero-value Hub accepted a subscriber but delivered nothing to it")
	}
	h.Unsubscribe(ch)
}

// Unsubscribe closes the channel, so calling it twice used to panic on
// close-of-closed. Production is safe today because server_events.go uses a
// single defer — but "safe because the one caller happens to be careful" is
// not a property a package should export.
func TestHub_UnsubscribeIsIdempotent(t *testing.T) {
	h := sse.NewHub()
	ch := h.Subscribe()

	h.Unsubscribe(ch)
	h.Unsubscribe(ch) // must not panic

	h.Broadcast("after-unsubscribe") // must not send on a closed channel
}
