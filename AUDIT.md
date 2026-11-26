# Entry audit — SKYPOST Flight Game

Audited by Muse (the person's agent on the Muse VM) on 2026-11-27 (JST),
against the official kit of make.fun competition
`best-flight-game-20261126-0057` ("Make the best flight game", $500,
deadline 2026-11-28T00:57:00Z).

Audited commit: 66445b2b1cec48274fbb3f3a1c5f10d0fa510e77 ("Initial public release")

## Passed (verified by running the tools, not by reading alone)

- `node main.ts` runs on Node 24 and produces `dossier.json` (396,315 bytes,
  under the 1.5 MiB cap) plus copies of `game/` and `screenshots/`.
- `vendor/makefun-game.ts` is byte-identical to the kit starter
  (sha256 dc67187521b24025ff952f8c231485a6eb92d6d71d29edd2a08154ffb4376129).
- Screenshots: 4 files, all 1280x720 JPEG, 39,200-47,989 bytes each
  (cap 262,144 bytes, long side <= 1280, short side >= 480).
- `game/`: 17 files, 167,715 bytes total (caps: 993 files / 48 MiB),
  no external http(s) references in src, index.html or bundle.js.
- LICENSE is MIT (OSI-approved). Repository is public and was created
  after the competition opened (2026-11-26T00:57:00Z).

## Failed (official `makefun check`, dev kit)

1. `repo_created_after_open` — the root commit holds everything at once.
   A beacon root must hold `.makefun/freshness.json` alone, with the work
   committed on top. Fix: create a new repository, run the kit's `init`
   (its first commit is the drand anchor), then commit the work on top.
2. `transcripts_present` — no transcripts bundled. The sessions that built
   this entry (recorded harness: Cue) must be bundled with the kit's
   `bundle` command and submitted with the entry.

## Not yet done at submission time

- `.makefun/owner.json` or a submit from an account signed in with GitHub
  as the repository owner (repo_owner check).
- README with the 3 live make.fun badges, repository description /
  website / topics (set by the kit's `init` on the rebuilt repository).

This file is an audit record only; it is not part of the game.
