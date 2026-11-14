package app

import (
	"errors"
	"fmt"
	"sync"

	"recall/pkg/applog"
	"recall/pkg/coach"
	"recall/pkg/db"
)

// Custody of the store. Every read and write reaches the database through a
// lease on storeHolder, and a store swap (restore, profile switch, profile
// rename) steps the holder through swapping: new leases are refused with
// ErrStoreSwapInProgress, leases already out finish on the store they took,
// and only then is that store closed. A caller therefore sees either the
// store it asked for or a typed refusal — never a nil store, and never one
// closed under it.

// storePhase is where the store holder stands. The zero value is closed, so
// an App built without a store (a test's &App{}) refuses every lease.
type storePhase int

const (
	// storeClosed holds no store: before Startup opens one, or after a swap
	// that could not open any.
	storeClosed storePhase = iota
	// storeOpen holds a store and grants leases on it.
	storeOpen
	// storeSwapping is between two stores. It grants no leases.
	storeSwapping
)

// ErrStoreUnavailable is returned by an operation that needs the store when
// none is open — Startup failed to open one, or a swap failed to reopen any.
var ErrStoreUnavailable = errors.New("no database is open")

// errStorePhase marks a holder transition attempted from the wrong phase. It
// is a programming error; no caller is meant to handle it.
var errStorePhase = errors.New("store holder: illegal transition")

// storeHolder is the store and the leases out on it, under mu. Only the
// methods below change it.
type storeHolder struct {
	mu      sync.Mutex
	drained *sync.Cond
	phase   storePhase
	store   db.Store
	leases  int
}

// isOpen reports whether a store is open — Startup's "was one injected?".
func (h *storeHolder) isOpen() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.phase == storeOpen
}

// lease hands out the open store for one operation; release ends the lease.
// It never blocks: a swap in progress is a refusal, not a wait, so a lease
// taken inside another lease cannot deadlock against a swap waiting on the
// outer one.
func (h *storeHolder) lease() (db.Store, func(), error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	switch h.phase {
	case storeSwapping:
		return nil, nil, ErrStoreSwapInProgress
	case storeClosed:
		return nil, nil, ErrStoreUnavailable
	case storeOpen:
	}
	h.leases++
	var once sync.Once
	return h.store, func() { once.Do(h.releaseLease) }, nil
}

func (h *storeHolder) releaseLease() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.leases--
	if h.leases == 0 && h.drained != nil {
		h.drained.Broadcast()
	}
}

// open installs the first store: closed → open.
func (h *storeHolder) open(s db.Store) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.phase != storeClosed {
		return fmt.Errorf("%w: open while %d", errStorePhase, h.phase)
	}
	h.phase, h.store = storeOpen, s
	return nil
}

// beginSwap refuses new leases, waits for those already out, and hands back
// the store they were on (nil from closed) for the caller to close:
// open|closed → swapping. The caller must not hold a lease itself.
func (h *storeHolder) beginSwap() (db.Store, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.phase == storeSwapping {
		return nil, fmt.Errorf("%w: a swap is already in progress", errStorePhase)
	}
	h.phase = storeSwapping
	if h.drained == nil {
		h.drained = sync.NewCond(&h.mu)
	}
	for h.leases > 0 {
		h.drained.Wait()
	}
	old := h.store
	h.store = nil
	return old, nil
}

// endSwap installs the store the swap opened: swapping → open.
func (h *storeHolder) endSwap(s db.Store) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.phase != storeSwapping {
		return fmt.Errorf("%w: end a swap while %d", errStorePhase, h.phase)
	}
	h.phase, h.store = storeOpen, s
	return nil
}

// abandonSwap records a swap that could open no store: swapping → closed.
func (h *storeHolder) abandonSwap() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.phase == storeSwapping {
		h.phase = storeClosed
	}
}

// useStore leases the store for one operation. Every caller defers release.
func (a *App) useStore() (db.Store, func(), error) {
	return a.stores.lease()
}

// closeStoreForSwapOnly moves the holder to swapping — waiting out every
// lease already taken — and closes the store those leases were on. The swap
// that called it ends in endSwap (reopenActiveStore, openProfile) or, when no
// store can be opened, in withStoreSwap's abandonSwap.
func (a *App) closeStoreForSwapOnly() {
	old, err := a.stores.beginSwap()
	if err != nil {
		applog.Subsystem("store").Error("begin store swap", "err", err)
		return
	}
	if old != nil {
		_ = old.Close()
	}
}

