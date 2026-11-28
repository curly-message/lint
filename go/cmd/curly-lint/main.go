// Command curly-lint is the linter for the Curly Message Format: the native
// curly-lint command, which this module carries built for each platform it
// names, and which this program keeps in the user's cache directory and
// runs with its own arguments, streams and exit status.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
)

// cacheVariable names a directory to keep the command in, in place of the
// user's cache directory.
const cacheVariable = "CURLY_LINT_CACHE_DIR"

func main() {
	os.Exit(launch(os.Args[1:], os.Stderr))
}

// launch runs the command and answers its exit status, or says on stderr
// why it could not and answers 2, the command's own status for a run that
// linted nothing.
func launch(args []string, stderr io.Writer) int {
	if len(native) == 0 {
		fmt.Fprintf(stderr, "curly-lint: this module holds no command for %s/%s, only for linux, darwin and windows on amd64 and arm64.\n", runtime.GOOS, runtime.GOARCH)

		return 2
	}

	root, err := cache()
	if err != nil {
		fmt.Fprintf(stderr, "curly-lint: there is no directory to keep the command in: %v. Set %s to one.\n", err, cacheVariable)

		return 2
	}

	path, err := place(root, native)
	if err != nil {
		fmt.Fprintf(stderr, "curly-lint: the command could not be kept in %s: %v. Set %s to a directory that can hold it.\n", root, err, cacheVariable)

		return 2
	}

	status, err := run(path, args)
	if err != nil {
		fmt.Fprintf(stderr, "curly-lint: the command could not be run from %s: %v. Set %s to a directory programs run from.\n", root, err, cacheVariable)

		return 2
	}

	return status
}

// cache is the directory the command is kept in.
func cache() (string, error) {
	if named := os.Getenv(cacheVariable); named != "" {
		return named, nil
	}

	user, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(user, "curly-lint"), nil
}

// place keeps the command under root, in a directory named for its SHA-256,
// and answers its path. The file is held to the command's bytes on every
// run, so one cut short, altered or left with a mode that runs nothing is
// written again. It is written beside its path and settled onto it, by a
// link on Linux and macOS and a move on Windows, neither of which replaces
// a name, so no run reads half of it and a command another run placed
// meanwhile, which a third may be starting, stays. Only what is not the
// command is renamed over, as is everything on Linux and macOS where the
// file system holds no links. Where that fails and the path holds the command all the same,
// another run has placed it meanwhile, as on Windows, which renames no file
// onto a program that is running.
func place(root string, command []byte) (string, error) {
	sum := sha256.Sum256(command)
	directory := filepath.Join(root, hex.EncodeToString(sum[:]))
	path := filepath.Join(directory, program)

	if holds(path, command) {
		return path, nil
	}

	err := write(directory, path, command)
	if err != nil && !holds(path, command) {
		return "", err
	}

	return path, nil
}

// holds says whether path is the command, as a file its user can run.
func holds(path string, command []byte) bool {
	file, err := os.Stat(path)
	if err != nil || file.Mode().Perm()&runnable != runnable {
		return false
	}

	held, err := os.ReadFile(path)

	return err == nil && bytes.Equal(held, command)
}

func write(directory, path string, command []byte) error {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}

	file, err := os.CreateTemp(directory, program+".*")
	if err != nil {
		return err
	}

	_, err = file.Write(command)
	if err == nil {
		err = file.Chmod(0o755)
	}
	if closed := file.Close(); err == nil {
		err = closed
	}
	if err == nil && settle(file.Name(), path) != nil && !holds(path, command) {
		err = os.Rename(file.Name(), path)
	}
	os.Remove(file.Name())

	return err
}
