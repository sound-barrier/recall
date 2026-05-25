package app

import "recall/pkg/metrics"

// startMetrics spins up a fresh metrics.Server. Idempotent: returns
// without re-binding if one is already running.
func (a *App) startMetrics() {
	if a.metricsServer != nil {
		return
	}
	s := metrics.NewServer(":9091", a.scrapeReader)
	s.Start()
	a.metricsServer = s
}

// stopMetrics gracefully shuts down the current metrics.Server, if any.
// Safe to call when no server is running.
func (a *App) stopMetrics() {
	if a.metricsServer == nil {
		return
	}
	a.metricsServer.Stop()
	a.metricsServer = nil
}

// GetPrometheusEnabled reports whether the Prometheus endpoint is
// currently bound. Read by the frontend on mount to seed the checkbox.
func (a *App) GetPrometheusEnabled() bool {
	return a.settings.PrometheusEnabled
}

// SetPrometheusEnabled toggles the metrics endpoint and persists the
// choice to settings.json so the preference survives app restarts.
// Returns nil on success; bind failures show up in the app logs rather
// than as an error here because they're non-fatal.
func (a *App) SetPrometheusEnabled(enabled bool) error {
	a.settings.PrometheusEnabled = enabled
	if err := saveSettings(a.settings); err != nil {
		return err
	}
	if enabled {
		a.startMetrics()
	} else {
		a.stopMetrics()
	}
	return nil
}
