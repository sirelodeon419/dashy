# Pine Frost (Web Vertical Slice)

A standalone playable prototype built as a **winter survival village builder** focused on heat, logistics, and population pressure.

## How to run

1. Start Dashy dev server:
   - `yarn install`
   - `yarn dev`
2. Open `http://localhost:8080/pine-frost/`.

> You can also open `public/pine-frost/index.html` directly in a browser for a quick smoke test.

## Controls

- **Mouse click world tile**: Select villager/building/resource node.
- **Build panel**: Select a building, then click a tile to place blueprint.
- **Village Jobs panel**: Reassign workers between jobs.
- **Survival Controls**:
  - Toggle overlays (Heat / Resources / Danger)
  - Pause/Resume
  - Save/Load (localStorage)
  - New Game reset

## Implemented systems

- Resource economy: wood, firewood, food, stone, tools, fur, medicine.
- Villagers with jobs, warmth/hunger/fatigue/health, sickness and task switching.
- Spatial heat model with heat radius from buildings.
- Building placement and staged construction.
- Job assignment controls with RTS-style management panel.
- Weather escalation (clear cold -> blizzard) affecting warmth drain and movement.
- Alerts + objective cards + selected info panel.
- Win/Lose conditions:
  - **Win**: survive to day 20 with stable food + firewood reserves.
  - **Lose**: all villagers die.
- Save/Load via localStorage.

## Known limitations

- Uses simplified tile movement and tasking rather than full NavMesh pathfinding.
- Placeholder art/UI and no audio assets yet.
- Single handcrafted/simulated map variant.
- No minimap and no full production-chain buildings beyond core loop essentials.

## Suggested next expansions

- Replace movement with A* pathfinding and path infrastructure bonuses.
- Add production queues (workshop tools, smokehouse preserved food).
- Add day/night lighting and ambient audio hooks.
- Expand villager traits and individual home assignment.
- Add additional overlays (storage reach, shelter, work radius) and minimap.
