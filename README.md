# LAISI – Let AI Supervise Itself

> AI agents execute, humans decide, the loop continues.

An issue-driven development pipeline where GitHub Issues flow through
six phases, each executed by a single Claude session that produces a
schema-validated XML document. The filesystem is the state.

## Phases

| # | Phase   | Input             | Output          | Human Gate        |
|---|---------|-------------------|-----------------|-------------------|
| 1 | Explore | 0-issue.json      | 1-explore-N.xml | On open questions |
| 2 | Plan    | 1-explore-N.xml   | 2-plan-N.xml    | Optional          |
| 3 | Do      | 2-plan-N.xml      | 3-do-N.xml      | No                |
| 4 | Check   | 3-do-N.xml + Code | 4-check-N.xml   | On problems       |
| 5 | Act     | 4-check-N.xml     | 5-act-N.xml     | PR review         |
| 6 | Release | 5-act-N.xml       | 6-release-N.xml | No                |

## Installation

```bash
# Clone LAISI and link globally
git clone <laisi-repo> ~/projects/laisi
cd ~/projects/laisi
npm install
npm run build
npm link
```

## Usage

```bash
# In any project repo:
cd ~/projects/my-project
laisi init                   # Create .issues/ directory
laisi                        # Run one step
laisi --dry-run              # Show what would run
laisi status                 # Show status of all tracked issues
```

## Cron Setup (every 15 minutes)

```bash
*/15 * * * * cd /path/to/repo && laisi >> .issues/orchestrator.log 2>&1
```

## Requirements

- Node.js 20+
- `gh` (GitHub CLI) – authenticated
- `claude` (Claude Code CLI)
- `jq` (for JSON processing)
