# LAISI Roadmap

## Phase 1: Foundation (current state)

### Done
- [x] Workflow-driven architecture: phases defined in YAML, not TypeScript
- [x] Generic `runPhase()` core loop: skeleton generation → Claude → validate → retry
- [x] XSD skeleton generation from schemas (full recursive traversal)
- [x] Workflow-driven state machine (no hardcoded phase names)
- [x] CLI: `laisi run`, `laisi status`, `laisi init --workflow <name>`
- [x] GitHub integration: issue discovery, git commit/push
- [x] Human gate system: `always`, `on_field`, `on_failure`
- [x] `.gate` files for retry exhaustion
- [x] Unit tests (24 tests, vitest)
- [x] Example workflow: `github-issue-intake`

### Open: Create first complete workflow
- [ ] Define `schemas/intent.xsd` — IntentSpec schema for the intent phase
- [ ] Write `prompts/01-intent.md` — prompt template for intent extraction
- [ ] Define `schemas/scope.xsd` — scope schema
- [ ] Write `prompts/02-scope.md` — prompt template for scope mapping
- [ ] End-to-end test: run a real GitHub issue through intent → scope

---

## Phase 2: Hardening

### Orchestrator
- [ ] Priority logic for multi-issue selection (currently: first actionable)
- [ ] Timeout handling for Claude sessions
- [ ] `.pending` file resolution: detect new comments and resume

### Validation
- [ ] Deeper XSD validation (enum values, cardinality, data types)
- [ ] Save raw Claude output alongside `.gate` files for debugging

### Testing
- [ ] Integration test: mock Claude, run full `runPhase()` cycle
- [ ] Test `extractXml` edge cases (malformed output, missing tags)
- [ ] Test orchestrator flow (`run.ts`) with mock GitHub/Claude

---

## Phase 3: Extensions

### More Workflows
- [ ] Implementation workflow (intent → scope → implement → verify → PR)
- [ ] Bug-fix workflow (triage → reproduce → fix → verify)
- [ ] Documentation workflow (analyze → draft → review)

### Tool-Using Phases
- [ ] Validate implementation phase: Claude with `Edit/Write/Read/Bash` tools
- [ ] Git staging for tool-using phases (only on success)

### Observability
- [ ] `laisi status` with workflow progress bars
- [ ] Metrics: average time per phase
- [ ] Alerts: notification when issue is gated for > X hours

### Configuration
- [ ] Prompt variable substitution (pass config preferences to prompts)
- [ ] Per-project workflow overrides (extend a base workflow)

---

## Open Decisions

1. **Prompt Variables**: Should `loadPrompt()` substitute workflow-level variables
   (e.g., `${TECH_STACK}` from `.laisi.yml`) or keep prompts self-contained?

2. **Workflow Composition**: Should workflows support includes/extends
   (e.g., a base workflow with optional phases)?

3. **Parallelism**: May the orchestrator work on multiple issues simultaneously?
   Currently: one step per trigger (serial by design).

4. **Pending Resolution**: How should the orchestrator detect that a human
   has reviewed a `.pending` phase? Options: new GitHub comment, manual
   file rename, CLI command (`laisi approve <issue> <phase>`).
