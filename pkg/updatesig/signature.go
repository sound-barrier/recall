package updatesig

import (
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
)

// SignatureSuffix names an asset's signature file: the asset's own name with
// this appended, published beside it.
const SignatureSuffix = ".sig"

// SignatureSize is the length of a signature file, which holds the raw
// Ed25519 signature and nothing else.
const SignatureSize = ed25519.SignatureSize

var (
	// ErrMissingSignature marks an asset published without a signature file.
	ErrMissingSignature = errors.New("update has no signature from the Recall release key")
	// ErrBadSignature marks a signature that is malformed or was not made by
	// the trusted key over this asset's name and digest.
	ErrBadSignature = errors.New("update signature does not verify against the Recall release key")
	// ErrKeyMismatch marks a signing key whose public half is not the pinned
	// one, whose signatures no installed copy of Recall would accept.
	ErrKeyMismatch = errors.New("signing key is not the key pinned in pkg/updatesig/public_key.pem")
)

// signatureDomain versions the message format and keeps a signature made for
// release assets from standing for anything else the key might sign.
const signatureDomain = "recall-update-signature-v1\n"

// message is what a signature covers. Binding the asset's name refuses an
// older signed exe republished under a newer version's name. The name cannot
// run into the digest because the digest is always the final sha256.Size
// bytes.
func message(assetName string, digest [sha256.Size]byte) []byte {
	msg := make([]byte, 0, len(signatureDomain)+len(assetName)+1+sha256.Size)
	msg = append(msg, signatureDomain...)
	msg = append(msg, assetName...)
	msg = append(msg, '\n')
	return append(msg, digest[:]...)
}

// Sign returns the signature file contents for the asset named assetName,
// the base name it is published under, whose SHA-256 is digest.
func Sign(priv ed25519.PrivateKey, assetName string, digest [sha256.Size]byte) []byte {
	return ed25519.Sign(priv, message(assetName, digest))
}

// Verify reports whether sig is pub's signature over the asset named
// assetName with SHA-256 digest, returning ErrBadSignature when it is not.
func Verify(pub ed25519.PublicKey, assetName string, digest [sha256.Size]byte, sig []byte) error {
	// ed25519.Verify panics on a key of the wrong length.
	if len(pub) != ed25519.PublicKeySize || len(sig) != SignatureSize {
		return ErrBadSignature
	}
	if !ed25519.Verify(pub, message(assetName, digest), sig) {
		return ErrBadSignature
	}
	return nil
}
