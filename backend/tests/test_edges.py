from app.graph.edges import after_critique, after_enrich
from app.schemas import SAFERProfile


def test_after_enrich_no_dot():
    assert after_enrich({}) == "no_dot"


def test_after_enrich_ok():
    p = SAFERProfile(
        legal_name="x",
        operating_status="OK",
        power_units=100,
        drivers=110,
    )
    assert after_enrich({"safer_profile": p}) == "ok"


def test_after_critique_pass():
    assert after_critique({"critique_pass": True, "critique_iters": 0}) == "pass"


def test_after_critique_loop():
    assert after_critique({"critique_pass": False, "critique_iters": 0}) == "loop"


def test_after_critique_max_iters_pass():
    assert after_critique({"critique_pass": False, "critique_iters": 2}) == "pass"
