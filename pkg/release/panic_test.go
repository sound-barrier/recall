package release_test

import (
	"net/http"
	"testing"
	"time"

	"recall/pkg/gamedata"
	"recall/pkg/release"
)

// A panic inside the main-channel probe used to hang the CALLER forever.
//
// The goroutine is `defer applog.RecoverPanic("update"); ch <- FetchStatus(…)`.
// RecoverPanic does its job — logs, swallows, returns — but the send was
// written after the call, so it never ran, and Check's receive blocked with
// nothing left alive to satisfy it. Both receives are affected: the success
// join and the drain on the failure path. The recover exists to stop a panic
// killing the desktop process; converting it into a permanently stuck HTTP
// request is strictly worse than the crash it prevents.
//
// The guard has to be a timeout, because the failure mode IS "never returns".
func TestCheck_PanicInGameDataProbeDoesNotHangTheCaller(t *testing.T) {
	// withReleasesURL, not a hand-rolled ReleasesURL swap: it ALSO points
	// gamedata's three main-channel URLs at a closed server. Setting only
	// ReleasesURL leaves those at their production hosts, and Check then makes
	// a real network request — which cost ~2s here and turned this into a test
	// that passed alone and failed inside the full suite.
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v9.9.9","html_url":"https://example/v9.9.9"}`)
	withReleasesURL(t, srv.URL)

	release.SetFetchGameDataStatus(t, func(string) gamedata.Status {
		panic("main channel returned something the parser could not hold")
	})

	done := make(chan release.Info, 1)
	go func() { done <- release.Check(t.TempDir(), "0.1.0") }()

	select {
	case got := <-done:
		// The release half still succeeded, so the check reports normally and
		// the game-data half degrades to its zero value — the same shape a
		// network failure produces, which the frontend already renders as
		// "main channel unavailable".
		if !got.Checked {
			t.Error("Checked: want true — the release fetch succeeded; only the game-data probe panicked")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Check never returned: the panicking probe sent nothing and the receive blocked forever")
	}
}
