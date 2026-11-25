import { CREDENTIALS } from '../config';
import { ScenarioEngine } from '../scenarios/engine';
import { buildTank101, type InitState, type Tank101 } from '../scenarios/tank101';
import { fmtTime } from '../dcs/clock';
import { AlarmBanner, buildAlarmHelp, buildAlarmList, buildAreaFilter, buildDiagnostics, buildUnitFaceplate } from './alarmUi';
import { clear, fmt, h, makeStage, s, showMenu, toast } from './dom';
import { buildFaceplate, buildMotorDetail } from './faceplates';
import { DISPLAYS, type DisplayInstance } from './displays';
import type { Gem } from './gems';
import { Horn } from './horn';
import { buildScenarioPanel } from './scenarioPanel';
import { SCENARIOS } from '../scenarios/library';
import { buildPhv } from './trend';
import { WindowManager } from './wm';

export type Role = 'OPERATOR' | 'SUPERVISOR' | 'INSTRUCTOR';
export type Privilege = 'shelve' | 'areafilter' | 'helpedit' | 'bypass';

export class App {
  readonly root: HTMLElement;
  t!: Tank101;
  role: Role = 'OPERATOR';
  speed = 1;
  paused = false;
  scenario: ScenarioEngine | null = null;
  readonly flags = new Set<string>();
  readonly directAccess = { help: false, faceplate: true, primary: true };

  private wm = new WindowManager();
  private banner!: AlarmBanner;
  private horn = new Horn();
  private gems: Gem[] = [];
  private watchTags = new Set<string>(['LI-101', 'FIC-102']);

  private clockEl!: HTMLElement;
  private rollupEl!: HTMLElement;
  private watchBody!: HTMLElement;
  private instructorDrawer!: HTMLElement;
  private instructorBtn?: HTMLElement;
  private graphic: DisplayInstance | null = null;
  private graphicHost!: HTMLElement;
  private workspaceEl!: HTMLElement;
  private watchBox!: HTMLElement;
  private mainSel!: HTMLSelectElement;
  private userEl!: HTMLElement;
  private dvClockEl!: HTMLElement;
  private stripTitleEl!: HTMLElement;
  private stripRevEl!: HTMLElement;
  private navBtns = new Map<string, HTMLElement>();
  displayId = DISPLAYS[0].id;
  private navHistory: string[] = [];
  private navPos = 0;
  private timer: number | null = null;

  constructor(container: HTMLElement) {
    this.root = container;
    this.loadScenario('RUNNING');
    this.startLoop();
  }

  get plant() { return this.t.plant; }
  get alarms() { return this.t.plant.alarms; }

  /** Supervisor en instructeur hebben de extra privileges (shelving, bypass, area filtering, help bewerken). */
  can(_p: Privilege): boolean {
    return this.role !== 'OPERATOR';
  }

  get isInstructor(): boolean {
    return this.role === 'INSTRUCTOR';
  }

  /** Instructeursactie in het Event Journal vastleggen (zoals elke andere gebruikersactie). */
  logInstructor(param: string, value: string | number | boolean): void {
    this.plant.journal.add({
      type: 'CHANGE',
      category: 'INSTRUCTOR',
      area: this.plant.ctx.area,
      node: this.plant.ctx.node,
      unit: 'TANK101',
      module: 'INSTRUCTOR',
      moduleDesc: 'Instructor station',
      parameter: param,
      state: String(value),
      desc1: this.role,
    });
  }

  private setRole(role: Role): boolean {
    if (role !== 'OPERATOR') {
      const pw = window.prompt(`DeltaV logon – password for ${role}:`);
      if (pw !== CREDENTIALS[role]) {
        toast('Logon failed', 'error');
        return false;
      }
    }
    const old = this.role;
    this.role = role;
    this.plant.user = role;
    this.plant.journal.add({ type: 'EVENT', category: 'USER', area: this.plant.ctx.area, node: this.plant.ctx.node, module: 'LOGON', moduleDesc: 'User logon', parameter: 'ROLE', state: role, desc1: role, desc2: `was ${old}` });
    this.instructorBtn?.classList.toggle('hidden', !this.isInstructor);
    if (!this.isInstructor) this.instructorDrawer?.classList.remove('open');
    toast(`Logged on as ${role}`);
    return true;
  }

