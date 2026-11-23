import { fmtDateTime, fmtTime } from '../sim/clock';
import { getHelp, saveHelp, type AlarmHelp } from '../scenarios/alarmHelp';
import { rankCompare, type BannerItem } from '../sim/alarms';
import type { AlarmState, AlarmType, Priority } from '../sim/types';
import type { App } from './app';
import { clear, h, showMenu, toast, type Child } from './dom';
import type { View } from './wm';

export const pClass = (p: Priority): string => 'p-' + p.toLowerCase();
export const ICON: Record<Priority, string> = { CRITICAL: '!', WARNING: '▲', ADVISORY: '◆', LOG: '•' };

export function ackSymbol(a: AlarmState): string {
  if (a.active) return a.acked ? '✓' : '';
  return a.acked ? '' : '☐';
}

export type Col = 'ack' | 'time' | 'unit' | 'module' | 'desc' | 'param' | 'help' | 'message' | 'priority';

const COL_TITLE: Record<Col, string> = {
  ack: 'Ack',
  time: 'Time In',
  unit: 'Unit',
  module: 'Module',
  desc: 'Description',
  param: 'Alarm',
  help: 'Help',
  message: 'Message',
  priority: 'Priority',
};

interface Row {
  tr: HTMLTableRowElement;
  cells: Map<Col, HTMLElement>;
  id: string;
}

/** Herbruikbare alarmtabel (faceplate, unit-faceplate, Alarm List). Updatet rijen "in place". */
export class AlarmTable implements View {
  readonly el: HTMLElement;
  selected: string | null = null;
  private body: HTMLTableSectionElement;
  private rows = new Map<string, Row>();
  private empty: HTMLTableRowElement;

  constructor(
    private app: App,
    private getList: () => AlarmState[],
    private cols: Col[],
    private opts: { empty?: string; compact?: boolean; onSelect?: (a: AlarmState | null) => void } = {},
  ) {
    this.body = h('tbody');
    this.empty = h('tr', { class: 'aempty' }, h('td', { colSpan: cols.length }, opts.empty ?? 'No active alarms'));
    const head = h('thead', null, h('tr', null, ...cols.map((c) => h('th', { class: 'c-' + c }, COL_TITLE[c]))));
    this.el = h('div', { class: 'atable' + (opts.compact ? ' compact' : '') }, h('table', null, head, this.body));
  }

  get current(): AlarmState | null {
    return this.selected ? (this.app.alarms.alarms.get(this.selected) ?? null) : null;
  }

  private makeRow(a: AlarmState): Row {
    const cells = new Map<Col, HTMLElement>();
    const tr = h('tr', { class: 'arow' });
    const row: Row = { tr, cells, id: a.id };
    for (const c of this.cols) {
      const td = h('td', { class: 'c-' + c });
      cells.set(c, td);
      tr.append(td);
    }
    cells.get('ack')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.alarms.ack(row.id);
      this.app.flag('acked');
    });
    cells.get('help')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.openAlarmHelp(row.id);
    });
    tr.addEventListener('click', () => {
      this.selected = row.id;
      this.opts.onSelect?.(this.current);
      this.refresh();
    });
    tr.addEventListener('dblclick', () => this.app.openAlarmTarget(row.id));
    tr.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.selected = row.id;
      this.refresh();
      showMenu(e.clientX, e.clientY, [
        { label: 'Acknowledge', onClick: () => this.app.alarms.ack(row.id) },
        { label: 'Open Faceplate', onClick: () => this.app.openAlarmTarget(row.id) },
        { label: 'Open Primary Control Display', onClick: () => this.app.gotoModule(this.app.alarms.alarms.get(row.id)?.def.module ?? '') },
        { label: 'Open Alarm Help', onClick: () => this.app.openAlarmHelp(row.id) },
      ]);
    });
    return row;
  }

  refresh(): void {
    const list = this.getList();
    const seen = new Set<string>();
    const order: HTMLElement[] = [];
    for (const a of list) {
      seen.add(a.id);
      let row = this.rows.get(a.id);
      if (!row) {
        row = this.makeRow(a);
        this.rows.set(a.id, row);
      }
      row.tr.className = `arow ${pClass(a.def.priority)}${a.active ? '' : ' inactive'}${a.acked ? '' : ' unack'}${this.selected === a.id ? ' sel' : ''}${this.app.alarms.isSuppressed(a) ? ' supp' : ''}`;
      for (const [c, td] of row.cells) {
        const v = this.cellText(c, a);
        if (td.textContent !== v) td.textContent = v;
      }
      order.push(row.tr);
    }
    for (const [id, r] of this.rows) {
      if (!seen.has(id)) {
        r.tr.remove();
        this.rows.delete(id);
      }
    }
    if (!list.length) {
      if (!this.empty.isConnected) this.body.append(this.empty);
      return;
    }
    this.empty.remove();
    const cur = [...this.body.children];
    if (cur.length !== order.length || cur.some((n, i) => n !== order[i])) order.forEach((n) => this.body.append(n));
  }

  private cellText(c: Col, a: AlarmState): string {
    switch (c) {
      case 'ack': return ackSymbol(a);
      case 'time': return fmtTime(a.timeIn);
      case 'unit': return a.def.unit;
      case 'module': return a.def.module;
      case 'desc': return a.def.description;
      case 'param': return a.def.param + (this.app.alarms.isSuppressed(a) ? ' (shelved)' : '');
      case 'help': return getHelp(a.id) ? '❓' : '';
      case 'message': return a.message;
      case 'priority': return a.def.priority;
    }
  }
}

