package db_test

import (
	"testing"

	"recall/pkg/db"
)

// The override upsert is a WHOLE-ROW REPLACE, deliberately: a scalar arriving
// nil is the per-field revert to OCR, which is what the ✎ markers in the
// detail panel undo. That makes the caller's override set load-bearing — it
// must be complete, because everything it omits is reverted.
//
// This is the trap that destroyed manual matches: `edited_fields` is empty
// for one (no OCR underneath, so nothing is marked as edited), the frontend
// rebuilt the set from it, and one stat edit therefore arrived as a row
// carrying that stat alone. The fix is in the caller
// (match-overrides.ts: manualOverrideSet); this pins the store rule the fix
// depends on, so nobody "fixes" the store instead and silently breaks revert.
func TestStoreContract_ANilScalarIsARevertNotAnOmission(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			str := func(v string) *string { return &v }
			num := func(v int) *int { return &v }

			mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{
				MatchKey: "k", Map: str("rialto"), Damage: num(4200),
			}))
			// A write that omits Damage reverts it — it does not keep it.
			mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{
				MatchKey: "k", Map: str("rialto"),
			}))

			all, err := s.LoadAllUserMatchData()
			mustNoErr(t, err)
			if all["k"].Damage != nil {
				t.Errorf("Damage = %v after an omitting write, want nil — omission IS the revert",
					all["k"].Damage)
			}
			if all["k"].Map == nil || *all["k"].Map != "rialto" {
				t.Errorf("Map = %v, want the value the write carried", all["k"].Map)
			}
		})
	}
}
