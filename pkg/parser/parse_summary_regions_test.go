package parser_test

import (
	"errors"
	"image"
	"slices"
	"strings"
	"testing"

	"recall/pkg/parser"
)

// ──────────────────────────────────────────────────────────────────────────
// parseSummary — the heroes column ("summary_heroes"), each performance card
// ("summary_perf_<stat>", its total "summary_perf_<stat>_total") and the map
// card ("summary_card"), OCR'd independently and folded into one MatchResult.
// ──────────────────────────────────────────────────────────────────────────

// stubOCRRegionFails makes exactly one region's OCR fail and every other
// region come back empty, with the retry ladder collapsed so the failure
// lands without sleeping.
func stubOCRRegionFails(t *testing.T, failing string, err error) {
	t.Helper()
	prevDelays := *parser.TesseractRetryDelays
	*parser.TesseractRetryDelays = nil
	original := *parser.RunTesseractFunc
	*parser.RunTesseractFunc = func(_ image.Image, spec parser.OCRSpec) (string, error) { //nolint:unparam // signature fixed by RunTesseractFunc
		if parser.SpecName(spec) == failing {
			return "", err
		}
		return "", nil
	}
	t.Cleanup(func() {
		*parser.RunTesseractFunc = original
		*parser.TesseractRetryDelays = prevDelays
	})
}

// An OCR failure in any one column aborts the whole parse — the file lands in
// the failed-files ledger and is retried next run rather than being stored
// half-read. The error has to name the column that failed (all three wraps
// are the same shape, so a copy-pasted label is invisible without this) and
// keep the underlying cause wrapped for errors.Is at the boundary.
func TestParseSummary_ColumnOCRFailureNamesTheColumnAndKeepsTheCause(t *testing.T) {
	cases := []struct{ name, region, wantPrefix string }{
		{"heroes column", "summary_heroes", "summary heroes OCR:"},
		{"performance card", "summary_perf_assists", "summary performance OCR:"},
		{"performance total", "summary_perf_deaths_total", "summary performance OCR:"},
		{"map card", "summary_card", "summary card OCR:"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			boom := errors.New("tesseract exited 1")
			stubOCRRegionFails(t, c.region, boom)
			res, err := parser.ParseSummary(tinyImage(), t.TempDir())
			if res != nil {
				t.Errorf("result = %+v, want nil — a partially OCR'd summary must not be stored", res)
			}
			if !errors.Is(err, boom) {
				t.Fatalf("error = %v, must wrap the OCR cause (%%w) so the ledger can classify it", err)
			}
			if !strings.HasPrefix(err.Error(), c.wantPrefix) {
				t.Errorf("error = %q, want it to start with %q", err, c.wantPrefix)
			}
		})
	}
}

// The whole-card contract in one pass: the heroes column drives hero/role and
// the play-order of heroes_played, the performance column's totals are
// mirrored onto the flat E/A/D fields the dossier reads, and the right card
// yields map/result/mode plus the three regex-extracted fields.
func TestParseSummary_FoldsAllThreeColumnsIntoOneResult(t *testing.T) {
	stubOCR(t, map[string]string{
		"summary_heroes":                  "LUCIO\n60%\n6:30\nKIRIKO\n40%\n4:30",
		"summary_perf_eliminations":       "17\nELIMINATIONS\nAVG PER 10 MIN: 14.5",
		"summary_perf_eliminations_total": "17",
		"summary_perf_assists":            "16\nASSISTS\nAVG PER 10 MIN: 13.0",
		"summary_perf_assists_total":      "16",
		"summary_perf_deaths":             "11\nDEATHS\nAVG PER 10 MIN: 9.1",
		"summary_perf_deaths_total":       "11",
		// "FINAL SCORE 3 - O": the OW banner font reads a zero as the
		// letter O, so the score groups go through digitize().
		"summary_card": "COMPETITIVE\nVICTORY!\nHYBRID\nHOLLYWOOD\n" +
			"FINAL SCORE 3 - O\nDATE 5/10/26 21:47\nGAME LENGTH 12:34",
	})
	res, err := parser.ParseSummary(tinyImage(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseSummary: %v", err)
	}

	if res.Hero != "lucio" || res.Role != "support" {
		t.Errorf("hero/role = %q/%q, want lucio/support (first heroes_played entry is the primary hero)", res.Hero, res.Role)
	}
	if got := heroNames(res); !slices.Equal(got, []string{"lucio", "kiriko"}) {
		t.Errorf("heroes_played = %v, want [lucio kiriko] in play order", got)
	}
	assertSummaryCard(t, res)

	if res.Performance == nil {
		t.Fatal("performance card was not parsed")
	}
	if res.Performance.Eliminations.AvgPer10Min != 14.5 {
		t.Errorf("eliminations avg = %v, want 14.5", res.Performance.Eliminations.AvgPer10Min)
	}
	// The flat fields are what the dossier and the correlation merge read;
	// they must mirror the performance card rather than staying zero.
	if res.Eliminations != 17 || res.Assists != 16 || res.Deaths != 11 {
		t.Errorf("flat E/A/D = %d/%d/%d, want 17/16/11", res.Eliminations, res.Assists, res.Deaths)
	}
}

func assertSummaryCard(t *testing.T, res *parser.MatchResult) {
	t.Helper()
	fields := []struct{ name, got, want string }{
		{"map", res.Map, "hollywood"},
		{"map_raw", res.MapRaw, ""},
		{"result", res.Result, "victory"},
		{"game_mode", res.GameMode, "hybrid"},
		{"final_score", res.FinalScore, "3-0"},
		{"date", res.Date, "2026-05-10"},
		{"finished_at", res.FinishedAt, "21:47"},
		{"game_length", res.GameLength, "12:34"},
	}
	for _, f := range fields {
		if f.got != f.want {
			t.Errorf("%s = %q, want %q", f.name, f.got, f.want)
		}
	}
}

// When neither matcher can pin a canonical name, the raw OCR text is
// preserved so the leaf chip can show "Unknown hero (miyazaki?)" and a later
// heroes.yaml/maps.yaml release can re-aggregate the stored rows without
// re-OCRing the PNG. Silently dropping the text is the failure mode this
// guards.
func TestParseSummary_OffRosterHeroAndMapSurviveAsRawText(t *testing.T) {
	stubOCR(t, map[string]string{
		"summary_heroes": "MIYAZAKI\n100%\n11:25",
		"summary_card":   "© PUSH - COMPETITIVE| BRAND NEW ARENA |",
	})
	res, err := parser.ParseSummary(tinyImage(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseSummary: %v", err)
	}
	if res.Hero != "" || res.HeroRaw != "miyazaki" {
		t.Errorf("hero/hero_raw = %q/%q, want \"\"/\"miyazaki\"", res.Hero, res.HeroRaw)
	}
	if res.Map != "" || res.MapRaw != "brand new arena" {
		t.Errorf("map/map_raw = %q/%q, want \"\"/\"brand new arena\"", res.Map, res.MapRaw)
	}
	// An empty performance column must leave Performance nil rather than
	// minting an all-zero card that reads as "played and scored nothing".
	if res.Performance != nil {
		t.Errorf("performance = %+v, want nil for a column with no labels", res.Performance)
	}
}
