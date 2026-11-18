"""Machine-checkable invariant oracles for the Seams battle-test kit.

Standard library only. Each oracle looks at one request/response exchange (plus
the session's Context) and returns violations. Nothing here uses a model: the
oracles are the referee, the local LLM is only the attacker.

Source of the canonical invariants N1 to N9: the ratified invariants 1 to 9 in
the Rail design doc of 2026-07-20, section 1, reproduced verbatim in
Seams_Protocol/SEAMS-PACKET-V2-SUPPLEMENT-2026-10-14.md section A. (Invariants
10 to 12 are wire-shape gaps already filed; they are not in this first kit.)

The A-series are NAMED ADDITIONS by Seams. They have no verbatim precedent in
the corpus and ride in the kit for ratification on receipt.

Some invariants cannot be settled by a wire test (N6's custody, N8's "no model"
are properties of the code). For those the oracle checks the observable
consequence and says so in `limits`. Treat a pass as "no counter-example found",
never as proof.
"""

from __future__ import annotations

import copy
import json
import re

CANON = {
    "N1": "Path not amount: attribution sets the path, the amount enters exogenously, no valuation is computed in the rail.",
    "N2": "Execute, never derive: a leg executes a declared term, never a share derived from a property of the contribution.",
    "N3": "Every payment traces to a signed attribution edge: a leg that cannot cite its edges does not execute.",
    "N4": "Exact conservation: integer minor units, payer_retained + legs == amount in, always.",
    "N5": "Credited-but-unpaid is first-class: a leg with no wallet stays a pending intent, keeps its amount, is never redistributed.",
    "N6": "Non-custodial: value moves payer to recipient directly, one leg per recipient; no held balance, no intermediary.",
    "N7": "Two clocks: attribution settles at capture with no money; payout only at a value event with an exogenous amount.",
    "N8": "No model in the money path: compile and execute are deterministic.",
    "N9": "Key doctrine: caller never supplies identity or key material; no secret appears in any response.",
}
ADDITIONS = {
    "A1": "Errors are never verdicts: a response with an error carries no verdict, no manifest and no success status.",
    "A2": "Fail closed and never crash: any request, however malformed, gets a JSON object back (not an exception or a hang).",
    "A3": "Every response is a JSON object carrying the wire version.",
    "A4": "Only the work's creator key can declare terms, splits or links on it (advisory suggested-work declarations excepted).",
    "A5": "GM-tier content, or any tier other than 'player', is never deposited.",
    "A6": "Side-effect-free reads are repeatable: the same check_use / quote_route / get_lineage request twice gives the same answer.",
}

SUCCESS_STATUSES = {"quoted", "recorded", "deposited", "declared", "linked", "ok"}
VERDICT_KEYS = {"verdict", "decided_by", "manifest", "receipts", "manifest_hash"}
SECRETISH = re.compile(r"(private|secret|seed|mnemonic|priv_?key|passphrase|sk_|api_?key|password)", re.I)
IDENTITY_FIELDS = ("signer", "agent_id", "pubkey", "pubkey_id", "private_key", "secret", "signature", "creator")
CUSTODY_WORDS = re.compile(r"(escrow|custod|treasury|platform_wallet|lapis_wallet|omnibus|pooled_balance|held_balance)", re.I)
VALUATION_WORDS = re.compile(r"(worth|valuation|quality_score|value_score|estimated_value|merit|contribution_score)", re.I)


