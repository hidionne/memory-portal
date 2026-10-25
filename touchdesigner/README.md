# Memory portal — TouchDesigner version

The basic concept only, with no crayon or stitching styling yet. The webcam is mirrored and both hands are tracked. Your fingertips make a four-cornered frame, and any image you plug in shows inside it. By default the image is plain green, like a green screen.

- **Two hands:** a quad through left index tip (top-left), right index tip (top-right), right thumb tip (bottom-right) and left thumb tip (bottom-left). Corners are taken literally, so twisting one hand turns the portal into an X.
- **One hand:** a green line between that hand's index tip and thumb tip.
- A hand that drops out for a moment keeps its last corners for 600 ms. The image is never faded, however small the quad gets.

Built and tested in TouchDesigner 2025.33230 (Non-Commercial) on macOS.

## Setup (once)

Hand tracking is the [MediaPipe TouchDesigner plugin](https://github.com/torinmb/mediapipe-touchdesigner) v0.6.0 (MIT). It's about 180 MB, so it isn't in git. Put it in `touchdesigner/vendor/`:

```bash
cd touchdesigner && mkdir -p vendor/mediapipe-v0.6.0 && cd vendor/mediapipe-v0.6.0 && gh release download v0.6.0 -R torinmb/mediapipe-touchdesigner -p release.zip && unzip -q release.zip && rm release.zip
```

The v0.6.0 `release.zip` is missing `hand_tracking.tox`, so fetch that file from the tagged source:

```bash
curl -fsSL -o touchdesigner/vendor/mediapipe-v0.6.0/toxes/hand_tracking.tox https://media.githubusercontent.com/media/torinmb/mediapipe-touchdesigner/v0.6.0/toxes/hand_tracking.tox
```

## Run

1. Open `touchdesigner/memory_portal.toe` in TouchDesigner.
2. Allow camera access if macOS asks. MediaPipe starts its own hidden browser, and the first hand tracking can take a few seconds.
3. Watch `out1`: open its viewer, or press F1 for Perform mode, which shows `out1` full screen.
4. If the wrong camera is picked, choose yours under `MediaPipe` → parameters → **Webcam**.
5. If the picture goes black (e.g. after the Mac sleeps), press **Reset** on `MediaPipe`'s parameters to restart the camera.

## Putting your own image in the portal

Wire any TOP into **`portal_image`**: a Movie File In with a photo, a video, a Switch between several photos, and so on. Its input is currently `green_screen`, a 1280×720 Constant TOP. The image is stretched to fill the quad: its top-left corner sits at the left index tip, and so on around the quad.

## Network (`/project1`)

| Node | What it does |
| --- | --- |
| `MediaPipe` | Webcam and MediaPipe in a hidden browser. Horizontal flip is on (mirror), only hand detection is on, max 2 hands. |
| `hand_tracking` | Turns MediaPipe's hand JSON into CHOP channels (`normalized_data`: `h1:index_finger_tip:x` …, x 0–1, y 0–1 upward). |
| `corners` + `corners_callbacks` | Script CHOP that assigns hands to left/right by screen position, holds a lost hand for 600 ms, and outputs `mode` (0 none / 1 line / 2 quad) plus corner channels. |
| `camera` | The mirrored webcam image (`MediaPipe/video`). |
| `green_screen` → `portal_image` | The image slot (see above). |
| `portal` + `portal_pixel` | GLSL TOP that draws `portal_image` inside the quad over the camera, using inverse bilinear mapping so twisted quads become an X, or draws the one-hand line. Line colour and width are `uLineStyle` on its Vectors page (rgb + pixels). |
| `out1` | Final output. |
| `mcp_webserver_base` | The [TouchDesigner MCP](https://github.com/8beeeaaat/touchdesigner-mcp) bridge, so Claude Code can drive this project. It loads from `~/Documents/TouchDesigner-MCP/v2.1.0/`; if that path isn't there it just errors and does nothing else, and you can delete it. |

## Not done yet

- Crayon / stitched kid-drawing border and fingertip doodles (see the web version in `src/`).
- A real childhood photo in place of the green screen.
- Live two-hand alignment checked on 26 Oct 2026 with hands held still: all four corners sat on the fingertips. Fast movement hasn't been checked, and MediaPipe adds a few frames of lag.