  flag(name: string): void {
    this.flags.add(name);
  }

  /** Training-scenario (tijdlijn, verwachte acties, score) starten. */
  startScenario(id: string): void {
    const def = SCENARIOS.find((d) => d.id === id);
    if (!def) return;
    this.wm.closeAll();
    this.flags.clear();
    this.scenario = new ScenarioEngine(def);
    this.t = this.scenario.t;
    this.plant.user = this.role;
    this.renderShell();
    this.refresh();
    this.openScenarioPanel();
  }

  stopScenario(): void {
    this.wm.close('scenario');
    this.scenario = null;
    this.loadScenario('RUNNING');
  }

  openScenarioPanel(): void {
    this.wm.open({ key: 'scenario', title: 'Training scenario', view: buildScenarioPanel(this), w: 520 });
  }

  loadScenario(init: InitState): void {
    this.scenario = null;
    this.wm.closeAll();
    this.flags.clear();
    this.t = buildTank101(init);
    this.plant.user = this.role;
    this.renderShell();
    this.refresh();
  }

  private renderShell(): void {
    clear(this.root);
    this.gems = [];
    this.graphic?.dispose?.();
    this.graphic = null;

    // ---- OTS-besturing (simulatorfuncties, niet onderdeel van DeltaV zelf) ----
    const roleSel = h(
      'select',
      { class: 'ots-sel', title: 'Role', onchange: () => { if (!this.setRole(roleSel.value as Role)) roleSel.value = this.role; } },
      ...(['OPERATOR', 'SUPERVISOR', 'INSTRUCTOR'] as const).map((r) => h('option', { value: r, selected: this.role === r }, r)),
    );
    const speedSel = h(
      'select',
      { class: 'ots-sel', title: 'Simulation speed', onchange: () => { this.speed = Number(speedSel.value); } },
      ...[1, 2, 5, 10].map((x) => h('option', { value: String(x), selected: this.speed === x }, `${x}x`)),
    );
    const pauseBtn = h('button', {
      class: 'ots-btn',
      onclick: () => {
        this.paused = !this.paused;
        pauseBtn.textContent = this.paused ? '▶ Resume' : '⏸ Pause';
      },
    }, this.paused ? '▶ Resume' : '⏸ Pause');
    this.clockEl = h('span', { class: 'ots-clock', title: 'Simulation time' });
    this.instructorBtn = h('button', {
      class: 'ots-btn accent' + (this.isInstructor ? '' : ' hidden'),
      onclick: () => this.instructorDrawer.classList.toggle('open'),
    }, '⚙ Instructor');
    const titleBar = h('div', { class: 'dv-title' },
      h('span', { class: 'dv-logo' }, 'Δ'),
      h('span', { class: 'dv-title-text' }, 'DeltaV Live – Operate (Run)'),
      h('div', { class: 'ots-ctl' },
        h('span', { class: 'ots-lbl' }, 'OTS'),
        h('button', { class: 'ots-btn', onclick: () => this.loadScenario('RUNNING') }, 'Reset: Running'),
        h('button', { class: 'ots-btn', onclick: () => this.loadScenario('COLD') }, 'Reset: Cold start'),
        h('button', { class: 'ots-btn', onclick: () => this.openScenarioPanel() }, 'Scenarios'),
        this.instructorBtn, roleSel, speedSel, pauseBtn, this.clockEl),
    );

    // ---- Module / Main / Username / klok ----
    const moduleSel = h(
      'select',
      { class: 'dv-combo', title: 'Module – selecteer om het faceplate te openen', onchange: () => { if (moduleSel.value) this.openFaceplate(moduleSel.value); moduleSel.selectedIndex = 0; } },
      h('option', { value: '' }, this.plant.units[0]?.tag ?? 'TANK101'),
      ...this.plant.units[0].modules.map((m) => h('option', { value: m }, m)),
    );
    this.mainSel = h(
      'select',
      { class: 'dv-combo wide', title: 'Main – huidig display', onchange: () => this.showDisplay(this.mainSel.value) },
      ...DISPLAYS.map((d) => h('option', { value: d.id, selected: d.id === this.displayId }, d.id)),
    );
    this.userEl = h('div', { class: 'dv-field user' }, this.role);
    this.dvClockEl = h('div', { class: 'dv-field clock' });
    const row1 = h('div', { class: 'dv-row' },
      h('span', { class: 'dv-lbl' }, 'Module'), moduleSel,
      h('span', { class: 'dv-lbl main' }, 'Main'), this.mainSel,
      h('span', { class: 'dv-lbl user' }, 'Username'), this.userEl,
      this.dvClockEl);

    // ---- Toolbar ----
    const tb = (glyph: string, title: string, onclick: () => void, extra = '') => h('button', { class: 'dv-btn tool ' + extra, title, onclick }, glyph);
    const toolbar = h('div', { class: 'dv-toolbar' },
      tb('◀', 'Previous display', () => this.navBack()),
      tb('⎙', 'Print display (not available in the OTS)', () => toast('Printing is not available in the OTS')),
      h('span', { class: 'tsep' }),
      tb('▤', 'Alarm List Summary', () => this.openAlarmList()),
      tb('⚑', 'Unit alarms – TANK101', () => this.openUnit('TANK101')),
      tb('⛔', 'Area alarm filtering', () => this.openAreaFilter()),
      h('span', { class: 'tsep' }),
      tb('📈', 'Process History View', () => this.openPhv()),
      tb('☰', 'Event Journal (History / Journal)', () => this.openPhv()),
      tb('⚙', 'EM_T101 faceplate', () => this.openFaceplate('EM_T101')),
      h('span', { class: 'tsep' }),
      tb('🖧', 'DeltaV Diagnostics', () => this.openDiagnostics()),
      tb('👁', 'Watch Area on/off', () => this.watchBox.classList.toggle('hidden')),
      tb('?', 'Help', () => toast('Operator help: click a GEM for its faceplate, right-click for the menu.')),
    );

    // ---- Titelstrook ----
    this.rollupEl = h('div', { class: 'dv-strip-id' });
    this.stripTitleEl = h('div', { class: 'dv-strip-title' });
    this.stripRevEl = h('div', { class: 'dv-strip-rev' });
    const sbtn = (t: string, title: string, onclick?: () => void, off = false) => h('button', { class: 'dv-btn strip' + (off ? ' off' : ''), title, onclick: off ? undefined : onclick, disabled: off }, t);
    const strip = h('div', { class: 'dv-strip' },
      this.rollupEl, this.stripRevEl, this.stripTitleEl,
      h('div', { class: 'dv-strip-btns' },
        sbtn('T', 'Trend of this display', () => this.openPhv()),
        sbtn('ESD', 'ESD – not configured for this display', undefined, true),
        sbtn('E.U', 'Show / hide engineering units', () => this.workspaceEl.classList.toggle('no-eu')),
        sbtn('◁', 'Back', () => this.navBack()),
        sbtn('△', 'Top-level display', () => this.showDisplay(DISPLAYS[0].id)),
        sbtn('▽', 'Next display', () => this.navNext()),
        sbtn('▷', 'Forward', () => this.navForward())),
    );

    // ---- Werkgebied ----
    this.watchBody = h('div', { class: 'watch-body' });
    this.watchBox = h(
      'aside',
      {
        class: 'watch-area',
        ondragover: (e: DragEvent) => e.preventDefault(),
        ondrop: (e: DragEvent) => {
          e.preventDefault();
          const tag = e.dataTransfer?.getData('text/plain');
          if (tag && this.plant.mod(tag)) {
            this.watchTags.add(tag);
            this.renderWatchArea();
          }
        },
      },
      h('div', { class: 'watch-head' }, 'Watch Area (drag a GEM here)'),
      this.watchBody,
    );
    this.renderWatchArea();
    this.instructorDrawer = this.buildInstructorDrawer();
    this.graphicHost = h('div', { class: 'graphic-host' });
    this.workspaceEl = h('main', { class: 'workspace' }, this.graphicHost, this.watchBox, this.instructorDrawer, this.wm.el);

    // ---- Navigatieknoppen (onder het scherm, met alarmrollup-kleur) ----
    this.navBtns = new Map();
    const nav = h('div', { class: 'dv-nav' },
      ...DISPLAYS.map((d) => {
        const b = h('button', { class: 'dv-btn navbtn', title: d.title, onclick: () => this.showDisplay(d.id) }, d.nav);
        this.navBtns.set(d.id, b);
        return b;
      }),
      ...Array.from({ length: Math.max(0, 8 - DISPLAYS.length) }, () => h('button', { class: 'dv-btn navbtn blank', disabled: true }, '')),
    );

    this.banner = new AlarmBanner(this);
    this.root.append(titleBar, row1, toolbar, strip, this.workspaceEl, nav, this.banner.el);
    this.showDisplay(this.displayId, false);
  }

