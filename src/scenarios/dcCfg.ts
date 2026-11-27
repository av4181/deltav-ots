import type { DiscreteCfg } from '../dcs/discrete';

export const VALVE_CFG: DiscreteCfg = {
  spNames: ['CLOSE', 'OPEN'],
  pvNames: ['CLOSED', 'OPEN'],
  states: { off: 'Closed', on: 'Open', turningOn: 'Opening', turningOff: 'Closing' },
  transitTime: 4,
  timeLimit: 10,
  abnormal: 0,
  failWord: ['Close Confirm Lost', 'Open Confirm Lost'],
};
export const MOTOR_CFG: DiscreteCfg = {
  spNames: ['STOP', 'START'],
  pvNames: ['STOPPED', 'RUNNING'],
  states: { off: 'Stopped', on: 'Running', turningOn: 'Starting', turningOff: 'Stopping' },
  transitTime: 3,
  timeLimit: 8,
  abnormal: 0,
  failWord: ['Stop Confirm Lost', 'Run Confirm Lost'],
};
export const SELECTOR_CFG: DiscreteCfg = {
  spNames: ['CHROMIUM', 'ZIEGLER'],
  pvNames: ['CHROMIUM', 'ZIEGLER'],
  states: { off: 'Chromium', on: 'Ziegler', turningOn: 'To Ziegler', turningOff: 'To Chromium' },
  transitTime: 1,
  timeLimit: 5,
  abnormal: 0,
  failWord: ['Chromium Confirm Lost', 'Ziegler Confirm Lost'],
};