// ---------------------------------------------------------------- banner
export class AlarmBanner implements View {
  readonly el: HTMLElement;
  private slots: HTMLElement[] = [];
  private items: (BannerItem | null)[] = [];
  private ackBtn: HTMLButtonElement;
  private silenceBtn: HTMLButtonElement;
  private hornBtn: HTMLButtonElement;
  private flagsEl: HTMLElement;
  private nodeBox: HTMLElement;
  private commA: HTMLElement;
  private commB: HTMLElement;
  private more: HTMLElement;
  private toggles: Record<'help' | 'faceplate' | 'primary', HTMLButtonElement>;

  constructor(private app: App) {
    this.ackBtn = h('button', { class: 'bbtn', title: 'Acknowledge All Alarms', onclick: () => { app.alarms.ackAllVisible(); app.flag('acked'); } }, 'ACK ALL');
    this.silenceBtn = h('button', { class: 'bbtn', title: 'Silence Horn', onclick: () => { app.alarms.hornSilenced = true; app.flag('horn-silenced'); } }, 'SILENCE');
    this.hornBtn = h('button', { class: 'bbtn', title: 'Enable / Disable Horn', onclick: () => { app.alarms.hornEnabled = !app.alarms.hornEnabled; } }, 'HORN ON');
    this.flagsEl = h('span', { class: 'bflags', title: 'Alarms suppressed / areas filtered' });
    const mk = (k: 'help' | 'faceplate' | 'primary', label: string, title: string) =>
      h('button', { class: 'bbtn tgl', title, onclick: () => { app.directAccess[k] = !app.directAccess[k]; } }, label);
    this.toggles = {
      help: mk('help', 'Help', 'Alarm direct access to Alarm Help'),
      faceplate: mk('faceplate', 'Face', 'Alarm direct access to the Faceplate'),
      primary: mk('primary', 'Prim', 'Alarm direct access to the Primary Control display'),
    };
    for (let i = 0; i < 8; i++) {
      const slot = h('div', { class: 'slot empty' });
      slot.addEventListener('click', () => this.click(i));
      slot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const it = this.items[i];
        if (it && !it.isUnit) app.openAlarmHelp(it.top.id);
      });
      this.slots.push(slot);
    }
    this.more = h('div', { class: 'more', title: 'More alarms – open Alarm List', onclick: () => app.openAlarmList() });
    this.commA = h('span', { class: 'comm' });
    this.commB = h('span', { class: 'comm' });
    this.nodeBox = h('div', { class: 'nodebox', title: 'Hardware Node Status', onclick: () => app.openDiagnostics() }, 'CTLR1');
    this.el = h('div', { class: 'banner' },
      h('div', { class: 'bleft' }, this.ackBtn, this.silenceBtn, this.hornBtn, this.flagsEl,
        h('div', { class: 'tgls' }, this.toggles.help, this.toggles.faceplate, this.toggles.primary)),
      h('div', { class: 'slots' }, ...this.slots, this.more),
      h('div', { class: 'bright' }, this.nodeBox, h('div', { class: 'comms' }, this.commA, this.commB),
        h('button', { class: 'bbtn', onclick: () => app.openAlarmList(), title: 'Alarm List' }, 'ALARM LIST')),
    );
  }

  private click(i: number): void {
    const it = this.items[i];
    if (!it) return;
    const app = this.app;
    if (it.isUnit) return app.openUnit(it.label);
    const m = it.top.def.module;
    if (app.directAccess.help) app.openAlarmHelp(it.top.id);
    if (app.directAccess.primary) app.gotoModule(m);
    if (app.directAccess.faceplate || (!app.directAccess.help && !app.directAccess.primary)) app.openFaceplate(m);
  }

  refresh(): void {
    const al = this.app.alarms;
    const items = al.bannerItems();
    this.items = items.slice(0, 8);
    for (let i = 0; i < 8; i++) {
      const it = items[i];
      const slot = this.slots[i];
      if (!it) {
        slot.className = 'slot empty';
        slot.textContent = '';
        slot.title = '';
        continue;
      }
      const a = it.top;
      slot.className = `slot ${pClass(a.def.priority)}${a.active ? '' : ' inactive'}${a.acked ? '' : ' unack'}`;
      const txt = (it.isUnit ? '' : ICON[a.def.priority] + ' ') + it.label;
      if (slot.textContent !== txt) slot.textContent = txt;
      slot.title = it.isUnit
        ? `${it.label}: ${it.count} alarm(s) – highest ${a.def.module} ${a.def.param}`
        : `${a.def.module} ${a.def.param}\n${a.message}\nTime in ${fmtTime(a.timeIn)}\n(right-click: Alarm Help)`;
    }
    this.more.textContent = items.length > 8 ? `+${items.length - 8}` : '';
    this.hornBtn.textContent = al.hornEnabled ? 'HORN ON' : 'HORN OFF';
    this.hornBtn.classList.toggle('off', !al.hornEnabled);
    const hs = al.hornState();
    this.silenceBtn.classList.toggle('flash', hs.sounding);
    this.ackBtn.classList.toggle('flash', items.some((x) => !x.top.acked));
    for (const k of ['help', 'faceplate', 'primary'] as const) this.toggles[k].classList.toggle('on', this.app.directAccess[k]);
    const sup = al.suppressedActive();
    const areas = al.disabledAreas.size;
    this.flagsEl.textContent = (areas ? '⛔ ' : '') + (sup ? '⏸ ' : '');
    // node
    const hw = al.hardwareTop();
    const node = hw ? this.app.plant.nodes.find((n) => n.name === hw.def.node) : this.app.plant.nodes[0];
    if (node) {
      this.nodeBox.textContent = node.name;
      this.nodeBox.className = 'nodebox' + (hw ? ` ${pClass(hw.def.priority)}${hw.acked ? '' : ' unack'}` : '');
      this.commA.className = 'comm ' + (node.primaryOk ? 'ok' : 'bad');
      this.commB.className = 'comm ' + (node.secondaryOk ? 'ok' : 'bad');
      this.commA.title = 'Primary network';
      this.commB.title = 'Secondary network';
    }
  }
}

