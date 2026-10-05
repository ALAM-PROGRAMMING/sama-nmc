"""Diagnostics: true matches the pipeline rejected, and true pairs blocking missed."""
import random, sys
from collections import Counter
from sama.pipeline import run
res = run(sys.argv[1] if len(sys.argv) > 1 else "data/synthetic/demo")
test = [k for k in res.pairs if res.pair_split(k) == "test"]
rej = [k for k in test if res.is_match(k) and res.zones["sama"][k] == "REJECT"]
print("REJECTED TRUE MATCHES", len(rej), Counter(res.pairs[k].zone_step for k in rej))
print(Counter(r.property for k in rej for r in res.pairs[k].comparison if r.critical and r.state == "conflict"))
for k in random.Random(1).sample(rej, min(12, len(rej))):
    p = res.pairs[k]; c = [(r.property, r.left, r.right) for r in p.comparison if r.state == "conflict"]
    print(" ", res.raws[k[0]].maktx, "|", res.raws[k[1]].maktx, "|", c, p.zone_step)
by = {}
for rid, m in res.truth.items():
    if res.split.get(rid) == "test": by.setdefault(m, []).append(rid)
miss = [(a, b) for ms in by.values() for i, a in enumerate(ms) for b in ms[i+1:] if tuple(sorted((a, b))) not in res.pairs]
print("MISSED BY BLOCKING", len(miss), Counter((res.recs[a].class_code == res.recs[b].class_code) for a, b in miss))
print(Counter((res.recs[a].class_code, res.recs[b].class_code) for a, b in miss if res.recs[a].class_code != res.recs[b].class_code).most_common(8))
for a, b in random.Random(2).sample(miss, min(12, len(miss))):
    print(" ", res.recs[a].class_code, res.raws[a].maktx, "|", res.recs[b].class_code, res.raws[b].maktx)
