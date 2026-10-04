// This UI asset subtree is outside the gateway Go module. Dependency examples
// in node_modules must not be discovered by the gateway's go test ./... command.
module company-gateway/web-assets

go 1.26.0