// ---------------------------------------------------------------- alarm list
interface ListState {
  prio: 'ALL' | Priority;
  type: 'ALL' | AlarmType;
  mins: number;
  area: string;
  sort: 'RANK' | 'TIME' | 'CHANGE' | 'ID';
}

export function buildAlarmList(app: App, preset: Partial<ListState> = {}): View {
  const st: ListState = { prio: 'ALL', type: 'ALL', mins: 0, area: 'ALL', sort: 'RANK', ...preset };
  const getList = (): AlarmState[] => {
    const now = app.plant.clock.now();
    const l = app.alarms.visible((a) =>
      (st.prio === 'ALL' || a.def.priority === st.prio) &&
      (st.type === 'ALL' || a.def.type === st.type) &&
      (st.area === 'ALL' || a.def.area === st.area) &&
      (!st.mins || now - a.timeIn <= st.mins * 60000));
    if (st.sort === 'TIME') l.sort((a, b) => b.timeIn - a.timeIn);
    if (st.sort === 'CHANGE') l.sort((a, b) => b.timeChange - a.timeChange);
    if (st.sort === 'ID') l.sort((a, b) => a.id.localeCompare(b.id));
    return l;
  };
  const table = new AlarmTable(app, getList, ['ack', 'time', 'unit', 'module', 'desc', 'param', 'help', 'message', 'priority']);
  const sel = <T extends string>(opts: [T, string][], get: () => T, set: (v: T) => void) => {
    const s = h('select', { onchange: () => set(s.value as T) }, ...opts.map(([v, l]) => h('option', { value: v, selected: get() === v }, l)));
    return s;
  };
  const sortBtn = (k: ListState['sort'], label: string, title: string) =>
    h('button', { class: 'tbtn', title, onclick: () => { st.sort = k; refreshBtns(); } }, label);
  const sortBtns = [sortBtn('RANK', 'Ranked', 'Sort like Alarm Banner'), sortBtn('TIME', 'By time', 'Sort by time of occurrence'),
    sortBtn('CHANGE', 'By change', 'Sort by time of last state change'), sortBtn('ID', 'By ID', 'Sort by Alarm ID')];
  const refreshBtns = () => sortBtns.forEach((b, i) => b.classList.toggle('on', ['RANK', 'TIME', 'CHANGE', 'ID'][i] === st.sort));
  refreshBtns();
  const selected = () => table.current;
  const need = (f: (a: AlarmState) => void) => () => { const a = selected(); if (a) f(a); else toast('Select an alarm first'); };
  const toolbar = h('div', { class: 'toolbar' },
    h('button', { class: 'tbtn primary', title: 'Acknowledge All Visible Alarms', onclick: () => { app.alarms.ackMany(getList().map((a) => a.id)); app.flag('acked'); } }, '✓ Ack visible'),
    h('button', { class: 'tbtn', onclick: need((a) => app.openAlarmTarget(a.id)) }, 'Faceplate'),
    h('button', { class: 'tbtn', onclick: need((a) => app.gotoModule(a.def.module)) }, 'Primary'),
    h('button', { class: 'tbtn', onclick: need((a) => app.openAlarmHelp(a.id)) }, 'Alarm Help'),
    h('button', { class: 'tbtn', title: 'Shelve selected alarm (supervisor)', onclick: (e: MouseEvent) => {
      if (!app.can('shelve')) return toast('Shelving requires Supervisor privilege', 'error');
      const a = selected();
      if (!a) return toast('Select an alarm first');
      showMenu(e.clientX, e.clientY, [10, 30, 60].map((m) => ({ label: `Shelve ${m} min`, onClick: () => app.alarms.shelve(a.id, m) })));
    } }, 'Shelve'),
    h('span', { class: 'sep' }),
    ...sortBtns,
    h('span', { class: 'sep' }),
    sel<ListState['prio']>([['ALL', 'All priorities'], ['CRITICAL', 'Critical'], ['WARNING', 'Warning'], ['ADVISORY', 'Advisory']], () => st.prio, (v) => (st.prio = v)),
    sel<ListState['type']>([['ALL', 'All types'], ['PROCESS', 'Process'], ['DEVICE', 'Device'], ['HARDWARE', 'Hardware']], () => st.type, (v) => (st.type = v)),
    sel<string>([['0', 'Any time'], ['10', 'Last 10 min'], ['90', 'Last 1.5 h'], ['1440', 'Last 24 h']], () => String(st.mins), (v) => (st.mins = Number(v))),
    sel<string>([['ALL', 'All areas'], ...app.plant.areas.map((a): [string, string] => [a, a])], () => st.area, (v) => (st.area = v)),
    h('button', { class: 'tbtn', title: 'Export Alarm Summary to XML', onclick: () => exportXml(app, getList()) }, 'Export XML'),
    h('button', { class: 'tbtn', onclick: () => app.openAreaFilter() }, 'Area filtering…'),
  );
  const el = h('div', { class: 'alarmlist' }, toolbar, table.el);
  return { el, refresh: () => table.refresh() };
}

