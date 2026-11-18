#!/usr/bin/env python3
"""Seams battle-test harness: local LLM attacks the wire, deterministic oracles referee.

Standard library only; Python >= 3.10 (pin it: see bootstrap.sh, never bare python3).

  battle.py selftest            vectors + oracle sanity on each target (no LLM, no network)
  battle.py fuzz                deterministic mutation fuzz of the vectors' requests (no LLM)
  battle.py probe               check the LLM endpoint: reachability, latency, tool-calling support
  battle.py run [--focus ID] [--steps N]   serial LLM campaign
  battle.py report [RUN_DIR]    findings.md from a run directory

Configuration is environment variables only (see config.example.env). Nothing is
hardcoded. A key VALUE is never accepted from argv, env or config: SEAMS_LLM_KEY_FILE
names a file, read at request time, never logged. The harness is strictly serial.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import random
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

KIT = Path(__file__).resolve().parent
sys.path.insert(0, str(KIT))
import oracles  # noqa: E402

if sys.version_info < (3, 10):
    sys.exit(f"battle.py needs Python >= 3.10, this is {sys.version.split()[0]} ({sys.executable}). "
             "Run bootstrap.sh and use .venv/bin/python; do not call bare python3.")


def env(name, default=None, cast=str):
    v = os.environ.get(name)
    return default if v in (None, "") else cast(v)


CFG = {
    "base_url": env("SEAMS_LLM_BASE_URL"),
    "model": env("SEAMS_LLM_MODEL"),
    "ctx": env("SEAMS_LLM_CTX", 262144, int),
    "max_out": env("SEAMS_LLM_MAX_OUT", 2048, int),
    "timeout": env("SEAMS_LLM_TIMEOUT", 300, int),
    "temperature": env("SEAMS_LLM_TEMPERATURE", 0.7, float),
    "key_file": env("SEAMS_LLM_KEY_FILE"),
    "extra": env("SEAMS_LLM_EXTRA_JSON", "{}"),
    "use_tools": env("SEAMS_USE_TOOLS", "0") == "1",
    "target": env("SEAMS_TARGET", "stub"),
    "zephyr_dir": env("SEAMS_ZEPHYR_DIR"),
    "out": Path(env("SEAMS_OUT_DIR", str(KIT / "out"))),
    "ctx_fraction": env("SEAMS_CTX_FRACTION", 0.8, float),
}
TARGET_TIMEOUT = 30


# --------------------------------------------------------------------------- targets
def _swap(obj, table):
    if isinstance(obj, str):
        return table.get(obj, obj)
    if isinstance(obj, list):
        return [_swap(x, table) for x in obj]
    if isinstance(obj, dict):
        return {_swap(k, table) if isinstance(k, str) else k: _swap(v, table) for k, v in obj.items()}
    return obj


class StubTarget:
    name = "stub"

    def __init__(self, fixture=None):
        sys.path.insert(0, str(KIT / "stub"))
        import seams_stub
        self.stub = seams_stub.Stub()
        self.stub.load_fixture(fixture or {})

    def handle(self, msg):
        return self.stub.handle(msg)

    def close(self):
        pass


class HelperTarget:
    """The real zephyr helper, in process, over a throwaway ledger and synthetic keys."""
    name = "helper"

    def __init__(self, fixture=None):
        zd = CFG["zephyr_dir"] or str(KIT / "zephyr-src")
        if not (Path(zd) / "zephyr" / "wire.py").exists():
            raise SystemExit(f"SEAMS_TARGET=helper needs the zephyr source: {zd}/zephyr/wire.py not found. "
                             "Run bootstrap.sh or set SEAMS_ZEPHYR_DIR.")
        sys.path.insert(0, zd)
        os.environ.setdefault("ZEPHYR_SIGNING_MODE", "enforce")
        self._tmp = tempfile.TemporaryDirectory(prefix="seams-kit-")
        tmp = Path(self._tmp.name)
        os.environ["ZEPHYR_CLAIMS_DB"] = str(tmp / "data" / "claims.db")
        from zephyr.wire import open_helper
        self.helper = open_helper(tmp / "data", tmp / "keys", create_keys=True)
        self.to_real, self.to_name = {}, {}
        if fixture:
            self.to_real = self._load(fixture)
            self.to_name = {v: k for k, v in self.to_real.items()}

    def _load(self, fx):  # same loader as zephyr's tests/test_seams_wire_helper.py
        from zephyr import claims, consent
        helper, keys, names = self.helper, self.helper.keys, {}
        works = fx.get("works", {})
        for w in works:
            names[w] = "sha256:" + hashlib.sha256(f"fixture:{w}".encode()).hexdigest()
        deposits, pending = {}, list(works)
        while pending:
            progressed = False
            for w in list(pending):
                parents = works[w].get("parents", [])
                if any(p in works and p not in deposits for p in parents):
                    continue
                ref = works[w]["creator"]
                r = consent.record_seams_work(
                    content_hash=names[w], kind=works[w].get("kind", "fixture"),
                    parents=[deposits.get(p, p) for p in parents],
                    derivation="fork" if parents else "original", agent_id=keys.agent_id(ref),
                    signer=keys.signer(ref), published=works[w].get("published", True),
                    provenance=({"origin_status": "suggested",
                                 "imported_from": {"format": "fixture", "source_sha256": "00" * 32}}
                                if works[w].get("suggested") else None),
                    registry=helper.registry, recorder=helper.log)
                deposits[w] = r["manifest_hash"]
                pending.remove(w)
                progressed = True
            if not progressed:
                raise SystemExit("fixture lineage has a cycle")
        for d in fx.get("declarations", []):
            body = {k: v for k, v in d.items() if k != "declared_by"}
            subj = body["subject"]
            body["subject"] = subj if subj == "*" else deposits.get(subj, names.get(subj) or "sha256:" + hashlib.sha256(subj.encode()).hexdigest())
            ref = d["declared_by"]
            consent.record_use_terms_v1(declaration=body, agent_id=keys.agent_id(ref), signer=keys.signer(ref),
                                        registry=helper.registry, recorder=helper.log)
        for t in fx.get("routing_terms", []):
            ben = keys.signer(t["beneficiary"])
            claims.record_routing_terms(
                subject=deposits[t["subject"]], beneficiary_pubkey_id=ben.pubkey_id_str, share_bps=t["share_bps"],
                scope=t.get("scope", "standing"), declared_by=keys.agent_id(t["beneficiary"]),
                agent_id=keys.agent_id(t["beneficiary"]), signer=ben, registry=helper.registry, recorder=helper.log)
        for ref, addr in fx.get("wallets", {}).items():
            s = keys.signer(ref)
            claims.record_wallet_binding(subject=s.pubkey_id_str, wallet_address=addr, agent_id=keys.agent_id(ref),
                                         signer=s, registry=helper.registry, recorder=helper.log)
        return names

    def handle(self, msg):
        out = self.helper.handle(_swap(msg, self.to_real))
        return _swap(out, self.to_name)

    def close(self):
        try:
            from zephyr import claims
            claims._reset_claims_store()
        finally:
            self._tmp.cleanup()


def make_target(fixture=None, which=None):
    which = which or CFG["target"]
    if which == "stub":
        return StubTarget(fixture)
    if which == "helper":
        return HelperTarget(fixture)
    raise SystemExit(f"SEAMS_TARGET must be stub or helper, not {which!r}")


def safe_handle(target, req):
    """A target that raises or returns junk is itself a finding (A2); never let it kill the run."""
    try:
        return target.handle(copy.deepcopy(req))
    except BaseException as e:  # noqa: BLE001
        if isinstance(e, (KeyboardInterrupt, SystemExit)):
            raise
        return {"__crash__": f"{type(e).__name__}: {e}"}


def referee(target, req, resp, ctx):
    if isinstance(resp, dict) and "__crash__" in resp:
        return [oracles._v("A2", f"target raised on a request: {resp['__crash__']}")]
    return oracles.check_exchange(req, resp, ctx, target)


# --------------------------------------------------------------------------- vectors
def load_suites():
    suites = {}
    for p in sorted((KIT / "vectors").glob("*.json")):
        suites[p.stem] = json.loads(p.read_text())
    return suites


def _strip(actual, expected):
    if isinstance(expected, dict):
        return {k: _strip(actual.get(k) if isinstance(actual, dict) else None, v) for k, v in expected.items()}
    if isinstance(expected, list) and isinstance(actual, list) and len(actual) == len(expected):
        return [_strip(a, e) for a, e in zip(actual, expected)]
    return actual


def _same(actual, expected):
    if isinstance(expected, dict) and isinstance(actual, dict):
        for k, v in expected.items():
            a = actual.get(k)
            if k in ("legs", "receipts") and isinstance(v, list) and isinstance(a, list):
                left = list(a)
                for e in v:
                    hit = next((x for x in left if _strip(x, e) == e), None)
                    if hit is None:
                        return False
                    left.remove(hit)
                if left:
                    return False
            elif not _same(a, v):
                return False
        return True
    return _strip(actual, expected) == expected


def cmd_selftest(args):
    suites = load_suites()
    manifest = (KIT / "vectors" / "MANIFEST.sha256")
    if manifest.exists():
        for line in manifest.read_text().splitlines():
            digest, name = line.split(None, 1)
            got = hashlib.sha256((KIT / "vectors" / name.strip()).read_bytes()).hexdigest()
            if got != digest:
                print(f"WARNING vectors/{name.strip()} differs from MANIFEST.sha256 (edited since packaging)")
    targets = ["stub"] + (["helper"] if (CFG["zephyr_dir"] or (KIT / "zephyr-src").exists()) else [])
    if os.environ.get("SEAMS_TARGET") in targets:
        targets = [CFG["target"]]
    bad_total = 0
    for which in targets:
        total = failed = skipped = oracle_hits = 0
        for sname, suite in suites.items():
            for case in suite["cases"]:
                if case["request"].get("algorithm") == "recursive-passthrough-draft" and which == "helper":
                    skipped += 1  # stand-in only draft (U5)
                    continue
                t = make_target(suite.get("fixture", {}), which)
                ctx = oracles.Context(suite.get("fixture", {}))
                try:
                    for step in case.get("setup", []):
                        r0 = safe_handle(t, step)
                        ctx.observe(step, r0)
                    got = safe_handle(t, case["request"])
                    total += 1
                    if not _same(got, case["expect"]):
                        failed += 1
                        print(f"FAIL [{which}] {sname}::{case['name']}\n  expect {case['expect']}\n  got    {got}")
                    v = [x for x in referee(t, case["request"], got, ctx) if x["severity"] == "fail"]
                    if v:
                        oracle_hits += 1
                        print(f"ORACLE [{which}] {sname}::{case['name']}: " + "; ".join(f"{x['oracle']} {x['detail']}" for x in v))
                finally:
                    t.close()
        print(f"{which}: {total - failed}/{total} vectors pass"
              + (f", {skipped} stand-in-only skipped" if skipped else "")
              + f"; oracles flagged {oracle_hits} vector exchange(s)")
        bad_total += failed
    return 1 if bad_total else 0


# --------------------------------------------------------------------------- fuzz
MUTANT_VALUES = [None, [], {}, "", -1, 0, 2 ** 63, 1.5, True, "A" * 5000, "‮\u0000é💥", [[[[[]]]]],
                 {"a": {"b": {"c": {}}}}, "sha256:", "sha256:" + "0" * 64, "../../etc/passwd", "key:", "key:" + "x" * 3000]


def mutants(req, rng):
    yield "extra-key", dict(req, **{"__kit_extra__": 1})
    for k in list(req):
        if k == "op":
            continue
        d = dict(req)
        del d[k]
        yield f"drop {k}", d
        for v in MUTANT_VALUES:
            yield f"{k}={json.dumps(v)[:30]}", dict(req, **{k: v})
        if isinstance(req[k], dict):
            for sub in list(req[k]):
                for v in rng.sample(MUTANT_VALUES, 5):
                    inner = dict(req[k], **{sub: v})
                    yield f"{k}.{sub}={json.dumps(v)[:30]}", dict(req, **{k: inner})
                inner = {a: b for a, b in req[k].items() if a != sub}
                yield f"drop {k}.{sub}", dict(req, **{k: inner})


def cmd_fuzz(args):
    rng = random.Random(args.seed)
    run = new_run("fuzz")
    suites = load_suites()
    found, seen = [], set()
    n = 0
    for sname, suite in suites.items():
        if args.suite and sname not in args.suite:
            continue
        for case in suite["cases"]:
            if case["request"].get("algorithm") == "recursive-passthrough-draft" and CFG["target"] == "helper":
                continue
            t = ctx = None
            for label, m in mutants(case["request"], rng):
                if t is None:  # a fresh target per case; rebuilt only after a mutant changed state
                    t = make_target(suite.get("fixture", {}))
                    ctx = oracles.Context(suite.get("fixture", {}))
                    for step in case.get("setup", []):
                        ctx.observe(step, safe_handle(t, step))
                resp = safe_handle(t, m)
                n += 1
                for v in referee(t, m, resp, ctx):
                    key = (v["oracle"], m.get("op"), re.sub(r"[\d.]+|'[^']*'|\"[^\"]*\"", "#", v["detail"])[:55])
                    if key in seen:
                        continue
                    seen.add(key)
                    rec = {"source": f"fuzz:{sname}::{case['name']}::{label}", "target": t.name, "fixture": sname,
                           "setup": case.get("setup", []), "request": m, "response": resp, "violation": v}
                    found.append(rec)
                    with (run / "findings.jsonl").open("a") as f:
                        f.write(json.dumps(rec) + "\n")
                clean = isinstance(resp, dict) and ("error" in resp or resp.get("status") == "refused"
                                                   or m.get("op") in ("check_use", "quote_route", "get_lineage", "get_links", "hello"))
                if not clean:
                    t.close()
                    t = None
            if t is not None:
                t.close()
    print(f"fuzz: {n} mutated requests on {CFG['target']}, {len(found)} distinct findings -> {run}/findings.jsonl")
    write_report(run)
    return 0


# --------------------------------------------------------------------------- LLM client
class LLMError(RuntimeError):
    pass


def _key():
    if not CFG["key_file"]:
        return None
    try:
        return Path(CFG["key_file"]).read_text().strip()
    except OSError as e:
        raise LLMError(f"SEAMS_LLM_KEY_FILE unreadable ({e.__class__.__name__}); path only is configured, never the value")


def chat(messages, tools=None, max_tokens=None):
    """One chat-completions request, strictly serial, with backoff on 429/5xx/connection trouble."""
    if not CFG["base_url"] or not CFG["model"]:
        raise LLMError("set SEAMS_LLM_BASE_URL (e.g. http://host:8000/v1) and SEAMS_LLM_MODEL")
    body = {"model": CFG["model"], "messages": messages, "temperature": CFG["temperature"],
            "max_tokens": max_tokens or CFG["max_out"], "stream": False}
    body.update(json.loads(CFG["extra"] or "{}"))
    if tools:
        body.update({"tools": tools, "tool_choice": "auto"})
    url = CFG["base_url"].rstrip("/") + "/chat/completions"
    delay = 2.0
    for attempt in range(8):
        headers = {"Content-Type": "application/json"}
        k = _key()
        if k:
            headers["Authorization"] = "Bearer " + k
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=CFG["timeout"]) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            retry = e.code in (408, 429, 500, 502, 503, 504)
            wait = float(e.headers.get("Retry-After") or delay) if e.headers else delay
            if not retry:
                raise LLMError(f"HTTP {e.code} from the endpoint: {e.read()[:300]!r}")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            wait = delay
            last = e
        else:
            continue
        print(f"  endpoint busy or unreachable (attempt {attempt + 1}/8); waiting {min(wait, 60):.0f}s", file=sys.stderr)
        time.sleep(min(wait, 60))
        delay = min(delay * 2, 60)
    raise LLMError("endpoint still unavailable after 8 attempts; try again later (the run is saved up to this point)")


def _content(resp):
    msg = resp["choices"][0]["message"]
    text = msg.get("content") or ""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip(), msg


def cmd_probe(args):
    out = {"base_url": CFG["base_url"], "model": CFG["model"], "ctx_assumed": CFG["ctx"]}
    t0 = time.time()
    r = chat([{"role": "user", "content": 'Reply with exactly: {"ok": true}'}], max_tokens=64)
    text, _ = _content(r)
    out.update(reachable=True, latency_s=round(time.time() - t0, 2), reply=text[:80], usage=r.get("usage"))
    tool = {"type": "function", "function": {"name": "echo", "description": "Echo a value.",
            "parameters": {"type": "object", "properties": {"x": {"type": "integer"}}, "required": ["x"]}}}
    try:
        r2 = chat([{"role": "user", "content": "Call the echo tool with x=7."}], tools=[tool], max_tokens=128)
        calls = r2["choices"][0]["message"].get("tool_calls") or []
        args_ok = bool(calls) and json.loads(calls[0]["function"]["arguments"]).get("x") == 7
        out["tool_calling"] = bool(args_ok)
    except (LLMError, ValueError, KeyError) as e:
        out["tool_calling"] = False
        out["tool_probe_error"] = str(e)[:200]
    out["recommended_mode"] = "tools (set SEAMS_USE_TOOLS=1)" if out["tool_calling"] else "jsonl (default)"
    CFG["out"].mkdir(parents=True, exist_ok=True)
    (CFG["out"] / "probe.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))
    return 0


# --------------------------------------------------------------------------- campaign
def new_run(kind):
    d = CFG["out"] / f"{kind}-{time.strftime('%Y%m%d-%H%M%S')}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def est_tokens(s):  # deliberately pessimistic for JSON: ~3 chars per token
    return len(s) // 3 + 4


def budgeted(system, history):
    """System prompt + as many of the newest exchanges as fit; drop oldest first, never error."""
    budget = int((CFG["ctx"] - CFG["max_out"] - 2000) * CFG["ctx_fraction"])
    used = est_tokens(system)
    keep, dropped = [], 0
    for m in reversed(history):
        c = est_tokens(m["content"] if isinstance(m.get("content"), str) else json.dumps(m))
        if used + c > budget:
            dropped += 1
            continue
        used += c
        keep.append(m)
    keep.reverse()
    msgs = [{"role": "system", "content": system}]
    if dropped:
        msgs.append({"role": "user", "content": f"[{dropped} older exchanges were dropped to fit the context window; "
                                                 "the referee still has them. Continue from the newest.]"})
    return msgs + keep, dropped


JSON_RE = re.compile(r"\{")


def first_json_object(text):
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    dec = json.JSONDecoder()
    for m in JSON_RE.finditer(text):
        try:
            obj, _ = dec.raw_decode(text[m.start():])
            if isinstance(obj, dict):
                return obj
        except ValueError:
            continue
    return None


WIRE_TOOL = {"type": "function", "function": {
    "name": "send_wire_request", "description": "Send one Seams wire request (a JSON object with an 'op') and get the response.",
    "parameters": {"type": "object", "properties": {"request": {"type": "object"}}, "required": ["request"]}}}


def build_system(focus):
    spec = (KIT / "wire" / "WIRE-V0.md").read_text()
    brief = (KIT / "briefs" / "attacker.md").read_text()
    inv = "\n".join(f"  {k}: {v}" for k, v in {**oracles.CANON, **oracles.ADDITIONS}.items())
    return (brief + "\n\n## Invariants the referee enforces\n" + inv +
            f"\n\n## This session's focus: {focus['title']}\n{focus['instruction']}\n"
            "\n## Wire specification (WIRE-V0.md)\n" + spec)


def cmd_run(args):
    foci = json.loads((KIT / "briefs" / "foci.json").read_text())
    if args.focus:
        foci = [f for f in foci if f["id"] == args.focus]
        if not foci:
            raise SystemExit("unknown focus; see briefs/foci.json")
    suites = load_suites()
    run = new_run("llm")
    (run / "config.json").write_text(json.dumps({k: str(v) for k, v in CFG.items() if k not in ("key_file", "extra")}, indent=1))
    use_tools = CFG["use_tools"]
    if use_tools:
        print("tool-calling mode requested; falling back to jsonl on any malformed tool call")
    total_findings = 0
    for focus in foci:
        fx = suites.get(focus.get("fixture", ""), {}).get("fixture", {}) if focus.get("fixture") else {}
        target = make_target(fx)
        ctx = oracles.Context(fx)
        system = build_system(focus)
        opener = (focus.get("opener") or "Begin. Send one wire request.") + \
                 (" Fixture works available: " + ", ".join(list(fx.get("works", {}))[:30]) if fx.get("works") else "")
        history = [{"role": "user", "content": opener}]
        sent = []
        print(f"== focus {focus['id']} ({args.steps} steps) on {target.name}")
        bad_turns = 0
        for step in range(1, args.steps + 1):
            msgs, dropped = budgeted(system, history)
            resp_llm = chat(msgs, tools=[WIRE_TOOL] if use_tools else None)
            text, raw = _content(resp_llm)
            calls = raw.get("tool_calls") or []
            obj, call_id = None, None
            if calls:
                try:
                    obj = json.loads(calls[0]["function"]["arguments"]).get("request")
                    call_id = calls[0]["id"]
                except (ValueError, KeyError, AttributeError):
                    obj = None
            if obj is None:
                obj = first_json_object(text)
            with (run / "transcript.jsonl").open("a") as f:
                f.write(json.dumps({"focus": focus["id"], "step": step, "dropped": dropped, "assistant": text[:4000],
                                    "usage": resp_llm.get("usage")}) + "\n")
            if not isinstance(obj, dict):
                bad_turns += 1
                history.append({"role": "assistant", "content": text[:2000] or "(empty)"})
                history.append({"role": "user", "content": "Reply with ONE JSON object only: a wire request with an 'op', "
                                                           'or {"finding": "..."} or {"done": true}.'})
                if bad_turns >= 5:
                    print("  model keeps replying without a JSON object; ending this focus")
                    break
                continue
            if obj.get("done"):
                break
            if "finding" in obj or "note" in obj:
                with (run / "llm_claims.jsonl").open("a") as f:
                    f.write(json.dumps({"focus": focus["id"], "step": step, "claim": obj, "sent_so_far": sent[-6:]}) + "\n")
                history += [{"role": "assistant", "content": json.dumps(obj)[:1500]},
                            {"role": "user", "content": "Noted. Keep going with the next request."}]
                continue
            req = obj.get("request") if isinstance(obj.get("request"), dict) and "op" not in obj else obj
            resp = safe_handle(target, req)
            viol = referee(target, req, resp, ctx)
            sent.append(req)
            for v in viol:
                total_findings += 1
                rec = {"source": f"llm:{focus['id']}:{step}", "target": target.name, "fixture": focus.get("fixture"),
                       "sequence": sent[:], "request": req, "response": resp, "violation": v}
                with (run / "findings.jsonl").open("a") as f:
                    f.write(json.dumps(rec) + "\n")
            shown = json.dumps(resp)
            shown = shown if len(shown) < 6000 else shown[:6000] + "…[clipped]"
            if viol:
                shown += "\n[referee] " + ", ".join(sorted({v["oracle"] for v in viol}))
            history.append({"role": "assistant", "content": json.dumps(req)[:3000]})
            history.append({"role": "tool" if call_id else "user", "content": shown, **({"tool_call_id": call_id} if call_id else {})})
            if call_id:  # tool turns need the assistant tool_call message form; keep it simple and plain
                history[-1] = {"role": "user", "content": shown}
        target.close()
    print(f"run saved to {run}; {total_findings} violation record(s)")
    write_report(run)
    return 0


# --------------------------------------------------------------------------- report
def write_report(run):
    run = Path(run)
    fp = run / "findings.jsonl"
    recs = [json.loads(l) for l in fp.read_text().splitlines()] if fp.exists() else []
    groups = {}
    for r in recs:
        v = r["violation"]
        key = (v["oracle"], r["request"].get("op") if isinstance(r["request"], dict) else "?",
               re.sub(r"[\d.]+|'[^']*'|\"[^\"]*\"", "#", v["detail"])[:55])
        groups.setdefault(key, []).append(r)
    lines = [f"# Battle-test findings: {run.name}", "",
             f"{len(recs)} violation record(s) in {len(groups)} distinct group(s). Target: "
             f"{recs[0]['target'] if recs else CFG['target']}.", "",
             "Severity `fail` means a deterministic oracle saw it; `review` means a human should confirm. "
             "A pass is \"no counter-example found\", never a proof.", ""]
    for (oid, op, _), rs in sorted(groups.items()):
        v = rs[0]["violation"]
        lines += [f"## {oid} `{op}` ({v['severity']}, seen {len(rs)}x)", "", f"**Rule:** {v['rule']}", "",
                  f"**What happened:** {v['detail']}", "", "**Reproduce:** on a fresh target"
                  + (f" seeded with the `{rs[0]['fixture']}` fixture" if rs[0].get("fixture") else "") + ", send in order:", "", "```json"]
        steps = rs[0].get("sequence") or (rs[0].get("setup", []) + [rs[0]["request"]])
        lines += [json.dumps(s) for s in steps]
        lines += ["```", "", "**Got:**", "", "```json", json.dumps(rs[0]["response"], indent=1)[:1500], "```", ""]
    (run / "findings.md").write_text("\n".join(lines))
    print(f"report: {run / 'findings.md'}")


def cmd_report(args):
    runs = sorted(CFG["out"].glob("*-*"))
    run = Path(args.run) if args.run else (runs[-1] if runs else None)
    if not run:
        raise SystemExit("no run directory yet")
    write_report(run)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("selftest").set_defaults(fn=cmd_selftest)
    p = sub.add_parser("fuzz"); p.add_argument("--seed", type=int, default=1); p.add_argument("--suite", nargs="*", help="only these vector files, e.g. payments hardening"); p.set_defaults(fn=cmd_fuzz)
    sub.add_parser("probe").set_defaults(fn=cmd_probe)
    p = sub.add_parser("run"); p.add_argument("--focus"); p.add_argument("--steps", type=int, default=40); p.set_defaults(fn=cmd_run)
    p = sub.add_parser("report"); p.add_argument("run", nargs="?"); p.set_defaults(fn=cmd_report)
    a = ap.parse_args(argv)
    try:
        return a.fn(a)
    except LLMError as e:
        print(f"LLM endpoint problem: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