class Context:
    """What one session has learned so far (hashes, creators, declared terms)."""

    def __init__(self, seed=None):
        self.works = {}  # work hash -> creator key ref (when known)
        self.keys = set()
        self.declared_beneficiaries = set()
        self.wallets = {}  # key ref -> wallet address (from the seed fixture)
        self.wire = None
        if seed:
            self.absorb_seed(seed)

    def absorb_seed(self, fx):
        for w, spec in fx.get("works", {}).items():
            self.works[w] = spec.get("creator")
            if spec.get("creator"):
                self.keys.add(spec["creator"])
        for t in fx.get("routing_terms", []):
            self.declared_beneficiaries.add(t["beneficiary"])
            self.keys.add(t["beneficiary"])
        self.wallets.update(fx.get("wallets", {}))

    def observe(self, req, resp):
        if not (isinstance(req, dict) and isinstance(resp, dict)):
            return
        ref = req.get("creator_key_ref")
        if isinstance(ref, str):
            self.keys.add(ref)
        if req.get("op") == "emit" and resp.get("status") == "deposited" and resp.get("content_hash"):
            self.works[resp["content_hash"]] = ref
        if req.get("op") == "declare_terms" and resp.get("status") == "declared":
            rt = req.get("routing_terms")
            if isinstance(rt, dict) and isinstance(rt.get("beneficiary"), str):
                self.declared_beneficiaries.add(rt["beneficiary"])
        if isinstance(resp.get("wire"), str):
            self.wire = self.wire or resp["wire"]


def _v(oid, detail, severity="fail", **extra):
    name = CANON.get(oid) or ADDITIONS.get(oid)
    d = {"oracle": oid, "rule": name, "detail": detail, "severity": severity}
    d.update(extra)
    return d


def _is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


