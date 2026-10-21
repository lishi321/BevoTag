# Local Three.js runtime

Vendored from the official npm package `three@0.180.0`:

- `build/three.module.js` → `three.module.js`
- `build/three.core.js` → `three.core.js`
- `examples/jsm/controls/OrbitControls.js` → `OrbitControls.js`
- `LICENSE` → `LICENSE.three` (MIT)

OrbitControls' bare `three` import is replaced with `./three.module.js` so the buildless app runs
from a local HTTP server without an import map, package installation, or CDN. One mixed-whitespace
indent in `three.core.js` is normalized to tabs; there are no other vendor edits.

To update, obtain an official npm release, copy the same files together, apply the import substitution,
retain its license, and rerun the unit and browser checks. Three.js r180 requires WebGL 2.