// withStoreSwap runs a store swap holding the run slot as a run of kind, and
// guarantees the holder leaves swapping on the way out: a swap that opened
// no store ends closed, refusing leases with ErrStoreUnavailable rather than
// with a "retry in a moment" that would never come true.
func (a *App) withStoreSwap(kind RunKind, work func() error) error {
	return a.withRunSlot(kind, func() error {
		defer a.stores.abandonSwap()
		return work()
	})
}

// The coaching write gate (design rule 1). While a session is open the
// coach's own database is frozen; the gate is how a write proves it is not
// running inside one. A gated write enters before it touches anything and
// leaves when it is done, and a session opening waits for every write
// already admitted — so a session can never open under a write, and a write
// can never start under a session. Entering never blocks: a session open or
// opening is a refusal, which is what lets a gated write call another gated
// write without deadlocking against an opener waiting on the outer one.

// coachSlotPhase is where the one coaching-session slot stands.
type coachSlotPhase int

const (
	// coachSlotEmpty holds no session; gated writes are admitted.
	coachSlotEmpty coachSlotPhase = iota
	// coachSlotOpening is an open waiting out the gated writes already
	// admitted. New ones are refused.
	coachSlotOpening
	// coachSlotOpen holds a session; its player is named once
	// session.PlayerRef() is set.
	coachSlotOpen
)

// coachSlot is the session slot and the gated writes in flight, under
// App.coachMu. Only the methods below step its phase.
type coachSlot struct {
	phase coachSlotPhase
	// session is non-nil exactly while phase is coachSlotOpen.
	session      *coach.Session
	gatedWrites  int
	writesLanded *sync.Cond
}

// beginOpen claims the slot for an open and waits out the gated writes
// already admitted: empty → opening. The caller holds mu (App.coachMu,
// write-locked); the wait releases it.
func (c *coachSlot) beginOpen(mu sync.Locker) error {
	if c.phase != coachSlotEmpty {
		return coach.ErrSessionActive
	}
	c.phase = coachSlotOpening
	if c.writesLanded == nil {
		c.writesLanded = sync.NewCond(mu)
	}
	for c.gatedWrites > 0 {
		c.writesLanded.Wait()
	}
	return nil
}

// finishOpen installs the session: opening → open.
func (c *coachSlot) finishOpen(s *coach.Session) {
	c.phase, c.session = coachSlotOpen, s
}

// abandonOpen gives the slot back: opening|open → empty. An open that fails
// after finishOpen (its view would not assemble) abandons through here too.
func (c *coachSlot) abandonOpen() {
	c.phase, c.session = coachSlotEmpty, nil
}

// end discards the open session and returns it, or nil when none was open:
// open → empty. An open still waiting on writes is not a session yet, and is
// left to finish.
func (c *coachSlot) end() *coach.Session {
	if c.phase != coachSlotOpen {
		return nil
	}
	s := c.session
	c.phase, c.session = coachSlotEmpty, nil
	return s
}

// enterWriteGate admits one write the coaching freeze guards, or refuses it
// with coach.ErrSessionActive. Every caller defers leave.
func (a *App) enterWriteGate() (leave func(), err error) {
	a.coachMu.Lock()
	defer a.coachMu.Unlock()
	if a.coachSlot.phase != coachSlotEmpty {
		return nil, coach.ErrSessionActive
	}
	a.coachSlot.gatedWrites++
	var once sync.Once
	return func() { once.Do(a.leaveWriteGate) }, nil
}

func (a *App) leaveWriteGate() {
	a.coachMu.Lock()
	defer a.coachMu.Unlock()
	a.coachSlot.gatedWrites--
	if a.coachSlot.gatedWrites == 0 && a.coachSlot.writesLanded != nil {
		a.coachSlot.writesLanded.Broadcast()
	}
}

// useStoreForWrite is useStore for a gated write: the store lease and the
// write gate, held together until release.
func (a *App) useStoreForWrite() (db.Store, func(), error) {
	leave, err := a.enterWriteGate()
	if err != nil {
		return nil, nil, err
	}
	store, release, err := a.useStore()
	if err != nil {
		leave()
		return nil, nil, err
	}
	return store, func() { release(); leave() }, nil
}

// coachSessionActive reports whether a coaching session is open now.
func (a *App) coachSessionActive() bool {
	a.coachMu.RLock()
	defer a.coachMu.RUnlock()
	return a.coachSlot.phase == coachSlotOpen
}
