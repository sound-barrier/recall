package metrics

import (
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"recall/pkg/parser"
)

// ──────────────────────────────────────────────────────────────────────────
// parseMatchTimestamp — prefer (date + finished_at), fall back to match_key.
// ──────────────────────────────────────────────────────────────────────────

func TestParseMatchTimestamp_FromSummary(t *testing.T) {
	got, ok := parseMatchTimestamp("2026-05-10", "21:29", "match-2020-01-01T00-00-00")
	if !ok {
		t.Fatalf("expected ok=true")
	}
	want := time.Date(2026, 5, 10, 21, 29, 0, 0, time.Local)
	if !got.Equal(want) {
		t.Errorf("got %v want %v", got, want)
	}
}

func TestParseMatchTimestamp_FallsBackToMatchKey(t *testing.T) {
	got, ok := parseMatchTimestamp("", "", "match-2026-05-10T21-29-28")
	if !ok {
		t.Fatalf("expected ok=true via match_key fallback")
	}
	want := time.Date(2026, 5, 10, 21, 29, 28, 0, time.Local)
	if !got.Equal(want) {
		t.Errorf("got %v want %v", got, want)
	}
}

func TestParseMatchTimestamp_RejectsUnmatched(t *testing.T) {
	if _, ok := parseMatchTimestamp("", "", "unmatched-loner.png"); ok {
		t.Errorf("unmatched- keys must not yield a timestamp")
	}
	if _, ok := parseMatchTimestamp("", "", ""); ok {
		t.Errorf("empty inputs must not yield a timestamp")
	}
}

// ──────────────────────────────────────────────────────────────────────────
// roleOf — delegates to parser.HeroRole; empty for unknowns.
// ──────────────────────────────────────────────────────────────────────────

