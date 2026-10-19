#!/usr/bin/env python3
"""Seams local stub, wire v0.1-draft.

A stand-in for Seams that Kyma can build against before the real rail speaks
this wire. It implements check_use, emit and declare exactly as WIRE-V0.md
describes, in memory, with no signing, no ledger and no network.

It is NOT Seams. Hashes it returns for deposits are placeholders: Kyma must
treat every hash as an opaque string. What IS binding is the verdict logic,
which the test vectors pin. A Rust port that passes the same vectors is
equally valid.

Usage:
  python3 seams_stub.py --vectors ../vectors/check_use.json ../vectors/emit.json
  python3 seams_stub.py --fixture ../vectors/check_use.json   # then JSON lines on stdin
"""
import base64
import hashlib
import json
import sys

WIRE_VERSION = "seams-wire/0.3-draft"
CAPABILITIES = ("view", "context", "fork", "remix", "redistribution", "training")
ASPECTS = ("whole", "character", "plot", "item", "scene", "setting",
           "mythology", "metaphysics", "magic",
           # character layers (v0.2, Kyma request 10-13). character.consent is
           # deliberately absent: the consent graph is never a use-terms target.
           "character.voice", "character.backstory", "character.state",
           "character.relationships", "character.mechanics")
ORIGINS = ("played", "assisted", "authored")
KINDS = ("pack", "character", "scene", "setting", "item", "plot", "world",
         "session-log", "image-beat", "campaign")
TIERS = ("player", "gm")
RELATIONS = ("uses", "contains")
FLOOR = ("floor/minors", "floor/real-person-unconsented")
SEVERITY = {"permitted": 0, "undeclared": 1, "denied": 2}
PROFILES = {"local": 0, "cloud": 1, "platform": 2}   # enforcement profile of the surface
KIND_TO_ASPECT = {"character": "character", "item": "item", "scene": "scene",
                  "setting": "setting", "plot": "plot"}


