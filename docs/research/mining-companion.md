<!-- Recherche-Ergebnis vom 2026-11-25 (Patch 4.10.3 LIVE). Englisch belassen, da Quellen und Codezitate englisch sind. -->

# Design Brief: Mining Companion module

**Scope:** Star Citizen **Alpha 4.10.3 LIVE** (build 4.10.3-LIVE.13165946, live since 2026-11-12). 5.0 is on PTU and changes the mining constants and the scan panel.
- Patch confidence: high. Three sources agree: the scunpacked-data commit name, the Bedrock 3.0.5 README ("for Star Citizen 4.10.3") and the SCMDB changelog.
- Release date: medium (seen only in search snippets).

**Research limits.** All four research passes could reach only GitHub. These sites were seen only as search summaries and were never fetched: the-forsaken.org, starcitizen.tools, RSI/Spectrum, uexcorp.space, regolith.rocks, erkul.games, api.star-citizen.wiki. Everything marked "verified" was read in open-source code or datamined game files.

**Reference tool.** Bedrock is open source: https://github.com/SC-Ravaxx/Bedrock, GPL-3.0, C++, commit e5c96ac, 2026-11-22. It contains the logic behind the screenshot the user shared ("CAPABLE SOLO", "30–38 %", "BoreMax 64.2 → 19.2"). That logic can be reproduced from its source code.

---

## 1. Data acquisition

### 1.1 Recommendation
- **Primary source: screen capture plus OCR** of the in-game **SCAN RESULTS** panel.
- **Manual entry** is the first fallback and should be built first.
- **Game.log is a side channel only.** It gives ship, location, game version and gadget placement, never rock figures.

| Option | Verdict | Evidence | Confidence |
|---|---|---|---|
| Game.log | **No scan data** (mass, resistance, instability, composition, quality). Useful for context only. | No open-source parser has a scan pattern: Bedrock `src/GameState.cpp`, SC Log Tracker (about 60 regexes), Nexus, SC Bridge Companion. Bedrock parses the log in depth, yet built five HUD glyph readers instead. | High that no tool uses it. Medium-high that the data is absent: nobody inspected a raw 4.10 log. |
| OCR of the scan panel | **Primary.** Every serious tool does this (Bedrock, Regolith OCR, longinart Mining Assistant, Nexus). | Source code of those tools | High |
| Manual entry | **Phase 1 and permanent fallback.** Works on phone and tablet. Manual values count as "Confirmed". | longinart `ObservedValue<T>` | High |
| Memory reading / Overwolf | Excluded (anti-cheat constraint). Overwolf has no Star Citizen game events. | Overwolf release notes | Low-medium |

### 1.2 Game.log side channel
Verified line formats, quoted in Bedrock `GameState.cpp` and SC Log Tracker. Confidence: high for 4.10, medium for 5.0.
- **Location.** `<ISO timestamp>` plus `Player has selected point … as their destination`, `Quantum Drive has arrived at final destination` and `Projected Start Location is …`. Use it to narrow the expected ores and to choose the ruleset (5.0 Nyx I uses v5 constants).
- **Current ship.** `releasing control token for 'MISC_Prospector_824000000606'` gives ship class and entity id. Use it to auto-select the loadout.
- **Gadget placement.** `… placed 'Mining_Gadget_SHIN_Sabir_<id>' … on entity 'MineableRock_AsteroidLegendary_Savrilium_<id>'` gives the gadget type and the rock's main ore. This is needed to divide the gadget back out (see 1.6).
- **Game version.** The header lines `Branch: sc-alpha-<ver>` and `FileVersion` pick the panel parser (4.10 vs 5.0) and the ruleset.
- **Other events.** `A Refinery Work Order has been Completed at <station>`.
- **How to read it.**
  - The file is `<install>\StarCitizen\LIVE\Game.log`; older logs are in `logbackups\`.
  - Open it read-only and shared.
  - Tail it: on attach, read at most the last 64 MB, then poll about every 2 s (Bedrock).
  - Logs can grow to about 1 GB per hour (MassivelyOP user report, low-medium).

### 1.3 Capture (Electron, Windows)
- **Game window mode.** The game must run **Borderless**. Exclusive fullscreen cannot be captured (Bedrock, longinart, Smart Citizen, citizen-assistant). High confidence.
- **Capture method.** Keep one live stream from Electron `desktopCapturer` with `setDisplayMediaRequestHandler` / `getDisplayMedia`, and grab frames from it.
  - Do not call `getSources` with large thumbnails in a loop.
  - Alternative: a native addon (`node-screenshots`, or a small DXGI helper in Rust/C++). The DXGI helper is needed if HDR tone-mapping becomes necessary.
  - Confidence: high for the API, inferred for performance.
- **Rate.** 2–3 Hz, only while `StarCitizen.exe` has focus, at below-normal priority (Bedrock: at most about 3/s around the crosshair).
- **HDR.** DXGI returns FP16 frames that must be tone-mapped. The game's own Print Screen can come out black with HDR on (Bedrock). High confidence.
- **Own overlay.** Exclude it with `BrowserWindow.setContentProtection(true)` (WDA_EXCLUDEFROMCAPTURE), or mask it out of the frame. Medium confidence.
- **Minimum resolution is 1080p.** Below that, the panel's horizontal rules are thinner than a pixel. At 1440p, digits are about 11 px tall (`SHAPE_DIGIT_H = 11`). High confidence.

### 1.4 Locating the panel
- **The panel is not at a fixed position.** It is anchored to the rock in 3D and slides with the view. It must be searched for, not cropped. High confidence (Bedrock).
- **Search heuristic (MVP).** Start from longinart's fixed region `x=0.64, y=0.41, w=0.18, h=0.20`, plus the composition block below it (total height about 0.40). Then try one step up, down, left and right. This was measured on 52 cockpit screenshots at 2560×1440. High confidence for the cockpit, but it is only a heuristic.
- **Structural search (later).**
  - Look for two long horizontal rules of equal width and equal left edge: one under "SCAN RESULTS", one over the composition bar.
  - Search by structure, never by colour, because the HUD colour follows the ship.
  - Normalise frames to 1080 lines.
  - After a hit, re-check only the last position ("glance", a few ms). Run a full search (about 0.1 s) every 1.5 s when nothing is found. (Bedrock)
- **Layout differs by ship, seat and patch** (Bedrock layout tables):
  - Prospector and MOLE pilot seat share one font.
  - The MOLE turret has about 1.54× larger, rounder digits and sheared rows (about 1.8 px per row).
  - The Golem has amber labels, is drawn in the world and scales 1.15–1.8×.
  - The Gatac Hyūn already uses the 5.0 lettering in 4.10.
  - The cockpit label layout changed in 4.10.3.
  - The parser must be selected per ship and seat; the Game.log control-token line helps here.

### 1.5 OCR engine and preprocessing
| Engine | Role | Notes |
|---|---|---|
| **PaddleOCR PP-OCRv4 recognition via `onnxruntime-node`** | **Primary** | Proven on this HUD by Bedrock and Regolith. Apache-2.0, about 10.8 MB.<br>Run **recognition only** on line crops you locate yourself: 50–100 ms per line on CPU with the game running (Bedrock measurement).<br>`@regolithco/ocr` (ISC) wraps det+rec in Node, but needs Node ≥22 <24 and has no 4.10 short labels and no quality column.<br>High confidence. |
| Windows.Media.Ocr (via a persistent .NET helper over stdin/stdout) | Alternative | Fast, no model to ship, no confidence values.<br>**Requires the en-US OCR language pack** (`Add-WindowsCapability -Online -Name "Language.OCR~~~en-US~0.0.1.0"`). This matters on German Windows. High confidence. |
| Template glyph matching (digits) | Phase 3 accuracy upgrade | Best per-digit accuracy (Bedrock, longinart, Smart Citizen). Needs labelled crops. |
| tesseract.js | Do not use live | Weakest on glowing 11 px digits. Bedrock keeps Tesseract out of its releases. |

**Known failure modes** (verified on real OCR output in Regolith test fixtures and Bedrock comments):
- The HUD font has a **slashed zero**, which reads as 8 "about as often as not": 12,560 becomes 12,568, 40 % becomes 48.
- Other confusions: 6↔8, 3↔2, M→N/H (`NASS`, `HASS`), O→0 (`COMP0SITI0N`). Colons and spaces get dropped (`RESISTANC36%`).

**Preprocessing that worked:**
- Normalise each channel.
- Upscale with cubic or Lanczos to about 120 px line height (×3 to ×4 at 1440p). Too much upscaling hurts: going to 240 px lost 10 points of accuracy.
- Try several contrast channels: `min(B,G,R)` (removes colour fringes), grayscale, and a learned colour axis.
- Use an unsharp mask against glow bleed.
- Add CLAHE only under night vision or the mining-lamp tint.
- **Avoid aggressive thresholding.** sc-ore-scanner: "aggressive thresholding destroyed digit strokes"; CLAHE also made its results worse.

### 1.6 Parsing and validation
**Panel order is fixed** (4.10, the game's English):

```
SCAN RESULTS / <ORE> (RAW|ORE) / MASS: <int> / RESISTANCE: <int>% / INSTABILITY: <d.dd>
[difficulty line on MOLE turret and 5.0] / COMPOSITION <d.dd> SCU / rows "<dd.dd>%  <ORE NAME>  <qqq>" ... / INERT MATERIALS 0
```

**Label variants to accept:**
- `MASS|NASS|HASS|HAS`, `RES|RESISTANCE`, `INST|INSTABILITY`, `COMP.|COMPOSITION`.
- Ice appears as `RAW ICE` or `ICE (RAW)`.
- The Golem abbreviates names, e.g. `HEPH (RAW)`.
- In 5.0, sizes below 1 SCU use an SI prefix: `754.38m SCU` = 0.75438.
- The same ore can appear on **two rows with different qualities**.
- Match ore names fuzzily: edit distance at most a third of the letters (Bedrock `snapOreName`). Spelling aliases include Quantainium/QUANTANIUM and Aluminium/Aluminum.

**Plausibility checks** (all verified in Bedrock `server/refinery/app.py judge_rock`, `RockScans.h`; high confidence):
1. Mass is an integer, resistance is 0–100 %, instability has 2 decimals, and SCU ≤ 59.3 (the largest ship rock is 59.22 SCU).
2. Shares sum to 98–100.5 %.
3. Each quality is one of its ore's **8 band values** (table in §3.4). Anything else is a misread.
4. Mass against volume:
   - `(mass+1)/(scu−0.01) ≥ 142.857 × 0.99`, otherwise the rock is "lighter than its volume".
   - `(mass−1)/(scu+0.01) ≤ 142.857 × ρmax(rockType) × 1.01`, otherwise it is "heavier than its parts".
5. **Discard the "not scanned yet" frame.** For 1–2 s (up to about 30 s) the panel shows the volume as the mass, with RES 0 and INST 0. Detect it with `ore≠Ice && res==0 && inst==0 && |mass − 142.857·SCU| ≤ max(1.5, 0.6 %·mass)`.
6. **Confirm over several frames.**
   - Numbers need 2 identical reads; composition needs 5 identical frames (longinart). Bedrock instead sums per-digit likelihoods over several looks and takes a median of about 5.
   - Show unconfirmed values as "uncertain". Only confirmed values feed the calculator.
   - Every field stays editable by the user.

**Values on the panel may already include modifiers.** This is critical; without it, modifiers are counted twice.
- **4.10, resistance colour.** White is the rock's own value. **Green or red already includes the seat's laser-head modifier.** Recover the rock's value with `own = printed / headFactor`, capped at 100. Bedrock uses the mean head factor on a MOLE. Medium-high confidence.
- **5.0.** The modifier is printed in front of the value (`RESISTANCE: +25%  88%`), and the value already includes it: `own = value / (1 + mod)`.
- **Gadget attached.** RES and INST are shown with the gadget applied (56 % reads 28 % under a Sabir). Divide by `(1 + g/100)`. Game.log tells you a gadget was placed. Medium confidence.

### 1.7 Phased plan (my recommendation, combining verified pieces)
1. **Phase 1.** Manual entry form on web, phone and tablet, plus the calculator. Fields: mass, RES, INST, SCU, rows of % / ore / quality, and a "resistance already modified?" toggle.
2. **Phase 2.** Screenshot import (hotkey, paste or upload; Bedrock uses Ctrl+Alt+S). Run OCR on the still image and confirm in a form. Save each crop with its OCR text as a labelled test set from the org's own ships and screens (Bedrock keeps `panel_*.png/.txt`).
3. **Phase 3.** Live auto-scan in the Electron app: capture, panel search, OCR, confirmation. Results are pushed to the backend so the phone or tablet shows them.

### 1.8 Anti-cheat
- **Verified:** every tool reviewed uses only OS screen capture (DXGI, WGC or GDI), read-only Game.log and its own windows. No memory access, injection, DX hooks or input. None reports bans.
- **Not found:** any official CIG or Spectrum statement on OCR overlays. Treat this as unconfirmed. Medium confidence.
- **Keep optional:** writing `global.ini`, and global hotkeys.
- **Never:** input automation.

---

## 2. Calculation model

### 2.1 Physics: a charge balance, not an HP pool (high confidence)
The rock's charge bar fills with the effective laser power and drains in proportion to mass. The constants come from `miningglobalparamsship.xml`, verbatim from the datamine [S4: x3nnnonn/StarCitizenDiff]: `decayPerMass 0.2`, `powerCapacityPerMass 10`, `cSCUPerVolume 0.7`, `optimalWindowSize 0.1`, `optimalWindowMaxSize 0.5`, `defaultVolume 5122.499`, among others.
- **Gain per second** = `(1−R_eff)·Σ(E_i·throttle_i·falloff_i) / (mass·10)`.
- **Decay per second** = 0.02 of the bar.
- The bar holds steady when through-power = `0.2 × mass`.
- Every tool reviewed uses this; the "0.2", "÷5" and "×5" constants are all `decayPerMass`.
- Bedrock validated it on 9 rocks at 0 % resistance, within 2.2 percentage points (0.19 and 0.21 fit worse).

**Ruleset constants:**

| Ruleset | decayPerMass | cSCUPerVolume | kg/SCU at ρ=1 | Confidence |
|---|---|---|---|---|
| 4.10 ship rocks | 0.2 | 0.7 | 142.857 | High (game file) |
| 5.0 PTU, Nyx I `_v5` rocks | 1.45 | 7.61 | 13.141 | Medium (Bedrock: 25 rocks within 2 %; v5 XML not fetched) |
| FPS / ground vehicle | `powerCapacityPerMass` 5 / 4; FPS `resistanceCurveFactor 0.33` | | | Out of scope for v1 (S0 heads are on another scale) |

### 2.2 Formulas
```
needs          = decayPerMass × mass                                      // e.g. 0.2 × 4627 = 925.4
P_i            = DamageEnergy_i                                            // laser "PowerTransfer"
                 × Π passiveModule.damageMultiplier (fireActionIndex 0)    // multiplicative
                 × Π activeModule.damageMultiplier (if fired)
                 × (1 + crafted_i/100)                                     // crafted Impact Force, ×0.64..×1.44, applied last
                 × falloff_i(d)                                            // 1 up to fullDamageRange, linear to 0 at zeroDamageRange
