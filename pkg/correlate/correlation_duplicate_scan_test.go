package correlate_test

import (
	"fmt"
	"reflect"
	"testing"

	"recall/pkg/correlate"
	"recall/pkg/db"
)

// The end-of-parse sweep asks the same question of every match a run
// created. Answering each one by re-reading the whole snapshot made a first
// import quadratic — 18 s on 5 000 matches, spent after the progress bar
// already read 100 %, in a loop that reports nothing and cannot be
// canceled. DuplicateScan parses and indexes once; the benchmarks below
// are the evidence, and this test is the part that can fail.
//
// The sweep REUSES one scan across every key it judges, which is the whole
// point — so a scan that answered differently on its second question than
// on its first would be a wrong triage decision rather than a slow one.
// Compared against a fresh scan per key: same answer, every time, whatever
// the index has been asked before.
func TestDuplicateScan_AnswersTheSameWhetherOrNotItIsReused(t *testing.T) {
	snap := benchCorpusWithTeams(200)
	// A real duplicate to find, not just a corpus of misses: the same
	// identity and stat line as an existing match, hours later.
	snap.Summaries = append(snap.Summaries, snap.Summaries[7])
	snap.Summaries[len(snap.Summaries)-1].MatchKey = recapNewKey
	snap.Summaries[len(snap.Summaries)-1].Filename = "Overwatch 2 Screenshot 2026.05.10 - 21.14.03.02.png"

	scan := correlate.NewDuplicateScan(snap)
	found := 0
	for _, s := range snap.Summaries {
		want := correlate.NewDuplicateScan(snap).CandidatesFor(s.MatchKey)
		got := scan.CandidatesFor(s.MatchKey)
		if !reflect.DeepEqual(want, got) {
			t.Fatalf("%s: reused scan = %+v, fresh scan = %+v", s.MatchKey, got, want)
		}
		found += len(got)
	}
	if found == 0 {
		t.Fatal("the corpus produced no candidates — the comparison proved nothing")
	}
}

func benchCorpus(n int) db.Screenshots {
	snap := db.Screenshots{}
	for i := range n {
		h, m := 8+i/60%12, i%60
		fn := fmt.Sprintf("Overwatch 2 Screenshot 2026.05.%02d - %02d.%02d.00.11.png", 1+i/1440%28, h, m)
		key := fmt.Sprintf("match-2026-05-%02dT%02d-%02d-00", 1+i/1440%28, h, m)
		inst := fmt.Sprintf("2026-05-%02dT%02d:%02d:00Z", 1+i/1440%28, h, m)
		snap.Summaries = append(snap.Summaries, db.SummaryRow{
			Filename: fn, MatchKey: key, Map: "rialto", Result: "victory",
			FinalScore: fmt.Sprintf("%d-1", i%4), Hero: "ana",
			Date: "2026-05-01", FinishedAt: "20:00", PlayedAtUTC: &inst,
		})
	}
	return snap
}

func benchCorpusWithTeams(n int) db.Screenshots {
	snap := benchCorpus(n)
	for i, s := range snap.Summaries {
		snap.Teams = append(snap.Teams, db.TeamsRow{
			Filename: "t-" + s.Filename, MatchKey: s.MatchKey,
			Eliminations: 10 + i%17, Assists: 5 + i%13, Deaths: 3 + i%11,
			Damage: 8000 + i, Healing: 100 + i, Mitigation: i,
		})
	}
	return snap
}

func BenchmarkSweepWithTeams(b *testing.B) {
	snap := benchCorpusWithTeams(5000)
	b.Run("oneshot/n=5000", func(b *testing.B) {
		for b.Loop() {
			for _, s := range snap.Summaries {
				correlate.NewDuplicateScan(snap).CandidatesFor(s.MatchKey)
			}
		}
	})
	b.Run("indexed/n=5000", func(b *testing.B) {
		for b.Loop() {
			scan := correlate.NewDuplicateScan(snap)
			for _, s := range snap.Summaries {
				scan.CandidatesFor(s.MatchKey)
			}
		}
	})
}

func BenchmarkSweepSummaryOnly(b *testing.B) {
	for _, n := range []int{2000, 5000} {
		snap := benchCorpus(n)
		b.Run(fmt.Sprintf("oneshot/n=%d", n), func(b *testing.B) {
			for b.Loop() {
				for _, s := range snap.Summaries {
					correlate.NewDuplicateScan(snap).CandidatesFor(s.MatchKey)
				}
			}
		})
		b.Run(fmt.Sprintf("indexed/n=%d", n), func(b *testing.B) {
			for b.Loop() {
				scan := correlate.NewDuplicateScan(snap)
				for _, s := range snap.Summaries {
					scan.CandidatesFor(s.MatchKey)
				}
			}
		})
	}
}
