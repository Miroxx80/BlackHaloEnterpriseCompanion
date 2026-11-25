<!-- Rohbericht der Recherche vom 2026-11-25, Thema: mechanics -->

## 0. Bottom line (TL;DR)

- **Current patch:** Star Citizen **Alpha 4.10.3 LIVE** (launcher build 4.10.3-LIVE.13165946, released 2026-11-12, according to the starcitizen.tools search snippet). **5.0 is on PTU**, and its Nyx I rocks use different mining constants (see section 8). Bedrock itself says "Current version: 3.0.5, for Star Citizen 4.10.3". *Confidence: medium. I only saw the wiki as a search snippet, but it agrees with the Bedrock README and the SCMDB changelog.*
- **Breaking is a charge balance, not an HP pool.** A rock's charge bar is filled by the effective laser energy and drains in proportion to its mass. The rock can be broken iff `P_through > decayPerMass × mass`, where `decayPerMass = 0.2` for ship rocks in 4.10 (game file). Required throttle is `0.2 × mass / P_through`. All serious tools use this, and the "0.2" / "÷5" / "×5" constant they share *is* `decayPerMass`. *Confidence: high.*
- **Main open question: how resistance reduces power.**
  - Linear `P × (1 − R_eff)`: mort13, GrimHEX, UVerse, Peacefrog, sc-holotable, starvein, SC-Bridge.
  - Bedrock's empirical curve `P × (1 − R_eff^1.21)`, fitted to 4.10 measurements. **Bedrock is the reference tool in the request, and it is open source (GPL-3).**
- **Module stacking in 4.10 is multiplicative.** HUD proof: Focus III (×0.95) plus Rieger-C3 (×1.25) shows 119, not 120. Regolith (4.0.1 note) and some others stack additively, which is outdated or wrong for 4.10. *Confidence: high.*
- **The Bedrock example output can be reproduced almost exactly** from its source code (section 6).
- **Network note:** this session could reach only GitHub. the-forsaken.org, uverse.space, grimhex.net, rockbreaker.peacefroggaming.com, scminer.rocks, regolith.rocks, RSI and starcitizen.tools could not be fetched, so I saw them only as search-engine summaries. Those hosts have to be allowed in the session's network settings before they can be checked first-hand. The source code of the key tools was read in full from GitHub.

---

## 1. Sources actually read (primary)

| # | Source | What it is | Version / date | License |
|---|---|---|---|---|
| S1 | https://github.com/SC-Ravaxx/Bedrock (commit e5c96ac, 2026-11-22): `include/MiningAdvice.h`, `include/MiningHardware.h`, `src/MinerGUI.cpp` (`rockVerdict()` at L7720, helpers around L5240-5500), `tests/scanpanel/README.md` | **The "Bedrock" tool itself** (C++, OCR of the scan panel, Windows/Linux). Contains the "CAPABLE SOLO" logic. | 3.0.5 for SC 4.10.3 | **GPL-3.0** |
| S2 | https://github.com/mort13/BreakabilityChart/blob/main/js/calculations.js (commit b74f4f9, 2026-11-18) | Mort13's breakability chart. The community "linear" formula; GrimHEX credits it. | 4.x, data from UEX `game_version 4.1` | MIT |
| S3 | https://github.com/VeeLume/sc-holotable/tree/main/crates/sc-mining/src (`setup.rs`, `rock.rs`, `sim.rs`, `ruleset.rs`; commit 8fbc8e9, 2026-11-25) | Rust re-implementation that says it is "read from the client (LIVE 4.10)": charge bar, pools, instability wave | LIVE 4.10 / 4.10.197 | no license file found (treat as all-rights-reserved) |
| S4 | https://github.com/x3nnnonn/StarCitizenDiff/blob/main/DataCore/libs/foundry/records/mining/miningglobalparamsship.xml | Datamined `MiningGlobalParamsShip` record | current main | n/a |
| S5 | https://github.com/RegolithCo/RegolithCo-Common/blob/main/src/loadoutCalc.ts, `src/equations.ts`, `src/gen/Loadout/loadout.json` | Regolith's common code (loadout stat aggregation, SCU math). **No fracture/breakability calculator is in the public code.** | last commit 2026-04-12 | MIT |
| S6 | https://github.com/RegolithCo/Regolith-Death | Stub site "End of Operations", linking `docs.regolith.rocks/blog/2026/03/10/GoodBye-Regolith` | 2026-06-01 | n/a |
| S7 | https://github.com/lostspezi/starvein/blob/main/src/features/rock-calculator/rock-break.ts | German TS port of mort13 with additive modules | 2026-09-15 | n/a |
| S8 | https://github.com/SC-Bridge/sc-bridge (`frontend/src/pages/Mining/computeCrackFeasibility.js`, `computeRockResistance.js`, `miningUtils.js`) | Another TS implementation (decay model, additive modules) | 2026-11-25 | none found |
| S9 | https://github.com/octfx/ScDataDumper (`src/Formats/ScUnpacked/MiningLaser.php`, `MiningModule.php`, `src/DocumentTypes/Mining/*.php`) | Datamining tool, the source of the exact XML field names | master | n/a |
| S10 | https://github.com/Kokizzle98/star-citizen-crafting/blob/main/data/scmdb/changelog.json | Mirror of the SCMDB changelog (Mining Solver notes) | up to 1.0.66 / 4.10.3-PTU | n/a |
| S11 | https://github.com/Mime0o/StarCitizen-mining-calculator (`calculations.py`) | Small Python calculator, same 0.2 constant | 2026-03 | n/a |
| W1 | Search summaries only: Bedrock site, UVerse fracture calculator, GrimHEX calculator, Peacefrog Rock Breaker, scminer.rocks, starcitizen.tools 4.10.3 | Unverified, not fetched | | |

