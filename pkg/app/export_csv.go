package app

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"recall/pkg/db"
)

// CSV export format: a single .zip containing one CSV per parent and
// child table plus a manifest.json with the envelope metadata. The
// data version (`schema`) is the same as the JSON export — only the
// container changes — so a CSV import and a JSON import resolve to
// the same Screenshots snapshot before Upsert.
//
// File names inside the archive:
//   manifest.json
//   summaries.csv
//   summary_heroes_played.csv
//   teams.csv
//   teams_hero_stats.csv
//   personals.csv
//   personal_hero_stats.csv
//   ranks.csv
//   rank_modifiers.csv
//   rank_sr.csv
//   unknowns.csv
//   screenshots_dirs.csv
//
// Excel / Sheets opens each CSV file directly when the user extracts
// the zip. Round-trips via ImportData (auto-detect on payload).

// ExportDataCSV produces a zip-of-CSVs equivalent of ExportData's JSON.
// Same data, different container — chosen by the UI based on user
// preference. Round-trippable through ImportData.
func (a *App) ExportDataCSV() ([]byte, error) {
	snap, err := a.store.LoadAll()
	if err != nil {
		return nil, fmt.Errorf("export csv: load: %w", err)
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	// manifest.json — same envelope shape as the JSON export, minus the
	// row arrays (those live in the .csv files).
	manifest := struct {
		Schema        string `json:"schema"`
		ExportedAt    string `json:"exported_at"`
		RecallVersion string `json:"recall_version"`
		Container     string `json:"container"` // "zip-of-csvs"
	}{
		Schema:        exportSchemaV1,
		ExportedAt:    nowUTC(),
		RecallVersion: Version,
		Container:     "zip-of-csvs",
	}
	if err := zipWriteJSON(zw, "manifest.json", manifest); err != nil {
		return nil, err
	}

	// screenshots_dirs.csv — small lookup table.
	if err := zipWriteCSV(
		zw, "screenshots_dirs.csv",
		[]string{"id", "path"},
		mapToRows(snap.ScreenshotsDirs),
	); err != nil {
		return nil, err
	}

	// Parent + child tables.
	if err := zipWriteCSV(zw, "summaries.csv", summaryHeader, summariesToRows(snap.Summaries)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "summary_heroes_played.csv", summaryHeroPlayedHeader, summaryHeroesPlayedToRows(snap.Summaries)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "teams.csv", teamsHeader, teamsToRows(snap.Teams)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "teams_hero_stats.csv", heroStatHeader, teamsStatsToRows(snap.Teams)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "personals.csv", personalHeader, personalsToRows(snap.Personals)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "personal_hero_stats.csv", heroStatHeader, personalStatsToRows(snap.Personals)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "ranks.csv", rankHeader, ranksToRows(snap.Ranks)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "rank_modifiers.csv", []string{"rank_screenshot_id", "modifier"}, rankModifiersToRows(snap.Ranks)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "rank_sr.csv", []string{"rank_screenshot_id", "hero", "sr", "change"}, rankSRToRows(snap.Ranks)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "unknowns.csv", unknownHeader, unknownsToRows(snap.Unknowns)); err != nil {
		return nil, err
	}

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// importDataCSV reads a zip-of-CSVs payload, rebuilds a Screenshots
// snapshot (with children re-attached to their parents by source id),
// then routes through the same Clear + Upsert flow as the JSON path.
func (a *App) importDataCSV(payload []byte) error {
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return fmt.Errorf("%w: open zip: %v", ErrImportMalformed, err)
	}

	// Validate manifest first so we fail fast on wrong-schema archives.
	manifestBytes, err := readZipFile(zr, "manifest.json")
	if err != nil {
		return fmt.Errorf("%w: missing manifest.json: %v", ErrImportMalformed, err)
	}
	var mf struct {
		Schema string `json:"schema"`
	}
	if err := json.Unmarshal(manifestBytes, &mf); err != nil {
		return fmt.Errorf("%w: manifest decode: %v", ErrImportMalformed, err)
	}
	if mf.Schema != exportSchemaV1 {
		return fmt.Errorf("import csv: unsupported schema %q (this build expects %q)", mf.Schema, exportSchemaV1)
	}

	dirs, err := readDirsCSV(zr)
	if err != nil {
		return err
	}
	summaries, err := readSummariesCSV(zr)
	if err != nil {
		return err
	}
	teams, err := readTeamsCSV(zr)
	if err != nil {
		return err
	}
	personals, err := readPersonalsCSV(zr)
	if err != nil {
		return err
	}
	ranks, err := readRanksCSV(zr)
	if err != nil {
		return err
	}
	unknowns, err := readUnknownsCSV(zr)
	if err != nil {
		return err
	}

	// Re-register dirs to capture old→new id remap, Clear the store,
	// then re-register again (Clear wipes screenshots_dirs too) — same
	// double-pass shape as the JSON path.
	for srcIDStr, path := range dirs {
		if _, err := strconv.ParseInt(srcIDStr, 10, 64); err != nil {
			return fmt.Errorf("import csv: invalid dir id %q: %w", srcIDStr, err)
		}
		if _, err := a.store.EnsureScreenshotsDir(path); err != nil {
			return fmt.Errorf("import csv: register dir %q: %w", path, err)
		}
	}
	if err := a.store.Clear(); err != nil {
		return fmt.Errorf("import csv: clear: %w", err)
	}
	remap := map[int64]int64{}
	for srcIDStr, path := range dirs {
		srcID, _ := strconv.ParseInt(srcIDStr, 10, 64)
		dstID, err := a.store.EnsureScreenshotsDir(path)
		if err != nil {
			return fmt.Errorf("import csv: re-register dir %q: %w", path, err)
		}
		remap[srcID] = dstID
	}
	remapID := func(srcID int64) int64 {
		if srcID == 0 {
			return db.SentinelScreenshotsDirID
		}
		if dst, ok := remap[srcID]; ok {
			return dst
		}
		// Unknown source id — point at the sentinel row. The dir_id
		// column is `NOT NULL`; we can't drop it.
		return db.SentinelScreenshotsDirID
	}

	for _, r := range summaries {
		r.ID = 0
		r.ScreenshotsDirID = remapID(r.ScreenshotsDirID)
		if err := a.store.UpsertSummary(r); err != nil {
			return fmt.Errorf("import csv: summary %q: %w", r.Filename, err)
		}
	}
	for _, r := range teams {
		r.ID = 0
		r.ScreenshotsDirID = remapID(r.ScreenshotsDirID)
		if err := a.store.UpsertTeams(r); err != nil {
			return fmt.Errorf("import csv: teams %q: %w", r.Filename, err)
		}
	}
	for _, r := range personals {
		r.ID = 0
		r.ScreenshotsDirID = remapID(r.ScreenshotsDirID)
		if err := a.store.UpsertPersonal(r); err != nil {
			return fmt.Errorf("import csv: personal %q: %w", r.Filename, err)
		}
	}
	for _, r := range ranks {
		r.ID = 0
		r.ScreenshotsDirID = remapID(r.ScreenshotsDirID)
		if err := a.store.UpsertRank(r); err != nil {
			return fmt.Errorf("import csv: rank %q: %w", r.Filename, err)
		}
	}
	for _, r := range unknowns {
		r.ID = 0
		r.ScreenshotsDirID = remapID(r.ScreenshotsDirID)
		if err := a.store.UpsertUnknown(r); err != nil {
			return fmt.Errorf("import csv: unknown %q: %w", r.Filename, err)
		}
	}
	return nil
}

// ────────────────────────────────────────────────────────────────────
// Headers + row builders for each table. The header order locks the
// column layout; row builders must produce strings in the same order.
// ────────────────────────────────────────────────────────────────────

var (
	summaryHeader = []string{
		"id", "filename", "match_key", "parsed_at", "screenshots_dir_id",
		"map", "playlist", "hero", "result", "final_score",
		"date", "finished_at", "game_length",
		"perf_elim_total", "perf_elim_avg_per_10min",
		"perf_assists_total", "perf_assists_avg_per_10min",
		"perf_deaths_total", "perf_deaths_avg_per_10min",
	}
	summaryHeroPlayedHeader = []string{"summary_screenshot_id", "hero", "percent_played", "play_time"}
	teamsHeader             = []string{
		"id", "filename", "match_key", "parsed_at", "screenshots_dir_id",
		"map", "playlist", "hero",
		"eliminations", "assists", "deaths", "damage", "healing", "mitigation",
		"queue_type",
	}
	heroStatHeader = []string{"parent_id", "hero", "stat_key", "stat_value"}
	personalHeader = []string{
		"id", "filename", "match_key", "parsed_at", "screenshots_dir_id", "hero",
	}
	rankHeader = []string{
		"id", "filename", "match_key", "parsed_at", "screenshots_dir_id",
		"rank", "level", "rank_progress", "change_percent", "result",
	}
	unknownHeader = []string{
		"id", "filename", "match_key", "parsed_at", "screenshots_dir_id",
	}
)

func mapToRows(m map[int64]string) [][]string {
	out := make([][]string, 0, len(m))
	for id, path := range m {
		out = append(out, []string{strconv.FormatInt(id, 10), path})
	}
	return out
}

func summariesToRows(rows []db.SummaryRow) [][]string {
	out := make([][]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, []string{
			strconv.FormatInt(r.ID, 10),
			r.Filename, r.MatchKey, r.ParsedAt,
			strconv.FormatInt(r.ScreenshotsDirID, 10),
			r.Map, r.Playlist, r.Hero, r.Result, r.FinalScore,
			r.Date, r.FinishedAt, r.GameLength,
			strconv.Itoa(r.PerfElimTotal),
			strconv.FormatFloat(r.PerfElimAvgPer10Min, 'f', -1, 64),
			strconv.Itoa(r.PerfAssistsTotal),
			strconv.FormatFloat(r.PerfAssistsAvgPer10Min, 'f', -1, 64),
			strconv.Itoa(r.PerfDeathsTotal),
			strconv.FormatFloat(r.PerfDeathsAvgPer10Min, 'f', -1, 64),
		})
	}
	return out
}

