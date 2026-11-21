package match

import "recall/pkg/parser"

// FieldRegions is a match's field regions on the wire, wrapped so the
// response stays an object that can grow beside the list.
type FieldRegions struct {
	Regions []FieldRegion `json:"regions"`
}

// FieldRegion is where on one of the match's screenshots a field was read:
// the rectangle in the image's own pixels and the image's size, so a client
// can cut the crop out of the screenshot at whatever size it draws it.
//
// DirID is the folder id a /_screenshot URL for SourceFile carries, the same
// one Record.SourceDirIDs names (0 when that map omits the file).
type FieldRegion struct {
	SourceFile  string           `json:"source_file"`
	DirID       int64            `json:"dir_id"`
	Field       parser.FieldPath `json:"field"`
	X           int              `json:"x"`
	Y           int              `json:"y"`
	Width       int              `json:"width"`
	Height      int              `json:"height"`
	ImageWidth  int              `json:"image_width"`
	ImageHeight int              `json:"image_height"`
}
