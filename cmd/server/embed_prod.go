//go:build embed_frontend

package main

import (
	"embed"
	"io/fs"
	"log"
)

//go:embed all:dist
var embeddedFS embed.FS

func frontendFS() fs.FS {
	sub, err := fs.Sub(embeddedFS, "dist")
	if err != nil {
		log.Fatalf("cannot access embedded frontend: %v", err)
	}
	return sub
}