---

## 2. How fracturing works in 4.10 (game data plus client-derived model)

### 2.1 The constants (ship rocks), verbatim from `miningglobalparamsship.xml` [S4]. *Confidence: high.*

```
powerCapacityPerMass 10        decayPerMass 0.2
optimalWindowSize 0.1          optimalWindowFactor 0.75      optimalWindowMaxSize 0.5
resistanceCurveFactor 0.6      optimalWindowThinnessCurveFactor 0.7
controlledBreakingFillRate 0.5 controlledBreakingFillRateDanger 0.7 controlledBreakingDecayRate 0.5
dangerBreakingFillRate 0.3     dangerBreakingFillRateExponent 2     dangerBreakingDecayRate 0.1
absorbableVolumeThreshold 330  defaultMass 100   cSCUPerVolume 0.7 (centi-SCU per m³)
instabilityWavePeriod 3  instabilityWaveVariance 1  instabilityCurveFactor 1
dangerPoolFactor 560  defaultVolume 5122.499
hitConsistencyParams: hitHistoryWindow 4, standardDeviationMultiplier 10, timeExponent 2,
                      minDeviation 0.1, extractionMagnitude 1, maxEffectOnInstability 0.5
modifierPersistenceTime 0.25   gadgetDetachThreshold 0.25  gadgetDestroyThreshold 0.5  dangerToGadgetDamage 12
```

The same record exists for FPS (`miningglobalparamsfps.xml`: powerCapacityPerMass 5, resistanceCurveFactor 0.33) and ground vehicles (`...groundvehicle.xml`: powerCapacityPerMass 4). Each rock references one ruleset through `MineableParams.globalParams` [S3, S4, S9].

### 2.2 Per-element properties (`MineableElement`) [S9, S1]

The XML attributes are `@elementInstability`, `@elementResistance` and `@resourceType`, plus window midpoint, randomness, thinness, explosion multiplier and cluster factor. Values copied from the generated Bedrock table `MINEABLE_ELEMENTS` (`{id, instability, resistance, windowMid, windowRandom, windowThin, explosion, cluster}`):

- `quantainium_raw {1000, 0.95, 0.50, 0.20, 2.30, 260, 0.10}`
- `bexalite_raw {600, 0.60, 0.40, 0.30, 0.40, 100, 0.05}`
- `copper_ore {50, -0.70, ...}`, `tin_ore {0, -0.20, ...}`, `savrilium_ore/lindinium_ore {1000, 0.95, ...}`

*Confidence: high (generated from game files).*

### 2.3 Rock stats from composition (what the scanner shows, no laser) [S3 `rock.rs`, says "client code, LIVE 4.10, checked against in-game scans"]

`x` is each entry's volume fraction. Inert material is not an entry.

- **Resistance.** Sort the entries by element resistance, highest first. For each one, `w = clamp(x^0.6 × r, −1, 1)`, then `R += w × (1 − R)` if `w > 0`, else `R += w × R`. Clamp to 0..1. The scanner shows this truncated to a whole percent. (SC-Bridge implements the same "probabilistic OR" and cites the SCMDB solver [S8].)
- **Instability.** `max(0, Σ x^1 × i) × V / defaultVolume`, where `V = SCU / 0.007` m³.
- **Window.** Thinness `T = clamp(Σ x^0.7 × t, 0, 1)`; size `(1 − 0.75·T) × 0.1`, so **2.5 %–10 % of the bar** before modifiers. It is centred on `Σ x·mid / Σ x` plus a per-rock random shift of up to `Σ x·rand / Σ x`.
- **SCU.** `V × 0.007`. Mass is `V × (Σ x·ρ + inert·ρ_inert)`.

