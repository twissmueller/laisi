# LAISI – Let AI Supervise Itself

> Issue-driven AI Development Pipeline.
> Jedes Issue durchläuft 6 Phasen, jede Phase hat einen eigenen Agenten.

## Dispatch

Wenn du eine Aufgabe in diesem Projekt ausführen sollst, folge diesem Baum:

```
Was soll ich tun?
│
├── Ein Issue bearbeiten (laisi run)?
│   │
│   ├── 1. Lies: agents/dispatcher.md
│   │      → Der Dispatcher bestimmt WELCHES Issue und WELCHE Phase.
│   │
│   └── 2. Der Dispatcher leitet dich zum richtigen Phase-Agenten:
│          │
│          ├── Explore  → agents/explore.md
│          ├── Plan     → agents/plan.md
│          ├── Do       → agents/do.md
│          ├── Check    → agents/check.md
│          ├── Act      → agents/act.md
│          └── Release  → agents/release.md
│
├── Status abfragen (laisi status)?
│   └── Lies: src/commands/status.ts
│
├── Am Framework selbst arbeiten?
│   └── Lies: ARCHITECTURE.md (unten)
│
└── Roadmap / Was fehlt noch?
    └── Lies: ROADMAP.md
```

## Agenten-Übersicht

| Agent      | Datei                  | Aufgabe                                   |
|------------|------------------------|-------------------------------------------|
| Dispatcher | `agents/dispatcher.md` | Issue + Phase bestimmen                   |
| Explore    | `agents/explore.md`    | Requirements extrahieren + Quality Gates  |
| Plan       | `agents/plan.md`       | Umsetzungsplan für eine Claude-Session    |
| Do         | `agents/do.md`         | Code implementieren                       |
| Check      | `agents/check.md`      | Lint, Test, AI Code Review                |
| Act        | `agents/act.md`        | PR erstellen, Learnings dokumentieren     |
| Release    | `agents/release.md`    | Tag, Changelog, Deploy                    |

Jeder Agent hat:
- **Identität** – Wer bin ich, was ist meine Rolle?
- **Input** – Welche Dateien lese ich?
- **Output** – Welche Datei produziere ich (Schema-Referenz)?
- **Regeln** – Was muss ich beachten?
- **Human Gate** – Wann warte ich auf einen Menschen?

---

## ARCHITECTURE.md (für Framework-Entwicklung)

### Verzeichnisstruktur

```
agents/                       ← Agenten-Definitionen (Markdown)
schemas/                      ← XSD-Schemas (Vertrag für Agent-Outputs)
prompts/                      ← Prompt-Templates (werden von Agents geladen)
src/
  cli.ts                      ← CLI Entry Point
  types.ts                    ← Typdefinitionen (sync mit Schemas!)
  commands/
    run.ts                    ← Orchestrator: ein Trigger, ein Schritt, Exit
    status.ts                 ← Übersicht aller Issues
    init.ts                   ← .issues/ initialisieren
  lib/
    state.ts                  ← Dateisystem → State + Action-Bestimmung
    claude.ts                 ← Claude-Aufruf mit XML-Validierung + Retry
    github.ts                 ← Git + gh CLI Wrapper
    logger.ts                 ← Logger
  phases/
    explore.ts … release.ts   ← Phase-Handler (rufen Claude mit Prompt auf)
```

### Datei-Konventionen im Projekt-Repo

```
.issues/{nr}/
  0-issue.json                 ← Rohdaten vom GitHub Issue
  1-explore-{iter}.xml         ← Explore abgeschlossen
  1-explore-{iter}.pending.xml ← Wartet auf Mensch
  2-plan-{iter}.xml
  3-do-{iter}.xml
  4-check-{iter}.xml           ← Check bestanden
  4-check-{iter}.failed.xml    ← Check fehlgeschlagen → Replan
  5-act-{iter}.xml
  6-release-{iter}.xml         ← Fertig
```

Höchste Iteration zählt. Suffix bestimmt Status.

### Prinzipien

- **Ein Trigger, ein Schritt, Exit.**
- **Dateien sind State.** `ls .issues/42/` ist das Dashboard.
- **Schemas sind der Vertrag.** Agent-Output wird validiert.
- **Kontext-Isolation.** Jeder Agent bekommt nur das Übergabe-XML der Vorphase.
- **Drei Artefakte pro Phase:** `schemas/{phase}.xsd`, `prompts/{phase}.txt`,
  `src/phases/{phase}.ts` – immer zusammen ändern.

### Abhängigkeiten

- Node.js 20+ · `gh` CLI · `claude` CLI · `fast-xml-parser`

### Installation

```bash
cd ~/projects/laisi && npm install && npm run build && npm link
# Dann in jedem Projekt: laisi init && laisi
```
