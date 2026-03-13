.PHONY: install build typecheck update pack

install:
	bun install
	cd plugin && bun install
	cd tui-ts && bun install

build:
	bun run build

typecheck:
	bun run typecheck

update:
	bun update
	cd plugin && bun update
	cd tui-ts && bun update

pack:
	bun pm pack --dry-run