**I verified this myself** against the 4.10 screenshot transcribed in Bedrock `tests/scanpanel/README.md`: TIN rock, MASS 22593, 30.21 SCU, 8.36 % copper, the rest tin/inert.
- V = 30.21 / 0.007 = 4315.7 m³.
- Instability = 0.0836 × 50 × 4315.7 / 5122.5 = **3.52**. The panel shows **3.52**.
- Resistance: every element is negative, so R stays **0 %**. The panel shows **0 %**.

*Confidence: high.*

### 2.4 Charge bar dynamics [S3 `setup.rs`/`sim.rs`, client-derived; S1]

- **Gain per second.** `(1 − R_eff) × Σ(E_i × throttle_i × falloff_i) / (mass × powerCapacityPerMass)`.
- **Decay per second.** `decayPerMass / powerCapacityPerMass = 0.02` of the bar per second, the same for every mass.
- So the bar holds still (the "balance throttle") where `(1 − R_eff) × E × t = decayPerMass × mass`. This is the formula every tool uses.
- **Max breakable mass.** `(1 − R_eff) × E / decayPerMass` (sc-holotable `max_mass`, "the game's IMPOSSIBLE").
- **Throttle.** Each laser has `throttleMinimum` (game file), and the throttle cannot go lower. Examples: Helix II 0.30, Hofstede-S2 0.10, Arbor MH2 0.05, Helix I 0.20, Klein-S2 0.20. It follows the setting with `current += clamp(throttleLerpSpeed·dt, throttleMinimum, 1) × (desired − current)` (client code per S3). If even the minimum throttle overfills the rock, Bedrock says to back away, because range falloff is the only control left.
- **Range falloff.** Full power up to `fullDamageRange`, zero at `zeroDamageRange`. Both modelled as linear in between (S1, S3). Bedrock says the shape is "NOT in the game files" and has two turret measurements that fit linear. *Confidence: medium.* Example: Helix I has full power to 15 m and none at 45 m, so at 28.4 m it runs at 0.553 of its power.
- **Instability wave.** Per tick, `w = sin(2πt/T) × amp`, with `T = 3 ± 1` s and `amp` drawn from 0..1 each period. When the net change is positive it is multiplied by `(1 + f)`, or divided by `(1 − f)` when f is negative, where `f = instability × w × damping`. `damping` is the mean of `1 − min(hitConsistency, 0.5)`, so steady aim halves the wave. **Instability does not raise the power requirement.** It makes the bar surge or wander once you are above balance. Bedrock: "on a rock at INST 0.00 the point reads within one per cent, while the one at 24.44 would not sit still". *Confidence: medium-high.*
- **Optimal window and fracture pools.** Two pools fill (S3, client-derived), with `scale = max(0.1, (defaultMass − mass)/defaultMass + 1)`. That is **0.1 for any real ship rock** (mass > 190).
  - Inside the window, the controlled pool fills at `0.5 × scale × optimalChargeRateFactor` per second. That is about 20 s in the window at factor 1.0, about 10 s with Okunis (+100 %).
  - Below the window, the controlled pool decays at `0.5 × scale`.
  - Above the window, the controlled pool fills at `0.7 × scale × catastrophicRateFactor`, and the **danger pool** fills at `(over + 1)^2 × 0.3 × scale × catastrophicFactor (+add per tick)`, with `over = (bar − window.high) / (1 − window.high)`. The danger pool decays at `0.1 × scale` when not above.
  - The rock fractures when either pool reaches 1. If the danger pool reaches 1 first, that is an **overcharge / catastrophic fracture**. The fuller the danger pool at fracture, the fewer pieces survive and the bigger the blast (`dangerPoolFactor 560`).
  - A gadget detaches at danger 0.25 and is destroyed at 0.5.
  - *Confidence: medium. These are S3's claims from client analysis; I could not cross-check pool timings against a second source.*
- **Window modifiers.** `window.size × Π(1 + v/100)`, capped at `optimalWindowMaxSize` = 0.5 of the bar. The HUD's "WINDOW SIZE" shows `100 × Π(1 + v/100)`. For example, Helix I (−40) with Focus III (+40) and Rieger-C3 (−1) gives 100 × 0.6 × 1.4 × 0.99 = 83.16, shown as **83** [S1 README].
- **Modifier persistence.** A laser's modifiers stay on the rock for 0.25 s after its last hit (`modifierPersistenceTime`) [S3, S4].

