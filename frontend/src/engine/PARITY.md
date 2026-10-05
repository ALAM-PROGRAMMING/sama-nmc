# Browser engine parity with the Python reference

The TypeScript engine in this folder is a port of `backend/sama` (evaluator + pipeline.standardise +
pipeline.mint_master_layer + runview.build_run_output). Python is the reference. Nothing here adds
browser-specific decision logic.

## What is proven identical

| Check | Result |
|---|---|
| `records.json` (1,112 records): normalized text, transforms, class, attributes with spans, residuals, sanity flags, tier | all equal |
| `pairs.json` (810 pairs): comparison rows, residual diff, rules (id, fired, detail), features, gate and baseline score, zone, step, reason | all equal |
| `textmodel.json`: buckets, vectors (order and weights), cosines, token_set_ratio | all equal (1e-9) |
| `sample_run.json` (47 records, with the sample answer key) and `subset_run.json` (250 records) | whole RunOutput equal, audit hashes byte-identical with the same timestamps |
| `scenarios.json` cases A..E2, F | all hold |
| `edge_cases.json` (28 records, 78 pairs; Greek, umlauts, NBSP, fullwidth, emoji, NEL, control characters) generated from Python | all equal |
| Opt-in `scale.test.ts`: first 3,000 rows of `data/synthetic/demo/records.csv` (64,224 candidate pairs) | 0 differences in the whole RunOutput, including all 21,487 audit hashes |

Candidate pair SETS are identical in both languages (no differences at any scale tested).

## How exactness is achieved

* `pyre.ts` translates Python `re` source to JS: `\b \w \d \s` become explicit Unicode classes
  (`\p{L}\p{N}_`, `\p{Nd}`, Python's `str.isspace()` set), `.` excludes only `\n`, identity escapes such as
  `\#` and `\ ` are unescaped for the `u` flag. Patterns are cached. Python `re.escape` is reproduced
  because the material gazetteer is ordered by the length of the Python pattern source.
* Python `sum()` of floats is a compensated (Neumaier) sum since CPython 3.12; `pySum` reproduces it for vector norms
  and cosines. Vectors are `Map`s in first-occurrence order.
* Blocking top-k accumulates dot products in ascending bucket order (the order scipy uses) and quantises with
  `Math.floor(s*1e9+0.5)`, ties broken by member order.
* `q6` is `Math.floor(x*1e6+0.5)/1e6`. `Math.round` is never used for stored scores.
* Strings: `sorted()` is code point order (`pyCmp`), `split()`/`strip()` use Python's whitespace set,
  `len` and slicing for n-grams, fuzzy ratio and the 40-character NMC truncation work on code points.

## Boundaries (not exactly portable, or deliberately different)

1. **Unicode database versions.** NFKC, `toUpperCase`, `toLowerCase` and `\p{L}/\p{N}` come from the JS engine's
   Unicode tables, Python's from `unicodedata`/`re`. They can differ for characters added in the newest
   Unicode releases. Not observed in any fixture.
2. **libm differences.** `Math.log`, `Math.exp`, `Math.sqrt` may differ from the C library in the last bit.
   Every score that is stored or compared is rounded (`q6`, 1e-9 quantisation), and no difference appeared in
   the 3,000-row run (bit-identical scores).
3. **Python older than 3.12** would sum floats naively; the fixtures were exported with 3.13.
4. **`parseCharacteristics`**: non-string JSON values are stringified with JS rules (`1.0` becomes `1`), Python's `str()`
   gives `1.0`. Characteristics are string values in every shipped file.
5. **CSV upload** is stricter than `evaluator.records_from_csv` (which has no validation): required columns, 3,000 row limit,
   duplicate ids, blank descriptions and unparseable numbers are reported. Rows with a blank cpse, matnr or maktx are
   skipped and counted under `BLANK_DESCRIPTION`. Parsing uses Papa Parse; delimiters `,` `;` tab are auto-detected.
6. **Master layer (`master.ts`) has no Python reference**; it implements PRD FR-GOV-04/09, FR-NMC-07, FR-CLU-04 directly.
   Choices that go beyond the PRD text, all fail-safe:
   * a pair whose records are in different material classes cannot create or join an NMC (blocked, nothing changed);
   * if a pair outside the stored decisions cannot be evaluated (engine files not registered), the attach is blocked rather than allowed;
   * a blocked (approved but not attached) item can be rejected, which lets its stuck record receive a singleton NMC;
     a blocked item counts as an open review item for FR-NMC-07.
   * Master operations need the config tables (class templates, hierarchies). Call `registerAssets(assets)` once
     (done automatically by `ensureAssets()` in `client.ts`) or pass `ctx.assets`.
7. `runEngine` default `now` is the real browser clock and the default run id is `RUN-0001`; both are overridable
   (`opts.now`, `opts.runId`).

## Python behaviours worth a second look (ported as they are)

* `units.yaml` has the synonym key `NO`, which YAML 1.1 reads as the boolean `false`. The key was exported as `"false"`
  and can never match an upper-cased unit, so a unit of `NO` is not mapped to `EA` in either implementation.
* Records pushed to review only because they are bridge or size-alarm members of a cluster (no REVIEW pair) have status
  `REVIEW` but no review item, so nothing in the review queue can ever give them an NMC. Does not occur in the sample,
  the 250-row subset or the 3,000-row demo run.
* `build_pair` takes `class_code` from the left record only; a REVIEW pair across two classes is possible in principle
  (comparison is empty, Tier R sends it to step 6). The browser master blocks identity changes for such pairs (see 6).
* Presentation only: `candidate_pairs` counts every blocked pair while `filtered` hides clearly different ones.
