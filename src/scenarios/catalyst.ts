import { AnalogInput } from '../dcs/ai';
import { CauseEffect } from '../dcs/ce';
import { DiscreteDevice } from '../dcs/discrete';
import { EquipmentModule, type EmStep } from '../dcs/em';
import { Pid } from '../dcs/pid';
import { Plant } from '../dcs/plant';
import { CataCalc, CatalystProcess, RHO_LIR, type CataType, type PotValves } from './catalystProcess';
import { addStaticSections } from './hdpeStatic';
import type { ReactorProcess } from './reactorProcess';
import { MOTOR_CFG, SELECTOR_CFG, VALVE_CFG } from './dcCfg';

export const CATALYST_UNIT = 'CATALYST';

/** instelbare sequence-parameters (Shell/Technip "Control sequences for DCS" §4.2.1 / §4.3.1) */
export interface SeqPar {
  levelStart: number; levelMax: number; xOpen: number; flushSp: number; flushRamp: number;
  tVent: number; pVent: number; toPvent: number; pWet: number; tWet: number; toWet: number; tDilute: number;
  tTop: number; tOut: number; tN2a: number; tN2b: number; tFill: Record<CataType, number>;
}
export const SEQ_DEFAULTS = (): SeqPar => ({
  levelStart: 50, levelMax: 85, xOpen: 12, flushSp: 2200, flushRamp: 100, tVent: 10, pVent: 2, toPvent: 30,
  pWet: 9, tWet: 30, toWet: 720, tDilute: 600, tTop: 5, tOut: 5, tN2a: 25, tN2b: 5, tFill: { CR: 50, ZG: 45 },
});

export interface Catalyst {
  plant: Plant;
  rx: [ReactorProcess, ReactorProcess];
  process: CatalystProcess;
  calc: CataCalc;
  ce: CauseEffect;
  dc: Record<string, DiscreteDevice>;
  seq: EquipmentModule;
  par: SeqPar;
  /** cyclisch: na afloop wacht de sequentie op het volgende laag-niveau (zoals het DCS: RUN blijft staan tot STOP) */
  repeat: { on: boolean; cmd: string };
  tea: { r1: number; r2: number };
  /** operator-prompt in de Wet-stap (to_wet verstreken zonder Pwet): Hold / Continue / Extra time */
  ui: { prompt: string | null };
  startSeq(cmd: string): boolean;
  /** STOP: de lopende cyclus wordt afgewerkt, daarna sluiten alle kleppen en wordt CAT_SEL ontgrendeld */
  stopSeq(): void;
  /** ABORT: onmiddellijk naar Idle, alle kleppen dicht; herstart vanaf het begin */
  abortSeq(): void;
  holdSeq(): void;
  /** herstart vanaf het begin van de stap waar de sequentie in HELD ging (reset Al_Pvent) */
  restartStep(): boolean;
  answerWet(option: 'HOLD' | 'CONTINUE' | 'EXTRA', extraMin?: number): void;
  /** DCS-schatting van de zuivere catalystflow (kg/h) = gemeten slurryflow × berekende concentratie */
  pureEstimate(): number;
}

/** pot-kleptags: doc 430KSV101…105 (Zg), 111…116 (Cr) → hier KSV-30101… */
export const POT_TAGS = {
  ZG: { day: 'KSV-30101', top: 'KSV-30102', n2: 'KSV-30103', vent: 'KSV-30104', out: 'KSV-30105', bot: '' },
  CR: { day: 'KSV-30111', top: 'KSV-30112', n2: 'KSV-30113', vent: 'KSV-30114', out: 'KSV-30115', bot: 'KSV-30116' },
} as const;

/**
 * Catalyst feed-sectie: twee parallelle lijnen (Ziegler / Chromium) → V-3009 → V-3010 → P-3008A/B → reactoren.
 * Bronnen: Shell/Technip "Control sequences for DCS" §4 (SEQ-3050A/B/C), Ineos Chapter 5 Catalyst Injection, licensing-view 3.
 * Tags: FV/FT/LT/FIC-30060, XV-30061/62/63, HS-30129, SEQ-3050, I-3001/2, S-3012-3, P-3008A/B, M-3002/M-3003 komen uit de Ineos-documenten;
 * KSV-301xx (doc 430KSV1xx), LT-30043/52, PT-30044/54, FIC-30040 komen uit de Technip-sequentiedoc zonder het cijfer 4;
 * overige tags (PIC-30010, PT-30060, DI-30060, XV-30057, TEA) zijn OTS-toewijzingen → verifiëren met de P&ID.
 */