---

## 3. The "can it break / which power %" formulas in community tools (quoted)

### 3.1 mort13 BreakabilityChart [S2]. The canonical linear model; GrimHEX publishes it

```js
export const c_mass = 0.2;  // Mass coefficient
export function computeEffectiveResistance(resistance, resistanceModifier) {
    return Math.max(0, Math.min(1, (resistance / 100) * r_factor)) * c_r;   // c_r = 1
}
export function computeMassAtResistance(power, resistance, resistanceModifier) {
    return (power * (1 - effectiveResistance)) / c_mass;
}
export function computeRequiredPower(mass, resistance = 0, resistanceModifier = 1) {
    const denominator = 1 - effectiveResistance;
    if (denominator <= 0) return Infinity;
    return (mass * c_mass) / denominator;
}
```

- **Power with modules:** `power *= parseFloat(modAttr.value) / 100` for each active module. Power is multiplicative.
- **Resistance modifier per laser:** laser %, modules % and gadget % combined as `(1+a/100)(1+b/100)…`, returned as `1 + resistance/100`.
- **Several lasers:** `computeCombinedCurve` **sums power and multiplies the resistance modifiers** (`combinedResistanceModifier *= laser.resistanceModifier`).
- **Power %:** `calculatePowerPercentage` tries every non-empty subset of lasers, smallest first. It returns the first subset where `powerNeeded / combinedMaxPower ≤ 1` as a single % applied to every laser in the subset. Otherwise it reports `missingPower`.
- **Operator seat mode:** if the scanned resistance already includes the laser ("Effective Resistance"), the modifier is set to 1.
- Note: the gadget is folded into *each* laser's modifier and then multiplied across lasers. With 3 lasers the gadget therefore counts 3 times. That looks like a bug (my reading of the code).

GrimHEX (search summary only): "Per-head Max Rock Mass = 5 · P_active · (1 − R_eff)". UVerse/Peacefrog (summary only): "Required = (Mass ÷ (1 − AdjResist/100)) ÷ 5". Both are identical to mort13 (1/0.2 = 5). Mime0o [S11]: `yield_amount = (adjusted_power / 0.2) * efficiency`, with `efficiency = 1 − R × Π(1 − reduction)`.

### 3.2 Bedrock [S1]. The reference tool, with an empirically fitted curve

`MiningAdvice.h`:

```cpp
inline constexpr float BREAK_DECAY_PER_MASS = 0.2f;   // "decayPerMass in miningglobalparamsship.xml, used as is"
inline constexpr float BREAK_EDGE = 1.05f;            // >1.05 share = cannot hold
inline constexpr float BREAK_COMFORTABLE = 0.90f;     // <=0.90 = room to raise charge
inline constexpr float RESISTANCE_CURVE = 1.21f;
//     P_eff = P x (1 - (R x M)^1.21)
inline float resistanceLetsThrough(float rockResistancePercent, float headResistancePercent) {
    if (rockResistancePercent <= 0 || headResistancePercent <= 0) return 1.0f;
    const float held = (rockResistancePercent / 100.0f) * (headResistancePercent / 100.0f);
    if (held >= 1.0f) return 0.0f;
    return 1.0f - std::pow(held, RESISTANCE_CURVE);
}
inline ThrottleAdvice throttleFor(float mass, const MiningLaser* laser, float powerAtRange, float decayPerMass) {
    const float givesBack = mass * decayPerMass;
    const float share = givesBack / powerAtRange;          // 1.0 = full throttle
    out.toHold = share * 100.0f;
    out.toRise = out.toHold * 1.08f;
    out.possible = share <= 1.0f;
    out.overpowered = share < laser->throttleMin;
    out.headroom = out.possible ? (1.0f - share) * 100.0f : 0.0f;
}
```

- **The decay model is validated** on two heads at 0 % resistance: 9 rocks, within 2.2 percentage points except one near the throttle minimum. Examples: Helix I at 4,631 W, 16,838 kg, bar stood at 70.5 % vs model 72.7 %; crafted Hofstede-S2 at 6,177 W, 25,175 kg, 80 % vs 81.5 %. "0.19 or 0.21 fit both heads worse than 0.2."
- **The 1.21 exponent** comes from 4 rocks on a Helix I plus 3 on a Hofstede-S2. Refitting moves it between 1.16 and 1.27. Bedrock: "the exponent is a measurement, not a law. resistanceCurveFactor = 0.6 ... is unexplained; it is not this 1.21 by any obvious road." The linear formula "asks more throttle than rocks with resistance need" (e.g. a 13,147 kg QUANTAINIUM at 47 % green: line 107 %, curve 95.3 %, observed 95.4–100 %). *Confidence: medium. Small sample, one author.*
- **Multi-head:** each head's own resistance factor is applied separately and **the power that gets through adds up** (`firingOutput()` sums `onRock(i).atRange`). Bedrock does **not** multiply the heads' resistance factors together.