func summaryHeroesPlayedToRows(rows []db.SummaryRow) [][]string {
	var out [][]string
	for _, r := range rows {
		for _, h := range r.HeroesPlayed {
			out = append(out, []string{
				strconv.FormatInt(r.ID, 10),
				h.Hero,
				strconv.Itoa(h.PercentPlayed),
				h.PlayTime,
			})
		}
	}
	return out
}

func teamsToRows(rows []db.TeamsRow) [][]string {
	out := make([][]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, []string{
			strconv.FormatInt(r.ID, 10),
			r.Filename, r.MatchKey, r.ParsedAt,
			strconv.FormatInt(r.ScreenshotsDirID, 10),
			r.Map, r.Playlist, r.Hero,
			strconv.Itoa(r.Eliminations), strconv.Itoa(r.Assists), strconv.Itoa(r.Deaths),
			strconv.Itoa(r.Damage), strconv.Itoa(r.Healing), strconv.Itoa(r.Mitigation),
			r.QueueType,
		})
	}
	return out
}

func teamsStatsToRows(rows []db.TeamsRow) [][]string {
	var out [][]string
	for _, r := range rows {
		for _, s := range r.HeroStats {
			out = append(out, []string{
				strconv.FormatInt(r.ID, 10),
				s.Hero, s.StatKey, strconv.Itoa(s.StatValue),
			})
		}
	}
	return out
}

