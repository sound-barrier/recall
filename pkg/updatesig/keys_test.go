package updatesig_test

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
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

// releaseSigningFingerprintSHA256 is the SHA-256 of the pinned public key's
// PKIX DER encoding, the value `openssl pkey -pubin -in
// pkg/updatesig/public_key.pem -outform DER | shasum -a 256` prints. Replacing
// public_key.pem strands every installed copy of Recall that pins the old
// key, so it takes a matching edit here, where review sees it.
const releaseSigningFingerprintSHA256 = "f0a7689b393a24397d4a230e09e53101cdfe401ade3793ab658ebfa9efbf6761"

func TestPublicKey_IsThePinnedReleaseKey(t *testing.T) {
	pinned, err := updatesig.PublicKey()
	if err != nil {
		t.Fatalf("PublicKey: %v", err)
	}
	der, err := x509.MarshalPKIXPublicKey(pinned)
	if err != nil {
		t.Fatalf("marshal the pinned key: %v", err)
	}
	if got := fmt.Sprintf("%x", sha256.Sum256(der)); got != releaseSigningFingerprintSHA256 {
		t.Errorf("pinned key fingerprint = %s, want %s", got, releaseSigningFingerprintSHA256)
	}
}

func TestDecodePublicKeyPEM_ReadsWhatEncodePublicKeyPEMWrites(t *testing.T) {
	pub, _ := newKeyPair(t)
	encoded, err := updatesig.EncodePublicKeyPEM(pub)
	if err != nil {
		t.Fatalf("EncodePublicKeyPEM: %v", err)
	}

	decoded, err := updatesig.DecodePublicKeyPEM(encoded)
	if err != nil {
		t.Fatalf("DecodePublicKeyPEM: %v", err)
	}
	if !decoded.Equal(pub) {
		t.Error("DecodePublicKeyPEM returned a different key")
	}
}

func TestDecodePublicKeyPEM_RejectsAnythingButAnEd25519PublicKey(t *testing.T) {
	pub, _ := newKeyPair(t)
	ecdsaKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate throwaway ECDSA key: %v", err)
	}
	ecdsaDER, err := x509.MarshalPKIXPublicKey(&ecdsaKey.PublicKey)
	if err != nil {
		t.Fatalf("marshal ECDSA key: %v", err)
	}
	ed25519DER, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		t.Fatalf("marshal Ed25519 key: %v", err)
	}
	cases := map[string][]byte{
		"not PEM at all":             []byte("recall"),
		"a block of another type":    pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: ed25519DER}),
		"a block that is not PKIX":   pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: []byte("recall")}),
		"a PKIX key of another type": pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: ecdsaDER}),
	}
	for name, encoded := range cases {
		t.Run(name, func(t *testing.T) {
			if key, err := updatesig.DecodePublicKeyPEM(encoded); err == nil {
				t.Errorf("DecodePublicKeyPEM = %x, want an error", key)
			}
		})
	}
}

// The escrowed copy of the release key is whatever the maintainer pasted, and
// a paste can pick up a trailing newline or stray spaces on either side.
func TestDecodePrivateKey_ToleratesSurroundingWhitespace(t *testing.T) {
	_, priv := newKeyPair(t)
	line := updatesig.EncodePrivateKey(priv)
	cases := map[string]string{
		"as encoded":           line,
		"with a trailing LF":   line + "\n",
		"with a trailing CRLF": line + "\r\n",
		"padded with spaces":   "  " + line + "  ",
		"padded with a tab":    "\t" + line + "\t\n",
		"on a line of its own": "\n" + line + "\n\n",
	}
	for name, encoded := range cases {
		t.Run(name, func(t *testing.T) {
			decoded, err := updatesig.DecodePrivateKey(encoded)
			if err != nil {
				t.Fatalf("DecodePrivateKey: %v", err)
			}
			if !decoded.Equal(priv) {
				t.Error("DecodePrivateKey returned a different key")
			}
		})
	}
}

// A refused value may be a real key pasted in the wrong form, so the error
// must not repeat it.
func TestDecodePrivateKey_RejectsWhatIsNotASeedWithoutEchoingIt(t *testing.T) {
	_, priv := newKeyPair(t)
	cases := map[string]string{
		"empty":                         "",
		"only whitespace":               " \n",
		"not base64":                    "not a key, but long enough to be mistaken for one",
		"a seed one byte short":         base64.StdEncoding.EncodeToString(priv.Seed()[:ed25519.SeedSize-1]),
		"the whole 64-byte private key": base64.StdEncoding.EncodeToString(priv),
	}
	for name, encoded := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := updatesig.DecodePrivateKey(encoded)
			if err == nil {
				t.Fatal("DecodePrivateKey accepted it")
			}
			if trimmed := strings.TrimSpace(encoded); trimmed != "" && strings.Contains(err.Error(), trimmed) {
				t.Errorf("error %q repeats the value it refused", err)
			}
		})
	}
}
