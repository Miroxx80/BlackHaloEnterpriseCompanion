<!-- Rohbericht der Recherche vom 2026-11-25, Thema: ores -->

# Ores, SCU conversion and quality in Star Citizen 4.10

## 0. Sources and their limits

**Primary source:** the open-source code of the reference tool itself. Bedrock is on GitHub at https://github.com/SC-Ravaxx/Bedrock (GPL-3.0, last commit e5c96ace on 2026-11-22). Its README says "Current version: 3.0.5, for Star Citizen 4.10.3", and its official build URLs point to `the-forsaken.org/bedrock`, so this is the Forsaken tool. Its tables are generated from the game's `Data.p4k` (unp4k/unforge) and checked against thousands of shared rock scans. I cloned it and read the files directly.

**Secondary source:** RegolithCo-Common (MIT), https://github.com/RegolithCo/RegolithCo-Common, last commit 2026-04-12. This is Regolith's maths library.

**Blocked in this session:** starcitizen.tools, robertsspaceindustries.com, uexcorp.space / api.uexcorp.uk, scmdb.net and api.star-citizen.wiki were all refused by the network proxy. Wiki and RSI facts below come only from search-result snippets and are marked as such. To check them directly, those hosts must be allowed in the session's network settings.

**Patch:** LIVE is **4.10.3**. Bedrock's `gen_locations.py` names "game 4.10.3 LIVE 13165946", and its tables are built from "4.10.2-live.12913470". A **5.0.0 PTU** exists (build 13189690, Nyx I / Genesis planet), and it changes the SCU constant and the panel layout (see 2.5 and 5.3). Confidence: high (Bedrock code); medium for the exact LIVE status.

Convention below: **[V]** means I read it in the source. **[I]** means it is my inference or my own calculation.

---

## 1. Ship-mineable ores (4.10)

[V] Bedrock README, "The signature model (Star Citizen 4.10)", and `include/MiningLocations.h` (`ORE_DENSITIES`, "26 ores, game build 4.10.2-live.12913470"). Confidence: high.

| Rarity (max cluster) | Ore (base scan signature) | Game element id | Density (game units) |
|---|---|---|---|
| Legendary (2x) | Quantainium 3170 | quantainium_raw | 20.46 |
| | Stileron 3185 | `sileron_ore` (the typo is in the game files) | 4.75 |
| | **Savrilium** 3200 | savrilium_ore | 17.59 |
| Epic (3x) | **Ouratite** 3370 | ouratite_raw | 1.12 |
| | Riccite 3385 | riccite_ore | 1.61 |
| | **Lindinium** 3400 | lindinium_ore | 10.69 |
| Rare (4x) | Beryl 3540 | beryl_raw | 2.74 |
| | Taranite 3555 | taranite_raw | 10.2 |
| | Borase 3570 | borase_ore | 4.2 |
| | Gold 3585 | gold_ore | 19.46 (measured; export says 21.07) |
| | Bexalite 3600 | bexalite_raw | 6.97 |
| Uncommon (5x) | Laranite 3825 | laranite_raw | 11.49 |
| | **Aslarite** 3840 | aslarite_raw | 2.3 (measured; export 2.47) |
| | Titanium 3855 | titanium_ore | 4.48 |
| | Tungsten 3870 | tungsten_ore | 19.35 |
| | Agricium 3885 | agricium_ore | 7.14 |
| | **Torite** 3900 | torite_ore | 2.8 |
| Common (6x) | Hephaestanite 4180 | hephaestanite_raw | 3.2 |
| | **Tin** 4195 | tin_ore | 5.77 (measured; export 5.54) |
| | Quartz 4210 | quartz_raw | 2.65 (measured; export 2.53) |
| | Corundum 4225 | corundum_raw | 4.03 |
| | Copper 4240 | copper_ore | 9.03 |
| | **Silicon** 4255 | silicon_raw | 2.34 (measured; export 2.49) |
| | Iron 4270 | iron_ore | 7.87 |
| | Aluminium 4285 | aluminium_ore | 2.7 |
| | Ice 4300 | ice_raw | 1.0 |
| Not an ore | **Inert material** | none | 1.0 |