M_i            = (1 + laser.res/100) × Π(1 + module.res/100)               // = HUD "RESISTANCE"/100; lower is better
R_own          = rock's own resistance (after removing head/gadget pre-modification, §1.6)
R_eff_i        = clamp(R_own × (1 + gadget.res/100) × M_i, 0, 1)
through_i      = P_i × (1 − R_eff_i ^ k)          // k = 1 (linear, most tools) or 1.21 (Bedrock fit), CONFIGURABLE
share_i        = needs / through_i                // fraction of full throttle that holds the bar steady
holdPct_i      = 100 × share_i ;  risePct = holdPct × 1.08 (Bedrock "toRise")
capable solo   = share_i ≤ 1 (Bedrock edge 1.05)  AND  share_i ≥ throttleMin_i  (else "overpowered": back off / falloff)
comfortable    = share ≤ 0.90 ; else "charge will rise slowly"
maxMass_i      = through_i / decayPerMass         // largest rock of this resistance the head can break
display band   = instability > 1 ? [hold−4, hold+4] : [hold]
```

**Where the formulas come from:**
- Bedrock `include/MiningAdvice.h` (`BREAK_DECAY_PER_MASS 0.2`, `BREAK_EDGE 1.05`, `BREAK_COMFORTABLE 0.90`, `RESISTANCE_CURVE 1.21`, `throttleFor()`).
- mort13 `js/calculations.js` (`c_mass = 0.2`, linear).
- sc-holotable `crates/sc-mining` (`max_mass = (1−R)·E/decayPerMass`).

**Stacking (high confidence for 4.10):**
- Power, resistance and window are **multiplicative**.
- HUD proof: Helix I + Focus III + Rieger-C3 shows FRACTURE PWR **119** (= 0.95 × 1.25) and WINDOW SIZE **83** (= 0.60 × 1.40 × 0.99). Additive stacking would give 120 and 99.
- **Contradiction:** Regolith (comment of Feb 2025, 4.0.1: "modules stack again", additive), starvein, SC-Bridge and SCMDB's default model all add. Treat these as outdated for 4.10.

**Instability:**
- Bedrock adds the laser and module percentages and applies the gadget multiplicatively.
- sc-holotable multiplies everything.
- The difference is small (medium confidence).
- **Instability does not change the power requirement.** It makes the bar surge or wander, so show the result as a band.

**Active modules** (medium confidence):
- Only one interrupting active module runs at a time (`canInterrupt=1, isInterruptible=1`).
- **Surge** (`0/0`) runs alongside others, even a second Surge. A community check fits: 2× Surge on a Helix I breaks about 44,000 kg = 3900 × 1.5² / 0.2. One MOLE check contradicts this.
- Show "with Surge" and "without Surge" separately, as Bedrock does.

**Gadgets:**
- They attach to the **rock**, one per rock; more "can result in a catastrophic explosion".
- They scale the rock's own figures: `R × (1 + g/100)`, `INST × (1 + g/100)`.
- Example: BoreMax −70 % gives 64.16 → 19.25, which matches the screenshot's "64.2 → 19.2". High confidence.

### 2.3 Multiple lasers (MOLE, several ships) – unresolved, make it configurable
- **Agreed:** through-power from all heads on a rock **adds up**.
- **Disputed:** how resistance works with several heads.
  - **Per head (Bedrock):** each head applies only its own `M_i`, then `Σ through_i`. This is the more conservative mode.
  - **Product (mort13, sc-holotable, "client code"):** the rock's resistance is multiplied by *every* hitting head's factor (3× Helix II gives ×0.343), and the power is summed.
  - No published measurement separates the two. Confidence that either is right: low-medium.
- **mort13 bug (inferred):** it folds the gadget into each laser's modifier and multiplies across lasers, so the gadget counts N times. Do not copy this.
- **Crew logic (Bedrock `rockVerdict`, `src/MinerGUI.cpp` L7720ff):**
  1. **Per head:** compute `share_i`. Heads with `throttleMin ≤ share ≤ 1.05` can hold the rock alone.
  2. **Solo result:** rank those heads by `window × (0.5 + 0.5·max(0, 1 − |share−0.6|/0.6))`, which prefers a wide window and a throttle near 60 %. Output **"CAPABLE SOLO – <LEFT/MIDDLE/RIGHT> <laser>"**.
  3. **All too strong:** if every capable head would need less than its throttle minimum, output **"MIN LASER POWER AT OPTIMAL RANGE – HIGH"** plus a back-off distance. The target throttle is `throttleMin + 0.25`, clamped to 35–60 %; the distance comes from inverting the linear falloff.
  4. **Crew needed:** otherwise add heads strongest first until `Σthrough ≥ needs/0.9`. Output **"N LASERS REQUIRED" / "ALL 3 LASERS REQUIRED"**.
  5. **Impossible:** otherwise **"LASER(S) CANNOT BREAK DEPOSIT"**, with required power `0.2·mass` and available power `Σ`.
  6. **Informational line:** "All 3 lasers together at approximately X % each" = `needs / Σthrough`, shown with ±4.
- **Instability with several lasers** (sc-holotable, "owner = ship" is inferred): two lasers from one ship halve the wave; two ships on one rock double it. Low-medium confidence. Not needed for v1.

### 2.4 Gadget advice (Bedrock `advise()`; thresholds are author "first estimates")
- **Gadget required.** If the share without a gadget is above 1.05, look for a resistance gadget that brings it to ≤ 1.05: "Required – … with it approximately X %". If none does: "NO GADGET CAN HELP".
- **Gadget recommended.** If the share is between 0.90 and 1.05 and a gadget brings it to ≤ 0.90: "Recommended – Laser power A → B %".
- **Gadget optional.** Otherwise:
  - INST ≥ 5: **BoreMax**.
  - Window < 70: Waveshift.
  - Otherwise OptiMax.
  - The line reads "Optional: <name>, Instability a → b".
- **Side effects.** Show each gadget's side effects, e.g. BoreMax adds +10 % resistance (56 → 61.6 %).

### 2.5 Worked check against the user's screenshot (verified arithmetic)
**Inputs:** Bexalite, 4,627 kg, RES 56 % (white), INST 64.16. MOLE with Helix II / Hofstede-S2 / Helix II, stock.
- **Needs** = 925.4.
- **Hofstede-S2:** P = 4060, M = 0.70, `(0.392)^1.21 = 0.3221`, so through = 2752 and share = **33.6 % → "30–38 %"**. This matches exactly.
  - The linear model gives 37.5 % instead.
- **Helix II alone** would need 27.7 %, which is below its 30 % minimum, so it does not count as "holding alone". The Hofstede is picked as MIDDLE solo because it has the widest window (+60).
- **BoreMax:** 64.16 × 0.30 = 19.25 → "19.2".
- **Not fully reproduced:** "All 3 lasers together approximately 4–12 %".
  - Bedrock's per-head model with stock heads gives 9.8 %, which would display as 6–14 %.
  - mort13's product model happens to give 8.2 %.
  - Inference: the screenshot's Helix IIs carried modules or crafting. Either way the value is below the Helix II minimum, so the line is informational only.

### 2.6 Presentation (mirror Bedrock)
- **Header:** `<mass> kg <ORE (RAW)>`, `RES <n> %`, `INST <n.nn>`, `<scu> SCU`.
- **Per-ore table:** % / SCU / quality, with the inert line greyed.
- **Verdict:** CAPABLE SOLO / N LASERS REQUIRED / CANNOT BREAK / MIN POWER HIGH.
- **Recommended head** and position.
- **Hold-power band** ("30–38 % laser power will hold charge steady") and the all-lasers line.
- **Gadget advice** with its before → after effect.
- **Ship / loadout summary.**
- **Uncertainty labels:** show which resistance model and multi-laser mode were used, and offer a toggle to compare linear with 1.21.

### 2.7 Out of scope or low confidence for v1
- **Optimal window and fracture pools.** Window size `(1 − 0.75·T) × 0.1`; about 20 s inside the window to fracture; a danger pool fills above the window and leads to a catastrophic fracture. Source: sc-holotable only, medium confidence. Can be shown as a qualitative hint later.
- **Range falloff shape.** Linear between full and zero range; this is not in the game files. Bedrock has two matching turret measurements. Medium confidence.
- **Quantainium decay or explosion timer in 4.x.** Unknown (low confidence). Do not hard-code one.

---

## 3. Equipment and ore data

### 3.1 Sources
| Source | Use | Notes |
|---|---|---|
| **scunpacked-data** (github.com/StarCitizenWiki/scunpacked-data, generated with octfx/ScDataDumper) | **Primary for stats** | Each commit is named after the LIVE build (latest `3cc8072` = "4.10.3-LIVE.13165946", 2026-11-21). Raw files come from `raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/master/items/<file>.json`. No key needed. No PTU branch. **No LICENSE file**, so it relies on the usual fan-tool tolerance (medium). High confidence on content. |
| **Bedrock `include/MiningHardware.h`, `MiningAdvice.h`, `MiningLocations.h`, `server/refinery/app.py`** | **Cross-check / unit-test oracle**; ore densities, quality bands, rock parts, element physics | Generated from Data.p4k. All values agree with scunpacked. GPL-3.0 code: take the numbers (game data), not the code. |
| **UEX API 2.0** (`api.uexcorp.space/2.0` or `api.uexcorp.uk/2.0`) | **Prices and shop locations only** | Endpoints `commodities_prices_all`, `terminals`, `items_prices?id_category=` (28 = gadgets, 29 = heads, 30 = modules, medium). Bearer app token, about 60 requests per minute. "Powered by UEX" badge expected. **Stats are stale**: Helix II "1020–4080" is the pre-4.9 text (medium; seen in mort13's snapshot only). |
| Star Citizen Wiki API | Optional alternative | Built on scunpacked; 60 requests per minute; no commercial use (medium; host was unreachable). |
| RegolithCo-Common (MIT) | Type model reference only | Data is stale (Lancet MH1 2520 vs 3120). The project ended operations (goodbye post dated 2026-03-10). |
| Local Data.p4k parsing | Possible phase 3 | Instant patch-day and PTU data; file read only, compatible with anti-cheat. Needs a p4k and DataCore parser. |

**scunpacked pitfalls** (verified):
- Read the **`Raw`** blocks, not `stdItem`.
- `stdItem.MiningLaser.Modifiers.AllChargeRates` merely repeats the inert filter value.
- `stdItem.MiningModule.Modifiers.DamageMultiplier` mixes the fracture beam (`fireActionIndex 0`) with the extraction beam (`1`). As a result FLTR-XL, Vaux-C3 and Forel look wrong, and the fracture factors of Deluge, Clearcut and Overrun are missing.
- `Description` and `DescriptionData` still show **pre-4.9 power values**. 4.9.0 raised ship laser power by about 20 %, e.g. Helix II 4080 → 4930 and Hofstede-S2 3360 → 4060 (verified by diffing commits).

### 3.2 Update strategy per patch
1. **Fetch.** A server-side build script pulls about 50 JSON files (lasers, modules, gadgets, mining ships, `resources/resources.json`) **pinned to a commit SHA**, records the build string, and writes `mining-equipment.<build>.json`.
2. **Test.** Unit tests compare against Bedrock's table values: Helix II 4930 / min 0.30 / −30 % resistance, Hofstede-S2 4060 / 0.10 / +60 % window, Surge ×1.5 power / −15.5 % resistance, and so on.
3. **Watch for new builds.** Poll `GET https://api.github.com/repos/StarCitizenWiki/scunpacked-data/commits/master` daily. If the commit message names a new build, rebuild, test and publish to clients. Keep the previous dataset selectable.
4. **Ruleset per patch.** Version `decayPerMass`, `cSCUPerVolume` and the resistance exponent separately (5.0 `_v5` rocks per location). Densities and quality bands come from Bedrock's generated tables until a 4.10 resources parser exists.
5. **Admin overrides.** Allow manual overrides for hotfixes, e.g. OptiMax resistance: the record says −25, while the description text, UEX and Regolith say −30. Use −25.