export function buildCatalyst(seed = 7): Catalyst {
  const plant = new Plant('Catalyst feed – normal operation', seed, 'CATALYST_AREA');
  const ctx = plant.ctx;
  const UNIT = CATALYST_UNIT;
  const P = new CatalystProcess();
  const calc = new CataCalc();
  const par = SEQ_DEFAULTS();
  const tea = { r1: 5.1, r2: 0 };
  const repeat = { on: false, cmd: '' };
  const ui: { prompt: string | null } = { prompt: null };
  let locked = false; // CAT_SEL vergrendeld (LOCK in Initialisation, UNLOCK pas na STOP)
  let alPvent = false;
  let wetSkip = false;
  let wetStart = 0;

  // ---- initiële stationaire toestand (licensing-scherm: 40,8 %, 2,5 kg/m³, 2,7 kg/h, 596 kg/h, 83,5 %) ----
  P.vol = 1.632; P.cata = 2.5 * P.vol; P.p9 = 6.5; P.p10 = 6.0; P.conc10 = 2.5;
  calc.cata = P.cata;
  calc.concSp = 2.5;
  const pureSp0 = 2.7;
  const slurry0 = (pureSp0 / 2.5) * RHO_LIR; // kg/h

  // ---- discrete devices ----
  const dc: Record<string, DiscreteDevice> = {};
  const addV = (tag: string, desc: string, init: 0 | 1 = 0) => (dc[tag] = plant.addModule(new DiscreteDevice(ctx, tag, desc, UNIT, 'VALVE', VALVE_CFG, init)));
  const addM = (tag: string, desc: string, init: 0 | 1 = 0) => (dc[tag] = plant.addModule(new DiscreteDevice(ctx, tag, desc, UNIT, 'MOTOR', MOTOR_CFG, init)));
  const potDesc = { day: 'day tank outlet', top: 'charge pot top LIR inlet', n2: 'charge pot N2 inlet', vent: 'charge pot bottom vent (to S-3003)', out: 'charge pot outlet to V-3009', bot: 'charge pot bottom LIR inlet (wetting)' };
  for (const [k, name] of [['ZG', 'Zg'], ['CR', 'Cr']] as const) {
    for (const f of ['day', 'top', 'n2', 'vent', 'out', 'bot'] as const) {
      const tag = POT_TAGS[k][f];
      if (tag) addV(tag, `${name} ${potDesc[f]}`);
    }
  }
  addV('XV-30057', 'V-3009 catalyst dump to S-3003');
  addV('XV-30061', 'Catalyst feed block valve to R-3001', 1);
  addV('XV-30062', 'LIR dilution block valve to V-3010', 1);
  addV('XV-30063', 'Catalyst feed block valve to R-3002');
  addM('P-3008A', 'Catalyst pump P-3008A');
  addM('P-3008B', 'Catalyst pump P-3008B (running)', 1);
  addM('M-3003', 'V-3009 agitator', 1);
  addM('M-3002', 'V-3005 Ziegler day tank agitator', 1);
  const hs = plant.addModule(new DiscreteDevice(ctx, 'HS-30129', 'Catalyst selector CAT_SEL (Chromium / Ziegler)', UNIT, 'VALVE', SELECTOR_CFG, 1));
  dc['HS-30129'] = hs;
  const isZg = (): boolean => hs.sp === 1;

  // ---- cause & effect ----
  const ce = new CauseEffect('Cause and effect display – Catalyst feed');
  ['close FV-30060', 'FMC FIC-30061', 'Trip P-3008A', 'Trip P-3008B', 'Close XV-30061', 'Close XV-30062', 'Close XV-30063', 'Close LIR flush (FV-30040 / KSV top, bottom)'].forEach((e) => ce.addEffect(e));
  ce.addCause('I-3001', 'Emergency Shutdown', ['close FV-30060', 'FMC FIC-30061', 'Trip P-3008A', 'Trip P-3008B', 'Close XV-30061', 'Close XV-30062', 'Close XV-30063']);
  ce.addCause('I-3002', 'Reactors Kill', ['close FV-30060', 'Trip P-3008A', 'Trip P-3008B', 'Close XV-30061', 'Close XV-30063']);
  let pumpsWereRunning = true; // S-3012-3 bewaakt een uitval, niet de gestopte beginstand
  ce.addCause('S-3012-3', 'P-3008A and P-3008B stopped', ['close FV-30060', 'Close XV-30062'], () => dc['P-3008A'].pv !== 1 && dc['P-3008B'].pv !== 1 && dc['P-3008A'].sp === 0 && dc['P-3008B'].sp === 0 && pumpsWereRunning);
  ce.addCause('_LALL50263', 'Lean ISO degasser C-5002 level low-low (450KS-120)', ['FMC FIC-30061', 'Close XV-30062', 'Close LIR flush (FV-30040 / KSV top, bottom)']);
  plant.onPost(() => {
    if (dc['P-3008A'].pv === 1 || dc['P-3008B'].pv === 1) pumpsWereRunning = true;
    else if (dc['P-3008A'].sp === 0 && dc['P-3008B'].sp === 0 && !ce.effectActive('close FV-30060')) pumpsWereRunning = false;
  });
  const effectCond = (effect: string, text: string) => ({ id: effect.replace(/\W+/g, '_'), text: `${text}: ${effect}`, blocking: () => ce.effectActive(effect), bypassed: false });
  dc['XV-30061'].conditions = [effectCond('Close XV-30061', 'C&E')];
  dc['XV-30062'].conditions = [effectCond('Close XV-30062', 'C&E')];
  dc['XV-30063'].conditions = [effectCond('Close XV-30063', 'C&E')];
  const FLUSH_EFF = 'Close LIR flush (FV-30040 / KSV top, bottom)';
  const pumpConds = (tag: 'P-3008A' | 'P-3008B') => [
    effectCond(`Trip ${tag}`, 'C&E'),
    { id: 'NO_PATH', text: 'No open discharge path (XV-30061/XV-30063 closed): dead-head', blocking: () => dc['XV-30061'].pv !== 1 && dc['XV-30063'].pv !== 1, bypassed: false },
    { id: 'V3009_LL', text: 'V-3009 level below 5 %', blocking: () => ai.lt.pv < 5, bypassed: false },
  ];
  dc['P-3008A'].conditions = pumpConds('P-3008A');
  dc['P-3008B'].conditions = pumpConds('P-3008B');
  // pot-interlocks: 450KS-120 (LIR-degasser laag), geen gelijktijdige Cr/Zg-overdracht, I-3010/I-3011 (LIR terug in N2-net)
  for (const k of ['ZG', 'CR'] as const) {
    const other = POT_TAGS[k === 'ZG' ? 'CR' : 'ZG'];
    const me = POT_TAGS[k];
    for (const f of ['top', 'bot'] as const) {
      if (me[f]) dc[me[f]].conditions = [effectCond(FLUSH_EFF, '450KS-120'), { id: 'N2_OPEN', text: `${me.n2} open (backflow LIR to N2 header)`, blocking: () => dc[me.n2].pv !== 0, bypassed: false }];
    }
    dc[me.n2].conditions = [{ id: 'LIR_OPEN', text: `${me.top} open (backflow LIR to N2 header, I-3010-O/I-3011-O)`, blocking: () => dc[me.top].pv !== 0, bypassed: false }];
    dc[me.out].conditions = [{ id: 'OTHER_OUT', text: `${other.out} open (avoid simultaneous Cr / Zg transfer)`, blocking: () => dc[other.out].pv !== 0, bypassed: false }];
  }
  dc['HS-30129'].conditions = [{ id: 'SEQ_LOCK', text: 'CAT_SEL locked by SEQ-3050 (LOCK until the sequence is stopped)', blocking: () => locked, bypassed: false }];

  // ---- instrumenten ----
  const lt = plant.addModule(new AnalogInput(ctx, 'LT-30060', 'V-3009 catalyst slurry vessel level', UNIT, '%', 0, 100, () => P.level, [
    { param: 'HI_HI_ALM', limit: 95, priority: 'CRITICAL' }, { param: 'HI_ALM', limit: 90, priority: 'WARNING' },
    { param: 'LO_ALM', limit: 15, priority: 'WARNING' }, { param: 'LO_LO_ALM', limit: 5, priority: 'CRITICAL' },
  ], { tau: 2, noise: 0.05, deadband: 1 }));
  const pt9 = plant.addModule(new AnalogInput(ctx, 'PT-30060', 'V-3009 N2 pressure', UNIT, 'barg', 0, 10, () => P.p9, [
    { param: 'HI_HI_ALM', limit: 8.5, priority: 'CRITICAL' }, { param: 'HI_ALM', limit: 7.5, priority: 'WARNING' }, { param: 'LO_ALM', limit: 5.5, priority: 'WARNING' },
  ], { tau: 1, noise: 0.005, deadband: 0.1, decimals: 2 }));
  const pt10 = plant.addModule(new AnalogInput(ctx, 'PT-30010', 'V-3010 buffer pot pressure (pump suction)', UNIT, 'barg', 0, 10, () => P.p10, [
    { param: 'HI_ALM', limit: 7, priority: 'WARNING' }, { param: 'LO_ALM', limit: 4.5, priority: 'WARNING' }, { param: 'LO_LO_ALM', limit: 3, priority: 'CRITICAL' },
  ], { tau: 0.5, noise: 0.005, deadband: 0.1, decimals: 2 }));
  const ft60 = plant.addModule(new AnalogInput(ctx, 'FT-30060', 'Catalyst slurry flow V-3009 → V-3010', UNIT, 'kg/h', 0, 1200, () => P.slurryKgh, [], { tau: 2, noise: 1.5, decimals: 1 }));
  const ft61 = plant.addModule(new AnalogInput(ctx, 'FT-30061', 'LIR dilution flow to V-3010', UNIT, 'kg/h', 0, 2000, () => P.lirKgh, [], { tau: 2, noise: 2, decimals: 0 }));
  const ft40 = plant.addModule(new AnalogInput(ctx, 'FT-30040', 'Isobutane flush flow to charge pots', UNIT, 'kg/h', 0, 5500, () => P.flushKgh, [], { tau: 1, noise: 2, decimals: 0 }));
  const di60 = plant.addModule(new AnalogInput(ctx, 'DI-30060', 'Catalyst concentration V-3009 (SEQ-3050C calculation)', UNIT, 'kg/m³', 0, 40, () => calc.conc(lt.pv), [], { tau: 0.2, decimals: 2 }));
  const lt52 = plant.addModule(new AnalogInput(ctx, 'LT-30052', 'Ziegler day tank V-3005 level', UNIT, '%', 0, 100, () => P.zgLevel, [{ param: 'LO_ALM', limit: 20, priority: 'WARNING' }], { tau: 2, decimals: 1 }));
  const lt43 = plant.addModule(new AnalogInput(ctx, 'LT-30043', 'Chromium day tank V-3007 level', UNIT, '%', 0, 100, () => P.crLevel, [{ param: 'LO_ALM', limit: 20, priority: 'WARNING' }], { tau: 2, decimals: 1 }));
  const pt54 = plant.addModule(new AnalogInput(ctx, 'PT-30054', 'Ziegler charge pot pressure', UNIT, 'barg', 0, 14, () => P.zgPot.p, [{ param: 'HI_ALM', limit: 12.5, priority: 'WARNING' }], { tau: 0.5, decimals: 1 }));
  const pt44 = plant.addModule(new AnalogInput(ctx, 'PT-30044', 'Chromium charge pot pressure', UNIT, 'barg', 0, 14, () => P.crPot.p, [{ param: 'HI_ALM', limit: 12.5, priority: 'WARNING' }], { tau: 0.5, decimals: 1 }));
  const ft80 = plant.addModule(new AnalogInput(ctx, 'FT-30080', 'Cocatalyst (TEA) flow to R-3001', UNIT, 'kg/h', 0, 20, () => tea.r1, [], { tau: 2, decimals: 1 }));
  const ft81 = plant.addModule(new AnalogInput(ctx, 'FT-30081', 'Cocatalyst (TEA) flow to R-3002', UNIT, 'kg/h', 0, 20, () => tea.r2, [], { tau: 2, decimals: 1 }));
  const ai = { lt, pt9, pt10, ft60, ft61, ft40, di60, lt52, lt43, pt54, pt44, ft80, ft81 };

  const pureEstimate = () => (ft60.pv / RHO_LIR) * calc.conc(lt.pv);

  // ---- regelaars ----
  const fic50 = plant.addModule(new Pid(ctx, 'FIC-30050', 'Pure catalyst flow setpoint (operator) – SEQ-3050C', UNIT, 'kg/h', 0, 10, () => ({ pv: pureEstimate(), status: 'GOOD' }), [
    { param: 'LO_ALM', limit: 0.3, priority: 'ADVISORY' },
  ], { kp: 0, ti: 1e9, direct: false, deadband: 0.05 }, { sp: pureSp0, out: 0, mode: 'AUTO' }));
  const fic60 = plant.addModule(new Pid(ctx, 'FIC-30060', 'Catalyst slurry flow controller → FV-30060', UNIT, 'kg/h', 0, 1200, () => ({ pv: ft60.pv, status: ft60.status }), [
    { param: 'HI_ALM', limit: 1000, priority: 'WARNING' },
  ], { kp: 0.3, ti: 15, direct: false, deadband: 5 }, { sp: slurry0, out: 18.6, mode: 'CAS' }));
  fic60.casSpProvider = () => (fic50.sp / Math.max(calc.conc(lt.pv), 0.3)) * RHO_LIR; // SEQ-3050C: slurryflow = zuiver flow / concentratie × dichtheid
  const fic40 = plant.addModule(new Pid(ctx, 'FIC-30040', 'Isobutane flush flow controller → FV-30040 (sequence)', UNIT, 'kg/h', 0, 5500, () => ({ pv: ft40.pv, status: ft40.status }), [],
    { kp: 0.5, ti: 6, direct: false, deadband: 10 }, { sp: 0, out: 0, mode: 'MAN' }));
  const fic61 = plant.addModule(new Pid(ctx, 'FIC-30061', 'LIR dilution flow controller → FV-30061', UNIT, 'kg/h', 0, 2000, () => ({ pv: ft61.pv, status: ft61.status }), [],
    { kp: 0.3, ti: 15, direct: false, deadband: 10 }, { sp: 900, out: 79, mode: 'AUTO' }));
  const pic60 = plant.addModule(new Pid(ctx, 'PIC-30060', 'V-3009 pressure controller (split range N2 / vent)', UNIT, 'barg', 0, 10, () => ({ pv: pt9.pv, status: pt9.status }), [],
    { kp: 2, ti: 30, direct: false, deadband: 0.05 }, { sp: 6.5, out: 50, mode: 'AUTO' }));
  const pic10 = plant.addModule(new Pid(ctx, 'PIC-30010', 'V-3010 pressure controller → pump speed', UNIT, 'barg', 0, 10, () => ({ pv: pt10.pv, status: pt10.status }), [],
    { kp: 1, ti: 20, direct: true, deadband: 0.05 }, { sp: 6.0, out: 84.4, mode: 'AUTO' }));
  const fic80 = plant.addModule(new Pid(ctx, 'FIC-30080', 'TEA flow controller R-3001', UNIT, 'kg/h', 0, 20, () => ({ pv: ft80.pv, status: ft80.status }), [], { kp: 0.5, ti: 20, direct: false, deadband: 0.1 }, { sp: 5.1, out: 17, mode: 'AUTO' }));
  const fic81 = plant.addModule(new Pid(ctx, 'FIC-30081', 'TEA flow controller R-3002', UNIT, 'kg/h', 0, 20, () => ({ pv: ft81.pv, status: ft81.status }), [], { kp: 0.5, ti: 20, direct: false, deadband: 0.1 }, { sp: 0, out: 0, mode: 'MAN' }));

  // ---- sequences SEQ-3050A (Cr) / SEQ-3050B (Zg) ----
  const now = () => plant.clock.elapsed;
  let tMark = 0;
  let ramp: number | null = null; // flush-setpoint rampdoel
  const allPotTags: string[] = [...Object.values(POT_TAGS.ZG), ...Object.values(POT_TAGS.CR)].filter(Boolean);
  const cmd = (tag: string, v: 0 | 1) => dc[tag].casCommand(v);
  const hold = (tag: string, want: 0 | 1): string | null => (dc[tag].blocking.length > 0 && dc[tag].pv !== want && want === 1 ? `${tag} interlocked: ${dc[tag].blocking[0]?.text ?? ''}` : null);
  const mv = (label: string, tag: string, v: 0 | 1, extra?: () => void): EmStep => ({
    label, enter: () => { cmd(tag, v); extra?.(); }, done: () => dc[tag].pv === v,
    fail: () => hold(tag, v) ?? (dc[tag].failActive ? `${tag} valve failure (${dc[tag].failText})` : null), maxTime: 30,
  });
  const wait = (label: string, secs: () => number): EmStep => ({ label, enter: () => { tMark = now(); }, done: () => now() - tMark >= secs(), maxTime: 1e6 });
  const flushMan = (pct: number) => { ramp = null; fic40.setMode('MAN'); fic40.out = pct; };
  const steps = (t: CataType): EmStep[] => {
    const T = POT_TAGS[t];
    const other = POT_TAGS[t === 'ZG' ? 'CR' : 'ZG'];
    const pot = t === 'ZG' ? P.zgPot : P.crPot;
    const pt = t === 'ZG' ? pt54 : pt44;
    const mine = [T.day, T.top, T.n2, T.vent, T.out, T.bot].filter(Boolean);
    const s: EmStep[] = [
      { label: `WAIT – V-3009 level ≤ ${par.levelStart} % and CAT_SEL = ${t === 'ZG' ? 'Ziegler' : 'Chromium'}`, done: () => lt.pv <= par.levelStart && isZg() === (t === 'ZG'), maxTime: 1e9 },
      { label: 'INITIALISATION – close all pot valves (incl. other line outlet), lock CAT_SEL', enter: () => { [...mine, other.out].forEach((v) => cmd(v, 0)); alPvent = false; }, done: () => { const ok = [...mine, other.out].every((v) => dc[v].pv === 0); if (ok) locked = true; return ok; }, maxTime: 40 },
      mv('N2 FLUSH – open N2 inlet', T.n2, 1),
      mv('N2 FLUSH – open bottom vent', T.vent, 1),
      wait('N2 FLUSH – vent time t_vent', () => par.tVent),
      mv('N2 FLUSH – close N2 inlet', T.n2, 0),
      {
        label: `N2 FLUSH – wait for pot pressure < ${par.pVent} barg`, enter: () => { tMark = now(); },
        done: () => pot.p < par.pVent, fail: () => { if (now() - tMark > par.toPvent) { alPvent = true; return 'Al_Pvent: charge pot not depressurised within to_Pvent – sequence HELD'; } return null; }, maxTime: 1e6,
      },
      mv('N2 FLUSH – close bottom vent', T.vent, 0),
      mv('CATALYST FILL – open day tank outlet', T.day, 1),
      wait('CATALYST FILL – t_fill', () => par.tFill[t]),
      mv('CATALYST FILL – close day tank outlet', T.day, 0),
    ];
    if (t === 'CR') {
      s.push(
        mv(`WET – FV-30040 to ${par.xOpen} % (MAN), open bottom LIR inlet`, T.bot, 1, () => flushMan(par.xOpen)),
        {
          label: `WET – pot pressure > ${par.pWet} barg for t_wet (soak), timeout to_wet`, enter: () => { tMark = now(); wetStart = now(); wetSkip = false; ui.prompt = null; },
          done: () => {
            if (wetSkip) return true;
            if (pot.p <= par.pWet) tMark = now();
            if (now() - tMark >= par.tWet) return true;
            if (!ui.prompt && now() - wetStart >= par.toWet && pot.p <= par.pWet) {
              ui.prompt = 'Problem pressurizing the Charge Pot. Operator to HOLD or continue the sequence, or give extra time for the wet step.';
            }
            return false;
          },
          fail: () => null, maxTime: 1e9,
        },
        mv('WET – close bottom LIR inlet', T.bot, 0),
      );
    }
    s.push(
      mv(`TRANSFER – FV-30040 to ${par.xOpen} % (MAN), open top LIR inlet`, T.top, 1, () => flushMan(par.xOpen)),
      wait('TRANSFER – t_topvlvopen', () => par.tTop),
      mv('TRANSFER – open pot outlet', T.out, 1),
      wait('TRANSFER – t_outvlvopen', () => par.tOut),
      {
        label: `TRANSFER – FIC-30040 AUTO, ramp to ${par.flushSp} kg/h; update concentration (SEQ-3050C)`,
        enter: () => { fic40.setMode('AUTO'); ramp = par.flushSp; calc.requestTransfer(t); },
        done: () => calc.concCalcFlag, maxTime: 120,
      },
      {
        label: `DILUTE – until conc ≤ SP, level ≥ ${par.levelMax} %, LAHH or t_dilute`, enter: () => { calc.concCalcFlag = false; tMark = now(); },
        done: () => calc.conc(lt.pv) <= calc.concSp || lt.pv >= par.levelMax || lt.pv >= 95 || now() - tMark >= par.tDilute, maxTime: par.tDilute + 60,
      },
      mv('FINAL FLUSH – close top LIR inlet, FIC-30040 MAN closed', T.top, 0, () => flushMan(0)),
      mv('FINAL FLUSH – open N2 inlet', T.n2, 1),
      wait('FINAL FLUSH – t_N2finalflush1', () => par.tN2a),
      mv('FINAL FLUSH – close pot outlet', T.out, 0),
      wait('FINAL FLUSH – t_N2finalflush2', () => par.tN2b),
      mv('FINAL FLUSH – close N2 inlet', T.n2, 0),
    );
    return s;
  };
  const CMD_CR = 'SEQ-3050A (Cr)';
  const CMD_ZG = 'SEQ-3050B (Zg)';
  const closeAll = () => { ramp = null; flushMan(0); allPotTags.forEach((v) => cmd(v, 0)); };
  const seq = plant.addModule(new EquipmentModule(ctx, 'SEQ-3050', 'Catalyst transfer SEQ-3050A (Cr) / SEQ-3050B (Zg) – concentration calc SEQ-3050C', UNIT, {
    [CMD_ZG]: steps('ZG'),
    [CMD_CR]: steps('CR'),
    ABORT: [{ label: 'ABORT – close all charge pot valves', enter: closeAll, done: () => allPotTags.every((v) => dc[v].pv === 0), maxTime: 40 }],
  }));
  seq.maxTime = 1e9;
  seq.state = 'Complete'; seq.target = 'ABORT'; seq.pv = 'ABORT';
  const startSeq = (c: string): boolean => {
    const r = seq.run(c);
    if (r.ok) { repeat.on = true; repeat.cmd = c; alPvent = false; ui.prompt = null; }
    return r.ok;
  };
  const cleanup = (): void => { closeAll(); locked = false; ui.prompt = null; };
  const stopSeq = (): void => {
    repeat.on = false;
    // in de WACHT-stap (of na een voltooide cyclus) stopt de sequentie onmiddellijk, anders pas aan het einde van de cyclus
    if (seq.state === 'Running' && seq.stepIndex === 0) { seq.state = 'Idle'; cleanup(); }
    else if (seq.state !== 'Running') cleanup();
  };
  const abortSeq = (): void => {
    repeat.on = false;
    seq.state = 'Idle'; seq.error = 0; seq.errorText = '';
    alPvent = false; cleanup();
    seq.run('ABORT');
  };
  seq.onFail = () => { closeAll(); }; // HOLD: alle kleppen dicht, timers stoppen (herstart start de stap opnieuw)
  const holdSeq = (): void => { seq.hold('Operator HOLD'); };
  const restartStep = (): boolean => { alPvent = false; return seq.restartStep().ok; };
  const answerWet = (opt: 'HOLD' | 'CONTINUE' | 'EXTRA', extraMin = 5): void => {
    if (!ui.prompt) return;
    if (opt === 'HOLD') { ui.prompt = null; seq.hold('Wet step: operator HOLD'); }
    else if (opt === 'CONTINUE') { wetSkip = true; ui.prompt = null; }
    else { par.toWet += extraMin * 60; ui.prompt = null; }
  };
  const alPventDef = { module: 'SEQ-3050', param: 'AL_PVENT', description: 'Al_Pvent: charge pot not depressurised', unit: UNIT, area: ctx.area, node: ctx.node, type: 'DEVICE' as const, priority: 'WARNING' as const };
  plant.onPost(() => {
    ctx.alarms.set(alPventDef, alPvent, 'Charge pot not depressurised within to_Pvent', null);
    if (seq.state === 'Complete' && seq.target === repeat.cmd) {
      // einde van een cyclus: RUN → wacht-stap, STOP → kleppen dicht + CAT_SEL ontgrendelen
      if (repeat.on) seq.run(repeat.cmd); else { cleanup(); seq.target = 'ABORT'; }
    }
  });

  const pumpEm = (tag: 'P-3008A' | 'P-3008B') => plant.addModule(new EquipmentModule(ctx, `EM_${tag.replace('-', '')}`, `Pump ${tag} startup / shutdown`, UNIT, {
    STARTUP: [
      { label: 'Open feed block valve XV-30061', enter: () => dc['XV-30061'].casCommand(1), done: () => dc['XV-30061'].pv === 1, fail: () => (dc['XV-30061'].interlocked ? 'XV-30061 interlocked' : null), maxTime: 30 },
      { label: `Start ${tag}`, enter: () => dc[tag].casCommand(1), done: () => dc[tag].pv === 1, fail: () => (dc[tag].interlocked ? `${tag} interlocked: ${dc[tag].blocking[0]?.text ?? ''}` : null), maxTime: 20 },
      { label: 'PIC-30010 to AUTO (pump speed controls V-3010 pressure)', enter: () => pic10.setMode('AUTO'), done: () => pic10.actual === 'AUTO', maxTime: 10 },
    ],
    SHUTDOWN: [
      { label: 'FIC-30060 to MAN, FV-30060 closed', enter: () => { fic60.setMode('MAN'); fic60.out = 0; }, done: () => fic60.out < 1, maxTime: 20 },
      { label: `Stop ${tag}`, enter: () => dc[tag].casCommand(0), done: () => dc[tag].pv === 0, maxTime: 20 },
    ],
  }));
  const emA = pumpEm('P-3008A');
  const emB = pumpEm('P-3008B');
  emB.state = 'Complete'; emB.target = 'STARTUP'; emB.pv = 'STARTUP';
  emA.state = 'Complete'; emA.target = 'SHUTDOWN'; emA.pv = 'SHUTDOWN';

  // ---- procesbekabeling ----
  const pos = (t: string) => dc[t].position;
  const pv = (k: 'ZG' | 'CR'): PotValves => {
    const T = POT_TAGS[k];
    return { day: pos(T.day), top: pos(T.top), n2: pos(T.n2), vent: pos(T.vent), out: pos(T.out), bot: T.bot ? pos(T.bot) : 0 };
  };
  plant.onPre(() => { if (ce.manual.has('I-3002')) rx.forEach((r) => (r.killed = true)); });
  plant.onPre((dt) => {
    // C&E: FMC = force manual closed
    if (ce.effectActive('FMC FIC-30061')) { fic61.target = 'MAN'; fic61.out = 0; }
    const flushBlocked = ce.effectActive(FLUSH_EFF);
    if (flushBlocked) { ramp = null; fic40.target = 'MAN'; fic40.out = 0; }
    if (ramp !== null && fic40.actual === 'AUTO') fic40.sp = Math.min(ramp, fic40.sp + par.flushRamp * dt);
    const run = Math.max(pos('P-3008A'), pos('P-3008B'));
    P.update(dt, {
      zg: pv('ZG'), cr: pv('CR'), fvFlush: fic40.out / 100, flushBlocked, xvDump: pos('XV-30057'),
      fvSlurry: fic60.out / 100, fvLir: fic61.out / 100, xvLir: pos('XV-30062'), agitZ: pos('M-3002'),
      xvR1: pos('XV-30061'), xvR2: pos('XV-30063'), pumpRun: run > 0.98 ? 1 : 0, pumpSpeed: pic10.out,
      n2: Math.max(0, (pic60.out - 50) / 50), vent: Math.max(0, (50 - pic60.out) / 50), agit: pos('M-3003'),
      esdCloseFv: ce.effectActive('close FV-30060'),
    });
    calc.update(dt, lt.pv, ft60.pv);
    const k = 1 - Math.exp(-dt / 6);
    tea.r1 += (pos('XV-30061') > 0.5 ? fic80.out * 0.3 - tea.r1 : -tea.r1) * k;
    tea.r2 += (pos('XV-30063') > 0.5 ? fic81.out * 0.3 - tea.r2 : -tea.r2) * k;
  });

  plant.units.push({
    tag: UNIT, description: 'Catalyst feed (V-3005/V-3007 → charge pot → V-3009 → V-3010 → P-3008A/B)', area: ctx.area,
    modules: [...Object.keys(dc), ...Object.keys(ai).map((k) => (ai as Record<string, AnalogInput>)[k].tag), 'FIC-30050', 'FIC-30060', 'FIC-30061', 'PIC-30060', 'PIC-30010', 'FIC-30080', 'FIC-30081', 'FIC-30040', 'SEQ-3050', 'EM_P3008A', 'EM_P3008B'],
  });
  plant.addNode({ name: 'CTLR1', type: 'Controller', primaryOk: true, secondaryOk: true });
  plant.addNode({ name: 'OPS1', type: 'Workstation', primaryOk: true, secondaryOk: true });

  const H = plant.historian;
  const reg = (module: string, path: string, label: string, eu: string, lo: number, hi: number, get: () => number) => H.register({ module, path, label, eu, lo, hi, get });
  reg('LT-30060', 'LT-30060/AI1/OUT.CV', 'PV', '%', 0, 100, () => lt.pv);
  reg('PT-30060', 'PT-30060/AI1/OUT.CV', 'PV', 'barg', 0, 10, () => pt9.pv);
  reg('PT-30010', 'PT-30010/AI1/OUT.CV', 'PV', 'barg', 0, 10, () => pt10.pv);
  reg('FT-30060', 'FT-30060/AI1/OUT.CV', 'PV', 'kg/h', 0, 1200, () => ft60.pv);
  reg('FT-30040', 'FT-30040/AI1/OUT.CV', 'PV', 'kg/h', 0, 5500, () => ft40.pv);
  reg('PT-30044', 'PT-30044/AI1/OUT.CV', 'PV', 'barg', 0, 14, () => pt44.pv);
  reg('PT-30054', 'PT-30054/AI1/OUT.CV', 'PV', 'barg', 0, 14, () => pt54.pv);
  reg('DI-30060', 'DI-30060/AI1/OUT.CV', 'PV', 'kg/m³', 0, 40, () => di60.pv);
  for (const p of [fic50, fic60, fic40, pic10, pic60]) {
    reg(p.tag, `${p.tag}/PID1/PV.CV`, 'PV', p.eu, p.lo, p.hi, () => p.pv);
    reg(p.tag, `${p.tag}/PID1/SP.CV`, 'SP', p.eu, p.lo, p.hi, () => p.sp);
    reg(p.tag, `${p.tag}/PID1/OUT.CV`, 'OUT', '%', 0, 100, () => p.out);
  }
  const { rx } = addStaticSections(plant, dc, { tea1: ft80, tea2: ft81 });
  // inschakel-transiënt van de AI-filters uitlopen zodat de simulator in stationaire toestand start
  for (let i = 0; i < 240; i++) plant.tick(0.5);
  plant.alarms.alarms.clear();
  plant.journal.records.length = 0;
  plant.historian.sample(plant.clock.now());
  return { plant, rx, process: P, calc, ce, dc, seq, par, repeat, tea, ui, startSeq, stopSeq, abortSeq, holdSeq, restartStep, answerWet, pureEstimate };
}