function exportXml(app: App, list: AlarmState[]): void {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  const xml = `<?xml version="1.0"?>\n<AlarmSummary exported="${fmtDateTime(app.plant.clock.now())}">\n` +
    list.map((a) => `  <Alarm><TimeIn>${fmtDateTime(a.timeIn)}</TimeIn><Unit>${esc(a.def.unit)}</Unit><Module>${esc(a.def.module)}</Module><Alarm>${a.def.param}</Alarm><Priority>${a.def.priority}</Priority><Active>${a.active}</Active><Acknowledged>${a.acked}</Acknowledged><Message>${esc(a.message)}</Message></Alarm>`).join('\n') +
    '\n</AlarmSummary>\n';
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
  const a = h('a', { href: url, download: 'alarm-summary.xml' });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Alarm summary exported');
}

// ---------------------------------------------------------------- area filtering
export function buildAreaFilter(app: App): View {
  const tbody = h('tbody');
  let selArea = app.plant.areas[0];
  const table = new AlarmTable(app, () => [...app.alarms.alarms.values()].filter((a) => a.def.area === selArea && a.def.priority !== 'LOG').sort(rankCompare), ['ack', 'time', 'module', 'param', 'message', 'priority'], { empty: 'No alarms in this area' });
  const el = h('div', { class: 'areafilter' },
    h('table', { class: 'areas' }, h('thead', null, h('tr', null, ...['Plant area', 'Active', 'Unacked', 'Suppressed', 'Enabled'].map((t) => h('th', null, t)))), tbody),
    h('div', { class: 'toolbar' }, h('button', { class: 'tbtn', onclick: () => app.openAlarmList({ area: selArea }) }, 'Alarm List for Selected Area'),
      h('span', { class: 'hint' }, app.can('areafilter') ? '' : 'Enable/disable requires Supervisor privilege')),
    table.el);
  const refresh = () => {
    clear(tbody);
    for (const area of app.plant.areas) {
      const all = [...app.alarms.alarms.values()].filter((a) => a.def.area === area);
      const cb = h('input', { type: 'checkbox', checked: !app.alarms.disabledAreas.has(area), disabled: !app.can('areafilter'), onchange: () => {
        if (cb.checked) app.alarms.disabledAreas.delete(area);
        else app.alarms.disabledAreas.add(area);
      } });
      tbody.append(h('tr', { class: area === selArea ? 'sel' : '', onclick: () => { selArea = area; } },
        h('td', null, area), h('td', null, String(all.filter((a) => a.active).length)),
        h('td', null, String(all.filter((a) => !a.acked).length)),
        h('td', null, String(all.filter((a) => app.alarms.isSuppressed(a)).length)), h('td', null, cb)));
    }
    table.refresh();
  };
  return { el, refresh };
}