### 3.3 sc-holotable [S3]. Client-derived, linear

```rust
/// The heaviest rock of this resistance the setup can charge at all:
/// `(1 - R) * E / decayPerMass`.
pub fn max_mass(&self, ruleset: &Ruleset) -> f32 { (1.0 - self.resistance) * self.power() / ruleset.decay_per_mass }
pub fn balance_throttle(&self, ruleset) -> Option<f32> { let t = decay_rate / gain_rate(1.0); (t <= 1.0).then_some(t) }
```

Resistance on the modified rock is `clamp(R × factor + add, 0, 1)`, where `factor = Π(1 + v/100)` over **every hitting laser, its modules and every gadget**. So multiple lasers multiply the rock's resistance, as in mort13.

### 3.4 Regolith [S5]

The public code has **no breakability calculator**. It only aggregates loadout stats. Regolith announced end of operations (goodbye post dated 2026-03-10) [S6], so it is not a maintained reference any more.

Its aggregation for several lasers: `resistance: multiplyReduceLasers(laserStats,'resistance') * (gadgetStats.resistance || 1)` (multiplied across lasers, gadget once). Its modules per laser use **additive** stacking:

```ts
/** Feb 10, 2025: As of 4.0.1 modules stack again. ... (l * m1) + (l * m2) + ... */
return modules.reduce((acc, m) => acc + (m.stats[stat] || 1) - 1, 0) + 1
```

Regolith's laser data is older than 4.10: Helix II maxPower 4080 vs 4930 now, Hofstede-S2 3360 vs 4060. Regolith's SCU formula: `maxVolume = mass / Σ(density × percent × 33.333)` (`FUDGE_FACTOR = 33.3333333`). That is consistent with Bedrock's "kg per SCU at density 1 = 100/0.7 = 142.857".

### 3.5 Others

- **starvein [S7]:** mort13's formula plus additive modules; the gadget applied once per rock.
- **SC-Bridge [S8]:** `canCrack = effectiveDPS − decayPerMass × mass > 0`, `timeToCrack = capacity / netRate`. Damage factor `1 − clamp(R × (1 + mod), 0, 0.95)`, with laser, modules and gadget mods **added**.
- **SCMDB Mining Solver** (changelog [S10]): toggle between "additive stacking (the original SCMDB model) and multiplicative stacking (community-observed in-game behaviour)". Its formulas are "informed by community research (Mort13, Evergr3n, Oshida). Explicitly not game-canon". I found no public code.

---

## 4. Modifier stacking (laser heads, modules, gadgets)

| Item | Field in game files (ScDataDumper [S9]) | How it combines | Evidence | Confidence |
|---|---|---|---|---|
| Laser power | `DamageEnergy` on the `ElectricArc` fire action; module `damageMultiplier` (plain factor, e.g. Rieger-C3 1.25) | **Multiplicative**: `E × Π m_i × craftFactor × falloff` | HUD FRACTURE PWR 119 = 100 × 0.95 × 1.25 = 118.75 (additive would be 120) [S1 README]; 4,631 W = 3900 × 0.95 × 1.25 | high (4.10) |
| Resistance | `miningLaserModifiers/resistanceModifier/FloatModifierMultiplicative@value` (laser); same block in modules; gadgets | `R_eff = R × Π(1 + v/100)`. A **lower** factor is better (Helix −30 % gives ×0.70). The HUD RESISTANCE row shows `100 × Π`. | HUD RESISTANCE 70 for Helix I [S1]; turret shows 75 % → 52 % green with Helix II (75 × 0.70) [S1] | high |
| Instability | `laserInstability/FloatModifierMultiplicative@value` | S3: multiplicative factor on the rock's unscaled instability. Bedrock: laser and module percentages *add*, gadget multiplies the read value. Differences are small for small values. | S1, S3 | medium |
| Window size | `optimalChargeWindowSizeModifier` | Multiplicative `Π(1 + v/100)`, window capped at 0.5 of the bar | HUD 83 [S1] | high |
| Window rate | `optimalChargeWindowRateModifier` | Multiplicative on the controlled-pool fill rate | S3 | medium |
| Overcharge rate | `catastrophicChargeWindowRateModifier` | Multiplicative on danger fill (plus additive per tick) | S3 | medium |
| Additive modifiers | `FloatModifierAdditive` | Added (`v/100`). Only the ROC-DS module uses this kind. | S3 | medium |
| Crafted laser | "Impact Force" (fracture power) on 2 of 3 blueprint slots | ×0.64..×1.44, applied **after** the modules. The HUD's FRACTURE PWR line leaves it out. | S1 measurements | medium |