### 3.3 Data model
```ts
Ruleset   { id, gameBuild, decayPerMass, cSCUPerVolume, kgPerScuAtDensity1, maxRockScu,
            resistanceExponent /*1 | 1.21*/, multiLaserMode /*'perHead'|'product'*/, edge 1.05, comfortable 0.90, swayThreshold 1, sway 4 }
Ship      { id /*ClassName e.g. ARGO_MOLE*/, name, heads:[{port, position:'LEFT'|'MIDDLE'|'RIGHT'|'FRONT', size, stockLaser, editable, manned}], oreScu }
Laser     { id, name, size, power /*DamageEnergy ElectricArc*/, throttleMin, extraction, rangeFull, rangeZero,
            mods:{window, rate, resistance, instability}, inertFilter, slots, requiredTags[] }
Module    { id, name, active, power /*fireActionIndex 0*/, extractionFactor /*index 1*/,
            mods:{window, rate, resistance, instability, inertFilter, shatter, catastrophic, additive?},
            uses, durationS, canInterrupt, isInterruptible, craftOnly }
Gadget    { id, name, mods:{instability, window, rate, resistance, cluster} }   // attaches to rock, max 1
Ore       { id /*e.g. bexalite_raw*/, displayNames[], aliases[], form:'RAW'|'ORE', rarity, signature,
            density /*measured*/, elementInstability, elementResistance, explosion, cluster,
            qualityBands:number[8], sideOres[], maxRockDensity }
UserLoadout { shipId, heads:[{laserId, moduleIds[], craftedPowerPct}], activeModulesFired[], gadgetId?, rangeM? }
Scan      { source:'ocr'|'manual'|'screenshot', ts, ore, mass, resPrinted, resColor:'white'|'green'|'red'|null,
            resModifierPrinted?, inst, scu, parts:[{ore|null, pct, quality, scu}], gadgetAttached?, fieldStatus{...:'missing'|'uncertain'|'confirmed'} }
```

**Ships in 4.10.3** (scunpacked `ships/*.json`, high confidence):

| Ship | Heads | Head size | Stock head | Module slots | Ore capacity | Notes |
|---|---|---|---|---|---|---|
| Prospector | 1 | S1 | Arbor MH1 | 1 | 32 SCU | |
| MOLE | 3 turrets | S2 | Arbor MH2 ×3 | 2 each | 96 SCU | The pilot seat has no laser |
| Golem | 1 | S1 | Pitman | 2 | 32 SCU | The Pitman is Golem-only |
| Gatac Hyūn | 1 arm | S1 | Arbor MH1 | 1 | 32 SCU | |
| ROC / ROC-DS / ATLS GEO | | S0 | | | | Another scale; out of scope |

**Laser heads in 4.10.3** (unchanged since 4.9.0 except for new items; full table in the equipment report):

| Head | Power | Min throttle | Resistance % | Window % |
|---|---|---|---|---|
| Helix II | 4930 | 0.30 | −30 | −40 |
| Hofstede-S2 | 4060 | 0.10 | −30 | +60 |
| Klein-S2 | 4350 | 0.20 | −45 | |
| Arbor MH2 | 2900 | 0.05 | +25 | |

**New in 4.10.0** (craft-only): Clearcut, Deluge and Overrun modules, plus an unfitted Hyūn head.

### 3.4 Ore, SCU and quality
**SCU:**
- 4.10: `SCU = volume × 0.7 / 100` (142.857 m³ per SCU) and `mass = volume × Σ(share·ρ)`, with inert at ρ = 1.0. Shares are **volume shares**.
- **Read SCU from the panel.** Per-ore SCU = `pct/100 × SCU`.
- Fallback only: `SCU = mass / (142.857 × Σ share·ρ)`.
- Check against the example: per-ore SCU gives Bexalite 0.41 and Borase 0.24, which match the screenshot. Mass predicted from SCU is 4,654 vs 4,627 shown (0.6 % off). Instability of the TIN test rock reproduces exactly (3.52).
- High confidence.
- **Contradiction:** the mechanics report calls Regolith's `FUDGE_FACTOR 33.333` "consistent" with 142.857. The ores report applied it to the example and gets 23.8 SCU vs 5.54, about 4.29× off. Use Bedrock's constant; do not reuse Regolith's.