func personalsToRows(rows []db.PersonalRow) [][]string {
	out := make([][]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, []string{
			strconv.FormatInt(r.ID, 10),
			r.Filename, r.MatchKey, r.ParsedAt,
			strconv.FormatInt(r.ScreenshotsDirID, 10),
			r.Hero,
		})
	}
	return out
}

func personalStatsToRows(rows []db.PersonalRow) [][]string {
	var out [][]string
	for _, r := range rows {
		for _, s := range r.HeroStats {
			out = append(out, []string{
				strconv.FormatInt(r.ID, 10),
				s.Hero, s.StatKey, strconv.Itoa(s.StatValue),
			})
		}
	}
	return out
}

func ranksToRows(rows []db.RankRow) [][]string {
	out := make([][]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, []string{
			strconv.FormatInt(r.ID, 10),
			r.Filename, r.MatchKey, r.ParsedAt,
			strconv.FormatInt(r.ScreenshotsDirID, 10),
			r.Rank,
			strconv.Itoa(r.Level), strconv.Itoa(r.RankProgress), strconv.Itoa(r.ChangePercent),
			r.Result,
		})
	}
	return out
}

func rankModifiersToRows(rows []db.RankRow) [][]string {
	var out [][]string
	for _, r := range rows {
		for _, m := range r.Modifiers {
			out = append(out, []string{strconv.FormatInt(r.ID, 10), m})
		}
	}
	return out
}

func rankSRToRows(rows []db.RankRow) [][]string {
	var out [][]string
	for _, r := range rows {
		for _, sr := range r.SR {
			out = append(out, []string{
				strconv.FormatInt(r.ID, 10),
				sr.Hero, strconv.Itoa(sr.SR), strconv.Itoa(sr.Change),
			})
		}
	}
	return out
}

