/** Alarm Help-teksten (ISA-18.2 "master alarm database"-achtig). Sleutel: MODULE/PARAM */
export interface AlarmHelp {
  description: string;
  probableCause: string;
  consequence: string;
  action: string;
  design: string;
  responseTime: string;
}

export const ALARM_HELP: Record<string, AlarmHelp> = {
  'LI-101/HI_HI_ALM': {
    description: 'Tank 101 level very high (> 980 gal).',
    probableCause: 'Outlet flow lower than feed flow; pump stopped or interlocked; FIC-102 in manual with small output; feed disturbance.',
    consequence: 'Tank overflow within minutes (capacity 1000 gal) – product loss and spill.',
    action: 'Verify MTR-102 is running and XV-101 is open. Raise the outlet flow (FIC-102 SP or OUT). Inform the upstream unit operator to reduce the feed.',
    design: 'Hardwired trip level; critical priority. Tank capacity 1000 gal.',
    responseTime: '2 minutes',
  },
  'LI-101/HI_ALM': {
    description: 'Tank 101 level high (> 950 gal).',
    probableCause: 'Feed flow increased, level setpoint set too high, or outlet flow restricted.',
    consequence: 'Level may reach HI-HI and overflow if no action is taken.',
    action: 'Check LIC-101 / FIC-102 modes (cascade: LIC-101 AUTO, FIC-102 CAS). Increase outlet flow or lower the feed.',
    design: 'Warning priority. 5 gal deadband.',
    responseTime: '5 minutes',
  },
  'LI-101/LO_ALM': {
    description: 'Tank 101 level low (< 100 gal).',
    probableCause: 'Level setpoint lowered, feed flow reduced, or outlet flow too high.',
    consequence: 'Pump MTR-102 will be interlocked at 50 gal to prevent running dry.',
    action: 'Reduce outlet flow, check upstream feed, raise the LIC-101 setpoint.',
    design: 'Warning priority. 5 gal deadband.',
    responseTime: '5 minutes',
  },
  'LI-101/LO_LO_ALM': {
    description: 'Tank 101 level very low (< 50 gal).',
    probableCause: 'Prolonged high outlet flow or lost feed.',
    consequence: 'Pump MTR-102 interlock trips (dry-run protection).',
    action: 'Stop outlet flow, restore the feed and wait for level > 55 gal before restarting the pump.',
    design: 'Critical priority; same limit as the MTR-102 level interlock.',
    responseTime: '2 minutes',
  },
  'LI-101/BAD_PV': {
    description: 'Level transmitter LI-101 has bad status.',
    probableCause: 'Transmitter failure, wiring fault or I/O card problem.',
    consequence: 'LIC-101 drops to MAN; level alarms are not evaluated.',
    action: 'Control the level manually from the local gauge and call maintenance.',
    design: '4–20 mA, 0–1000 gal.',
    responseTime: '10 minutes',
  },
  'FT-102/BAD_PV': {
    description: 'Flow transmitter FT-102 has bad status.',
    probableCause: 'Transmitter failure or wiring fault.',
    consequence: 'FIC-102 changes to MAN; the cascade is broken and LIC-101 goes IMAN.',
    action: 'Operate FIC-102 manually (OUT) and watch the tank level. Call maintenance.',
    design: '4–20 mA, 0–100 GPM.',
    responseTime: '10 minutes',
  },
  'FIC-102/HI_ALM': {
    description: 'Outlet flow high (> 95 GPM).',
    probableCause: 'Setpoint too high or surge after a pump restart.',
    consequence: 'Downstream unit may be overloaded.',
    action: 'Lower the FIC-102 setpoint or check the cascade setpoint from LIC-101.',
    design: 'Advisory priority.',
    responseTime: '15 minutes',
  },
  'FIC-102/LO_ALM': {
    description: 'Outlet flow low while flow is demanded (SP ≥ 10 GPM).',
    probableCause: 'Pump stopped/tripped, block valve closed or flow control valve closed.',
    consequence: 'Tank level will rise.',
    action: 'Check MTR-102 and XV-101 status and restart the pump if permitted.',
    design: 'Advisory – state-based: only active when SP ≥ 10 GPM.',
    responseTime: '15 minutes',
  },
  'XV-101/FAIL_ALM': {
    description: 'Block valve XV-101 did not reach the commanded position in time.',
    probableCause: 'Valve stuck, no air/power, limit switch failure.',
    consequence: 'Pump permissive/interlock may block the pump.',
    action: 'Check the valve locally; call maintenance. Use the Accept check box only after local verification.',
    design: 'Confirm time 10 s.',
    responseTime: '5 minutes',
  },
  'MTR-102/FAIL_ALM': {
    description: 'Pump MTR-102 did not confirm the commanded state in time.',
    probableCause: 'Motor trip, breaker open, contactor failure.',
    consequence: 'No outlet flow; tank level rises.',
    action: 'Set the motor to STOP, check the breaker/local panel, then try a restart.',
    design: 'Confirm time 8 s.',
    responseTime: '2 minutes',
  },
  'MTR-102/INTERLOCK_ALM': {
    description: 'Pump MTR-102 stopped by an interlock.',
    probableCause: 'Block valve XV-101 not open, or Tank 101 level below 50 gal.',
    consequence: 'No outlet flow until the interlock condition clears.',
    action: 'Open the MTR-102 detail display, find the First Out condition, correct it, restart the pump and reset the first-out.',
    design: 'Two interlock conditions; bypass requires supervisor privilege.',
    responseTime: '5 minutes',
  },
  'EM_T101/CMD_FAIL': {
    description: 'Equipment module command failed.',
    probableCause: 'Step timeout or an interlock prevented a step.',
    consequence: 'Sequence stopped in an intermediate state.',
    action: 'Read the error text on the EM faceplate, correct the cause and press Restart Current Command.',
    design: 'CFM_MAX_TIME 180 s.',
    responseTime: '5 minutes',
  },
  'CTLR1/COMM': {
    description: 'Controller CTLR1 network failure.',
    probableCause: 'Cable, switch or port failure.',
    consequence: 'Loss of redundancy (one network) or loss of view (both).',
    action: 'Open DeltaV Diagnostics; inform the IT/control system engineer.',
    design: 'Redundant 100 Mbit control network.',
    responseTime: '15 minutes',
  },
  'OPS1/COMM': {
    description: 'Workstation OPS1 network failure.',
    probableCause: 'Cable, switch or port failure.',
    consequence: 'Loss of redundancy.',
    action: 'Inform IT / control system engineer.',
    design: 'Redundant control network.',
    responseTime: '15 minutes',
  },
};

const KEY = 'ots.alarmhelp.v1';
export function getHelp(id: string): AlarmHelp | null {
  let ov: Record<string, AlarmHelp> = {};
  try {
    ov = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    /* ignore */
  }
  return ov[id] ?? ALARM_HELP[id] ?? null;
}
export function saveHelp(id: string, help: AlarmHelp): void {
  let ov: Record<string, AlarmHelp> = {};
  try {
    ov = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    /* ignore */
  }
  ov[id] = help;
  try {
    localStorage.setItem(KEY, JSON.stringify(ov));
  } catch {
    /* ignore */
  }
}
