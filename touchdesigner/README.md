# Memory portal — TouchDesigner version

The basic concept only, with no crayon or stitching styling yet. The webcam is mirrored and both hands are tracked. Your fingertips make a four-cornered frame that shows your photos, one per opening, or plain green (a green screen) when there are no photos.

- **Two hands:** a quad through left index tip (top-left), right index tip (top-right), right thumb tip (bottom-right) and left thumb tip (bottom-left). Corners are taken literally, so twisting one hand turns the portal into an X.
- **One hand:** a green line between that hand's index tip and thumb tip.
- **Pinched closed = nothing.** Openness is the portal's narrower side divided by palm size, so it doesn't depend on how far you are from the camera. It closes only when the fingertips are touching (0.12 or less) and opens again at 0.18 or more; the gap between them stops flicker. These are `CLOSE` / `OPEN` at the top of `corners_callbacks` (the web version uses 0.25 / 0.42). The one-hand line uses its own index–thumb gap the same way.
- **New photo each time:** close the portal for at least 350 ms (`MIN_CLOSED`), and when it reopens it shows the next photo. A hand dropping out of view never changes the photo, and neither does opening and closing the one-hand line.
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
3. Press **F1** for Perform mode: the output fills the window with two buttons along the bottom-left (press Esc to leave). You can also open `out1`'s viewer, but the buttons only show in Perform mode or in `/portal`'s own viewer.
   - **Record / Stop recording:** saves the output, with your mic audio, to `touchdesigner/recordings/portal_<date>_<time>.mov`. The button turns pink while recording. The format is Apple ProRes 422 LT, 1280×720, 60 fps; it opens in CapCut, QuickTime and Final Cut, and takes very roughly 0.2–0.5 GB per minute. H.264/MP4 needs a paid Commercial TouchDesigner license. macOS asks for microphone access the first time.
   - **Camera off / Camera on:** closes MediaPipe's hidden browser, which releases the webcam (its light goes off). While it's off the background is plain paper colour and no portal is drawn. Turning it back on takes a few seconds. Recording carries on through it.
4. If the wrong camera is picked, choose yours under `MediaPipe` → parameters → **Webcam**.
5. If the picture goes black (e.g. after the Mac sleeps), press **Reset** on `MediaPipe`'s parameters to restart the camera.

## Your photos

Drop JPG or PNG files into **`touchdesigner/photos/`**. They're picked up straight away, in filename order, so number them (`01_age4.jpg`, `02_age9.jpg`, …) to set the sequence. After the last photo it starts again from the first. To restart from photo 1, re-save the text of `corners_callbacks` (or reopen the project).

`photos/` is gitignored because the repo is public, so your photos stay on this Mac.

Each photo is cropped to fill the portal (like `object-fit: cover`) rather than stretched; its top-left corner sits at the left index tip. To use something else entirely (a video, a live feed), wire it into **`portal_image`** in place of `portal_source`.

## Network (`/portal`)

| Node | What it does |
| --- | --- |
| `MediaPipe` | Webcam and MediaPipe in a hidden browser. Horizontal flip is on (mirror), only hand detection is on, max 2 hands. |
| `hand_tracking` | Turns MediaPipe's hand JSON into CHOP channels (`normalized_data`: `h1:index_finger_tip:x` …, x 0–1, y 0–1 upward). |
| `corners` + `corners_callbacks` | Script CHOP that assigns hands to left/right by screen position, holds a lost hand for 600 ms, and handles open/close and the photo counter. Outputs `mode` (0 nothing / 1 line / 2 portal), corner channels, `photo` and `openness`. |
| `camera`, `camera_off_bg` → `background` | The mirrored webcam image (`MediaPipe/video`), or a paper-coloured backdrop while the camera is off. |
| `controls` | Python functions `toggleRecord()` and `toggleCamera()`. |
| `rec_button`, `cam_button` + `rec_label`, `cam_label`, `buttons_exec` | The two panel buttons, their label images, and the click handler that calls `controls`. |
| `recorder` + `mic` | Movie File Out (ProRes 422 LT .mov) of `out1`, with audio from the default microphone. |
| `photo_list` → `photo` | Folder DAT watching `photos/`; a Movie File In showing photo number `corners/photo` (wrapping around). |
| `green_screen`, `photo` → `portal_source` → `portal_image` | Switch: photos if the folder has any, otherwise green. `portal_image` is the slot the shader reads. |
| `portal` + `portal_pixel` | GLSL TOP that draws `portal_image` inside the quad over `background`, using inverse bilinear mapping so twisted quads become an X, or draws the one-hand line. Line colour and width are `uLineStyle` on its Vectors page (rgb + pixels). |
| `out1` | Final output. |
| `mcp_webserver_base` | The [TouchDesigner MCP](https://github.com/8beeeaaat/touchdesigner-mcp) bridge, so Claude Code can drive this project. It loads from `~/Documents/TouchDesigner-MCP/v2.1.0/`; if that path isn't there it just errors and does nothing else, and you can delete it. |

## Not done yet

- Crayon / stitched kid-drawing border and fingertip doodles (see the web version in `src/`).
- Live check of the pinch hiding, the tighter close point and the photo advance. They were tested with fake hand data, with live tracking checked separately. The buttons were tested with simulated clicks, not a real mouse in Perform mode.
- Live two-hand alignment checked on 26 Oct 2026 with hands held still: all four corners sat on the fingertips. Fast movement hasn't been checked, and MediaPipe adds a few frames of lag.
