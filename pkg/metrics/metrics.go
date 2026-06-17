// Package metrics exposes Recall match data as Prometheus metrics.
//
// The collector emits one labeled sample per match per metric on every scrape,
// each sample timestamped with the match's actual end time (date + finished_at).
// This means Prometheus plots match stats at the moment the match was played,
// not at scrape time — but it requires the Prometheus instance to have
// out-of-order ingestion enabled (the bundled docker-compose handles that).
package metrics

import (
	"context"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"recall/pkg/applog"
	"recall/pkg/parser"
)

// ScrapeRow is the minimal shape the collector needs from each DB row. App
// code converts MatchRecord → ScrapeRow when wiring up the reader so this
// package doesn't have to import main's types.
type ScrapeRow struct {
	MatchKey string
	Data     parser.MatchResult
	// Match-level context that lives on the outer MatchRecord, not in
	// parser.MatchResult. scrapeReader fills these; they become labels so
	// dashboards can slice every metric by queue, leaver, and review status.
	QueueType  string // "role" (5v5) | "open" (6v6) | "" — user override wins, else parser
	Leaver     string // "" | self | team | enemy
	ReviewedBy string // "" | self | coach
}

// Reader is the callback the collector uses to fetch current state on every
// scrape. Returning err short-circuits the scrape (Prometheus marks it down).
type Reader func() ([]ScrapeRow, error)

// matchLabels is the shared label set on every match-level metric. Putting
// `hero`/`role` on core metrics (not just per-hero ones) lets dashboards
// correlate the played hero with match outcome, damage, healing, etc.
// `queue_type`/`rank`/`leaver`/`reviewed_by` are match-level dimensions (same
// value for every hero in the match) so dashboards can split any metric by
// 5v5-vs-6v6, rank tier, thrown-game, or review status. hero_stat metrics
// extend this with an additional `stat` label.
//
// Order MUST match labelsFor's return slice. Cardinality is bounded: match_key
// already makes every match a unique series, so these add no new series.
var matchLabels = []string{
	"match_key", "map", "game_mode", "playlist", "result", "hero", "role",
	"queue_type", "rank", "leaver", "reviewed_by",
}

// Collector implements prometheus.Collector. Each Collect() call reads all
// matches via the Reader and emits one sample per (metric, labels, timestamp)
// triple — Prometheus dedupes identical triples across scrapes.
//
// The compile-time assertion below catches any accidental signature drift
// on Describe / Collect at build time instead of at the
// `prometheus.MustRegister(c)` call site, where the failure is harder
// to diagnose.
type Collector struct {
	read Reader

	eliminations *prometheus.Desc
	assists      *prometheus.Desc
	deaths       *prometheus.Desc
	damage       *prometheus.Desc
	healing      *prometheus.Desc
	mitigation   *prometheus.Desc

	matchResult  *prometheus.Desc // 1, label "result" carries victory/defeat/draw
	win          *prometheus.Desc // 1 victory / 0 defeat / 0.5 draw — avg() = win rate
	rankLevel    *prometheus.Desc // 1-5
	rankProgress *prometheus.Desc // 0-100 % into the current tier level
	gameLength   *prometheus.Desc // match duration in seconds

	perfElims   *prometheus.Desc // per-10-min averages from the SUMMARY perf card
	perfAssists *prometheus.Desc
	perfDeaths  *prometheus.Desc

	percentPlayed *prometheus.Desc // hero playtime as % of match (per hero in heroes_played)
	heroSR        *prometheus.Desc
	heroSRChange  *prometheus.Desc
	heroStat      *prometheus.Desc // matchLabels + "stat"
}

var _ prometheus.Collector = (*Collector)(nil)

