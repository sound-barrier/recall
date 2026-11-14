package snapshot

// Now is Write's clock, so a test can land two writes in one second.
var Now = &now
