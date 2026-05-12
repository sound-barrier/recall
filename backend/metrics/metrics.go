// Package metrics exposes OWMetrics match data as Prometheus metrics.
//
// The collector emits one labeled sample per match per metric on every scrape,
// each sample timestamped with the match's actual end time (date + finished_at).
// This means Prometheus plots match stats at the moment the match was played,
// not at scrape time — but it requires the Prometheus instance to have
// out-of-order ingestion enabled (the bundled docker-compose handles that).
package metrics

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"OWMetrics/backend/parser"
)

// ScrapeRow is the minimal shape the collector needs from each DB row. App
// code converts MatchRecord → ScrapeRow when wiring up the reader so this
// package doesn't have to import main's types.
type ScrapeRow struct {
	MatchKey string
	Data     parser.MatchResult
}

// Reader is the callback the collector uses to fetch current state on every
// scrape. Returning err short-circuits the scrape (Prometheus marks it down).
type Reader func() ([]ScrapeRow, error)

// matchLabels is the shared label set on every match-level metric. Putting
// `hero`/`role` on core metrics (not just per-hero ones) lets dashboards
// correlate the played hero with match outcome, damage, healing, etc.
// hero_stat metrics extend this with an additional `stat` label.
var matchLabels = []string{"match_key", "map", "type", "mode", "result", "hero", "role"}

// Collector implements prometheus.Collector. Each Collect() call reads all
// matches via the Reader and emits one sample per (metric, labels, timestamp)
// triple — Prometheus dedupes identical triples across scrapes.
type Collector struct {
	read Reader

	eliminations *prometheus.Desc
	assists      *prometheus.Desc
	deaths       *prometheus.Desc
	damage       *prometheus.Desc
	healing      *prometheus.Desc
	mitigation   *prometheus.Desc

	matchResult *prometheus.Desc // 1, label "result" carries victory/defeat/draw
	rankLevel   *prometheus.Desc // 1-5

	percentPlayed *prometheus.Desc // hero playtime as % of match (per hero in heroes_played)
	heroSR        *prometheus.Desc
	heroSRChange  *prometheus.Desc
	heroStat      *prometheus.Desc // matchLabels + "stat"
}

func New(read Reader) *Collector {
	desc := func(name, help string, extra ...string) *prometheus.Desc {
		labels := append([]string{}, matchLabels...)
		labels = append(labels, extra...)
		return prometheus.NewDesc("owmetrics_"+name, help, labels, nil)
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
		rankLevel:     desc("match_rank_level", "Competitive rank sub-division (1-5)."),
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
	ch <- c.rankLevel
	ch <- c.percentPlayed
	ch <- c.heroSR
	ch <- c.heroSRChange
	ch <- c.heroStat
}

func (c *Collector) Collect(ch chan<- prometheus.Metric) {
	rows, err := c.read()
	if err != nil {
		log.Printf("metrics: read failed: %v", err)
		return
	}
	for _, row := range rows {
		// The competitive filter now lives at the SQLite boundary (see
		// app.go ParseScreenshots + db.Init's cleanup DELETE), so every
		// row we see here is already competitive.
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
			log.Printf("metrics: build %s: %v", d, err)
			return
		}
		ch <- prometheus.NewMetricWithTimestamp(ts, m)
	}
	// Helper that builds matchLabels with a given (hero, role) override.
	labelsFor := func(hero, role string) []string {
		return []string{
			row.MatchKey,
			row.Data.Map,
			row.Data.Type,
			row.Data.Mode,
			row.Data.Result,
			hero,
			role,
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
	}
	if row.Data.Level != 0 {
		emit(c.rankLevel, float64(row.Data.Level), primary)
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
//  2. The match_key, when it carries an ISO-ish "match:YYYY-MM-DDTHH:MM:SS"
//     prefix derived from the earliest screenshot's filename timestamp.
//     This covers rows that only had an in-game scoreboard parsed (no SUMMARY,
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
	if s, ok := strings.CutPrefix(matchKey, "match:"); ok {
		if t, err := time.ParseInLocation("2006-01-02T15:04:05", s, time.Local); err == nil {
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
// to begin serving. OWMETRICS_METRICS_ADDR overrides the supplied addr.
func NewServer(addr string, read Reader) *Server {
	if envAddr := os.Getenv("OWMETRICS_METRICS_ADDR"); envAddr != "" {
		addr = envAddr
	}
	reg := prometheus.NewRegistry()
	reg.MustRegister(New(read))

	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{}))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("OWMetrics exporter — see /metrics\n"))
	})
	return &Server{
		addr: addr,
		srv:  &http.Server{Addr: addr, Handler: mux},
	}
}

// Start begins listening on the configured address in a background
// goroutine. Bind failures are logged but not returned to the caller —
// the desktop app should keep working even when the port is taken.
func (s *Server) Start() {
	go func() {
		log.Printf("metrics: listening on %s", s.addr)
		if err := s.srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("metrics: server stopped: %v", err)
		}
	}()
}

// Stop gracefully shuts the server down with a 2-second timeout, then
// closes any straggling connections. Safe to call multiple times.
func (s *Server) Stop() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.srv.Shutdown(ctx); err != nil {
		log.Printf("metrics: shutdown error: %v", err)
		return
	}
	log.Printf("metrics: stopped listening on %s", s.addr)
}
