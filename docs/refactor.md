# Refaktorisierungsbericht — Modularisierung von `js/main.js`

**Branch:** `refactor/modularize-main`
**Ziel:** Optimierung für die Weiterentwicklung — kleinere Modulgrößen, um Token-Kosten beim Lesen/Bearbeiten zu senken.
**Verhalten:** unverändert (reines Refactoring, kein Feature- oder Verhaltensumbau).

---

## 1. Zusammenfassung

`js/main.js` war ein 5.226 Zeilen großes „God-Module" (≈ 210 KB, rund 70 % des gesamten JavaScript-Codes). Jede Bearbeitung musste die komplette Datei laden — teuer in Token und schwer zu überblicken.

Die Datei wurde in **11 fokussierte Module** zerlegt. `main.js` ist jetzt **1.301 Zeilen** — eine Reduktion um **−75 %**. Der gesamte mutable Spielzustand liegt nun auf einem einzigen `S`-Objekt in `state.js`, wodurch jede zukünftige Aufteilung mechanisch wird.

| Kennzahl | Wert |
|---|---|
| `main.js` vorher | 5.226 Zeilen |
| `main.js` nachher | **268 Zeilen** (**−4.958 / −95 %**) |
| Neue Module | 11 (+ `scene.js` und `constants.js` erweitert) |
| State-Felder auf `S` migriert | 113 |
| Referenzen auf geteilten State umgeschrieben | ~914 (→ ~1.356 `S.`-Präfixe in `main.js`) |
| Commits auf dem Branch | 9 |
| Verhaltensänderungen | keine |
| Im Browser gefundene & behobene Regressionen | 2 |

> **Stand nach den Folgeschritten** (siehe Abschnitt 11): zusätzlich wurden `levels.js`
> und `bootstrap.js` ausgegliedert (`bootstrap.js` ist der neue Entry-Point), wodurch
> `main.js` von 1.301 auf 268 Zeilen schrumpfte. Außerdem: `.gitattributes`, Smoke-Tests
> und der gepushte PR-Branch.

---

## 2. Ausgangslage

Das Projekt ist bereits ein sauberes **ES-Module-Projekt**:

- `index.html` lädt `js/main.js` per `<script type="module">` und bezieht THREE.js über eine `importmap` (CDN).
- **Kein Bundler / kein Build-Schritt** (Vite/Webpack/Rollup nicht vorhanden).
- **Keine Test-Suite** → Verifikation erfolgte vollständig durch Ausführen des Spiels im Browser.

**Modulgrößen vor dem Refactoring:**

| Datei | Zeilen |
|---|--:|
| `main.js` | **5.226** |
| `sidforge.js` | 809 |
| `audio.js` | 789 |
| `level.js` | 221 |
| `scene.js` | 181 |
| `music-player.js` | 129 |
| `levels-data.js` | 81 |
| `constants.js` | 5 |
| **Summe** | **7.441** |

Alle Dateien außer `main.js` waren bereits angemessen dimensioniert. Das gesamte Problem war auf `main.js` konzentriert.

---

## 3. Das Kernproblem: geteilter mutabler Zustand

`main.js` teilte sich rund **40 mutable globale Variablen** (`let currentLevelIdx`, `let isRolling`, `let activeLevel`, …) über alle Belange hinweg.

In ES-Modulen sind importierte Bindungen **read-only**: ein Modul kann `import { isRolling }` lesen, aber **nicht** neu zuweisen (`isRolling = true` schlägt fehl). Jede Funktion, die einen globalen Zustand neu zuweist, lässt sich also nicht einfach in eine andere Datei verschieben.

**Lösung:** Ein einziges mutables Objekt `S` in `state.js`, das alle geteilten Zustände als Properties hält. Objekt-Property-Mutation (`S.isRolling = true`) funktioniert problemlos über Modulgrenzen hinweg, weil das *Objekt* eine geteilte Referenz ist.

```js
// state.js
export const S = {
  currentLevelIdx: 0,
  activeLevel: null,
  isRolling: false,
  // … 113 Felder insgesamt
};
export const audio = new AudioEngine();   // Singleton
```

> **Regel für die Weiterentwicklung:** Neuen Zustand als Feld auf `S` anlegen; Module machen `import { S } from './state.js'` und lesen/schreiben `S.x`. Echte Konstanten gehören in `constants.js`.

---