func New(read Reader) *Collector {
	desc := func(name, help string, extra ...string) *prometheus.Desc {
		labels := append([]string{}, matchLabels...)
		labels = append(labels, extra...)
		return prometheus.NewDesc("recall_"+name, help, labels, nil)
	}
	return &Collector{
		read:          read,
		eliminations:  desc("match_eliminations", "Eliminations earned in the match."),
		assists:       desc("match_assists", "Assists earned in the match."),
		deaths:        desc("match_deaths", "Deaths in the match."),
		damage:        desc("match_damage", "Damage dealt in the match."),
		healing:       desc("match_healing", "Healing done in the match."),
		mitigation:    desc("match_mitigation", "Damage mitigated in the match."),
		matchResult:   desc("match_result", "Always 1; the `result` label carries victory/defeat/draw."),
		win:           desc("match_win", "Match outcome as a number: 1 victory, 0 defeat, 0.5 draw. avg() over any label set = win rate."),
		rankLevel:     desc("match_rank_level", "Competitive rank sub-division (1-5)."),
		rankProgress:  desc("match_rank_progress", "Percent progress into the current competitive tier level (0-100)."),
		gameLength:    desc("match_game_length_seconds", "Match duration in seconds."),
		perfElims:     desc("match_perf_eliminations_per10", "Eliminations per 10 minutes (length-normalized SUMMARY performance average)."),
		perfAssists:   desc("match_perf_assists_per10", "Assists per 10 minutes (length-normalized SUMMARY performance average)."),
		perfDeaths:    desc("match_perf_deaths_per10", "Deaths per 10 minutes (length-normalized SUMMARY performance average)."),
		percentPlayed: desc("match_percent_played", "Percentage of the match's playtime spent on this hero."),
		heroSR:        desc("match_sr", "Per-hero SR at the end of the match."),
		heroSRChange:  desc("match_sr_change", "Per-hero SR delta from this match."),
		heroStat:      desc("hero_stat", "Hero-specific stat value (label `stat` identifies which).", "stat"),
	}
}

func (c *Collector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.eliminations
	ch <- c.assists
	ch <- c.deaths
	ch <- c.damage
	ch <- c.healing
	ch <- c.mitigation
	ch <- c.matchResult
	ch <- c.win
	ch <- c.rankLevel
	ch <- c.rankProgress
	ch <- c.gameLength
	ch <- c.perfElims
	ch <- c.perfAssists
	ch <- c.perfDeaths
	ch <- c.percentPlayed
	ch <- c.heroSR
	ch <- c.heroSRChange
	ch <- c.heroStat
}

func (c *Collector) Collect(ch chan<- prometheus.Metric) {
	rows, err := c.read()
	if err != nil {
		applog.Subsystem("metrics").Error("read failed", "err", err)
		return
	}
	for _, row := range rows {
		// Only emit competitive matches. Quickplay (and any other non-
		// competitive mode) stays in SQLite so the Wails UI can show
		// it, but the Prometheus side keeps to ranked data — mixing
		// modes would skew win-rate / KDA / SR series in Grafana.
		if row.Data.Playlist != "competitive" {
			continue
		}
		ts, ok := parseMatchTimestamp(row.Data.Date, row.Data.FinishedAt, row.MatchKey)
		if !ok {
			// Skip rows we can't place in time — emitting at time.Now() would
			// pollute the time-series with current-time samples and mask the
			// fact that the metadata is missing.
			continue
		}
		c.emitMatch(ch, row, ts)
	}
}

