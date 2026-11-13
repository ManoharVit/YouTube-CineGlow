# Project Rules: CineGlow Pro for YouTube

# Swarm Execution Policy

- **DEFAULT (Single Agent):** Handle simple Q&A, single-file edits, isolated bug fixes, and sequential logic directly in the primary agent without spawning a swarm.
- **MANDATORY SWARM TRIGGER:** You MUST invoke the Swarm action skill whenever a request involves any of the following:
  1. Modifying or creating **3 or more independent files** across different modules or layers (e.g., frontend + backend + tests).
  2. **Parallelizable research or audits** (e.g., scanning multiple directories for security issues, deprecations, or pattern mismatches simultaneously).
  3. **Multi-step workflows** where implementation, documentation, and test generation can run concurrently without blocking each other.
- **COORDINATION RULE:** Before spawning sub-agents, assign explicit, non-overlapping file ownership to each worker so two agents never edit the same file simultaneously.
- **SWARM LIFECYCLE:** When triggered:
  1. Size the swarm and assign dedicated, non-colliding file/task ownership (`add{name, brief}`).
  2. Name the swarm (`swarm{action:"title", title:"..."}`).
  3. Spawn a `verifier` to independently review diffs and test outputs.
  4. Spawn `monitor` when `swarm_monitor` skill is available.
  5. Coordinate on the board, park with `swarm_wait`, and post `[done] <summary>` before concluding.

## Git Commit & Push Protocol (HARD RULE)

- **Explicit Approval Required**: NEVER run `git commit` or `git push` automatically or proactively.
- **Strict Wait for Confirmation**: Always make changes, build packages, run tests, present diffs/status, and wait for explicit user approval before executing any commit or push.
- **Attribution**: Author attribution must remain Giri Manohar Vemula ([LinkedIn](https://www.linkedin.com/in/manoharv511) · [GitHub](https://github.com/ManoharVit)).

# Global Execution Hard Rules

## Always-On Rules (Every Prompt)
1. **Scope Before Edit:** Before modifying any file, verify the file path exists and read surrounding context to match existing conventions and imports.
2. **Safety & Secrets:** Never output values from `.env` or credential files. Never execute destructive shell commands (`rm -rf`, force-push, database drops) without asking first.
3. **Concise Output:** Skip introductory filler and closing summaries. Report only actions taken, verification results, and blockers.

## Mandatory Action-Skill Triggers
- **On Any Code Edit (`verify-build`):** Run the project's fast linter or typechecker on modified files before finishing. Never leave broken imports or syntax errors.
- **On Command Failure or Stack Trace (`systematic-debug`):** Do not guess fixes. Read the full error output, trace the failing call site, and verify the fix by re-running the failing command.
- **On UI / Frontend Changes (`browser-verify`):** Check console output and rendered layout in the browser preview before confirming completion.
- **On Multi-Module Tasks (`swarm`):** Invoke the Swarm skill only when 3 or more independent files require concurrent edits or parallel codebase scanning, assigning strict non-overlapping file ownership to each worker.