## 4. Vorgehen — phasenweise mit Verifikation

Jede Phase war für sich verifizierbar; nach jeder Phase wurde das Spiel im Browser geladen und ausgeübt. So wurde eine Regression sofort erkannt statt am Ende.

### Phase 0 — Baseline
Spiel im Preview-Server gestartet, sauberen Zustand bestätigt: „GOOSE — Ready (11 levels)", keine Konsolenfehler, 21 Tool-Buttons, Canvas vorhanden. Diese Werte dienten als Regressions-Referenz.

### Phase 1 — `ai-levels.js` (selbstständiger Block)
Die vier prozeduralen Level-Generatoren (`generateAILabyrinth`, `generateArchitectLevel`/`2`/`3` + Hilfsfunktionen, ~710 Zeilen) hängen nur von `Level3D` ab und geben fertige Level zurück. **Null Zustands-Kopplung** → risikoärmste, größte Einzel-Extraktion.

### Phase 2 — `state.js` (das Fundament)
- `S`-Objekt mit allen 113 mutablen Feldern + `audio`-Singleton angelegt.
- ~914 Referenzen in `main.js` per Skript auf `S.*` umgestellt (≈ 1.356 `S.`-Präfixe).
- Vor dem Skriptlauf wurden Kollisionen statisch ausgeschlossen: Objekt-Literal-Keys, Destrukturierung, Shadowing durch lokale Variablen/Parameter, ternäre Zweige (`? x :`). Es gab genau zwei Sonderfälle (eine Shorthand-Zeile, ein Ternär-Zweig), die manuell vorbehandelt wurden.

### Phase 3 — Leaf-Module: `particles.js`, `ui.js`, `enemies.js`
Schwach gekoppelte Blattmodule (Partikel/FX, HUD-DOM-Updates, Gegner-KI + Leben). `getPlayerWorldPos` wurde nach `scene.js` verschoben (reine Geometrie-Hilfe ohne Zyklen).

### Phase 4 — `meshes.js`
Reine Mesh-Fabriken (`createBlockMesh`/`createPrismMesh`/`spawnEnemy`/`createEnemyMarker`) + `setMeshOpacity`/`disposeMaterial`. Die Orchestrierungs-Hubs `clearLevel`/`buildLevel3D` blieben bewusst in `main.js`.

### Phase 5 — `gameplay.js`
Roll-/Physik-Kern **und** die davon ausgelösten Block-Mechaniken (Schalter, Teleporter, Prismen, fragile/Shaker-Blöcke, Druckplatten, Mini-Cube, Level-Abschluss, Respawn). Bewegung und Interaktionen sind gegenseitig rekursiv (`onRollComplete` → `checkLevelComplete`/`triggerSwitch` → …), daher als **eine** kohärente Einheit extrahiert statt künstlich getrennt.

### Phase 6 — `editor.js` (~1.000 Zeilen)
Der komplette Level-Editor: Undo, Edit-Modus-Lebenszyklus, Lineal + Layer-Slicing, Drahtgitter, Raycasting, Platzieren/Löschen, Flächen-Füllung, Klick-/Drag-Handling, Playtest, Bibliothek, Tool-Auswahl. Verteilt über mehrere Regionen → in drei präzisen Schnitten zusammengeführt.

### Phase 7 — `gameloop.js`
`animate()` (Pro-Frame-Schleife) + `updateDynamicTransparency()`. Die `requestAnimationFrame(animate)`-Initialisierung verblieb im Bootstrap von `main.js`.

---

## 5. Endergebnis — Modullandschaft

