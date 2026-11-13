import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_runtime_dependencies_in_sync():
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]
    reqs = {line.split("#")[0].strip() for line in (ROOT / "requirements.txt").read_text().splitlines()} - {""}
    assert set(project["dependencies"]) == reqs


def test_vercel_entry_point_exposes_app():
    import runpy

    ns = runpy.run_path(str(ROOT / "api" / "index.py"))
    assert ns["app"].title == "LoadTwin"
