# Pac-Man for Meta Display Glasses

A faithful arcade Pac-Man clone built as a web app for Meta Display glasses
(same 600×600 glanceable format as the Garmin and market glasses apps).

## Play

- **Steer:** Arrow keys / glasses D-pad (WASD also works on desktop)
- **Start / restart:** Enter
- **Pause:** P or Esc

Classic rules: 244 pellets, 4 power pellets, 4 ghosts with real personalities
(Blinky chases, Pinky ambushes, Inky flanks, Clyde wanders), frightened mode
with 200→400→800→1600 ghost combos, tunnel wrap, extra life at 10,000,
and faster levels as you clear mazes. No network needed — fully offline.

## Files

- `docs/index.html` — glasses app shell (600×600 viewport)
- `docs/styles.css` — HUD + overlay styling
- `docs/game.js` — full game: maze, physics, ghost AI, rendering, sound

## Install on glasses

1. Deploy this repo to GitHub Pages (Settings → Pages → Deploy from branch → `main` → `/docs`).
2. On your phone, open the **Meta AI** app → **Settings → App Info** → tap the app version 5 times to enable Developer Mode.
3. Go to **App Settings → App Connections → Web Apps** and add the Pages URL:
   `https://<your-username>.github.io/pacman-glasses-app/`

## Local preview

```sh
cd docs && python3 -m http.server 8099
# open http://localhost:8099/
```
