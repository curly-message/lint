//go:build !windows

package main

import "os"

// settle links path to the file written at temp, and fails where path
// exists: a link replaces nothing, and write removes temp after it.
func settle(temp, path string) error {
	return os.Link(temp, path)
}
