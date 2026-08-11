# Pipeline state transitions

This state model separates durable completed progress from the current execution attempt. A transition is valid only when its conditional SQLite update still matches the state that the caller observed.

| Event | `completed_step` | `active_step` | `run_state` | `attempt_id` / `started_at` | Error fields |
| --- | --- | --- | --- | --- | --- |
| Claim next step | unchanged | `completed_step + 1` | `RUNNING` | new UUID / current time | cleared |
| Complete matching attempt | increment to `active_step` | `null` | `IDLE` | cleared | cleared |
| Fail matching attempt | unchanged | unchanged | `FAILED` | retained for traceability | set from failure |
| Recover matching stale attempt | unchanged | unchanged | `INTERRUPTED` | retained for traceability | set to `STALE_ATTEMPT` |
| Retry failed/interrupted step | unchanged | unchanged | `RUNNING` | new UUID / current time | cleared |

## Invariants

- Only step `completed_step + 1` can be claimed.
- `RUNNING`, `FAILED`, and `INTERRUPTED` always identify the current `active_step` and its latest attempt.
- A successful result write requires the same project, user, `RUNNING` state, `active_step`, and `attempt_id`. An old worker becomes a no-op after retry or recovery.
- Duplicate claim requests for the same running step are idempotent: the winner reports `claimed: true`; later callers report `claimed: false` with the current state.
- Recovery is user-triggered. Its update re-checks project/user ownership, `RUNNING`, `attempt_id`, the exact observed `started_at`, and the configured stale cutoff. A completion that wins the race makes recovery a no-op.
- Recovery never starts a retry. Retry always creates a new attempt and clears the previous error.
- No transaction remains open while external work runs.

## HTTP mapping

The real step-start endpoint will be added with the first Gemini-backed step in Milestone 3. Its claim result maps to `202 Accepted` when `claimed: true`, `200 OK` when a duplicate receives `claimed: false`, and `409 Conflict` only for a genuinely invalid step order.

Milestone 2 exposes persisted state and stale recovery, but deliberately does not ship a fake production step runner.
