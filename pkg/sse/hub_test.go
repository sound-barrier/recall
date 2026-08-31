package sse_test

import (
	"strconv"
	"testing"
	"time"

	"recall/pkg/sse"
)

// Hub is the broadcast layer behind the server-mode SSE endpoint.
// Sub-100-line file but 0%-covered prior to this — every parse-progress
// event flows through here, and the slow-consumer drop branch is the
// failure mode worth pinning (a stuck reader can't block the producer).

func TestHub_SubscribeReturnsBufferedChannel(t *testing.T) {
	h := sse.NewHub()
	ch := h.Subscribe()
	if cap(ch) == 0 {
		t.Fatal("Subscribe returned an unbuffered channel — slow readers would block the producer")
	}
}

func TestHub_Broadcast_DeliversToAllSubscribers(t *testing.T) {
	h := sse.NewHub()
	a := h.Subscribe()
	b := h.Subscribe()

	h.Broadcast("parse-complete")

	mustReceive := func(name string, ch chan sse.Msg) {
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

func TestHub_BroadcastData_CarriesJSONPayload(t *testing.T) {
	h := sse.NewHub()
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

// Nil-safe broadcast / data-broadcast on a nil receiver. Replaces
// the prior `if a.SSEHub != nil` TOCTOU window at every call site
// in app_server.go + app_wails.go — the parse loop now fires
// `a.SSEHub.BroadcastData(...)` without a check, trusting the
// method to no-op when the hub hasn't been wired (Wails non-server
// build). Pinned so a future refactor that pulls the nil guard
// can't silently regress to a nil-pointer panic.
func TestHub_Broadcast_NilReceiver_IsNoOp(t *testing.T) {
	var h *sse.Hub
	// Must not panic. No assertion on side effects — there are none.
	h.Broadcast("parse-complete")
}

func TestHub_BroadcastData_NilReceiver_IsNoOp(t *testing.T) {
	var h *sse.Hub
	h.BroadcastData("parse-progress", `{"done":1,"total":2}`)
}

func TestHub_Unsubscribe_RemovesAndClosesChannel(t *testing.T) {
	h := sse.NewHub()
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

func TestHub_SlowConsumer_DropsRatherThanBlocking(t *testing.T) {
	// One subscriber that never reads — the producer must keep
	// flowing for every other subscriber.
	h := sse.NewHub()
	slow := h.Subscribe()
	_ = slow
	fast := h.Subscribe()

	// Producer fires more events than the channel buffer (16). With
	// the slow subscriber not draining, the select's default branch
	// must drop on its channel without affecting `fast`.
	const N = 100
	done := make(chan struct{})
	go func() {
		for range N {
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

// Terminal lifecycle events (parse-complete / parse-canceled — the
// no-payload Broadcast surface) must reach a connected client even when
// a progress burst has filled its buffer, or the parse spinner strands
// until a manual reload (TECHNICAL_DEBT.md section 9). The hub may drop
// stream events (BroadcastData) for a slow consumer, but never a
// terminal one — it evicts the oldest buffered message instead.
func TestHub_Broadcast_TerminalEventSurvivesFullBuffer(t *testing.T) {
	h := sse.NewHub()
	ch := h.Subscribe()

	// Stuff the buffer past capacity with lossy progress events.
	for i := range cap(ch) + 4 {
		h.BroadcastData("parse-progress", `{"done":`+strconv.Itoa(i%10)+`}`)
	}

	h.Broadcast("parse-complete")

	gotTerminal := false
	for {
		select {
		case m := <-ch:
			if m.Event == "parse-complete" {
				gotTerminal = true
			}
		case <-time.After(100 * time.Millisecond):
			if !gotTerminal {
				t.Fatal("parse-complete was dropped on a full buffer — the spinner would strand")
			}
			return
		}
	}
}

// The eviction loop under a consumer that never drains at all — the
// shape it exists for, and stronger than "the terminal event arrived":
// each over-capacity send must evict exactly ONE message and it must
// be the OLDEST, so the buffer holds a fixed-size window of the most
// recent lifecycle events. A reconnecting tab that reads a stale
// window is the same stranded spinner by another route, and an
// eviction loop that over-drains silently loses events nobody counts.
func TestHub_Broadcast_StalledConsumerKeepsTheNewestWindow(t *testing.T) {
	h := sse.NewHub()
	ch := h.Subscribe()

	const overflow = 4
	for i := range cap(ch) + overflow {
		h.Broadcast("terminal-" + strconv.Itoa(i))
	}

	if got := len(ch); got != cap(ch) {
		t.Fatalf("buffer holds %d messages, want exactly its capacity %d — eviction drained the wrong amount", got, cap(ch))
	}

	for i := range cap(ch) {
		want := "terminal-" + strconv.Itoa(i+overflow)
		m := <-ch
		if m.Event != want {
			t.Fatalf("position %d: got %q, want %q — the newest window did not survive eviction", i, m.Event, want)
		}
	}
}

func TestHub_BroadcastData_StillDropsOnFullBuffer(t *testing.T) {
	// The lossy contract for stream events is load-bearing: a stalled
	// reader must never make the producer block OR grow the buffer.
	h := sse.NewHub()
	ch := h.Subscribe()

	for range cap(ch) {
		h.BroadcastData("parse-progress", `{"seq":"filler"}`)
	}
	h.BroadcastData("parse-progress", `{"seq":"overflow"}`)

	received := 0
	for {
		select {
		case m := <-ch:
			received++
			if m.Data == `{"seq":"overflow"}` {
				t.Fatal("overflow stream event was delivered — expected drop-on-full")
			}
		case <-time.After(100 * time.Millisecond):
			if received != cap(ch) {
				t.Fatalf("received %d events, want exactly the buffer's %d", received, cap(ch))
			}
			return
		}
	}
}

func TestHub_Subscribe_IsConcurrencySafe(t *testing.T) {
	// Subscribe + Broadcast hammered from goroutines must not race.
	// `go test -race` catches missing locks here.
	h := sse.NewHub()
	done := make(chan struct{})
	for range 8 {
		go func() {
			ch := h.Subscribe()
			defer h.Unsubscribe(ch)
			for range 50 {
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
	for range 8 {
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Fatal("timeout — goroutine deadlocked")
		}
	}
}

// BroadcastTerminal is Broadcast's with-payload sibling: the run summary
// riding parse-complete must survive a full buffer exactly like the
// bare terminal event, payload intact.
func TestHub_BroadcastTerminal_PayloadSurvivesFullBuffer(t *testing.T) {
	h := sse.NewHub()
	ch := h.Subscribe()

	for i := range cap(ch) + 4 {
		h.BroadcastData("parse-progress", `{"done":`+strconv.Itoa(i%10)+`}`)
	}

	h.BroadcastTerminal("parse-complete", `{"files_parsed":9,"files_failed":1}`)

	for {
		select {
		case m := <-ch:
			if m.Event != "parse-complete" {
				continue
			}
			if m.Data != `{"files_parsed":9,"files_failed":1}` {
				t.Fatalf("terminal payload mangled: %q", m.Data)
			}
			return
		case <-time.After(100 * time.Millisecond):
			t.Fatal("parse-complete was dropped on a full buffer — the spinner would strand")
		}
	}
}
