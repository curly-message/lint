//go:build !android

package main

import _ "embed"

//go:embed bin/curly-lint-linux-amd64
var native []byte
