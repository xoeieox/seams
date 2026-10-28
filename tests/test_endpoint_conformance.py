"""Endpoint-surface CONFORMANCE gates for the EoM node-one packet (eom-node-one leg, 2026-10-26).

Where the sibling file (tests/test_seed_gates.py) certifies the packet - manifest,
vectors, scrub - this file certifies the join itself: a packet instance CHECKING a
node it wants to join. Every assertion is derived from the endpoint-surface
requirements (eom/endpoint-surface/requirements.yaml): the REQ tables
(REQ-HELLO-1..4, REQ-EMIT-1..9, REQ-EXPORT-1..5), the join-gate accept set, the
refuse table and the rate policy, plus the observable posture of the
host/exposure ruling (loopback bind, forwarded headers never read, admin-token
custody, export public by ruling). The packet asserts; a target node must
satisfy - mechanically, in the same runner as the seed gates.

The target is the node-one server spawned the way a joining packet meets it:
loopback, ephemeral port, throwaway data dir (PORT=0, BIND_HOST=127.0.0.1,
DATA_DIR=<tmp>) - spawn, assert, kill, ps-verify clean, the same discipline the
smoke run used. LOCAL/LOOPBACK ONLY: every request this suite makes goes to a
127.0.0.1 port this suite spawned itself; nothing external is contacted, and
the server is never asked to bind anything else. The over-long-body refusal
(too_big) may present as a connection abort rather than a 413 - the server
destroys the hostile socket the moment it passes the cap; the fail-closed
assertion here is therefore "never accepted, never deposited, server stays
healthy", which is what a joining packet can actually observe.

The conformance-matrix test at the end of this file checks that every REQ id and
every named policy key parsed out of requirements.yaml is exercised by at least
one tagged test, so the suite cannot silently drift from the spec; a spec edit
that drops a REQ line makes the table test fail here, not quietly pass.
"""

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

sys.dont_write_bytecode = True
_CACHE_DIR = Path(__file__).resolve().parent / "__pycache__"
if _CACHE_DIR.is_dir():
    shutil.rmtree(_CACHE_DIR, ignore_errors=True)

REPO = Path(__file__).resolve().parent.parent
SERVER = REPO / "eom" / "node-one" / "attributed-text" / "server.mjs"
REQS_FILE = REPO / "eom" / "endpoint-surface" / "requirements.yaml"

REQS_TEXT = REQS_FILE.read_text()
WIRE = re.search(r"^wire:\s*(\S+)\s*$", REQS_TEXT, re.M).group(1)
FORMAT_ID = re.search(r"^format:\s*(\S+)\s*$", REQS_TEXT, re.M).group(1)
SPEC_REQ_IDS = set(re.findall(r"id:\s*(REQ-[A-Z]+-\d+)", REQS_TEXT))
_accept_m = re.search(r"accept_kinds:\s*\[([^\]]+)\]", REQS_TEXT)
assert _accept_m, "join_gate.accept_kinds missing from requirements.yaml"
ACCEPT_KINDS = [k.strip() for k in _accept_m.group(1).split(",")]
_pm = REQS_TEXT.split("payload_mapping:", 1)[1].split("refuse:", 1)[0]
MAP_TEXT = re.search(r"^\s+text:\s+(\S+)", _pm, re.M).group(1)
MAP_PAGE = re.search(r"^\s+page:\s+(\S+)", _pm, re.M).group(1)
_refuse_block = REQS_TEXT.split("\n  refuse:", 1)[1].split("\n  rate:", 1)[0]
SPEC_REFUSALS = {}
for _mcode, _mstatus in re.findall(r"([a-z_]{3,})[ ,]+(\d{3})", _refuse_block):
    SPEC_REFUSALS.setdefault(_mcode, int(_mstatus))
_defaults_line = re.search(r"defaults:\s*\{([^}]+)\}", REQS_TEXT).group(1)
RATE_DEFAULTS = {k: int(v) for k, v in re.findall(r"(\w+):\s*(\d+)", _defaults_line)}
ADMIN_MEASURED = int(re.search(r"admin (\d+) attempts", REQS_TEXT).group(1))

IPV4_RE = re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b")
HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")

# The named policy keys this suite checks beyond the REQ tables: join-gate
# accept side, rate policy, and the observable half of the host/exposure
# ruling. The matrix test below requires each to be exercised.
EXPECTED_POLICY_KEYS = {
    "spec.tables", "spec.matrix", "gate.accept_set",
    "rate.burn_policy", "rate.socket_key", "rate.reads_budgeted",
    "rate.admin_up_front", "rate.defaults_match",
    "posture.loopback_bind", "posture.admin_token_hygiene", "posture.headers_unread",
    "export.public",
}

MATRIX = {}


def req(*keys):
    """Tag a test with the requirement/policy keys it mechanically checks."""
    def deco(fn):
        for k in keys:
            MATRIX.setdefault(k, []).append(fn.__name__)
        return fn
    return deco


# ---------------------------------------------------------------------------
# HTTP + target-node harness (stdlib only; loopback only)
#
# _http returns (status, headers, raw_bytes). jget/jpost parse the body to a
# dict and are the ergonomic entry point; _http is used directly where the raw
# bytes are what is asserted (byte-for-byte replay stability, token/IP absence,
# the oversize-body abort).
# ---------------------------------------------------------------------------

