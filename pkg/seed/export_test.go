package seed

// Test-only bridges for the external seed_test package. The preview-image
// color math and the keep-or-clear decision are reachable in production only
// by running a whole profile seed; these re-exports are compiled under test
// only, so they widen no shipped API.

var (
	HueFromName         = hueFromName
	HSVToRGB            = hsvToRGB
	WriteSolidColorPNG  = writeSolidColorPNG
	KeepOrClearExisting = keepOrClearExisting
)
