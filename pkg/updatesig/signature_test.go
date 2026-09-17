package updatesig_test

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"testing"

	"recall/pkg/updatesig"
)

const (
	signedAsset = "recall-0.33.5-windows-amd64.exe"
	newerAsset  = "recall-0.99.0-windows-amd64.exe"
)

var signedDigest = sha256.Sum256([]byte("recall 0.33.5 windows updater"))

func TestVerify_AcceptsSignatureFromSign(t *testing.T) {
	pub, priv := newKeyPair(t)

	sig := updatesig.Sign(priv, signedAsset, signedDigest)

	if len(sig) != updatesig.SignatureSize {
		t.Errorf("signature is %d bytes, want %d", len(sig), updatesig.SignatureSize)
	}
	if err := updatesig.Verify(pub, signedAsset, signedDigest, sig); err != nil {
		t.Errorf("Verify of a signature Sign made = %v, want nil", err)
	}
}

// The signed message is the wire contract the release pipeline and the
// OpenSSL recipe in the verification docs both reproduce byte for byte.
func TestSign_SignsTheDocumentedMessage(t *testing.T) {
	pub, priv := newKeyPair(t)

	sig := updatesig.Sign(priv, signedAsset, signedDigest)

	message := bytes.Join([][]byte{
		[]byte("recall-update-signature-v1\n"),
		[]byte(signedAsset + "\n"),
		signedDigest[:],
	}, nil)
	if !ed25519.Verify(pub, message, sig) {
		t.Error("the signature is not over \"recall-update-signature-v1\\n\" + asset name + \"\\n\" + raw SHA-256 digest")
	}
}

// Someone who can publish a release but has no key could otherwise ship an
// older, genuinely signed exe under a newer version's name.
func TestVerify_RejectsRenamedAsset(t *testing.T) {
	pub, priv := newKeyPair(t)
	sig := updatesig.Sign(priv, signedAsset, signedDigest)

	if err := updatesig.Verify(pub, newerAsset, signedDigest, sig); !errors.Is(err, updatesig.ErrBadSignature) {
		t.Errorf("Verify of %s's signature as %s = %v, want ErrBadSignature", signedAsset, newerAsset, err)
	}
}

func TestVerify_RejectsWhatTheKeyDidNotSign(t *testing.T) {
	pub, priv := newKeyPair(t)
	otherPub, _ := newKeyPair(t)
	sig := updatesig.Sign(priv, signedAsset, signedDigest)
	otherDigest := sha256.Sum256([]byte("recall 0.33.5 windows updater, tampered"))
	cases := map[string]struct {
		pub    ed25519.PublicKey
		digest [sha256.Size]byte
		sig    []byte
	}{
		"another key":                  {otherPub, signedDigest, sig},
		"another digest":               {pub, otherDigest, sig},
		"a truncated signature":        {pub, signedDigest, sig[:updatesig.SignatureSize-1]},
		"a signature with a byte more": {pub, signedDigest, append(bytes.Clone(sig), 0)},
		"no signature":                 {pub, signedDigest, nil},
		"a key of the wrong length":    {pub[:ed25519.PublicKeySize-1], signedDigest, sig},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if err := updatesig.Verify(tc.pub, signedAsset, tc.digest, tc.sig); !errors.Is(err, updatesig.ErrBadSignature) {
				t.Errorf("Verify = %v, want ErrBadSignature", err)
			}
		})
	}
}