def _http(method, base, path, body=None, headers=None, timeout=15):
    hdrs = {k.lower(): v for k, v in (headers or {}).items()}
    if body is not None and "content-type" not in hdrs:
        hdrs["content-type"] = "application/json"
    rq = urllib.request.Request(base + path, data=body, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(rq, timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def _parse(raw):
    return raw if isinstance(raw, dict) else json.loads(raw)


def jget(base, path, headers=None):
    st, hd, raw = _http("GET", base, path, headers=headers)
    return st, hd, _parse(raw)


def jpost(base, path, obj, headers=None):
    st, hd, raw = _http("POST", base, path, body=json.dumps(obj).encode("utf-8"), headers=headers)
    return st, hd, _parse(raw)


def emit_payload(**over):
    body = {"op": "emit", "kind": "session-log", "node_key": "key:probe-a",
            "text": "a sentence nobody else will emit " + uuid.uuid4().hex[:10]}
    body.update(over)
    return body


def uniq(tag="probe"):
    return f"{tag} {uuid.uuid4().hex[:10]}"


_TARGETS = []


class TargetNode:
    """A node-one server as a joining packet meets it: loopback, ephemeral
    port, throwaway data dir. stop() = SIGKILL + wait + ps-verify clean."""

    def __init__(self, env=None):
        self.dir = tempfile.mkdtemp(prefix="eom-conformance-")
        self.env_over = dict(env or {})
        self.proc = None
        self.base = None
        self.port = None
        self._lines = []
        _TARGETS.append(self)

    def start(self):
        assert self.proc is None, "restart must go through stop() first"
        env = dict(os.environ, BIND_HOST="127.0.0.1", PORT="0", DATA_DIR=self.dir)
        env.pop("ADMIN_TOKEN", None)
        env.update(self.env_over)
        self._lines = []
        self.proc = subprocess.Popen(
            [shutil.which("node") or "node", str(SERVER)], cwd=str(SERVER.parent), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        threading.Thread(target=self._pump, args=(self.proc,), daemon=True).start()
        deadline = time.time() + 15
        while time.time() < deadline:
            for line in self._lines:
                m = re.search(r"listening on http://([\d.]+):(\d+)", line)
                if m:
                    assert m.group(1) == "127.0.0.1", f"the node bound somewhere other than loopback: {line.strip()}"
                    self.port = int(m.group(2))
                    self.base = "http://127.0.0.1:%d" % self.port
                    return self
            time.sleep(0.02)
        raise AssertionError("target did not bind within 15s; stdout: " + "".join(self._lines))

    def _pump(self, proc):
        for line in proc.stdout:
            self._lines.append(line)

    def stdout_text(self):
        deadline = time.time() + 1.0
        while len(self._lines) < 2 and time.time() < deadline:
            time.sleep(0.02)
        return "".join(self._lines)

    def stop(self):
        if self.proc is None:
            return
        if self.proc.poll() is None:
            self.proc.kill()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                raise AssertionError("target survived SIGKILL")
        assert not Path("/proc", str(self.proc.pid)).exists(), "ps-verify: target pid still present after kill"
        self.proc = None          # so a later start() (same dir) passes the guard

    def restart(self):
        self.stop()
        return self.start()

    def file(self, name):
        return Path(self.dir, name)

    def log_lines(self):
        return [l for l in self.file("log.jsonl").read_text().split("\n") if l.strip()]


def _ps_sweep():
    """ps-verify clean: after a run, no CONFORMANCE TARGET is left alive.
    Distinguishing rule (go-public 2026-10-28): a conformance target is a node-one whose
    DATA_DIR is a harness temp prefix (TargetNode's eom-conformance-, the raw-boot rail
    test's eom-rail-, the send-hello selftest's sendhello-*). The production trio runs
    on its persistent data dir and is NOT a conformance target - matching bare command
    lines used to false-positive on the live node (keeper sweep hygiene). A matching
    process whose environ we cannot read is treated as a target (fail closed)."""
    out = subprocess.run(["ps", "-eo", "pid=,args="], capture_output=True, text=True, timeout=20).stdout
    for line in out.splitlines():
        if "server.mjs" not in line or "attributed-text" not in line:
            continue
        pid = line.strip().split(None, 1)[0]
        try:
            env = Path("/proc", pid, "environ").read_bytes().decode("utf-8", "replace")
        except OSError:
            if Path("/proc", pid).exists():
                raise AssertionError("ps-verify: unverifiable node-one process survived: " + line.strip())
            continue
        import re as _re
        m = _re.search(r"DATA_DIR=([^\x00]*)\x00", env + "\x00")
        dd = (m.group(1) if m else "")
        base = dd.rsplit("/", 1)[-1]
        if base.startswith(("eom-conformance-", "eom-rail-", "sendhello-st-", "sendhello-f4-")):
            raise AssertionError("ps-verify: a conformance target survived the run: " + line.strip())


def teardown_module():
    for t in _TARGETS:
        t.stop()
        shutil.rmtree(t.dir, ignore_errors=True)
    _ps_sweep()


_SHARED = {"node": None}


def shared_server():
    if _SHARED["node"] is None:
        # The shared target carries the whole module's traffic on one socket, so its
        # per-socket write budget is a MODULE budget, not a test subject. The published
        # shape (10/10/300/1500) is enforced-and-asserted elsewhere: this suite's own
        # rate.reads_budgeted test boots a DEFAULT TargetNode (no overrides, published
        # shape, red-on-old-green-on-new) plus a knob-pinned one; eom.test.mjs runs the
        # read tier red/green; send-hello --selftest re-checks all of it. Here we only
        # need semantics un-starved by cumulative module traffic.
        _SHARED["node"] = TargetNode(env={"INGEST_LIMIT": "1000", "EDIT_LIMIT": "1000", "GLOBAL_LIMIT": "10000", "READ_LIMIT": "0", "READ_GLOBAL_LIMIT": "0"}).start()
    return _SHARED["node"]


def stt_head_text(stt):
    return "".join(seg[0] for seg in stt["segs"])


def tampered_target(**env):
    """Deposit an emit, kill, flip a word inside the persisted bytes, respawn:
    the T5a state - a tampered log a peer must discover BEFORE emitting."""
    t = TargetNode(env=env).start()
    st, _, r = jpost(t.base, "/api/ingest", emit_payload(text="witness line " + uuid.uuid4().hex[:8]))
    assert st == 200 and r["status"] == "deposited"
    t.stop()
    lines = t.file("log.jsonl").read_text().split("\n")
    hit = False
    for i, line in enumerate(lines):
        if line.strip():
            e = json.loads(line)
            if e.get("kind") == "ingest":
                e["segs"][0][0] = " HIJACKED "
                lines[i] = json.dumps(e)
                hit = True
                break
    assert hit, "tamper helper found no ingest entry"
    t.file("log.jsonl").write_text("\n".join(lines))
    t.start()
    return t


# ---------------------------------------------------------------------------
# spec binding: the tables this suite is conformance TO must be intact
# ---------------------------------------------------------------------------

@req("spec.tables")
def test_requirements_tables_intact():
    assert SPEC_REQ_IDS == {
        f"REQ-HELLO-{i}" for i in range(1, 5)
    } | {f"REQ-EMIT-{i}" for i in range(1, 10)} | {f"REQ-EXPORT-{i}" for i in range(1, 6)} \
        | {f"REQ-SIGN-{i}" for i in range(1, 8)} | {f"REQ-DEP-{i}" for i in range(1, 4)}, SPEC_REQ_IDS   # KEYS pass 2026-10-28: signing + deposits-view rules enter the pinned table; fix wave 2026-10-28 (C2 close): REQ-SIGN-7 reader-side export bytes
    assert SPEC_REFUSALS == {
        "unknown_kind": 400, "unknown_op": 400, "bad_node_key": 400,
        "consent_gate_unbuilt": 501, "parents_on_original": 400, "bad_origin": 400,
        "already_deposited": 409, "empty": 400, "too_long": 413, "too_big": 413,
        "bad_content": 400, "bad_signature": 400,                      # REQ-SIGN-3: refused AT THE GATE
    }, SPEC_REFUSALS
    assert ACCEPT_KINDS == ["node-key", "session-log"]
    assert (MAP_TEXT, MAP_PAGE) == ("session-log", "session-log")
    assert RATE_DEFAULTS == {"edit_limit": 10, "ingest_limit": 10, "global_limit": 80,
                             "read_limit": 300, "read_global_limit": 1500, "window_ms": 600000}
    assert ADMIN_MEASURED == 10
    assert "host_exposure_ruling" in REQS_TEXT and "ruled_by: Erah" in REQS_TEXT


# ---------------------------------------------------------------------------
# hello - the join handshake (REQ-HELLO-1..4)
# ---------------------------------------------------------------------------

@req("REQ-HELLO-1")
def test_hello_echoes_the_wire_version_the_node_actually_speaks():
    st, _, hello = jget(shared_server().base, "/api/hello")
    assert st == 200 and hello["ok"] is True
    assert hello["wire"] == WIRE, "a client pins this and refuses to speak past a version skew (A3)"


@req("REQ-HELLO-2")
def test_hello_advertises_the_closed_kind_gate_exactly():
    _, _, hello = jget(shared_server().base, "/api/hello")
    assert hello["format"] == FORMAT_ID
    gate = hello["gate"]
    assert gate["kinds"] == ACCEPT_KINDS, "accept set advertised != accept set ruled"
    assert gate["maps"] == {"text": MAP_TEXT, "page": MAP_PAGE}, "the ruling-mapping must be advertised, not assumed"
    ou = gate["on_unknown"]
    assert "refuse" in ou and "unknown_kind" in ou and "never" in ou, ou
    assert hello["limits"]["max_text"] == 8000 and hello["limits"]["max_body_bytes"] == 65536, \
        "the content bounds must be advertised before a peer emits"


@req("REQ-HELLO-3")
def test_hello_is_open_uncharged_and_leaks_nothing():
    t = shared_server()
    tok = t.file("admin-token.txt").read_text().strip()
    for _ in range(40):
        st, _, raw = _http("GET", t.base, "/api/hello")
        assert st == 200, "hello is unauthenticated and carries no rate bucket - an uncharged read"
        text = raw.decode("utf-8")
        assert tok not in text, "REQ-HELLO-3: no token material on the handshake"
        assert t.dir not in text, "REQ-HELLO-3: no operator file paths on the handshake"
        assert "://" not in text, "REQ-HELLO-3: no URLs to follow"
        assert not IPV4_RE.search(text), "REQ-HELLO-3: no IP addresses on the handshake"


@req("REQ-HELLO-4")
def test_hello_reports_integrity_ok_on_a_healthy_log():
    _, _, hello = jget(shared_server().base, "/api/hello")
    assert hello["integrity"] == "ok"


@req("REQ-HELLO-4")
def test_hello_says_QUARANTINED_before_a_peer_emits_into_a_tampered_log():
    t = tampered_target()
    try:
        _, _, hello = jget(t.base, "/api/hello")
        assert hello["integrity"] != "ok" and "QUARANTINED" in hello["integrity"], \
            "a peer must never discover a corrupted log by emitting into it"
    finally:
        t.stop()


# ---------------------------------------------------------------------------
# emit - the join gate (REQ-EMIT-1..9)
# ---------------------------------------------------------------------------

@req("REQ-EMIT-1", "gate.accept_set")
def test_accept_side_closed_set_and_ruling_mapping():
    t = shared_server()
    st, _, ann = jpost(t.base, "/api/ingest", {
        "op": "emit", "kind": "node-key", "node_key": "key:probe-accept",
        "provenance": {"attributed_to": {"name": "Accept Probe"}}})
    assert st == 200 and ann["status"] == "deposited" and ann["kind"] == "node-key"
    for kind in ("text", "page"):
        st, _, r = jpost(t.base, "/api/ingest", emit_payload(kind=kind, text=uniq(kind)))
        assert st == 200 and r["status"] == "deposited"
        assert r["kind"] == MAP_TEXT, f"kind {kind!r} must map to {MAP_TEXT} AT the gate"
    st, _, r = jpost(t.base, "/api/ingest", emit_payload(kind="session-log", text=uniq("direct")))
    assert st == 200 and r["kind"] == "session-log"
    pageish = emit_payload(text=uniq("pageless"))
    del pageish["kind"]                       # a text-bearing payload with no kind IS the page case
    st, _, r = jpost(t.base, "/api/ingest", pageish)
    assert st == 200 and r["kind"] == "session-log"


@req("REQ-EMIT-1", "REQ-EMIT-5", "REQ-EMIT-6", "REQ-EMIT-7", "REQ-EMIT-8", "REQ-EMIT-9")
def test_emit_refusal_table_every_named_refusal_actually_fires():
    """Each refusal the requirements name must fire at the wire level with its
    code and status - fail closed, nothing defaulted, nothing deposited - and
    every one of those responses still echoes wire (REQ-EMIT-9)."""
    t = shared_server()
    n0 = len(t.log_lines())
    setups = 0                                   # legitimate deposits the probes themselves require
    for code, want_status in sorted(SPEC_REFUSALS.items()):
        u = "refusal probe bytes " + uuid.uuid4().hex[:10]
        if code == "already_deposited":          # the same bytes deposited by ANOTHER key first
            st, _, first = jpost(t.base, "/api/ingest", emit_payload(text=u, node_key="key:probe-a"))
            assert st == 200 and first["status"] == "deposited", first
            setups += 1
            payload = emit_payload(text=u, node_key="key:probe-b")
        elif code == "empty":
            payload = emit_payload(text="   \n  ")
        elif code == "too_long":
            payload = emit_payload(text="x" * 8001)
        elif code == "bad_content":
            payload = emit_payload(content_b64="!!!not-base64!!!")
        elif code == "too_big":
            payload = None                       # raw oversize body sent below
        else:
            payload = emit_payload(text=u)
        if code == "unknown_kind":
            payload = {**payload, "kind": "character"}
        elif code == "unknown_op":
            payload = {**payload, "op": "record"}
        elif code == "bad_node_key":
            payload["node_key"] = "key:!!"
        elif code == "bad_signature":               # KEYS pass (REQ-SIGN-3): present-but-garbage sig, refused AT THE GATE
            payload["node_key"] = "key:ed25519:" + "A" * 43 + "="
            payload["sig"] = "not-base64!!"
        elif code == "consent_gate_unbuilt":
            payload["derivation"] = "fork"
        elif code == "parents_on_original":
            payload["parents"] = ["sha256:" + "a" * 64]
        elif code == "bad_origin":
            payload["provenance"] = {"origin": "borrowed"}
        if code == "too_big":
            big = json.dumps(emit_payload(text="x" * 70000)).encode("utf-8")
            try:
                st, hd, raw = _http("POST", t.base, "/api/ingest", body=big)
            except Exception:
                st, hd, raw = None, {}, b""      # server destroyed the hostile socket
            if st is None:                        # fail-closed via connection abort
                continue
            assert st == want_status, (code, st, raw)
        else:
            st, hd, raw = jpost(t.base, "/api/ingest", payload)
        assert st == want_status, (code, st, raw)
        body = _parse(raw)
        assert body["error"] == code, (code, body)
        assert body.get("wire") == WIRE, f"REQ-EMIT-9: refusal {code} did not echo wire: {body}"
    assert len(t.log_lines()) == n0 + setups, "refusals must deposit NOTHING"
    st, _, _ = _http("GET", t.base, "/api/hello")
    assert st == 200, "the server stays healthy after the whole refusal barrage"


@req("REQ-EMIT-1")
def test_unknown_kind_shapes_refused_fail_closed_nothing_defaulted():
    t = TargetNode().start()
    try:
        n0 = len(t.log_lines())
        shapes = [
            emit_payload(kind="character", text=uniq()),
            emit_payload(kind="text/html", text=uniq()),            # transport-flavored kind
            emit_payload(kind="content-type", text=uniq()),         # header-named kind
            emit_payload(kind="text", headers={"content-type": "text/html"}, text=uniq()),  # text-WITH-HEADER
            {"op": "emit", "node_key": "key:probe-a"},              # no kind, no payload: not page-shaped
        ]
        for b in shapes:
            st, _, body = jpost(t.base, "/api/ingest", b)
            assert st == 400 and body["error"] == "unknown_kind", (b.get("kind"), body)
        assert len(t.log_lines()) == n0, "refused shapes deposit nothing"
    finally:
        t.stop()


@req("REQ-EMIT-2")
def test_replay_acks_the_original_receipt_byte_identically_across_a_restart():
    t = shared_server()
    body = emit_payload(text="the replayed sentence " + uuid.uuid4().hex[:8])
    st, _, r1 = jpost(t.base, "/api/ingest", body)
    assert st == 200 and r1["status"] == "deposited" and r1["duplicate"] is False
    n0 = len(t.log_lines())
    st, _, r2 = jpost(t.base, "/api/ingest", json.loads(json.dumps(body)))
    assert st == 200 and r2["duplicate"] is True
    strip = lambda r: json.dumps({k: v for k, v in r.items() if k != "duplicate"}, sort_keys=True)
    assert strip(r2) == strip(r1), "replay receipt must be byte-identical to the ORIGINAL"
    assert len(t.log_lines()) == n0, "a replay grows nothing"
    t.restart()   # REQ-EMIT-2: across restarts too - the receipts sidecar is authoritative
    st, _, r3 = jpost(t.base, "/api/ingest", json.loads(json.dumps(body)))
    assert st == 200 and r3["duplicate"] is True and strip(r3) == strip(r1), "idempotence must survive a restart"
    assert len(t.log_lines()) == n0, "the log stayed flat across the restart"


@req("REQ-EMIT-3", "REQ-EXPORT-5")
def test_receipt_hashes_opaque_computed_once_never_rehashed_on_read():
    t = shared_server()
    _, _, r = jpost(t.base, "/api/ingest", emit_payload(text="hashed once at append " + uuid.uuid4().hex[:8]))
    for f in ("payload_hash", "content_hash", "deposit_hash"):
        assert HASH_RE.match(r.get(f, "")), (f, r.get(f))
    st1, _, raw1 = _http("GET", t.base, "/api/export")
    st2, _, raw2 = _http("GET", t.base, "/api/export")
    assert st1 == st2 == 200 and raw1 == raw2, "identical reads: the server re-hashes nothing at serve time"
    x = _parse(raw1)
    entry = [e for e in x["entries"] if e["v"] == r["v"]][-1]
    assert entry["content_hash"] == r["content_hash"] and entry["deposit_hash"] == r["deposit_hash"], \
        "served hashes == hashes persisted at append (no hash laundering)"
    assert entry["provenance"]["payload_hash"] == r["payload_hash"]


@req("REQ-EMIT-4")
def test_node_key_well_formed_required_and_the_registry_holds_no_ips():
    t = TargetNode().start()
    try:
        for bad in ("key:!!", "key:a", "key:", "not-a-key", "key:ab!"):
            st, _, body = jpost(t.base, "/api/ingest", emit_payload(node_key=bad, text=uniq()))
            assert st == 400 and body["error"] == "bad_node_key", (bad, body)
        st, _, ann = jpost(t.base, "/api/ingest", {
            "op": "emit", "kind": "node-key", "node_key": "key:probe-reg",
            "provenance": {"attributed_to": {"name": "Reg Probe"}}})
        assert st == 200 and ann["status"] == "deposited"
        _, _, stt = jget(t.base, "/api/state")
        _, _, x = jget(t.base, "/api/export")
        reg = [n for n in x["nodes"] if n["node_key"] == "key:probe-reg"]
        assert reg, "announce must register the key"
        assert set(reg[0]) == {"node_key", "who", "first_seen", "seen", "verified", "node_key_fingerprint"}, reg[0]
        assert reg[0]["verified"] is False, "a ref-key announce registers as a claim; verified comes only from a verified Ed25519 sig (REQ-SIGN-4)"
        assert reg[0]["node_key_fingerprint"] is None, "REQ-SIGN-5: fingerprint is null for non-ed25519 keys"
        assert reg[0]["who"] == "Reg Probe"
        assert not IPV4_RE.search(json.dumps(reg)), "REQ-EMIT-4: the registry stores no IPs, ever"
        assert not IPV4_RE.search(json.dumps(stt)), "REQ-EMIT-4: the public state exposes no IPs"
        disk = t.file("nodes.jsonl").read_text()
        assert "key:probe-reg" in disk and not IPV4_RE.search(disk), "REQ-EMIT-4: on-disk registry, no IPs"
    finally:
        t.stop()


@req("REQ-EMIT-6")
def test_origin_gate_accepts_the_ruled_set_refuses_the_rest():
    t = shared_server()
    for origin in ("authored", "assisted", "played"):
        st, _, r = jpost(t.base, "/api/ingest",
                         emit_payload(text=uniq("origin-" + origin), provenance={"origin": origin}))
        assert st == 200 and r["status"] == "deposited", (origin, r)
    _, _, x = jget(t.base, "/api/export")
    for origin in ("authored", "assisted", "played"):
        assert any(e.get("provenance", {}).get("declared_origin") == origin for e in x["entries"]), \
            f"REQ-EMIT-6: {origin} must be accepted and honestly labeled in the export"
    st, _, body = jpost(t.base, "/api/ingest", emit_payload(text=uniq("bad-origin"), provenance={"origin": "borrowed"}))
    assert st == 400 and body["error"] == "bad_origin"


@req("REQ-EMIT-7")
def test_identity_squatting_refused_original_attribution_holds():
    t = TargetNode().start()
    try:
        text = "contested bytes " + uuid.uuid4().hex[:8]
        st, _, r = jpost(t.base, "/api/ingest", emit_payload(node_key="key:probe-a", text=text))
        assert st == 200 and r["status"] == "deposited"
        st, _, body = jpost(t.base, "/api/ingest", emit_payload(node_key="key:probe-b", text=text))
        assert st == 409 and body["error"] == "already_deposited"
        _, _, x = jget(t.base, "/api/export")
        entry = [e for e in x["entries"] if e.get("text") == text][-1]
        assert entry["creator_ref"] == "key:probe-a", "squatting never re-attributes the work"
    finally:
        t.stop()


@req("REQ-EMIT-8")
def test_content_bounds_enforced_at_the_advertised_limits():
    t = shared_server()
    st, _, r = jpost(t.base, "/api/ingest", emit_payload(text="y" * 8000))
    assert st == 200 and r["status"] == "deposited", "the advertised max is the max - AT the bound"
    st, _, body = jpost(t.base, "/api/ingest", emit_payload(text="y" * 8001))
    assert st == 413 and body["error"] == "too_long"
    st, _, body = jpost(t.base, "/api/ingest", emit_payload(text=" "))
    assert st == 400 and body["error"] == "empty", "empty-after-clean refused"


@req("REQ-EMIT-9")
def test_wire_echoed_on_successes_on_gate_refusals_and_on_the_rate_ceiling():
    t = TargetNode(env={"INGEST_LIMIT": "2", "GLOBAL_LIMIT": "500"}).start()
    try:
        st, _, ok = jpost(t.base, "/api/ingest", emit_payload(text=uniq("echo-deposit")))
        assert st == 200 and ok["wire"] == WIRE
        st, _, bad = jpost(t.base, "/api/ingest", emit_payload(kind="character", text=uniq("echo-refuse")))
        assert st == 400 and bad["wire"] == WIRE, "REQ-EMIT-9: a refused emit still speaks its version (A3)"
        st, _, ok2 = jpost(t.base, "/api/ingest", emit_payload(text=uniq("echo-deposit-2")))
        assert st == 200 and ok2["wire"] == WIRE, "the gate refusal burned no budget: the second deposit fits"
        st, hd, body = jpost(t.base, "/api/ingest", emit_payload(text=uniq("echo-limited")))
        assert st == 429, body
        assert body["error"] == "rate_limited" and body.get("wire") == WIRE
        assert hd.get("retry-after") and int(hd["retry-after"]) >= 1
    finally:
        t.stop()


# ---------------------------------------------------------------------------
# export - the wire-shaped log (REQ-EXPORT-1..5) + ruling: export is public
# ---------------------------------------------------------------------------

WIRE_ENTRY_FIELDS = {"op", "kind", "v", "ts", "content_hash", "deposit_hash",
                     "parents", "derivation", "creator_ref", "creator_verified", "provenance"}


def populated_export():
    """A fresh node that has met real traffic: announce + mapped emit + an edit
    (so a version chain exists) + a node-key emit; returns (target, export, headers, raw)."""
    t = TargetNode().start()
    st, _, ann = jpost(t.base, "/api/ingest", {
        "op": "emit", "kind": "node-key", "node_key": "key:probe-export",
        "provenance": {"attributed_to": {"name": "Export Probe"}}})
    assert st == 200 and ann["status"] == "deposited"
    st, _, r = jpost(t.base, "/api/ingest", emit_payload(node_key="key:probe-export", kind="text",
                                                         text="The seed page gains a deposited line " + uuid.uuid4().hex[:8]))
    assert st == 200 and r["kind"] == "session-log"
    _, _, stt = jget(t.base, "/api/state")
    st, _, ed = jpost(t.base, "/api/edit", {"name": "Examiner", "base_v": stt["v"],
                                            "text": stt_head_text(stt) + " amended by the examiner"})
    assert st == 200, ed
    st, hd, raw = _http("GET", t.base, "/api/export")          # NO auth header: public by ruling
    assert st == 200, raw
    return t, _parse(raw), hd, raw


@req("REQ-EXPORT-1")
def test_export_entries_are_wire_shaped_with_the_chain_state_alongside():
    t, x, hd, _ = populated_export()
    try:
        assert x["wire"] == WIRE and x["format"] == FORMAT_ID
        assert x["use_terms"]["allowed_uses"] and x["integrity"]["ok"] is True
        assert hd.get("content-disposition", "").startswith("attachment")
        assert x["entries"], "a populated log exports entries"
        for e in x["entries"]:
            missing = WIRE_ENTRY_FIELDS - set(e)
            assert not missing, f"REQ-EXPORT-1: wire fields missing {missing}"
            assert e["op"] == "emit" and e["kind"] == "session-log", "closed vocabulary survives the export"
            assert isinstance(e["chain"], dict) and set(e["chain"]) == {"n", "prev", "hash"}, \
                "REQ-EXPORT-1: hash-chain state rides ALONGSIDE the wire fields, in its own block"
            assert not (WIRE_ENTRY_FIELDS & set(e["chain"])), "chain state must not leak INTO the wire fields"
        for i in range(1, len(x["entries"])):
            assert x["entries"][i]["chain"]["prev"] == x["entries"][i - 1]["chain"]["hash"]
            assert x["entries"][i]["chain"]["n"] == x["entries"][i - 1]["chain"]["n"] + 1
    finally:
        t.stop()


@req("REQ-EXPORT-2")
def test_parents_are_always_empty_a_version_chain_is_not_a_derivation():
    t, x, _, _ = populated_export()   # this export CONTAINS an edit: the version chain is real
    try:
        kinds = [e["provenance"]["entry_kind"] for e in x["entries"]]
        assert "edit" in kinds and "ingest" in kinds, "fixture must carry a chain AND an ingest"
        for e in x["entries"]:
            assert e["parents"] == [], "REQ-EXPORT-2: parents are ALWAYS [] - ordering rides the chain block"
            assert e["derivation"] == "original", "fork/remix has no route through the gate, so none can appear"
    finally:
        t.stop()


@req("REQ-EXPORT-3")
def test_export_refuses_a_tampered_log_and_never_rehashes_it_clean():
    t = tampered_target()
    try:
        before = t.file("log.jsonl").read_bytes()
        st, _, body = jget(t.base, "/api/export")
        assert st == 503, "REQ-EXPORT-3: a quarantined log is never served"
        assert body["error"] == "log_integrity"
        assert body["tampered"], "the tampered versions are named"
        assert "entries" not in body, "a refused export serves NOTHING"
        st2, _, _ = jget(t.base, "/api/export")
        assert st2 == 503
        assert t.file("log.jsonl").read_bytes() == before, \
            "refusing must not launder the log: bytes on disk stay exactly as found (T5a)"
    finally:
        t.stop()


@req("REQ-EXPORT-3", "REQ-HELLO-4")
def test_anchor_rollback_quarantines_export_refuses_peer_sees_it_in_hello():
    t = TargetNode().start()
    st, _, r = jpost(t.base, "/api/ingest", emit_payload(text="anchor witness " + uuid.uuid4().hex[:8]))
    assert st == 200
    t.stop()
    t.file("chain-anchor.json").write_text(json.dumps(
        {"n": 1, "hash": "sha256:" + "b" * 64, "updated": "conformance-rollback-probe"}))
    t.start()
    try:
        st, _, body = jget(t.base, "/api/export")
        assert st == 503 and body["error"] == "log_integrity"
        _, _, hello = jget(t.base, "/api/hello")
        assert "QUARANTINED" in hello["integrity"], "REQ-HELLO-4: the anchor disagrees - a peer learns BEFORE emitting"
    finally:
        t.stop()


@req("REQ-EXPORT-4")
def test_corrupt_lines_quarantine_at_load_boot_survives_nothing_vanishes():
    t = TargetNode().start()
    st, _, r = jpost(t.base, "/api/ingest", emit_payload(text="healthy line " + uuid.uuid4().hex[:8]))
    assert st == 200
    t.stop()
    with t.file("log.jsonl").open("a") as f:
        f.write("not json at all {{{\n")
    t.start()   # A2 spirit: boot never crashes on a corrupt line
    try:
        st, _, hello = jget(t.base, "/api/hello")
        assert st == 200
        assert hello["integrity"] == "ok", "corruption alone must not falsify the chain verdict"
        q = t.file("quarantine.jsonl").read_text()
        recs = [json.loads(l) for l in q.split("\n") if l.strip()]
        assert any(rr.get("reason") == "corrupt_json" and "not json at all" in rr.get("raw", "") for rr in recs), \
            "REQ-EXPORT-4: the corrupt line goes to the audit trail, it never silently vanishes"
        _, _, x = jget(t.base, "/api/export")
        assert x["integrity"]["corrupt_lines"] == 1
    finally:
        t.stop()


@req("REQ-EXPORT-5", "export.public")
def test_export_honesty_labels_and_public_by_ruling():
    t, x, _, raw_plain = populated_export()   # fetched with NO auth header
    try:
        st, _, raw_bogus = _http("GET", t.base, "/api/export", headers={"authorization": "Bearer not-a-token"})
        assert raw_bogus == raw_plain, "export consults no token - the only refusal that stands is log_integrity"
        for e in x["entries"]:
            assert e["creator_verified"] is False, "REQ-EXPORT-5 + REQ-SIGN-4: every entry here is an unsigned or ref-keyed claim - the badge is machine-made at the gate, never from a typed name"
            for f in ("content_hash", "deposit_hash"):
                assert HASH_RE.match(e[f]), (f, e[f])
        for n in x["nodes"]:
            assert set(n) == {"node_key", "who", "first_seen", "seen", "verified", "node_key_fingerprint"} and not IPV4_RE.search(json.dumps(n))
            assert n["verified"] is False, "ref keys register as claims; verified=true only ever comes from a verified Ed25519 signature (REQ-SIGN-4)"
    finally:
        t.stop()


# ---------------------------------------------------------------------------
# rate policy (join_gate.rate): socket keying, peek/charge split, two tiers
# ---------------------------------------------------------------------------

@req("rate.burn_policy")
def test_refusals_and_replays_never_burn_budget_successes_charge():
    t = TargetNode(env={"INGEST_LIMIT": "3", "GLOBAL_LIMIT": "500"}).start()
    try:
        for _ in range(12):   # more refusals than the whole budget: none may consume it
            st, _, _ = jpost(t.base, "/api/ingest", emit_payload(kind="character", text=uniq("burn-refuse")))
            assert st == 400
        a = emit_payload(text=uniq("burn-a"))
        st, _, r = jpost(t.base, "/api/ingest", a)
        assert st == 200 and r["status"] == "deposited", r
        st, _, dup = jpost(t.base, "/api/ingest", json.loads(json.dumps(a)))
        assert st == 200 and dup["duplicate"] is True, "byte-identical replay acks the original receipt"
        for i in (1, 2):      # the FULL budget in successful deposits; a burned replay/refusal
            st, _, r = jpost(t.base, "/api/ingest", emit_payload(text=uniq("burn-ok-" + str(i))))
            assert st == 200 and r["status"] == "deposited", \
                (i, r, "successes alone must fit the window: twelve refusals and one replay burned nothing")
        st, hd, body = jpost(t.base, "/api/ingest", emit_payload(text=uniq("burn-over")))
        assert st == 429 and body["error"] == "rate_limited", \
            "the budget is spent by the successes - charges are real"
        assert hd.get("retry-after") and int(hd["retry-after"]) <= RATE_DEFAULTS["window_ms"] // 1000
        st, _, _ = jpost(t.base, "/api/ingest", a)
        assert st == 429, "the gate is fail-closed BEFORE parsing the body: an at-limit replay is refused unread"
    finally:
        t.stop()


@req("rate.socket_key", "posture.headers_unread")
def test_rate_key_is_the_socket_spoofed_forwarded_headers_cannot_reroute_it():
    t = TargetNode(env={"INGEST_LIMIT": "2", "GLOBAL_LIMIT": "500"}).start()
    try:
        h1 = {"cf-connecting-ip": "203.0.113.11", "x-forwarded-for": "198.51.100.21"}
        h2 = {"cf-connecting-ip": "203.0.113.22", "x-forwarded-for": "198.51.100.22"}
        st, _, _ = jpost(t.base, "/api/ingest", emit_payload(text=uniq("socket-a")), headers=h1)
        assert st == 200
        st, _, _ = jpost(t.base, "/api/ingest", emit_payload(text=uniq("socket-b")), headers=h2)
        assert st == 200
        st, _, body = jpost(t.base, "/api/ingest", emit_payload(text=uniq("socket-c")))
        assert st == 429, "headers claim different clients; one socket is one bucket - the headers were NEVER read (T1)"
        assert "203.0.113" not in json.dumps(body) and "198.51.100" not in json.dumps(body)
    finally:
        t.stop()


@req("rate.reads_budgeted")
def test_reads_charge_the_read_tier_only_writes_keep_their_own_budget():
    # F2 (keeper 2026-10-28): the published 300/1500 read tier is ENFORCED at origin by default.
    # The old code charged no read bucket at all (keeper measured 360 reads, 0x429) - red-on-old,
    # green-on-new is exactly this test.
    t = TargetNode().start()   # no env overrides: the DEFAULT (published) policy
    try:
        for _ in range(RATE_DEFAULTS["read_limit"]):
            assert _http("GET", t.base, "/api/hello")[0] == 200
        st, hd, body = _http("GET", t.base, "/api/hello")
        assert st == 429 and json.loads(body)["error"] == "rate_limited", \
            "the read tier is real: at published limit the ORIGIN itself answers 429 + retry-after"
        assert hd.get("retry-after") and int(hd["retry-after"]) <= RATE_DEFAULTS["window_ms"] // 1000
        for i in range(5):     # a spent read bucket never touches the write tier: same socket, full budget
            st, _, r = jpost(t.base, "/api/ingest", emit_payload(text=uniq("tier-ok-" + str(i))))
            assert st == 200 and r["status"] == "deposited", \
                "reads and writes are separate buckets - burning the read tier cannot mute writes"
    finally:
        t.stop()
    t2 = TargetNode(env={"READ_LIMIT": "3", "READ_GLOBAL_LIMIT": "0"}).start()
    try:
        for _ in range(25):    # peek/charge split mirrors the write tiers: error shapes burn nothing
            assert _http("GET", t2.base, "/nope-not-a-route")[0] == 404
        for _ in range(3):
            assert _http("GET", t2.base, "/api/export")[0] == 200
        st, _, body = _http("GET", t2.base, "/api/export")
        assert st == 429 and json.loads(body)["error"] == "rate_limited", \
            "after twenty-five 404s the budget is exactly 3/3 charged by the three successes only"
    finally:
        t2.stop()
    t3 = TargetNode(env={"READ_LIMIT": "0", "READ_GLOBAL_LIMIT": "0"}).start()
    try:  # loopback-dev escape: 0 on both read knobs disables the tier entirely
        for _ in range(40):
            assert _http("GET", t3.base, "/api/state")[0] == 200
    finally:
        t3.stop()


@req("rate.admin_up_front")
def test_admin_attempts_charge_up_front_failed_token_retries_are_the_attack_priced():
    t = TargetNode().start()
    try:
        for _ in range(ADMIN_MEASURED):
            st, _, _ = jpost(t.base, "/api/admin/revert", {"token": "definitely-wrong", "to_v": 1})
            assert st == 403
        st, _, body = jpost(t.base, "/api/admin/revert", {"token": "definitely-wrong", "to_v": 1})
        assert st == 429 and body["error"] == "rate_limited", \
            "every attempt charged - success or not - exactly as the ruling prices it"
    finally:
        t.stop()


@req("rate.defaults_match")
def test_default_budgets_match_the_requirements_table():
    t = TargetNode().start()   # unmodified defaults: what the requirements promise
    try:
        for i in range(RATE_DEFAULTS["ingest_limit"]):
            st, _, r = jpost(t.base, "/api/ingest", emit_payload(text=uniq("default-ingest-" + str(i))))
            assert st == 200 and r["status"] == "deposited", (i, r)
        st, _, body = jpost(t.base, "/api/ingest", emit_payload(text=uniq("default-ingest-over")))
        assert st == 429, body
        _, _, stt = jget(t.base, "/api/state")
        base_v, head = stt["v"], stt_head_text(stt)
        for i in range(RATE_DEFAULTS["edit_limit"]):
            st, _, ed = jpost(t.base, "/api/edit", {"name": "Default Tester", "base_v": base_v,
                                                    "text": head + f" edit {i} {uuid.uuid4().hex[:6]}"})
            assert st == 200, (i, ed)
            base_v = ed["saved_v"]
        st, _, body = jpost(t.base, "/api/edit", {"name": "Default Tester", "base_v": base_v,
                                                  "text": head + " one edit over " + uuid.uuid4().hex[:6]})
        assert st == 429, body
    finally:
        t.stop()


# ---------------------------------------------------------------------------
# host/exposure ruling - the observable half, local only
# ---------------------------------------------------------------------------

@req("posture.loopback_bind")
def test_the_node_listens_on_loopback_and_on_nothing_else():
    t = TargetNode().start()
    try:
        assert t.base is not None and t.base.startswith("http://127.0.0.1:")
        rows = []
        for f in ("/proc/net/tcp", "/proc/net/tcp6"):
            try:
                lines = Path(f).read_text().splitlines()[1:]
            except OSError:
                continue
            for line in lines:
                parts = line.split()
                if len(parts) < 4 or parts[3] != "0A":     # 0A == LISTEN
                    continue
                host_hex, port_hex = parts[1].split(":")[:2]
                if int(port_hex, 16) != t.port:
                    continue
                if f.endswith("tcp6"):
                    assert host_hex.lower() == "00000000000000000000000001000000", \
                        f"the node listens on a non-loopback v6 address: {host_hex}"
                else:
                    assert host_hex.upper() == "0100007F", \
                        f"the node listens on a non-loopback v4 address: {host_hex}"
                    rows.append(host_hex)
        assert rows, f"no loopback LISTEN socket found for port {t.port}"
    finally:
        t.stop()


@req("posture.admin_token_hygiene")
def test_admin_token_custody_never_printed_0600_never_in_a_response():
    t = shared_server()
    tf = t.file("admin-token.txt")
    tok = tf.read_text().strip()
    assert len(tok) >= 24
    assert os.stat(tf).st_mode & 0o777 == 0o600, "T2: token material is 0600, DATA_DIR only"
    assert tok not in t.stdout_text(), "T1: the token value never reaches stdout"
    for path in ("/api/hello", "/api/export"):
        _, _, raw = _http("GET", t.base, path)
        assert tok not in raw.decode("utf-8"), f"the token never appears in a data payload ({path})"
    _, _, body = jpost(t.base, "/api/ingest", emit_payload(text=uniq("custody-probe")))
    assert tok not in json.dumps(body)


# ---------------------------------------------------------------------------
# the F4 bind rail (keeper 2026-10-28): the loopback promise must be RAIL,
# not env default - a non-loopback BIND_HOST refuses to boot unless the
# operator names the escape hatch, and when they do the banner says PUBLIC
# BIND instead of claiming loopback. This is the conformance assertion of
# that rail (raw boot, no TargetNode - the rails sit around the bind).
# ---------------------------------------------------------------------------

def _spawn_node(env):
    full = dict(os.environ, PORT="0", DATA_DIR=tempfile.mkdtemp(prefix="eom-rail-"))
    full.pop("ADMIN_TOKEN", None)
    full.update(env)
    return subprocess.Popen(
        [shutil.which("node") or "node", str(SERVER)], cwd=str(SERVER.parent), env=full,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


@req("posture.loopback_bind")
def test_f4_bind_rail_nonloopboot_refused_unless_hatch_named_verbatim():
    node = _spawn_node({"BIND_HOST": "127.0.10.1"})          # non-loopback, no hatch: the keeper's case
    out, _ = node.communicate(timeout=15)
    assert node.returncode == 1, "F4: a non-loopback bind without the acknowledgement must not boot"
    assert "REFUSING TO BOOT" in out, out
    assert "SEAMS_ALLOW_PUBLIC_BIND=I-know-what-this-means" in out, \
        "the refusal must name the hatch and its exact required value"
    node2 = _spawn_node({"BIND_HOST": "127.0.10.1", "SEAMS_ALLOW_PUBLIC_BIND": "I-know-what-this-means"})
    try:
        line = node2.stdout.readline()
        assert "listening on http://127.0.10.1:" in line, line
        assert "PUBLIC BIND" in line, "the banner must announce the operator-acknowledged public bind"
        assert "loopback bind" not in line, "F4 honesty: the banner NEVER claims loopback when bound publicly"
    finally:
        node2.kill()
        node2.wait(timeout=5)


# ---------------------------------------------------------------------------
# KEYS pass (EOM-KEYS-2026-10-28): REQ-SIGN - real Ed25519 node keys, verified at the gate.
# Signing happens through a node subprocess importing the shipped keys.mjs itself, so the
# conformance suite checks the SAME canonicalization the gateway verifies against - if the
# two ever drift, this section goes red, not green.
# ---------------------------------------------------------------------------

KEYS_MJS = REPO / "eom" / "node-one" / "attributed-text" / "keys.mjs"


def _node_run(src, stdin=""):
    p = subprocess.run([shutil.which("node") or "node", "--input-type=module", "-e", src, str(KEYS_MJS)],
                       input=stdin, capture_output=True, text=True, timeout=20)
    assert p.returncode == 0, p.stderr
    return p.stdout


def keys_mint():
    out = _node_run("import {pathToFileURL} from 'node:url';"
                    "const K = await import(pathToFileURL(process.argv[1]).href);"
                    "process.stdout.write(JSON.stringify(K.generateKeyPair()));")
    return json.loads(out)                        # {nodeKey, pubB64, privB64}


def keys_sign(priv_b64, body):
    return _node_run("import {pathToFileURL} from 'node:url';"
                     "const K = await import(pathToFileURL(process.argv[1]).href);"
                     "let s = ''; for await (const c of process.stdin) s += c;"
                     "const { priv, body } = JSON.parse(s);"
                     "process.stdout.write(K.signBody(priv, body));",
                     stdin=json.dumps({"priv": priv_b64, "body": body}))


def signed(body, pair):
    b = dict(body)
    b.pop("sig", None)
    b["sig"] = keys_sign(pair["privB64"], b)
    return b


def announce_body(key, name):
    return {"op": "emit", "kind": "node-key", "node_key": key,
            "provenance": {"attributed_to": {"name": name}}}


@req("REQ-SIGN-1a", "REQ-SIGN-3")
def test_ref_key_carrying_a_sig_and_malformed_ed25519_shapes_refuse_at_the_gate():
    t = TargetNode().start()
    try:
        n0 = len(t.log_lines())
        ref = emit_payload(text=uniq("ref-sig"), node_key="key:probe-ref", sig="AAAA")
        st, _, r = jpost(t.base, "/api/ingest", ref)
        assert st == 400 and r["error"] == "bad_signature", (st, r)   # a sig on a ref key is a signature attempt, not a claim
        bad_shape = emit_payload(text=uniq("shape"), node_key="key:ed25519:" + "A" * 42 + "=")
        st, _, r = jpost(t.base, "/api/ingest", bad_shape)
        assert st == 400 and r["error"] == "bad_node_key", (st, r)     # 43 chars + pad or it is not a node key
        assert len(t.log_lines()) == n0, "gate refusals deposit nothing"
    finally:
        t.stop()


@req("REQ-SIGN-1", "REQ-SIGN-2", "REQ-SIGN-4", "REQ-SIGN-5")
def test_signed_emit_verifies_at_the_gate_and_the_badge_is_machine_made():
    t = TargetNode().start()
    try:
        pair = keys_mint()
        n0 = len(t.log_lines())
        # (1) signed emit BEFORE any announce: sig verifies but the key is unregistered - honest claim
        early = signed(emit_payload(node_key=pair["nodeKey"], text=uniq("pre-announce")), pair)
        st, _, r = jpost(t.base, "/api/ingest", early)
        assert st == 200 and r["status"] == "deposited", (st, r)
        assert r["creator_verified"] is False, "REQ-SIGN-4: registration must come first"
        # (2) the announce itself is signature-verified (self-signed, REQ-SIGN-2)
        ann = signed(announce_body(pair["nodeKey"], "Signed Probe"), pair)
        st, _, r = jpost(t.base, "/api/ingest", ann)
        assert st == 200 and r["status"] == "deposited", (st, r)
        # (3) wire key order is NOT the signed bytes: rebuild the dict in shuffled order, sign
        #     the canonical body, post shuffled - the gateway must still verify (REQ-SIGN-1)
        shuffled = {"text": None, "op": "emit", "sig": None, "kind": "session-log", "node_key": pair["nodeKey"]}
        base = {"op": "emit", "kind": "session-log", "node_key": pair["nodeKey"], "text": uniq("canonical")}
        shuffled["text"] = base["text"]
        shuffled["sig"] = keys_sign(pair["privB64"], base)
        st, _, r = jpost(t.base, "/api/ingest", shuffled)
        assert st == 200 and r["status"] == "deposited", (st, r)
        assert r["creator_verified"] is True, "verified is machine-made: gate-verified sig + registered key"
        assert r["node_key_fingerprint"] == pair["pubB64"][:8], "REQ-SIGN-5 fingerprint is display-only prefix"
        # (4) tamper AFTER signing: content-bound refusal, nothing stored, nothing quarantined
        tampered = dict(shuffled)
        tampered["text"] = shuffled["text"] + " TAMPERED"
        st, _, r = jpost(t.base, "/api/ingest", tampered)
        assert st == 400 and r["error"] == "bad_signature" and r.get("wire") == WIRE, (st, r)
        _, _, x = jget(t.base, "/api/export")
        assert x["integrity"]["ok"] is True, "a foreign bad signature never quarantines the log"
        assert len(t.log_lines()) == n0 + 2, "two signed claims appended; the announce REGISTERS (nodes.jsonl), refusals store nothing"
        # (5) unsigned re-announce of a verified key never un-verifies it (verified is monotone)
        st, _, r = jpost(t.base, "/api/ingest", announce_body(pair["nodeKey"], "Signed Probe again"))
        assert st == 200 and r["status"] == "deposited"
        _, _, x = jget(t.base, "/api/export")
        reg = [n for n in x["nodes"] if n["node_key"] == pair["nodeKey"]]
        assert reg and reg[0]["verified"] is True, "REQ-SIGN-4: verified is monotone in the registry"
        # (6) a sig from a DIFFERENT key never verifies under this one (content + key binding)
        other = keys_mint()
        wrong = signed(announce_body(other["nodeKey"], "Wrong Key"), pair)   # pair signs for other's key
        st, _, r = jpost(t.base, "/api/ingest", wrong)
        assert st == 400 and r["error"] == "bad_signature", (st, r)
    finally:
        t.stop()


@req("REQ-SIGN-6", "REQ-DEP-1", "REQ-DEP-2", "REQ-DEP-3")
def test_deposits_view_is_keyed_honest_and_carries_no_custody():
    # REQ-DEP-1: fetched with NO auth header below (public by ruling, rides the read tier, and
    # rides export's 503 log_integrity refusal since it reads through store.export()).
    t = TargetNode().start()
    try:
        pair = keys_mint()
        st, _, r = jpost(t.base, "/api/ingest", signed(announce_body(pair["nodeKey"], "Deposits Probe"), pair))
        assert st == 200 and r["status"] == "deposited"
        st, _, r = jpost(t.base, "/api/ingest", signed(emit_payload(node_key=pair["nodeKey"], text=uniq("viewed")), pair))
        assert st == 200 and r["creator_verified"] is True
        st, _, d = jget(t.base, "/api/deposits?node_key=" + urllib.parse.quote(pair["nodeKey"], safe=""))
        assert st == 200 and d["count"] >= 1 and d["registered"] is True, (st, d)
        assert d["registry"]["node_key_fingerprint"] == pair["pubB64"][:8]
        assert "priv" not in json.dumps(d), "deposits is a public view: it carries no custody material"
        unknown = "key:ed25519:" + base64.b64encode(os.urandom(32)).decode()
        st, _, d = jget(t.base, "/api/deposits?node_key=" + urllib.parse.quote(unknown, safe=""))
        assert st == 200 and d["count"] == 0 and d["registered"] is False, "absence of deposits is an honest answer, not a 404"
        st, _, d = jget(t.base, "/api/deposits?node_key=" + urllib.parse.quote("key:!!", safe=""))
        assert st == 400 and d["error"] == "bad_node_key", (st, d)
    finally:
        t.stop()


# ---------------------------------------------------------------------------
# C2 close (EOM-DEMO-UI-FIXWAVE-2026-10-28): the export ships the raw signature bytes so
# "anyone can verify, locally, forever" is literally true from the export alone (REQ-SIGN-7).
# The re-check is deliberately independent of this repo's own signing code: the canonical
# bytes are recomputed by a Python re-implementation of the pinned REQ-SIGN-1 rule, and the
# signature is checked with Node's WebCrypto (the API a browser reader uses), nothing
# imported from keys.mjs - the gateway boolean is tested as a convenience, not as the oracle.
# ---------------------------------------------------------------------------

def _canonical_json(obj) -> bytes:
    """REQ-SIGN-1, re-implemented independently: canonical JSON, object keys sorted by
    codepoint recursively, arrays order-preserving, no whitespace, UTF-8."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _webcrypto_verify(pub_b64: str, sig_b64: str, msg_b64: str) -> str:
    src = (
        "let s=''; for await (const c of process.stdin) s += c;"
        "const { pub, sig, msg } = JSON.parse(s);"
        "try {"
        "const k = await crypto.subtle.importKey('raw', new Uint8Array(Buffer.from(pub, 'base64')), { name: 'Ed25519' }, false, ['verify']);"
        "const ok = await crypto.subtle.verify('Ed25519', k, Buffer.from(sig, 'base64'), Buffer.from(msg, 'base64'));"
        "process.stdout.write(ok ? 'ok' : 'no');"
        "} catch (e) { process.stdout.write('THROW:' + e.message); }"
    )
    p = subprocess.run([shutil.which("node") or "node", "--input-type=module", "-e", src],
                       input=json.dumps({"pub": pub_b64, "sig": sig_b64, "msg": msg_b64}),
                       capture_output=True, text=True, timeout=20)
    assert p.returncode == 0, p.stderr
    return p.stdout.strip()


@req("REQ-SIGN-7")
def test_export_ships_reader_side_bytes_and_an_independent_webcrypto_recheck_passes():
    t = TargetNode().start()
    try:
        pair = keys_mint()
        st, _, r = jpost(t.base, "/api/ingest", signed(announce_body(pair["nodeKey"], "Reader Probe"), pair))
        assert st == 200 and r["status"] == "deposited"
        text = uniq("reader-check")
        body = {"op": "emit", "kind": "session-log", "node_key": pair["nodeKey"],
                "text": text, "provenance": {"origin": "authored"}}
        st, _, r = jpost(t.base, "/api/ingest", signed(body, pair))
        assert st == 200 and r["creator_verified"] is True
        _, _, x = jget(t.base, "/api/export")           # NO auth: the bytes are public like the log
        e = next(x for x in x["entries"] if x["text"] == text)
        assert e["creator_sig_b64"] and isinstance(e["creator_sig_b64"], str)
        assert len(base64.b64decode(e["creator_sig_b64"], validate=True)) == 64, "the raw signature is the full 64 Ed25519 bytes"
        assert e["creator_pub_b64"] == pair["pubB64"], "the exported public half is the key, byte-exact"
        signed_bytes = base64.b64decode(e["creator_signed_b64"], validate=True)
        # the reader's own REQ-SIGN-1 re-implementation must reproduce the shipped bytes exactly
        assert _canonical_json({"op": "emit", "kind": "session-log", "node_key": pair["nodeKey"],
                                "text": text, "provenance": {"origin": "authored"}}) == signed_bytes, \
            "REQ-SIGN-7 + REQ-SIGN-1: the shipped signing bytes are the canonical body, byte-exact"
        assert e["node_key_fingerprint"] == pair["pubB64"][:8], "fingerprint stays consistent with the shipped key (REQ-SIGN-5)"
        assert _webcrypto_verify(e["creator_pub_b64"], e["creator_sig_b64"], e["creator_signed_b64"]) == "ok", \
            "a reader with only the export + its own WebCrypto verifies"
        # the deposits view rides the same bytes (REQ-DEP-3: verbatim export entries)
        _, _, d = jget(t.base, "/api/deposits?node_key=" + urllib.parse.quote(pair["nodeKey"], safe=""))
        assert d["entries"][0]["creator_sig_b64"] == e["creator_sig_b64"]
    finally:
        t.stop()


@req("REQ-SIGN-7")
def test_reader_side_recheck_refuses_tampering_and_unsigned_entries_stay_honest_nulls():
    t = TargetNode().start()
    try:
        pair = keys_mint()
        jpost(t.base, "/api/ingest", signed(announce_body(pair["nodeKey"], "Tamper Probe"), pair))
        text = uniq("tamper-check")
        st, _, r = jpost(t.base, "/api/ingest", signed(
            {"op": "emit", "kind": "session-log", "node_key": pair["nodeKey"], "text": text,
             "provenance": {"origin": "authored"}}, pair))
        assert st == 200 and r["creator_verified"] is True
        # an unsigned typed-name edit: the fields exist and say null honestly
        _, _, stt = jget(t.base, "/api/state")
        st, _, ed = jpost(t.base, "/api/edit", {"name": "Skeptic", "base_v": stt["v"],
                                                "text": stt_head_text(stt) + " added by the skeptic"})
        assert st == 200, ed
        _, _, x = jget(t.base, "/api/export")
        for e in x["entries"]:
            if not str(e["creator_ref"]).startswith("key:ed25519:"):
                assert e["creator_sig_b64"] is None and e["creator_signed_b64"] is None and e["creator_pub_b64"] is None, \
                    "REQ-SIGN-7: no signature, no lies - honest nulls for claims"
        ent = next(e for e in x["entries"] if e["text"] == text)
        sig = bytearray(base64.b64decode(ent["creator_sig_b64"]))
        sig[0] ^= 0x01
        assert _webcrypto_verify(ent["creator_pub_b64"], base64.b64encode(bytes(sig)).decode(), ent["creator_signed_b64"]) == "no", \
            "one flipped signature byte must break the reader's check - the verify is real, not a stub"
        assert _webcrypto_verify(ent["creator_pub_b64"], ent["creator_sig_b64"],
                                 base64.b64encode(base64.b64decode(ent["creator_signed_b64"]) + b"x").decode()) == "no", \
            "one appended byte to the bytes must break the check too"
    finally:
        t.stop()


# ---------------------------------------------------------------------------
# the conformance matrix: no requirement may sit unasserted
# ---------------------------------------------------------------------------

@req("spec.matrix")
def test_conformance_matrix_exercises_every_requirement_and_policy():
    covered = set(MATRIX)
    expected = SPEC_REQ_IDS | EXPECTED_POLICY_KEYS
    missing = expected - covered
    assert not missing, f"requirements/policy with NO conformance assertion: {sorted(missing)}"
    for key, fns in sorted(MATRIX.items()):
        assert fns, f"{key} tagged but no test registered"
