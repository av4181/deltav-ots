# Operator Training Simulator (OTS) – DeltaV Live look & feel

Webgebaseerde OTS (HTML + TypeScript, Vite) waarmee een operator in opleiding veilig een installatie leert **bedienen**.
De app bevat **geen** bouwgereedschap: installaties en scenario's zijn ingebakken (TypeScript-data).

```
npm install
npm run dev        # ontwikkelserver
npm test           # vitest
npm run build      # typecheck + productiebuild
```

## Architectuur (3 lagen)

| Laag | Map | Inhoud |
|---|---|---|
| 1. Procesmodel | `src/model/` | Trouw aan de D-SPICE/K-Spice-moduledocumenten: `Valve`, `PipeFlow`, `Filter`, `CentPump`, `RotorSpeed`, `PressNode`, `OpenVessel` (TwoPhaseVessel-geometrie), netwerksolver (`network.ts`), spline, thermo-interface (`fluid.ts`, voorlopig water). Elke module meldt zijn eigen malfunctions (`Malfunctional`). |
| 2. DCS (DeltaV Live) | `src/dcs/` | AI/DC/PID/EM-blokken, modi, cascade, permissives/interlocks, alarmbeheer (ranking, horn, shelving, unit-alarmen), Event Journal, historian. |
| 3. Scenario & instructeur | `src/scenarios/` | Installaties (`tank101.ts` + `tank101Process.ts` koppelen model aan DCS), scenario-engine (`engine.ts`: tijdlijn met ramps, verwachte acties met tijdvenster, score, nabespreking), scenariobibliotheek (`library.ts`). |
| UI | `src/ui/` | Procesbeeld met gems, faceplates, alarmbanner/lijst, trends, vensters, instructeurspaneel, scenariovenster. |

Regel: de operator ziet uitsluitend wat een DCS ook zou tonen (transmitters, alarmen, modi). Interne modelvariabelen blijven in laag 1.

## Rollen
`OPERATOR` (standaard), `SUPERVISOR` (shelving, bypass, area filtering) en `INSTRUCTOR` (malfunctions, scenario-notities).
Wachtwoorden staan in `src/config.ts` (didactische drempel, geen beveiliging). Logon en elke instructeursactie komen in het Event Journal.

## Theorie → code
| Document | Module | Wat is overgenomen |
|---|---|---|
| Valve | `model/valve.ts` | Av = 2,4·10⁻⁵·Cv, 7 karakteristieken, blok/bypass, leidingequivalent, ramp/eerste-orde-actuator, fail_pos, lek, stuck, kritische stroming |
| PipeFlow | `model/pipe.ts` | Cv = 46280·√(d⁵/(f·L)), Swamee-Jain, K-verliezen, hoogte, extra Cv in serie (Filter) |
| Filter | `model/filter.ts` | Cv = m_r(1−P)/(C1·√(ρ_r(Δp_r+Δp_f))) |
| CentPump | `model/pump.ts` | Tabellen H(q)/η(q) met spline, affiniteitswetten, check valve, tau_flow, plugging, wear, gas |
| RotorSpeed | `model/rotor.ts` | Energiebalans met bisectie, koppel-toerentalcurve, Ieff, verliezen, stabiliteitsfactor, trip, running/stopped-drempels |
| PressNode | `model/network.ts` | Compressibiliteit (modulus), lek m = Av√(ρ(P−P₀)), impliciete netwerkoplossing |
| TwoPhaseVessel | `model/geometry.ts`, `network.ts` | V = (α_tf+α_bd)π/12·D³ + π/4·D²·L, niveau↔volume (horizontaal/vertikaal), hydrostatische nozzledruk |

Nog niet geïmplementeerd (gepland): PIDCont-uitbreidingen (D, deviation alarm, SP-ramp), GainRelay, SFC-engine (sequences),
HeatExchangerStream, Burner (WSGG-straling), FlashCalculator/thermo-pakket (PT/PH/UV-flash), volledig TwoPhaseVessel (gas/vloeistof).

## Tests
`tests/model.test.ts` controleert de modellen tegen de vergelijkingen uit de documenten; `tests/sim.test.ts` de DCS-laag;
`tests/scenarios.test.ts` laat een goede en een passieve operator de scenario's doorlopen.

## v0.3 – DeltaV Live-look (Silver-thema)
Gebaseerd op de DeltaV Live-trainingsdocumenten (Display Navigation, Simulated Process, Discrete/Analog Operations, Alarms and Events,
Motor Control, Regulatory Control, Trending, Cascade, Unit Alarms, Equipment Modules).
- **Werkbalk** met pictogrammen (zoeken, diagnostics, Tools, refresh, alarmlijst, unit-alarmen, area filtering, PHV chart/events, Watch Area, help)
  en rechts datum/tijd + gebruiker. **Tools-menu**: Print, Reset Layout, Display Set, Themes (Silver/Night), Languages.
- **Navigatiebalk**: ← → (display-historiek), ↑ (één niveau omhoog in de hiërarchie), ⌂ (home) en **display-set-tabs** met alarmtelling (rollup) en
  dropdown naar onderliggende displays. Hiërarchie in `src/ui/displays.ts` (`level`, `parent`): OVERVIEW (L1) → TANK101 (L2) → Trends (L4).
- **Alarmbanner** onderaan (zoals Live): pills met prioriteitsicoon (critical rood ⊗, warning geel ▲, advisory paars ▼), hover-popup met details,
  rechts ack-all, silence horn, horn aan/uit, direct-access (Help / Faceplate / Primary), help en node-status.
- **Faceplates** in Live-stijl: tag + beschrijving, PV/OUT, SP-slew + SP-slider op de PV-balk met alarmgrenzen, target/actual mode, OUT-balk,
  mini-trend, alarmlijst (Ack / Alarm / Help) en 5 ronde snelkoppelingen (detail, primary, Control Studio, PHV, ack). Discreet: state-knoppen met
  zwarte SP-rand, Accept, State Transition (Time Limit / Elapsed), Device State, Fail Alarm. EM: Run Command, Run, Restart Current Command.
- Kleurconventie in `src/dv.css` (variabelen bovenaan): klep/pomp open = groen, dicht = donker; alarmkleuren volgens DeltaV.
- OTS-functies (reset, scenario's, instructeur, snelheid, pauze) staan in een aparte donkere strook bovenaan; die bestaan niet in echt DeltaV.

## v0.4 – Catalyst Feed & Interface (HDPE slice 1)
- Nieuwe site **CATALYST** naast TANK101 (eigen plant, eigen alarmlijst; wisselt automatisch met het display). Display `CATALYST FEED`, `C&E`, `TRENDS`.
- Tags: licensing-tags waar bekend (FV/FT/LT/FIC-30060, XV-30061/62/63, HS-30129, SEQ-3050, I-3001/I-3002, P-3008A/B); overige tags (XV-30050…57, PIC-30010, PT-30060, DI-30060, …) zijn **OTS-toewijzingen** → verifiëren met de licensor-P&ID.
- SEQ-3050A (Cr) / 3050B (Zg) + berekening 3050C (concentratieschatting vs. werkelijke concentratie; instructeur kan potvulling en aangenomen vulfactor verstoren).
- Aannames: pompcapaciteit 3,2 m³/h (PPT: 2,2); één logische set charge-pot-kleppen; vereenvoudigde TEA; **C&E-matrix zelf gereconstrueerd** (controleer met HZS_30132/30240).
- Toolbar-iconen en Silver-thema aangepast (tweekleurige iconen, donkere OTS-balk, vlakke tabs, vierkante badges, tabular-nums).
