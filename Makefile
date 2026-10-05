# SAMA-NMC developer commands (run from the repo root; on Windows use the commands in README.md directly)
PY ?= python
SEP := $(if $(filter Windows_NT,$(OS)),;,:)
export PYTHONPATH := backend$(SEP).
export PYTHONIOENCODING := utf-8

data:       ## seeded synthetic benchmark + held-out unseen-noise set
	$(PY) -m bench.generate --seed 7 --n-materials 3800 --split 40,40,20 --out data/synthetic/demo
	$(PY) -m bench.generate --seed 7 --n-materials 1200 --out data/synthetic/unseen --unseen

assets:     ## frozen engine artifacts + benchmark (refuses to write if a hard safety gate fails)
	$(PY) -m bench.export_assets --data data/synthetic/demo --unseen data/synthetic/unseen

golden:     ## parity fixtures for the browser engine
	$(PY) -m bench.export_golden

test:       ## Python reference tests
	$(PY) -m pytest -q

web-test:   ## browser engine parity, type check, build, end-to-end
	cd frontend && npx vitest run && npx tsc --noEmit && npm run build && npx playwright test

.PHONY: data assets golden test web-test