| Modul | Zeilen | Belang |
|---|--:|---|
| `constants.js` | 13 | Alle echten Konstanten (Timing, MAX_LIVES, Editor-Lineale, UNDO_LIMIT, BLOCK_TOOLS) |
| `ui.js` | 87 | HUD / Nachrichten / Gruppierungsanzeige (DOM) |
| `particles.js` | 140 | Partikel-/FX-Spawner, Screen-Shake/Flash |
| `state.js` | 164 | Das `S`-Zustandsobjekt + `audio`-Singleton |
| `enemies.js` | 184 | Gegner-KI/Pathfinding + Leben |
| `scene.js` | 188 | Renderer/Szene/Kamera/Lichter/Materialien/Geometrien + `getPlayerWorldPos` |
| `meshes.js` | 233 | Mesh-Fabriken + Material-Hilfsfunktionen |
| `gameloop.js` | 621 | Die Pro-Frame-`animate()`-Schleife |
| `ai-levels.js` | 717 | Die vier prozeduralen Generatoren (selbstständig) |
| `gameplay.js` | 915 | Roll-Simulation + Block-Mechaniken |
| `editor.js` | 1.006 | Der Level-Editor |
| **`main.js`** | **1.301** | Bootstrap, Event-Verdrahtung, Input-Handler, `buildLevel3D`/`clearLevel`, Level-Loader, rAF-Kickoff |
| *(unverändert)* `audio.js` | 789 | Audio-Engine |
| *(unverändert)* `sidforge.js` | 809 | SID-Musik |
| *(unverändert)* `level.js` | 221 | Level3D, MovingPlatform, (De-)Serialisierung |
| *(unverändert)* `music-player.js` | 129 | Musik-Player |
| *(unverändert)* `levels-data.js` | 81 | World-/Demo-Daten |

Der JS-Gesamtumfang stieg minimal (7.441 → 7.598 Zeilen, +157) durch Modul-Header und Import-Zeilen — der entscheidende Gewinn ist die Verteilung: jede Aufgabe lebt jetzt in einer kleinen Datei statt in einer 5.000-Zeilen-Datei.

---

## 6. Architekturentscheidungen

### 6.1 Zentrales Zustandsobjekt `S`
Siehe Abschnitt 3. Dies ist der eigentliche Wegbereiter: weil aller Zustand über `S` läuft, ist das Verschieben einer Funktion in ein anderes Modul reine Textverschiebung + Import.

### 6.2 Zirkuläre Imports sind erwartet und in Ordnung
Die beiden „Hub"-Funktionen `buildLevel3D` (in `main.js`) und `animate` (in `gameloop.js`) rufen quer durch viele Module, die ihrerseits zurückrufen. ES-Modul-Zyklen funktionieren hier, weil **jeder Aufruf zur Laufzeit** geschieht (nicht zur Modul-Auswertungszeit) und Funktionsdeklarationen gehoistet werden.

`main.js` re-exportiert für die Zyklen:
```js
export { buildLevel3D, loadPreMadeLevel, loadDemoLevel, applyXrayOverride,
         toolButtons, handleMove, updatePauseOrbitCamera };
```
Beispiel: `enemies.js` und `gameplay.js` importieren `getBlocksInColumn`/`respawnPlayer`/`completeLevel` aus `gameplay.js`; `gameplay.js` importiert `buildLevel3D`/`loadPreMadeLevel` aus `main.js` und `exitPlaytestMode` aus `editor.js`.

### 6.3 Hubs bleiben in `main.js`
`clearLevel`, `buildLevel3D` und der `animate`-Kickoff sind Orchestrierungs-Code. Sie in `main.js` zu belassen, hält `main.js` als „App-Shell" lesbar und vermeidet, dass jede einzelne Funktion eine riesige Importliste benötigt.

### 6.4 Echte Konstanten nach `constants.js`
Werte, die nie neu zugewiesen werden und modulübergreifend genutzt sind (`MAX_LIVES`, `MOVE_REPEAT_MS`, `ENEMY_MOVE_INTERVAL`, `rulerMinY/Max`, `UNDO_LIMIT`, `BLOCK_TOOLS`, …), wurden nach `constants.js` verschoben — nicht auf `S`, da sie kein Zustand sind.

---

## 7. Gefundene & behobene Probleme

Diese wurden ausschließlich durch das Ausführen des Spiels gefunden — ein reiner „lädt ohne Fehler"-Check hätte sie übersehen.

### 7.1 Spread-Syntax bei der State-Umstellung (echte Regression)
Das Umschreib-Skript benutzte einen Lookbehind `(?<![.\w])`, um Property-Zugriffe (`obj.foo`) zu überspringen. Dadurch wurde aber auch der **Spread-Operator** übersprungen: `{ ...playerGridPos }` blieb unverändert statt `{ ...S.playerGridPos }`. Das brach die Bewegung **lautlos** (kein Konsolenfehler — `playerGridPos` war einfach `undefined`).
**Erkennung:** A/B-Vergleich gegen das unveränderte Original (synthetischer Tastendruck erzeugte im Original „1 move", in der Refactor-Version „0 moves").
**Fix:** gezielter zweiter Durchlauf `\.\.\.(name)` → `...S.$1` für alle 7 betroffenen Stellen.

