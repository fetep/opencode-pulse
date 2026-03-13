.PHONY: install build typecheck update pack

install:
	bun install

build:
	bun run build

typecheck:
	bun run typecheck

update:
	bun update

pack:
	bun pm pack --dry-run
