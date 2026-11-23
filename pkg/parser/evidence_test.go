package parser_test

import (
	"image"
	"image/color"
	"sync"
	"testing"

	"recall/pkg/parser"
)

// ──────────────────────────────────────────────────────────────────────────
// Field evidence: every field a parse reads records the screenshot region its
// accepted reading came from. These tests stub the Tesseract seam, note the
// region each named OCR call was handed, and check the recorded rect is that
// region — so a reader that tries several bands must record the one it
// believed, not the first one it tried.
// ──────────────────────────────────────────────────────────────────────────

// stubOCRRegions answers each OCR call from table (keyed by region name) and
// returns the source region every named call was handed. Read it only after
// the parse returns.
func stubOCRRegions(t *testing.T, table map[string]string) map[string]image.Rectangle {
	t.Helper()
	var mu sync.Mutex
	seen := map[string]image.Rectangle{}
	original := *parser.RunTesseractFunc
	*parser.RunTesseractFunc = func(_ image.Image, spec parser.OCRSpec) (string, error) { //nolint:unparam // signature fixed by RunTesseractFunc
		mu.Lock()
		seen[parser.SpecName(spec)] = parser.SpecRect(spec)
		mu.Unlock()
		return table[parser.SpecName(spec)], nil
	}
	t.Cleanup(func() { *parser.RunTesseractFunc = original })
	return seen
}

// landscapeImage is a black 16:9 frame; non-square so a crop that swapped
// width for height would land out of bounds.
func landscapeImage() image.Image {
	img := image.NewRGBA(image.Rect(0, 0, 384, 216))
	fillRect(img, img.Bounds(), color.RGBA{A: 255})
	return img
}

func evidenceRect(res *parser.MatchResult, field parser.FieldPath) (image.Rectangle, bool) {
	for _, ev := range res.Evidence {
		if ev.Field == field {
			return ev.Rect, true
		}
	}
	return image.Rectangle{}, false
}

// assertEvidence checks field's recorded region is exactly the one the named
// OCR call saw, and that it is a real region inside the image.
func assertEvidence(t *testing.T, res *parser.MatchResult, img image.Image, field parser.FieldPath, seenBy image.Rectangle) {
	t.Helper()
	got, ok := evidenceRect(res, field)
	if !ok {
		t.Errorf("no evidence recorded for %s; have %+v", field, res.Evidence)
		return
	}
	if seenBy.Empty() {
		t.Fatalf("%s: the expected OCR call never ran, so there is nothing to compare against", field)
	}
	if got != seenBy {
		t.Errorf("%s evidence = %v, want %v (the region the accepted read saw)", field, got, seenBy)
	}
	if got.Empty() || !got.In(img.Bounds()) {
		t.Errorf("%s evidence %v must be a non-empty region inside the image %v", field, got, img.Bounds())
	}
}

func TestParseSummary_RecordsTheColumnEachFieldWasReadFrom(t *testing.T) {
	seen := stubOCRRegions(t, map[string]string{
		"summary_heroes":                  "LUCIO\n60%\n6:30\nKIRIKO\n40%\n4:30",
		"summary_perf_eliminations":       "17\nELIMINATIONS\nAVG PER 10 MIN: 14.5",
		"summary_perf_eliminations_total": "17",
		"summary_perf_assists":            "16\nASSISTS\nAVG PER 10 MIN: 13.0",
		"summary_perf_assists_total":      "16",
		"summary_perf_deaths":             "11\nDEATHS\nAVG PER 10 MIN: 9.1",
		"summary_perf_deaths_total":       "11",
		"summary_card": "COMPETITIVE\nVICTORY!\nHYBRID\nHOLLYWOOD\n" +
			"FINAL SCORE 3 - 0\nDATE 5/10/26 21:47\nGAME LENGTH 12:34",
	})
	img := landscapeImage()
	res, err := parser.ParseSummary(img, t.TempDir())
	if err != nil {
		t.Fatalf("ParseSummary: %v", err)
	}
	for _, f := range []parser.FieldPath{parser.ScalarPath("hero"), parser.HeroPercentPath("lucio"), parser.HeroPercentPath("kiriko")} {
		assertEvidence(t, res, img, f, seen["summary_heroes"])
	}
	for _, f := range []string{"eliminations", "assists", "deaths"} {
		assertEvidence(t, res, img, parser.ScalarPath(f), seen["summary_perf_"+f])
	}
	for _, f := range []string{"map", "result", "final_score", "date", "finished_at", "game_length"} {
		assertEvidence(t, res, img, parser.ScalarPath(f), seen["summary_card"])
	}
}

