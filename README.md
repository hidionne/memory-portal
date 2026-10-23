# memory portal

A webcam toy for filming yourself opening a window into a photograph.
Make a frame with both hands: your two index fingertips are the top corners,
your two thumb tips the bottom corners. A stitched, crayon-drawn portal opens
between those four points and shows the photograph in place of the camera
image. It stays visible at whatever size your fingers make, however small.

The look is mixed media: a sheet of paper, a crayon-sky mat around the video,
felt patches with running stitches, masking tape, lined notebook paper, and a
row of crayon flowers that grows up along the bottom of the picture.

Everything runs locally in the browser. Camera frames and photographs never
leave the device; there is no backend.

## Run it

Requires Node 20.19+ or 22.12+. (A user-local Node 24 LTS was installed at
`~/.local/node` during setup. Add it to your PATH, or install Node your usual way.)

```bash
export PATH="$HOME/.local/node/bin:$PATH"
cd ~/Desktop/UNSW/Commerce/1150/memory-portal
npm install          # also copies the MediaPipe WASM into public/
npm run dev          # http://localhost:5173 — open in Chrome
```

Other commands:

```bash
npm test             # unit tests (mapping, geometry, gesture machine, …)
npm run build        # type-check + production build into dist/
npm run preview      # serve dist/ locally
npm run setup-assets # re-download the hand model if public/models is missing
```

**Deploying:** `dist/` is a static site that works from any path. Host it on any
HTTPS static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages). The camera
needs HTTPS or `localhost`.

**Network/offline:** the hand model (`public/models/hand_landmarker.task`, 7.8 MB,
the official float16 model) and the MediaPipe WASM runtime are bundled and served
from your own origin. Nothing is fetched from a CDN. If the local model file is
missing, the app falls back to Google's hosted copy (that path needs internet).
The app has been verified to load the model from localhost. It is not a PWA, so
the page itself must still be reachable from your dev server or host.

## Live site and versions

Each version of the site lives on its own git branch and is published to its
own permanent link on GitHub Pages:

- All versions: https://hidionne.github.io/memory-portal/
- Childhood memory: https://hidionne.github.io/memory-portal/childhood-memory/

`main` holds the shared finger-tracking base. To start a new version, branch off
it (or off another version), change the look, then publish:

```bash
git switch -c my-new-version main
```

```bash
npm run deploy
```

`npm run deploy` builds whatever branch you're on and publishes it to
`https://hidionne.github.io/memory-portal/<branch-name>/`, leaving the other
versions in place. Commit (and push) your changes first. The site is static
HTTPS, so the camera works there exactly as on localhost.

## Using it

1. **Start camera** (or **Try mouse demo** if you have no camera or just want to test).
   The browser asks for camera permission only at this point; the microphone is never requested.
2. Raise both hands: index fingers on top, thumbs underneath, pointing in towards each
   other. Each fingertip is one corner of the portal, and the corners follow your
   fingers exactly. Twist one hand (thumb above index) and the portal crosses into an X.
   With only one hand up you get a crayon line between its index finger and thumb.
   The photo shrinks with your fingers but never fades just because it's small.
3. Add your photos from the **photos** tag on the right, or drop files anywhere.
4. Press **H** (or the **hide** tag) for clean mode — just the picture — then
   record with **R** or with macOS screen recording.

### Controls

Everything lives in fabric tags down the right edge. Each opens a page that sits
over the edge of the picture; close it (×, Esc, or tap the tag again) and only the
portal is left.

| Tag | What's inside |
| --- | --- |
| **photos** | Add photos, the photo collection (select, move earlier/later, remove), back/next, remove samples, **new memory on reopen**, **window / follow**, fill / whole photo, zoom, left↔right, up↕down, reset framing |
| **portal** | Border (**stitch / crayon / rainbow / scribble / none**), border size, flowers on fingertips, **flower garden**, control with hands or mouse, sensitivity, smoothing |
| **camera** | Start/stop camera, mouse demo, which camera, mirror, shape (**wide 16:9 / tall 9:16 / square**), go faster (performance mode), countdown, show tracking dots (debug), fullscreen |
| **record** | Starts recording (with countdown); shows the timer and stops it |
| **hide** | Clean mode |

### Keyboard shortcuts

Shortcuts are ignored while a text field, slider or select has focus.

| Key | Action |
| --- | --- |
| ← / → | Previous / next photograph |
| H | Toggle clean mode |
| Esc | Leave clean mode / close the open tag |
| D | Toggle debug overlay |
| Space | Open/close the portal (mouse control only) |
| R | Start / stop recording (or cancel the countdown) |
| F | Toggle fullscreen |

### Mouse demo

Uses a neutral sample backdrop instead of the camera. Each of the four corner
dots can be dragged anywhere (drag two past each other to make an X), drag inside
to move the whole portal, drag on empty space to draw a new one, and press Space
to close/reopen. Photo selection, effects, output ratios,
new-memory-on-reopen, clean mode and recording all work the same, because the demo
feeds the same gesture state machine and compositor as the hand tracker.
You can also switch to **Mouse** control while the camera is on.

## How it works

