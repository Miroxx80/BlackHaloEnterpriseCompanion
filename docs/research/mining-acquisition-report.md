<!-- Rohbericht der Recherche vom 2026-11-25, Thema: acquisition -->

# Mining Companion: getting the scan data out of Star Citizen

## 0. Summary

| Question | Answer | Confidence |
|---|---|---|
| Does `Game.log` (4.10.x) contain rock mass, resistance, instability, composition or quality? | **No.** None of the open-source log parsers I read has a pattern for scan figures. The most thorough mining tool (Bedrock) reads `Game.log` for location, ship and gadget placement, and reads every rock figure off the screen. | High that no tool uses it. Medium-high that the data is absent (I could not inspect a raw 4.10 log myself). |
| What do the existing tools use? | Screen capture plus OCR of the **SCAN RESULTS** panel. Bedrock uses DXGI Desktop Duplication, OpenCV, template-matched glyphs of the HUD font, and a PaddleOCR PP-OCRv4 recogniser as a second opinion. Regolith uses PaddleOCR (PP-OCRv4 ONNX) on screenshots or a browser screen share. Mining Assistant uses GDI BitBlt plus Windows.Media.Ocr. | High (read from source code) |
| Current patch | LIVE is **4.10.3**: Bedrock 3.0.5 says "for Star Citizen 4.10.3". **5.0** (renamed from 4.11) has a redesigned rock panel, and Bedrock already ships a separate reader for it. | Medium-high |
| Is anti-cheat a problem for screen capture? | I found no official CIG statement on OCR or screen capture. Every established tool limits itself to desktop capture (DXGI, WGC or BitBlt) plus read-only log access, and none reports bans. Capture only works in **Borderless** mode. | Medium |

Network note: `the-forsaken.org`, `starcitizen.tools`, `robertsspaceindustries.com` and a few blogs could not be reached from this session (DNS blocked). Bedrock's full source is on GitHub ([SC-Ravaxx/Bedrock](https://github.com/SC-Ravaxx/Bedrock)), and its release build is pinned to `https://the-forsaken.org/bedrock/...`, which confirms it is the same tool. I used the source instead of the website.

---

## 1. Game.log: what is in it and what is not

