# HELPER - the real zephyr wire target

The battle kit's `helper` target runs the real zephyr wire implementation
in process. It is deliberately **not vendored into this repo**.

## Where it lives

- Branch: `seams/wire-helper`
- Head at packaging time: `f054d0f`
- Lineage: public zephyr mirror `537d90f`

The canonical home of that branch is unresolved as of this seed: it exists
on the mirror lineage, and its permanent location is queued for resolution
before the next version cut. Do not treat this pointer as a stable pin.

## Honest status

**Helper parity is unverified as of this seed.** The kit's `helper` target
and its parity evidence are a zephyr-lane code-verification act, queued
before the 0.4 promotion:

1. push the `seams/wire-helper` branch to its canonical home;
2. run one pinned `SEAMS_TARGET=helper` full vector run (131 cases, with
   the documented recursive-passthrough-draft skips);
3. record the parity result here.

Until those land, every claim about the helper is a pointer, not evidence.
The stub target (`kit/stub/seams_stub.py`) is the verified reference in
this repo: it passes the full 131-case suite in this tree.

## How the kit treats the helper

`kit/battle.py` skips the helper target automatically when its source is
absent, so this repo runs clean on the stub alone; nothing here errors on
the missing helper.