  // ---- Displays / navigatie ----
  showDisplay(id: string, record = true): void {
    const def = DISPLAYS.find((d) => d.id === id) ?? DISPLAYS[0];
    if (record && def.id !== this.displayId) {
      this.navHistory = this.navHistory.slice(0, this.navPos + 1);
      this.navHistory.push(def.id);
      this.navPos = this.navHistory.length - 1;
    }
    if (!this.navHistory.length) {
      this.navHistory = [def.id];
      this.navPos = 0;
    }
    this.displayId = def.id;
    this.graphic?.dispose?.();
    clear(this.graphicHost);
    this.graphic = def.build(this);
    this.gems = this.graphic.gems;
    this.graphicHost.append(this.graphic.el);
    this.mainSel.value = def.id;
    this.stripTitleEl.textContent = def.title;
    this.stripRevEl.textContent = def.revisions.join('    ');
    this.flags.add(`opened:display:${def.id}`);
    this.refresh();
  }
  private navBack(): void {
    if (this.navPos > 0) {
      this.navPos--;
      this.showDisplay(this.navHistory[this.navPos], false);
    }
  }
  private navForward(): void {
    if (this.navPos < this.navHistory.length - 1) {
      this.navPos++;
      this.showDisplay(this.navHistory[this.navPos], false);
    }
  }
  private navNext(): void {
    const i = DISPLAYS.findIndex((d) => d.id === this.displayId);
    this.showDisplay(DISPLAYS[(i + 1) % DISPLAYS.length].id);
  }