def _walk_keys(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield path + "/" + str(k), k, v
            yield from _walk_keys(v, path + "/" + str(k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk_keys(v, f"{path}[{i}]")


def _manifest(resp):
    m = resp.get("manifest")
    return m if isinstance(m, dict) else None


def check_exchange(req, resp, ctx, target=None):
    """All violations for one exchange. `target` (with .handle) enables the metamorphic checks."""
    out = []
    # --- A2, A3: shape ---------------------------------------------------
    if not isinstance(resp, dict):
        return [_v("A2", f"response is not a JSON object: {type(resp).__name__}")]
    if "wire" not in resp:
        out.append(_v("A3", "response has no 'wire' field"))
    elif ctx.wire and resp["wire"] != ctx.wire:
        out.append(_v("A3", f"wire version changed mid-session: {ctx.wire} -> {resp['wire']}"))
    op = req.get("op") if isinstance(req, dict) else None

    # --- A1: errors are never verdicts -------------------------------------
    if "error" in resp:
        bad = sorted(k for k in resp if k in VERDICT_KEYS) + ([resp["status"]] if resp.get("status") in SUCCESS_STATUSES else [])
        if bad:
            out.append(_v("A1", f"error response also carries {bad}"))
    elif resp.get("status") == "refused" and any(k in resp for k in ("manifest", "receipts")):
        out.append(_v("A1", "a refusal carries a manifest or receipts"))

    # --- N9: secrets, caller identity --------------------------------------
    for path, k, v in _walk_keys(resp):
        if SECRETISH.search(str(k)) and isinstance(v, (str, int)) and v not in ("", 0):
            out.append(_v("N9", f"response field {path} looks like key material"))
    if isinstance(req, dict) and "error" not in resp and resp.get("status") != "refused":
        given = [f for f in IDENTITY_FIELDS if f in req and f != "creator"]
        if given and op in ("emit", "declare", "declare_terms", "record_link", "record_value_event"):
            out.append(_v("N9", f"request supplied identity field(s) {given} and the op succeeded; "
                                "confirm they were ignored (signer must derive from creator_key_ref)", severity="review"))

    # --- A5: tier ------------------------------------------------------------
    if op == "emit" and resp.get("status") == "deposited" and req.get("tier") != "player":
        out.append(_v("A5", f"emit deposited with tier={req.get('tier')!r}"))

    # --- A4: only the creator ------------------------------------------------
    if op in ("declare", "declare_terms", "record_link") and resp.get("status") in ("declared", "linked") and not resp.get("advisory"):
        subj = None
        if op == "declare":
            subj = (req.get("use_terms") or {}).get("subject")
        elif op == "declare_terms":
            subj = (req.get("routing_terms") or {}).get("subject")
        else:
            subj = req.get("from")
        owner = ctx.works.get(subj)
        if owner and req.get("creator_key_ref") and owner != req["creator_key_ref"]:
            out.append(_v("A4", f"{req['creator_key_ref']} declared/linked on {subj} owned by {owner}"))

    # --- N1..N8: money ---------------------------------------------------------
    for path, k, _ in _walk_keys(resp):
        if VALUATION_WORDS.search(str(k)):
            out.append(_v("N1", f"response field {path} suggests a computed valuation"))
        if CUSTODY_WORDS.search(str(k)):
            out.append(_v("N6", f"response field {path} suggests held funds"))
    if op in ("quote_route", "record_value_event"):
        out += _money(req, resp, ctx, target)
    elif op in ("emit", "declare", "declare_terms", "check_use", "record_link", "get_lineage", "get_links"):
        if any(k in resp for k in ("legs", "receipts", "payer_retained")) or _manifest(resp):
            out.append(_v("N7", f"{op} (attribution clock) returned payout data"))

    # --- A6 / N8: repeatability ---------------------------------------------------
    if target is not None and op in ("check_use", "quote_route", "get_lineage", "get_links") and "error" not in resp:
        again = target.handle(copy.deepcopy(req))
        if _norm(again) != _norm(resp):
            oid = "N8" if op == "quote_route" else "A6"
            out.append(_v(oid, f"repeating the same {op} gave a different answer",
                          first=_clip(resp), second=_clip(again)))
    ctx.observe(req, resp)
    return out


def _norm(o):
    o = copy.deepcopy(o)
    if isinstance(o, dict):
        o.pop("id", None)
    return json.dumps(o, sort_keys=True)


def _clip(o, n=600):
    s = json.dumps(o, sort_keys=True)
    return s if len(s) <= n else s[:n] + "…"


def _money(req, resp, ctx, target):
    out, op = [], req.get("op")
    amt = req.get("amount")
    good_amt = isinstance(amt, dict) and _is_int(amt.get("value")) and amt["value"] > 0 \
        and isinstance(amt.get("asset_code"), str) and _is_int(amt.get("asset_scale"))
    ok = resp.get("status") in ("quoted", "recorded") and "error" not in resp
    zero = isinstance(amt, dict) and _is_int(amt.get("value")) and amt["value"] == 0 and isinstance(amt.get("asset_code"), str)
    if ok and not good_amt:  # N7: the amount is exogenous and must be well formed
        out.append(_v("N7", f"{op} succeeded without a well-formed exogenous amount: {_clip(amt, 200)}",
                      severity="review" if zero else "fail"))
    if not ok:
        return out
    m = _manifest(resp)
    if m is None:
        return out + [_v("N4", "success response without a manifest")]
    legs = m.get("legs")
    if not isinstance(legs, list) or not _is_int(m.get("payer_retained")):
        return out + [_v("N4", "manifest lacks integer payer_retained or a legs list")]
    total = m["payer_retained"] + 0
    for i, leg in enumerate(legs):
        if not _is_int(leg.get("amount")) or leg["amount"] < 0:
            out.append(_v("N4", f"leg {i} amount is not a non-negative integer: {leg.get('amount')!r}"))
        else:
            total += leg["amount"]
    if m["payer_retained"] < 0:
        out.append(_v("N4", "payer_retained is negative"))
    if good_amt and total != amt["value"]:
        out.append(_v("N4", f"payer_retained + legs = {total}, amount in = {amt['value']}"))
    for i, leg in enumerate(legs):
        who = leg.get("beneficiary")
        refs = leg.get("edge_refs")
        if not (isinstance(refs, list) and refs and all(isinstance(r, str) and r for r in refs)):
            out.append(_v("N3", f"leg {i} ({who}) has no edge_refs"))
        else:
            unknown = [r for r in refs if r not in ctx.works]
            if unknown:
                out.append(_v("N3", f"leg {i} ({who}) cites edge(s) this session never saw deposited: {unknown}", severity="review"))
        if who is not None and who not in ctx.declared_beneficiaries and who not in ctx.keys and who not in ctx.works.values():
            out.append(_v("N2", f"leg {i} pays {who}, who appears in no declared term or deposit this session"))
        if isinstance(who, str) and CUSTODY_WORDS.search(who):
            out.append(_v("N6", f"leg {i} beneficiary {who!r} looks like a custodian"))
        wallet = leg.get("wallet_address")
        status = leg.get("leg_status")
        if wallet in (None, "") and status != "credited-unpaid":
            out.append(_v("N5", f"leg {i} ({who}) has no wallet but status is {status!r}, not credited-unpaid"))
        if wallet and status == "credited-unpaid":
            out.append(_v("N5", f"leg {i} ({who}) has a wallet but is marked credited-unpaid"))
        if who in ctx.wallets and wallet and wallet != ctx.wallets[who]:
            out.append(_v("N6", f"leg {i} routes {who} to {wallet}, not their own bound wallet {ctx.wallets[who]}"))
        if isinstance(leg.get("amount"), int) and leg["amount"] == 0 and status == "credited-unpaid":
            out.append(_v("N5", f"credited-unpaid leg {i} ({who}) carries amount 0", severity="review"))
    if sum(1 for l in legs if l.get("beneficiary")) != len({l.get("beneficiary") for l in legs}):
        out.append(_v("N6", "two legs for one recipient (one leg per recipient)", severity="review"))
    if op == "record_value_event":
        rcpts = resp.get("receipts")
        if not isinstance(rcpts, list):
            out.append(_v("N5", "record_value_event returned no receipts list"))
        else:
            if sum(r.get("amount", 0) for r in rcpts if _is_int(r.get("amount"))) != sum(l.get("amount", 0) for l in legs if _is_int(l.get("amount"))):
                out.append(_v("N4", "receipts do not sum to the legs"))
            for r in rcpts:
                leg = next((l for l in legs if l.get("beneficiary") == r.get("beneficiary")), None)
                if leg and not leg.get("wallet_address") and r.get("state") != "pending-credited":
                    out.append(_v("N5", f"receipt for {r.get('beneficiary')} is {r.get('state')!r} though they have no wallet"))
    # N1/N2 metamorphic: shares must not depend on the amount
    if op == "quote_route" and target is not None and good_amt and amt["value"] <= 10**9 // 1000:
        big = copy.deepcopy(req)
        big["amount"]["value"] = amt["value"] * 1000
        big["event_ref"] = "kit-scale-probe"
        r2 = target.handle(big)
        m2 = _manifest(r2) if isinstance(r2, dict) else None
        if m2 and isinstance(m2.get("legs"), list):
            tol = 1.0 / amt["value"] + 1e-9
            f1 = {l.get("beneficiary"): l.get("amount", 0) / amt["value"] for l in legs}
            f2 = {l.get("beneficiary"): l.get("amount", 0) / (amt["value"] * 1000) for l in m2["legs"]}
            if set(f1) != set(f2):
                out.append(_v("N1", f"the set of recipients changed when only the amount was scaled x1000: {sorted(map(str, f1))} vs {sorted(map(str, f2))}"))
            else:
                for b in f1:
                    if abs(f1[b] - f2[b]) > tol:
                        out.append(_v("N1", f"{b}'s share moved from {f1[b]:.5f} to {f2[b]:.5f} when only the amount was scaled"))
            r1 = m["payer_retained"] / amt["value"]
            r2f = m2["payer_retained"] / (amt["value"] * 1000)
            if abs(r1 - r2f) > tol:
                out.append(_v("N1", f"payer_retained share moved from {r1:.5f} to {r2f:.5f} when only the amount was scaled"))
    return out


# Probes the harness runs without any model: the wire's own refusals of money edge cases.
def money_probes(work):
    base = {"op": "quote_route", "work": work, "event_ref": "kit-probe"}
    amounts = [None, 0, -1, True, 1.5, "100", {"value": 0, "asset_code": "USD", "asset_scale": 2},
               {"value": True, "asset_code": "USD", "asset_scale": 2},
               {"value": 100, "asset_scale": 2}, {"value": 100, "asset_code": "USD"},
               {"value": 10 ** 30, "asset_code": "USD", "asset_scale": 2},
               {"value": 100.0, "asset_code": "USD", "asset_scale": 2}]
    for a in amounts:
        r = dict(base)
        if a is not None:
            r["amount"] = a
        yield r
    for op in ("quote_route", "record_value_event"):
        r = dict(base, op=op, amount={"value": 100, "asset_code": "USD", "asset_scale": 2})
        r["work"] = "sha256:" + "0" * 64
        yield r
