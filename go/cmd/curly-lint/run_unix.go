//go:build linux || darwin

package main

import (
	"os"
	"syscall"
)

const program = "curly-lint"

// runnable is what the mode of a file has to hold for its user to run it.
const runnable os.FileMode = 0o100

// run replaces this process with the command, so its streams, its signals
// and its exit status are the command's own. It returns only where the
// command could not be started.
func run(path string, args []string) (int, error) {
	return 0, syscall.Exec(path, append([]string{path}, args...), os.Environ())
}
