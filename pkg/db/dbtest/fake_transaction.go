package dbtest

import (
	"reflect"

	"recall/pkg/db"
)

// InTransaction mirrors SQLStore's: fn's writes all land, or — when fn
// returns an error or panics — none do. The Fake has no engine, so the
// rollback is a snapshot of every table taken before fn runs and put back
// after a failure.
func (f *Fake) InTransaction(fn func(db.Store) error) (err error) {
	f.mu.Lock()
	if f.inTx {
		f.mu.Unlock()
		return db.ErrNestedTransaction
	}
	f.inTx = true
	snap := f.snapshotLocked()
	f.mu.Unlock()
	committed := false
	defer func() {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.inTx = false
		if !committed {
			f.restoreLocked(snap)
		}
	}()
	if err := fn(f); err != nil {
		return err
	}
	committed = true
	return nil
}

// fakeSnapshot is every table's contents at one instant.
type fakeSnapshot struct {
	tables         map[int]reflect.Value
	shareExports   []db.ShareExport
	shareExportSeq int64
}

// snapshotLocked deep-copies every exported map and slice field — the
// tables. Callers hold f.mu.
func (f *Fake) snapshotLocked() fakeSnapshot {
	v := reflect.ValueOf(f).Elem()
	snap := fakeSnapshot{tables: map[int]reflect.Value{}, shareExportSeq: f.shareExportSeq}
	for i := range v.NumField() {
		field := v.Field(i)
		if isTable(v.Type().Field(i), field) {
			snap.tables[i] = deepCopy(field)
		}
	}
	snap.shareExports = deepCopy(reflect.ValueOf(f.shareExports)).Interface().([]db.ShareExport)
	return snap
}

func (f *Fake) restoreLocked(snap fakeSnapshot) {
	v := reflect.ValueOf(f).Elem()
	for i, table := range snap.tables {
		v.Field(i).Set(table)
	}
	f.shareExports, f.shareExportSeq = snap.shareExports, snap.shareExportSeq
}

func isTable(sf reflect.StructField, field reflect.Value) bool {
	kind := field.Kind()
	return sf.IsExported() && (kind == reflect.Map || kind == reflect.Slice)
}

// deepCopy copies maps, slices, pointers and structs all the way down, so a
// write after the snapshot cannot reach into it. Anything else is a value.
func deepCopy(v reflect.Value) reflect.Value {
	kind := v.Kind()
	if kind == reflect.Map || kind == reflect.Slice || kind == reflect.Pointer {
		if v.IsNil() {
			return reflect.Zero(v.Type())
		}
	}
	if copyKind, ok := map[reflect.Kind]func(reflect.Value) reflect.Value{
		reflect.Map:     copyMap,
		reflect.Slice:   copySlice,
		reflect.Pointer: copyPointer,
		reflect.Struct:  copyStruct,
	}[kind]; ok {
		return copyKind(v)
	}
	return v
}

func copyMap(v reflect.Value) reflect.Value {
	out := reflect.MakeMapWithSize(v.Type(), v.Len())
	for it := v.MapRange(); it.Next(); {
		out.SetMapIndex(deepCopy(it.Key()), deepCopy(it.Value()))
	}
	return out
}

func copySlice(v reflect.Value) reflect.Value {
	out := reflect.MakeSlice(v.Type(), v.Len(), v.Len())
	for i := range v.Len() {
		out.Index(i).Set(deepCopy(v.Index(i)))
	}
	return out
}

func copyPointer(v reflect.Value) reflect.Value {
	out := reflect.New(v.Type().Elem())
	out.Elem().Set(deepCopy(v.Elem()))
	return out
}

func copyStruct(v reflect.Value) reflect.Value {
	out := reflect.New(v.Type()).Elem()
	out.Set(v)
	for i := range v.NumField() {
		if out.Field(i).CanSet() {
			out.Field(i).Set(deepCopy(v.Field(i)))
		}
	}
	return out
}
