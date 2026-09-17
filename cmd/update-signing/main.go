// Command update-signing manages the Ed25519 key that signs Recall's
// self-update releases.
//
// Maintainer-only tool — never published in a release. keygen runs once, in
// the maintainer's own terminal: never in CI and never in an agent session.
//
// Usage:
//
//	update-signing keygen -out PATH
//
// keygen writes a new private key to PATH, a file it creates with mode 0600 in
// a directory that must already exist, outside the current directory and
// outside every git work tree, and prints the public key as PEM on stdout. A
// refused PATH generates nothing.
//
// Exit codes:
//
//	0  done
//	2  usage error, refused path, or I/O error
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

const usage = "usage: update-signing keygen -out PATH"

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
	if len(args) == 0 || args[0] != "keygen" {
		_, _ = fmt.Fprintln(stderr, usage)
		return 2
	}
	if err := keygen(args[1:], stdout, stderr); err != nil {
		_, _ = fmt.Fprintf(stderr, "update-signing: %v\n", err)
		return 2
	}
	return 0
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
		return "", errors.New(usage)
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
