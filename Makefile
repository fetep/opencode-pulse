.PHONY: install build typecheck test update pack integration integration-docker

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

integration:
	INTEGRATION=1 bun test test/

integration-docker:
	docker build -f Dockerfile.integration -t pulse-integration . && docker run --rm --init pulse-integration
