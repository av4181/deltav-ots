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
- Site **CATALYST** naast TANK101 (eigen plant/alarmlijst, wisselt automatisch mee met het display). Displays: `CATALYST FEED` (layout naar de Shell/Franklin-screenshot: Zg-lijn links, Cr-lijn midden, V-3009 onder, S-3003 rechtsboven, V-3010 + pompen rechtsonder), `C&E`, `TRENDS`.
- Model volgens *Control sequences for DCS* (Technip/Shell, §4) en Ineos *Chapter 5 Catalyst Injection*: twee aparte charge pots (Zg 17,6 L, Cr 91 L), gedeelde isobutaanspoeling FV-30040 (FIC-30040, F = 2200 kg/h, ramp 100 kg/h/s), SEQ-3050A (Cr, met WET) / 3050B (Zg) met de documentparameters (level_start 50 %, level_max 85 %, t_fill 50/45 s, t_vent 10 s, Pvent 2 barg, Pwet 9 barg, t_wet 30 s, t_dilute 10 min, N2-finale spoeling 25 + 5 s). De sequentie loopt cyclisch (RUN tot STOP); een fout of interlock zet haar in HELD (Failed).
- SEQ-3050C: massabalans elke 10 s met vulfactoren FF_Cr 0,75 / FF_Zg 0,85, bulk Cr 200 kg/m³, Und_Cat_Conc 150 kg/m³; INIT CONC en "manual" (berekening bevriezen). Het fysische model kent de echte concentratie; verschil door verkeerde FF, ontmengd Zg (M-3002 uit), bezonken catalyst (M-3003 uit) = trainingsmateriaal (instructeur-lade).
- Interlocks: 450KS-120 (LIR-degasser laag → spoeling dicht), geen gelijktijdige Cr/Zg-overdracht, LIR-top + N2 niet tegelijk (I-3010/I-3011), CAT_SEL vergrendeld tijdens de sequentie.
- Tags: FV/FT/LT/FIC-30060, XV-30061/62/63, HS-30129, SEQ-3050, I-3001/I-3002, S-3012-3, P-3008A/B, M-3002/M-3003 uit de Ineos-documenten; KSV-301xx (= 430KSV1xx), LT-30043/52, PT-30044/54, FIC-30040 uit het Technip-sequentiedoc zonder het cijfer 4; overige (PIC-30010, PT-30060, DI-30060, XV-30057, TEA) zijn **OTS-toewijzingen** → verifiëren met de P&ID.
- Aannames/vereenvoudigingen: pompcapaciteit 3,2 m³/h (Ineos: ~1500 kg/h bij normale LIR); CAT_SEL heeft 2 standen (Bimodal Ziegler niet apart); één LIR-spoelkring; vereenvoudigde TEA; S-3003/V-3011 alleen als sink; **C&E-matrix zelf gereconstrueerd** (controleer met HZS_30132/30240); concentratie-instelpunt 2,5 kg/m³ volgens licensing-scherm (Ineos-bedrijfsvenster 4–20 g/L).
- Toolbar-iconen en Silver-thema aangepast (tweekleurige iconen, donkere OTS-balk, vlakke tabs, vierkante badges, tabular-nums).

## v0.5 – Co-catalyst en reactoren (alleen graphics)
- Nieuwe displays (site CATALYST): `COCAT` (Co-Catalyst Systems), `REACT` (R-3001/R-3002 + Intermediate Treatment), `REACT1` / `REACT2` (detail, niveau 3; opent door op de reactor te klikken).
- Modules staan in `src/scenarios/hdpeStatic.ts`: **statische** waarden (constant + ruis, PID's volgen SP). Nog geen procesgedrag.
- Tags zijn afgeleid van de slides (430xxx → 30xxx, 43xxx → 3xxx) en moeten tegen de P&ID gecontroleerd worden.
- HS-30500 (Intermediate Treatment) staat standaard "in service"; de R-3002 katalysator- en co-katalysatorvoeding staat standaard dicht.
- Alarmrollup op tegel/tab werkt nu over meerdere units (`unit?: string | string[]`).
- Links: reactor → detail, "Catalyst" → CAT, "Co-catalyst" → COCAT, "To R-300x" → detail.