// ---------------------------------------------------------------- alarm help
export function buildAlarmHelp(app: App, id: string): View {
  const el = h('div', { class: 'helpview' });
  let editing = false;
  let lastSig = '';
  const fields: [keyof AlarmHelp, string][] = [
    ['description', 'Description'], ['probableCause', 'Probable Cause'], ['consequence', 'Consequence'],
    ['action', 'Corrective Action'], ['design', 'Design Information'], ['responseTime', 'Expected Response Time'],
  ];
  const render = () => {
    clear(el);
    const help: AlarmHelp = getHelp(id) ?? { description: '', probableCause: '', consequence: '', action: '', design: '', responseTime: '' };
    const inputs: Partial<Record<keyof AlarmHelp, HTMLTextAreaElement>> = {};
    el.append(h('div', { class: 'help-head' }, id));
    for (const [k, label] of fields) {
      el.append(h('div', { class: 'help-label' }, label));
      if (editing) {
        const ta = h('textarea', { rows: 3 });
        ta.value = help[k];
        inputs[k] = ta;
        el.append(ta);
      } else el.append(h('div', { class: 'help-text' }, help[k] || '—'));
    }
    const btns = h('div', { class: 'toolbar' });
    if (app.can('helpedit')) {
      if (!editing) btns.append(h('button', { class: 'tbtn', onclick: () => { editing = true; render(); } }, 'Modify Alarm Help'));
      else {
        btns.append(h('button', { class: 'tbtn primary', onclick: () => {
          const out = { ...help };
          for (const [k] of fields) out[k] = inputs[k]!.value;
          saveHelp(id, out);
          editing = false;
          app.flag('help-edited');
          render();
          toast('Alarm Help saved');
        } }, 'Save'), h('button', { class: 'tbtn', onclick: () => { editing = false; render(); } }, 'Cancel'));
      }
    } else btns.append(h('span', { class: 'hint' }, 'Modify requires Supervisor privilege'));
    el.append(btns);
  };
  render();
  return { el, refresh: () => { const s = String(editing); if (s !== lastSig) lastSig = s; } };
}

