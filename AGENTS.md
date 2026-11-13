# Project Rules: CineGlow Pro for YouTube

## Mandatory Swarm Execution (HARD RULE)

- **Universal Swarm Requirement**: For all tasks, implementation, fixes, reviews, and investigations on CineGlow Pro, ALWAYS use `/swarm` (native swarm).
- **Coordinator Boundary**: The coordinator must remain free to track and manage workers, judges deliverables, and interface with the user. Do not perform direct implementation or refactoring inline as coordinator.
- **Worker Allocation**:
  - Split work into non-colliding pieces: one worker per target file or component.
  - Always spawn a dedicated `verifier` worker to run `npm test`, inspect diffs, verify package builds, and check SHA-256 integrity.
  - Spawn `monitor` when `swarm_monitor` skill is available.
- **Verification & Integrity**:
  - Every change must pass all 346+ tests across 66 suites (`npm test`).
  - Repackage `YouTube-CineGlow-v2.4.0.zip` with `npm run package` whenever codebase files change.
  - Update and verify SHA-256 in `test/e2e-enterprise-coexistence.test.js`, `PACKAGE_SUMMARY.md`, `enterprise/pilot-rollout-runbook.md`, and `enterprise/global-rollout-schedule.md`.
  - Author attribution must remain Giri Manohar Vemula ([LinkedIn](https://www.linkedin.com/in/manoharv511) · [GitHub](https://github.com/ManoharVit)).
