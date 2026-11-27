//go:build !(linux || darwin)

package main

import (
	"errors"
	"os"
	"os/exec"
	"os/signal"
)

const program = "curly-lint.exe"

// runnable is empty where no mode keeps a file from being run.
const runnable os.FileMode = 0

// run starts the command on this process's own streams and waits for it,
// where a process cannot be replaced: its exit status is the answer. An
// interrupt from the console reaches the command too, and is left to it:
// this process ends when the command has, with its status.
func run(path string, args []string) (int, error) {
	command := exec.Command(path, args...)
	command.Stdin, command.Stdout, command.Stderr = os.Stdin, os.Stdout, os.Stderr

	signal.Notify(make(chan os.Signal, 1), os.Interrupt)

	err := command.Run()

	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return exit.ExitCode(), nil
	}

	return 0, err
}
