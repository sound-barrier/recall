// Package updatesig signs and verifies Recall's self-update release assets
// with the pinned Ed25519 release key, and holds that key's encodings.
//
// The release job that holds the private key compiles this package, so it
// imports nothing outside the standard library: a module download in that job
// would be code the key trusts without review.
package updatesig

import (
	"crypto/ed25519"
	"crypto/x509"
	_ "embed"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
	"sync"
)

// releasePublicKeyPEM is the public half of the release signing key. Every
// installed copy of Recall trusts only signatures it verifies, so replacing it
// strands those installs; the fingerprint test in keys_test.go makes that a
// reviewed edit.
//
//go:embed public_key.pem
var releasePublicKeyPEM []byte

var pinnedPublicKey = sync.OnceValues(func() (ed25519.PublicKey, error) {
	return DecodePublicKeyPEM(releasePublicKeyPEM)
})

// PublicKey returns the pinned release public key, the only key whose
// signatures Recall accepts on an update.
func PublicKey() (ed25519.PublicKey, error) {
	return pinnedPublicKey()
}

// EncodePrivateKey returns the one-line form of priv that the release
// environment secret RECALL_UPDATE_SIGNING_KEY holds: standard base64 of its
// 32-byte RFC 8032 seed. It is one line because GitHub masks a secret in logs
// only where a log line holds it verbatim, which a multi-line value defeats.
func EncodePrivateKey(priv ed25519.PrivateKey) string {
	return base64.StdEncoding.EncodeToString(priv.Seed())
}

// EncodePublicKeyPEM returns pub as a PKIX "PUBLIC KEY" PEM block, the form
// committed to the repository, which OpenSSL reads as well as Recall does.
func EncodePublicKeyPEM(pub ed25519.PublicKey) ([]byte, error) {
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return nil, fmt.Errorf("marshal public key: %w", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}), nil
}

// DecodePrivateKey parses the one-line form EncodePrivateKey writes. A copy
// restored from escrow may carry a trailing newline or stray spaces, so
// surrounding whitespace is ignored. Errors never repeat the value, which may
// be a real key pasted in the wrong form.
func DecodePrivateKey(encoded string) (ed25519.PrivateKey, error) {
	seed, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return nil, errors.New("private key is not standard base64")
	}
	if len(seed) != ed25519.SeedSize {
		return nil, fmt.Errorf("private key decodes to %d bytes, want the %d-byte seed", len(seed), ed25519.SeedSize)
	}
	return ed25519.NewKeyFromSeed(seed), nil
}

// DecodePublicKeyPEM parses the PKIX "PUBLIC KEY" PEM block EncodePublicKeyPEM
// writes, refusing any key that is not Ed25519.
func DecodePublicKeyPEM(encoded []byte) (ed25519.PublicKey, error) {
	block, _ := pem.Decode(encoded)
	if block == nil || block.Type != "PUBLIC KEY" {
		return nil, errors.New("public key is not a PEM \"PUBLIC KEY\" block")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse public key: %w", err)
	}
	pub, ok := parsed.(ed25519.PublicKey)
	if !ok {
		return nil, fmt.Errorf("public key is %T, want an Ed25519 key", parsed)
	}
	return pub, nil
}