### 1.1 Verdict: no scan data
- **Bedrock** ([README](https://github.com/SC-Ravaxx/Bedrock/blob/main/README.md)) says it "reads `Game.log` … for places, trades, contracts and blueprints". All rock figures come from the screen ("Bedrock reads the mining scanner off your screen"). Its log parser ([`src/GameState.cpp`](https://raw.githubusercontent.com/SC-Ravaxx/Bedrock/main/src/GameState.cpp)) handles routes, quantum targets, loading screens, the ship control token, party channels and mining gadget placement. It has nothing for mass, resistance, instability or composition. **High confidence.**
- **SC Log Tracker** ([`sc_log_tracker.py`](https://raw.githubusercontent.com/DefaultHahn/sc-log-tracker/main/sc_log_tracker.py), about 3,400 lines, about 60 regexes) has these mining-related patterns, and none for scans:
  - asteroid field and asteroid base location names
  - `Mining gadget placed`
  - `A Refinery Work Order has been Completed at (.+)`

  **High confidence.**
- **Nexus** ([README](https://github.com/T3SoD/NexusApp)) reads `Game.log` for blueprints and contracts, but uses "the standard Windows OCR APIs" for scan values. Smart Citizen, SC Bridge Companion (57 event patterns) and all-slain list no mining-scan events either. **High confidence.**
- Inference: if a scan line existed, Bedrock would certainly use it. Its author parses `Game.log` in depth and built glyph readers for five HUD variants instead. **Medium-high confidence** that the log does not carry the data at all.

### 1.2 Mining-adjacent log lines you can still use (verified in source)
These come from comments and code in Bedrock's `GameState.cpp` and SC Log Tracker. Examples:

```
<2026-09-27T09:27:53.737Z> ...                      # timestamp format
... Projected Start Location is Nyx for route to destination ...
... Player has selected point pyro2 as their destination, routing locally
... Quantum Drive has arrived at final destination
... releasing control token for 'MISC_Prospector_824000000606' ...     # current ship
<[ActorState] Place> ... ::DoPlace] '<who>' [id] placed 'Mining_Gadget_SHIN_Sabir_800000000101' [id]
    on entity 'MineableRock_AsteroidLegendary_Savrilium_812345675858' [id]   # gadget on rock
<AttachmentReceived> Player[..] Attachment[Mining_Gadget_SHIN_Sabir_800000000101, Mining_Gadget_SHIN_Sabir, 800000000101] ... Port[weapon_attach_hand_right]
A Refinery Work Order has been Completed at <station>
Branch: sc-alpha-<ver>      FileVersion: <x.y.z...>   # log header: game version
```

How the companion can use them:
- **Auto-select the loadout.** The control-token line names the ship class and entity id. Bedrock asks the user to pick a ship once and then matches it by that id.
- **Narrow the possible ores by location.** Bedrock does this from the route and arrival lines.
- **Detect gadget placement.** The gadget line also names the rock's entity class, for example `MineableRock_AsteroidLegendary_Savrilium`, so you learn the rock's main ore. This only happens when a gadget is placed.
- **Pick the panel parser by game version.** Bedrock uses the log header to choose between its 4.10 and 5.0 readers (`setPanelGeneration`).

Practical details:
- The log sits at `<install>\StarCitizen\LIVE\Game.log`. Old logs are moved to `LIVE\logbackups\`.
- Bedrock reads at most the last 64 MB on attach, then polls every 2 s. Logs can be very large: [MassivelyOP](https://massivelyop.com/?p=338193) cites user reports of up to 1 GB per hour.
- Open the file read-only in shared mode, as Nexus states.

**Confidence: high for the line formats, which are quoted from code. Medium for whether they hold in 5.0.**

---

## 2. How existing tools read the scan panel

### 2.1 Bedrock (The Forsaken / SC-Ravaxx), v3.0.5 for 4.10.3, C++20, GPL-3.0
Primary sources: [README](https://github.com/SC-Ravaxx/Bedrock/blob/main/README.md), [dist/README.txt](https://raw.githubusercontent.com/SC-Ravaxx/Bedrock/main/dist/README.txt), [`include/ScanPanel.h`](https://raw.githubusercontent.com/SC-Ravaxx/Bedrock/main/include/ScanPanel.h), [`include/PanelFive.h`](https://raw.githubusercontent.com/SC-Ravaxx/Bedrock/main/include/PanelFive.h), [`include/TextLineReader.h`](https://raw.githubusercontent.com/SC-Ravaxx/Bedrock/main/include/TextLineReader.h), [`src/ScanPanel.cpp`](https://raw.githubusercontent.com/SC-Ravaxx/Bedrock/main/src/ScanPanel.cpp), [`src/RockContents.cpp`](https://raw.githubusercontent.com/SC-Ravaxx/Bedrock/main/src/RockContents.cpp), [`include/MiningAdvice.h`](https://raw.githubusercontent.com/SC-Ravaxx/Bedrock/main/include/MiningAdvice.h).

All facts in this section were read in source. **Confidence: high.**

**Capture**
- DXGI Desktop Duplication on Windows, X11 on Linux. It "mostly looks at a small area around the crosshair, at most about three times a second", at below-normal CPU priority.
- HDR desktops are tone-mapped: FP16 frames go through a tone curve. If the game's own Print Screen comes out black (seen with HDR on), Bedrock reads its own capture instead.
- Bedrock's own windows are masked out of the frame; it does not exclude them from capture.

**Which HUD element: the "SCAN RESULTS" panel**
- The panel is "anchored to the rock in 3D and slides with the view … so it is SEARCHED for, not cropped".
- It is searched "by structure, never colour: the HUD's colour follows the ship". The anchor is a pair of long horizontal rules of equal width and equal left edge: one under the SCAN RESULTS heading, one over the composition bar.
- Search frames are normalised to 1080 lines tall. Below 1080p the rules are thinner than a pixel and the panel is not found. 1080p is the minimum.
- After the first hit, a cheap "glance" looks at the last panel position (a few ms). A full search costs about 0.1 s and runs only every 1.5 s when nothing is on screen.

**The panel differs by ship, seat and patch.** Bedrock has a layout table for each variant:
- **Short panel:** labels `MASS:`, `RES:`, `INST:`, `COMP.` (row pitch 25 px at 1440p).
- **Long panel:** labels `RESISTANCE:`, `INSTABILITY:`, `COMPOSITION` (pitch 26).
- **Prospector** and **MOLE pilot seat** share one font.
- **MOLE turret:** wider, rounder numerals, about 1.54× larger, rows sheared about 1.8 px per row.
- **Golem:** amber labels. The HUD is drawn in the world and scales 1.15 to 1.8 with the view.
- **Since 4.10.3:** the cockpit label layout changed.
- **Gatac Hyun (in 4.10):** already uses the 5.0 lettering.
- Digit height is about 11 px at 1440p (`SHAPE_DIGIT_H = 11`).

**Row order is fixed:** ore name, mass, resistance, instability, then after the second rule the volume (`COMP./COMPOSITION … xx.xx SCU`) and the composition list.

**Composition list (4.10):** columns are share %, ore name, and **quality** (three digits, right-aligned). The inert line has quality 0.
- Layout at size 1: the name starts 58 px right of the share, the quality ends 214 px right of it, and lines are 18.5 to 19.7 px apart.
- On a MOLE turret the list "leans", so the table is detected rather than assumed.
- Quality values are snapped to the ore's 8 known quality bands (`ORE_BANDS`). This matches the wiki statement, quoted in search results, that since 4.8.0 each ore spawns from a set of predefined quality values. Quality was introduced in 4.7.0 with crafting.

**5.0 panel, verbatim from `PanelFive.h`:**
```
SCAN RESULTS
SAVRILIUM (ORE)
MASS:                        2322
RESISTANCE:          +25%     88%
INSTABILITY:         -35%  107.82
(          IMPOSSIBLE          )
COMPOSITION             15.46 SCU
15.30%  SAVRILIUM (ORE)       580
38.80%  SAVRILIUM (ORE)       322
 6.54%  GOLD (ORE)            553
39.34%  INERT MATERIALS         0
```
- In 5.0 the figures are right-aligned in a thinner font.
- Resistance and instability show the laser modifier in front, and **the printed figures already include it**. The rock's own value is `figure / (1 + modifier)`.
- Rocks under 1 SCU use an SI prefix: `754.38m SCU` = 0.75438 SCU.
- The same ore can appear twice with different qualities.

**Trap for the calculator (4.10):** a resistance printed **green or red** (not white) already includes the laser head's modifier. Bedrock stores `resistanceAdjusted` and recovers the rock's own value with `rockOwnResistance = printed / headFactor` (capped at 100). On a MOLE it uses the average of the head factors. White means the rock's own value. **This needs a colour test on the resistance figure, or the break check counts the head modifier twice.**

**Readers and their measured accuracy**
1. **Template glyph reader.** It matches numerals against shapes harvested from the HUD font. The reason: the font has a **slashed zero** that "general OCR reads as an 8 about as often as not — 12,560 as 12,568, 40 % as 48, 0 % as 8". One frame cannot always tell 0 from 8 at 11 px, so per-digit likelihoods are summed over several looks (`PanelSteadier`). A figure is released only once each digit is clearly ahead of the next candidate.
2. **PaddleOCR PP-OCRv4 recognition model** (10.8 MB, Apache-2.0), run through OpenCV dnn. It reads a line once the glyph reader has located it. It costs **50 to 60 ms per line on 6 threads, 75 to 95 ms with the game running**, or 80 to 100 ms per panel line.
   - On MOLE turret panels it reads the three rows at 0.86 to 0.96 certainty and the ore name at 0.92.
   - Signature benchmark on 230 labelled frames: the glyph reader alone got 176 right, 5 wrong, 49 unread. The neural reader fixed all 5 wrong ones and read 23 of the unread ones.
3. **Tesseract** is linked only in developer builds. Releases carry no tessdata.

**Preprocessing used for signature markers** (`src/ScreenCapture.cpp`):
- Normalise each channel to the full range.
- Upscale with **cubic interpolation to about 120 px height** (factor clamped 2 to 10). Upscaling to 240 px lost 10 points of accuracy because the glow halo grows with the image.
- Median 3 plus CLAHE(2.5, 8×8) only under night vision or the mining lamp tint.
- Unsharp mask to remove glow bleed, then adaptive Gaussian threshold for washed-out scenes.
- Try several contrast channels: "white" = min(B,G,R), which removes chromatic-aberration fringes; grayscale; and a learned colour axis.
- `hudStrokeMap`: distance of each pixel from a median of its surroundings, so text survives over a bright rock or nebula.

**Known weak spot:** the marker washed out under the mining lamp. "A wrong value is worse than none", so Bedrock prefers silence there.

### 2.2 Regolith Co. (`@regolithco/ocr` v1.5.2, ISC licence)
Sources: [RegolithCo-OCR repo](https://github.com/RegolithCo/RegolithCo-OCR), npm tarball (`dist/parsers/shipRock.js`, `dist/node.js`, `dist/browser.js`), test fixtures in [`test_images/ShipRock`](https://github.com/RegolithCo/RegolithCo-OCR/tree/main/test_images/ShipRock).

- **Engine:** PaddleOCR PP-OCRv4 detection plus recognition through `@gutenye/ocr-node` (onnxruntime-node) or `@gutenye/ocr-browser` (`ch_PP-OCRv4_det_infer.onnx`, `ch_PP-OCRv4_rec_infer.onnx`, `ppocr_keys_v1.txt`). It **runs in Node**, which fits your stack directly. Requires Node >= 22 and < 24. **High confidence.**
- **Input:** a whole screenshot, no crop. Text lines go to a keyword parser.
  - It accepts the panel if at least 3 of these anchors appear: `SCAN RESULTS`, `MASS`/`NASS`, `RESIST|RESISTANCE|RESISTANC|SISTAN`, `INSTAB|INSTABILITY|INSTABILIT|ABIT|STAB`, `COMPOSITION|COMP0SITI0N`.
  - Ore names are matched by Levenshtein distance ≤ 1.
  - Percentages must contain `%` or `.`.
- **Output:** `{mass, inst, res (0..1), rockType, ores:[{ore, percent}]}`. **No quality, no SCU** (verified in code).
- **One fixture shows a German Chrome banner** ("regolith.rocks hat ein Fenster freigegeben"). Inference: Regolith's web app captures through browser `getDisplayMedia` window sharing. **Medium-high confidence.**
- **Real OCR output from fixtures,** useful for test cases:
  ```
  SCAN RESULTS / 1 OPTIMAL ASTEROID (M-TYpe) / MASS: 9511 / RESISTANCE: 0% / INSTABILITY: 0.00 /
  COMPOSITION 133.63 SCU / 66.77% ALUMINUM (ORE) / 33.22%  INERT MATERIALS        (4.1.1)
  SCAN RESULTS / GRANITE DEPOSIT / NASS: 21157 / RESISTANC36% / INSTABILIT164.73 / IMPOSSIBLE /
  COMP0SITI0N 72.16SCU / 35.08% QUANTAINIUM (RAW) / 57.20% ALUMINUM(ORE) / 7.71% INERT MATERIALS
  ```
  These show the typical errors: M read as N, O read as 0, missing colons and spaces.
- **Gap (inference from code):** the keyword lists do not include the 4.10 short labels `RES:` and `INST:`, and there is no quality column. The latest npm release is from Dec 2025, before 4.7/4.10. Expect it to miss on the current short panel. **Medium-high confidence.**

### 2.3 Star Citizen Mining Assistant (longinart), .NET 10 WPF, MIT, v0.4.0
Sources: [README](https://github.com/longinart/StarCitizenMiningAssistant), [`docs/ARCHITECTURE.md`](https://raw.githubusercontent.com/longinart/StarCitizenMiningAssistant/main/docs/ARCHITECTURE.md), [`docs/DECISIONS.md`](https://raw.githubusercontent.com/longinart/StarCitizenMiningAssistant/main/docs/DECISIONS.md), [`Core/Recognition/RockPatch.cs`](https://raw.githubusercontent.com/longinart/StarCitizenMiningAssistant/main/src/StarCitizenMiningAssistant.Core/Recognition/RockPatch.cs), [`RockOcrFields.cs`](https://raw.githubusercontent.com/longinart/StarCitizenMiningAssistant/main/src/StarCitizenMiningAssistant.Core/Recognition/RockOcrFields.cs).

All facts read in source. **Confidence: high.**

- **Capture:** GDI `BitBlt` of fixed screen fractions, about twice a second.
- **OCR:** **Windows.Media.Ocr**. The image is upscaled up to 3× and kept at most 2000 px per side.
- **Rock patch:** **x = 0.64, y = 0.41, w = 0.18, h = 0.20** of the monitor. It was measured on 52 cockpit screenshots at 2560×1440: header at y 614 to 754, text column at x 1720 to 1980.
  - Composition patch: same column, y = 0.41 + 0.20 − 0.04.
  - On a miss it tries one step up, down, left and right (100 px at 1440p).
- **Parsing:**
  - Takes the number after the labels `mass`, `resistance`, `instability`, matched on word boundaries. Also accepts `HASS` or `HAS` for MASS.
  - The mass, resistance and instability digits are pale green. A custom digit reader handles the slashed zero and 3/5/6/8 confusions.
  - Total SCU comes from the `COMPOSITION … SCU` line. The cargo line (`x / y SCU`) is ignored, and `INERT` is dropped.
- **Stabilising:**
  - Two identical reads confirm mass, resistance or instability.
  - Composition locks only after **5 identical frames** and only while the HUD shows `FRACTURE MODE` or `EXTRACTION MODE`.
  - Every OCR value stays "Uncertain" until confirmed. Only confirmed values feed the calculation (`ObservedValue<T>` with Missing/Uncertain/Confirmed). Manual entry counts as Confirmed.
- **Requirements and tips:** Borderless mode. "Scan readings are most accurate when the HUD contrast is high. Darker game environments often improve OCR recognition."

### 2.4 Other tools (mostly the RS signature number, not the rock panel)
| Tool | Capture | OCR | Notable |
|---|---|---|---|
| [Smart Citizen SCO](https://raw.githubusercontent.com/Osiris-DevWorks/smart-citizen/main/src/gui/sco_overlay.py) (Apache-2.0) | Qt `grabWindow`, region `(0.38, 0.28, 0.24, 0.17)`, every 250 ms | Glyph templates | The cockpit panel "is part of the 3D cockpit, so a wider field of view draws it smaller and nearer the middle". Needs 2 equal reads. |
| [sc-ore-scanner](https://raw.githubusercontent.com/Hunter-36/sc-ore-scanner/master/docs/ocr-pipeline.md) (Rust) | Primary monitor every 0.75 s | `ocrs` (pure Rust) | Lanczos upscale ×4 to ×8 toward about 192 px. **"aggressive thresholding destroyed digit strokes … don't reintroduce it"**. CLAHE made results worse. Unreadable below about 24 px region height. Confirms at 3 of 6 frames. |
| [SC-MiningAssist](https://github.com/maxbook/SC-MiningAssist) (Rust) | GDI | Windows.Media.Ocr | **Requires an English or French Windows OCR language installed.** Up to 8 reads/s. |
| [Nexus](https://github.com/T3SoD/NexusApp) | User-drawn region | Windows OCR | Also reads `Game.log` |
| [citizen-assistant](https://github.com/fishtaco7/citizen-assistant) | Region | RapidOCR (ONNX) | Exclusive fullscreen cannot be captured |
| [sc-ohseearr](https://github.com/w00zla/sc-ohseearr) | DXGI by executable | PP-OCRv6 tiny + recogniser fine-tuned on the SC font, ONNX (CPU/DirectML) | A framework; no rock-panel reader yet |
| [sc-battaglia-mining-tracker](https://github.com/DizzyBHigh/sc-battaglia-mining-tracker) | Electron | **tesseract.js** | The only Electron + tesseract.js example found, used for contract screens and not the rock panel |
| Overwolf | – | – | No Star Citizen game-events (GEP) support found; only an overlay compatibility note ([release notes](https://support.overwolf.com/en/support/solutions/articles/9000199444-overwolf-release-notes)). **Not a data source.** Low-medium confidence. |

---

## 3. What this means for a Node/Electron app on Windows

### 3.1 Capture options
| Option | Notes | Confidence |
|---|---|---|
| **Electron `desktopCapturer` + `getUserMedia`/`getDisplayMedia` stream** | Use `setDisplayMediaRequestHandler` with `desktopCapturer.getSources({types:['screen']})` ([docs](https://raw.githubusercontent.com/electron/electron/main/docs/api/desktop-capturer.md)). Keep **one live stream** and grab frames (canvas or `MediaStreamTrackProcessor`). Do not call `getSources` with large `thumbnailSize` in a loop: it re-captures every source each time. Chromium uses DXGI or WGC under the hood. | High for the API. Inference for performance. |
| Native addon (`node-screenshots` 0.2.8, Rust/xcap; or a small C++/Rust DXGI helper) | Easier to crop in the main process and feed the OCR worker. A DXGI helper gives you HDR handling the way Bedrock does it. | Medium |
| `screenshot-desktop` | Starts an external process per shot. Too slow for 2 to 3 Hz. | Medium (inference) |

Requirements and pitfalls:
- **Borderless window mode is required.** Bedrock, longinart, Smart Citizen, zoomphoto and Uni Mining HUD all say exclusive fullscreen cannot be captured or overlaid. **High.**
- **HDR:** DXGI returns FP16 frames and you must tone-map them. Print Screen can come out black. **High (Bedrock).**
- **Own overlay in the frame:** either mask your windows out like Bedrock, or set `BrowserWindow.setContentProtection(true)`, which maps to `WDA_EXCLUDEFROMCAPTURE` on recent Windows (zoomphoto uses that API natively). **Medium.**
- **Minimum resolution:** 1080p. At 1440p the digits are about 11 px tall, so upscaling is mandatory.

### 3.2 OCR engine options
| Engine | Fit for this HUD | Cost | Recommendation |
|---|---|---|---|
| **PaddleOCR PP-OCRv4/v5 via ONNX** (`@gutenye/ocr-node` or your own `onnxruntime-node` 1.31 rec-only) | Proven on this HUD by Bedrock and Regolith. Handles glow and colours. Still confuses the slashed 0 with 8, 6 with 8 and 3 with 2. | About 50 to 100 ms per line, rec-only, CPU (Bedrock measured). Full det+rec on a screenshot costs more. | **Primary.** Run recognition only, on line crops you locate yourself. |
| **Windows.Media.Ocr** | Used by longinart, maxbook, Nexus, KuzuCevirme. Fast and free, no model to ship. **Needs the en-US OCR language pack** (`Add-WindowsCapability -Online -Name "Language.OCR~~~en-US~0.0.1.0"`). Relevant for German Windows installs. Returns no confidence. | Low (inference: tens of ms on small crops) | Good alternative. Call it from Node through a **small persistent .NET helper over stdin/stdout**. The NodeRT packages (`@nodert-win10-*`) date from 2022 and need ABI rebuilds for Electron. A `node-windows-ocr` CLI also exists but starts a process per call. |
| **tesseract.js 7.0 (WASM)** | Weakest for glowing 11 px HUD digits and the slashed zero. Bedrock keeps Tesseract only in developer builds. | Highest CPU (inference) | Use it for pasted screenshots at most. Do not use it as the live engine. |
| **Template/glyph matching of digits** (OpenCV / sharp) | Best per-digit accuracy (Bedrock, longinart, Smart Citizen) | Few ms | Add later for digits once you have labelled crops |

### 3.3 Recommended pipeline
This is synthesised from the sources above; the individual steps are verified, the combination is my recommendation.
1. Capture the game monitor at 2 to 3 Hz, and only while `StarCitizen.exe` is in the foreground.
2. **Locate the panel.** Phase 1: fixed region `(0.64, 0.41, 0.18, 0.40)` with ±1 step (longinart). Phase 2: a structural search for the two horizontal rules (Bedrock). Remember the last position.
3. Upscale ×3 to ×4 (cubic or Lanczos) and use contrast, not hard thresholds. Try several channels (min(B,G,R), gray) because the HUD colour depends on the ship.
4. OCR the lines. Parse with tolerant labels: `MASS|NASS|HASS`, `RES|RESISTANCE`, `INST|INSTABILITY`, `COMP.|COMPOSITION … SCU` (including the `m` prefix), and rows of `NN.NN% <ORE> (RAW|ORE)  QQQ`.
5. Validate each field:
   - mass is an integer
   - resistance is 0 to 100 %
   - instability has two decimals
   - shares sum to about 100
   - quality is one of the ore's 8 band values
   - ore names are fuzzy-matched against a catalogue
6. Confirm each figure only after N equal frames (2 for figures, 5 for composition). Show anything unconfirmed as uncertain and let the user correct it.
7. Read the resistance figure's **colour**: green or red means the head modifier is already included. On 5.0, parse the `+25%` modifier separately.
8. Switch the parser by game version from the `Game.log` header (4.10 vs 5.0), and by ship from the control-token line (MOLE turret and Golem use different fonts and layouts).

### 3.4 Localisation risk (inference, unverified)
- Many German players use community `global.ini` translations. If the panel labels are localised, English keyword parsers (Regolith style) fail.
- Bedrock deliberately anchors on structure and value formats ("three lines … a whole number, a number with a per cent sign and a number to two places"), not on words.
- longinart can rewrite `global.ini` mineral names, which shows these strings come from the localisation file.

**Confidence: medium.**

---

## 4. Anti-cheat (EAC)
- **Verified:** every tool reviewed limits itself to OS screen capture (DXGI, WGC, GDI), read-only `Game.log`, and its own topmost windows. None reads memory, injects code, hooks DX/Vulkan or sends input. Nexus states "Easy Anti-Cheat has nothing to flag"; that is the author's own claim. **High** that this is the community norm.
- **Not found:** any official CIG or Spectrum statement allowing or forbidding OCR overlays. The wiki mentions that ReShade was eventually whitelisted (via search). **Treat this as unconfirmed.**
- **Inference:** DXGI Desktop Duplication is the same path OBS, Discord and Windows Game Bar use. Capture of borderless windows evidently works, since all the tools above function. **Medium.**
- **Grey zones to avoid or keep opt-in:**
  - Writing `global.ini` (Bedrock and longinart do it, opt-in).
  - Global hotkeys via polling `GetAsyncKeyState` (Smart Citizen does it). This is harmless, but keep it minimal.
  - Any automation of input.

---

## 5. Fallbacks (build these first)
1. **Manual entry form:** mass (kg, integer), resistance (%), instability (2 decimals), total SCU, and per-ore rows with % and quality. longinart treats manual entry as "Confirmed" and lets the user overwrite any OCR field. The phone or tablet UI is well suited to this.
2. **Screenshot import:** a hotkey or paste/upload of a picture.
   - Bedrock: `Ctrl+Alt+S` takes a snapshot; Print Screen pictures are read from the game's screenshot folder for its UEX Datarunner.
   - Regolith: upload, or browser window share.
   - Run the same OCR on the still image and show the parsed values for confirmation.
3. **Live auto-scan** as phase 2, with a debug dump of each panel crop and its OCR text (Bedrock keeps `panel_*.png/.txt`). That gives you a labelled test set straight from your org's own screens and ships.

## 6. Licences, if you reuse code
| Project | Licence | What it means for you |
|---|---|---|
| Bedrock | **GPL-3.0** | Study it freely. Copied code makes your distributed binary GPL. |
| Regolith OCR | ISC | Permissive. |
| longinart | MIT | Permissive. |
| Smart Citizen | Apache-2.0 | Permissive. |
| PP-OCRv4 models | Apache-2.0 | Permissive. |