```
src/
  lib/                     pure, unit-tested logic
    mapping.ts             camera ↔ output coordinate transform (cover crop + mirror)
    geometry.ts            small point/rect helpers
    quad.ts                four-fingertip portal: corners, openness, X detection, bilinear map
    twoHands.ts            which detected hand owns the left / right corners
    pinch.ts               palm size, sensitivity → thresholds
    oneEuro.ts             One Euro landmark filter
    handSelection.ts       hand centroid helpers
    gestureMachine.ts      tracking / pinch / close-reopen state machines
    photoFraming.ts        cover/contain + zoom/pan placement (never stretches)
    recordingFormat.ts     MIME selection, honest file extension
  engine/
    camera.ts              getUserMedia lifecycle + error classification
    handTracker.ts         MediaPipe HandLandmarker (VIDEO mode, GPU→CPU fallback)
    compositor.ts          the single Canvas 2D compositor (preview = recording), photo warp
    crayon.ts              crayon + stitched portal borders, finger line, fingertip flowers
    garden.ts              the row of crayon flowers and grass growing along the bottom
    sky.ts                 the crayon-sky background (frame around the video, demo backdrop)
    textures.ts            cached grain tile for the sample pictures
    photos.ts              local decoding, downsampling, thumbnails, samples, backdrop
    recorder.ts            canvas.captureStream + MediaRecorder
    PortalEngine.ts        the frame loop that ties it all together
  ui/                      React controls, settings panel, photo strip, shortcuts
  App.tsx                  state, camera flow, recording, drag-and-drop
```

- **Alignment.** `computeCoverTransform` (in `lib/mapping.ts`) is the single source
  of truth for where the camera image lands in the output frame. The compositor
  draws the video with it and the tracker maps landmarks with it, so mirroring,
  cover-cropping, viewport size and output ratio can't drift apart. Mirroring is
  applied to the video draw and the landmark mapping only. Photographs are drawn
  separately and never flipped. The canvas element is always sized to the exact
  output aspect, so CSS pixels map to output pixels by a uniform scale,
  independent of devicePixelRatio.
- **Rendering.** Each frame: draw the (mirrored) webcam, then the photo inside the
  four-corner portal, then the crayon border. In **Window** mode the photo stays
  fixed to the frame and is clipped to the quad (non-zero fill, so both halves of
  an X show it). In **Follow** mode the photo is laid out on a card and warped onto
  the four corners with a 7×7 mesh of affine triangles, since Canvas 2D has no
  perspective transform. Crayon strokes use cached waxy texture patterns and
  "boil" (redraw slightly differently about 7 times a second), like hand-drawn animation.
- **Tracking.** MediaPipe `HandLandmarker` (21 landmarks per hand) in VIDEO mode with
  `numHands: 2` on the GPU. Inference runs straight from `requestVideoFrameCallback`,
  i.e. the moment a new camera frame is decoded, so the paint that follows always
  uses the newest landmarks. Calls are synchronous, so they can't overlap. The
  camera is asked for 60 fps where available. The first GPU inference (shader
  compilation, several seconds) runs during "Loading hand model…". A worker wasn't
  used: the GPU delegate needs a WebGL context and every frame would have to be
  copied to the worker.
- **Left vs right.** A fresh pair of hands is split by on-screen position (left of
  screen → left corners). After that, each side follows its own hand by spatial
  continuity, with MediaPipe's handedness label as a tie-breaker. Crossing your arms
  therefore keeps the corners on the actual fingers rather than snapping back.
  MediaPipe's Left/Right labels flip depending on whether it treats the input as
  mirrored (its official test photo labelled an unmirrored right hand "Right",
  contrary to its docs), so they aren't trusted for the side itself.
- **React** only holds low-frequency UI state. Landmarks, portal geometry and
  animation live in the engine and never trigger re-renders.

### Why MediaPipe

MediaPipe Hand Landmarker is still the most accurate hand tracker that runs fully
in the browser, and Google publishes it with a web build. TensorFlow.js
`handpose` is an older packaging of an earlier MediaPipe model, and handtrack.js
only gives bounding boxes, not fingertips. In VIDEO mode MediaPipe skips the
expensive palm detector while it is already tracking a hand, which keeps two-hand
latency down.

Measured in the (throttled, background) preview browser used for development:
two-hand inference took ~24 ms on the GPU vs ~43 ms on the CPU. Input resolution
(1080p / 720p / 540p) made no difference, so frames are fed at full resolution.
A foreground Chrome on Apple silicon should be faster; check the debug overlay (D)
for your machine's real numbers. End-to-end delay is roughly one camera frame
(33 ms at 30 fps) plus inference, plus a little smoothing.

### Gesture thresholds

The portal's **openness** is `min(width, height) / palmSize`, measured in camera
pixels, where width is the mean of the top and bottom edges (index↔index,
thumb↔thumb) and height is the mean of the side edges (each hand's index↔thumb
gap). It collapses whether you pinch both hands closed or bring your hands
together. `palmSize` (averaged over both hands) is
`max(|wrist − middleKnuckle|, 1.3 × |indexKnuckle − pinkyKnuckle|)`, which stays
stable whether the hand tilts or turns. A comfortable frame measures roughly 0.8–1.5.