**Densities** (Bedrock `MiningLocations.h` `ORE_DENSITIES`, 26 ores):
- Values include Quantainium 20.46, Bexalite 6.97, Gold 19.46, Borase 4.2, Savrilium 17.59, Ice 1.0.
- Several are **measured** on 501 rocks and differ 4–8 % from scmdb's export: Gold, Tin, Quartz, Silicon, Aslarite. Medium-high confidence.
- **Diamond is not a 4.10 ship ore.**

**Quality** (introduced 4.7.0; predefined spawn values since 4.8):
- Generation: roll a normal distribution (min 501, max 1000, stddev by rarity 143–203), multiply by the part's `qualityScale` (1 / 0.789 / 0.49), then quantize into 8 bands with edges `0,400,600,700,800,900,950,999`. The value shown is the ore's own `mappedValue`.
- Example bands: Bexalite `302 597 632 756 875 941 959 1000`; Gold `264 553 644 …`; Borase `359 584 676 …`.
- Source: `ORE_BANDS` in `MiningHardware.h`. High confidence.
- **Rock make-up:**
  - a small main part at scale 1 (the valuable line, mostly band 1–3);
  - a large bulk part of the same ore at 0.49 (about 90–97 % in the lowest band);
  - 0–2 side ores at 0.789 (side-ore table per rock type in the ores report);
  - the rest inert.
- **What quality affects:**
  - **Crafting:** 500 is shop-equivalent, 1000 is the full bonus (high confidence).
  - **Refining:** quality carries through (high confidence).
  - **Terminal sell price:** **no evidence** that quality changes it (medium). It matters on UEX player marketplace listings.
  - Bedrock's grade letters are not shown in-game: S ≥ 950, A ≥ 900, B ≥ 800, C ≥ 700, D ≥ 600, E ≥ 400, F below.
- **Value per rock:** SCU excluding inert × live UEX sell price. The only 4.10 price list found (timesaver.gg) is low confidence and includes Diamond. Do not hard-code prices.

---

## 4. Risks, contradictions and open questions

### 4.1 Decisions for the org leader
1. **Default resistance model.**
   - Option A: Bedrock's `1 − R_eff^1.21`. It matches the reference screenshot, but is fitted on only 7 rocks; refits range 1.16–1.27.
   - Option B: the linear `1 − R_eff` used by most tools. sc-holotable calls it client-derived; Bedrock says it over-asks by up to about 10 points.
   - Recommendation: default to Bedrock, offer a toggle, and calibrate with org measurements.
2. **Default multi-laser mode:** per-head sum (Bedrock, conservative) or product (mort13, sc-holotable).
3. **Licensing.**
   - Bedrock is GPL-3.0. Reimplementing its formulas and taking game-data numbers is fine. Copying code makes the distributed Electron app GPL; handing builds to org members likely counts as distribution (inference, not legal advice).
   - scunpacked-data has no licence.
   - UEX requires a token and the badge.
   - Decide whether to reimplement everything or to accept the GPL.
4. **Scope of v1.** Ships and seats (Prospector, MOLE turret, Golem, Hyūn), whether 5.0 is supported now or later, and whether live OCR is in v1 or only manual entry plus screenshot import.
5. **OCR engine packaging.** Ship the about 11 MB PaddleOCR ONNX model (no OS dependency), or use Windows OCR (members on German Windows must install the en-US OCR pack).
6. **Player setup requirements.** Borderless mode, at least 1080p, HDR on or off. Also whether members use a community `global.ini` translation: German labels would break keyword parsing (inference, medium), and the short `RES:/INST:` labels may come from such packs.
7. **Anti-cheat risk acceptance.** There is no official CIG statement on OCR tools; the community practice is screen capture plus log reading only.
8. **Phone and tablet role.** Manual input only, or live mirroring of desktop OCR results through the backend.

### 4.2 Tests to run in-game (cheap, high value)
1. `grep -iE "mass|resist|instab|scan|mineable" Game.log` after several scans, to confirm that **no scan lines** exist in 4.10.3.
2. **Resistance colour by seat.** Prospector cockpit, MOLE pilot seat vs turret, Golem, Hyūn: when is the value white vs green/red, and does the printed value equal own × head factor?
3. **Gadget effect on the panel.** Before and after placing a Sabir or BoreMax: is RES/INST shown modified?
4. **Hold-throttle measurements.** Rocks at 0 %, about 30 % and about 55 % resistance, using the "bar stands still" throttle with a known loadout. Use these to settle the resistance exponent (1.0 vs 1.21); record each rock 3–4 times, since instability causes noise.
5. **Multi-laser resistance.** Two MOLE heads on one rock, compared against per-head vs product predictions.
6. **Surge.** A second Surge stacking on a MOLE seat.
7. **Range falloff.** Linear between optimal and maximum range?
8. **Label and layout variants on 4.10.3,** especially after the 4.10.3 cockpit label change; distance needed for quality to show; whether the "not scanned yet" frame appears.
9. **OCR accuracy on org hardware** at 1080p, 1440p and 4K, ultrawide, HDR, different FOV.

### 4.3 Contradictions between the reports and sources
- **Stacking.** Multiplicative (Bedrock, 4.10 HUD proof) vs additive (Regolith 4.0.1 comment, starvein, SC-Bridge, SCMDB default). Multiplicative wins for 4.10.
- **Instability stacking.** Additive laser and modules (Bedrock) vs multiplicative (sc-holotable). Minor.
- **Multi-laser resistance.** Per head vs product. Unresolved.
- **Resistance curve.** Exponent 1.21 vs linear. Unresolved. Note that `resistanceCurveFactor 0.6` in the game file belongs to the composition blend, not this curve.
- **Regolith SCU factor.** "Consistent" (mechanics report) vs "4.29× off" (ores report, by computation). Use 142.857.
- **OptiMax resistance.** −25 (game record) vs −30 (description, UEX, Regolith).
- **Ore densities.** Bedrock-measured vs scmdb export, 4–8 % apart for 5 ores.
- **Short labels (`RES:`/`INST:`).** One report calls them a ship or seat panel variant; the other attributes them to a community language pack. Accept both forms in the parser.
- **Mass unit.** HUD and Bedrock say kg, sc-holotable says tonnes. This does not affect the results, because the constants are calibrated to the HUD number.

### 4.4 Technical risks
- **Patch changes.** The 5.0 panel and constants differ (decayPerMass ×7.25; a different panel). Every constant needs versioning.
- **OCR misreads** (0↔8) silently corrupt the verdict. Mitigations: multi-frame confirmation, plausibility checks, uncertain-state UI, manual override.
- **Double-counting** of head or gadget modifiers already in the printed values. This needs colour detection and Game.log gadget tracking.
- **Data source availability.** scunpacked depends on one community maintainer. Fallbacks: Bedrock tables, or your own p4k parser.
- **Single-author measurements.** The 1.21 exponent, crafted range, Surge stacking, linear falloff and 5.0 constants all rest on Bedrock alone. The pool and window timings rest on sc-holotable alone.
- **Unverified items** (search snippets only): RSI patch notes, wiki pages, UEX live data and terms. Allow those hosts in the research environment to verify them.


---

# In-game observations (org test, 2026-11-26, patch 4.10.3)

Source: screenshot of a real scan (`test/fixtures/scan-panel/titanium-458kg.png`) and the org leader's report.

- **MASS is always white** and never changes.
- **RESISTANCE is white for the rock's own value and turns green or red when the laser setup changes it** (green = better, red = worse, e.g. with a Helix). This confirms claim 4 for the Prospector.
- **INSTABILITY behaves the same way** (white = own value, green/red = changed by the laser). The research had assumed only resistance is coloured, so this is new. The calculator must also divide the laser factor back out of a coloured instability value.
- **The difficulty bar ("EASY") appears in 4.10.3** in this ship. The research expected it only on the MOLE turret and in 5.0. The OCR parser must accept it as an optional line.
- **SCU below 1 uses an SI prefix in 4.10.3** (`901.80m SCU` = 0.9018 SCU). The research expected this only in 5.0.
- **Composition matches the expected rock make-up:**
  - main part of titanium (10.11 %, quality 516)
  - a large bulk part of the same ore at low quality (53.53 %, quality 295)
  - two side ores (agricium 588, aslarite 575)
  - inert materials (29.47 %, quality 0)
  - The shares add up to 99.97 %.
- **Mass and volume:** 458 kg / 0.9018 SCU = 508 kg per SCU, which means an average density of 3.56 × 142.857. That is plausible for titanium plus inert material.
- **Panel language is English.**

## Follow-up answers (org leader, 2026-11-26)

- **When the colour appears:** right after the scan all numbers are white for a moment. Then RESISTANCE and INSTABILITY turn green or red as soon as the scan is complete. The normal reading in a Prospector is therefore the coloured value, which includes the laser. This matches the calculator's model.
- **Gadgets:** as soon as a gadget is attached, the displayed values include it (coloured). This also matches the calculator's model.
- **Titanium fixture (458 kg):** taken with a **Helix I** and an **active Stampede** module.
  - Resistance 14 % green fits: Helix I is −30 %, so the rock's own value is 20 %.
  - Instability 0.85 **red** does **not** fit the game data. Stampede is −10 % instability and Helix I is 0 %, so green would be expected. Open hypotheses:
    1. Red on instability means something else, e.g. a danger threshold.
    2. The colour came from something other than Stampede.
    3. The Stampede data is wrong.
  - New insight: a **running active module is included in the displayed values**. The calculator currently assumes only laser and passive modules (plus gadget). It needs an input for "active module running during the scan"; later the OCR can read the module panel.
  - Planned in-game test: same rock, Helix I, scan without Stampede active, then with Stampede active, and record colour and value of both stats.

## Full-screen HUD reference (org leader, 2026-11-26)

File: `test/fixtures/hud/prospector-helix1-20pct.webp` with its values in the `.json` next to it. Prospector, Helix I with 2× Rieger-C3, laser power 20 %, not firing, rock at 89 m, no gadget.