// emitMatch emits all metric samples for one match.
//
// Each metric carries the full matchLabels label set. For core match metrics
// (eliminations, etc.) the hero/role is the match's *primary* hero (the
// most-played one, per row.Data.Hero). For per-hero metrics (percent_played,
// SR, hero_stat) the hero/role is the specific hero from the list — so a
// single match with 3 heroes contributes 3 percent_played samples.
func (c *Collector) emitMatch(ch chan<- prometheus.Metric, row ScrapeRow, ts time.Time) {
	emit := func(d *prometheus.Desc, v float64, labels []string) {
		m, err := prometheus.NewConstMetric(d, prometheus.GaugeValue, v, labels...)
		if err != nil {
			applog.Subsystem("metrics").Error("build metric", "metric", d.String(), "err", err)
			return
		}
		ch <- prometheus.NewMetricWithTimestamp(ts, m)
	}
	// Helper that builds matchLabels with a given (hero, role) override. The
	// trailing four are match-level (constant across the match's heroes).
	// Order MUST match the matchLabels slice.
	labelsFor := func(hero, role string) []string {
		return []string{
			row.MatchKey,
			row.Data.Map,
			row.Data.GameMode,
			row.Data.Playlist,
			row.Data.Result,
			hero,
			role,
			row.QueueType,
			row.Data.Rank,
			row.Leaver,
			row.ReviewedBy,
		}
	}

	// Core match-level metrics tagged with the primary hero.
	primary := labelsFor(row.Data.Hero, row.Data.Role)
	emit(c.eliminations, float64(row.Data.Eliminations), primary)
	emit(c.assists, float64(row.Data.Assists), primary)
	emit(c.deaths, float64(row.Data.Deaths), primary)
	emit(c.damage, float64(row.Data.Damage), primary)
	emit(c.healing, float64(row.Data.Healing), primary)
	emit(c.mitigation, float64(row.Data.Mitigation), primary)

	if row.Data.Result != "" {
		emit(c.matchResult, 1, primary)
		emit(c.win, winValue(row.Data.Result), primary)
	}
	if row.Data.Level != 0 {
		emit(c.rankLevel, float64(row.Data.Level), primary)
	}
	// rank_progress only means something when a RANK screenshot set the tier.
	if row.Data.Rank != "" {
		emit(c.rankProgress, float64(row.Data.RankProgress), primary)
	}
	if secs, ok := parseClockSeconds(row.Data.GameLength); ok {
		emit(c.gameLength, secs, primary)
	}
	// Length-normalized per-10 averages from the SUMMARY performance card.
	if p := row.Data.Performance; p != nil {
		emit(c.perfElims, p.Eliminations.AvgPer10Min, primary)
		emit(c.perfAssists, p.Assists.AvgPer10Min, primary)
		emit(c.perfDeaths, p.Deaths.AvgPer10Min, primary)
	}

	// Per-hero SR.
	for _, sr := range row.Data.SR {
		l := labelsFor(sr.Hero, roleOf(sr.Hero))
		emit(c.heroSR, float64(sr.SR), l)
		emit(c.heroSRChange, float64(sr.Change), l)
	}

	// Per-hero playtime + per-hero per-stat samples.
	for _, hp := range row.Data.HeroesPlayed {
		l := labelsFor(hp.Hero, roleOf(hp.Hero))
		if hp.PercentPlayed != 0 {
			emit(c.percentPlayed, float64(hp.PercentPlayed), l)
		}
		for stat, v := range hp.Stats {
			emit(c.heroStat, float64(v), append(append([]string{}, l...), stat))
		}
	}
}

// parseMatchTimestamp resolves a match's wall-clock time, in order of
// preference:
//  1. date + finished_at from the SUMMARY screen (the most accurate signal,
//     since it's what the game itself reported).
//  2. The match_key, when it carries an ISO-ish "match-YYYY-MM-DDTHH:MM:SS"
//     prefix derived from the earliest screenshot's filename timestamp.
//     This covers rows that only had an in-game teams parsed (no SUMMARY,
//     so date/finished_at are empty) — without this fallback those matches
//     would silently disappear from Prometheus.
//
// Returns ok=false only when neither source produces a parseable time.
func parseMatchTimestamp(date, finishedAt, matchKey string) (time.Time, bool) {
	if date != "" && finishedAt != "" {
		if t, err := time.ParseInLocation("2006-01-02 15:04", date+" "+finishedAt, time.Local); err == nil {
			return t, true
		}
	}
	if s, ok := strings.CutPrefix(matchKey, "match-"); ok {
		// match keys mint timestamps as `YYYY-MM-DDTHH-MM-SS` (the
		// time separator is `-` not `:` so the whole match_key stays
		// URL-safe without encoding). Pre-1.0 break: any older
		// `match:` keys are migrated to `match-` + dash-time on
		// store init, so we only ever see the dash form here.
		if t, err := time.ParseInLocation("2006-01-02T15-04-05", s, time.Local); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// roleOf resolves a hero name to its role label. Empty for unknown heroes —
// Prometheus accepts empty label values.
func roleOf(hero string) string {
	return parser.HeroRole(hero)
}

// winValue maps an outcome to a number so avg(recall_match_win) is win rate:
// victory=1, draw=0.5, anything else (defeat) =0. Only called when Result != "".
func winValue(result string) float64 {
	switch result {
	case "victory":
		return 1
	case "draw":
		return 0.5
	default:
		return 0
	}
}

// parseClockSeconds parses an OW clock string ("MM:SS" or "H:MM:SS") into
// seconds. ok=false for empty or malformed input so the caller skips the
// metric rather than emitting a misleading 0.
func parseClockSeconds(s string) (float64, bool) {
	if s == "" {
		return 0, false
	}
	parts := strings.Split(s, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return 0, false
	}
	total := 0
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return 0, false
		}
		total = total*60 + n
	}
	return float64(total), true
}

