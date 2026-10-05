"""The artifacts shipped to the browser must always equal what the Python reference loads."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from bench.export_assets import config_to_json  # noqa: E402
from sama.config import default_config  # noqa: E402


def test_config_json_matches_yaml():
    shipped = json.loads((ROOT / "engine_assets" / "config.json").read_text(encoding="utf-8"))
    assert shipped == json.loads(json.dumps(config_to_json(default_config()))), \
        "config.json is stale: run `python -m bench.export_assets`"


def test_frontend_copies_are_identical():
    for f in ("config.json", "gate.json", "text_model.json"):
        assert (ROOT / "engine_assets" / f).read_bytes() == (ROOT / "frontend" / "public" / "engine" / f).read_bytes(), f


def test_gate_is_frozen_and_complete():
    g = json.loads((ROOT / "engine_assets" / "gate.json").read_text(encoding="utf-8"))
    assert g["frozen"] is True and len(g["coef"]) == len(g["features"]) and g["thr_E"] is not None
    assert "embed_cos" not in g["features"]                      # SC-03: embeddings never reach a decision