- **Colour rule refined:** with the laser not on the rock and no gadget attached, RES and INST stay **white**, because they show the rock's own values. They turn coloured once the laser is on the rock or a gadget is attached.
- **Multiplicative stacking confirmed in game:** the laser panel shows FRACTURE PWR **156** (1.25 × 1.25 × 100 = 156.25) and WINDOW SIZE **59** (60 × 0.99 × 0.99 = 58.8). Additive stacking would give 150 and 58.
- **Short labels in the Prospector:** `RESULTS`, `MASS:`, `RES:`, `INST:`, `COMP.`, with abbreviated ore names (`HEPH (RAW)`). The titanium screenshot used the long labels (`SCAN RESULTS`, `RESISTANCE:`, `INSTABILITY:`, `COMPOSITION`). The OCR must accept both forms.
- **Other HUD elements to keep clear of in the overlay:**
  - mining module list at left centre (name, PASSIVE/ACTIVE and effects)
  - laser panel at bottom left
  - cargo at bottom right
  - key hints at the very bottom right (FIRE, LASER POWER, LASER TYPE, OPERATOR MD.)

## Laser power arc measured (1920×1080, Prospector)

From `test/fixtures/hud/prospector-helix1-100pct.webp`; the values are in `test/fixtures/hud/power-arc-1920x1080.json`.

- **What the right-hand arc group contains:**
  - the thin yellow line is the rock's **charge**, with the OPTIMAL (green) and OVERCHARGE (red) blocks at the top;
  - the grey track outside it is the **laser power**, filled green from the bottom ("CHARGE LEVEL") to the top (below "LASER IN").
- **Geometry:** the power track is a clean circular arc. Centre (1061.6, 607.2), radius 209.5 px, mean deviation 1.2 px. 0 % sits at 49.1° and 100 % at 11.2°, so the arc spans about 38° (about 140 px of arc length, about 1.4 px per percent).
- **Check:** in the 20 % screenshot the fill ends at about 16.3 % of the arc. In the 50 % screenshot (a different rock, `prospector-helix1-50pct.webp`) it ends at about 47.9 %. The 2–4 % (3–5 px) offset comes from the dashed fill pattern. The **linear mapping is confirmed**. The HUD was in exactly the same place on the second rock.
- **Field observation:** the first rock **exploded at 50 % power** (overcharge). The org leader reports that **even 20 % was too strong**. This matches the calculator's prediction of "laser too strong": only about 10 % is needed with 2× Rieger-C3, and the Helix I minimum is 20 %.
- **Distance (corrected):** the number under the ore name (89.0 m / 51.1 m / 54.7 m) is **not** the laser distance, probably the distance to the rock's centre. The laser distance is the marker on the **left LASER RANGE arc**:
  - 76 m in the 20 % shot (not firing)
  - 38 m in the 100 % shot
  - 42 m in the 50 % shot
  The org leader confirms they were never further than 45 m while firing. The OCR must read the distance from that arc.
- **Range falloff matters:** at 38 m and 42 m the Helix I is in its falloff zone (full power up to 15 m, zero at 45 m). If the falloff is linear, only about 23 % and 10 % of the power arrive. The calculator currently assumes full power (distance within the optimal range). Reading the distance (OCR) and including the falloff is a candidate for stage 3, and the falloff shape is still unverified.
- **Proof of concept:** ticks and a band drawn at these coordinates sit cleanly next to the power track. The marker "here is roughly the neutral point" is therefore feasible.

---

# Appendix: Adversarial verification of load-bearing claims

## Claim 1: UNCERTAIN

**Claim:** Game.log in 4.10.x contains no rock scan figures (mass, resistance, instability, composition, quality). It contains only context: location, ship control token, gadget placement with rock entity class, game version. Rock data must come from OCR of the SCAN RESULTS panel or manual entry.

**Why it matters:** This decides the whole acquisition architecture. If a scan log line existed, the OCR pipeline (capture, panel search, ONNX model, validation) would be unnecessary. If the log lines we rely on for context changed, auto-selecting the ship and gadget would break.

**Result after check:** The first half is well supported: no tool or corpus study I could find shows mass, resistance, instability, composition or quality in Game.log, in any 4.10.x build or in PTU 5.0. Rock figures must come from OCR of the SCAN RESULTS panel or from manual entry.

The context half needs correcting:

1. **Gadget placement.** The `<[ActorState] Place> ... placed 'Mining_Gadget_<X>_<id>' on entity 'MineableRock_<Type>_<Mineral>_<id>'` line exists in 4.10.0 to 4.10.200. The 293-log sc-telemetry catalog (updated 2026-11-21) reports it absent in 4.10.201 and PTU 5.0, though that sample is small. Treat it as optional; the gadget may need manual or OCR selection.
2. **Ship.** The control-token line only marks leaving the seat (`ClearDriver ... releasing control token for '<ship_class>_<id>'`); there is no enter line. The current ship has to be worked out from the quantum-target ItemNavigation lines and from `You have joined channel '<Ship> : <owner>'`.
3. **Rock class.** There is an extra context line, `Entity : 'MineableRock_<Type>_<Mineral>_<id> - Class(...)'`. It gives the rock class and mineral of rocks streamed in nearby, with no figures.
4. **Version.** Read it from `@env_session 'pub-sc-alpha-4100-<build>'` or from the header `Build(<n>)` / `Branch:` lines, not from FileVersion.

<details><summary>Evidence</summary>

## Verdict: the main point holds, but the context half of the claim is partly wrong

I read every source below myself on 2026-11-25. I did not grep a raw 4.10 Game.log myself. The only Game.log I found in a repo, NexusApp/Data/demo/Game.log, is a synthetic 39-line demo with no mining lines.

### 1. "Game.log has no rock scan figures": strongly supported, nothing contradicts it (confidence medium-high)