**Notes**
- New compared with the classic 3.x list (bold above): Savrilium, Ouratite, Lindinium, Aslarite, Torite, Tin, Silicon, and Ice as a ship ore.
- **Diamond is not a ship ore in 4.10.** A `diamond_raw` element still exists in `mineableelements`, but no ship-rock composition preset uses it, and it has no signature. Regolith's older enum still lists `DIAMOND`. [V, high]
- Signature rule: a scan shows base signature × number of rocks in the cluster, always as an exact multiple (6,370 = Stileron ×2). Ground deposits use 4000×N (ROC), 3000×N (hand-mineable) and 2000×N (salvage). [V, high]
- Spelling: the game writes **Quantainium**, while Regolith writes `QUANTANIUM`. UEX and the commodity records use "Aluminum", while Bedrock and the signature table use "Aluminium". Your module should match names fuzzily. Bedrock uses edit distance within a third of the letters (`snapOreName` in `src/ScanPanel.cpp`).
- "Measured" densities: Bedrock fitted these to 501 shared rocks on 12–14 November 2026, because scmdb's export disagreed by 4–8 % (`gen_locations.py`, `MEASURED`). [V, medium-high]

---

## 2. Mass (kg) to SCU

### 2.1 The game's model (4.x, verified for 4.10.2 and 4.10.3)

[V] `include/RockScans.h`, `include/MiningAdvice.h` and `server/refinery/app.py`. Confidence: high.

```
volume_m3  = rock volume (from the rock model's scale)
SCU        = volume_m3 * cSCUPerVolume / 100      // cSCUPerVolume = 0.7  ->  1 SCU = 142.857 m3
mass_kg    = volume_m3 * Σ_i ( share_i * density_i )    // inert share has density 1.0
```

Which gives:

```
kg_per_SCU_at_density_1 = 100 / 0.7 = 142.857
mass_kg = 142.857 * SCU * Σ_i ( share_i * density_i )
```

- There is **one constant (142.857 kg per SCU at density 1)** plus **one density per ore**. Inert material counts at 1.0.
- Bedrock header comment: "A rock's mass is its volume times what its parts weigh - each part's share times its ore's density, the inert rest at 1.0 ... and its SCU is its volume as well, 142.857 m3 to the SCU."
- Shares are **volume shares**. So per-ore SCU is simply `share% / 100 × total SCU`. Mass shares are not used.
- Largest ship rock: `mining_rock_01_breakable` at full size, 8,460 m³ = **59.22 SCU** (build 4.10.2). Bedrock rejects readings above 59.3. [V]

### 2.2 Check against the Bedrock example

The rock data comes from `src/DevShots.cpp`, the rock behind Bedrock's screenshot `rock_contents_four.png`:

- Panel: `BEXALITE (RAW)`, mass 4,627, RES 56, INST 64.16, 5.54 SCU
- Parts:
  - 7.42 % Bexalite q597
  - 57.00 % Bexalite q302
  - 4.85 % Gold q553
  - 4.36 % Borase q676
  - 26.34 % Inert

[I, my calculation] Per-ore SCU = share × 5.54:

| Part | SCU | Matches the example? |
|---|---|---|
| Bexalite 597 | 0.411 | yes, "Bexalite 0.41 SCU" |
| Bexalite 302 | 3.158 | |
| Gold | 0.269 | |
| Borase | 0.242 | yes, "Borase 0.24 SCU" |
| Inert | 1.459 | |