// ---------------------------------------------------------------- unit faceplate
export function buildUnitFaceplate(app: App, unit: string): View {
  const u = app.plant.units.find((x) => x.tag === unit);
  let sortTime = false;
  const getList = () => {
    const l = app.alarms.forUnit(unit).filter((a) => !app.alarms.isSuppressed(a));
    return sortTime ? l.sort((a, b) => b.timeIn - a.timeIn) : l;
  };
  const table = new AlarmTable(app, getList, ['ack', 'module', 'param', 'message', 'priority'], { empty: 'No alarms on this unit' });
  const need = (f: (a: AlarmState) => void) => () => { const a = table.current; if (a) f(a); else toast('Select an alarm first'); };
  const head = h('div', { class: 'fp-head' }, h('div', { class: 'fp-desc' }, u?.description ?? unit), h('div', { class: 'fp-sub' }, `Area ${u?.area ?? ''}`));
  const el = h('div', { class: 'faceplate unitfp' }, head,
    h('div', { class: 'toolbar' },
      h('button', { class: 'tbtn primary', onclick: () => app.alarms.ackMany(getList().map((a) => a.id)) }, '✓ Ack visible'),
      h('button', { class: 'tbtn', onclick: need((a) => app.openFaceplate(a.def.module)) }, 'Faceplate'),
      h('button', { class: 'tbtn', onclick: () => app.gotoModule(u?.modules[0] ?? '') }, 'Primary'),
      h('button', { class: 'tbtn', onclick: need((a) => { if (!app.can('shelve')) return toast('Shelving requires Supervisor privilege', 'error'); app.alarms.shelve(a.id, 30); }) }, 'Shelve'),
      h('button', { class: 'tbtn', onclick: () => { sortTime = !sortTime; } }, 'Sort')),
    table.el);
  return { el, refresh: () => table.refresh() };
}

// ---------------------------------------------------------------- diagnostics / node status
export function buildDiagnostics(app: App): View {
  const tbody = h('tbody');
  const el = h('div', { class: 'diag' },
    h('div', { class: 'diag-title' }, 'DeltaV Diagnostics – Hardware Node Status'),
    h('table', { class: 'areas' }, h('thead', null, h('tr', null, ...['Node', 'Type', 'Primary', 'Secondary', 'Overall connection', 'Link integrity'].map((t) => h('th', null, t)))), tbody),
    h('div', { class: 'toolbar' }, h('button', { class: 'tbtn primary', onclick: () => app.alarms.ackMany(app.alarms.visible((a) => a.def.type === 'HARDWARE').map((a) => a.id)) }, '✓ Ack hardware alarms')),
    h('div', { class: 'hint' }, 'Overall connection is bad when any connection is bad. Link integrity is bad when all connections are bad.'));
  const cell = (ok: boolean): Child => h('td', { class: ok ? 'okc' : 'badc' }, ok ? 'Good' : 'Bad');
  return {
    el,
    refresh: () => {
      clear(tbody);
      for (const n of app.plant.nodes) {
        tbody.append(h('tr', null, h('td', null, n.name), h('td', null, n.type), cell(n.primaryOk), cell(n.secondaryOk), cell(n.primaryOk && n.secondaryOk), cell(n.primaryOk || n.secondaryOk)));
      }
    },
  };
}
