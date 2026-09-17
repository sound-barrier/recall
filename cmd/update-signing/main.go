// Command update-signing manages the Ed25519 key that signs Recall's
// self-update releases, and signs and verifies release assets with it.
//
// Maintainer-only tool — never published in a release. keygen runs once, in
// the maintainer's own terminal: never in CI and never in an agent session.
//
// Usage:
//
//	update-signing keygen -out PATH
//	update-signing sign FILE...
//	update-signing verify FILE...
//
// keygen writes a new private key to PATH, a file it creates with mode 0600 in
// a directory that must already exist, outside the current directory and
// outside every git work tree, and prints the public key as PEM on stdout. A
// refused PATH generates nothing.
//
// sign writes FILE.sig beside each FILE, the raw 64-byte Ed25519 signature
// over the file's base name and SHA-256 digest that pkg/updatesig defines. The
// private key is read only from the environment variable
// RECALL_UPDATE_SIGNING_KEY, in the one-line form keygen writes; no flag takes
// it, so it never lands in shell history or a process listing, and no output
// repeats it. A key that is not the one pinned in pkg/updatesig/public_key.pem
// is refused, an existing FILE.sig is never replaced, and every FILE is
// attempted even after one fails.
//
// verify checks each FILE against FILE.sig with the pinned public key, the
// check an installed Recall makes before it updates, and prints "OK FILE" for
// each one that passes. Every FILE is checked even after one fails.
//
// Exit codes:
//
//	0  done
//	1  verify: a FILE has no signature, fails to verify, or cannot be read
//	2  usage error, refused path, missing or refused signing key, or I/O error
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"recall/pkg/updatesig"
)

const usage = `usage:
  update-signing keygen -out PATH
  update-signing sign FILE...
  update-signing verify FILE...`

const keygenUsage = "usage: update-signing keygen -out PATH"

// signingKeyVariable is the one place sign reads the private key from, the
// release environment secret of the same name.
const signingKeyVariable = "RECALL_UPDATE_SIGNING_KEY"

// keygenReminder is printed once the key file exists. It names no escrow
// location type on purpose: the source is public.
const keygenReminder = `update-signing: wrote the private key to %[1]s (mode 0600).
Before you close this terminal:
  1. Escrow the one line in that file, then confirm a restored copy matches.
  2. Set it as the release environment secret:
       gh secret set RECALL_UPDATE_SIGNING_KEY --env release --repo sound-barrier/recall < %[1]q
  3. Delete %[1]s once escrow and the secret are both confirmed.
The public key went to stdout; it belongs in pkg/updatesig/public_key.pem.
`

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		_, _ = fmt.Fprintln(stderr, usage)
		return 2
	}
	switch args[0] {
	case "keygen":
		return runKeygen(args[1:], stdout, stderr)
	case "sign":
		return runSign(args[1:], stdout, stderr)
	case "verify":
		return runVerify(args[1:], stdout, stderr)
	default:
		_, _ = fmt.Fprintln(stderr, usage)
		return 2
	}
}

func runKeygen(args []string, stdout, stderr io.Writer) int {
	if err := keygen(args, stdout, stderr); err != nil {
		_, _ = fmt.Fprintf(stderr, "update-signing: %v\n", err)
		return 2
	}
	return 0
}

func runSign(files []string, stdout, stderr io.Writer) int {
	if len(files) == 0 {
		_, _ = fmt.Fprintln(stderr, "usage: update-signing sign FILE...")
		return 2
	}
	priv, err := signingKey()
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "update-signing: %v\n", err)
		return 2
	}
	trusted, err := updatesig.PublicKey()
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "update-signing: read the pinned public key: %v\n", err)
		return 2
	}
	sign := func(file string) error { return updatesig.SignFile(file, priv, trusted) }
	if !eachFile(files, sign, "signed", stdout, stderr) {
		return 2
	}
	return 0
}

func runVerify(files []string, stdout, stderr io.Writer) int {
	if len(files) == 0 {
		_, _ = fmt.Fprintln(stderr, "usage: update-signing verify FILE...")
		return 2
	}
	trusted, err := updatesig.PublicKey()
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "update-signing: read the pinned public key: %v\n", err)
		return 2
	}
	verify := func(file string) error { return updatesig.VerifyFile(file, trusted) }
	if !eachFile(files, verify, "OK", stdout, stderr) {
		return 1
	}
	return 0
}

// signingKey decodes the private key from the environment. Its errors name
// the variable and never its value.
func signingKey() (ed25519.PrivateKey, error) {
	encoded := os.Getenv(signingKeyVariable)
	if encoded == "" {
		return nil, fmt.Errorf("%s is not set", signingKeyVariable)
	}
	priv, err := updatesig.DecodePrivateKey(encoded)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", signingKeyVariable, err)
	}
	return priv, nil
}

// eachFile runs do on every file, printing "<done> FILE" to stdout for each
// success and the error to stderr for each failure, and reports whether every
// file succeeded.
func eachFile(files []string, do func(file string) error, done string, stdout, stderr io.Writer) bool {
	allDone := true
	for _, file := range files {
		if err := do(file); err != nil {
			_, _ = fmt.Fprintf(stderr, "update-signing: %s: %v\n", file, err)
			allDone = false
			continue
		}
		_, _ = fmt.Fprintf(stdout, "%s %s\n", done, file)
	}
	return allDone
}

func keygen(args []string, stdout, stderr io.Writer) error {
	out, err := parseKeygenFlags(args, stderr)
	if err != nil {
		return err
	}
	workDir, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("read the working directory: %w", err)
	}
	path, err := updatesig.KeyOutputPath(out, workDir)
	if err != nil {
		return err
	}
	return writeNewKey(path, stdout, stderr)
}

func parseKeygenFlags(args []string, stderr io.Writer) (string, error) {
	flags := flag.NewFlagSet("keygen", flag.ContinueOnError)
	flags.SetOutput(stderr)
	out := flags.String("out", "", "new file for the private key, in an existing directory outside the current directory and every git work tree")
	if err := flags.Parse(args); err != nil {
		return "", err
	}
	if *out == "" || flags.NArg() != 0 {
		return "", errors.New(keygenUsage)
	}
	return *out, nil
}

func writeNewKey(path string, stdout, stderr io.Writer) error {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return fmt.Errorf("generate key: %w", err)
	}
	publicPEM, err := updatesig.EncodePublicKeyPEM(pub)
	if err != nil {
		return err
	}
	if err := updatesig.WritePrivateKeyFile(path, priv); err != nil {
		return err
	}
	if _, err := stdout.Write(publicPEM); err != nil {
		// A key whose public half never reached the maintainer cannot be
		// pinned; leaving it behind invites escrowing a key nothing trusts.
		// #nosec G703 -- path is the maintainer's own -out argument, checked by
		// KeyOutputPath, and names the file this process just created.
		_ = os.Remove(path)
		return fmt.Errorf("print the public key (key file removed): %w", err)
	}
	_, _ = fmt.Fprintf(stderr, keygenReminder, path)
	return nil
}
