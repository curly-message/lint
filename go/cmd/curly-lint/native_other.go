//go:build !((linux || darwin || windows) && (amd64 || arm64)) || android || ios

package main

// No command is built for this platform. Android and iOS are named apart:
// the go command reads a file named for linux or darwin on them too.
var native []byte
