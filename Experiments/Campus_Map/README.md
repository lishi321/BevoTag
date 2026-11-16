# Campus Map: BevoTag Signal Studio

## Start the web app

- **Windows:** double-click `start-webapp.bat`.
- **macOS/Linux:** run `./start-webapp.sh`.

The script starts a local web server for `collector/` and opens http://localhost:8765 in your
browser. Keep the window open while you use the app. Close it, or press Ctrl+C, to stop.

You need Python 3. To connect the ESP32, use Chrome or Edge, since the app uses Web Serial.
If port 8765 is taken, set `PORT` first, for example `set PORT=8780` on Windows.

## In the app

- **Explore demo:** synthetic signals and a sample position estimate.
- **Survey source → Simulation · AP in every room:** a predicted heatmap with one assumed AP at
  the center of every modeled space.
  - Signal falls off with distance, −5 dB per wall crossed and −15 dB per floor.
  - The parameters are uncalibrated. AP positions are an input list, so real AP positions can
    replace the assumption later.
- **My surveys → Import CSV files:** real survey logs collected with the ESP32.

More detail: [collector/README.md](collector/README.md).
