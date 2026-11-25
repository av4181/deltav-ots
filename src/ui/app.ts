import { CREDENTIALS } from '../config';
import { ScenarioEngine } from '../scenarios/engine';
import { buildTank101, type InitState, type Tank101 } from '../scenarios/tank101';
import { fmtTime } from '../dcs/clock';
import { AlarmBanner, buildAlarmHelp, buildAlarmList, buildAreaFilter, buildDiagnostics, buildUnitFaceplate } from './alarmUi';
import { clear, fmt, h, makeStage, s, showMenu, toast } from './dom';
import { buildFaceplate, buildMotorDetail } from './faceplates';
import { aiGem, controlValveGem, emGem, motorGem, pidGem, valveGem, type Gem } from './gems';
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
  private tankFillEl!: SVGElement;
  private tankValEl!: SVGElement;
  private watchBody!: HTMLElement;
  private instructorDrawer!: HTMLElement;
  private instructorBtn?: HTMLElement;
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

    // ---- Top Navigatiebalk (DeltaV Live Header) ----
    const roleSel = h(
      'select',
      {
        class: 'nav-sel',
        onchange: () => {
          if (!this.setRole(roleSel.value as Role)) roleSel.value = this.role;
        },
      },
      h('option', { value: 'OPERATOR', selected: this.role === 'OPERATOR' }, 'Role: OPERATOR'),
      h('option', { value: 'SUPERVISOR', selected: this.role === 'SUPERVISOR' }, 'Role: SUPERVISOR'),
      h('option', { value: 'INSTRUCTOR', selected: this.role === 'INSTRUCTOR' }, 'Role: INSTRUCTOR'),
    );

    const speedSel = h(
      'select',
      {
        class: 'nav-sel',
        onchange: () => { this.speed = Number(speedSel.value); },
      },
      ...[1, 2, 5, 10].map((x) => h('option', { value: String(x), selected: this.speed === x }, `${x}x`)),
    );

    const pauseBtn = h(
      'button',
      {
        class: 'tbtn',
        onclick: () => {
          this.paused = !this.paused;
          pauseBtn.textContent = this.paused ? '▶ Resume' : '⏸ Pause';
        },
      },
      this.paused ? '▶ Resume' : '⏸ Pause',
    );

    this.rollupEl = h('button', {
      class: 'rollup-tab active',
      onclick: () => this.openUnit('TANK101'),
      title: 'Click to open TANK101 Unit Faceplate',
    });

    this.clockEl = h('span', { class: 'nav-clock' });

    const topBar = h(
      'header',
      { class: 'topbar' },
      h(
        'div',
        { class: 'nav-left' },
        h('span', { class: 'brand' }, 'DeltaV Live OTS'),
        this.rollupEl,
        h('button', { class: 'tbtn', onclick: () => this.openUnit('TANK101') }, 'Unit Alarms'),
        h('button', { class: 'tbtn', onclick: () => this.openPhv() }, 'History / Journal'),
        h('button', { class: 'tbtn', onclick: () => this.openFaceplate('EM_T101') }, 'EM_T101'),
        h('button', { class: 'tbtn', onclick: () => this.openScenarioPanel() }, 'Scenarios'),
      ),
      h(
        'div',
        { class: 'nav-right' },
        h('button', { class: 'tbtn', onclick: () => this.loadScenario('RUNNING') }, 'Reset: Running'),
        h('button', { class: 'tbtn', onclick: () => this.loadScenario('COLD') }, 'Reset: Cold Start'),
        (this.instructorBtn = h('button', {
          class: 'tbtn primary' + (this.isInstructor ? '' : ' hidden'),
          onclick: () => this.instructorDrawer.classList.toggle('open'),
        }, '⚙ Instructor / Faults')),
        roleSel,
        speedSel,
        pauseBtn,
        this.clockEl,
      ),
    );

    // ---- Process Graphic Canvas (TANK101) ----
    const { outer, stage } = makeStage(1180, 560);

    const svg = s('svg', { viewBox: '0 0 1180 560', width: 1180, height: 560, class: 'pid-svg' });
    // Leidingen: Voeding -> Tank101 -> XV-101 -> MTR-102 -> FCV-102 -> Afvoer
    svg.append(
      s('path', { d: 'M 40 130 L 140 130', class: 'pipe' }),
      s('polygon', { points: '132,124 144,130 132,136', class: 'pipe-arrow' }),
      // Tank 101 romp
      s('rect', { x: 145, y: 100, width: 170, height: 290, rx: 28, class: 'vessel' }),
      s('text', { x: 230, y: 88, 'text-anchor': 'middle', class: 'vessel-title' }, 'TANK-101'),
    );

    // Kijkglas / niveau-indicatie in Tank101
    this.tankFillEl = s('rect', { x: 215, y: 245, width: 30, height: 120, class: 'tank-fill' });
    this.tankValEl = s('text', { x: 230, y: 382, 'text-anchor': 'middle', class: 'vessel-sub' }, '500.0 gal');
    svg.append(
      s('rect', { x: 215, y: 130, width: 30, height: 235, class: 'tank-glass' }),
      this.tankFillEl,
      this.tankValEl,
      // Uitloopleiding
      s('path', { d: 'M 230 390 L 230 455 L 1080 455', class: 'pipe' }),
      s('polygon', { points: '1072,449 1084,455 1072,461', class: 'pipe-arrow' }),
      s('text', { x: 1095, y: 460, class: 'vessel-sub' }, 'To TANK201'),
      s('rect', { x: 268, y: 441, width: 34, height: 28, rx: 3, class: 'vessel' }),
      s('path', { d: 'M 272 445 L 298 465 M 272 465 L 298 445', class: 'sigline' }),
      s('text', { x: 285, y: 436, 'text-anchor': 'middle', class: 'vessel-sub' }, 'F-101'),
      // Impulslijnen (stippellijn)
      s('path', { d: 'M 315 190 L 365 190', class: 'sigline' }),
      s('path', { d: 'M 491 190 L 535 190', class: 'sigline' }),
      s('path', { d: 'M 617 240 L 617 300', class: 'sigline' }),
      s('path', { d: 'M 940 365 L 940 420', class: 'sigline' }),
      s('path', { d: 'M 865 365 L 865 415', class: 'sigline' }),
    );
    stage.append(svg);


    // Plaats alle DeltaV High-Performance GEMs op het schema
    const addGem = (g: Gem) => {
      this.gems.push(g);
      stage.append(g.el);
    };
    addGem(aiGem(this, 'LI-101', 365, 160));
    addGem(pidGem(this, 'LIC-101', 535, 140));
    addGem(emGem(this, 'EM_T101', 890, 60));
    addGem(motorGem(this, 'MTR-102', 370, 410));
    addGem(valveGem(this, 'XV-101', 560, 415));
    addGem(aiGem(this, 'PDI-101', 215, 502));
    addGem(aiGem(this, 'PI-101', 345, 502));
    addGem(aiGem(this, 'PI-102', 475, 502));
    addGem(aiGem(this, 'II-102', 605, 502));
    addGem(aiGem(this, 'FT-102', 745, 365));
    addGem(pidGem(this, 'FIC-102', 890, 265));
    addGem(controlValveGem(this, 'FIC-102', 892, 415));

    // ---- Watch Area (rechtsboven op scherm, accepteert drag & drop) ----
    this.watchBody = h('div', { class: 'watch-body' });
    const watchBox = h(
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
      h('div', { class: 'watch-head' }, 'WATCH AREA (drag GEM here)'),
      this.watchBody,
    );
    this.renderWatchArea();

    // ---- Instructor / Scenario Malfunction Drawer ----
    this.instructorDrawer = this.buildInstructorDrawer();

    // ---- Onderste Alarm Banner ----
    this.banner = new AlarmBanner(this);

    const workspace = h('main', { class: 'workspace' }, outer, watchBox, this.instructorDrawer, this.wm.el);
    this.root.append(topBar, workspace, this.banner.el);
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
    this.clockEl.textContent = fmtTime(this.plant.clock.now());
    const unitMods = new Set(this.plant.units[0]?.modules ?? []);
    const ru = this.alarms.rollup(unitMods);
    this.rollupEl.textContent = ru.count ? `[${ru.count}] TANK101` : 'TANK101';
    this.rollupEl.className = 'rollup-tab active' + (ru.top ? ` p-${ru.top.toLowerCase()}` : '');

    // Tank niveau-animatie
    const pct = Math.max(0, Math.min(1, this.t.process.level / this.t.process.capacity));
    const hPx = 235 * pct;
    this.tankFillEl.setAttribute('y', String(365 - hPx));
    this.tankFillEl.setAttribute('height', String(hPx));
    this.tankValEl.textContent = `${fmt(this.t.process.level, 1)} gal`;

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