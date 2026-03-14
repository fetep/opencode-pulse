.PHONY: install build typecheck test update pack

install:
	bun install

build:
	bun run build

typecheck:
	bun run typecheck

test:
	bun test

update:
	bun update

pack:
	bun pm pack --dry-run
