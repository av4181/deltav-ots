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

## v0.3 – DeltaV Operate-look
- Titelbalk met aparte OTS-strip, Module/Main/Username, toolbar, displaystrook (T / ESD / E.U / ◁ △ ▽ ▷), navigatieknoppen met alarmrollup, banner met infolijn en statusbalk.
- Displays zijn modulair (`src/ui/displays.ts`, `DISPLAYS`); nieuwe schermen = nieuwe `DisplayDef`.
- Stijl: `src/dv.css` (kleurconventie: klep dicht zwart, open groen; alarm rood/geel/magenta).
