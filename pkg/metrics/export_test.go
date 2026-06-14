package metrics

// Test-only bridges for the external metrics_test package: the timestamp/role
// helpers, the loopback-bind check, and the in-process mux builder have no
// public entry point (the public surface is Server.Start/Stop on a real port).
// Compiled only under test, so they widen no API.
var (
	ParseMatchTimestamp = parseMatchTimestamp
	RoleOf              = roleOf
	IsLoopbackBind      = isLoopbackBind
	NewMux              = newMux
)

// ServerAddr exposes the resolved bind address (after RECALL_METRICS_ADDR
// override) so black-box tests can assert NewServer's address resolution.
func ServerAddr(s *Server) string { return s.addr }