Mass check:
- Mean density = 0.6442×6.97 + 0.0485×19.46 + 0.0436×4.2 + 0.2634×1.0 = 5.880.
- 142.857 × 5.54 × 5.880 = 4,654 kg, against 4,627 shown (0.6 % off, from rounding of shares and SCU).
- Going the other way, SCU from mass = 4627 / (142.857 × 5.880) = 5.51.

So **Bedrock reads SCU straight off the panel** and only splits it by share. It does not compute SCU from mass.

### 2.3 Recommended implementation

```ts
const KG_PER_SCU_AT_DENSITY_1 = 142.857;            // 4.x LIVE (cSCUPerVolume 0.7)
const MAX_ROCK_SCU = 59.22;
type Part = { ore: string | null /* null = inert */, pct: number, quality: number };

function perOreScu(totalScu: number, parts: Part[]) {
  return parts.map(p => ({ ...p, scu: totalScu * p.pct / 100 }));
}
// Fallback when the SCU was not read: estimate it from mass + composition
function scuFromMass(massKg: number, parts: Part[], density: Record<string, number>) {
  const rho = parts.reduce((s, p) => s + p.pct / 100 * (p.ore ? density[p.ore] : 1.0), 0);
  return massKg / (KG_PER_SCU_AT_DENSITY_1 * rho);
}
// Plausibility check (Bedrock judge_rock): 142.857*SCU*0.99 <= mass <= 142.857*SCU*maxDensityOfRockType*1.01
```

Bedrock's plausibility rules ([V] `server/refinery/app.py` `judge_rock`, `RockScans::impossible`):
- The rock must not be bigger than 59.3 SCU.
- `(mass+1)/(scu-0.01) >= 142.857*0.99`. Otherwise the rock is "lighter than its volume", which means a misread.
- `(mass-1)/(scu+0.01) <= 142.857*ROCK_DENSITY_MAX[ore]*1.01`. Otherwise it is "heavier than its parts". The densest element a rock of each ore can hold is in `ROCK_DENSITY_MAX`, e.g. Bexalite/Borase/Gold/Savrilium 21.07, Quantainium 20.46, Ice 1.0.
- The shares must sum to 98–100.5 %.
- Every quality must be one of that ore's 8 values (section 3).

### 2.4 "Not scanned yet" state (important for OCR)

[V] `RockScans.h`. Confidence: high.

For 1–2 s, and sometimes up to about 30 s, the panel first shows **the volume as the mass (density 1)** with **RES 0 % and INST 0**. Example: a Lindinium rock showed 7,822 kg and 0 % for 7 s, then 44,059 kg and 53 %.

Detect this state with `ore != Ice && res == 0 && inst == 0 && |mass − 142.857·SCU| <= max(1.5, 0.6 %·mass)` and discard it. Bedrock also takes a median over about 5 looks.

### 2.5 What Regolith did, and why not to copy it

[V] RegolithCo-Common `src/equations.ts`, `shipRockVolumeCalc`:

```ts
const FUDGE_FACTOR = 33.3333333
propDensities = ores.map(({ore, percent}) => density[ore] * percent * FUDGE_FACTOR)
maxVolume = mass / Σ propDensities
volume_i = maxVolume * percent_i        // rock volume = Σ of non-inert ores (inert excluded)
```

Its densities (`lookupMocks.json` → `CIG.densitiesLookups`) are: AGRICIUM 7.2, ALUMINUM 2.7, BERYL 2.75, BEXALITE 6.9, BORASE 4.5, COPPER 8.96, CORUNDUM 4.02, DIAMOND 3.52, GOLD 19.32, HEPHAESTANITE 3.2, INERTMATERIAL 1, IRON 7.87, LARANITE 11.5, QUANTANIUM 20.45, QUARTZ 2.65, TARANITE 10.2, TITANIUM 4.5, TUNGSTEN 19.3. There are no values for Aslarite, Ouratite, Torite, Tin, Silicon, Lindinium, Savrilium and others.

