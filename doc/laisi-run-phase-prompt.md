# LAISI – run_phase: Konzept und Ablauf

## Deine Aufgabe

Du implementierst die Kernfunktion von LAISI: `run_phase()`.
Diese Funktion ist für jede Phase eines Workflows identisch.
Sie bekommt eine Phasenkonfiguration und ein Arbeitsverzeichnis
und ist dafür verantwortlich, dass am Ende ein valides, schema-konformes
XML-Dokument im Arbeitsverzeichnis liegt.

---

## Grundprinzip

Die CLI ist der Schiedsrichter — nicht das LLM.

Das LLM produziert Inhalt. Die CLI entscheidet ob dieser Inhalt
strukturell korrekt ist. Wenn nicht, gibt die CLI dem LLM eine
zweite Chance — mit dem Fehler als explizitem Feedback.
Das wiederholt sich bis zu dreimal. Danach entscheidet ein Mensch.

---

## Ablauf

### Vorbereitung (CLI)

Bevor das LLM auch nur einmal aufgerufen wird, liest die CLI
das Schema der Phase und erstellt daraus ein leeres XML-Dokument —
ein Skelett mit allen erwarteten Elementen, aber ohne Inhalt.
Dieses Skelett wird als Datei ins Arbeitsverzeichnis geschrieben.

Warum? Das Skelett macht die erwartete Struktur für das LLM
explizit sichtbar. Das LLM muss nicht raten was erwartet wird —
es sieht die leeren Felder und füllt sie aus.

### Haupt-Loop (max. 3 Durchläufe)

```
Versuch 1..3:

  CLI übergibt an LLM:
    - Den System-Prompt der Phase
    - Den Input (Vorgabe-Dokument der Phase)
    - Das leere XML-Skelett als Teil des Prompts:
      "Fülle dieses XML-Skelett aus. Gib ausschließlich
       das ausgefüllte XML zurück, kein Text davor oder danach."
    - Falls Versuch > 1: zusätzlich den Validierungsfehler
      des vorherigen Versuchs

  LLM antwortet mit XML (oder versucht es)

  CLI extrahiert XML:
    Suche nach dem öffnenden Root-Tag und dem schließenden Root-Tag.
    Alles dazwischen ist das XML. Text davor oder danach wird ignoriert.

  CLI validiert XML gegen das Schema:
    Ist die Struktur korrekt? Sind alle Pflichtfelder vorhanden?
    Sind die Datentypen korrekt?

  Wenn valide:
    CLI schreibt das XML als Output-Datei der Phase.
    Phase abgeschlossen. Loop endet.

  Wenn nicht valide:
    CLI bereitet den nächsten Versuch vor:
      - Bisherige LLM-Antwort bleibt im Gesprächsverlauf sichtbar
      - Fehlermeldung des Validators wird als neue User-Nachricht angehängt
      - Nächster Versuch beginnt
```

### Nach dem Loop

Wenn nach drei Versuchen kein valides XML vorliegt:
Die CLI schreibt eine `HUMAN_GATE.md` ins Arbeitsverzeichnis
mit der Phase-ID, dem letzten LLM-Output und dem letzten
Validierungsfehler. Der Workflow pausiert. Ein Mensch entscheidet
wie es weitergeht.

---

## Das XML-Skelett

Das Skelett ist kein leeres Dokument. Es ist eine Vorlage mit
allen Elementen die das Schema vorschreibt — aber ohne Inhalt.
Zum Beispiel für die Intent-Phase:

```xml
<intent>
  <objective>
    <problem></problem>
    <evidence></evidence>
  </objective>
  <user_goal></user_goal>
  <outcomes>
    <outcome measurable=""></outcome>
  </outcomes>
  <edge_cases>
    <case></case>
  </edge_cases>
  <verification>
    <check></check>
  </verification>
  <ambiguous></ambiguous>
</intent>
```

Das Skelett wird aus dem XSD generiert — nicht manuell gepflegt.
Wenn sich das Schema ändert, ändert sich automatisch das Skelett.

---

## Was die CLI tut — was das LLM tut

| Aufgabe | CLI | LLM |
|---|---|---|
| Skelett aus Schema generieren | ✓ | |
| Inhalt produzieren | | ✓ |
| XML extrahieren | ✓ | |
| Gegen Schema validieren | ✓ | |
| Fehler kommunizieren | ✓ | |
| Fehler korrigieren | | ✓ |
| Human Gate auslösen | ✓ | |
| Output-Datei schreiben | ✓ | |

Das LLM entscheidet niemals ob sein Output korrekt ist.
Das ist ausschließlich Aufgabe der CLI.

---

## Rahmenbedingungen

- Die LLM-Integration ist bereits vorhanden — nicht neu implementieren
- Die Schema-Validierung ist bereits vorhanden — nicht neu implementieren
- Logging für jeden Versuch: Versuch N von 3, Fehler, nächster Schritt
- Kein Refactoring von bestehendem Code außerhalb von `run_phase()`
- Keine neuen Abhängigkeiten ohne Rückfrage
