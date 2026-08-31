package db_test

import "testing"

// The reference-gap acknowledgement set — the hidden_matches pattern:
// presence IS the acknowledged state, both writes idempotent, and the
// whole set loads in one read for the aggregator's attach pass.
func TestStoreContract_ReferenceGapAckRoundTrip(t *testing.T) {
	const key = "match-2026-05-10T22-21-11"
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.AcknowledgeReferenceGap(key))
			mustNoErr(t, s.AcknowledgeReferenceGap(key)) // idempotent refresh

			acked, err := s.LoadAcknowledgedReferenceGaps()
			mustNoErr(t, err)
			if !acked[key] || len(acked) != 1 {
				t.Fatalf("LoadAcknowledgedReferenceGaps = %v, want exactly %s", acked, key)
			}

			mustNoErr(t, s.UnacknowledgeReferenceGap(key))
			mustNoErr(t, s.UnacknowledgeReferenceGap(key)) // idempotent no-op

			acked, err = s.LoadAcknowledgedReferenceGaps()
			mustNoErr(t, err)
			if len(acked) != 0 {
				t.Fatalf("acknowledgement survived removal: %v", acked)
			}
		})
	}
}