func TestRoleOf(t *testing.T) {
	// Known hero must have a non-empty role.
	if got := roleOf("lucio"); got == "" {
		t.Errorf("known hero lucio must resolve to a role, got empty")
	}
	if got := roleOf("not-a-hero"); got != "" {
		t.Errorf("unknown hero must yield empty role, got %q", got)
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Collector — drive /metrics through a stub Reader and assert on the
// Prometheus text exposition.
// ──────────────────────────────────────────────────────────────────────────

func scrape(t *testing.T, reader Reader) string {
	mux := newMux(reader)
	req := httptest.NewRequest("GET", "/metrics", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	return rec.Body.String()
}

func TestCollector_SkipsNonCompetitive(t *testing.T) {
	reader := func() ([]ScrapeRow, error) {
		return []ScrapeRow{{
			MatchKey: "match-2026-05-10T21-29-28",
			Data: parser.MatchResult{
				Mode: "quickplay", // must be skipped
				Map:  "rialto",
				Date: "2026-05-10", FinishedAt: "21:29",
				Eliminations: 17,
			},
		}}, nil
	}
	out := scrape(t, reader)
	if strings.Contains(out, "recall_match_eliminations{") {
		t.Errorf("quickplay row leaked into Prometheus output:\n%s", out)
	}
}

// Pins the metrics filter contract: every non-competitive row in a
// mixed batch stays out of /metrics, every competitive row appears.
// CLAUDE.md flags this filter as "the only place modes are filtered
// for Prometheus" — a future "expand which modes count" change has
// to update this test alongside the filter literal in Collect().
func TestCollector_FilterIsCompetitiveOnly(t *testing.T) {
	reader := func() ([]ScrapeRow, error) {
		return []ScrapeRow{
			{
				MatchKey: "match-2026-05-10T20-00-00",
				Data: parser.MatchResult{
					Mode: "competitive", Map: "rialto", Hero: "ana",
					Date: "2026-05-10", FinishedAt: "20:00",
					Eliminations: 1,
				},
			},
			{
				MatchKey: "match-2026-05-10T20-30-00",
				Data: parser.MatchResult{
					Mode: "quickplay", Map: "ilios", Hero: "zarya",
					Date: "2026-05-10", FinishedAt: "20:30",
					Eliminations: 2,
				},
			},
			{
				MatchKey: "match-2026-05-10T21-00-00",
				Data: parser.MatchResult{
					Mode: "arcade", Map: "kings_row", Hero: "tracer",
					Date: "2026-05-10", FinishedAt: "21:00",
					Eliminations: 3,
				},
			},
			{
				MatchKey: "match-2026-05-10T21-30-00",
				Data: parser.MatchResult{
					Mode: "competitive", Map: "hanamura", Hero: "lucio",
					Date: "2026-05-10", FinishedAt: "21:30",
					Eliminations: 4,
				},
			},
			{
				MatchKey: "match-2026-05-10T22-00-00",
				Data: parser.MatchResult{
					Mode: "", Map: "junkertown", Hero: "soldier",
					Date: "2026-05-10", FinishedAt: "22:00",
					Eliminations: 5,
				},
			},
		}, nil
	}
	out := scrape(t, reader)

	// Every competitive match_key surfaces.
	for _, key := range []string{
		"match-2026-05-10T20-00-00",
		"match-2026-05-10T21-30-00",
	} {
		if !strings.Contains(out, `match_key="`+key+`"`) {
			t.Errorf("competitive match %q missing from /metrics output", key)
		}
	}
	// Every non-competitive match_key is absent.
	for _, key := range []string{
		"match-2026-05-10T20-30-00", // quickplay
		"match-2026-05-10T21-00-00", // arcade
		"match-2026-05-10T22-00-00", // mode unset
	} {
		if strings.Contains(out, `match_key="`+key+`"`) {
			t.Errorf("non-competitive match %q leaked into /metrics output", key)
		}
	}
	// Belt-and-suspenders: the labels confirm we're filtering on mode,
	// not on something coincidental. Every emitted eliminations sample
	// carries mode="competitive".
	for _, line := range strings.Split(out, "\n") {
		if !strings.HasPrefix(line, "recall_match_eliminations{") {
			continue
		}
		if !strings.Contains(line, `mode="competitive"`) {
			t.Errorf("eliminations sample with non-competitive mode label:\n  %s", line)
		}
	}
}

func TestCollector_SkipsRowsWithoutTimestamp(t *testing.T) {
	reader := func() ([]ScrapeRow, error) {
		return []ScrapeRow{{
			MatchKey: "unmatched-loner.png", // no date, no match: prefix
			Data:     parser.MatchResult{Mode: "competitive", Eliminations: 17},
		}}, nil
	}
	out := scrape(t, reader)
	if strings.Contains(out, "recall_match_eliminations{") {
		t.Errorf("row without timestamp leaked into Prometheus output:\n%s", out)
	}
}

func TestCollector_EmitsCoreMetricsWithPrimaryHero(t *testing.T) {
	reader := func() ([]ScrapeRow, error) {
		return []ScrapeRow{{
			MatchKey: "match-2026-05-10T21-29-28",
			Data: parser.MatchResult{
				Mode: "competitive", Map: "rialto", Type: "control", Result: "victory",
				Date: "2026-05-10", FinishedAt: "21:29",
				Hero:         "lucio",
				Eliminations: 17, Assists: 16, Deaths: 11, Damage: 7200,
			},
		}}, nil
	}
	out := scrape(t, reader)

	wantSubstrings := []string{
		`recall_match_eliminations{`,
		`hero="lucio"`,
		`map="rialto"`,
		`result="victory"`,
		`} 17`,
		`recall_match_damage{`,
		`} 7200`,
		`recall_match_result{`, // emits 1 when Result is non-empty
	}
	for _, want := range wantSubstrings {
		if !strings.Contains(out, want) {
			t.Errorf("expected %q in exposition, not found.\nFull output:\n%s", want, out)
		}
	}
}

func TestCollector_EmitsPerHeroStatsAndSR(t *testing.T) {
	reader := func() ([]ScrapeRow, error) {
		return []ScrapeRow{{
			MatchKey: "match-2026-05-10T21-29-28",
			Data: parser.MatchResult{
				Mode: "competitive", Map: "rialto",
				Date: "2026-05-10", FinishedAt: "21:29",
				Hero: "lucio",
				HeroesPlayed: []parser.HeroPlay{
					{Hero: "lucio", PercentPlayed: 60, Stats: map[string]int{"weapon_accuracy": 24}},
					{Hero: "kiriko", PercentPlayed: 40},
				},
				SR: []parser.HeroSR{{Hero: "lucio", SR: 3200, Change: 30}},
			},
		}}, nil
	}
	out := scrape(t, reader)

	mustContain := func(s string) {
		if !strings.Contains(out, s) {
			t.Errorf("missing %q in:\n%s", s, out)
		}
	}
	mustContain(`recall_match_percent_played{`)
	mustContain(`hero="kiriko"`)
	mustContain(`recall_hero_stat{`)
	mustContain(`stat="weapon_accuracy"`)
	mustContain(`} 24`)
	mustContain(`recall_match_sr{`)
	mustContain(`} 3200`)
	mustContain(`recall_match_sr_change{`)
	mustContain(`} 30`)
}

func TestCollector_ReaderErrorIsNonFatal(t *testing.T) {
	reader := func() ([]ScrapeRow, error) {
		return nil, errors.New("boom")
	}
	// Must not panic; output should just have no samples (only HELP/TYPE lines).
	out := scrape(t, reader)
	if strings.Contains(out, "recall_match_eliminations{") {
		t.Errorf("samples emitted despite reader error:\n%s", out)
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Server lifecycle — Start, scrape via the real bound port, Stop.
// Also verifies OWMETRICS_METRICS_ADDR is respected via t.Setenv.
// ──────────────────────────────────────────────────────────────────────────

func TestServer_StopIsIdempotent(t *testing.T) {
	t.Setenv("OWMETRICS_METRICS_ADDR", "127.0.0.1:0")
	s := NewServer("ignored", func() ([]ScrapeRow, error) { return nil, nil })
	// Calling Stop without Start is safe: http.Server.Shutdown logs but
	// doesn't panic when the server never started.
	s.Stop()
	s.Stop()
}

func TestNewServer_EnvAddrOverride(t *testing.T) {
	t.Setenv("OWMETRICS_METRICS_ADDR", "127.0.0.1:12345")
	s := NewServer("0.0.0.0:9091", func() ([]ScrapeRow, error) { return nil, nil })
	if s.addr != "127.0.0.1:12345" {
		t.Errorf("env override ignored: addr=%s", s.addr)
	}
}

func TestNewServer_DefaultAddr(t *testing.T) {
	// Make sure the env var isn't set from the surrounding test invocation.
	t.Setenv("OWMETRICS_METRICS_ADDR", "")
	s := NewServer(":9091", func() ([]ScrapeRow, error) { return nil, nil })
	if s.addr != ":9091" {
		t.Errorf("default addr lost: addr=%s", s.addr)
	}
}