func unknownsToRows(rows []db.UnknownRow) [][]string {
	out := make([][]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, []string{
			strconv.FormatInt(r.ID, 10),
			r.Filename, r.MatchKey, r.ParsedAt,
			strconv.FormatInt(r.ScreenshotsDirID, 10),
		})
	}
	return out
}

// ────────────────────────────────────────────────────────────────────
// Readers — CSV → typed rows + parent-id attachment for children.
// ────────────────────────────────────────────────────────────────────

func readDirsCSV(zr *zip.Reader) (map[string]string, error) {
	out := map[string]string{}
	// Older CSV exports might not have a screenshots_dirs.csv; treat
	// "not found" as an empty map. Any other error is fatal.
	records, err := readCSV(zr, "screenshots_dirs.csv")
	if err != nil {
		if strings.Contains(err.Error(), "not found in archive") {
			return out, nil
		}
		return nil, err
	}
	for _, rec := range records {
		if len(rec) < 2 {
			continue
		}
		out[rec[0]] = rec[1]
	}
	return out, nil
}

func readSummariesCSV(zr *zip.Reader) ([]db.SummaryRow, error) {
	rows, err := readCSV(zr, "summaries.csv")
	if err != nil {
		return nil, err
	}
	parents := make(map[int64]*db.SummaryRow, len(rows))
	out := make([]db.SummaryRow, 0, len(rows))
	for _, rec := range rows {
		if len(rec) < len(summaryHeader) {
			continue
		}
		r := db.SummaryRow{
			Filename: rec[1], MatchKey: rec[2], ParsedAt: rec[3],
			Map: rec[5], Playlist: rec[6], Hero: rec[7], Result: rec[8], FinalScore: rec[9],
			Date: rec[10], FinishedAt: rec[11], GameLength: rec[12],
		}
		srcID, _ := strconv.ParseInt(rec[0], 10, 64)
		r.ID = srcID
		dirID, _ := strconv.ParseInt(rec[4], 10, 64)
		r.ScreenshotsDirID = dirID
		r.PerfElimTotal, _ = strconv.Atoi(rec[13])
		r.PerfElimAvgPer10Min, _ = strconv.ParseFloat(rec[14], 64)
		r.PerfAssistsTotal, _ = strconv.Atoi(rec[15])
		r.PerfAssistsAvgPer10Min, _ = strconv.ParseFloat(rec[16], 64)
		r.PerfDeathsTotal, _ = strconv.Atoi(rec[17])
		r.PerfDeathsAvgPer10Min, _ = strconv.ParseFloat(rec[18], 64)
		out = append(out, r)
		parents[srcID] = &out[len(out)-1]
	}
	// Attach children.
	heroRows, _ := readCSV(zr, "summary_heroes_played.csv")
	for _, rec := range heroRows {
		if len(rec) < 4 {
			continue
		}
		pid, _ := strconv.ParseInt(rec[0], 10, 64)
		p, ok := parents[pid]
		if !ok {
			continue
		}
		pct, _ := strconv.Atoi(rec[2])
		p.HeroesPlayed = append(p.HeroesPlayed, db.SummaryHeroPlayed{
			Hero: rec[1], PercentPlayed: pct, PlayTime: rec[3],
		})
	}
	return out, nil
}

func readTeamsCSV(zr *zip.Reader) ([]db.TeamsRow, error) {
	rows, err := readCSV(zr, "teams.csv")
	if err != nil {
		return nil, err
	}
	parents := make(map[int64]*db.TeamsRow, len(rows))
	out := make([]db.TeamsRow, 0, len(rows))
	for _, rec := range rows {
		if len(rec) < len(teamsHeader) {
			continue
		}
		r := db.TeamsRow{
			Filename: rec[1], MatchKey: rec[2], ParsedAt: rec[3],
			Map: rec[5], Playlist: rec[6], Hero: rec[7],
		}
		r.ID, _ = strconv.ParseInt(rec[0], 10, 64)
		r.ScreenshotsDirID, _ = strconv.ParseInt(rec[4], 10, 64)
		r.Eliminations, _ = strconv.Atoi(rec[8])
		r.Assists, _ = strconv.Atoi(rec[9])
		r.Deaths, _ = strconv.Atoi(rec[10])
		r.Damage, _ = strconv.Atoi(rec[11])
		r.Healing, _ = strconv.Atoi(rec[12])
		r.Mitigation, _ = strconv.Atoi(rec[13])
		r.QueueType = rec[14]
		out = append(out, r)
		parents[r.ID] = &out[len(out)-1]
	}
	statRows, _ := readCSV(zr, "teams_hero_stats.csv")
	for _, rec := range statRows {
		if len(rec) < 4 {
			continue
		}
		pid, _ := strconv.ParseInt(rec[0], 10, 64)
		p, ok := parents[pid]
		if !ok {
			continue
		}
		v, _ := strconv.Atoi(rec[3])
		p.HeroStats = append(p.HeroStats, db.HeroStat{Hero: rec[1], StatKey: rec[2], StatValue: v})
	}
	return out, nil
}

