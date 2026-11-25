import type { ScenarioDef } from './engine';
import type { Tank101 } from './tank101';

const alarmAcked = (t: Tank101, id: string): boolean => {
  const a = t.plant.alarms.alarms.get(id);
  return !!a && a.acked;
};
const alarmSeen = (t: Tank101, id: string): boolean => t.plant.alarms.alarms.has(id);

/** Malfunction-ramp van een waarde op een model-module (via de malfunctie-interface van de module). */
const mal = (pick: (t: Tank101) => { setMalfunction(id: string, v: number): void }, id: string, from: number, to: number) =>
  (t: Tank101, f: number) => pick(t).setMalfunction(id, from + (to - from) * f);

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'S1-FILTER',
    title: 'S1 · Verstopt aanzuigfilter',
    level: 'basis',
    init: 'RUNNING',
    briefing:
      'Tank101 draait normaal (500 gal, 30 GPM). Houd de installatie in de gaten. Je bent verantwoordelijk voor het veilig blijven draaien van pomp MTR-102.',
    instructorNote:
      'Het aanzuigfilter F-101 raakt geleidelijk verstopt (0 → 90 % in 10 min). ΔP over het filter (PDI-101) stijgt, de zuigdruk (PI-101) zakt richting cavitatie. Doel: tijdig herkennen en het debiet verlagen tot de zuigdruk herstelt.',
    timeline: [{ at: 30, ramp: 600, label: 'Filter F-101 verstopt geleidelijk (0 → 90 %)', apply: mal((t) => t.process.filter, 'plugging', 0, 0.9) }],
    actions: [
      {
        id: 'ack-pdi',
        text: 'Bevestig het hoge ΔP-alarm van PDI-101',
        hint: 'Lees de alarmbanner; open Alarm Help.',
        from: 30,
        until: 780,
        points: 25,
        check: (t) => alarmAcked(t, 'PDI-101/HI_ALM'),
        why: 'Een stijgend filter-ΔP is de eerste aanwijzing voor verstopping.',
      },
      {
        id: 'reduce-flow',
        text: 'Verlaag het debiet (FIC-102 in AUTO, SP ≤ 22 GPM)',
        hint: 'Minder debiet = minder ΔP over het filter = hogere zuigdruk.',
        from: 30,
        until: 900,
        points: 50,
        check: (t) => t.fic102.actual === 'AUTO' && t.fic102.sp <= 22,
        why: 'Zo blijft de zuigdruk boven de cavitatiegrens (NPSH) zonder de pomp te stoppen.',
      },
      {
        id: 'suction-ok',
        text: 'Zuigdruk PI-101 terug boven 0,8 bara',
        hint: 'Controleer PI-101 na je ingreep.',
        from: 600,
        until: 1200,
        points: 25,
        check: (t) => t.pi101.pv > 0.8 && t.fic102.sp <= 22,
        why: 'Het doel van de ingreep is een stabiele, veilige zuigdruk.',
      },
    ],
    penalties: [{ id: 'cavitation', text: 'Zuigdruk kritiek laag (PI-101 LO_LO)', points: 30, check: (t) => alarmSeen(t, 'PI-101/LO_LO_ALM') && (t.plant.alarms.alarms.get('PI-101/LO_LO_ALM')?.active ?? false) }],
    maxTime: 1500,
    speedHint: 5,
  },
  {
    id: 'S2-AIRFAIL',
    title: 'S2 · Verlies van instrumentlucht op FCV-102',
    level: 'basis',
    init: 'RUNNING',
    briefing: 'Tank101 draait normaal. Reageer op wat er gebeurt en houd de tank en de pomp veilig.',
    instructorNote:
      'Op t = 30 s valt de instrumentlucht van FCV-102 weg (fail closed). Het debiet valt naar 0, het niveau stijgt (voeding 30 GPM) en de pomp loopt dead-head. Goede reactie: alarmen bevestigen, regelaar naar MAN, pomp stoppen om dead-head te voorkomen en het niveau bewaken.',
    timeline: [{ at: 30, label: 'FCV-102: verlies van instrumentlucht (fail closed)', apply: (t) => t.process.fcv.setMalfunction('airFail', 1) }],
    actions: [
      {
        id: 'ack',
        text: 'Bevestig de alarmen van FIC-102',
        hint: 'ACK ALL of per alarm.',
        from: 30,
        until: 120,
        points: 20,
        check: (t) => alarmAcked(t, 'FIC-102/LO_ALM'),
        why: 'Elk alarm moet worden bevestigd en beoordeeld.',
      },
      {
        id: 'man',
        text: 'Zet FIC-102 in MAN',
        hint: 'De cascade kan geen debiet meer sturen.',
        from: 30,
        until: 150,
        points: 30,
        check: (t) => t.fic102.actual === 'MAN' || t.fic102.actual === 'OOS',
        why: 'Zonder lucht kan de regelaar de klep niet meer bewegen; de cascade blijft anders opwinden.',
      },
      {
        id: 'stop-pump',
        text: 'Stop pomp MTR-102 (dead-head)',
        hint: 'De pomp loopt tegen een gesloten klep.',
        from: 30,
        until: 240,
        points: 30,
        check: (t) => t.mtr102.sp === 0,
        why: 'Een pomp die tegen een gesloten klep draait warmt op en kan beschadigen.',
      },
      {
        id: 'level',
        text: 'Houd het niveau onder het HI-alarm (950 gal)',
        hint: 'Er blijft 30 GPM instromen.',
        from: 240,
        until: 900,
        points: 20,
        check: (t) => t.li101.pv < 950 && t.mtr102.sp === 0 && t.process.level > 0,
        why: 'Het niveau mag het alarm niet bereiken zolang de uitloop niet beschikbaar is.',
      },
    ],
    penalties: [{ id: 'overflow-risk', text: 'Niveau HI_HI bereikt', points: 40, check: (t) => (t.plant.alarms.alarms.get('LI-101/HI_HI_ALM')?.active ?? false) }],
    maxTime: 900,
    speedHint: 5,
  },
  {
    id: 'S3-FEED',
    title: 'S3 · Voedingsverstoring (30 → 65 GPM)',
    level: 'basis',
    init: 'RUNNING',
    briefing: 'Tank101 draait normaal. Bewaak de installatie.',
    instructorNote: 'De voeding stijgt in 60 s van 30 naar 65 GPM. De niveaucascade moet dit opvangen. Doel: de cascade bewaken, niveau binnen de grenzen houden.',
    timeline: [{ at: 20, ramp: 60, label: 'Voeding stijgt 30 → 65 GPM', apply: (t, f) => (t.process.feedFlow = 30 + 35 * f) }],
    actions: [
      {
        id: 'cascade',
        text: 'Controleer dat de cascade actief blijft (LIC-101 AUTO, FIC-102 CAS)',
        hint: 'Kijk naar de modi in de gems.',
        from: 30,
        until: 300,
        points: 40,
        check: (t) => t.lic101.actual === 'AUTO' && t.fic102.actual === 'CAS',
        why: 'Alleen in cascade volgt het uitlaatdebiet de voeding automatisch.',
      },
      {
        id: 'balance',
        text: 'Uitlaatdebiet volgt de voeding (≈ 65 GPM) en niveau binnen 15 gal van SP',
        hint: 'Gebruik snelheid ×10.',
        from: 60,
        until: 1800,
        points: 60,
        check: (t) => Math.abs(t.ft102.pv - 65) < 3 && Math.abs(t.li101.pv - t.lic101.sp) < 15,
        why: 'Eindtoestand van een geslaagde verstoringsopvang.',
      },
    ],
    penalties: [{ id: 'hi', text: 'Niveau HI-alarm bereikt', points: 20, check: (t) => (t.plant.alarms.alarms.get('LI-101/HI_ALM')?.active ?? false) }],
    maxTime: 2400,
    speedHint: 10,
  },
];
