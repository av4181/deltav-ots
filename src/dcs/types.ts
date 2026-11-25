// Gedeelde types voor de simulatiekern.

export type Priority = 'CRITICAL' | 'WARNING' | 'ADVISORY' | 'LOG';
export const PRIORITY_RANK: Record<Priority, number> = { CRITICAL: 3, WARNING: 2, ADVISORY: 1, LOG: 0 };
export const PRIORITY_LEVEL: Record<Priority, string> = {
  CRITICAL: '15-CRITICAL',
  WARNING: '10-WARNING',
  ADVISORY: '5-ADVISORY',
  LOG: '1-LOG',
};

export type AlarmType = 'PROCESS' | 'DEVICE' | 'HARDWARE';
export type Status = 'GOOD' | 'BAD';
/** Regelmodi zoals in DeltaV (module 10 + 12) */
export type Mode = 'OOS' | 'IMAN' | 'MAN' | 'AUTO' | 'CAS';
export type Kind = 'AI' | 'DC' | 'PID' | 'EM';

export interface AlarmDef {
  module: string;
  param: string;
  description: string;
  unit: string;
  area: string;
  node: string;
  type: AlarmType;
  priority: Priority;
}

export interface AlarmState {
  id: string;
  def: AlarmDef;
  active: boolean;
  acked: boolean;
  timeIn: number;
  timeChange: number;
  seq: number;
  message: string;
  value: number | null;
  shelvedUntil: number | null;
}

export interface SimModule {
  readonly kind: Kind;
  readonly tag: string;
  description: string;
  unit: string;
  update(dt: number): void;
}

export interface WriteResult {
  ok: boolean;
  reason?: string;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
