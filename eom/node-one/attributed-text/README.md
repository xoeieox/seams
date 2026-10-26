# One page of text, with attribution

A demo of the attribution part of Seams. One page of text anyone can edit. Every save is logged, and every word keeps the name of whoever wrote it. Consent is "all changes", compensation is none.

Zero dependencies, Node 18+.

## Run it

```
node server.mjs                 # http://localhost:8080
PORT=3000 node server.mjs
```

On start it prints an **admin token** (also in `data/admin-token.txt`, or set `ADMIN_TOKEN`). Open `/#/admin` once on your phone and paste it. Old versions then show "Restore this version".

For the dinner, from a laptop: `cloudflared tunnel --url http://localhost:8080` gives a public https URL with no account. Rate limiting trusts the `cf-connecting-ip` / `x-forwarded-for` headers, so run it behind such a proxy or only on a trusted network.

**Seed text:** edit `seed.json` (`author`, `text`). It is used only when `data/log.jsonl` does not exist. To reseed, stop the server and delete `data/`. The current seed is Erah's poem.

## What it does

- Main page: the current text, a version line, and four buttons (Edit, Colour by author, Names, History).
- Saving needs a name. Names are case-insensitive, and the first spelling used is kept.
- Names: everyone who has edited, with edit count and how many of their words survive. Tapping one opens their **lineage**: their surviving words highlighted in the current text, each change they made (what they replaced, what they added) and what others later did to their words.
- History: every version, read-only, with colours if toggled. Nothing is deleted.
- Concurrent edits: if you saved from an old version, the server three-way merges when the changes are far apart, and asks you to reload when they touch.
- Limits: 10 saves per 10 min per IP, 80 per 10 min overall, 8000 characters, 40-character names, 64 KB bodies (`EDIT_LIMIT`, `GLOBAL_LIMIT`, `WINDOW_MS`).
- Admin revert: adds a new version equal to an old one (original authorship restored), logged like any edit.
- `/api/export`: the log as JSON, also linked from the About page.

## How authorship works

Each save is split into words, spaces and punctuation, then diffed (longest common subsequence) against the current version. Matching tokens keep their original author and version; new tokens belong to the saver. Changes separated only by whitespace count as one change. Removed tokens are recorded with their original authors, which drives the lineage view.

## Gaps compared with the protocol in design

- **No identity.** Names are typed, and anyone can use anyone's. No keys, signatures or accounts.
- **Retyped or moved text is credited to whoever typed it.** A word diff cannot tell a copy from an original, and a moved sentence appears as a delete plus an insert.
- **Diff artefacts.** A small edit can be credited oddly (common words may stay with the earlier author).
- **No per-aspect consent, revocation or payments.** One fixed grant: anyone may change, nobody is paid.
- **Rate limiting by IP header** can be spoofed if the server is exposed directly.
- **Single process, one JSON-lines file.** No backups; copy `data/` if it matters.

### Export format

`/api/export` is **shaped after** the `emit` fields of `seams-wire/0.1-draft` (`kind`, `parents`, `derivation`, `creator_ref`, `provenance`, `use_terms`), with one hash-chained entry per version. It is **not valid wire v0** and was not run against the stub or vectors. `creator_ref` is `name:<typed name>` with `creator_verified: false`, hashes are plain sha256 of the text rather than the Seams deposit hash, and `text` is not in the wire `kind` vocabulary.

## Tests

`npm test` covers the diff, attribution, merge, revert, persistence and export.