func readPersonalsCSV(zr *zip.Reader) ([]db.PersonalRow, error) {
	rows, err := readCSV(zr, "personals.csv")
	if err != nil {
		return nil, err
	}
	parents := make(map[int64]*db.PersonalRow, len(rows))
	out := make([]db.PersonalRow, 0, len(rows))
	for _, rec := range rows {
		if len(rec) < len(personalHeader) {
			continue
		}
		r := db.PersonalRow{
			Filename: rec[1], MatchKey: rec[2], ParsedAt: rec[3], Hero: rec[5],
		}
		r.ID, _ = strconv.ParseInt(rec[0], 10, 64)
		r.ScreenshotsDirID, _ = strconv.ParseInt(rec[4], 10, 64)
		out = append(out, r)
		parents[r.ID] = &out[len(out)-1]
	}
	statRows, _ := readCSV(zr, "personal_hero_stats.csv")
	for _, rec := range statRows {
		if len(rec) < 4 {
			continue
		}
		pid, _ := strconv.ParseInt(rec[0], 10, 64)
		p, ok := parents[pid]
		if !ok {
			continue
		}
		v, _ := strconv.Atoi(rec[3])
		p.HeroStats = append(p.HeroStats, db.HeroStat{Hero: rec[1], StatKey: rec[2], StatValue: v})
	}
	return out, nil
}

func readRanksCSV(zr *zip.Reader) ([]db.RankRow, error) {
	rows, err := readCSV(zr, "ranks.csv")
	if err != nil {
		return nil, err
	}
	parents := make(map[int64]*db.RankRow, len(rows))
	out := make([]db.RankRow, 0, len(rows))
	for _, rec := range rows {
		if len(rec) < len(rankHeader) {
			continue
		}
		r := db.RankRow{
			Filename: rec[1], MatchKey: rec[2], ParsedAt: rec[3],
			Rank: rec[5], Result: rec[9],
		}
		r.ID, _ = strconv.ParseInt(rec[0], 10, 64)
		r.ScreenshotsDirID, _ = strconv.ParseInt(rec[4], 10, 64)
		r.Level, _ = strconv.Atoi(rec[6])
		r.RankProgress, _ = strconv.Atoi(rec[7])
		r.ChangePercent, _ = strconv.Atoi(rec[8])
		out = append(out, r)
		parents[r.ID] = &out[len(out)-1]
	}
	modRows, _ := readCSV(zr, "rank_modifiers.csv")
	for _, rec := range modRows {
		if len(rec) < 2 {
			continue
		}
		pid, _ := strconv.ParseInt(rec[0], 10, 64)
		if p, ok := parents[pid]; ok {
			p.Modifiers = append(p.Modifiers, rec[1])
		}
	}
	srRows, _ := readCSV(zr, "rank_sr.csv")
	for _, rec := range srRows {
		if len(rec) < 4 {
			continue
		}
		pid, _ := strconv.ParseInt(rec[0], 10, 64)
		p, ok := parents[pid]
		if !ok {
			continue
		}
		sr, _ := strconv.Atoi(rec[2])
		ch, _ := strconv.Atoi(rec[3])
		p.SR = append(p.SR, db.HeroSR{Hero: rec[1], SR: sr, Change: ch})
	}
	return out, nil
}

func readUnknownsCSV(zr *zip.Reader) ([]db.UnknownRow, error) {
	rows, err := readCSV(zr, "unknowns.csv")
	if err != nil {
		return nil, err
	}
	out := make([]db.UnknownRow, 0, len(rows))
	for _, rec := range rows {
		if len(rec) < len(unknownHeader) {
			continue
		}
		r := db.UnknownRow{
			Filename: rec[1], MatchKey: rec[2], ParsedAt: rec[3],
		}
		r.ID, _ = strconv.ParseInt(rec[0], 10, 64)
		r.ScreenshotsDirID, _ = strconv.ParseInt(rec[4], 10, 64)
		out = append(out, r)
	}
	return out, nil
}

