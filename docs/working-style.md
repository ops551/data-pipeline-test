# Working Style

How work gets delivered on this project.

## Communication

- Short answers. Lead with the conclusion, not the reasoning.
- No long multi-section essays unless a report, checklist or detailed
  breakdown was asked for.
- If something is broken or uncertain, say so plainly **first** — never bury
  bad news under context.
- Before writing a unit's code, explain briefly in Bangla what the unit does
  and which files it touches. Then build it.

## Git — hard rules

- **Commit frequently.** Make as many commits as possible for small logical steps.
- **Do not push.** Gemini will commit locally but will NEVER push. Nahid will handle pushing.
- **Signal when done.** Just tell Nahid "I have committed the changes, you can push now" when a unit is ready.
- **Never run destructive git commands** (`reset --hard`, `checkout .`,
  force-push, `branch -D` on an unmerged branch) without being asked for that
  exact action in that moment.
- Before any command that could discard uncommitted work, check `git status`.
  If something unfamiliar is in the working tree, ask before touching it.
- `.env` is never committed. Check `git status` before every commit to make
  sure no secret is staged.
- Git rarely deletes anything immediately. A "lost" commit is usually still
  reachable by hash (`git cat-file -t <hash>`) even after a bad `reset --hard`.
  Diagnose before treating work as gone.

## Branches

One branch per unit, named `phase-<n>-unit-<n>`:

```
phase-1-unit-1
phase-1-unit-2
```

Branch from `main`, build the one unit, test it, merge it, delete it. Only
`main` and the current unit's branch should exist at any time.

## The build loop

Every unit goes through exactly this loop, one unit at a time:

1. **Plan first.** Every unit is listed in `docs/checklist.md` before any
   code is written: what it does, which files it touches, how it is tested.
2. **Branch.** `git checkout -b phase-<n>-unit-<n>` from an up-to-date `main`.
3. **Build.** Only that unit. Nothing from the next one.
4. **Test.** Run `npm test` and, if the unit touches the API or the CSV,
   actually run the script against the real Companies House API with the
   key from `.env`. Do not call a unit done on a green unit test alone.
5. **Commit and push.** Commit on the branch, push the branch to `origin`.
6. **Merge.** Merge into `main` and push `main`.
7. **Delete the branch.** Both on GitHub and locally.
8. **Tick the checklist.** Mark the unit done in `docs/checklist.md`, commit
   that on `main`, push.
9. Only then start the next unit.

If a test fails, fix it on the same branch before merging. Never merge red.

## Code quality

- Minimal comments — **one line**, two at the absolute most, and only where the
  *why* is genuinely not visible from the code. Never a "what". Heavy
  commenting makes diffs noisy and reads as AI-generated.
- Careful and deliberate over fast. The goal is not landing in a state that
  needs a bug-fix pass later.
- No premature abstraction, no speculative flexibility for hypothetical future
  needs. Solve the task in front of you.
- Keep it beginner-friendly: small files, plain functions, no clever tricks.
- CSV columns come only from fields Companies House actually returns. Never
  invent an API field or endpoint. Check the official docs before touching
  the integration.

## Verification, before calling anything done

```bash
npm test      # node --test, no extra test framework
npm start     # real run against the Companies House API
```

- Unit tests cover pure logic (date range, pagination maths, dedupe, CSV
  formatting) without hitting the network.
- The real run is the final check. Open `companies.csv` and confirm the
  columns and a few rows look right.
- Never leave a half-written `companies.csv` or debug output committed.

## Trust but verify

- Do not take a generated summary, review or "this matches" claim at face
  value — including earlier output in the same session. Check it against the
  real, current state before reporting it as fact.
- A memory, note or doc is a point-in-time snapshot, not live truth. Re-verify
  against the current code before relying on it, especially after a context
  reset.
