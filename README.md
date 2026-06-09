# 🪿 GOOSE — 3D Puzzle-Platformer & Level Editor

A premium, interactive **3D Voxel Puzzle-Platformer** and **Level Editor** built entirely with vanilla web technologies. Roll the cube, scale vertical obstacles, trigger logical systems, and build your own worlds directly in the browser.

Created and programmed by **Felix Schmidt**.

---

## 📸 Screenshots

![Goose 3D Level Editor & Interface](Screenshot%20(11).png)

*Figure 1: The interactive 3D Level Editor with the height ruler and layer slice visualization.*

![Goose 3D Gameplay & Physics](Screenshot%20(12).png)

*Figure 2: Active gameplay showcasing the 3D physics, rolling mini-cube, and collectable prisms.*

---

## 🎮 Game Overview

**GOOSE** is a 3D adaptation of the classic puzzle-platformer gameplay. Control a rolling cube on a grid, collect glowing prisms, and find your way to the exit portal. The game combines physical movement puzzles, timing challenges, and logic-based mechanics.

### Core Mechanics & Elements

1. **3D Height Physics**: Scale 1-block steps (`y + 1`) and step down safely. Falling from excessive heights triggers camera shake, landing dust particles, and impact sound effects.
2. **The Mini-Cube (Minimizer)**: Collect glowing cyan prisms to shrink the cube to `0.45x` size. In this state, you roll faster, slide under 1-block gaps, and can **scale vertical walls** by rolling directly into them.
3. **Edge Balancing (Goose Hang)**: Roll off a ledge while holding the movement key to suspend the cube at a 45-degree angle. Plays a distinctive balancing sound and allows rolling back or letting go to fall.
4. **Moving Platforms**: Smoothly interpolating platforms (horizontal, vertical, or diagonal) that carry the cube along with them.
5. **Momentary Pressure Plates**: Flat blue buttons that depress visually and turn green when stood on by the player or a pushed crate, activating linked bridges or moving platforms only while weighted.
6. **Pushable Crates**: Heavy wooden crates with gold trims that can be pushed into position to bridge gaps or hold down pressure plates. Supports full slide-and-fall physics.
7. **Hazard Spikes (Danger Blocks)**: Red corner spikes that cause immediate destruction, camera shake, screen flash, and player respawn on contact.
8. **Booster Speed Pads**: Yellow direction cones that double rolling speed for the next 4 moves.
9. **Crumbling Shaker Blocks**: Cracked stone blocks that shake violently for 600ms when stepped on before breaking away completely.

---

## 🛠️ The 3D Level Editor

An integrated, glassmorphic **3D Level Editor** allows you to build, playtest, save, and export your custom creations.

### Key Editor Features:
- **Visual Glass Plane**: A semi-transparent guide showing the current editing plane.
- **Layer Slicing**: Toggle visibility filtering (hiding blocks above the current layer and rendering blocks below at 40% transparency) to easily build multi-story structures.
- **Interactive Ruler**: Clickable height list on the right sidebar to jump between layers (`-3` to `10`) instantly.
- **Mouse Coordinate Tooltip**: Displays the targeted coordinate `(X, Y, Z)`, tool type, and block stack warnings.
- **Drag-Painting**: Left-click and drag to paint lines of blocks or erase them, locked to the active height layer.
- **Linker Tool**: Connect switches/pressure plates to bridges/platforms, link portals, or set moving platform routes.
- **Import / Export**: Save levels locally in browser storage, export them as portable `.json` files, or upload custom JSON files.
- **AI Labyrinth Generator**: Instantly generate a complex, fully navigable 3D heightmap maze built using only `normal` blocks and `shaker` blocks. It places collectible prisms at dead ends and sets dynamic move par goals.

---

## ⌨️ Controls Guide

### Normal Gameplay:
- **Move (Roll)**: `WASD` / `Arrow Keys`
- **Respawn / Reset**: `R`
- **Next Level (when cleared)**: `Space`

### Level Editor Controls:
- **Place Block / Item**: `Left Click`
- **Erase Block / Item**: `Right Click` (or left click with the `Erase` tool)
- **Paint / Erase Line**: `Left Click + Drag`
- **Move Editing Plane (Y)**: `R` (Up) / `F` (Down), Mouse Wheel (with `Shift`), or Ruler click
- **Pan Camera**: `WASD` / `Arrow Keys`
- **Rotate Camera**: `Right Click + Drag` / `Middle Click + Drag`, or `Q` / `E` keys
- **Zoom**: `Mouse Wheel`

---

## 🚀 Tech Stack

- **Graphics**: WebGL via **Three.js** (v160)
- **Audio**: Generative synth sound effects and ambient drone using the **Web Audio API**
- **Logic**: Vanilla ES6 JavaScript (Module script)
- **Styling**: Vanilla CSS (glassmorphism panels, CSS variables, dark mode aesthetics)

---

## 💻 How to Run

1. Clone or download this repository.
2. Open [edge-clone.html](edge-clone.html) in any modern web browser (Chrome, Firefox, Edge, Safari).
3. (Optional) Run a local server for optimal loading of assets:
   ```bash
   python -m http.server 8080
   ```
   Then open `http://localhost:8080/edge-clone.html` in your browser.

---

*Enjoy playing and designing in **GOOSE**!*