| Sensitivity | Opens at openness ≥ | Closes at openness ≤ |
| --- | --- | --- |
| 0% | 0.55 | 0.33 |
| **50% (default)** | **0.42** | **0.25** |
| 100% | 0.28 | 0.17 |

The close threshold is always 60% of the open one. That hysteresis band stops
the portal flickering when you hover near either threshold.

Timings (in `DEFAULT_GESTURE_CONFIG`):

- Fade in: 110 ms. Fade out on pinch: 150 ms.
- The photo never fades because the frame is small or "closed": open/closed only
  drives **new memory on reopen**. (The mouse demo still closes with Space.)
- If one hand briefly drops out (often at the frame edge), its corners are held
  where they were for 600 ms so the portal doesn't collapse. Tracking thresholds
  are also relaxed so partly-visible hands are kept. If a hand stays gone, the
  portal holds for 350 ms, then fades over 250 ms, and the remaining hand shows its
  index↔thumb line. Losing a hand never counts as a closure. A hand that reappears after a gap has
  its filters reset, so its corners never glide in from a stale position.
- New memory on reopen: a closure must be held for **350 ms** to arm the next
  photo. The next opening advances exactly one photo, wrapping at the end. Losing
  the hand while closing cancels the closure, so tracking loss can never count as
  one. A closure that was already completed survives a brief loss.
- Smoothing (One Euro, in output-height units): `minCutoff` 3.0 → 0.35 Hz and
  `beta` 14 → 4 as the slider goes 0 → 100% (default 50%).
- No minimum size is forced and nothing fades as the portal shrinks.

### Recording

The compositor canvas is recorded with `canvas.captureStream(30)` and
`MediaRecorder`, video only. The format is chosen at runtime. MP4/H.264 is
preferred (Chrome 126+ and Safari support it); otherwise VP9/VP8 WebM. The file
extension is taken from the format the recorder actually produced, so a WebM file
is never labelled .mp4. Output is 1080×1920 (9:16), 1920×1080 or 1080×1080, or
the 720-class sizes in performance mode, at 12 / 6 Mbps. Only the canvas is
captured; UI, debug overlay, demo handles, countdown and REC indicator are DOM
elements outside it.

**Honest numbers:** MacBook cameras deliver at most 1080p at 30 fps (older models
720p). The default 16:9 output uses the camera's whole frame with no cropping. A
9:16 crop uses only the centre ~608×1080 of the sensor, upscaled to 1080×1920:
softer, and there's less room for two hands. Exports are 30 fps at most. Recorded frame timing follows
the browser's rendering, so a busy machine can drop frames; use performance mode
if the debug overlay shows render or track rates falling.

## Webcam verification checklist

Tracking was tested in development with a fake camera built from real hand
photos (both hands, one hand, one hand twisted). Accuracy and lag still need
checking with a live webcam:

1. Chrome on macOS → `npm run dev` → **Start camera**. A permission prompt
   appears (camera only), then a mirrored feed. Status reads "Loading hand model…",
   then "No hands yet".
2. Raise one hand: status "One hand…", and a crayon line joins your index and thumb.
3. Raise the other hand: status "Both hands — ready!". Press **D**: the four labelled
   dots (L/R index, L/R thumb) should sit on your fingertips.
4. Make a frame. The portal's corners sit on the four fingertips and follow them
   as you move, tilt or stretch your hands.
5. Twist one hand so its thumb is above its index: the portal crosses into an X.
6. Pinch both hands closed, or bring them together: the photo fades out within ~150 ms.
7. Drop one hand: the portal holds briefly and fades; the line stays on the other hand.
8. Switch output to 9:16 and 1:1, and toggle Mirror. The dots must stay on your fingertips.
9. Turn on **New memory on reopen**: open (no advance), close fully for half a
   second, reopen. It advances exactly one photo. Dropping a hand never advances it.
10. Record 10 s with **R** in clean mode and check the file matches the preview.
11. If the portal feels laggy, lower **Smoothing**. If it jitters, raise it.

## Limitations

- Hand tracking hasn't been tested with a live webcam (the development browser
  blocks the camera). It has been run end-to-end on real hand photos through a fake
  camera, but live accuracy and lag must be checked with the checklist above.
- MediaPipe needs to see most of each hand. Hands cut off at the frame edge, or
  very close to the camera, may not be detected. Keep both hands fully in shot.
- The portal and border render over your fingers. There is no hand segmentation or occlusion.
- Photos are not persisted across reloads. Settings and the last chosen camera are
  remembered in localStorage.
- HEIC opens only where the browser can decode it (Safari). Chrome shows a message
  asking for JPEG.
- Photos are downsampled to a 2560 px long edge (~20 MB of memory each). Very heavy
  zoom (> ~1.3× in portrait) on a 1080×1920 export will look slightly soft.
- Built-in recording needs MediaRecorder + canvas capture. Where missing, the Record
  button is disabled with a suggestion to use macOS screen recording (⇧⌘5) in clean
  mode. Mobile browsers vary; the layout adapts to small screens, but recording isn't
  guaranteed there.