// A field the card did not show records nothing: evidence for a value that was
// never read would point a reviewer at pixels that say nothing about it.
func TestParseSummary_RecordsNoEvidenceForFieldsItDidNotRead(t *testing.T) {
	stubOCRRegions(t, map[string]string{"summary_card": "HOLLYWOOD"})
	res, err := parser.ParseSummary(landscapeImage(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseSummary: %v", err)
	}
	for _, f := range []string{"hero", "eliminations", "result", "final_score", "date", "finished_at", "game_length"} {
		if r, ok := evidenceRect(res, parser.ScalarPath(f)); ok {
			t.Errorf("%s was not read but recorded evidence %v", f, r)
		}
	}
}

// A 0 read off the card is a reading and names its region; a stat whose label
// carried no digits was never read and names none — the rule every parser
// shares, so a region always means "these pixels gave this value".
func TestParseSummary_RecordsEvidenceForAReadZeroButNotForAnUnreadStat(t *testing.T) {
	seen := stubOCRRegions(t, map[string]string{
		"summary_perf_eliminations":       "17\nELIMINATIONS\nAVG PER 10 MIN: 14.5",
		"summary_perf_eliminations_total": "17",
		"summary_perf_assists":            "0\nASSISTS\nAVG PER 10 MIN: 0.0",
		"summary_perf_assists_total":      "0",
		"summary_perf_deaths":             "DEATHS",
	})
	img := landscapeImage()
	res, err := parser.ParseSummary(img, t.TempDir())
	if err != nil {
		t.Fatalf("ParseSummary: %v", err)
	}
	assertEvidence(t, res, img, parser.ScalarPath("assists"), seen["summary_perf_assists"])
	if r, ok := evidenceRect(res, parser.ScalarPath("deaths")); ok {
		t.Errorf("deaths carried no digits but recorded evidence %v", r)
	}
}

// A TEAMS cell no pass could read falls back to 0 — a placeholder, not a
// reading — so it names no region, while a cell that read "0" does.
func TestParseTeams_RecordsEvidenceForAReadZeroButNotForAnUnreadCell(t *testing.T) {
	seen := stubOCRRegions(t, map[string]string{
		"col_e_bin": "17", "col_a_bin": "0",
		"col_dmg_bin": "13,432", "col_h_bin": "1,204", "col_mit_bin": "2,860",
	})
	img := teamsBoard()
	res, err := parser.ParseTeams(img, t.TempDir())
	if err != nil {
		t.Fatalf("ParseTeams: %v", err)
	}
	assertEvidence(t, res, img, parser.ScalarPath("assists"), seen["col_a_bin"])
	if r, ok := evidenceRect(res, parser.ScalarPath("deaths")); ok {
		t.Errorf("deaths was read by no pass but recorded evidence %v", r)
	}
}

func TestParseTeams_RecordsEachStatCellsRegion(t *testing.T) {
	seen := stubOCRRegions(t, map[string]string{
		"col_e_bin": "17", "col_a_bin": "9", "col_d_bin": "4",
		"col_dmg_bin": "13,432", "col_h_bin": "1,204", "col_mit_bin": "2,860",
	})
	img := teamsBoard()
	res, err := parser.ParseTeams(img, t.TempDir())
	if err != nil {
		t.Fatalf("ParseTeams: %v", err)
	}
	cells := []struct{ field, region string }{
		{"eliminations", "col_e_bin"}, {"assists", "col_a_bin"}, {"deaths", "col_d_bin"},
		{"damage", "col_dmg_bin"}, {"healing", "col_h_bin"}, {"mitigation", "col_mit_bin"},
	}
	for _, c := range cells {
		assertEvidence(t, res, img, parser.ScalarPath(c.field), seen[c.region])
	}
}

// The movement pill is tried over four bands in turn; the one whose reading
// was accepted is the one the evidence must name.
func TestParseRank_ChangePercentRecordsTheBandThatRead(t *testing.T) {
	for _, region := range []string{"rank_change_pill", "rank_change_raw", "rank_change_narrow", "rank_change"} {
		t.Run(region, func(t *testing.T) {
			seen := stubOCRRegions(t, map[string]string{region: "+12%"})
			img := landscapeImage()
			res, err := parser.ParseRank(img, t.TempDir())
			if err != nil {
				t.Fatalf("ParseRank: %v", err)
			}
			assertEvidence(t, res, img, parser.ScalarPath("change_percent"), seen[region])
		})
	}
}

func TestParseRank_RecordsTheRegionOfEachCardReading(t *testing.T) {
	seen := stubOCRRegions(t, map[string]string{
		"rank_banner":            "COMPETITIVE VICTORY!",
		"rank_tier":              "PLATINUM 3\nRANK PROGRESS: 50%\nHIGHER RANKED THAN 57% OF PLAYERS",
		"rank_progress_occluded": "50%",
		"rank_modifiers":         "EXPECTED VICTORY",
		"rank_sr":                "LUCIO SR 2754 30\nANA SR 1896 8",
	})
	img := landscapeImage()
	res, err := parser.ParseRank(img, t.TempDir())
	if err != nil {
		t.Fatalf("ParseRank: %v", err)
	}
	assertEvidence(t, res, img, parser.ScalarPath("result"), seen["rank_banner"])
	for _, f := range []string{"rank", "level", "rank_percentile"} {
		assertEvidence(t, res, img, parser.ScalarPath(f), seen["rank_tier"])
	}
	assertEvidence(t, res, img, parser.ScalarPath("rank_progress"), seen["rank_progress_occluded"])
	assertEvidence(t, res, img, parser.ScalarPath("modifiers"), seen["rank_modifiers"])
	for _, f := range []parser.FieldPath{parser.ScalarPath("hero"), parser.SRPath("lucio"), parser.SRPath("ana")} {
		assertEvidence(t, res, img, f, seen["rank_sr"])
	}
}

// With the banner unread, the result comes from the modifier pill — so the
// evidence is the pill row, not the banner nobody could read.
func TestParseRank_ResultFromTheModifierPillRecordsThePillRow(t *testing.T) {
	seen := stubOCRRegions(t, map[string]string{"rank_modifiers": "EXPECTED DEFEAT"})
	img := landscapeImage()
	res, err := parser.ParseRank(img, t.TempDir())
	if err != nil {
		t.Fatalf("ParseRank: %v", err)
	}
	assertEvidence(t, res, img, parser.ScalarPath("result"), seen["rank_modifiers"])
}

// The occluded card reads its tier word from the band but its level from the
// badge hexagon — two regions, and each field must name its own.
func TestParseRank_OccludedTierRecordsTheBadgeForTheLevel(t *testing.T) {
	seen := stubOCRRegions(t, occludedSettledOCR)
	img := landscapeImage()
	res, err := parser.ParseRank(img, t.TempDir())
	if err != nil {
		t.Fatalf("ParseRank: %v", err)
	}
	assertEvidence(t, res, img, parser.ScalarPath("rank"), seen["rank_tier_occluded"])
	assertEvidence(t, res, img, parser.ScalarPath("level"), seen["rank_badge"])
	assertEvidence(t, res, img, parser.ScalarPath("rank_percentile"), seen["rank_percentile_occluded"])
	assertEvidence(t, res, img, parser.SRPath("juno"), seen["rank_sr_occluded"])
}

// A card whose SR the digit-forced re-read supplied records that re-read's
// region; a card the panel text already read keeps the panel's.
func TestParseRank_BackfilledSRRecordsTheDigitRereadRegion(t *testing.T) {
	seen := stubOCRRegions(t, map[string]string{
		"rank_sr":          "LUCIO SR 2754 ^30\nANA SR ---- ^8",
		"rank_sr_digits_6": "2754\n1896",
		"rank_modifiers":   "VICTORY",
	})
	img := landscapeImage()
	res, err := parser.ParseRank(img, t.TempDir())
	if err != nil {
		t.Fatalf("ParseRank: %v", err)
	}
	assertEvidence(t, res, img, parser.SRPath("lucio"), seen["rank_sr"])
	assertEvidence(t, res, img, parser.SRPath("ana"), seen["rank_sr_digits_6"])
}

func TestParsePersonal_RecordsEachCardsRegion(t *testing.T) {
	seen := stubOCRRegions(t, map[string]string{
		"personal_r0c0": "KIRIKO\n40%\n4:30",
		"personal_r0c1": "41%\nCRITICAL HIT ACCURACY",
		"personal_r1c2": "13\nSOLO KILLS",
	})
	img := landscapeImage()
	res, err := parser.ParsePersonal(img, t.TempDir())
	if err != nil {
		t.Fatalf("ParsePersonal: %v", err)
	}
	assertEvidence(t, res, img, parser.ScalarPath("hero"), seen["personal_r0c0"])
	assertEvidence(t, res, img, parser.HeroPercentPath("kiriko"), seen["personal_r0c0"])
	assertEvidence(t, res, img, parser.HeroStatPath("kiriko", "critical_hit_accuracy"), seen["personal_r0c1"])
	assertEvidence(t, res, img, parser.HeroStatPath("kiriko", "solo_kills"), seen["personal_r1c2"])
}

// Two cards that resolve to one stat key leave one value — the later card's —
// and the evidence has to follow it, once.
func TestParsePersonal_ARepeatedStatKeepsOneRegionTheLaterCards(t *testing.T) {
	seen := stubOCRRegions(t, map[string]string{
		"personal_r0c0": "KIRIKO\n40%\n4:30",
		"personal_r0c1": "11\nSOLO KILLS",
		"personal_r2c2": "13\nSOLO KILLS",
	})
	img := landscapeImage()
	res, err := parser.ParsePersonal(img, t.TempDir())
	if err != nil {
		t.Fatalf("ParsePersonal: %v", err)
	}
	assertEvidence(t, res, img, parser.HeroStatPath("kiriko", "solo_kills"), seen["personal_r2c2"])
	n := 0
	for _, ev := range res.Evidence {
		if ev.Field == parser.HeroStatPath("kiriko", "solo_kills") {
			n++
		}
	}
	if n != 1 {
		t.Errorf("solo_kills recorded %d times, want once", n)
	}
}

func TestParseImage_RecordsTheScreenshotSize(t *testing.T) {
	stubOCR(t, map[string]string{"col_e_bin": "17"})
	res, err := parser.ParseImage(teamsBoard(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseImage: %v", err)
	}
	if want := teamsBoard().Bounds().Size(); res.ImageSize != want {
		t.Errorf("ImageSize = %v, want %v", res.ImageSize, want)
	}
}
