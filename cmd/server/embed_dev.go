//go:build !embed_frontend

package main

import (
	"io/fs"
	"testing/fstest"
)

func frontendFS() fs.FS {
	return fstest.MapFS{}
}