**Gadgets** attach to the *rock*, not the ship, and only one per rock is allowed (the game warns that more "can result in a catastrophic explosion") [S1]. Bedrock values from game files: BoreMax instability −70 / resistance +10 / cluster +30; Sabir resistance −50 / window +50 / instability +15; OptiMax resistance **−25** (UEX and Regolith data say −30, so the data has drifted); Okunis window +50 / rate +100; Stalwart instability −35 / window −30 / rate +50; Waveshift window +100 / instability −35 / rate −30.

**Once a gadget is on the rock, the panel prints resistance and instability with the gadget already applied** (e.g. "56 % reads 28 % under a Sabir"). A tool must divide the gadget back out, or it counts the gadget twice [S1 `withoutGadget`]. Game.log records the placement (`placed 'Mining_Gadget_SHIN_Sabir_<id>' on entity 'MineableRock_...'`) but **no rock figures** [S1]. *Confidence: medium-high.*

**Active modules** [S1, from component flags in the game files]: active modules interrupt each other, so only one runs at a time, **except Surge**, which runs alongside others and alongside a second Surge. Example values: Surge ×1.5 power, resistance −15.5, instability +10, 7 uses × 15 s; Brandt ×1.35, resistance +15.5. Bedrock reports the hold % "with Surge fired" and separately "Without Surge approximately X %". *Confidence: medium (one contradicting in-game check is noted in S1).*

