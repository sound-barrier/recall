package updatesig_test

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"go/build"
	"strings"
	"testing"

	"recall/pkg/updatesig"
)

func newKeyPair(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate throwaway key: %v", err)
	}
	return pub, priv
}

// The committed public key is read by Recall itself, by `openssl pkeyutl` in
// the verification docs and by any PKIX parser, so the encoding must be plain
// PKIX PEM with nothing after the block.
func TestEncodePublicKeyPEM_RoundTripsThroughPKIX(t *testing.T) {
	pub, _ := newKeyPair(t)

	encoded, err := updatesig.EncodePublicKeyPEM(pub)
	if err != nil {
		t.Fatalf("EncodePublicKeyPEM: %v", err)
	}
	block, rest := pem.Decode(encoded)
	if block == nil {
		t.Fatalf("EncodePublicKeyPEM output is not PEM:\n%s", encoded)
	}
	if block.Type != "PUBLIC KEY" {
		t.Errorf("PEM block type = %q, want %q", block.Type, "PUBLIC KEY")
	}
	if len(bytes.TrimSpace(rest)) != 0 {
		t.Errorf("unexpected data after the PEM block: %q", rest)
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		t.Fatalf("ParsePKIXPublicKey: %v", err)
	}
	got, ok := parsed.(ed25519.PublicKey)
	if !ok {
		t.Fatalf("parsed key is %T, want ed25519.PublicKey", parsed)
	}
	if !got.Equal(pub) {
		t.Error("the PEM decodes to a different public key")
	}
}

// GitHub redacts a secret from logs only where the log holds it verbatim, so
// the secret value must be one line, never a multi-line block.
func TestEncodePrivateKey_IsOneLineOfTheSeed(t *testing.T) {
	_, priv := newKeyPair(t)

	line := updatesig.EncodePrivateKey(priv)
	if strings.ContainsAny(line, "\r\n") {
		t.Fatalf("encoded key spans more than one line: %q", line)
	}
	seed, err := base64.StdEncoding.DecodeString(line)
	if err != nil {
		t.Fatalf("encoded key is not standard base64: %v", err)
	}
	if !bytes.Equal(seed, priv.Seed()) {
		t.Error("encoded key does not decode to the private key's seed")
	}
}

func TestPackageImportsOnlyTheStandardLibrary(t *testing.T) {
	pkg, err := build.ImportDir(".", 0)
	if err != nil {
		t.Fatalf("read package: %v", err)
	}
	for _, path := range pkg.Imports {
		imported, err := build.Import(path, ".", build.FindOnly)
		if err != nil || !imported.Goroot {
			t.Errorf("pkg/updatesig imports %q, which is not in the standard library", path)
		}
	}
}
