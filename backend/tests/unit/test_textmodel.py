import json

from sama.textmodel import TextModel, bucket_of, char_wb_ngrams, fit_text_model, fnv1a32


def test_fnv1a_known_values():
    assert fnv1a32("") == 2166136261
    assert fnv1a32("a") == 0xE40C292C
    assert fnv1a32("foobar") == 0xBF9CF968


def test_char_wb_layout_and_short_words():
    assert char_wb_ngrams("ab") == [" ab", "ab ", " ab "]    # " ab " is 4 long: the 4-gram counts once, then stops
    assert char_wb_ngrams("a") == [" a "]                    # shorter than 4: counted once for n=3, then stops
    g = char_wb_ngrams("flange")
    assert " fl" in g and "nge " in g and " flan" in g


def test_any_text_gets_a_vector_including_unseen_words():
    m = fit_text_model(["flange weld neck 2 cl150", "gate valve 2 cl300"])
    v = m.vector("centrifugal pump 50 m3h")
    assert v and abs(sum(x * x for x in v.values()) - 1.0) < 1e-12
    assert m.vector("") == {}


def test_roundtrip_json_and_cosine_properties():
    m = fit_text_model(["flange weld neck 2 cl150", "gate valve 2 cl300", "pipe seamless 2 sch40"])
    m2 = TextModel.from_json(json.loads(json.dumps(m.to_json())))
    a, b = m.vector("flange weld neck 2 cl150"), m2.vector("flange weld neck 2 cl150")
    assert all(abs(a[k] - b[k]) < 1e-9 for k in a)
    same = m.cosine(a, a)
    assert abs(same - 1.0) < 1e-9
    assert m.cosine(a, m.vector("flange weld neck 2 cl300")) < same