// Server is the runtime container for the Prometheus metrics endpoint.
// Use NewServer to construct one, Start to begin listening in a goroutine,
// and Stop to gracefully shut it down. http.Server can't be reused after
// Shutdown, so each enable→disable→enable cycle should build a fresh
// Server via NewServer (App.startMetrics does this).
type Server struct {
	srv  *http.Server
	addr string
}

// NewServer wires up a Prometheus registry around the custom collector and
// constructs the HTTP server, but does not yet bind a listener. Call Start
// to begin serving. RECALL_METRICS_ADDR overrides the supplied addr.
func NewServer(addr string, read Reader) *Server {
	if envAddr := os.Getenv("RECALL_METRICS_ADDR"); envAddr != "" {
		addr = envAddr
	}
	return &Server{
		addr: addr,
		srv: &http.Server{
			Addr:    addr,
			Handler: newMux(read),
			// Slowloris mitigation (gosec G112) — same rationale as
			// the main server in pkg/cmd/server.go. /metrics is a
			// short, scrape-only endpoint; 10s for headers is ample.
			ReadHeaderTimeout: 10 * time.Second,
		},
	}
}

// newMux builds the /metrics + index handler against a fresh Prometheus
// registry. Split out of NewServer so tests can drive the handler against
// httptest.NewRecorder without binding a real listener.
func newMux(read Reader) *http.ServeMux {
	reg := prometheus.NewRegistry()
	reg.MustRegister(New(read))

	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{}))
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("Recall exporter — see /metrics\n"))
	})
	return mux
}

// Start begins listening on the configured address in a background
// goroutine. Bind failures are logged but not returned to the caller —
// the desktop app should keep working even when the port is taken.
func (s *Server) Start() {
	// /metrics has no auth (standard for Prometheus) and exposes every
	// competitive match's stats. The default bind (":9091" = all
	// interfaces) is required by the bundled docker-compose Grafana
	// stack — the Prometheus container reaches the host over the
	// docker-bridge gateway, not loopback, so loopback-only would break
	// `make stack-up`. We keep the all-interfaces default but warn the
	// operator about the LAN exposure. Same-host (non-Docker) scrapers
	// can set RECALL_METRICS_ADDR=127.0.0.1:9091 to bind loopback-only.
	if !isLoopbackBind(s.addr) {
		applog.Subsystem("metrics").Warn(
			"endpoint reachable from any host on the network and serves match data without auth; "+
				"set RECALL_METRICS_ADDR=127.0.0.1:9091 to restrict to localhost if not using the bundled Grafana stack",
			"addr", s.addr,
		)
	}
	go func() {
		applog.Subsystem("metrics").Info("listening", "addr", s.addr)
		if err := s.srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			applog.Subsystem("metrics").Error("server stopped", "err", err)
		}
	}()
}

// isLoopbackBind reports whether addr listens on a loopback-only
// interface (so /metrics is unreachable from other hosts). A bind
// with an empty or unspecified host (":9091", "0.0.0.0:9091",
// "[::]:9091") listens on every interface and returns false.
func isLoopbackBind(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		// Unparseable — be conservative and treat as exposed so the
		// operator still gets the warning.
		return false
	}
	switch host {
	case "":
		return false // ":9091" → all interfaces
	case "localhost":
		return true
	default:
		ip := net.ParseIP(host)
		return ip != nil && ip.IsLoopback()
	}
}

// Stop gracefully shuts the server down with a 2-second timeout, then
// closes any straggling connections. Safe to call multiple times.
func (s *Server) Stop() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.srv.Shutdown(ctx); err != nil {
		applog.Subsystem("metrics").Error("shutdown error", "err", err)
		return
	}
	applog.Subsystem("metrics").Info("stopped listening", "addr", s.addr)
}
