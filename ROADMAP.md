# LAISI Roadmap

## Phase 1: Foundation (current state)

### Done
- [x] Architecture defined (orchestrator + phases + state convention)
- [x] TypeScript project set up (tsx, fast-xml-parser)
- [x] `src/lib/claude.ts` – Claude wrapper with XML validation + retry
- [x] `src/lib/state.ts` – Filesystem state reading + action determination
- [x] `src/lib/github.ts` – Git + GitHub CLI wrapper
- [x] `src/orchestrator.ts` – Single-shot, priority-based dispatch
- [x] `src/types.ts` – Central type definitions
- [x] Explore phase complete: schema + prompt + phase handler
- [x] Example issue #42 with pending.xml as reference

### Open: Flesh out schemas + prompts

#### Plan Phase (`schemas/plan.xsd` + `prompts/plan.txt` + `src/phases/plan.ts`)
- [ ] Define schema: which files will be changed, what exactly
      changes in each file, expected result, test plan
- [ ] Prompt: Claude receives explore.xml, must create an implementation
      plan achievable in ONE do session
- [ ] Implement phase handler
- [ ] Add types to types.ts (PlanResult)
- [ ] Decide: Does plan need a human gate? (Plan review before do?)

#### Do Phase (`schemas/do.xsd` + `prompts/do.txt` + `src/phases/do.ts`)
- [ ] Define schema: changed files, diffs/summary,
      whether tests were written, commit message
- [ ] Prompt: Claude receives plan.xml and implements. IMPORTANT:
      This is the only phase that uses `claude` instead of `claude --print`
      (`callClaudeInteractive` in claude.ts)
- [ ] Implement phase handler
- [ ] Add types to types.ts (DoResult)
- [ ] Decide: How do we give Claude access to code context
      without overloading the prompt?

#### Check Phase (`schemas/check.xsd` + `prompts/check.txt` + `src/phases/check.ts`)
- [ ] Define schema: lint results, test results, security scan,
      AI code review findings, overall status (passed/failed)
- [ ] Prompt: Claude reviews code against the requirements
- [ ] Phase handler: first deterministic checks (lint, test, build),
      then Claude for AI review. Both go into the XML.
- [ ] Decide: Which tools? → Must be project-configurable

#### Act Phase (`schemas/act.xsd` + `prompts/act.txt` + `src/phases/act.ts`)
- [ ] Define schema: PR URL, PR body, learnings, rule updates
- [ ] Prompt: Claude summarizes, creates PR body, identifies learnings
- [ ] Phase handler: `gh pr create`, post issue comment
- [ ] Decide: Should act also update CLAUDE.md or project rules?

#### Release Phase (`schemas/release.xsd` + `prompts/release.txt` + `src/phases/release.ts`)
- [ ] Define schema: tag, version, changelog entry, deploy status
- [ ] Prompt: Claude generates changelog entry from all phase XMLs
- [ ] Phase handler: `git tag`, update changelog, optionally trigger deploy
- [ ] Decide: Semantic versioning automatic? Or from issue labels?

---

## Phase 2: Hardening

### Orchestrator
- [ ] Timeout for Claude sessions (what if Claude hangs?)
- [ ] `npm run status` – overview of all issues and their state
- [ ] Multiple issues in parallel? Or deliberately stay serial?

### Validation
- [ ] XSD schema validation in addition to well-formed check
      (currently only XML well-formedness via fast-xml-parser)
- [ ] Fallback: save raw output for debugging (already prepared)

### Git Integration
- [ ] Branch strategy: one branch per issue (`issue-{nr}`)
- [ ] Merge conflicts when multiple issues run in parallel?

### Testing
- [ ] Unit tests for state.ts (parseIssueFile, determineAction)
- [ ] Integration test: run mock issue through all phases

---

## Phase 3: Extensions

### Observability
- [ ] `npm run status` → table of all issues + phase + status
- [ ] Metrics: average throughput time per phase
- [ ] Alerts: notification when issue has been pending for X hours

### Configuration
- [ ] `.laisi.yml` in repo root for project-specific settings
      (test commands, lint commands, branch prefix, etc.)
- [ ] Per-issue overrides via GitHub labels?

### Self-improvement (Meta)
- [ ] Act phase writes learnings to a knowledge base
- [ ] Explore phase reads previous learnings as context
- [ ] Prompt templates are improved from experience

---

## Open Decisions

1. **Plan Human Gate**: Should the human approve the plan before
   do starts? Pro: safety. Con: slowdown.

2. **Do Phase Code Context**: How does Claude get the relevant code
   without context overflow? Options:
   - Plan explicitly lists which files Claude should read
   - Claude gets full repo access via `callClaudeInteractive`

3. **Check Phase Tools**: Hardcoded or configurable?
   First approach: use `package.json` scripts if available.

4. **Versioning**: Semantic versioning automatic or manual?

5. **Parallelism**: May the orchestrator work on multiple issues
   simultaneously? Currently: no (one step per trigger).
