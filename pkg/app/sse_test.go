package app

import (
	"testing"
	"time"
)

// SSEHub is the broadcast layer behind the server-mode SSE endpoint.
// Sub-100-line file but 0%-covered prior to this — every parse-progress
// event flows through here, and the slow-consumer drop branch is the
// failure mode worth pinning (a stuck reader can't block the producer).

func TestSSEHub_SubscribeReturnsBufferedChannel(t *testing.T) {
	h := NewSSEHub()
	ch := h.Subscribe()
	if cap(ch) == 0 {
		t.Fatal("Subscribe returned an unbuffered channel — slow readers would block the producer")
	}
}

func TestSSEHub_Broadcast_DeliversToAllSubscribers(t *testing.T) {
	h := NewSSEHub()
	a := h.Subscribe()
	b := h.Subscribe()

	h.Broadcast("parse-complete")

	mustReceive := func(name string, ch chan sseMsg) {
		t.Helper()
		select {
		case m := <-ch:
			if m.Event != "parse-complete" {
				t.Errorf("%s: got event %q, want %q", name, m.Event, "parse-complete")
			}
			if m.Data != "{}" {
				t.Errorf("%s: got data %q, want %q", name, m.Data, "{}")
			}
		case <-time.After(time.Second):
			t.Fatalf("%s: timeout waiting for broadcast", name)
		}
	}
	mustReceive("subscriber A", a)
	mustReceive("subscriber B", b)
}

func TestSSEHub_BroadcastData_CarriesJSONPayload(t *testing.T) {
	h := NewSSEHub()
	ch := h.Subscribe()
	h.BroadcastData("parse-progress", `{"done":5,"total":10}`)
	select {
	case m := <-ch:
		if m.Event != "parse-progress" {
			t.Errorf("event: got %q, want parse-progress", m.Event)
		}
		if m.Data != `{"done":5,"total":10}` {
			t.Errorf("data: got %q", m.Data)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout")
	}
}

func TestSSEHub_Unsubscribe_RemovesAndClosesChannel(t *testing.T) {
	h := NewSSEHub()
	ch := h.Subscribe()
	h.Unsubscribe(ch)

	// Channel is closed; receiving immediately returns the zero value
	// with ok=false.
	if _, ok := <-ch; ok {
		t.Error("expected channel to be closed after Unsubscribe")
	}

	// Subsequent broadcast must NOT panic on a missing client.
	h.Broadcast("post-unsubscribe")
}

func TestSSEHub_SlowConsumer_DropsRatherThanBlocking(t *testing.T) {
	// One subscriber that never reads — the producer must keep
	// flowing for every other subscriber.
	h := NewSSEHub()
	slow := h.Subscribe()
	_ = slow
	fast := h.Subscribe()

	// Producer fires more events than the channel buffer (16). With
	// the slow subscriber not draining, the select's default branch
	// must drop on its channel without affecting `fast`.
	const N = 100
	done := make(chan struct{})
	go func() {
		for i := 0; i < N; i++ {
			h.Broadcast("tick")
		}
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("producer blocked on slow subscriber")
	}

	// `fast` should have received at least its buffer's worth.
	received := 0
	for {
		select {
		case <-fast:
			received++
		case <-time.After(50 * time.Millisecond):
			// Drained.
			if received == 0 {
				t.Fatal("fast subscriber got zero events while slow one stalled the producer")
			}
			return
		}
	}
}

func TestSSEHub_Subscribe_IsConcurrencySafe(t *testing.T) {
	// Subscribe + Broadcast hammered from goroutines must not race.
	// `go test -race` catches missing locks here.
	h := NewSSEHub()
	done := make(chan struct{})
	for i := 0; i < 8; i++ {
		go func() {
			ch := h.Subscribe()
			defer h.Unsubscribe(ch)
			for j := 0; j < 50; j++ {
				h.Broadcast("concurrent-event")
				// Drain to keep the slow-consumer branch quiet.
				select {
				case <-ch:
				default:
				}
			}
			done <- struct{}{}
		}()
	}
	for i := 0; i < 8; i++ {
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Fatal("timeout — goroutine deadlocked")
		}
	}
}