[I] Applied to the Bedrock example, Regolith gives 23.8 SCU of rock (17.5 SCU of ore), against 5.54 on the panel. That is off by 142.857 / 33.33 ≈ **4.29×**. Regolith's constant is from the pre-4.x physics model and does **not** fit 4.10. I did not pin down which patch it stopped fitting. Confidence: high that it is wrong now; low on when it changed.

### 2.6 5.0 (PTU) change

[V] `MiningAdvice.h`, `RockModel`: Nyx I rocks in 5.0.0-PTU 13189690 use `miningglobalparamsship_v5.xml`.

| | decayPerMass | cSCUPerVolume | kg per SCU at density 1 |
|---|---|---|---|
| Every rock in 4.10 | 0.2 | 0.7 | 142.857 |
| Nyx I in 5.0 | 1.45 | 7.61 | **13.141** |

Bedrock checked this on 25 rocks to within 2 %. **Make the constant configurable per patch and per location.** Confidence: medium (PTU, may still change).

---

## 3. Ore quality (crafting quality)

### 3.1 What it is and when it came in

- **4.7.0:** introduced with crafting. Range on spawn 245–1000. [Wiki snippet, https://starcitizen.tools/Ore_quality, medium; page itself not reachable]
- **4.8.0:** the wiki says each ore now spawns from a **set of predefined quality values**. [Wiki snippet, medium]
- **4.8 rework of ship rocks:** each rock is now a rock *of* one ore, built from parts. [V, Bedrock `gen_mining_hardware.py`: "Since the 4.8 rework a ship-mining rock is a rock OF an ore, built from parts"]

[I] The 245 floor fits the game data: lowest roll 501 × lowest scale 0.49 = 245.

### 3.2 How a part's quality is made (4.10, game data)

[V] `gen_mining_hardware.py` and `include/MiningHardware.h`. Confidence: high.

1. **Roll:** `crafting/qualitydistribution/shipmineables/<tier>shipmineable_qualitydistribution_default.xml`, field `<CraftingQualityDistributionNormal min="501" max="1000" mean="500" stddev=…>`. The stddev depends on rarity: common 143, uncommon 150, rare 163, epic 190, legendary 203.
2. **Scale:** multiply the roll by the part's `qualityScale` from `mining/rockcompositionpresets/{asteroid,surface}shipmining/*.xml`, field `<MineableCompositionPart mineableElement=… minPercentage maxPercentage probability qualityScale>`. The values are 1, 0.789 or 0.49.
3. **Quantize:** put the result into 8 bands. The band edges are the same for all materials: **0, 400, 600, 700, 800, 900, 950, 999**. The value shown is the material's own `mappedValue` from `crafting/qualityquantization/quantization_<material>.xml`.

The 8 printable values per ore (`ORE_BANDS`, 4.10.2):

```
Agricium      346 588 667 796 852 943 971 1000
Aluminium     318 511 614 783 896 919 953 1000
Aslarite      287 575 602 741 854 927 963 1000
Beryl         324 547 677 717 860 937 955 1000
Bexalite      302 597 632 756 875 941 959 1000
Borase        359 584 676 743 892 903 976 1000
Copper        359 593 652 742 855 917 958 1000
Corundum      309 504 665 793 886 904 971 1000
Gold          264 553 644 786 864 916 959 1000
Hephaestanite 330 572 692 758 896 916 975 1000
Ice           322 561 659 714 873 922 966 1000
Iron          325 521 664 710 874 907 970 1000
Laranite      298 510 698 707 858 910 975 1000
Lindinium     305 585 618 729 853 930 954 1000
Ouratite      310 523 647 779 860 912 960 1000
Quantainium   344 514 669 762 852 901 974 1000
Quartz        330 522 641 710 899 914 969 1000
Riccite       325 525 671 743 870 942 965 1000
Savrilium     322 580 636 776 878 905 967 1000
Silicon       310 510 672 782 889 926 968 1000
Stileron      330 517 681 747 874 947 972 1000
Taranite      310 525 646 718 853 925 957 1000
Tin           340 537 664 704 880 940 964 1000
Titanium      295 516 622 784 866 916 959 1000
Torite        262 528 661 785 873 944 951 1000
Tungsten      363 530 662 787 858 902 964 1000
```

Check against the example: Bexalite 597 and 302, Gold 553 and Borase 676 are all values from this table. Use the table as an **OCR validator**: a quality not in its ore's list is a misread. Two ores can share a value, e.g. Hephaestanite and Quartz at 330; Bedrock separates them by the rock type and by mass/SCU.

### 3.3 Rock make-up per ore type

[V] `ROCK_PARTS`, 82 rows. Every rock has:
- a small **main part** of its ore at `qualityScale 1`, e.g. Bexalite 5.7–11.7 %;
- a large **bulk part** of the same ore at `qualityScale 0.49`, e.g. 28.3–78.3 %;
- 0–2 **side ores** at 0.789, each 2–10 %;
- the rest **inert**.

So **the same ore appears twice in the list with two qualities**. The small line is the valuable one. Exception: Corundum's bulk part has scale 1.0.

Side ores per rock type:

| Rock | Side ores |
|---|---|
| Agricium | Aslarite, Titanium |
| Aluminium | Corundum |
| Aslarite | Agricium, Titanium |
| Bexalite | Borase, Gold |
| Borase | Bexalite, Gold |
| Copper | Tin |
| Corundum | Aluminium |
| Gold | Borase, Bexalite |
| Hephaestanite | Quartz, Silicon |
| Laranite | Tungsten |
| Lindinium | Tungsten |
| Ouratite | Agricium |
| Quantainium | Beryl |
| Quartz | Hephaestanite, Silicon |
| Riccite | Laranite |
| Savrilium | Gold |
| Silicon | Hephaestanite |
| Stileron | Taranite |
| Tin | Copper |
| Titanium | Agricium, Aslarite |
| Tungsten | Laranite |
| Beryl, Taranite, Ice, Iron, Torite | none |

[I, my calculation from the distributions above] Chance of each band:
- **Main part (scale 1):** about 38–51 % band 1, 30–32 % band 2, 13–19 % band 3, 3–9 % band 4, and a few % in bands 5–6. Rarer ores spread wider.
- **Side ore (0.789):** about 80–90 % band 1.
- **Bulk (0.49):** about 89–97 % band 0. Bedrock's comment says the bulk in observed scans was always in the lowest band.
- Band 7 (1000) needs a roll of at least 999, so it is practically never reached.

### 3.4 What quality affects

- **Crafting:** [V] Bedrock `dist/README.txt` says "Quality 500 means the item comes out exactly like the shop version ... 1000 gives the full bonus, 1 the full penalty." `CraftQuality.h` says the item keeps the qualities it was made of, and `CraftingGlobalParams.defaultCompositionQuality = 500` stands in for an item nobody made. How strongly a stat moves is per blueprint, e.g. weapon damage ±7.5 % and recoil ±40 %. Confidence: high.
- **Refining:** quality carries through refining. The refinery terminal prints a QUALITY column per material, both in SETUP and in PROCESSING (`RefineryTerminal.h`). [V high; wiki snippet agrees]
- **Terminal sell price:** I found **no evidence** that quality changes the price at commodity terminals. Bedrock's UEX price model (`UexPrices.h`) has no quality field. Quality matters on the **UEX player marketplace**, where listings carry a `quality` field, e.g. "960q Ouratite - 35M/SCU" in Bedrock's mock data (`UexMarket.cpp`, `DevShots.cpp`). Confidence: medium. Verify in game.
- Grade letters some tools show (Bedrock `craftQualityGrade`): S ≥ 950 (the top two bands), A ≥ 900, B ≥ 800, C ≥ 700, D ≥ 600, E ≥ 400, F below that. The game itself shows no letter. [V]

---

## 4. Ore properties that matter for mining

### 4.1 Element physics

[V] `MINEABLE_ELEMENTS` in `MiningHardware.h`, from `mining/mineableelements/*.xml`. Columns:
- `instability`
- `resistance` (−1…1)
- `windowMid`, `windowRandom`, `windowThin`
- `explosion` (multiplier)
- `cluster` (how much ore survives the break, in Bedrock's reading)

How these combine into a rock's RES/INST is not this topic. The panel already shows the combined values.

| Element | instab | resist | explosion | cluster |
|---|---|---|---|---|
| quantainium_raw | 1000 | 0.95 | 260 | 0.10 |
| savrilium_ore | 1000 | 0.95 | 260 | 0.10 |
| lindinium_ore | 1000 | 0.95 | 260 | 0.10 |
| riccite_ore | 850 | 0.95 | 260 | 0.00 |
| sileron_ore (Stileron) | 870 | 0.60 | 260 | 0.00 |
| taranite_raw | 700 | 0.50 | 240 | 0.10 |
| aslarite_raw | 700 | 0.50 | 240 | 0.10 |
| ouratite_raw | 600 | 0.60 | 240 | 0.10 |
| bexalite_raw | 600 | 0.60 | 100 | 0.05 |
| gold_ore | 550 | 0.50 | 100 | 0.05 |
| torite_ore | 550 | 0.25 | 100 | 0.05 |
| laranite_raw | 400 | 0.50 | 200 | 0.40 |
| hephaestanite_raw | 400 | −0.30 | 120 | 0.50 |
| agricium_ore | 350 | 0.50 | 4 | 0.20 |
| beryl_raw | 350 | 0.65 | 20 | 0.40 |
| borase_ore | 40 | 0.30 | 120 | 0.40 |
| copper / iron / corundum / quartz / silicon | 50 | −0.7 … 0.1 | −36 … 80 | 0.4–0.9 |
| aluminium / ice / tin / titanium / tungsten | 0 | −0.5 … 0.1 | −36 … 80 | 0.4–0.9 |

Confidence: high for the raw values (game files), medium for what `cluster` means. Bedrock infers it from gadget descriptions.

### 4.2 Quantainium decay and explosion in the hold

**Not verified for 4.x.** No primary source I could reach mentions a decay timer in 4.10:
- Bedrock models nothing of it.
- Game-file fields like this were not in the parts of the generator I read.
- Search results only show old or undated guides ("volatile ... may explode in your cargo hold").

Treat it as **unknown (low)** and check `starcitizen.tools/Quantainium_(Raw)` or the 4.x patch notes once those hosts are reachable. Do not hard-code a timer.

### 4.3 Inert material

- It shows as the line `INERT MATERIALS` with quality `0`.
- It counts at density 1.0.
- It takes hold space and sells for nothing.
- Lasers and modules have a `filter` stat ("per cent less inert material drawn in"), e.g. Arbor MH1, Hofstede-S1 and Lancet MH1 at 30, Pitman at 40 (`MINING_LASERS`).

[V] high. For a "value per rock" display, use SCU without inert × price.

### 4.4 Value per SCU

UEX is the de-facto source. Bedrock uses (`src/Application.cpp`, `include/UexPrices.h`):
- `GET https://api.uexcorp.uk/2.0/commodities_prices_all` (api.uexcorp.space also answers)
- `GET https://api.uexcorp.uk/2.0/terminals`
- Fields used: `commodity_name`, `id_terminal`, `terminal_name`, `price_sell`, `status_sell` (7 = full, takes nothing), `price_buy`, `status_buy` (1 = none in stock), `date_modified` (Bedrock drops reports older than 30 days).
- Refined forms are named e.g. "Bexalite"; raw forms "Bexalite (Raw)" / "Iron (Ore)". UEX spells "Aluminum".

Confidence: high for the endpoints and fields. The API was not reachable from here, so I have **no current numbers**.

The only 4.10 numbers I found are from one blog (timesaver.gg mining guide 4.10.1), all refined, aUEC per SCU:

| Ore | Blog figure |
|---|---|
| Quantainium | ~170k |
| Bexalite | ~44k |
| Gold | ~37k |
| Taranite | ~32k |
| Laranite | ~30k |
| Diamond | ~65k |

Diamond is listed although it is not a 4.10 ship ore, which casts doubt on the whole list. Confidence: **low**. Fetch prices live from UEX instead.

---

## 5. What the in-game scan panel shows (what OCR must read)

[V] `include/ScanPanel.h`, `include/RockContents.h`, `include/PanelFive.h`, `src/ScanPanel.cpp`. Confidence: high for content and order, medium for the exact label variant per ship.

### 5.1 Layout (4.10, game's own English: "long" labels)

```
SCAN RESULTS
BEXALITE (RAW)                    <- ore name of the rock, "(RAW)" or "(ORE)" per element id
MASS:              4627           <- kg, integer, no thousands separator ("12805")
RESISTANCE:         56%           <- integer %, "D%"
INSTABILITY:      64.16           <- 2 decimals, "D.DD"
[difficulty bar, e.g. EASY … IMPOSSIBLE]   (seen on the MOLE turret in 4.10 and on every 5.0 panel)
COMPOSITION            5.54 SCU   <- total rock volume, 2 decimals
[||||||| composition bar ||||||]
 7.42%  BEXALITE (RAW)      597   <- share %, name, quality (one of the ore's 8 values)
57.00%  BEXALITE (RAW)      302
 4.85%  GOLD (ORE)          553
 4.36%  BORASE (ORE)        676
26.34%  INERT MATERIALS       0
```

Details to handle:
- **Order of rows** is fixed: ore, mass, resistance, instability, then after the second rule the volume and the composition list.
- **Composition list** shows up to four ore lines plus the inert line, in the panel's own order (not sorted).
- **Label variants:**
  - The game's own text is `MASS: / RESISTANCE: / INSTABILITY: / COMPOSITION`.
  - With a community language pack it is `MASS: / RES: / INST: / COMP.`.
  - In the game's own English, ice reads `RAW ICE`; the short-label pack writes it `ICE (RAW)`.
  - The Golem shortens long names, e.g. `HEPH (RAW)`.
  - Support all variants.
- **Ship and seat:** each has its own panel geometry and font (Prospector, MOLE pilot seat, MOLE turret, Golem, Gatac Hyun). The panel is **anchored to the rock in 3D** and slides with the view, so it must be **searched for**, not cropped. Bedrock finds it by the two long horizontal rules (under SCAN RESULTS and over the composition bar). Below 1080p the rules do not survive capture.
- **Colour:**
  - The HUD colour follows the ship.
  - A resistance printed **green or red** means the laser's modifier is already in it (Prospector, Hyun).
  - Once a **gadget** is attached, RES and INST are shown *with* the gadget applied (56 % reads 28 % under a Sabir). Divide by (1 + gadget%) to get the rock's own figures, or the gadget is counted twice.
- **Settling:** digits are ambiguous in single frames (0 against 8 at 11 px), so Bedrock sums glyph likenesses over several looks about 1.5 s apart. Also discard the "not scanned yet" frame (2.4).
- **Quality on the panel:** quality appears only on the composition list when you are close. Rock type shows at range, quality only up close; fragments can be re-scanned after the break. [search snippets, medium]

### 5.2 Game.log

[V, Bedrock's approach] Bedrock reads the rock **only from the screen**. It uses `Game.log` for places, trades, contracts, blueprints, the game version and whether the player sits in a Gatac Hyun, but not for rock figures. I saw no log line carrying the scan figures in Bedrock's code. Confidence: medium. The log topic is covered separately.

### 5.3 5.0 PTU panel changes

[V] `PanelFive.h`:
- Figures are right-aligned in a thinner font.
- RES and INST carry the laser modifier in front of them (`RESISTANCE: +25%  88%`), and the shown figure already includes it. The rock's own value = figure / (1 + modifier).
- Colour now means how severe a figure is.
- A difficulty line `( IMPOSSIBLE )` is shown.
- Rocks under 1 SCU use an SI prefix: `754.38m SCU` = 0.75438 SCU.

---

## 6. Summary for implementation

1. Read **total SCU from the panel** ("COMPOSITION x.xx SCU"). Per-ore SCU = pct/100 × SCU. Only if the SCU was not read, use the fallback `SCU = mass / (142.857 · Σ pct·ρ)` with inert = 1.0. Make the constant patch-dependent (13.141 for 5.0 Nyx I rocks).
2. Use the 26-ore density table, the 8 quality values per ore and the side-ore table as **OCR validators**:
   - mass/SCU must lie within [142.857, 142.857·ρmax];
   - shares must sum to 98–100.5 %;
   - each quality must be in its ore's list.
3. Show quality per line. Highlight the small high-quality line, which has scale 1 and is mostly band 1–3.
4. Get prices live from UEX `commodities_prices_all`. Do not hard-code them, and do not assume quality changes the terminal price.
5. **License:** Bedrock is GPL-3.0. Re-implementing its formulas and using game-data numbers is fine, but copying its code into a distributed tool brings GPL obligations. Regolith's tables are MIT.

## Sources

- Bedrock repo, commit e5c96ace, 2026-11-22: https://github.com/SC-Ravaxx/Bedrock
  - README.md, dist/README.txt
  - include/RockScans.h, include/MiningLocations.h (ORE_DENSITIES), include/MiningHardware.h (MINEABLE_ELEMENTS, ROCK_PARTS, ORE_BANDS, QUALITY_BAND_EDGES)
  - include/MiningAdvice.h (RockModel, RockStats), include/RockContents.h, include/ScanPanel.h, include/PanelFive.h, include/CraftQuality.h, include/RefineryTerminal.h, include/UexPrices.h
  - src/ScanPanel.cpp, src/DevShots.cpp (Bexalite example), src/Application.cpp (UEX_API)
  - server/refinery/app.py (ROCK_KG_PER_SCU, ROCK_DENSITY_MAX, ORE_QUALITIES, judge_rock), gen_mining_hardware.py, gen_locations.py (MEASURED)
  - Raw files: https://raw.githubusercontent.com/SC-Ravaxx/Bedrock/HEAD/<path>
- RegolithCo-Common: https://github.com/RegolithCo/RegolithCo-Common (src/equations.ts `shipRockVolumeCalc`, `FUDGE_FACTOR`; src/__mocks__/lookupMocks.json `densitiesLookups`; src/gen/schema.types.ts `ShipOreEnum`)
- Star Citizen Wiki, Ore quality (search snippet only): https://starcitizen.tools/Ore_quality
- 4.10.3 patch page (search snippet only): https://starcitizen.tools/Star_Citizen_Alpha_4.10.3
- Price figures, low confidence: https://timesaver.gg/blog/star-citizen-mining-guide-alpha-4-10-1
- Quality and crafting context (third-party blogs): https://scopique.github.io/scopique_blog/posts/2026/04/30/rock-on-mining-updates-in-star-citizen-4-8-ptu/ and https://ggwtb.com/blog/star-citizen-4-7-mining-guide-best-ships--builds--quality-system-profit-tips

Local clones for further reading are in `/tmp/claude-0/-home-user-BlackHaloEnterpriseCompanion/49b12700-ddb1-570b-b05d-320632162ade/scratchpad/repos/` (Bedrock, RegolithCo-Common).