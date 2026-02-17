# Agent: Dispatcher

> Ich bestimme WELCHES Issue bearbeitet wird und WELCHE Phase als nächstes dran ist.
> Ich bin kein AI-Agent – ich bin reine Logik, implementiert in TypeScript.

## Identität

Ich bin der Einstiegspunkt jedes `laisi run`. Ich treffe keine kreativen
Entscheidungen – ich lese den Dateisystem-State und wende deterministische
Regeln an.

## Mein Algorithmus

### 1. Neue Issues entdecken

```
Für jedes Issue das mir auf GitHub zugewiesen ist:
  Wenn kein Verzeichnis .issues/{nr}/ existiert:
    → Verzeichnis anlegen
    → 0-issue.json fetchen (gh issue view)
```

### 2. Pro Issue: Nächste Phase bestimmen

Ich schaue welche Dateien existieren und leite daraus den nächsten Schritt ab:

```
.issues/{nr}/
  Kein 1-explore-*.xml?                → Phase: EXPLORE
  1-explore-N.pending.xml?             → Prüfe: Neue Antwort im Issue?
                                          Ja → Phase: EXPLORE (nochmal)
                                          Nein → Warten. Skip.
  1-explore-N.xml, kein 2-plan-*.xml?  → Phase: PLAN
  4-check-N.failed.xml?                → Phase: PLAN (Replan)
  2-plan-N.xml, kein 3-do-*.xml?       → Phase: DO
  3-do-N.xml, kein 4-check-*.xml?      → Phase: CHECK
  4-check-N.xml, kein 5-act-*.xml?     → Phase: ACT
  5-act-N.xml, kein 6-release-*.xml?   → Prüfe: PR gemerged?
                                          Ja → Phase: RELEASE
                                          Nein → Warten. Skip.
  6-release-N.xml?                     → Fertig. Skip.
```

### 3. Priorisierung: Welches Issue zuerst?

Wenn mehrere Issues einen nächsten Schritt haben, wähle ich nach
**Workflow-Fortschritt** – Issues die weiter sind haben Vorrang:

```
Priorität 1 (höchste): Release
Priorität 2: Act
Priorität 3: Check
Priorität 4: Plan (inkl. Replan)
Priorität 5: Do
Priorität 6: Explore
```

Begründung: Lieber ein Issue fertigmachen als drei anfangen.

### 4. Genau EIN Issue, EINE Phase ausführen

Ich wähle das Issue mit der höchsten Priorität und leite an den
entsprechenden Phase-Agenten weiter. Dann ist mein Job erledigt.

## Implementierung

- State-Logik: `src/lib/state.ts` → `determineAction()`, `scanAllIssues()`
- Orchestrierung: `src/commands/run.ts`
- GitHub-Checks: `src/lib/github.ts` → `hasNewCommentsSince()`, `isPrMerged()`

## Replan-Logik (Sonderfall)

Wenn `4-check-N.failed.xml` existiert und die höchste check-Datei ist:
1. Lösche alle `2-plan-*.xml` und `3-do-*.xml`
2. Starte Plan-Phase neu mit `4-check-N.failed.xml` als zusätzlichem Input

Dies wird im Orchestrator (`src/commands/run.ts`) behandelt,
bevor der Plan-Agent aufgerufen wird.
