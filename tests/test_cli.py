import json

import pytest

from loadtwin.cli import main


def test_example_and_evaluate(tmp_path, capsys):
    main(["example", "evaluate"])
    f = tmp_path / "s.json"
    f.write_text(capsys.readouterr().out)
    out = tmp_path / "r.json"
    main(["evaluate", str(f), "--json", str(out)])
    assert "Verdict: PASS" in capsys.readouterr().out
    assert json.loads(out.read_text())["verdict"] == "PASS"


def test_simulate(capsys):
    main(["simulate", "examples/simulate.json"])
    assert "Capacity:" in capsys.readouterr().out


def test_invalid_input(tmp_path):
    f = tmp_path / "bad.json"
    f.write_text('{"measuredSpec": {}}')
    with pytest.raises(SystemExit, match="Invalid input"):
        main(["evaluate", str(f)])
