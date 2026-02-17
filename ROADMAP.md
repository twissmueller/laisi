# LAISI Roadmap

## Phase 1: Fundament (aktueller Stand)

### ✅ Erledigt
- [x] Architektur definiert (Orchestrator + Phasen + State-Konvention)
- [x] TypeScript-Projekt aufgesetzt (tsx, fast-xml-parser)
- [x] `src/lib/claude.ts` – Claude-Wrapper mit XML-Validierung + Retry
- [x] `src/lib/state.ts` – Dateisystem-State lesen + Aktionen bestimmen
- [x] `src/lib/github.ts` – Git + GitHub CLI Wrapper
- [x] `src/orchestrator.ts` – Single-shot, priority-based dispatch
- [x] `src/types.ts` – Zentrale Typdefinitionen
- [x] Explore-Phase komplett: Schema + Prompt + Phase-Handler
- [x] Beispiel-Issue #42 mit pending.xml als Referenz

### 🔲 Offen: Schemas + Prompts ausarbeiten

#### Plan-Phase (`schemas/plan.xsd` + `prompts/plan.txt` + `src/phases/plan.ts`)
- [ ] Schema definieren: Welche Dateien werden geändert, was genau
      wird in jeder Datei geändert, erwartetes Ergebnis, Testplan
- [ ] Prompt: Claude bekommt explore.xml, muss einen Umsetzungsplan
      erstellen der in EINER Do-Session machbar ist
- [ ] Phase-Handler implementieren
- [ ] Typen in types.ts ergänzen (PlanResult)
- [ ] Entscheiden: Braucht Plan ein Human Gate? (Plan-Review vor Do?)

#### Do-Phase (`schemas/do.xsd` + `prompts/do.txt` + `src/phases/do.ts`)
- [ ] Schema definieren: Geänderte Dateien, Diffs/Zusammenfassung,
      ob Tests geschrieben wurden, Commit-Message
- [ ] Prompt: Claude bekommt plan.xml und implementiert. WICHTIG:
      Dies ist die einzige Phase die `claude` statt `claude --print`
      verwendet (`callClaudeInteractive` in claude.ts)
- [ ] Phase-Handler implementieren
- [ ] Typen in types.ts ergänzen (DoResult)
- [ ] Entscheiden: Wie geben wir Claude Zugriff auf den Code-Kontext
      ohne den Prompt zu überladen?

#### Check-Phase (`schemas/check.xsd` + `prompts/check.txt` + `src/phases/check.ts`)
- [ ] Schema definieren: Lint-Ergebnisse, Test-Ergebnisse, Security-Scan,
      AI-Code-Review-Findings, Gesamtstatus (passed/failed)
- [ ] Prompt: Claude reviewed den Code gegen die Requirements
- [ ] Phase-Handler: Erst deterministische Checks (lint, test, build),
      dann Claude für AI-Review. Beides ins XML.
- [ ] Entscheiden: Welche Tools? → Muss projektspezifisch konfigurierbar sein

#### Act-Phase (`schemas/act.xsd` + `prompts/act.txt` + `src/phases/act.ts`)
- [ ] Schema definieren: PR-URL, PR-Body, Learnings, Rule-Updates
- [ ] Prompt: Claude fasst zusammen, erstellt PR-Body, identifiziert Learnings
- [ ] Phase-Handler: `gh pr create`, Issue-Kommentar posten
- [ ] Entscheiden: Soll Act auch CLAUDE.md oder Projekt-Rules updaten?

#### Release-Phase (`schemas/release.xsd` + `prompts/release.txt` + `src/phases/release.ts`)
- [ ] Schema definieren: Tag, Version, Changelog-Entry, Deploy-Status
- [ ] Prompt: Claude generiert Changelog-Entry aus allen Phase-XMLs
- [ ] Phase-Handler: `git tag`, Changelog updaten, ggf. Deploy-Trigger
- [ ] Entscheiden: Semantic Versioning automatisch? Oder aus Issue-Labels?

---

## Phase 2: Härtung

### Orchestrator
- [ ] Timeout für Claude-Sessions (was wenn Claude hängt?)
- [ ] `npm run status` – Übersicht aller Issues und ihres Zustands
- [ ] Mehrere Issues parallel? Oder bewusst seriell bleiben?

### Validierung
- [ ] XSD-Schema-Validierung zusätzlich zu well-formed check
      (aktuell nur XML well-formedness via fast-xml-parser)
- [ ] Fallback: Rohes Output speichern für Debugging (bereits vorbereitet)

### Git-Integration
- [ ] Branch-Strategie: Ein Branch pro Issue (`issue-{nr}`)
- [ ] Merge-Konflikte wenn mehrere Issues parallel laufen?

### Testing
- [ ] Unit Tests für state.ts (parseIssueFile, determineAction)
- [ ] Integration Test: Mock-Issue durch alle Phasen schleusen

---

## Phase 3: Erweiterungen

### Observability
- [ ] `npm run status` → Tabelle aller Issues + Phase + Status
- [ ] Metriken: Durchschnittliche Durchlaufzeit pro Phase
- [ ] Alerts: Notification wenn Issue seit X Stunden in pending

### Konfiguration
- [ ] `.laisi.yml` im Repo-Root für projektspezifische Settings
      (Test-Commands, Lint-Commands, Branch-Prefix, etc.)
- [ ] Per-Issue Overrides via GitHub-Labels?

### Selbstverbesserung (Meta)
- [ ] Act-Phase schreibt Learnings in eine Wissensdatenbank
- [ ] Explore-Phase liest vorherige Learnings als Kontext
- [ ] Prompt-Templates werden aus Erfahrung verbessert

---

## Offene Entscheidungen

1. **Plan Human Gate**: Soll der Mensch den Plan absegnen bevor
   Do startet? Pro: Sicherheit. Contra: Verlangsamung.

2. **Do-Phase Code-Kontext**: Wie bekommt Claude den relevanten Code
   ohne Context-Overflow? Optionen:
   - Plan listet explizit welche Dateien Claude lesen soll
   - Claude bekommt vollen Repo-Zugriff via `callClaudeInteractive`

3. **Check-Phase Tools**: Hartcodiert oder konfigurierbar?
   Erster Ansatz: `package.json` scripts nutzen wenn vorhanden.

4. **Versionierung**: Semantic Versioning automatisch oder manuell?

5. **Parallelität**: Darf der Orchestrator mehrere Issues gleichzeitig
   bearbeiten? Aktuell: Nein (ein Schritt pro Trigger).
