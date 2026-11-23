import type { SimClock } from './clock';

/** Eén record in het Event Journal (module 8: Event Journal Fields). */
export interface JournalRecord {
  seq: number;
  time: number;
  type: string; // ALARM | CHANGE | EVENT
  category: string; // PROCESS | DEVICE | HARDWARE | USER | SYSTEM
  area: string;
  node: string;
  unit: string;
  module: string;
  moduleDesc: string;
  parameter: string;
  state: string;
  level: string;
  desc1: string; // gebruikersnaam bij user-events
  desc2: string;
}

export class Journal {
  readonly records: JournalRecord[] = [];
  private seq = 0;
  constructor(private clock: SimClock) {}

  add(r: Partial<JournalRecord> & { type: string }): JournalRecord {
    const rec: JournalRecord = {
      seq: ++this.seq,
      time: this.clock.now(),
      category: '',
      area: '',
      node: '',
      unit: '',
      module: '',
      moduleDesc: '',
      parameter: '',
      state: '',
      level: '',
      desc1: '',
      desc2: '',
      ...r,
    };
    this.records.push(rec);
    if (this.records.length > 20000) this.records.splice(0, 2000);
    return rec;
  }
}
