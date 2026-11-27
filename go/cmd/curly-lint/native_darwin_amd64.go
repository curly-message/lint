//go:build !ios

package main

import _ "embed"

//go:embed bin/curly-lint-darwin-amd64
var native []byte
