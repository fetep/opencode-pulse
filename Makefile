.PHONY: update build typecheck

update:
	cd plugin && bun update
	cd tui-ts && bun update

build:
	cd plugin && bun run build

typecheck:
	cd plugin && bunx tsc --noEmit
	cd tui-ts && bunx tsc --noEmit
