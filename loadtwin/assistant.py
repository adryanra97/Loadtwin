"""Question-to-scenario assistant: plain language in, a SimPy run and an explanation out.

A question such as "what if traffic doubles on payday?" becomes a *plan*: which tool to run and
with what changes. The plan comes from an LLM when one is configured, and from a small rule-based
parser otherwise. The plan is validated and clamped to the API limits, the simulation runs, and the
result is explained. Every number comes from the simulation: an LLM explanation that contains a
number not found in the result, the plan or the question is rejected and replaced by a template.

Environment variables
---------------------
LOADTWIN_LLM_API_KEY
    Anthropic API key. Without it, the rule-based parser and template explanations are used.
LOADTWIN_LLM_MODEL
    Model name; ``DEFAULT_MODEL`` when unset.
LOADTWIN_LLM_BASE_URL
    API base URL; ``https://api.anthropic.com`` when unset.

Attributes
----------
TOOLS : tuple of str
    What a plan can run.
DEFAULT_MODEL : str
    Model used when ``LOADTWIN_LLM_MODEL`` is unset.
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from dataclasses import replace

from loadtwin.calibration import Database, Measurement, prepare
from loadtwin.engine import Fault, Spec, seed_from
from loadtwin.evaluate import Load, evaluate
from loadtwin.faults import describe, run_fault
from loadtwin.sensitivity import sensitivity
from loadtwin.sla import SLA
from loadtwin.traffic import Pattern, run_pattern, to_segments

TOOLS = ("evaluate", "fault", "pattern", "sensitivity")
DEFAULT_MODEL = "claude-haiku-5-5"
MAX_TPS = 2000.0
_TIMEOUT_S = 25

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "tool": {"type": "string", "enum": list(TOOLS), "description": "Which simulation answers the question."},
        "restated": {"type": "string", "description": "The question restated as the scenario that will run, one sentence."},
        "loadMultiplier": {"type": "number", "description": "Multiply the current peak load, e.g. 2 for 'traffic doubles'."},
        "peakTps": {"type": "number", "description": "Explicit peak load in requests per second, if the user gave one."},
        "targetChanges": {
            "type": "object",
            "description": "Changes to the target cluster, only fields the user mentioned.",
            "properties": {k: {"type": "number"} for k in ("nodes", "vcpu", "ramGb", "threadPool", "connPool")},
        },
        "fault": {
            "type": "object",
            "description": "For tool=fault.",
            "properties": {
                "nodesDown": {"type": "integer"},
                "dbSlowdown": {"type": "number", "description": "2 = database twice as slow"},
                "extFailShare": {"type": "number", "description": "0..1 share of external calls that hang and fail"},
                "extTimeoutMs": {"type": "number"},
                "extSlowdown": {"type": "number"},
                "durationS": {"type": "number"},
            },
        },
        "pattern": {
            "type": "object",
            "description": "For tool=pattern.",
            "properties": {
                "kind": {"type": "string", "enum": ["daily", "spike", "ramp"]},
                "baseTps": {"type": "number"},
                "peakTps": {"type": "number"},
                "spikeS": {"type": "number"},
                "durationS": {"type": "number"},
            },
        },
    },
    "required": ["tool", "restated"],
}


# ---------------------------------------------------------------- rule-based parser

_NUM = r"(\d+(?:[.,]\d+)?)"
_TIMES = r"\s*(?:x\b|×|kali\b|lipat\b)"
_WORDS = {"dua": 2, "double": 2, "twice": 2, "tiga": 3, "triple": 3, "empat": 4, "setengah": 0.5, "half": 0.5}


def _f(x: str) -> float:
    """Parse a number written with a decimal point or comma."""
    return float(x.replace(",", "."))


def rule_plan(question: str) -> dict:
    """Turn a question into a plan with keyword rules (English and Indonesian).

    Parameters
    ----------
    question : str
        Free text.

    Returns
    -------
    dict
        A plan with the keys of ``PLAN_SCHEMA``.
    """
    q = question.lower()
    plan: dict = {"tool": "evaluate", "targetChanges": {}}

    m = re.search(_NUM + _TIMES, q)
    if m:
        plan["loadMultiplier"] = _f(m.group(1))
    else:
        for w, v in _WORDS.items():
            if re.search(rf"\b{w}(?:s|d)?\b(?:\s+(?:kali|lipat))?", q) and re.search(
                r"traffic|trafik|load|beban|request|user|pengguna|naik|double|twice|triple|lipat|kali", q
            ):
                plan["loadMultiplier"] = v
                break
    m = re.search(r"(?:naik|up|increase[sd]?|bertambah|tambah|\+)\s*" + _NUM + r"\s*%", q)
    if m and "loadMultiplier" not in plan:
        plan["loadMultiplier"] = 1 + _f(m.group(1)) / 100
    m = re.search(r"(?:turun|down|drop[s]?|decrease[sd]?|berkurang|-)\s*" + _NUM + r"\s*%", q)
    if m and "loadMultiplier" not in plan and not re.search(r"node", q):
        plan["loadMultiplier"] = max(1 - _f(m.group(1)) / 100, 0.05)
    m = re.search(_NUM + r"\s*(?:tps|rps|req/s|requests? per second|request/detik|req/detik)", q)
    if m:
        plan["peakTps"] = _f(m.group(1))

    m = re.search(_NUM + r"\s*(?:node|nodes|server|instance|instances|pod|pods)\b", q)
    node_word = re.search(r"\b(?:node|server|instance|pod)s?\b", q)
    down_words = re.search(r"mati|down|crash|gagal|fail|hilang|lost|offline|tumbang", q)
    if node_word and down_words:
        n = re.search(_NUM + r"\s*(?:node|server|instance|pod)", q)
        plan["tool"] = "fault"
        plan["fault"] = {"nodesDown": int(_f(n.group(1))) if n else 1}
    elif m:
        plan["targetChanges"]["nodes"] = int(_f(m.group(1)))
    m = re.search(_NUM + r"\s*v?cpu", q)
    if m:
        plan["targetChanges"]["vcpu"] = int(_f(m.group(1)))

    if re.search(r"database|db\b|basis data|query", q) and re.search(r"lambat|slow|lemot|latency|lag", q):
        m = re.search(_NUM + _TIMES, q)
        plan["tool"] = "fault"
        plan["fault"] = {**plan.get("fault", {}), "dbSlowdown": _f(m.group(1)) if m else 3.0}
        plan.pop("loadMultiplier", None) if m else None
    if re.search(r"timeout|time out|eksternal|external|dependenc|third[- ]party|pihak ketiga|api lain|vendor|payment gateway", q):
        plan["tool"] = "fault"
        m = re.search(_NUM + r"\s*%", q)
        share = _f(m.group(1)) / 100 if m else 0.3
        plan["fault"] = {**plan.get("fault", {}), "extFailShare": min(share, 1.0), "extTimeoutMs": 2000}
    m = re.search(_NUM + r"\s*(menit|minutes?|mins?|detik|seconds?|secs?|s)\b", q)
    if m and plan["tool"] == "fault":
        seconds = _f(m.group(1)) * (60 if m.group(2).startswith(("menit", "min")) else 1)
        plan["fault"]["durationS"] = seconds
    if re.search(r"spike|lonjakan|melonjak|burst|flash sale|tiba-tiba|mendadak", q):
        plan["tool"] = "pattern"
        plan["pattern"] = {"kind": "spike"}
    elif re.search(r"harian|daily|sehari|seharian|sepanjang hari|business day", q):
        plan["tool"] = "pattern"
        plan["pattern"] = {"kind": "daily"}
    elif re.search(r"\bramp\b|bertahap|naik perlahan|gradual", q):
        plan["tool"] = "pattern"
        plan["pattern"] = {"kind": "ramp"}
    sensitivity_words = (
        r"sensitiv|paling berpengaruh|most impact|which (?:parameter|input|setting)|parameter mana"
        r"|apa yang harus (?:diubah|dinaikkan)|what should i (?:change|tune)"
    )
    if re.search(sensitivity_words, q):
        plan["tool"] = "sensitivity"
    plan["restated"] = ""
    return plan


# ---------------------------------------------------------------- LLM


def llm_available() -> bool:
    """Whether an LLM is configured."""
    return bool(os.environ.get("LOADTWIN_LLM_API_KEY"))


def _call_llm(system: str, messages: list[dict], tools: list[dict] | None = None, tool_choice: dict | None = None) -> dict:
    """Call the Anthropic Messages API and return the parsed response."""
    base = os.environ.get("LOADTWIN_LLM_BASE_URL", "https://api.anthropic.com").rstrip("/")
    if not base.startswith(("https://", "http://")):
        raise ValueError("LOADTWIN_LLM_BASE_URL must be an http(s) URL")
    body = {
        "model": os.environ.get("LOADTWIN_LLM_MODEL", DEFAULT_MODEL),
        "max_tokens": 700,
        "system": system,
        "messages": messages,
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = tool_choice or {"type": "auto"}
    req = urllib.request.Request(  # noqa: S310 - scheme checked above
        f"{base}/v1/messages",
        data=json.dumps(body).encode(),
        headers={
            "content-type": "application/json",
            "x-api-key": os.environ["LOADTWIN_LLM_API_KEY"],
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as res:  # noqa: S310 - scheme checked above
        return json.loads(res.read())


PLANNER_PROMPT = (
    "You turn capacity-planning questions about one web service into a simulation plan by calling the "
    "run_scenario tool. The current setup is given as JSON. Choose: 'evaluate' for load changes or cluster "
    "changes at peak; 'fault' for crashed nodes, a slow database or failing/slow external dependencies "
    "(load changes may be combined); 'pattern' for spikes, daily curves or ramps; 'sensitivity' when the user "
    "asks which setting matters most or what to tune. Only include fields the question implies. Words like "
    "payday, campaign or sale mean a load increase; use loadMultiplier when a factor is given or implied. "
    "Write 'restated' in the language of the question. Never answer the question yourself."
)

EXPLAINER_PROMPT = (
    "You explain the result of a discrete-event simulation to an engineer, in the language of the question, in "
    "3 to 5 short sentences of plain prose (no lists, no headings). Start with the answer (does it hold or not), "
    "then the main reason and what to do. Use ONLY numbers that appear in the RESULT JSON, written the same way. "
    "Do not compute new numbers, do not estimate, do not round differently. If something is not in the result, "
    "do not mention it."
)


def llm_plan(question: str, context: dict) -> dict:
    """Ask the LLM for a plan.

    Parameters
    ----------
    question : str
        The user's question.
    context : dict
        Current setup shown to the model (target cluster, peak load, SLA).

    Returns
    -------
    dict
        The plan from the tool call.

    Raises
    ------
    ValueError
        When the model does not return a tool call.
    """
    res = _call_llm(
        PLANNER_PROMPT,
        [{"role": "user", "content": f"Current setup: {json.dumps(context)}\n\nQuestion: {question}"}],
        tools=[{"name": "run_scenario", "description": "Run a LoadTwin simulation.", "input_schema": PLAN_SCHEMA}],
        tool_choice={"type": "tool", "name": "run_scenario"},
    )
    for block in res.get("content", []):
        if block.get("type") == "tool_use":
            return dict(block.get("input") or {})
    raise ValueError("the model did not return a plan")


_NUMBER = re.compile(r"(?<![\w.])-?\d+(?:[.,]\d+)*(?:\.\d+)?")


def _numbers(text: str) -> set[float]:
    """Every number in ``text`` (thousands separators removed)."""
    out = set()
    for raw in _NUMBER.findall(text):
        s = raw.replace(",", "") if re.fullmatch(r"-?\d{1,3}(?:,\d{3})+(?:\.\d+)?", raw) else raw.replace(",", ".")
        try:
            out.add(round(float(s), 3))
        except ValueError:
            continue
    return out


def _allowed(*sources) -> set[float]:
    """Numbers that may appear in an explanation: those in the sources, plus small counting numbers."""
    allowed = set(range(0, 11))
    for src in sources:
        text = src if isinstance(src, str) else json.dumps(src)
        for x in _numbers(text):
            allowed.update({x, round(x, 2), round(x, 1), round(x), round(x * 100, 1), round(x * 100)})
    return {float(a) for a in allowed}


def unverified_numbers(text: str, *sources) -> list[float]:
    """Numbers in ``text`` that do not appear in any of ``sources``."""
    ok = _allowed(*sources)
    return sorted(x for x in _numbers(text) if x not in ok and round(x) not in ok)


def llm_explain(question: str, facts: dict) -> str:
    """Ask the LLM to explain ``facts``; returns plain text."""
    res = _call_llm(
        EXPLAINER_PROMPT,
        [{"role": "user", "content": f"QUESTION: {question}\n\nRESULT: {json.dumps(facts)}"}],
    )
    return " ".join(b.get("text", "") for b in res.get("content", []) if b.get("type") == "text").strip()


# ---------------------------------------------------------------- execution


def _clamp(v, lo, hi):
    """Clamp ``v`` into ``[lo, hi]``."""
    return max(lo, min(hi, v))


def sanitize(plan: dict, peak_tps: float, target: Spec) -> dict:
    """Validate a plan and clamp every value to the API limits.

    Parameters
    ----------
    plan : dict
        Raw plan from the LLM or the rules.
    peak_tps : float
        Current peak load.
    target : Spec
        Current target cluster.

    Returns
    -------
    dict
        ``tool``, ``peakTps``, ``targetSpec`` (as a ``Spec``), ``fault``, ``pattern`` and
        ``changes`` (human-readable list of what differs from the current setup).
    """
    tool = plan.get("tool") if plan.get("tool") in TOOLS else "evaluate"
    changes = []
    peak = peak_tps
    if isinstance(plan.get("peakTps"), int | float) and plan["peakTps"] > 0:
        peak = float(plan["peakTps"])
    elif isinstance(plan.get("loadMultiplier"), int | float) and plan["loadMultiplier"] > 0:
        peak = peak_tps * float(plan["loadMultiplier"])
    peak = round(_clamp(peak, 1, MAX_TPS), 1)
    if peak != peak_tps:
        changes.append(f"peak load {peak_tps:g} → {peak:g} req/s")

    spec = target
    tc = plan.get("targetChanges") or {}
    limits = {"nodes": (1, 50), "vcpu": (1, 128), "ramGb": (0.5, 1024), "threadPool": (1, 2000), "connPool": (1, 1000)}
    fields = {"nodes": "nodes", "vcpu": "vcpu", "ramGb": "ram_gb", "threadPool": "thread_pool", "connPool": "conn_pool"}
    for k, (lo, hi) in limits.items():
        v = tc.get(k)
        if isinstance(v, int | float) and v > 0:
            v = _clamp(v, lo, hi)
            v = float(v) if k == "ramGb" else int(round(v))
            if v != getattr(spec, fields[k]):
                changes.append(f"{k} {getattr(spec, fields[k]):g} → {v:g}")
                spec = replace(spec, **{fields[k]: v})

    fault = None
    if tool == "fault":
        f = plan.get("fault") or {}
        fault = Fault(
            start_s=0,
            end_s=_clamp(float(f.get("durationS") or 40), 10, 120),
            nodes_down=int(_clamp(int(f.get("nodesDown") or 0), 0, max(spec.nodes - 1, 0))),
            db_slowdown=_clamp(float(f.get("dbSlowdown") or 1), 1, 20),
            ext_fail_share=_clamp(float(f.get("extFailShare") or 0), 0, 1),
            ext_timeout_ms=_clamp(float(f.get("extTimeoutMs") or 2000), 100, 30000),
            ext_slowdown=_clamp(float(f.get("extSlowdown") or 1), 1, 20),
        )
        if not (fault.nodes_down or fault.db_slowdown != 1 or fault.ext_fail_share or fault.ext_slowdown != 1):
            fault = replace(fault, nodes_down=1 if spec.nodes > 1 else 0, db_slowdown=1 if spec.nodes > 1 else 3)
    pattern = None
    if tool == "pattern":
        p = plan.get("pattern") or {}
        kind = p.get("kind") if p.get("kind") in ("daily", "spike", "ramp") else "spike"
        hi = _clamp(float(p.get("peakTps") or (peak if peak != peak_tps else peak_tps * 2)), 1, MAX_TPS)
        lo = _clamp(float(p.get("baseTps") or peak_tps * 0.5), 0, hi)
        pattern = Pattern(
            kind, hi, lo, 20, _clamp(float(p.get("spikeS") or 30), 5, 300), _clamp(float(p.get("durationS") or 300), 30, 1200)
        )
        # Keep the pattern within the request budget by shortening it.
        while True:
            try:
                to_segments(pattern)
                break
            except ValueError:
                if pattern.kind == "daily" and pattern.seconds_per_hour > 5:
                    pattern = replace(pattern, seconds_per_hour=pattern.seconds_per_hour / 2)
                elif pattern.kind == "ramp" and pattern.duration_s > 30:
                    pattern = replace(pattern, duration_s=pattern.duration_s / 2)
                else:
                    pattern = replace(
                        pattern, peak_tps=pattern.peak_tps * 0.8, base_tps=min(pattern.base_tps, pattern.peak_tps * 0.8)
                    )
    if fault is not None:
        changes.append(f"failure for {fault.end_s - fault.start_s:g} s: {describe(fault, spec)}")
    if pattern is not None:
        changes.append(f"{pattern.kind} pattern from {pattern.base_tps:g} to {pattern.peak_tps:g} req/s")
    if tool == "sensitivity":
        changes.append("vary each input by 25% down and up")
    return {"tool": tool, "peakTps": peak, "targetSpec": spec, "fault": fault, "pattern": pattern, "changes": changes}


def run_plan(
    clean: dict,
    measured: Spec,
    measurement: Measurement,
    normal_tps: float,
    sla: SLA,
    database: Database,
) -> tuple[dict, dict]:
    """Run a sanitized plan.

    Returns
    -------
    tuple of dict
        The full tool result and a compact ``facts`` dictionary for the explanation.
    """
    spec, peak = clean["targetSpec"], clean["peakTps"]
    seed = seed_from(vars(measured), vars(measurement), vars(spec), peak, clean["tool"])
    if clean["tool"] == "evaluate":
        reps = 8 if peak * 8 <= 6000 else 0
        r = evaluate(measured, measurement, spec, Load(min(normal_tps, peak), peak, [1.5]), sla, database, seed, False, reps)
        peak_s = next((s for s in r["scenarios"] if s["kind"] == "peak"), None)
        facts = {
            "verdict": r["verdict"],
            "reasons": r["reasons"],
            "conditions": r["conditions"],
            "peakTps": peak,
            "peak": {k: peak_s["summary"][k] for k in ("p95Ms", "errorRatePct", "cpuPct", "threadPct")} if peak_s else None,
            "maxSustainableTps": r["capacity"]["maxTps"] if r["capacity"] else None,
            "limitingResource": r["limitingResource"],
            "breachProbability": r["monteCarlo"]["breachProbability"] if r["monteCarlo"] else None,
            "sla": vars(sla),
        }
        return r, facts
    profile, _ = prepare(measured, measurement, spec, database, seed)
    if clean["tool"] == "fault":
        r = run_fault(spec, profile, peak, clean["fault"], sla, seed)
        facts = {
            "verdict": r["verdict"],
            "reasons": r["reasons"],
            "failure": r["failure"]["description"],
            "peakTps": peak,
            "during": r["phases"]["during"],
            "healthy": r["phases"]["healthyDuring"],
            "recoverySeconds": r["recoverySeconds"],
            "sla": vars(sla),
        }
        return r, facts
    if clean["tool"] == "pattern":
        r = run_pattern(spec, profile, clean["pattern"], sla, seed)
        facts = {
            "verdict": r["verdict"],
            "reasons": r["reasons"],
            "pattern": vars(clean["pattern"]),
            "breachSeconds": r["breachSeconds"],
            "breachSharePct": round(r["breachShare"] * 100),
            "recoverySeconds": r["recoverySeconds"],
            "sla": vars(sla),
        }
        return r, facts
    r = sensitivity(measured, measurement, spec, peak, sla, database, seed=seed)
    facts = {
        "baselineP95Ms": r["baseline"]["p95Ms"],
        "peakTps": peak,
        "ranking": [
            {"input": p["label"], "swingMs": p["swingMs"], "lowP95Ms": p["low"]["p95Ms"], "highP95Ms": p["high"]["p95Ms"]}
            for p in r["params"]
        ],
        "advice": r["advice"],
    }
    return r, facts


def template_explanation(clean: dict, facts: dict) -> str:
    """Explanation assembled from the result's own sentences, without an LLM."""
    parts = []
    if clean["changes"]:
        parts.append("Scenario: " + "; ".join(clean["changes"]) + ".")
    if clean["tool"] == "sensitivity":
        parts += facts["advice"]
    else:
        parts += facts.get("reasons", [])
        parts += facts.get("conditions", []) or []
    return " ".join(parts)


