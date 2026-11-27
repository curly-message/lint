//go:build !android

package main

import _ "embed"

//go:embed bin/curly-lint-linux-arm64
var native []byte
