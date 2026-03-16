# Agent: Dispatcher

> I determine WHICH issue is processed and WHICH phase is next.
> I am not an AI agent – I am pure logic, implemented in TypeScript.

## Identity

I am the entry point of every `laisi run`. I make no creative
decisions – I read the filesystem state and apply deterministic
rules.

## My Algorithm

### 1. Discover New Issues

```
For each issue assigned to me on GitHub:
  If no directory .issues/{nr}/ exists:
    → Create directory
    → Fetch 0-issue.json (gh issue view)
```

### 2. Per Issue: Determine Next Phase

I check which files exist and derive the next step from that:

```
.issues/{nr}/
  No 1-explore-*.xml?                    → Phase: EXPLORE
  1-explore-N.pending.xml?               → Check: New reply in issue?
                                            Yes → Phase: EXPLORE (again)
                                            No → Waiting. Skip.
  1-explore-N.xml, no 2-plan-*.xml?      → Phase: PLAN
  4-check-N.failed.xml?                  → Phase: PLAN (Replan)
  2-plan-N.xml, no 3-do-*.xml?           → Phase: DO
  3-do-N.xml, no 4-check-*.xml?          → Phase: CHECK
  4-check-N.xml, no 5-act-*.xml?         → Phase: ACT
  5-act-N.xml, no 6-release-*.xml?       → Check: PR merged?
                                            Yes → Phase: RELEASE
                                            No → Waiting. Skip.
  6-release-N.xml?                       → Done. Skip.
```

### 3. Prioritization: Which Issue First?

When multiple issues have a next step, I choose by
**workflow progress** – issues that are further along take priority:

```
Priority 1 (highest): Release
Priority 2: Act
Priority 3: Check
Priority 4: Plan (incl. Replan)
Priority 5: Do
Priority 6: Explore
```

Rationale: Better to finish one issue than to start three.

### 4. Execute Exactly ONE Issue, ONE Phase

I select the issue with the highest priority and hand off to the
corresponding phase agent. Then my job is done.

## Implementation

- State logic: `src/lib/state.ts` → `determineAction()`, `scanAllIssues()`
- Orchestration: `src/commands/run.ts`
- GitHub checks: `src/lib/github.ts` → `hasNewCommentsSince()`, `isPrMerged()`

## Replan Logic (Special Case)

When `4-check-N.failed.xml` exists and is the most recent check file:
1. Delete all `2-plan-*.xml` and `3-do-*.xml`
2. Restart the Plan phase with `4-check-N.failed.xml` as additional input

This is handled in the orchestrator (`src/commands/run.ts`),
before the Plan agent is invoked.