- **sc-telemetry Game.log event catalog** (https://raw.githubusercontent.com/voidput/sc-telemetry/HEAD/docs/telemetry/gamelog-catalog.md, updated 2026-11-21). This is an independent primary source I had not been given.
  - It scanned about 293 real Game.log files (6.06M lines). The builds run from 12545750 (4.10.0-hotfix) through 13220821 ("4.10.201 LIVE (current)") plus PTU 5.0.201 and 5.0.202.
  - Its section "Gaps: what the log cannot tell you" lists under Targets: "Locked or selected target, contacts, radar, ping and scan results". Under Economy it lists "mining yield; refinery jobs".
  - The only mining-rock line it catalogues is `Entity : 'MineableRock_<Type>_<Mineral>_<id> - Class(...)'`. It calls this "Mineable rock streamed in (VFX debug). Not a yield." (6,414 lines in 72 files, LIVE).
  - Inference: that line gives the rock class and mineral name only. It has no mass, resistance, instability, percentages or quality.
- **Bedrock** (https://github.com/SC-Ravaxx/Bedrock; I made a shallow clone of commit e5c96ac, dated 2026-11-22; it targets "Star Citizen 4.10.3").
  - The README says "Bedrock reads the mining scanner off your screen…". It also says Game.log is used "for places, trades, contracts and blueprints".
  - src/PanelKeep.cpp is OCR'd off the SCAN RESULTS panel, citing "17 November 2026, LIVE 4.10.3".
  - src/LoadoutReader.cpp reads the ship loadout off the HUD.
  - GameState.cpp parses no scan figures. Its comments mention replaying 600 logs.
- **NexusApp** (https://github.com/T3SoD/NexusApp, cloned, last commit 2026-11-01). Rock signatures are read via screen "auto-scan" ("reads rock signatures straight off your screen through the magenta box"). Its Game.log tail feeds blueprints, hauling, shards, location and trading only.
- **sc-log-tracker** (https://raw.githubusercontent.com/DefaultHahn/sc-log-tracker/main/sc_log_tracker.py). Its only mining event is "Mining gadget placed", taken from PLACE_RE `StatePlace::DoPlace] '…' placed '…'`.
- **rockhound** (https://raw.githubusercontent.com/Averus89/rockhound/HEAD/DEVLOG.md). Location detection is still manual: "Automatic detection needs a signal from the game (Game.log or the HUD), still to be found". It reads signatures by template matching and OCR on the screen.
- Web searches found no source quoting a Game.log line with resistance or instability values.

### 2. The context lines: partly inaccurate or out of date

**(a) Gadget placement may be gone in the current build (confidence medium).**
- Bedrock and sc-log-tracker parse `<[ActorState] Place> ... placed 'Mining_Gadget_SHIN_Sabir_<id>' [id] on entity 'MineableRock_AsteroidLegendary_Savrilium_<id>'`. Bedrock's self-test sample of that line is dated 2026-09-12.
- The sc-telemetry catalog, under "Changes inside 4.10", says: "Gone after 4.10.200 (absent in 4.10.201 and 5.0): ... `[ActorState] Place` ...". It also adds: "4.10.201 already logs like 5.0. A parser should treat every tag as optional."
- Caveat: that corpus has only 13 files from 4.10.201 and 14 short PTU 5.0 files, so the absence may just mean nobody mined in them.
- `<AttachmentReceived>` (gadget back in hand) is still present.

**(b) "Ship control token" is only an exit signal.**
- The line is `<Vehicle Control Flow> CVehicleMovementBase::ClearDriver: ... releasing control token for '<ship_class>_<id>'`. The catalog notes: "there is no enter line".
- Bedrock works out the current ship from other lines:
  - `<Player Selected Quantum Target>` / ItemNavigation pipe lines naming the ship class
  - `You have joined/left channel '<ShipDisplayName> : <owner>'`
  - the release line
  - `ejected from zone '<ship>' … destroyed vehicle`

**(c) Other context lines the claim does not list:**
- the `MineableRock_*` streamed-entity line
- location lines: `Projected Start Location is`, `Loading screen for`, `<Update Inventory Location>`, `<RequestLocationInventory>`
- version: read from `@env_session: 'pub-sc-alpha-4100-<build>'` or from the header `Build(<n>)` / `Branch: sc-alpha-X.Y.Z`. The FileVersion field is unreliable (the hotfix builds report 1.0.191.x).

### 3. Patch numbering (low confidence)
- Bedrock calls the current LIVE build 4.10.3 (17 Nov 2026).
- The catalog calls build 13220821 "4.10.201 (current)" by FileVersion.
- These may be the same build. I did not confirm that.

### Inferences (not verified)
- OCR of the SCAN RESULTS panel, or manual entry, remains the only way to get the rock's figures. Every tool I checked does it that way.
- Auto-selecting the gadget from the log should be treated as optional and best-effort, with a manual fallback. The line it depends on may no longer be written in 4.10.201+ / 5.0.
- Before relying on it, grep a fresh 4.10.3 log after placing a gadget: `grep -E "DoPlace|Mining_Gadget|MineableRock|ClearDriver|joined channel" Game.log`.

</details>

## Claim 2: UNCERTAIN

**Claim:** Breaking is a charge balance. A rock can be broken iff total through-power exceeds decayPerMass × mass, with decayPerMass = 0.2 for 4.10 ship rocks (1.45 for 5.0 PTU Nyx I v5 rocks). Required throttle = 0.2 × mass / P_through, and a head counts as solo-capable only if throttleMin ≤ share ≤ 1 (Bedrock edge 1.05).

**Why it matters:** Both core features rest on it: 'can it break?' and 'required laser %'. It reproduces the user's Bedrock screenshot (Hofstede-S2 33.6 % shown as 30–38 %). A wrong constant or a patch change (5.0 is 7.25× higher) would make every verdict wrong.

**Result after check:** The claim is right for LIVE 4.10 ship rocks. It cannot be independently confirmed for 5.0.

**Breakability (high confidence):** a rock breaks iff Σ P_through > decayPerMass × mass, with decayPerMass = 0.2 from the miningglobalparamsship.xml datamine. Required throttle = decayPerMass × mass / Σ P_through.

**Use the rock's decayPerMass, not a hardcoded 0.2:**
- "Required throttle = 0.2 × mass / P_through" only holds for 0.2 rocks.
- The formula must take the rock's ruleset value, because each rock's MineableParams.globalParams picks its ruleset.

**P_through is not settled:**
- sc-holotable (from client code) and mort13 use linear E·(1 − R_rock·Π(1+mod/100)).
- Bedrock uses the empirical E·(1 − (R·M)^1.21).
- Only Bedrock's curve gives exactly 33.6 % for the screenshot; the linear model gives 37.5 %.
- Range falloff and module power multipliers also go into E.

**Solo-capable in Bedrock** means throttleMin ≤ share ≤ 1.05. This is BREAK_EDGE, not 1.0, and Bedrock shows a share above 0.90 as slow charging.

**5.0 rocks (low confidence):** 1.45 for Nyx I v5 rocks (5.0 PTU) appears only as a hand-written constant in Bedrock, backed by its own observations. I found no independent datamine of miningglobalparamsship_v5.xml. Treat it as low confidence and re-check it against a 5.0 DataCore extract before relying on it.

<details><summary>Evidence</summary>

## What I checked myself

### 1. decayPerMass = 0.2 for ship rocks on LIVE 4.10: CONFIRMED (high)
- I cloned x3nnnonn/StarCitizenDiff. The main branch's last commits are "nothing burger called 4.10" and "idk man" (2026-09-22). `DataCore/libs/foundry/records/mining/miningglobalparamsship.xml` contains `<powerCapacityPerMass>10</powerCapacityPerMass>`, `<decayPerMass>0.2</decayPerMass>` and `<resistanceCurveFactor>0.6</resistanceCurveFactor>`. The value is the same on the `hotfix` and `tech-preview` branches and in every older 4.7–4.8 commit of the file. All the other MiningGlobalParams records (fps, groundvehicle, default) also use decayPerMass 0.2. Their powerCapacityPerMass is 5, 4 and 10. https://raw.githubusercontent.com/x3nnnonn/StarCitizenDiff/main/DataCore/libs/foundry/records/mining/miningglobalparamsship.xml
- mort13 BreakabilityChart `js/calculations.js` line 5 has `export const c_mass = 0.2;` and `computeRequiredPower = mass*c_mass/(1-effRes)`. https://raw.githubusercontent.com/mort13/BreakabilityChart/main/js/calculations.js

### 2. "Charge balance" model and the throttle formula: CONFIRMED (high), from two independent sources
- VeeLume/sc-holotable `crates/sc-mining/src/setup.rs` (HEAD 8fbc8e9, 2026-11-25) says it is "read from the client (LIVE 4.10)":
  - gain/s = `(1-R)*E*throttle/(mass*powerCapacityPerMass)`
  - decay/s = `decayPerMass/powerCapacityPerMass`
  - `max_mass = (1-R)*E/decayPerMass`
  - `is_breakable = mass < max_mass`
  - `balance_throttle = decay/gain(1.0)`, returning None if it is above 1
  
  powerCapacityPerMass cancels out, so the required throttle is decayPerMass·mass/((1-R)·E). Instability is a wave that multiplies only a net gain (sim.rs), so it does not move the balance point. Laser throttle is clamped as `max(t, throttle_minimum)`. https://github.com/VeeLume/sc-holotable
- SC-Ravaxx/Bedrock `include/MiningAdvice.h` (HEAD e5c96ac, 2026-11-22) contains `BREAK_DECAY_PER_MASS = 0.2f` and `throttleFor`: share = mass·decayPerMass/powerAtRange, `possible = share <= 1.0`, `overpowered = share < throttleMin`. Bedrock's own comment calls the balance "ASSUMED ... neither is written down". It was checked on 9 rocks within 2.2 points, with one outlier at 8.6 vs 13.3. https://github.com/SC-Ravaxx/Bedrock/blob/main/include/MiningAdvice.h

### 3. Reproducing the screenshot: CONFIRMED (high)
Inputs, all verified in the datamine `entities/scitem/ships/weapons/mining_laser_shin_hofstede_s2.xml`: Hofstede-S2 power 4060 (from Bedrock's generated MiningHardware.h), resistanceModifier -30, throttleMinimum 0.1.
- Rock: 4,627 kg, RES 56 %. Demand 0.2·4627 = 925.4.
- Bedrock's through-factor is 1-(0.56·0.70)^1.21 = 0.678, giving 2752.6 W through and 33.62 %. This matches the 33.6 % / "30–38 %" shown.
- The linear (1-R) model gives 37.5 %. That is still inside the band but is not 33.6.

### 4. Solo-capable rule: PARTLY CORRECT
In Bedrock's `MinerGUI.cpp`, `headsThatHoldAlone()` requires `throttleMin <= share <= BREAK_EDGE (1.05)`. `throttleFor.possible` uses ≤ 1.0, and "comfortable" is ≤ 0.90. So the 1.05 edge is what drives the "CAPABLE SOLO" label, not 1.0. A share below throttleMin gives "Below X % minimum" (overcharge).

### 5. decayPerMass = 1.45 for 5.0 PTU Nyx I v5 rocks: NOT independently verifiable (low)
- The only source is a hand-written constant `ROCKS_V5 = {1.45f, 13.141f}` in Bedrock. Its comment cites `miningglobalparamsship_v5.xml`, PTU build 13189690, and 25 rocks observed on 2026-11-15.
- GitHub code search for "miningglobalparamsship_v5" finds only Bedrock.
- x3nnnonn has no 5.0 branch.
- Bedrock's own p4k-generated MiningHardware.h contains only 0.2.

### Current patch
LIVE is 4.10.3 and 5.0 is on PTU, with Wave 3 build 5.0.0-PTU.13228337 on 2026-11-19. This comes from a secondary source (https://expcarry.com/de/star-citizen-5-0-ptu-nyx-i-tests). RSI's 5.0 PTU notes thread (https://robertsspaceindustries.com/spectrum/community/SC/forum/190048/thread/star-citizen-alpha-5-0-ptu-patch-notes) shows no mining-balance notes in its snippet.

</details>

## Claim 3: CONFIRMED

**Claim:** In 4.10 equipment modifiers stack multiplicatively: P = DamageEnergy × Π module.damageMultiplier × crafted factor, and R_eff = R_own × (1+gadget%) × (1+laser%) × Π(1+module%). Through-power is P × (1 − R_eff^k), where k is either 1 (linear, most tools) or 1.21 (Bedrock fit). The multi-laser resistance mode (per-head sum vs product) is unresolved.

**Why it matters:** These decide the required-% number and the verdict on resistant rocks. Additive vs multiplicative stacking and k = 1 vs 1.21 shift the throttle by up to about 10 points on high-resistance rocks. A wrong multi-laser mode misjudges MOLE crew requirements. k and the multi-laser mode must be configurable and calibrated in game.

**Result after check:** The claim holds, with these refinements.
- Power: P = DamageEnergy(fracture beam) × Π module damageMultiplier × crafted factor × range falloff(distance). Holotable says the crafted factor combines across slots as 1 + Σ(fᵢ − 1). Bedrock multiplies the slots instead, so that part is disputed.
- Effective resistance: R_eff = clamp(R_own × Π(1 + v/100) + Σ additive/100, 0, 1). The product covers the laser's own modifier, its modules and each gadget, with the gadget counted once per rock. Nearly all modifiers are the multiplicative kind; additive ones such as the ROC-DS module are exceptions.
- Through-power: P × (1 − R_eff^k). k = 1 is backed by holotable's client-code reading and by most tools. k = 1.21 is Bedrock's empirical fit, with a range of 1.16 to 1.27. resistanceCurveFactor 0.6 is the composition exponent, not k.
- Several lasers: holotable (citing client code), mort13 and Regolith multiply all hitting lasers' modifiers into one shared R_eff and sum the powers. Bedrock alone applies resistance to each head separately and sums the outputs. Keep both modes and k configurable, and calibrate them in game.

<details><summary>Evidence</summary>

I cloned the current HEADs and read the code myself. Bedrock is at e5c96ac (2026-11-22), mort13/BreakabilityChart at b74f4f9 (2026-11-18), VeeLume/sc-holotable at 8fbc8e9 (v0.58.3, 2026-11-25), RegolithCo-Common at 44d29a4 (2026-04-12), plus SC-Bridge and lostspezi/starvein as extra independent tools. I could not test in game.

1) Modules stacking multiplicatively: supported, high confidence.
- Bedrock tests/scanpanel/README.md (https://github.com/SC-Ravaxx/Bedrock/blob/main/tests/scanpanel/README.md) transcribes a HUD showing HELIX I with Focus III (-5%) and Rieger-C3 (+25%) as FRACTURE PWR 119. Multiplying gives 0.95 x 1.25 = 118.75, which rounds to 119. Adding gives 120. WINDOW SIZE 83 matches 0.60 x 1.40 x 0.99 = 83.16. The same file says 3900 x 1.1875 = 4631 W, and SelfTest.cpp checks for "4,631 fracture power, as the HUD shows". This is a single screenshot, and I am trusting the transcription.
- sc-holotable crates/sc-mining/src/setup.rs (https://github.com/VeeLume/sc-holotable/blob/main/crates/sc-mining/src/setup.rs) cites "client code, LIVE 4.10". Power is `beam.energy_per_second * Π m.damage_multiplier(fire_action)`, then multiplied by range falloff. For resistance it collects the laser's own block, its modules' blocks and the gadgets' blocks, and applies `Combined::of`: a FloatModifierMultiplicative multiplies by (1+v/100) and a FloatModifierAdditive adds v/100. The result is `clamp(R*factor + add, 0, 1)`.
- mort13 js/calculations.js and data-manager.js `calculateCombinedValue` use `(1+base/100)*(1+mod/100)` for the module and gadget resistance modifiers, and `power *= value/100` for each module.
- Regolith's additive rule is real but old. loadoutCalc.ts `multiplyReduceModules` carries the comment "Feb 10, 2025: As of 4.0.1 modules stack again... acc + m - 1". Even there, lasers and the gadget are multiplied (`multiplyReduceLasers(...) * gadgetStats.resistance`). Two other tools still add on purpose: starvein rock-break.ts ("Module stacken ADDITIV pro Kopf (Regolith-Konvention seit 4.0.1)") and SC-Bridge miningUtils.js `computeEffectiveModifiers` ("additive stacking"). So which tool you copy decides the result.

2) R_eff as a product of rock, gadget, laser and modules: supported, with two corrections. sc-holotable has an additive modifier kind (its comment names the ROC-DS module), so Π(1+module%) is not universal. The gadget sits on the rock and counts once, not once per head. Bedrock, holotable and starvein all agree on that.

3) The exponent k: genuinely unresolved, so the claim stands.
- Bedrock include/MiningAdvice.h sets `RESISTANCE_CURVE = 1.21f` with `1 - pow(R*M, 1.21)`. The comments say it was fitted to 4 rocks on a Helix I and 3 on a Hofstede-S2. Refitting moves it between 1.16 and 1.27, and the author calls it "a measurement, not a law".
- The linear form 1 - R is used by holotable (`gain_per_energy = (1-R)/(mass*powerCapacityPerMass)`, citing client code), mort13, starvein and Regolith.
- Holotable rock.rs says `resistanceCurveFactor` (0.6) is the exponent on composition fractions when building a rock's resistance, not a curve on through-power. SC-Bridge computeRockResistance.js agrees. That removes the only datafile candidate for k other than 1, which weakens 1.21 as a game rule. It does not settle the question, because Bedrock's measurements still disagree with a straight line.

4) Combining resistance across several lasers: unresolved, but the claim needs sharpening.
- Bedrock says "with more than one head on it, what each lets through adds up": each head gets its own R x M, and the heads' outputs are summed.
- Holotable folds every hitting laser's blocks, plus the gadgets, into one product applied to the rock (`from_sources`: blocks = lasers.flat_map + gadgets). It cites LIVE 4.10 client code and says a laser that stops hitting drops its modifier after modifier_persistence_time.
- mort13 `computeCombinedCurve` (resistanceModifier *= per laser) and Regolith `multiplyReduceLasers` also take the product.
- So the tools split 4 to 1 for the product, and the only claimed client-code source backs the product. Bedrock is the outlier.

Further caveats:
- The claim's power formula leaves out range falloff. Holotable applies `beam.falloff(distance_m)`, and Bedrock's README stresses that distance matters.
- The crafted factor is disputed. Bedrock README treats the two Impact Force slots as multiplying (0.64 to 1.44). Holotable crates/sc-crafting/src/lib.rs says "Aggregation across slots is additive-delta... factor = 1 + Σ(factorᵢ − 1)", which gives 0.6 to 1.4 and reproduces scmdb's values.

</details>

## Claim 4: UNCERTAIN

**Claim:** The values printed on the scan panel can already include modifiers. In 4.10 a green or red resistance (not white) already contains the seat's laser-head factor. In 5.0 the modifier is printed before the value and is already applied. With a gadget attached, RES and INST are shown with the gadget applied (56 % reads 28 % under a Sabir). The rock's own value is printed / factor.

**Why it matters:** If the module ignores this, it counts head and gadget modifiers twice and badly overstates breakability. The OCR pipeline must therefore read colour, the 5.0 prefix and gadget state, and manual entry needs a matching toggle.

**Result after check:** Most of the claim holds up, with these qualifications.

- **4.10:** the resistance number is white when it is the rock's own value, for example from the MOLE pilot seat or extraction mode. It is green or red when the laser on the rock is already in it. Bedrock and Mort13 both say this. To get the own value, divide by that head's factor: 52 % green under a Helix II (factor 0.70) means 75 % own.
- **Colour only marks resistance.** Bedrock never treats the colour of the instability number as a modifier signal.
- **MOLE:** with more than one head, the panel does not say which head coloured the number. Bedrock averages the heads' factors when it doesn't know the seat. So the module needs to know which seat the scan came from.
- **5.0 (PTU only as of 2026-11, renamed from 4.11):** only Bedrock says the modifier is printed in front of RES and INST and is already applied (own = shown / (1 + modifier)). In 5.0 the colour shows severity instead. Treat this as provisional.
- **Gadgets:** Bedrock says RES and INST are shown with the gadget applied (own = shown / (1 + gadget%)). The official 3.17 patch notes also say gadget changes show up when you rescan. The Sabir 56 -> 28 example is only arithmetic from its -50 % resistance, not a recorded reading.

**What the module needs:**
- OCR has to read the resistance colour and, on 5.0, the modifier prefix.
- Gadget placement can be taken from the `Game.log` "placed 'Mining_Gadget_..." line, with the rock matched by its mass.
- Manual entry needs a "value already includes modifiers" toggle.
- Each seat and the gadget case should be checked in game.

<details><summary>Evidence</summary>

I tried to refute the claim and could not. Most of it is backed by source code, and the colour rule is backed by a second, independent tool. No one has checked it in game, and the 5.0 part and the Sabir 56 -> 28 example each rest on a single source.

**Bedrock code (cloned github.com/SC-Ravaxx/Bedrock, HEAD e5c96ac, 2026-11-22, v3.0.5; README says "for Star Citizen 4.10.3")**
- `include/MiningAdvice.h`, comment above `rockOwnResistance`: white is "the rock's own figure, as a seat that only scans sees it - a MOLE's cockpit". Green and red come "from the seat whose laser is on the rock". Example given: 75 % white in the MOLE cockpit reads 52 % green in a Helix II turret (75 x 0.70). The MOLE's Arbor MH2 adds 25 % and prints red.
- The function:
  ```cpp
  rockOwnResistance(printed, adjusted, headFactor) { if (!adjusted ...) return printed; own = printed / headFactor; clamp to 100 }
  ```
  On a MOLE, `MinerGUI::rockOwnResistanceBare` (`src/MinerGUI.cpp:5267`) uses the turret's own head if one is known. Otherwise it averages the factors of all heads. The comment admits this is wrong by the spread between heads when they differ.
- `src/ScanPanel.cpp` around line 4867: `resistanceAdjusted = printedInColour(...)`. Only resistance gets a colour test; instability does not.
- `include/PanelFive.h` header comment shows a 5.0 panel ("RESISTANCE: +25% 88%", "INSTABILITY: -35% 107.82"). It says the figures "already have it in them" and that in 5.0 colour means severity, not modifier. It also says 5.0 shows volumes under 1 SCU with an SI prefix ("754.38m" means 0.75438 SCU). In `MinerGUI.cpp:5270` the own value is printed / (1 + delta/100).
- The Gatac Hyun in 4.10 is an exception: 5.0 lettering, but a 4.10-style coloured resistance (`HYUN_PANEL`).
- `withoutGadget` in `MiningAdvice.h`: own = printed / (1 + gadget%/100), applied to both RES and INST. The Sabir's data in `include/MiningHardware.h` has resistance -50, so 56 -> 28 is just arithmetic.
- The self-test in `src/SelfTest.cpp` around line 2043 is circular: it runs `withGadget` and then `withoutGadget`. It is not an in-game observation.
- Gadget detection reads the `Game.log` line `<[ActorState] Place> ... placed 'Mining_Gadget_SHIN_Sabir_<id>' on entity 'MineableRock_..._<id>'` (`src/GameState.cpp:482`). The rock is matched by mass within 0.5 %.

**Independent corroboration**
- Mort13 BreakabilityChart (cloned github.com/mort13/BreakabilityChart, commit b74f4f9, 2026-11-18), `index.html` line 87: "The base rock values are the one you see e.g. from the moles pilot seat or with the extraction mode. Only unmodified numbers appear white ingame." This supports the 4.10 colour rule from a separate author, though as a stated rule, not code.
- A web-search snippet of the official Alpha 3.17.0 patch notes (comm-link 18636) says that after placing a gadget, the player "can scan the deposit and notice that the properties have changed". That fits gadget effects showing on the scan. I could not open the page itself: api.star-citizen.wiki is blocked in this session.
- Counterpoint, not a refutation: SC-Toolbox-Beta-V2 `tools/Mining_Signals/services/breakability.py` treats the resistance shown in game as the base value and stacks all modifiers on top. That is an assumption in that tool, not a measurement.

**5.0 status**
- Search results say 5.0 is on PTU, not live (RSI Spectrum thread "star-citizen-alpha-5-0-ptu-patch-notes").
- Search results quote starcitizen.tools as saying the patch was called 4.11 until a roadmap update on 2026-11-04.
- I could not open either page: robertsspaceindustries.com and starcitizen.tools are blocked in this session. No source other than Bedrock describes the 5.0 modifier prefix.

**Blocked hosts:** mort13.github.io, api.star-citizen.wiki, starcitizen.tools and robertsspaceindustries.com would all need to be allowed in the session's network settings to open these pages directly.

**Confidence**
- 4.10 colour rule: medium-high (two independent tools agree).
- Gadget shown as already applied: medium (Bedrock, plus the patch-note snippet).
- 5.0 prefix already applied: low-medium (Bedrock alone, PTU build).
- 56 -> 28 under a Sabir: only an arithmetic consequence of -50 %, never observed.

</details>

## Claim 5: REFUTED

**Claim:** Current 4.10.3 equipment stats are available in machine-readable form from scunpacked-data, one commit per LIVE build, read from the Raw blocks, with Bedrock's MiningHardware.h as a matching cross-check. UEX, Regolith and the item description texts carry stale pre-4.9 laser power (about 20 % low). 4.10 mass/SCU uses 142.857 kg per SCU at density 1 with Bedrock's measured ore densities and 8 quality bands per ore.

**Why it matters:** The calculator is only as right as its laser, module and gadget numbers and the ore tables used for OCR validation. Using UEX or Regolith stats would understate power by about 20 %. scunpacked has no licence file and depends on one maintainer, so if it stops updating, the per-patch update strategy needs a fallback (Bedrock tables or our own p4k parsing).

**Result after check:** The 4.10.3 equipment stats are available in machine-readable form from scunpacked-data, read from the Raw blocks. Use fireActions[n].damagePerSecond.DamageInfo.DamageEnergy, SEntityComponentMiningLaserParams (throttleMinimum, miningLaserModifiers) and the module damageMultiplier. Do not use DescriptionData, because it still carries the pre-4.9 power.

scunpacked-data does not have exactly one commit per LIVE build. A build can have several commits: 4.10.3-LIVE.13165946 has f182b7f and 3cc8072, and 4.10.0 has three. Key on the build string and take the newest commit for each build. The repo has no licence file and a single maintainer.

Bedrock's MiningHardware.h matches scunpacked exactly for all 13 lasers it lists and all 29 modules. It lacks the 4.10.3 Gatac Hyun laser (gama_hyun_s1, 3150/1295).

Pre-4.9 laser power, about 17-19 % low (Klein-S1 about 29 %), is still present in:
- the in-game description texts (verified)
- RegolithCo-Common and Bedrock's copy of the Regolith lookups (verified)
- the mort13 UEX snapshot of August 2026 (verified)

Whether live UEX and live Regolith are still stale today is unverified.

The 142.857 kg per SCU at density 1 constant holds for 4.10 rocks but not for the 5.0 Nyx I _v5 rocks, which use 13.141. Bedrock's 26 ore densities are mostly from the scmdb export; only 5 are measured. There are 8 quality bands per ore, taken from the game's qualityquantization records.

<details><summary>Evidence</summary>

I checked everything myself by cloning the repos. The core data claims hold up. Two details are wrong, and two parts I could not verify.

**1. scunpacked-data (https://github.com/StarCitizenWiki/scunpacked-data)**
- **Confirmed (high):** HEAD is 3cc8072 "4.10.3-LIVE.13165946" (21 Nov 2026). There is no LICENSE or README file in the tree. All 71 commits are by one author, H. C. Kruse.
- **Refuted (high): "one commit per LIVE build"**
  - 4.10.3-LIVE.13165946 has two commits: f182b7f (13 Nov) and 3cc8072 (21 Nov). The second is a 333-file re-export that touches no mining file.
  - 4.10.0-LIVE.12519617 has three commits (7dff1e1, f6a2b29, f45ee01). 4.10.2 has two (5ee0a3d, 1340c83).
  - Rule for the updater: key on the build string in the commit message and take the newest commit for each build.
- **Confirmed (high): 4.9 power change in c431f16 (4.8.3-LIVE) vs acaf6c7 (4.9.0-LIVE.12232306).** The field is Raw.Entity.Components.SCItemWeaponComponentParams.fireActions[0].damagePerSecond.DamageInfo.DamageEnergy:

  | Laser | 4.8.3 | 4.9.0 |
  |---|---|---|
  | Hofstede-S2 | 3360 | 4060 |
  | Helix II | 4080 | 4930 |
  | Arbor MH1 | 1890 | 2340 |
  | Hofstede-S1 | 2100 | 2600 |

  These values are unchanged through db00b74, f45ee01, e961320, 1340c83 and 3cc8072.
- Other Raw fields: fireActions[1] DamageEnergy is extraction power (e.g. 1295). SEntityComponentMiningLaserParams holds throttleMinimum (0.1 for Hofstede-S2) and miningLaserModifiers.* (resistanceModifier -30, laserInstability 10, optimalChargeWindowSizeModifier 60, optimalChargeWindowRateModifier 20). Module power factors are in Raw `damageMultiplier` (Rieger-C3 1.25, Focus III 0.95, Surge 1.5, Brandt 1.35, Optimum 0.85).
- **Reading the Raw blocks is the right call:**
  - The derived Item.stdItem.DescriptionData."Mining Laser Power" is still "336 - 3360" for Hofstede-S2 in 4.10.3.
  - stdItem.MiningLaser.PowerTransfer (4060) is correct.
  - stdItem.Modifiers maps filterModifier oddly: AllChargeRates=40 alongside InertMaterials=-40.

**2. Bedrock (https://github.com/SC-Ravaxx/Bedrock, HEAD e5c96ac, 22 Nov 2026)**
- **Confirmed (high): it matches as a cross-check.**
  - My script compared all 13 lasers in include/MiningHardware.h (fracture, extraction, throttleMin) against the scunpacked Raw blocks at 3cc8072. Every one matched exactly.
  - All 29 module power factors also match scunpacked's damageMultiplier.
  - The header says it is generated by gen_mining_hardware.py from the p4k (DamageEnergy on the ElectricArc fire mode).
- **Caveat:** scunpacked 4.10.3 adds mining_laser_gama_hyun_s1 (DamageEnergy 3150/1295, first seen in f182b7f, name still unlocalised). Bedrock's MINING_LASERS table does not have it, so the cross-check does not cover every item.

**3. Description texts and Regolith**
- **Descriptions, confirmed stale (high):** the 4.10.3 Localization.Description strings still show pre-4.9 power.

  | Laser | Description | Actual DamageEnergy | Description as share of actual |
  |---|---|---|---|
  | Hofstede-S2 | 3360 | 4060 | 0.83 |
  | Helix II | 4080 | 4930 | 0.83 |
  | Arbor MH1 | 1890 | 2340 | 0.81 |
  | Pitman | 3150 | 3900 | 0.81 |
  | Klein-S1 | 2220 | 3120 | 0.71 |

  So the descriptions are about 17-19 % low, and about 29 % low for Klein-S1. "About 20 %" is roughly right.
- **Regolith, stale (medium):**
  - RegolithCo-Common (https://github.com/RegolithCo/RegolithCo-Common, last commit 12 Apr 2026, src/gen/Loadout/loadout.json) has HofstedeS2 maxPower 3360, HelixII 4080, ArborMH1 1890.
  - Bedrock's regolith_lookups.json (last commit 22 Nov 2026) also shows HofstedeS2 maxPower 3360 and HelixII 4080.
  - I did not reach Regolith's live API, so its current state is not proven.

**4. UEX (low confidence on the current state)**
- mort13/BreakabilityChart data/laserheads_attributes.json was last committed 16 Aug 2026 (fetched by fetchuex.py from api.uexcorp.uk/2.0/items_attributes).
- It shows "Mining Laser Power" 336-3360 for Hofstede-S2 and 1020-4080 for Helix II, with date_modified 1745121470 (April 2025). That snapshot is stale.
- I could not check live UEX: api.uexcorp.uk and uexcorp.space are blocked in this session (proxy 403 / DNS fail).

**5. SCU, densities and quality bands (Bedrock)**
- **142.857 kg per SCU, confirmed (high) for 4.10 LIVE.** The source is include/RockScans.h KG_PER_SCU_AT_DENSITY_ONE, server/refinery/app.py ROCK_KG_PER_SCU, and include/MiningAdvice.h ("100 / 0.7 = 142.857").
- **Patch change:** MiningAdvice.h records that Nyx I rocks in 5.0 (PTU build 13189690, the _v5 rocks) use 13.141 kg per SCU and decayPerMass 1.45 instead of 0.2. The constant is therefore 4.10-only, not universal.
- **Ore densities, "measured" is overstated:** include/MiningLocations.h ORE_DENSITIES lists 26 ores for game build 4.10.2-live.12913470. Only Aslarite, Gold, Quartz, Silicon and Tin are marked MEASURED; the other 21 come from the scmdb export.
- **8 quality bands per ore, confirmed (high):** OreBands bands[8] in MiningHardware.h (e.g. Bexalite {302,597,632,756,875,941,959,1000}). gen_bands_from_p4k.py reads them from libs/foundry/records/crafting/qualityquantization/*.xml, eight CraftingQualityQuantizationBand rows each, using mappedValue.
- **Not verified:** the claimed 0.6 % match with the screenshot. 4627 kg / 5.54 SCU = 835 kg/SCU, an implied mean density of about 5.85. I would need the full composition to check it.

</details>

## OCR an bestätigten Scans (2026-11-26, 21 Scans: Weltraum und 3 Planeten)

Auswertung mit `scripts/ocr-eval.mjs` (nach `npm run build`):
- 357 Felder, 85 % richtig gelesen, **0 falsche Werte ohne Markierung**, alle 52 Fehler gelb.
- Unnötig gelb: 161 richtige Felder. Gründe: Zweifel bei 0/6/8/9 (92), geringe Sicherheit (61), Kasten-/Formatprüfungen (42), sonstiges (28).
- PaddleOCR lässt sich nicht besser einstellen: falsch gelesene Ziffern hatten Sicherheiten bis 0,991 (8 statt 0). Schwelle für 0/6/8/9 deshalb auf 0,995 angehoben (darüber kein Fehler in den Daten).

**Eigene Ziffernerkennung (Experiment, nicht eingebaut):**
- Ziffern lassen sich nicht über Lücken trennen: Durch Fettschrift und Farbsaum kleben sie fast immer zusammen. Brauchbar: Ziffernabstand fest (~0,7 x Zeilenhöhe, ~6,5 px bei 1080p), Fenster auf die Schrift einrasten.
- 881 beschriftete Ziffern; Test je Bild nur mit den anderen Bildern gelernt:
  - Nächste Nachbarn (8x12): 77 % richtig. Einig und gleich wie PaddleOCR: 500 Ziffern, 0 falsch, aber nur 31 von 230 zweifelhaften 0/6/8/9 bestätigt.
  - Spezialmodell 0/6/8/9 (logistische Regression, 10x15): 70–73 % (PaddleOCR 87 %), sicher nur 19–39 von 232 zweifelhaften bestätigt.
- Fazit: Bei ~6x9 px pro Ziffer und Farbsaum reicht die Information mit 21 Scans nicht. Neu bewerten mit deutlich mehr bestätigten Scans (Ordner füllt sich über "Alles geprüft") oder höherer Auflösung (1440p/4K).
