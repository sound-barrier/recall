// Package updatesig holds the encodings of the Ed25519 key that signs Recall's
// self-update releases.
//
// The release job that holds the private key compiles this package, so it
// imports nothing outside the standard library: a module download in that job
// would be code the key trusts without review.
package updatesig

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
)

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