// ────────────────────────────────────────────────────────────────────
// Zip helpers.
// ────────────────────────────────────────────────────────────────────

func zipWriteJSON(zw *zip.Writer, name string, v any) error {
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	_, err = w.Write(b)
	return err
}

func zipWriteCSV(zw *zip.Writer, name string, header []string, rows [][]string) error {
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	cw := csv.NewWriter(w)
	if err := cw.Write(header); err != nil {
		return err
	}
	for _, r := range rows {
		if err := cw.Write(r); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// maxZipEntryBytes caps the DECOMPRESSED size of any single entry
// read from an imported archive. The /imports endpoint caps the
// COMPRESSED upload at 50 MiB (server_backup.go), but DEFLATE can
// expand by ~1000x on repetitive input — so without a decompressed
// cap a 50 MiB zip-bomb could balloon to tens of GB and OOM the
// process, and any host on the no-auth LAN can POST to /imports.
// 64 MiB per entry is generous for the largest real table CSV (years
// of competitive history) while bounding memory hard. Exceeding it is
// treated as a malformed import (ErrImportMalformed → HTTP 400).
//
// Declared as a var, not a const, so tests can lower it to exercise
// the bomb path cheaply (the package-var test-seam pattern, same as
// update.go's URL seams).
var maxZipEntryBytes int64 = 64 << 20 // 64 MiB

// readZipFile reads one archive entry's decompressed content, bounded
// at maxZipEntryBytes. An entry larger than the cap is rejected as a
// likely decompression bomb. The io.LimitReader makes the read
// resident size at most maxZipEntryBytes+1, so gosec G110 no longer
// applies — the read is explicitly bounded.
func readZipFile(zr *zip.Reader, name string) ([]byte, error) {
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		defer func() { _ = rc.Close() }()
		// Read one byte past the cap so an entry sitting exactly at
		// the cap still succeeds while anything larger is detected.
		b, err := io.ReadAll(io.LimitReader(rc, maxZipEntryBytes+1))
		if err != nil {
			return nil, err
		}
		if int64(len(b)) > maxZipEntryBytes {
			return nil, fmt.Errorf("%w: entry %q exceeds %d bytes decompressed (possible zip bomb)", ErrImportMalformed, name, maxZipEntryBytes)
		}
		return b, nil
	}
	return nil, fmt.Errorf("zip: %q not found", name)
}

// readCSV reads + parses one CSV entry from the archive. The entry
// bytes flow through readZipFile, so the same decompression cap
// applies before the CSV is parsed.
func readCSV(zr *zip.Reader, name string) ([][]string, error) {
	b, err := readZipFile(zr, name)
	if err != nil {
		return nil, err
	}
	cr := csv.NewReader(bytes.NewReader(b))
	cr.FieldsPerRecord = -1 // header columns + data columns; allow trailing-empty variance
	all, err := cr.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("csv read %s: %w", name, err)
	}
	// Drop the header row.
	if len(all) > 0 {
		return all[1:], nil
	}
	return nil, nil
}

// nowUTC is a tiny seam used by tests that want a deterministic
// timestamp. Production calls time.Now().UTC().
var nowUTC = func() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// looksLikeZIP returns true when the payload starts with the standard
// PKZip magic bytes. Cheap content-sniff used by ImportData to route
// between the JSON and CSV codepaths without a separate endpoint.
func looksLikeZIP(payload []byte) bool {
	return len(payload) >= 4 &&
		payload[0] == 0x50 && payload[1] == 0x4B &&
		(payload[2] == 0x03 || payload[2] == 0x05 || payload[2] == 0x07) &&
		(payload[3] == 0x04 || payload[3] == 0x06 || payload[3] == 0x08)
}

// looksLikeJSON returns true when the payload starts with whitespace
// + `{`. Used as the JSON sibling of looksLikeZIP.
func looksLikeJSON(payload []byte) bool {
	for _, b := range payload {
		if b == ' ' || b == '\t' || b == '\n' || b == '\r' {
			continue
		}
		return b == '{'
	}
	return false
}

// stripBOM trims a UTF-8 byte-order mark off the front of a payload
// if one is present. Some editors (looking at you, Notepad) prepend
// a BOM when saving as UTF-8, which breaks json.Unmarshal.
func stripBOM(b []byte) []byte {
	const bom = "\xef\xbb\xbf"
	if strings.HasPrefix(string(b[:min(len(b), 3)]), bom) {
		return b[3:]
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
