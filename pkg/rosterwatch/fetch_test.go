package rosterwatch_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/rosterwatch"
)

// The fetchers, against recorded bytes. No test here touches the network.
//
// The assertion this whole design rests on is the LAST one in each group: a
// source that changed shape must report as unreadable, never as "in sync". A
// scrape that silently returns an empty list would tell the maintainer their
// roster is current on the week it stopped being current.

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return b
}

// serve stands the fixture up on a local server and points the seam at it.
func serve(t *testing.T, body []byte, seam *string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)
	prev := *seam
	*seam = srv.URL
	t.Cleanup(func() { *seam = prev })
}

func TestFetchHeroes_ReadsBlizzardsOwnPage(t *testing.T) {
	serve(t, fixture(t, "blizzard_heroes.html"), &rosterwatch.HeroesURL)

	got, err := rosterwatch.FetchHeroes(rosterwatch.NewClient())
	if err != nil {
		t.Fatalf("FetchHeroes: %v", err)
	}
	// The fixture is the real page's markup, trimmed. Every name must survive
	// verbatim — the accents and the colon are the whole point.
	want := map[string]bool{"Ana": true, "D.Va": true, "Lúcio": true, "Soldier: 76": true, "Torbjörn": true, "Wrecking Ball": true}
	seen := map[string]bool{}
	for _, h := range got {
		seen[h.Name] = true
	}
	for name := range want {
		if !seen[name] {
			t.Errorf("hero %q missing from %v", name, got)
		}
	}
}

func TestFetchHeroes_RefusesToCallAChangedPageEmpty(t *testing.T) {
	serve(t, []byte("<html><body><p>we redesigned</p></body></html>"), &rosterwatch.HeroesURL)

	_, err := rosterwatch.FetchHeroes(rosterwatch.NewClient())
	if !errors.Is(err, rosterwatch.ErrSourceUnreadable) {
		t.Fatalf("err = %v, want ErrSourceUnreadable — an empty list must never read as 'in sync'", err)
	}
}

func TestFetchMaps_ReadsTheOverFastList(t *testing.T) {
	serve(t, fixture(t, "overfast_maps.json"), &rosterwatch.MapsURL)

	got, err := rosterwatch.FetchMaps(rosterwatch.NewClient())
	if err != nil {
		t.Fatalf("FetchMaps: %v", err)
	}
	var ilios rosterwatch.Map
	for _, m := range got {
		if m.Name == "Ilios" {
			ilios = m
		}
	}
	if ilios.GameMode != "control" {
		t.Errorf("Ilios = %+v, want game mode control", ilios)
	}
}

func TestFetchMaps_RefusesToCallAChangedPayloadEmpty(t *testing.T) {
	// Two ways the API can stop answering, and both must read as unreadable.
	// The second is the one that matters: a well-formed empty list is what a
	// deprecated endpoint returns, and it is indistinguishable from "the game
	// has no maps" unless the fetcher refuses it.
	for name, body := range map[string]string{
		"a payload that is not a list": `{"detail":"not found"}`,
		"a list with nothing in it":    `[]`,
	} {
		t.Run(name, func(t *testing.T) {
			serve(t, []byte(body), &rosterwatch.MapsURL)
			if _, err := rosterwatch.FetchMaps(rosterwatch.NewClient()); !errors.Is(err, rosterwatch.ErrSourceUnreadable) {
				t.Fatalf("err = %v, want ErrSourceUnreadable", err)
			}
		})
	}
}

func TestFetchPatchDates_ReadsTheHeadings(t *testing.T) {
	serve(t, fixture(t, "blizzard_patch_notes.html"), &rosterwatch.PatchNotesURL)

	got, err := rosterwatch.FetchPatchDates(rosterwatch.NewClient())
	if err != nil {
		t.Fatalf("FetchPatchDates: %v", err)
	}
	var days []string
	for _, d := range got {
		days = append(days, d.Format("2006-01-02"))
	}
	for _, want := range []string{"2026-08-11", "2026-08-19", "2026-08-20"} {
		found := false
		for _, d := range days {
			if d == want {
				found = true
			}
		}
		if !found {
			t.Errorf("patch %s missing from %v", want, days)
		}
	}
	// A non-patch news item on the same page must not become a patch date.
	if len(days) != 3 {
		t.Errorf("days = %v, want only the three patch-note headings", days)
	}
}

func TestFetchPatchDates_RefusesToCallAChangedPageEmpty(t *testing.T) {
	serve(t, []byte("<html><body><h2>News</h2></body></html>"), &rosterwatch.PatchNotesURL)

	if _, err := rosterwatch.FetchPatchDates(rosterwatch.NewClient()); !errors.Is(err, rosterwatch.ErrSourceUnreadable) {
		t.Fatalf("err = %v, want ErrSourceUnreadable", err)
	}
}

// followRedirect drives one request through the real client and reports
// whether the redirect was taken. Returning only the error is the point: these
// two tests assert that no response ever arrives.
func followRedirect(t *testing.T, url string) error {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	resp, err := rosterwatch.NewClient().Do(req)
	if err != nil {
		return err
	}
	_ = resp.Body.Close()
	return nil
}

// The client is the SSRF perimeter. Same shape as pkg/gamedata's, scoped to
// this package's own hosts — gamedata's allowlist would refuse Blizzard, and
// widening that one would loosen a boundary its tests deliberately pin.
func TestClient_RefusesARedirectOffTheAllowlist(t *testing.T) {
	evil := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "should never be reached", http.StatusTeapot)
	}))
	t.Cleanup(evil.Close)
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://evil.example.com/x", http.StatusFound)
	}))
	t.Cleanup(redirector.Close)

	if err := followRedirect(t, redirector.URL); err == nil {
		t.Fatal("the client followed a redirect off the allowlist")
	}
}

func TestClient_RefusesANonHTTPSRedirect(t *testing.T) {
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://overwatch.blizzard.com/x", http.StatusFound)
	}))
	t.Cleanup(redirector.Close)

	if err := followRedirect(t, redirector.URL); err == nil {
		t.Fatal("the client followed a plaintext redirect")
	}
}