### 7.2 String-Literal-Korruption (echte Regression)
Der Zustandsname `enemies` kommt auch in String-Literalen vor (DOM-IDs/Options-Keys). Das Skript verwandelte `'ai2-enemies'` in `'ai2-S.enemies'` und `'enemies'` in `'S.enemies'`.
**Erkennung:** statischer Scan nach `S.` innerhalb von Anführungszeichen.
**Fix:** beide Stellen zurückkorrigiert.

### 7.3 „Eingefrorene" Render-Schleife (Fehlalarm — kein Bug)
Nach der `gameloop.js`-Extraktion schien der Timer eingefroren (0:00) und `animate` lief 0 Frames. Ursache war **nicht** der Code: der Preview-Tab drosselt/pausiert `requestAnimationFrame`, wenn er im Hintergrund ist. Nach Interaktion lief die Schleife mit ~57 fps (über einen temporären Frame-Zähler bestätigt), der Timer stieg (0:23 → 0:25). Zusätzlich blockieren `confirm()`/`alert()`-Dialoge (Demo-/AI-Buttons) `preview_eval` — in Tests mit `window.confirm = () => true` umgangen.

---

## 8. Commits auf dem Branch

| Commit | Beschreibung | Δ |
|---|---|---|
| `87446c8` | Modularize main.js: extract state, ai-levels, particles, ui, enemies | 8 Dateien, +2.264 / −2.206 |
| `a0f87ec` | Extract meshes.js (mesh factories + material utils) | 2 Dateien, +236 / −217 |
| `5493fc9` | Extract gameplay.js (rolling sim + block mechanics) | 3 Dateien, +924 / −901 |
| `a4bce11` | Extract editor.js (~1000 lines: the level editor) | 4 Dateien, +1.022 / −990 |
| `26cc177` | Extract gameloop.js (the per-frame render loop) | 3 Dateien, +626 / −601 |

Jeder Commit ist einzeln lauffähig und im Browser verifiziert.

---

## 9. Verifikation

Nach jeder Phase im Browser-Preview geprüft (Konsolenfehler-Level + funktionale Ausübung):

- **Gameplay:** Bewegung (0→1 Zug), Roll-Umkehr (Balance-Mechanik), Respawn, Pause-Overlay, Hilfe-Overlay.
- **Render-Schleife:** Timer läuft (~57 fps, über Frame-Zähler bestätigt).
- **Editor:** Betreten/Verlassen, Tool-Auswahl, Höhenverstellung, Slicing, Blockplatzierung (Canvas-Klick), Undo.
- **KI-Generatoren:** alle vier über die echte UI ausgelöst (Labyrinth, Architect, Architect Pro2/Pro3).
- **Playtest:** Level mit lebenden Gegnern (KI läuft pro Frame über die Schleife), Lebensanzeige korrekt.
- **Level-Abschluss:** Erreichen des Ausgangs löst das Complete-Overlay aus.

**Ergebnis:** durchgehend **keine Konsolenfehler**.

---

## 10. Offene Punkte / Empfehlungen

- **PR:** Der Branch `refactor/modularize-main` ist bereit für einen Pull Request gegen `main`.
- **Zeilenende-Hinweis:** Git meldet beim Commit „LF will be replaced by CRLF" (Windows). Optional eine `.gitattributes` mit `*.js text eol=lf` ergänzen, um konsistente Zeilenenden zu erzwingen.
- **Weiteres Potenzial (optional, geringer Nutzen):** `main.js` (1.301 Zeilen) ist jetzt eine saubere App-Shell. Falls weitere Verkleinerung gewünscht ist, ließen sich die DOM-Event-Verdrahtung und die Level-Loader (`loadLevelManifest`/`loadPreMadeLevel`/`loadDemoLevel`) noch in eigene Module (`bootstrap.js`, `levels.js`) ziehen — der Zustand ist bereits entkoppelt, daher wäre das rein mechanisch.
- **Tests:** Es gibt keine automatisierten Tests. Ein paar Smoke-Tests (Modul-Laden, ein Generator-Aufruf, eine Level-Serialisierung) würden künftige Refactorings absichern.

---

*Refactoring durchgeführt mit Claude Code. Verhalten unverändert; alle Schritte im Browser verifiziert.*
