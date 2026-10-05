"""Experiment: the specified second-stage classifier (FR-CLS-01: TF-IDF + logistic regression, abstain
if top-1 < 0.6 or top-1 - top-2 < 0.2) over the frozen hashed text vectors. How many head-pattern
abstentions on the UNSEEN set does it recover, and how often is it right?"""
import csv, json, sys
import numpy as np
from scipy.sparse import csr_matrix
from sklearn.linear_model import LogisticRegression

from common import ROOT, load_set
from sama.textmodel import TextModel

tm = TextModel.load(ROOT / "engine_assets" / "text_model.json")


def mat(texts):
    rows, cols, vals = [], [], []
    for r, t in enumerate(texts):
        for c, w in tm.vector(t).items():
            rows.append(r); cols.append(c); vals.append(w)
    return csr_matrix((vals, (rows, cols)), shape=(len(texts), tm.n_buckets))


def true_class(name):
    return {r["true_material_id"]: r["class_code"] for r in csv.DictReader(open(ROOT / "data/synthetic" / name / "truth.csv", encoding="utf-8"))}


demo, unseen = load_set("demo"), load_set("unseen")
tc_demo, tc_unseen = true_class("demo"), true_class("unseen")
train = [r for r, s in demo["split"].items() if s == "train"]
X, y = mat([demo["text"][r] for r in train]), [tc_demo[demo["truth"][r]] for r in train]
clf = LogisticRegression(C=20, max_iter=3000).fit(X, y)
print("classes:", list(clf.classes_))
for name, ds, tc, only in (("demo-test", demo, tc_demo, "test"), ("unseen", unseen, tc_unseen, None)):
    ids = [r for r in ds["text"] if only is None or ds["split"][r] == only]
    abst = [r for r in ids if ds["klass"][r] == "9999"]
    truth_cls = {r: tc[ds["truth"][r]] for r in ids}
    P = clf.predict_proba(mat([ds["text"][r] for r in abst])) if abst else np.zeros((0, len(clf.classes_)))
    top = np.argsort(-P, axis=1)[:, :2]
    ok_conf = right = 0
    for k, r in enumerate(abst):
        p1, p2 = P[k, top[k, 0]], P[k, top[k, 1]]
        if p1 >= 0.6 and p1 - p2 >= 0.2:
            ok_conf += 1
            right += clf.classes_[top[k, 0]] == truth_cls[r]
    print(f"{name}: records {len(ids)}, head-pattern abstentions {len(abst)} ({100*len(abst)/len(ids):.1f}%), "
          f"classifier confident on {ok_conf}, correct {right} ({100*right/max(ok_conf,1):.1f}% of confident)")
