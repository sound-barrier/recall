package rosterwatch_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"recall/pkg/rosterwatch"
)

// The published-channel check needs no upstream at all: it compares the app's
// own Pages channel against the commit that last touched a roster file. It
// catches a silent pages.yml failure, which would otherwise leave every
// installed copy on stale data with nothing anywhere saying so.

func TestChannelFinding_QuietWhenThePublishedCommitMatches(t *testing.T) {
	serve(t, []byte(`{"commit_sha":"abc123","committed_at":"2026-09-01T00:00:00Z"}`), &rosterwatch.VersionURL)

	got, err := rosterwatch.ChannelFinding(rosterwatch.NewClient(), "abc123")
	if err != nil {
		t.Fatalf("ChannelFinding: %v", err)
	}
	if got != nil {
		t.Fatalf("finding = %+v, want none — the channel is current", got)
	}
}

func TestChannelFinding_NamesAChannelBehindMain(t *testing.T) {
	serve(t, []byte(`{"commit_sha":"old999","committed_at":"2026-08-01T00:00:00Z"}`), &rosterwatch.VersionURL)

	got, err := rosterwatch.ChannelFinding(rosterwatch.NewClient(), "abc123")
	if err != nil {
		t.Fatalf("ChannelFinding: %v", err)
	}
	if got == nil || got.Kind != rosterwatch.KindChannelStale {
		t.Fatalf("finding = %+v, want a %s", got, rosterwatch.KindChannelStale)
	}
}

// An unknown local commit means the caller could not read git — that is not
// evidence the channel is fine, so it must not report as fine.
func TestChannelFinding_SaysNothingRatherThanFineWhenTheLocalCommitIsUnknown(t *testing.T) {
	serve(t, []byte(`{"commit_sha":"abc123"}`), &rosterwatch.VersionURL)

	if _, err := rosterwatch.ChannelFinding(rosterwatch.NewClient(), ""); err == nil {
		t.Fatal("ChannelFinding accepted an empty local commit")
	}
}

func TestChannelFinding_RefusesAVersionDocItCannotRead(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "nope", http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	prev := rosterwatch.VersionURL
	rosterwatch.VersionURL = srv.URL
	t.Cleanup(func() { rosterwatch.VersionURL = prev })

	if _, err := rosterwatch.ChannelFinding(rosterwatch.NewClient(), "abc123"); err == nil {
		t.Fatal("ChannelFinding treated an unreachable channel as current")
	}
}
