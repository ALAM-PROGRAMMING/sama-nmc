"""Export the fine-tuned embedder to a browser-sized int8 ONNX model and check it did not get worse.

Outputs (default models/embedder-onnx/):
  model.onnx            fp32 reference export (last_hidden_state; pooling + normalisation happen outside)
  model_quantized.onnx  dynamic int8 weights: the file a browser would download
  tokenizer.json, tokenizer_config.json, config.json   (what transformers.js / any WordPiece loader needs)

Then re-measures candidate recall using the INT8 model (what visitors would actually run) next to fp32.

    python bench/gpu/export_onnx.py --model models/embedder-final --out models/embedder-onnx
"""
from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoModel, AutoTokenizer

from common import ROOT, current_blocking_pairs, load_set, true_pairs

MAX_LEN = 64


def export(model_dir: Path, out: Path) -> tuple[Path, Path]:
    out.mkdir(parents=True, exist_ok=True)
    tok = AutoTokenizer.from_pretrained(model_dir)
    inner = AutoModel.from_pretrained(model_dir).eval()

    class Wrapper(torch.nn.Module):          # tracing wants plain positional inputs; keywords go to the model
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, input_ids, attention_mask):
            return self.m(input_ids=input_ids, attention_mask=attention_mask, return_dict=False)[0]

    model = Wrapper(inner).eval()
    dummy = tok(["flange weld neck 2 cl150"], return_tensors="pt", padding=True, truncation=True, max_length=MAX_LEN)
    fp32 = out / "model.onnx"
    torch.onnx.export(
        model, (dummy["input_ids"], dummy["attention_mask"]), str(fp32), input_names=["input_ids", "attention_mask"],
        output_names=["last_hidden_state"], dynamic_axes={"input_ids": {0: "b", 1: "s"}, "attention_mask": {0: "b", 1: "s"},
                                                          "last_hidden_state": {0: "b", 1: "s"}},
        opset_version=17, dynamo=False)
    q = out / "model_quantized.onnx"
    quantize_dynamic(str(fp32), str(q), weight_type=QuantType.QInt8)
    for f in ("tokenizer.json", "tokenizer_config.json", "config.json"):
        if (model_dir / f).exists():
            shutil.copyfile(model_dir / f, out / f)
    return fp32, q


class OnnxEmbedder:
    def __init__(self, path: Path, tok):
        so = ort.SessionOptions()
        so.intra_op_num_threads = 1                       # closest to one browser worker
        self.s = ort.InferenceSession(str(path), so, providers=["CPUExecutionProvider"])
        self.tok = tok

    def encode(self, texts: list[str], batch: int = 64) -> np.ndarray:
        out = []
        for i in range(0, len(texts), batch):
            enc = self.tok(texts[i:i + batch], return_tensors="np", padding=True, truncation=True, max_length=MAX_LEN)
            h = self.s.run(None, {"input_ids": enc["input_ids"].astype(np.int64), "attention_mask": enc["attention_mask"].astype(np.int64)})[0]
            m = enc["attention_mask"][..., None].astype(np.float32)
            v = (h * m).sum(1) / np.clip(m.sum(1), 1e-9, None)               # mean pooling
            out.append(v / np.clip(np.linalg.norm(v, axis=1, keepdims=True), 1e-12, None))
        return np.vstack(out)


def knn_pairs(emb: np.ndarray, ids: list[str], k: int) -> set[tuple[str, str]]:
    t = torch.from_numpy(emb)
    out: set[tuple[str, str]] = set()
    for s in range(0, len(ids), 2048):
        sims = t[s:s + 2048] @ t.T
        for r in range(sims.shape[0]):
            sims[r, s + r] = -2.0
        top = torch.topk(sims, min(k, len(ids) - 1), dim=1).indices.numpy()
        for r, row in enumerate(top):
            for j in row:
                a, b = ids[s + r], ids[int(j)]
                out.add((a, b) if a < b else (b, a))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="models/embedder-final")
    ap.add_argument("--out", default="models/embedder-onnx")
    ap.add_argument("--k", type=int, default=20)
    a = ap.parse_args()
    model_dir, out = ROOT / a.model, ROOT / a.out
    fp32, q = export(model_dir, out)
    sizes = {"fp32_mb": round(fp32.stat().st_size / 1e6, 1), "int8_mb": round(q.stat().st_size / 1e6, 1)}
    tok = AutoTokenizer.from_pretrained(model_dir)
    report = {"sizes": sizes, "k": a.k, "max_len": MAX_LEN, "sets": []}
    for name, only in (("demo", "test"), ("unseen", None)):
        ds = load_set(name)
        ids = [r for r in ds["text"] if only is None or ds["split"][r] == only]
        texts = [ds["text"][r] for r in ids]
        true, keep = true_pairs(ds, only), set(ids)
        cur = {p for p in current_blocking_pairs(ds) if p[0] in keep and p[1] in keep}
        row = {"set": name, "records": len(ids), "true_pairs": len(true), "recall_current_pct": round(100 * len(true & cur) / len(true), 2)}
        e32 = None
        for tag, path in (("fp32", fp32), ("int8", q)):
            emb_model = OnnxEmbedder(path, tok)
            t0 = time.perf_counter()
            emb = emb_model.encode(texts)
            secs = time.perf_counter() - t0
            pairs = knn_pairs(emb, ids, a.k)
            row[f"{tag}_embed_recall_pct"] = round(100 * len(true & pairs) / len(true), 2)
            row[f"{tag}_union_recall_pct"] = round(100 * len(true & (pairs | cur)) / len(true), 2)
            row[f"{tag}_encode_s_1thread"] = round(secs, 2)
            row[f"{tag}_extra_pairs"] = len(pairs - cur)
            if tag == "fp32":
                e32 = emb
            else:
                row["int8_vs_fp32_mean_cosine"] = round(float((emb * e32).sum(1).mean()), 5)
                row["int8_vs_fp32_min_cosine"] = round(float((emb * e32).sum(1).min()), 5)
        report["sets"].append(row)
    (ROOT / "bench" / "reports" / "gpu_onnx_report.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