def ask(
    question: str,
    measured: Spec,
    measurement: Measurement,
    target: Spec,
    normal_tps: float,
    peak_tps: float,
    sla: SLA,
    database: Database,
) -> dict:
    """Answer a question with a simulation.

    Parameters
    ----------
    question : str
        Free text, in any language when an LLM is configured; English or Indonesian keywords otherwise.
    measured, measurement, target : Spec, Measurement, Spec
        The service.
    normal_tps, peak_tps : float
        Current loads.
    sla : SLA
    database : Database

    Returns
    -------
    dict
        ``planSource`` (``llm`` or ``rules``), ``tool``, ``restated``, ``changes``, ``peakTps``,
        ``targetSpec``, ``result`` (the tool's full output), ``explanation``, ``explanationSource``
        (``llm`` or ``template``) and ``notes``.
    """
    notes = []
    context = {
        "targetSpec": {"nodes": target.nodes, "vcpu": target.vcpu, "ramGb": target.ram_gb, "threadPool": target.thread_pool},
        "peakTps": peak_tps,
        "sla": vars(sla),
    }
    plan, source = None, "rules"
    if llm_available():
        try:
            plan, source = llm_plan(question, context), "llm"
        except Exception as exc:  # noqa: BLE001 - any LLM failure falls back to the rules
            notes.append(f"The language model was unavailable ({type(exc).__name__}); keyword rules were used.")
    if plan is None:
        plan = rule_plan(question)
    clean = sanitize(plan, peak_tps, target)
    result, facts = run_plan(clean, measured, measurement, normal_tps, sla, database)

    explanation, exp_source = template_explanation(clean, facts), "template"
    if source == "llm":
        try:
            text = llm_explain(question, facts)
            bad = unverified_numbers(text, facts, question, clean["changes"])
            if text and not bad:
                explanation, exp_source = text, "llm"
            elif bad:
                notes.append("The model's explanation used numbers that are not in the simulation result, so it was replaced.")
        except Exception as exc:  # noqa: BLE001 - keep the template explanation
            notes.append(f"The explanation could not be generated ({type(exc).__name__}).")
    t = clean["targetSpec"]
    return {
        "planSource": source,
        "tool": clean["tool"],
        "restated": plan.get("restated") or "",
        "changes": clean["changes"],
        "peakTps": clean["peakTps"],
        "targetSpec": {
            "vcpu": t.vcpu,
            "ramGb": t.ram_gb,
            "nodes": t.nodes,
            "threadPool": t.thread_pool,
            "connPool": t.conn_pool,
            "bandwidthMbps": t.bandwidth_mbps,
            "timeoutMs": t.timeout_ms,
        },
        "fault": vars(clean["fault"]) if clean["fault"] else None,
        "pattern": vars(clean["pattern"]) if clean["pattern"] else None,
        "result": result,
        "facts": facts,
        "explanation": explanation,
        "explanationSource": exp_source,
        "notes": notes,
    }
