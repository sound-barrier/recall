package cmd

import (
	"errors"
	"io"
	"net/http"

	"recall/pkg/app"
	"recall/pkg/db"
)

// handlePutMomentImage takes custody of one picture and answers with its
// content address.
//
// The body is the raw image. That matches the three other binary endpoints
// here — a bundle, a database, a notes archive all arrive as themselves — and
// it is why there is no multipart parser anywhere in this repo.
//
// The Content-Type IS the declaration of what the bytes are. There is no
// sniffing: the store only accepts the two types the serving handler will hand
// back, so a lie here is refused rather than stored and rejected later.
func handlePutMomentImage(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(io.LimitReader(r.Body, momentImageMaxBodyBytes+1))
		if err != nil {
			writeProblem(w, r, probInvalidBody, "read body: "+err.Error())
			return
		}
		if int64(len(raw)) > momentImageMaxBodyBytes {
			writeProblem(w, r, probPayloadTooLarge, "image larger than 8 MiB")
			return
		}
		sha, err := a.PutMomentImage(raw, r.Header.Get("Content-Type"))
		if errors.Is(err, app.ErrImageTooLarge) {
			writeProblem(w, r, probPayloadTooLarge, "image larger than 8 MiB")
			return
		}
		if writeError(w, r, err, errStatus{db.ErrUnsupportedImageType, probInvalidBody}) {
			return
		}
		writeJSON(w, r, momentImageStored{SHA256: sha, ByteSize: len(raw)}, nil)
	}
}

// momentImageStored is the receipt: the digest to put in a moment's
// image_sha256, and what it cost.
type momentImageStored struct {
	SHA256   string `json:"sha256"`
	ByteSize int    `json:"byte_size"`
}