  private renderWatchArea(): void {
    clear(this.watchBody);
    for (const tag of this.watchTags) {
      const valEl = h('span', { class: 'wval', id: `watch-${tag}` }, '---');
      const rm = h('button', {
        class: 'wrm',
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          this.watchTags.delete(tag);
          this.renderWatchArea();
        },
      }, '×');
      const item = h(
        'div',
        { class: 'watch-item', onclick: () => this.openFaceplate(tag) },
        h('span', { class: 'wtag' }, tag),
        valEl,
        rm,
      );
      this.watchBody.append(item);
    }
  }

  private buildInstructorDrawer(): HTMLElement {
    const p = this.t.process;
    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, unit = '') => {
      const valLbl = h('span', { class: 'v' }, `${get()}${unit}`);
      const inp = h('input', {
        type: 'range',
        min,
        max,
        step,
        value: get(),
        oninput: () => {
          const v = parseFloat(inp.value);
          set(v);
          valLbl.textContent = `${v}${unit}`;
        },
        onchange: () => this.logInstructor(label, `${inp.value}${unit}`),
      });
      return h('div', { class: 'inst-row' }, h('div', { class: 'kv' }, h('span', { class: 'k' }, label), valLbl), inp);
    };

    const chk = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const cb = h('input', { type: 'checkbox', checked: get(), onchange: () => { set(cb.checked); this.logInstructor(label, cb.checked ? 'ON' : 'OFF'); } });
      return h('label', { class: 'inst-chk' }, cb, ' ', label);
    };

    const aiFaultSel = (tag: 'LI-101' | 'FT-102') => {
      const ai = this.plant.ai(tag);
      const sel = h(
        'select',
        { onchange: () => { ai.setFault(sel.value as 'NONE' | 'BAD' | 'FROZEN' | 'DRIFT'); this.logInstructor(`${tag} transmitter fault`, sel.value); } },
        ...(['NONE', 'BAD', 'FROZEN', 'DRIFT'] as const).map((f) => h('option', { value: f, selected: ai.fault === f }, f)),
      );
      return h('div', { class: 'kv' }, h('span', { class: 'k' }, `${tag} Transmitter Fault`), sel);
    };

    return h(
      'aside',
      { class: 'inst-drawer' },
      h('div', { class: 'watch-head' }, 'INSTRUCTOR STATION – malfunctions'),
      h(
        'div',
        { class: 'inst-body' },
        slider('Feed Flow to Tank101', 0, 100, 1, () => p.feedFlow, (v) => (p.feedFlow = v), ' GPM'),
        slider('Suction Filter Plugging', 0, 1, 0.05, () => p.filterPlugging, (v) => (p.filterPlugging = v)),
        slider('Pump MTR-102 Plugging', 0, 1, 0.05, () => p.pumpPlugging, (v) => (p.pumpPlugging = v)),
        slider('Pump MTR-102 Wear (speed factor)', 0.3, 1, 0.05, () => p.pumpWear, (v) => (p.pumpWear = v)),
        slider('Pump Gas / Cavitation', 0.2, 1, 0.05, () => p.gasDegradation, (v) => (p.gasDegradation = v)),
        slider('FCV-102 Internal Leak', 0, 0.5, 0.02, () => p.fcvLeak, (v) => (p.fcvLeak = v)),
        chk('FCV-102 Air Supply Failure (Fail Closed)', () => p.fcvAirFail, (v) => (p.fcvAirFail = v)),
        chk('FCV-102 Stem Stuck', () => p.fcvStuck, (v) => (p.fcvStuck = v)),
        chk('XV-101 Stem Stuck', () => this.plant.dc('XV-101').stuck, (v) => (this.plant.dc('XV-101').stuck = v)),
        chk('MTR-102 Motor Trip / Breaker Open', () => this.plant.dc('MTR-102').blockOn, (v) => (this.plant.dc('MTR-102').blockOn = v)),
        aiFaultSel('LI-101'),
        aiFaultSel('FT-102'),
        chk('CTLR1 Primary Network Fail', () => !this.plant.nodes[0].primaryOk, (v) => (this.plant.nodes[0].primaryOk = !v)),
      ),
    );
  }

  // ---- Window / Navigatie acties ----
  openFaceplate(tag: string): void {
    const def = buildFaceplate(this, tag);
    if (!def) return;
    this.wm.open({ key: `fp:${tag}`, title: def.title, view: def.view, w: def.w });
  }

  openDetail(tag: string): void {
    const m = this.plant.mod(tag);
    if (!m || m.kind !== 'DC') return;
    this.wm.open({ key: `det:${tag}`, title: `${tag} – Detail Display`, view: buildMotorDetail(this, tag), w: 540 });
  }

  openUnit(unit: string): void {
    this.wm.open({ key: `unit:${unit}`, title: `Unit ${unit}`, view: buildUnitFaceplate(this, unit), w: 520 });
  }

  openAlarmList(preset = {}): void {
    this.wm.open({ key: 'alarmlist', title: 'Alarm List Summary', view: buildAlarmList(this, preset), w: 860, hgt: 420 });
  }

  openAreaFilter(): void {
    this.wm.open({ key: 'areafilter', title: 'Area Alarm Filtering', view: buildAreaFilter(this), w: 640 });
  }

  openDiagnostics(): void {
    this.wm.open({ key: 'diagnostics', title: 'DeltaV Diagnostics', view: buildDiagnostics(this), w: 660 });
  }

  openPhv(opts: { module?: string } = {}): void {
    this.wm.open({ key: `phv:${opts.module ?? 'all'}`, title: `Process History View${opts.module ? ` – ${opts.module}` : ''}`, view: buildPhv(this, opts.module), w: 780 });
  }

  openAlarmHelp(id: string): void {
    this.wm.open({ key: `help:${id}`, title: `Alarm Help – ${id}`, view: buildAlarmHelp(this, id), w: 460 });
  }

  openAlarmTarget(id: string): void {
    const a = this.alarms.alarms.get(id);
    if (a) this.openFaceplate(a.def.module);
  }

  gotoModule(tag: string): void {
    if (tag) this.openFaceplate(tag);
  }

  gemMenu(tag: string, x: number, y: number): void {
    const m = this.plant.mod(tag);
    if (!m) return;
    showMenu(x, y, [
      { label: 'Open Faceplate', onClick: () => this.openFaceplate(tag) },
      { label: 'Open Detail Display', onClick: () => this.openDetail(tag), disabled: m.kind !== 'DC' },
      { label: 'Open Process History View', onClick: () => this.openPhv({ module: tag }) },
      { label: 'Add to Watch Area', onClick: () => { this.watchTags.add(tag); this.renderWatchArea(); } },
    ]);
  }

  // ---- Simulatie-loop ----
  private startLoop(): void {
    let last = performance.now();
    this.timer = window.setInterval(() => {
      const now = performance.now();
      const realDt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (!this.paused) {
        const dt = realDt * this.speed;
        const steps = Math.max(1, Math.ceil(dt / 0.1));
        for (let i = 0; i < steps; i++) this.plant.tick(dt / steps);
      }
      this.refresh();
    }, 100);
  }

  refresh(): void {
    const simT = fmtTime(this.plant.clock.now());
    this.clockEl.textContent = simT;
    this.dvClockEl.textContent = simT;
    this.userEl.textContent = this.role === 'OPERATOR' ? 'U-OPER' : this.role === 'SUPERVISOR' ? 'U-SUPV' : 'U-INSTR';
    const unitMods = new Set(this.plant.units[0]?.modules ?? []);
    const ru = this.alarms.rollup(unitMods);
    this.rollupEl.textContent = this.displayId;
    this.rollupEl.className = 'dv-strip-id' + (ru.top ? ` p-${ru.top.toLowerCase()}` : '');
    for (const [id, b] of this.navBtns) {
      const d = DISPLAYS.find((x) => x.id === id);
      const mods = d?.unit === this.plant.units[0]?.tag ? ru : { top: null };
      b.className = 'dv-btn navbtn' + (id === this.displayId ? ' current' : '') + (mods.top ? ` p-${mods.top.toLowerCase()}` : '');
    }
    this.graphic?.update();

    // Watch Area waarden
    for (const tag of this.watchTags) {
      const el = document.getElementById(`watch-${tag}`);
      const m = this.plant.mod(tag);
      if (!el || !m) continue;
      if (m.kind === 'AI') el.textContent = `${fmt(this.plant.ai(tag).pv, 1)} ${this.plant.ai(tag).eu}`;
      else if (m.kind === 'PID') el.textContent = `${fmt(this.plant.pid(tag).pv, 1)} ${this.plant.pid(tag).eu}`;
      else if (m.kind === 'DC') {
        const d = this.plant.dc(tag);
        el.textContent = d.pv === null ? 'TRANSIT' : d.cfg.pvNames[d.pv];
      } else if (m.kind === 'EM') el.textContent = this.plant.em(tag).state;
    }

    for (const g of this.gems) g.refresh();
    this.banner.refresh();
    this.wm.refresh();

    const hs = this.alarms.hornState();
    this.horn.set(hs.sounding, hs.priority);
  }

  unlockAudio(): void {
    this.horn.unlock();
  }
}