class WireError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def canonical(obj):
    """Sorted keys, no whitespace, UTF-8. A stand-in for RFC 8785 (JCS)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sha256(b):
    return "sha256:" + hashlib.sha256(b).hexdigest()


def tag_matches(pattern, tag):
    if pattern.endswith("/*"):
        base = pattern[:-2]
        return tag == base or tag.startswith(base + "/")
    return pattern == tag


class Stub:
    def __init__(self):
        self.works = {}          # hash -> {"creator": key, "published": bool}
        self.declarations = []   # use_terms payloads, append-only; list index is seq
        self.routing_terms = []  # declared splits (bps), append-only
        self.wallets = {}        # key -> wallet address (self-signed bindings)
        self.manifests = {}      # event_ref -> latest manifest
        self.links = []          # {from, to, relation, pinned, declared_by}; never read by check_use

    # ---- state -------------------------------------------------------------
    def load_fixture(self, fx):
        for h, w in fx.get("works", {}).items():
            self.works[h] = {"creator": w["creator"], "published": w.get("published", True),
                             "parents": w.get("parents", []), "kind": w.get("kind", "character"),
                             "derivation": "fork" if w.get("parents") else "original",
                             "origin": None if w.get("suggested") else "authored",
                             "suggested": bool(w.get("suggested")), "seq": len(self.works) + 1}
        for d in fx.get("declarations", []):
            self._append(d)
        for t in fx.get("routing_terms", []):
            self.routing_terms.append(dict(t, scope=t.get("scope", "standing")))
        self.wallets.update(fx.get("wallets", {}))

    def _append(self, d):
        d = dict(d)
        d.setdefault("aspect", "whole")
        d.setdefault("allowed_uses", [])
        d.setdefault("denied_uses", [])
        d.setdefault("scope", "standing")
        d.setdefault("revokes", False)
        d.setdefault("note", "")
        if d["aspect"] not in ASPECTS:
            raise WireError("unknown_aspect", d["aspect"])
        for u in d["allowed_uses"] + d["denied_uses"]:
            if u not in CAPABILITIES:
                raise WireError("unknown_capability", u)
        if set(d["allowed_uses"]) & set(d["denied_uses"]):
            raise WireError("overlapping_uses", "allowed_uses and denied_uses overlap")
        d["seq"] = len(self.declarations) + 1
        d["declaration_hash"] = sha256(canonical({"use_terms": {k: v for k, v in d.items() if k != "seq"}}))
        self.declarations.append(d)
        return d

    def _active(self, subject, aspect, creator):
        """Latest declaration by seq for (subject, aspect), signed by the creator.

        Declarations by any other key are ignored: this is the consumer
        cross-check against consent squatting. A tombstone as the latest row
        means this level says nothing (the caller falls through)."""
        rows = [d for d in self.declarations
                if d["subject"] == subject and d["aspect"] == aspect and d["declared_by"] == creator]
        if not rows:
            return None
        latest = max(rows, key=lambda d: d["seq"])
        return None if latest["revokes"] else latest

    def _levels(self, work, aspect, creator):
        """Most specific first: character.voice -> character -> whole, on the
        work, then the same chain on the creator's default policy."""
        chain, a = [], aspect
        while a != "whole":
            chain.append(a)
            a = a.rsplit(".", 1)[0] if "." in a else "whole"
        out = [("aspect", self._active(work, x, creator)) for x in chain]
        out.append(("work", self._active(work, "whole", creator)))
        out += [("default_policy_aspect", self._active("*", x, creator)) for x in chain]
        out.append(("default_policy", self._active("*", "whole", creator)))
        return [(lvl, d) for lvl, d in out if d is not None]

    # ---- check_use ---------------------------------------------------------
    def check_use(self, req):
        """Consent is inherited (Erah direction 10-12): a fork or remix can never
        loosen its ancestors' terms. The verdict is the worst of the work's own
        verdict and every ancestor's verdict for the same request."""
        own = self._check_one(req)
        if "error" in own or own["verdict"] == "denied":
            return own
        info = self.works.get(req["work"])
        seen, stack = {req["work"]}, list(info["parents"]) if info else []
        worst = own
        while stack:
            anc = stack.pop()
            if anc in seen:
                continue
            seen.add(anc)
            ainfo = self.works.get(anc)
            if ainfo is None:
                if req["capability"] == "view":
                    continue   # public is playable even if an ancestor is not known locally
                v = {"verdict": "undeclared", "decided_by": {"level": "unknown_work"}}
            else:
                v = self._check_one(dict(req, work=anc))
                stack.extend(ainfo["parents"])
            if SEVERITY[v["verdict"]] > SEVERITY[worst["verdict"]]:
                worst = dict(own, verdict=v["verdict"], contexts=v.get("contexts", own["contexts"]),
                             decided_by={"level": "ancestor:" + v["decided_by"]["level"],
                                         "declaration": v["decided_by"].get("declaration"),
                                         "ancestor": anc})
                worst.pop("terms_note", None)
                if v.get("terms_note"):
                    worst["terms_note"] = v["terms_note"]
                if v["verdict"] == "denied":
                    break
        return worst

    def _check_one(self, req):
        work = req["work"]
        cap = req["capability"]
        aspect = req.get("aspect", "whole")
        origin = req.get("origin")
        contexts = req.get("contexts", [])
        if cap not in CAPABILITIES:
            raise WireError("unknown_capability", f"{cap!r} not in {CAPABILITIES}")
        if aspect not in ASPECTS:
            raise WireError("unknown_aspect", f"{aspect!r} not in {ASPECTS}")
        if origin is not None and origin not in ORIGINS:
            raise WireError("bad_origin", f"origin must be one of {ORIGINS}")
        info = self.works.get(work)
        if info is None:
            return self._verdict(req, "undeclared", "unknown_work", None, [])
        if info.get("suggested"):
            return self._check_suggested(req, cap, contexts)
        levels = self._levels(work, aspect, info["creator"])

        # Capability
        cap_v, cap_lvl, cap_decl = None, None, None
        for lvl, d in levels:
            if cap in d["denied_uses"]:
                cap_v, cap_lvl, cap_decl = "denied", lvl, d
                break
            if cap in d["allowed_uses"]:
                filt = d.get("origin", {}).get(cap, "any")
                allowed = None if filt == "any" else ([filt] if isinstance(filt, str) else filt)
                if allowed is not None and origin not in allowed:
                    cap_v, cap_lvl, cap_decl = "denied", "origin_filter", d
                else:
                    cap_v, cap_lvl, cap_decl = "permitted", lvl, d
                break
        if cap_v is None:
            if cap == "view" and info["published"]:
                cap_v, cap_lvl = "permitted", "protocol_default"
            else:
                cap_v, cap_lvl = "undeclared", "protocol_default"

        # Contexts
        hard = [t for _, d in levels for t in d.get("contexts", {}).get("hard_limits", [])]
        ctx_results = []
        profile = req.get("surface_profile", "local")
        if profile not in PROFILES:
            raise WireError("bad_profile", f"surface_profile must be one of {list(PROFILES)}")
        for c in contexts:
            ctx_results.append(self._check_context(c, levels, hard, profile))

        worst = max([cap_v] + [r["verdict"] for r in ctx_results], key=SEVERITY.get)
        if worst == cap_v and (cap_v != "permitted" or not ctx_results):
            decided, decl = cap_lvl, cap_decl
        elif worst == "permitted":
            decided, decl = cap_lvl, cap_decl
        else:
            first = next(r for r in ctx_results if r["verdict"] == worst)
            decided, decl = "context:" + first["level"], first.pop("_decl", None)
        for r in ctx_results:
            r.pop("_decl", None)
        return self._verdict(req, worst, decided, decl, ctx_results)

    def _check_suggested(self, req, cap, contexts):
        """A suggested work (an import with no author of record). Nobody holds authority
        over it, so declarations on it are advisory and never read here. It behaves like an
        open default for view, context, fork and remix; redistribution and training stay
        undeclared because nobody can grant them. Only the protocol floor binds a context tag."""
        profile = req.get("surface_profile", "local")
        if profile not in PROFILES:
            raise WireError("bad_profile", f"surface_profile must be one of {list(PROFILES)}")
        ctx = []
        for c in contexts:
            if any(tag_matches(f + "/*", c["tag"]) or c["tag"] == f for f in FLOOR):
                ctx.append({"tag": c["tag"], "verdict": "denied", "level": "floor"})
            else:
                ctx.append({"tag": c["tag"], "verdict": "permitted", "level": "suggested_open_default"})
        cap_v = "permitted" if cap in ("view", "context", "fork", "remix") else "undeclared"
        cap_lvl = "suggested_open_default" if cap_v == "permitted" else "suggested"
        worst = max([cap_v] + [r["verdict"] for r in ctx], key=SEVERITY.get)
        if worst == cap_v:
            level = cap_lvl
        else:
            level = "context:" + next(r for r in ctx if r["verdict"] == worst)["level"]
        out = self._verdict(req, worst, level, None, ctx)
        out["origin_status"] = "suggested"
        return out

    def _check_context(self, c, levels, hard, profile="local"):
        tag, tier, tax = c["tag"], c.get("tier"), c.get("taxonomy")
        if any(tag_matches(f + "/*", tag) or tag == f for f in FLOOR):
            return {"tag": tag, "verdict": "denied", "level": "floor"}
        if any(tag_matches(h, tag) for h in hard):
            return {"tag": tag, "verdict": "denied", "level": "hard_limit"}
        for lvl, d in levels:
            cb = d.get("contexts")
            if not cb or cb.get("taxonomy") != tax:
                continue
            if any(tag_matches(p, tag) for p in cb.get("deny", [])):
                return {"tag": tag, "verdict": "denied", "level": lvl, "_decl": d}
            for a in cb.get("allow", []):
                if tag_matches(a["tag"], tag):
                    mt = a.get("max_tier")
                    if mt is not None and tier is not None and tier > mt:
                        return {"tag": tag, "verdict": "denied", "level": lvl + ":tier", "_decl": d}
                    mp = a.get("min_profile")
                    if mp is not None and PROFILES[profile] < PROFILES[mp]:
                        return {"tag": tag, "verdict": "denied", "level": lvl + ":profile", "_decl": d}
                    return {"tag": tag, "verdict": "permitted", "level": lvl, "_decl": d}
        return {"tag": tag, "verdict": "undeclared", "level": "protocol_default"}

    def _verdict(self, req, verdict, level, decl, ctx):
        out = {"wire": WIRE_VERSION, "verdict": verdict, "work": req["work"],
               "capability": req["capability"], "aspect": req.get("aspect", "whole"),
               "decided_by": {"level": level,
                              "declaration": decl["declaration_hash"] if decl else None},
               "contexts": ctx}
        if decl and decl.get("note"):
            out["terms_note"] = decl["note"]
        return out

    # ---- emit --------------------------------------------------------------
    def emit(self, req):
        tier = req.get("tier")
        if tier not in TIERS:
            raise WireError("bad_tier", f"tier is required and must be one of {TIERS}")
        if tier == "gm":
            return {"wire": WIRE_VERSION, "status": "refused", "reason": "gm_tier"}
        if req.get("kind") not in KINDS:
            raise WireError("unknown_kind", f"kind must be one of {KINDS}")
        content = base64.b64decode(req["content_b64"])
        derivation = req.get("derivation", "original")
        if derivation not in ("original", "fork", "remix"):
            raise WireError("bad_derivation", derivation)
        if derivation != "original" and not req.get("parents"):
            raise WireError("missing_parents", "fork/remix needs at least one parent")
        if derivation == "original" and req.get("parents"):
            raise WireError("parents_on_original", "an original has no parents; send fork or remix")
        prov = req.get("provenance", {})
        origin = prov.get("origin", "authored")
        if origin not in ORIGINS:
            raise WireError("bad_origin", f"origin must be one of {ORIGINS}")
        if "consent_enforced" in prov and not isinstance(prov["consent_enforced"], bool):
            raise WireError("bad_provenance", "consent_enforced must be true or false")
        imp, status, attrib = prov.get("imported_from"), prov.get("origin_status"), prov.get("attributed_to")
        suggested = imp is not None or status is not None
        if suggested:
            if (status != "suggested" or not isinstance(imp, dict) or not imp.get("format")
                    or not imp.get("source_sha256")):
                raise WireError("bad_provenance", "an import needs imported_from {format, source_sha256} "
                                                  "and origin_status 'suggested'")
            if derivation != "original":
                raise WireError("bad_provenance", "only an original can be an import")
        if attrib is not None:
            if (not suggested or not isinstance(attrib, dict) or not isinstance(attrib.get("name"), str)
                    or attrib.get("verified", False) is not False):
                raise WireError("bad_provenance", "attributed_to {name, verified: false} is only for an import, "
                                                  "and is never verified here")
        aspects = req.get("touched_aspects") or [KIND_TO_ASPECT.get(req["kind"], "whole")]
        for a in aspects:
            if a not in ASPECTS:
                raise WireError("unknown_aspect", a)
        blocked = []
        if derivation != "original":
            for p in req["parents"]:
                for a in aspects:
                    v = self.check_use({"work": p, "capability": derivation, "aspect": a,
                                        "origin": origin, "contexts": req.get("contexts", []),
                                        "surface_profile": req.get("surface_profile", "local")})
                    if v["verdict"] != "permitted":
                        blocked.append({"parent": p, "aspect": a, "verdict": v["verdict"],
                                        "decided_by": v["decided_by"]})
        if blocked:
            return {"wire": WIRE_VERSION, "status": "refused", "reason": "parent_consent",
                    "blocked": blocked}
        content_hash = sha256(content)
        envelope = {"kind": req["kind"], "content_hash": content_hash,
                    "parents": req.get("parents", []), "creator": req["creator_key_ref"],
                    "derivation": derivation, "provenance": req.get("provenance", {})}
        deposit_hash = sha256(canonical(envelope))
        prior = self.works.get(content_hash)
        if prior is not None and prior["creator"] != req["creator_key_ref"]:
            raise WireError("already_deposited", "this content is already deposited by another key")
        if prior is None:
            self.works[content_hash] = {"creator": req["creator_key_ref"], "published": True,
                                        "parents": req.get("parents", []), "kind": req["kind"],
                                        "derivation": derivation, "origin": None if suggested else origin,
                                        "suggested": suggested, "provenance": prov,
                                        "seq": len(self.works) + 1}
        declared = None
        if req.get("use_terms"):
            ut = dict(req["use_terms"], subject=content_hash, declared_by=req["creator_key_ref"])
            declared = self._append(ut)["declaration_hash"]
        out = {"wire": WIRE_VERSION, "status": "deposited", "content_hash": content_hash,
               "deposit_hash": deposit_hash, "declaration_hash": declared, "provenance": prov}
        if suggested:
            out["origin_status"] = "suggested"
            if declared:
                out["advisory"] = True   # terms on a suggested work are stored but never bind
        return out

    # ---- declare -----------------------------------------------------------
    def declare(self, req):
        d = dict(req["use_terms"], declared_by=req["creator_key_ref"])
        if d["subject"] != "*":
            info = self.works.get(d["subject"])
            if info is None:
                raise WireError("unknown_work", d["subject"])
            if info["creator"] != req["creator_key_ref"]:
                raise WireError("not_creator", "only the work's creator key can declare on it")
        out = {"wire": WIRE_VERSION, "status": "declared",
               "declaration_hash": self._append(d)["declaration_hash"]}
        if d["subject"] != "*" and self.works[d["subject"]].get("suggested"):
            out["advisory"] = True
        return out

    # ---- lineage and links (PROPOSED) --------------------------------------
    def _node(self, h):
        w = self.works[h]
        node = {"content_hash": h, "kind": w.get("kind"), "derivation": w.get("derivation"),
                "origin": w.get("origin"), "creator": w["creator"], "parents": list(w["parents"]),
                "seq": w.get("seq"), "origin_status": "suggested" if w.get("suggested") else "declared",
                "suggested_root": self._suggested_root(h)}
        if w.get("suggested"):
            prov = w.get("provenance", {})
            node["importer"] = w["creator"]
            node["imported_from"] = prov.get("imported_from")
            if prov.get("attributed_to"):
                node["attributed_to"] = prov["attributed_to"]
        return node

    def _suggested_root(self, h, seen=None):
        """True if any root ancestor (a work with no parents) is a suggested import: a
        play-fork of an imported card keeps the suggested origin."""
        seen = seen or set()
        if h in seen or h not in self.works:
            return False
        seen.add(h)
        w = self.works[h]
        if not w["parents"]:
            return bool(w.get("suggested"))
        return any(self._suggested_root(p, seen) for p in w["parents"])

    def get_lineage(self, req):
        h, direction = req.get("work"), req.get("direction", "up")
        if direction not in ("up", "down", "both"):
            raise WireError("bad_direction", "direction must be up, down or both")
        depth = req.get("depth", 16)
        if not isinstance(depth, int) or isinstance(depth, bool) or depth < 0:
            raise WireError("bad_depth", "depth must be a non-negative integer")
        if h not in self.works:
            raise WireError("unknown_work", str(h))
        children = {}
        for c, w in self.works.items():
            for p in w["parents"]:
                children.setdefault(p, []).append(c)
        seen, order, edges = {h}, [h], set()
        frontier = [h]
        for _ in range(depth):
            nxt = []
            for cur in frontier:
                nb = []
                if direction in ("up", "both"):
                    nb += [(p, (cur, p)) for p in self.works[cur]["parents"]]
                if direction in ("down", "both"):
                    nb += [(c, (c, cur)) for c in sorted(children.get(cur, []))]
                for n, e in nb:
                    edges.add(e)
                    if n not in seen:
                        seen.add(n)
                        order.append(n)
                        nxt.append(n)
            frontier = nxt
        nodes = [self._node(n) if n in self.works else {"content_hash": n, "unknown": True} for n in order]
        return {"wire": WIRE_VERSION, "status": "ok", "work": h, "direction": direction, "nodes": nodes,
                "edges": [{"child": c, "parent": p} for c, p in sorted(edges)]}

    def record_link(self, req):
        frm, to, rel = req.get("from"), req.get("to"), req.get("relation")
        if rel not in RELATIONS:
            raise WireError("bad_relation", f"relation must be one of {RELATIONS}")
        info = self.works.get(frm)
        if info is None:
            raise WireError("unknown_work", str(frm))
        if info["creator"] != req.get("creator_key_ref"):
            raise WireError("not_creator", "only the creator of the linking work can record its links")
        if not isinstance(to, str) or not to or to == frm:
            raise WireError("bad_link", "to must be another work's hash")
        link = {"from": frm, "to": to, "relation": rel, "pinned": bool(req.get("pinned", False)),
                "declared_by": req["creator_key_ref"]}
        if link not in self.links:
            self.links.append(link)
        return {"wire": WIRE_VERSION, "status": "linked", "link": link}

    def get_links(self, req):
        h, rel = req.get("work"), req.get("relation")
        if rel is not None and rel not in RELATIONS:
            raise WireError("bad_relation", f"relation must be one of {RELATIONS}")
        if not isinstance(h, str) or not h:
            raise WireError("bad_request", "work is required")
        links = [l for l in self.links if (l["from"] == h or l["to"] == h) and rel in (None, l["relation"])]
        return {"wire": WIRE_VERSION, "status": "ok", "work": h, "links": links}

    # ---- scene tags (PROPOSED, not locked) ---------------------------------
    def update_scene_tags(self, req):
        """Apply a tag change from one source. A model may only tighten:
        it can add a tag or raise a tier, never remove a tag or lower a tier."""
        source = req.get("source")
        if source not in ("author", "gm", "model"):
            raise WireError("bad_source", "source must be author, gm or model")
        tags = {(c["taxonomy"], c["tag"]): dict(c) for c in req.get("current", [])}
        ignored = []
        for c in req.get("add", []):
            key = (c["taxonomy"], c["tag"])
            old = tags.get(key)
            if old is None:
                tags[key] = dict(c, source=source)
            elif source == "model" and (c.get("tier") or 0) < (old.get("tier") or 0):
                ignored.append({"tag": c["tag"], "reason": "model_cannot_lower_tier"})
            else:
                tags[key] = dict(c, source=source)
        for c in req.get("remove", []):
            key = (c["taxonomy"], c["tag"])
            if source == "model":
                ignored.append({"tag": c["tag"], "reason": "model_cannot_remove"})
            else:
                tags.pop(key, None)
        out = sorted(tags.values(), key=lambda c: (c["taxonomy"], c["tag"]))
        return {"wire": WIRE_VERSION, "status": "proposed-rule", "contexts": out, "ignored": ignored}

    # ---- payments, paper money (v0.3-draft) ---------------------------------
    # Mirrors the shipped Route Manifest compiler (declared-split +
    # single-passthrough-v0): exact integer conservation, largest remainder,
    # the 2-hop cap, credited-but-unpaid. Execution is simulated; nothing moves.
    def _terms(self, subject, event_ref, standing_only=False):
        out = []
        for t in self.routing_terms:
            if t["subject"] != subject:
                continue
            if t["scope"] == "standing" or (not standing_only and t["scope"] == f"event:{event_ref}"):
                out.append(t)
        return out

    @staticmethod
    def _lr(amount, buckets):
        """Largest remainder, exactly as zephyr/routing.py _largest_remainder:
        floors, then leftover units by (-remainder, is_payer, id). Buckets are
        (id, bps, is_payer); returns amounts in bucket order."""
        floors = [(amount * bps) // 10000 for _, bps, _ in buckets]
        rest = amount - sum(floors)
        order = sorted(range(len(buckets)), key=lambda i: (-((amount * buckets[i][1]) % 10000),
                                                           1 if buckets[i][2] else 0, buckets[i][0] or ""))
        for i in order[:rest]:
            floors[i] += 1
        return floors

    def _compile(self, req):
        """Mirrors zephyr/routing.py compile_route_manifest (verified against the
        public mirror at 537d90f): the subject's direct terms are allocated with a
        payer bucket; then the parent's ONE standing term splits the direct leg
        paid to the PARENT's contributor, with that source leg as the tie-losing
        bucket. Both resulting legs carry edge_refs [subject, parent]."""
        work, amt, ref = req["work"], req["amount"], req["event_ref"]
        if not isinstance(ref, str) or not ref or len(ref) > 512:
            raise WireError("bad_request", "event_ref is a non-empty string of at most 512 characters")
        if not isinstance(amt, dict):
            raise WireError("bad_amount", "amount is an object {value, asset_code, asset_scale}")
        value = amt["value"]
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise WireError("bad_amount", "amount.value must be a non-negative integer")
        if not isinstance(amt.get("asset_code"), str) or not amt["asset_code"]:
            raise WireError("bad_amount", "amount.asset_code must be a non-empty string")
        scale = amt.get("asset_scale")
        if not isinstance(scale, int) or isinstance(scale, bool) or scale < 0:
            raise WireError("bad_amount", "amount.asset_scale must be a non-negative integer")
        info = self.works.get(work)
        if info is None:
            raise WireError("unknown_work", work)
        direct = self._terms(work, ref)
        seen = set()
        for t in direct:
            if not 0 <= t["share_bps"] <= 10000:
                raise WireError("bad_terms", "share_bps out of [0, 10000]")
            if t["beneficiary"] in seen:
                raise WireError("bad_terms", "duplicate beneficiary")
            seen.add(t["beneficiary"])
        total = sum(t["share_bps"] for t in direct)
        if total > 10000:
            raise WireError("bad_terms", "direct shares sum above 10000 bps")
        recursive = req.get("algorithm") == "recursive-passthrough-draft"
        parents = info.get("parents", [])
        if not recursive:
            if len(parents) > 1:
                raise WireError("depth_exceeded", "more than one parent (v0 has one derived_from; needs U5)")
            if parents:
                pts = self._terms(parents[0], ref, standing_only=True)
                if len(pts) > 1:
                    raise WireError("bad_terms", "more than one standing term on the parent")
                for gp in self.works.get(parents[0], {}).get("parents", []):
                    if self._terms(gp, ref, standing_only=True):
                        raise WireError("depth_exceeded", "lineage deeper than 2 hops carries terms (needs U5)")
        buckets = [(t["beneficiary"], t["share_bps"], False) for t in direct] + [(None, 10000 - total, True)]
        alloc = self._lr(value, buckets)
        payer = alloc[-1]
        direct_legs = sorted(((buckets[i][0], alloc[i]) for i in range(len(direct))), key=lambda x: x[0])
        legs = []
        for ben, amount in direct_legs:
            legs.extend(self._pass_up(ben, amount, work, [work], ref, recursive))
        assert payer + sum(l["amount"] for l in legs) == value
        return {"event": {"kind": req.get("kind", "purchase"), "ref": ref, "subject": work},
                "amount_in": amt, "payer_retained": payer, "legs": legs,
                "depth": max((len(l["edge_refs"]) - 1 for l in legs), default=0),
                "algorithm": "recursive-passthrough-draft" if recursive else "declared-split+single-passthrough-v0"}

    MAX_DEPTH = 16

    def _pass_up(self, ben, amount, work, path, ref, recursive):
        """Split the leg paid to `ben` at `work` by the standing term of each parent
        whose contributor is `ben`. v0: one parent, one level. The recursive DRAFT
        (U5; not the ratified DoD brief, which Seams hasn't seen) repeats this at
        every level and allows several parents. On v0-valid lineage both agree."""
        if len(path) > self.MAX_DEPTH:
            raise WireError("depth_exceeded", f"lineage deeper than {self.MAX_DEPTH} carries terms")
        matched = []
        for par in sorted(self.works.get(work, {}).get("parents", [])):
            if par in path:
                raise WireError("bad_lineage", "lineage cycle")
            pts = self._terms(par, ref, standing_only=True)
            if len(pts) > 1:
                raise WireError("bad_terms", "more than one standing term on a parent")
            if pts and self.works.get(par, {}).get("creator") == ben:
                matched.append((par, pts[0]))
        if not matched:
            return [self._leg(ben, amount, path)]
        tot = sum(t["share_bps"] for _, t in matched)
        if tot > 10000:
            raise WireError("bad_terms", "pass-through shares sum above 10000 bps")
        buckets = [(t["beneficiary"], t["share_bps"], False) for _, t in matched] + [(ben, 10000 - tot, True)]
        alloc = self._lr(amount, buckets)
        edges = path + [par for par, _ in matched]
        legs = [self._leg(ben, alloc[-1], edges)]
        for (par, t), a in zip(matched, alloc[:-1]):
            if recursive:
                legs.extend(self._pass_up(t["beneficiary"], a, par, path + [par], ref, True))
            else:
                legs.append(self._leg(t["beneficiary"], a, path + [par]))
        return legs

    def _leg(self, ben, amount, edges):
        wallet = self.wallets.get(ben)
        return {"beneficiary": ben, "amount": amount, "wallet_address": wallet,
                "leg_status": "routable" if wallet else "credited-unpaid", "edge_refs": edges}

    def quote_route(self, req):
        return {"wire": WIRE_VERSION, "status": "quoted", "manifest": self._compile(req)}

    def record_value_event(self, req):
        m = self._compile(req)
        mh = sha256(canonical(m))
        prior = self.manifests.get(req["event_ref"])
        if prior is not None and prior["hash"] != mh:
            strip = lambda x: [(l["beneficiary"], l["amount"]) for l in x["legs"]] + [x["payer_retained"]]
            if strip(prior["manifest"]) != strip(m):
                raise WireError("replay_conflict", "this event_ref was already allocated differently")
        self.manifests[req["event_ref"]] = {"hash": mh, "manifest": m}
        receipts = [{"beneficiary": l["beneficiary"], "amount": l["amount"],
                     "state": "simulated" if l["leg_status"] == "routable" else "pending-credited"}
                    for l in m["legs"]]
        return {"wire": WIRE_VERSION, "status": "recorded", "manifest_hash": mh,
                "manifest": m, "receipts": receipts, "executor": "simulated"}

    def declare_terms(self, req):
        t = req["routing_terms"]
        for k in ("subject", "beneficiary", "share_bps"):
            if k not in t:
                raise WireError("bad_terms", f"missing {k}")
        info = self.works.get(t["subject"])
        if info is None or info["creator"] != req["creator_key_ref"]:
            # Same rule as declare. The shipped compiler takes any registered
            # key's term on any work ("route squatting"), so the wire refuses it.
            raise WireError("not_creator", "only the work's creator key can declare a split on it")
        if info.get("suggested"):
            raise WireError("suggested_work", "no splits on a suggested work: nobody holds authority over it")
        t = dict(t, scope=t.get("scope", "standing"), declared_by=req["creator_key_ref"])
        self.routing_terms.append(t)
        return {"wire": WIRE_VERSION, "status": "declared"}

    def handle(self, msg):
        out = self._handle(msg)
        if isinstance(msg, dict) and "id" in msg:
            out["id"] = msg["id"]
        return out

    def _handle(self, msg):
        if not isinstance(msg, dict):
            return {"wire": WIRE_VERSION, "error": "bad_request", "message": "a request is a JSON object"}
        op = msg.get("op")
        try:
            if op == "check_use":
                return self.check_use(msg)
            if op == "emit":
                return self.emit(msg)
            if op == "declare":
                return self.declare(msg)
            if op == "update_scene_tags":
                return self.update_scene_tags(msg)
            if op == "quote_route":
                return self.quote_route(msg)
            if op == "record_value_event":
                return self.record_value_event(msg)
            if op == "declare_terms":
                return self.declare_terms(msg)
            if op == "get_lineage":
                return self.get_lineage(msg)
            if op == "record_link":
                return self.record_link(msg)
            if op == "get_links":
                return self.get_links(msg)
            if op == "hello":
                return {"wire": WIRE_VERSION, "capabilities": list(CAPABILITIES),
                        "aspects": list(ASPECTS), "impl": "seams-stub",
                        "kinds": list(KINDS), "origins": list(ORIGINS),
                        "ops": {"check_use": "locked", "emit": "locked", "declare": "locked",
                                "update_scene_tags": "proposed", "quote_route": "draft",
                                "record_value_event": "draft", "declare_terms": "draft",
                                "get_lineage": "proposed", "record_link": "proposed",
                                "get_links": "proposed"}}
            raise WireError("unknown_op", str(op))
        except WireError as e:
            return {"wire": WIRE_VERSION, "error": e.code, "message": str(e)}
        except (KeyError, TypeError, AttributeError, ValueError) as e:
            return {"wire": WIRE_VERSION, "error": "bad_request", "message": f"{type(e).__name__}: {e}"}


def strip(actual, expected):
    """Compare only the keys the vector pins."""
    if isinstance(expected, dict):
        return {k: strip(actual.get(k) if isinstance(actual, dict) else None, v) for k, v in expected.items()}
    if isinstance(expected, list) and isinstance(actual, list) and len(actual) == len(expected):
        return [strip(a, e) for a, e in zip(actual, expected)]
    return actual


def run_vectors(paths):
    failed = total = 0
    for path in paths:
        with open(path) as f:
            suite = json.load(f)
        for case in suite["cases"]:
            stub = Stub()
            stub.load_fixture(suite.get("fixture", {}))
            for step in case.get("setup", []):
                stub.handle(step)
            got = stub.handle(case["request"])
            total += 1
            if strip(got, case["expect"]) != case["expect"]:
                failed += 1
                print(f"FAIL {path}::{case['name']}\n  expect {case['expect']}\n  got    {got}")
    print(f"{total - failed}/{total} vectors pass")
    return failed == 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--vectors":
        sys.exit(0 if run_vectors(args[1:]) else 1)
    stub = Stub()
    if args and args[0] == "--fixture":
        with open(args[1]) as f:
            stub.load_fixture(json.load(f).get("fixture", {}))
    for line in sys.stdin:
        if line.strip():
            try:
                msg = json.loads(line)
            except ValueError as e:
                print(json.dumps({"wire": WIRE_VERSION, "error": "bad_json", "message": str(e)}), flush=True)
                continue
            print(json.dumps(stub.handle(msg)), flush=True)