**What the scanner shows depends on the seat** [S1]. *Confidence: medium-high.*
- In 4.10 resistance is printed in **white** (the rock's own value, e.g. from the MOLE pilot seat), or in **green/red** when the seat's own laser has already modified it.
- In **5.0** the modifier is printed in front of the value (`RESISTANCE: +25%  88%`) and the value already includes it.
- To get the rock's own resistance: `own = printed / headFactor`.

---

## 5. Multiple lasers and "CAPABLE SOLO" vs crew

**Physics (all tools agree):** the fracture energy of all heads hitting the rock **adds up** ("two heads on one rock is two beams on one rock").

**Disagreement on resistance with several heads:**
- (a) mort13 and sc-holotable: the rock's resistance is multiplied by **every** hitting head's factor (3× Helix II gives ×0.343). sc-holotable says this is "client code".
- (b) Bedrock: each head pushes its power through the rock with only its own factor, and the results are summed.
- (b) is the more conservative answer for resistance-reducing heads. Nobody has published measurements separating the two. *Confidence that one of them is right: low-medium.*

**Instability with several lasers** (S3): the factor is multiplied by `owners / Π(lasers per owner)`. Two lasers from one ship halve the wave; two ships on one rock double it. S3 marks "owner = ship" as inferred.

**Bedrock verdict logic** (`MinerGUI::rockVerdict`, src/MinerGUI.cpp L7720ff) [S1]:

1. **Per head:** `share_i = mass × decayPerMass / (P_i × falloff_i × (1 − (R_own × M_i)^1.21))`.
2. **`headsThatHoldAlone()`:** heads with `share ≤ 1.05` **and** `share ≥ throttleMin`. They are ranked by `window × (0.5 + 0.5 × max(0, 1 − |share − 0.6| / 0.6))`, which prefers a wide charge window and a throttle near 60 %. If any exist, the result is **"CAPABLE SOLO"**, naming the place (LEFT/MIDDLE/RIGHT) and the laser. In a turret, the player's own head comes first.
3. If every capable head would need less than its `throttleMin`: **"MIN LASER POWER AT OPTIMAL RANGE - HIGH"** plus a back-off distance. The target throttle is `throttleMin + 0.25`, clamped to 35–60 %, and the distance is the inverse of the linear falloff.
4. Otherwise `fewestHeadsNeeded()`: heads sorted strongest first are added until `Σ P_through ≥ needs / 0.9`. Result: **"N LASERS REQUIRED" / "ALL 3 LASERS REQUIRED"**, "One operator per laser required".
5. Otherwise **"LASER(S) CANNOT BREAK DEPOSIT"** with "Required power: 0.2·mass | Available power: Σ".
6. **Single-head ships:** "CAPABLE" if `share ≤ 1`. "Comfortable" means `share ≤ 0.90`; otherwise "Charge will rise slowly".
7. **Wording:** `powerWords()` shows `hold ± 4` when instability > 1 (`v.sway = rock_.instability > 1.0f ? 4.0f : 0.0f`), giving lines like "30–38 % laser power will hold charge steady". The extra line "All 3 lasers together at approximately X % power each" uses `Σ P_through` over all firing heads.

**Gadget advice** (`advise()`): Bedrock computes the hold share with no gadget.
- If it is above 1.05, it looks for a resistance gadget that brings it to ≤ 1.05: "Required - Without it charge cannot be held steady at any power, with it approximately X %". If none does: "NO GADGET CAN HELP BREAK DEPOSIT - More laser power is required".
- If it is between 0.90 and 1.05 and a gadget brings it to ≤ 0.90: "Recommended - Laser power A → B %".
- Otherwise the goal falls through: instability ≥ 5 → **BoreMax** (largest instability cut); window < 70 → Waveshift; else OptiMax (yield).
- The displayed line is "Optional: <name>" plus `"Instability %.1f → %.1f"`, computed as `instability × (1 + gadget.instability/100)`.
- These thresholds (`RESISTANCE_HARD 50`, `INSTABILITY_RISKY 5`, `WINDOW_NARROW 70`) are labelled by the author as "first estimates".

---

## 6. Reproducing the Bedrock example (my own calculation from S1 data and code)

Inputs: 4,627 kg BEXALITE, RES 56 % (white, the rock's own value), INST 64.16. Argo MOLE with Helix II / Hofstede-S2 / Helix II, stock, inside optimal range.
- Needs: `0.2 × 4627 = 925.4`.
- Hofstede-S2: `P = 4060`, `M = 0.70`; `R × M = 0.392`.
  - Bedrock curve: `0.392^1.21 = 0.3221`, so P_through = `4060 × 0.6779 = 2752`. Share = **33.6 %**, shown with ±4 as **"30–38 %"**. This **matches the screenshot exactly.**
  - Linear (mort13/holotable): `925.4 / (4060 × 0.608) = 37.5 %`.
- Hofstede is picked as MIDDLE/solo because its window is +60 (`WINDOW SIZE 160`), the widest. Each Helix II alone would need `925.4 / (4930 × 0.678) = 27.7 %`, which is **below the Helix II's 30 % throttle minimum**, so under Bedrock's rule it does not count as "holding alone".
- "All 3 lasers together at approximately 4–12 % each" means a hold of about 8 %.
  - Bedrock's own code with three *stock* heads gives `925.4 / (2752 + 2 × 3342) = 9.8 %`, which would display as 6–14 %. The screenshot's value therefore implies about 11.6k through, e.g. modules or crafting on the Helix IIs. *Inference, not verifiable.*
  - Coincidentally, mort13's product model gives `925.4 / (13920 × (1 − 0.56 × 0.343)) = 8.2 %`.
  - Either way, 4–12 % is below the Helix II minimum of 30 %, so this line is informational only.
- **"Instability 64.2 → 19.2"** is the BoreMax gadget (instability −70 %): `64.16 × (1 − 0.70) = 19.25`. It is "Optional" because the rock already holds comfortably (34 % < 90 %) and instability ≥ 5, which sends the logic to the "Safe" goal. BoreMax also adds +10 % resistance (56 → 61.6 %). *Confidence: high (arithmetic plus code).*

---

## 7. Recommended implementation for the companion (inference / design suggestion)

```ts
// all percentages as fractions; values from game data per patch
const DECAY_PER_MASS = { ship: 0.2, ship_v5: 1.45 };      // 5.0 Nyx I rocks (PTU)
type ResistanceModel = 'linear' | 'bedrock';               // exponent 1 vs 1.21
function through(P: number, falloff: number, Rown: number, headFactor: number, gadgetRes = 0, k = 1.21) {
  const R = Math.min(1, Math.max(0, Rown * (1 + gadgetRes)) * headFactor);   // gadget on rock, head per laser
  return P * falloff * (1 - Math.pow(R, k));
}
headPower   = E_damageEnergy * Π(module.damageMultiplier) * (1 + crafted/100);   // multiplicative
headFactor  = (1 + laser.res/100) * Π(1 + module.res/100);                        // HUD RESISTANCE/100
falloff     = d <= full ? 1 : d >= zero ? 0 : (zero - d) / (zero - full);
needs       = DECAY_PER_MASS[ruleset] * mass;
share_i     = needs / through_i;   // solo: capable if share_i <= 1 (Bedrock edge 1.05) && share_i >= throttleMin_i
holdPct     = 100 * share;  rangePct = instability > 1 ? [hold-4, hold+4] : [hold];
crew:       sort heads by through desc, add until Σthrough >= needs/0.9
maxMass     = Σthrough_at_R / DECAY_PER_MASS
```

Make these configurable rather than hard-coded, because they are the open points:
- the resistance exponent `k` (1.0 or 1.21);
- the multi-head resistance mode (per head vs product);
- `decayPerMass` per ruleset;
- the comfort and edge thresholds (0.90 / 1.05).

Before applying anything, convert scanned values back to the rock's own figures. Read the colour (4.10) or the printed modifier (5.0), and divide out a gadget that is known to be placed (from Game.log).

---

## 8. Patch-dependence and known limitations

1. **5.0 PTU (Nyx I rocks).**
   - Bedrock: "The 13 ship rocks there (`entities/mineable/mineablerock_surface*_v5.xml`, PTU build 13189690) take their global parameters from `miningglobalparamsship_v5.xml`". There `decayPerMass` is **1.45** (vs 0.2) and `cSCUPerVolume` is **7.61** (vs 0.7). So such rocks weigh about a tenth per SCU (13.141 kg per SCU at density 1) and take back 7.25× as much per kg.
   - Bedrock checked this on 25 Prospector rocks (15 Nov 2026). Every rock the panel called EASY for a stock Arbor MH1 (2,340 W) needs ≤ 1,820 W; every IMPOSSIBLE one needs ≥ 2,055 W.
   - The 5.0 panel also prints the laser modifiers in front of RES/INST.
   - I could not fetch the v5 XML myself (404 in the StarCitizenDiff mirror). *Confidence: medium.*
2. **Stacking history.** Regolith says "As of 4.0.1 modules stack again" (additive, Feb 2025). The 4.10 HUD shows multiplicative. Either CIG changed it after 4.0.1 or Regolith misread it. Several tools (starvein, SC-Bridge, SCMDB's default model) still add. *Use multiplicative for 4.10. Confidence: high.*
3. **Resistance curve.** Linear `1 − R_eff` (most tools, and S3's client reading) vs Bedrock's measured `1 − R_eff^1.21`. They differ by up to about 10 points of throttle on high-resistance rocks. Bedrock reports that linear over-asks. The game constant `resistanceCurveFactor 0.6` belongs to the composition blend (section 2.3), **not** to this curve.
4. **Multi-laser resistance** (product vs per head) is unresolved (section 5). So are the instability owner factor (S3 "inferred") and whether a second Surge stacks (one contradicting check in S1).
5. **Range falloff shape** between full and zero range is not in the files. Linear fits two measurements [S1].
6. **Measurement noise.** "one rock at INST 24.44 held at 97, 96, 95 and 89 % on four tries" [S1]. Throttle advice should be shown as a band, not one number.
7. **Data drift between sources.**
   - UEX (`game_version 4.1`, used by mort13) vs game files (Bedrock, 4.10): OptiMax resistance −30 vs −25; Klein-S1 has 0 module slots in the game file.
   - Regolith's laser powers are outdated (Helix II 4080 → 4930).
   - Read item stats from a 4.10 datamine (ScDataDumper or StarCitizenDiff field names, see section 4), not from older spreadsheets.
8. **Pool and fracture timings** (20 s in the window, danger fill, blast) come from one source only (S3) and are not validated by a second tool.
9. **Mass units.** All formulas use the HUD's MASS number directly; the constants are calibrated to it. S3 calls it tonnes, the HUD/Bedrock call it kg. This does not affect the results.
10. **Licensing.** Bedrock is GPL-3: copying its code into a distributed tool brings GPL obligations, while reimplementing the formulas is fine. mort13 and Regolith-Common are MIT. sc-holotable and SC-Bridge have no license file.

## 9. Verified vs inferred

- **Verified in source:**
  - every quoted formula and constant (S1–S9);
  - the XML constants (S4);
  - the HUD multiplicative proof (S1 README);
  - Bedrock's verdict logic and wording;
  - Regolith's shutdown and its additive stacking comment;
  - the TIN-rock instability check, 3.52 reproduced (my calculation).
- **Inferred by me:**
  - that the Bedrock screenshot's Helix IIs carried modules;
  - that the mort13 gadget is counted once per laser (a likely bug);
  - the design in section 7;
  - that the current LIVE patch is 4.10.3, from the starcitizen.tools snippet, the Bedrock README and the SCMDB changelog (not from an RSI page, which was unreachable).