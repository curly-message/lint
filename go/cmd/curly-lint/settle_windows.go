package main

import (
	"os"
	"syscall"
)

// settle moves the file written at temp to path, and fails where path
// exists: MoveFileW, unlike os.Rename, replaces nothing, and leaves no
// second name for the file that a run reading path would keep from being
// removed.
func settle(temp, path string) error {
	from, err := syscall.UTF16PtrFromString(temp)
	if err != nil {
		return err
	}

	to, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return err
	}

	if err := syscall.MoveFile(from, to); err != nil {
		return &os.LinkError{Op: "move", Old: temp, New: path, Err: err}
	}

	return nil
}
