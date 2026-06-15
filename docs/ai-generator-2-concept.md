# Konzept: AI Level Generator 2 — „Architect" (schwierigkeitsbasiert)

## Ziel

Ein zweiter, eigenständiger AI-Level-Generator neben dem bestehenden
`generateAILabyrinth` (flaches 41×41 Shaker-Labyrinth). Der neue Generator
**„Architect"** fragt eine Zielschwierigkeit von **1 (sehr einfach)** bis
**10 (extrem schwierig)** ab und konstruiert daraus ein vollständig spielbares,
mit zunehmender Stufe größeres, mehrstöckiges und mechanisch reicheres Level —
unter **kreativem, sinnvollem Einsatz aller Spielelemente**.

## Designprinzipien

### 1. Garantierte Lösbarkeit (oberstes Gebot)
Ein generiertes Level muss immer abschließbar sein:
- Es existiert ein begehbarer **Backbone** (Hauptpfad) von Start zu Exit.
- Jedes **Pflicht-Prisma** (`prism`, nötig zum Levelabschluss) liegt auf einer
  vom Start aus statisch erreichbaren Zelle.
- Eine **BFS-Validierung** mit exakt den Bewegungsregeln des Spielers
  (Schritt hoch/gleich/runter, kein Überkopf-Block) prüft Erreichbarkeit von
  Exit und allen Pflicht-Prismen. Nicht erreichbare Pflicht-Prismen werden
  repariert (auf erreichbare Zelle verschoben oder zu optionalem `miniprism`
  herabgestuft).

### 2. Risiko nur auf optionalen Routen
- Der Backbone besteht aus soliden, immer begehbaren Blöcken (`normal`,
  gelegentlich `ice`/`booster`) und **switch-gesicherten Brücken**, deren
  Schalter garantiert *vor* dem Tor auf dem Pfad liegt.
- Heikle Elemente, die einen Pfad zerstören oder verpassen lassen können
  (`fragile`, `moving`, dichte `danger`), werden auf **Seitenarme** gelegt, die
  zu **Bonus-`miniprism`** führen. Miniprismen zählen nicht zum Abschluss
  (`checkLevelComplete` ignoriert sie), d. h. heikler Bonus gefährdet nie die
  Lösbarkeit.

### 3. Schwierigkeit = mehrere skalierende Achsen
Statt einer einzelnen Stellschraube skaliert Stufe 1→10 viele Achsen gemeinsam:

| Achse                | Stufe 1        | Stufe 10                    |
|----------------------|----------------|-----------------------------|
| Grundfläche          | klein (~10×10) | groß (~34×34)               |
| Backbone-Länge       | kurz (~14)     | sehr lang (~150)            |
| Etagen / Höhe        | flach (0–1)    | mehrstöckig (bis 5)         |
| Verzweigungen/Räume  | 1              | ~16                         |
| `fragile`-Anteil     | minimal        | hoch                        |
| `ice`-Anteil         | minimal        | hoch                        |
| `shaker`/`danger`    | keine          | dicht                       |
| `booster`            | keine          | mehrere                     |
| Switch-Brücken-Tore  | 0              | 3                           |
| Teleporter-Paare     | 0              | 3                           |
| Moving Platforms     | 0              | 4 (Bonus-Routen)            |
| Gegner               | 0              | 5                           |
| Pflicht-Prismen      | 3              | 14                          |
| Par (Zugbudget)      | großzügig      | knapp                       |

Eine Funktion `architectParams(d)` interpoliert diese Werte zwischen den
Ankerpunkten.

## Algorithmus (Pipeline)

1. **Backbone bauen** — gerichteter Random-Walk von Start zu Exit. Jede Zelle
   wird als `normal` gesetzt; Höhe ändert sich pro Schritt um höchstens ±1
   (Climb/Descend), niemals werden Decken über dem Pfad gebaut → per
   Konstruktion begehbar. Länge und Höhenvarianz skalieren mit der Stufe.

2. **Verzweigungen & Räume** — kurze Seitenarme und kleine Plateaus, die vom
   Backbone abgehen (für Prismen, Gegner, optionale Gefahren).

3. **Switch-Brücken-Tore** — ein Backbone-Segment wird durch eine Lücke
   ersetzt, mit `bridge`-Tiles überbrückt; der zugehörige `switch` wird auf
   einer *früheren* Backbone-Zelle platziert und per `switch-trigger`-Link mit
   den Brücken-Tiles verbunden. So bleibt der Hauptpfad lösbar.

4. **Teleporter** — Paare als Abkürzungen/alternative Routen zwischen weit
   entfernten Backbone-/Raum-Zellen (`teleporter-link`).

5. **Moving Platforms** — als optionale Bonus-Routen über Lücken zu
   `miniprism`-Belohnungen (mit `targetX/Y/Z`+`speed`-Properties), nie auf dem
   kritischen Pfad.

6. **Gefahren-Stil** — `fragile`/`ice`/`shaker`/`danger`/`booster` werden auf
   nicht-kritische Zellen (Seitenarme, optionale Segmente) verteilt, Dichte je
   nach Stufe.

7. **Prismen** — Pflicht-`prism` in erreichbare Sackgassen/Räume; optionale
   `miniprism` als Bonus an riskanten Stellen.

8. **Gegner** — an weit vom Start entfernten Backbone-Zellen (placed enemies,
   nutzen das neue editierbare Enemy-System).

9. **Validieren & reparieren** — BFS-Erreichbarkeit; Pflicht-Prismen ohne Pfad
   werden verschoben/herabgestuft. **Par** = Backbone-Länge × Stufen-Faktor.

## Integration

- **UI**: Im Editor-Top-Bar ein Schwierigkeits-Dropdown (1–10) plus Button
  **„AI Pro"**. Klick erzeugt das Level, lädt es in den Editor (überschreibt
  nach Bestätigung), setzt Name/Theme/Par.
- **Code**: `generateArchitectLevel(difficulty)` liefert ein `Level3D` und nutzt
  dieselben Strukturen (`blocks`, `prisms`, `enemies`, `links`) wie der Editor,
  sodass das Ergebnis voll editierbar, spielbar und exportierbar ist.
- Der bestehende `generateAILabyrinth` bleibt unverändert als zweite Option
  erhalten.
