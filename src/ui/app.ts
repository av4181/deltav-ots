import { CREDENTIALS } from '../config';
import { ScenarioEngine } from '../scenarios/engine';
import { buildCatalyst, type Catalyst } from '../scenarios/catalyst';
import type { Plant } from '../dcs/plant';
import { buildTank101, type InitState, type Tank101 } from '../scenarios/tank101';
import { fmtDateTime, fmtTime } from '../dcs/clock';
import { AlarmBanner, buildAlarmHelp, buildAlarmList, buildAreaFilter, buildDiagnostics, buildUnitFaceplate } from './alarmUi';
import { clear, fmt, h, makeStage, s, showMenu, toast } from './dom';
import { buildFaceplate, buildMotorDetail } from './faceplates';
import { DISPLAYS, DISPLAY_SET, displayChildren, type DisplayInstance } from './displays';
import { ICONS } from './icons';
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
  cat!: Catalyst;
  site: 'TANK101' | 'CATALYST' = 'TANK101';
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
  private watchBody!: HTMLElement;
  private instructorDrawer!: HTMLElement;
  private instructorBtn?: HTMLElement;
  private graphic: DisplayInstance | null = null;
  private graphicHost!: HTMLElement;
  private workspaceEl!: HTMLElement;
  private watchBox!: HTMLElement;
  private userEl!: HTMLElement;
  private dtEl!: HTMLElement;
  private tabsEl!: HTMLElement;
  private tabEls = new Map<string, { el: HTMLElement; badge: HTMLElement }>();
  theme: 'silver' | 'night' = 'silver';
  displayId = 'T101';
  private navHistory: string[] = [];
  private navPos = 0;
  private timer: number | null = null;

  constructor(container: HTMLElement) {
    this.root = container;
    this.loadScenario('RUNNING');
    this.startLoop();
  }

  get plant(): Plant { return this.site === 'CATALYST' ? this.cat.plant : this.t.plant; }
  get alarms() { return this.plant.alarms; }
  plantOfUnit(unit?: string): Plant | undefined {
    return [this.t.plant, this.cat.plant].find((p) => p.units.some((u) => u.tag === unit));
  }

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
    this.cat = buildCatalyst();
    this.cat.plant.user = this.role;
    this.plant.user = this.role;
    this.renderShell();
    this.refresh();
  }

  private renderShell(): void {
    clear(this.root);
    this.gems = [];
    this.graphic?.dispose?.();
    this.graphic = null;
    this.root.dataset.theme = this.theme;

    // ---- OTS-strook (simulatorfuncties; niet onderdeel van DeltaV Live) ----
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
    const otsBar = h('div', { class: 'ots-bar' },
      h('span', { class: 'ots-lbl' }, 'OPERATOR TRAINING SIMULATOR'),
      h('span', { class: 'ots-spacer' }),
      h('button', { class: 'ots-btn', onclick: () => this.loadScenario('RUNNING') }, 'Reset: Running'),
      h('button', { class: 'ots-btn', onclick: () => this.loadScenario('COLD') }, 'Reset: Cold start'),
      h('button', { class: 'ots-btn', onclick: () => this.openScenarioPanel() }, 'Scenarios'),
      this.instructorBtn, roleSel, speedSel, pauseBtn, this.clockEl);

    // ---- DeltaV Live-werkbalk (pictogrammen links, datum/tijd + gebruiker rechts) ----
    const tb = (icon: string, title: string, onclick: (e: MouseEvent) => void, cls = '') => {
      const b = h('button', { class: 'lv-btn ' + cls, title, onclick });
      b.innerHTML = ICONS[icon] ?? ICONS.generic;
      return b;
    };
    this.dtEl = h('span', { class: 'lv-dt' });
    this.userEl = h('span', { class: 'lv-user' });
    const toolbar = h('div', { class: 'lv-toolbar' },
      tb('search', 'Search for a module / display', () => this.searchModule()),
      tb('heart', 'DeltaV Diagnostics', () => this.openDiagnostics()),
      tb('tools', 'Tools', (e) => this.toolsMenu(e)),
      tb('refresh', 'Refresh the display', () => this.showDisplay(this.displayId, false)),
      h('span', { class: 'lv-sep' }),
      tb('alarmlist', 'Alarm List', () => this.openAlarmList()),
      tb('unit', 'Unit alarms', () => this.openUnit(this.plant.units[0].tag)),
      tb('filter', 'Area alarm filtering', () => this.openAreaFilter()),
      tb('phv', 'Process History View – Chart', () => this.openPhv()),
      tb('events', 'Process History View – Events', () => this.openPhv()),
      tb('watch', 'Watch Area', () => this.watchBox.classList.toggle('hidden')),
      tb('help', 'Operator help', () => toast('Click a module for its faceplate, right-click for more. Hover the alarm banner for alarm details.')),
      h('span', { class: 'lv-spacer' }),
      this.dtEl, this.userEl,
    );

    // ---- Navigatiebalk: ← → ↑ ⌂ en display-set-tabs ----
    const nb = (icon: string, title: string, onclick: () => void) => tb(icon, title, onclick, 'nav');
    this.tabsEl = h('div', { class: 'lv-tabs' });
    const navbar = h('div', { class: 'lv-nav' },
      nb('back', 'Back (previously opened display)', () => this.navBack()),
      nb('fwd', 'Forward', () => this.navForward()),
      nb('up', 'Up one level in the display hierarchy', () => this.navUp()),
      nb('home', 'Home display of the display set', () => this.showDisplay(DISPLAY_SET.home)),
      this.tabsEl);
    this.buildTabs();

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
      h('div', { class: 'watch-head' }, 'Watch Area (drag a module here)'),
      this.watchBody,
    );
    this.renderWatchArea();
    this.instructorDrawer = this.buildInstructorDrawer();
    this.graphicHost = h('div', { class: 'graphic-host' });
    this.workspaceEl = h('main', { class: 'workspace' }, this.graphicHost, this.watchBox, this.instructorDrawer, this.wm.el);

    this.banner = new AlarmBanner(this);
    this.root.append(otsBar, toolbar, navbar, this.workspaceEl, this.banner.el);
    this.showDisplay(this.displayId, false);
  }

  // ---- Display-set tabs ----
  private buildTabs(): void {
    clear(this.tabsEl);
    this.tabEls.clear();
    const label = h('span', { class: 'lv-setname', title: 'Display Set' }, DISPLAY_SET.name);
    this.tabsEl.append(label);
    for (const d of displayChildren(DISPLAY_SET.home)) {
      const badge = h('span', { class: 'lv-badge hidden' });
      const main = h('button', { class: 'lv-tabmain', onclick: () => this.showDisplay(d.id) }, badge, d.nav);
      const kids = displayChildren(d.id);
      const arrow = kids.length
        ? h('button', { class: 'lv-tabarrow', title: 'Displays below this one', onclick: (e: MouseEvent) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            showMenu(r.left, r.bottom, [{ label: d.title, onClick: () => this.showDisplay(d.id) }, ...kids.map((k) => ({ label: k.title, onClick: () => this.showDisplay(k.id) }))]);
          } }, '▾')
        : null;
      const el = h('div', { class: 'lv-tab' }, main, arrow);
      this.tabsEl.append(el);
      this.tabEls.set(d.id, { el, badge });
    }
  }

  private toolsMenu(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    showMenu(r.left, r.bottom, [
      { label: 'Print                Ctrl+P', onClick: () => window.print() },
      { label: 'Reset Layout (close all windows)', onClick: () => this.wm.closeAll() },
      { label: `Display Set: ${DISPLAY_SET.name} ✓`, onClick: () => toast('Only the display set “MainProcess” is available on this workstation') },
      { label: `Theme: Silver${this.theme === 'silver' ? ' ✓' : ''}`, onClick: () => this.setTheme('silver') },
      { label: `Theme: Night${this.theme === 'night' ? ' ✓' : ''}`, onClick: () => this.setTheme('night') },
      { label: 'Language: English ✓', onClick: () => toast('Operator interface language: English') },
    ]);
  }

  setTheme(t: 'silver' | 'night'): void {
    this.theme = t;
    this.root.dataset.theme = t;
  }

  private searchModule(): void {
    const tag = window.prompt('Open faceplate for module (tag):', 'FIC-102')?.trim().toUpperCase();
    if (!tag) return;
    if (this.plant.mod(tag)) this.openFaceplate(tag);
    else toast(`Module ${tag} not found`, 'error');
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
    if (def.site && def.site !== this.site) this.setSite(def.site);
    else if (!def.site && def.id !== 'OVERVIEW' && this.site !== 'TANK101') this.setSite('TANK101');
    this.displayId = def.id;
    this.graphic?.dispose?.();
    clear(this.graphicHost);
    this.graphic = def.build(this);
    this.gems = this.graphic.gems;
    this.graphicHost.append(this.graphic.el);
    this.flags.add(`opened:display:${def.id}`);
    this.refresh();
  }
  private setSite(site: 'TANK101' | 'CATALYST'): void {
    this.site = site;
    this.watchTags = new Set(site === 'CATALYST' ? ['LT-30060', 'FIC-30060'] : ['LI-101', 'FIC-102']);
    this.renderWatchArea();
    this.instructorDrawer?.replaceWith(this.instructorDrawer = this.buildInstructorDrawer());
  }
  private navUp(): void {
    const d = DISPLAYS.find((x) => x.id === this.displayId);
    if (d?.parent) this.showDisplay(d.parent);
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
    const cp = this.cat.process;
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

    if (this.site === 'CATALYST') {
      const c = this.cat;
      const dc = c.dc;
      const faultSel = (tag: string) => {
        const ai = c.plant.ai(tag);
        const sel = h('select', { onchange: () => { ai.setFault(sel.value as 'NONE' | 'BAD' | 'FROZEN' | 'DRIFT'); this.logInstructor(`${tag} transmitter fault`, sel.value); } },
          ...(['NONE', 'BAD', 'FROZEN', 'DRIFT'] as const).map((f) => h('option', { value: f, selected: ai.fault === f }, f)));
        return h('div', { class: 'kv' }, h('span', { class: 'k' }, `${tag} Transmitter Fault`), sel);
      };
      return h('aside', { class: 'inst-drawer' },
        h('div', { class: 'watch-head' }, 'INSTRUCTOR STATION – catalyst malfunctions'),
        h('div', { class: 'inst-body' },
          slider('Zg pot actual fill (DCS assumes FF_Zg)', 0.5, 1, 0.05, () => cp.fillActual.ZG, (v) => (cp.fillActual.ZG = v)),
          slider('Cr pot actual fill (DCS assumes FF_Cr)', 0.5, 1, 0.05, () => cp.fillActual.CR, (v) => (cp.fillActual.CR = v)),
          slider('DCS FF_Zg (calc 430KS-500C)', 0.5, 1.2, 0.05, () => c.calc.ff.ZG, (v) => (c.calc.ff.ZG = v)),
          slider('DCS FF_Cr (calc 430KS-500C)', 0.5, 1.2, 0.05, () => c.calc.ff.CR, (v) => (c.calc.ff.CR = v)),
          chk('M-3003 V-3009 Agitator Trip (catalyst settles)', () => dc['M-3003'].blockOn, (v) => (dc['M-3003'].blockOn = v)),
          chk('M-3002 V-3005 Agitator Trip (Zg demixes)', () => dc['M-3002'].blockOn, (v) => (dc['M-3002'].blockOn = v)),
          chk('P-3008A Trip / Breaker Open', () => dc['P-3008A'].blockOn, (v) => (dc['P-3008A'].blockOn = v)),
          chk('P-3008B Trip / Breaker Open', () => dc['P-3008B'].blockOn, (v) => (dc['P-3008B'].blockOn = v)),
          chk('KSV-30115 Cr pot outlet Stem Stuck', () => dc['KSV-30115'].stuck, (v) => (dc['KSV-30115'].stuck = v)),
          chk('KSV-30105 Zg pot outlet Stem Stuck', () => dc['KSV-30105'].stuck, (v) => (dc['KSV-30105'].stuck = v)),
          chk('KSV-30112 Cr pot top LIR Stem Stuck', () => dc['KSV-30112'].stuck, (v) => (dc['KSV-30112'].stuck = v)),
          chk('XV-30061 Stem Stuck (R-3001 block)', () => dc['XV-30061'].stuck, (v) => (dc['XV-30061'].stuck = v)),
          chk('I-3001 Emergency Shutdown', () => c.ce.manual.has('I-3001'), (v) => c.ce.setManual('I-3001', v)),
          chk('I-3002 Reactors Kill', () => c.ce.manual.has('I-3002'), (v) => c.ce.setManual('I-3002', v)),
          chk('Low-low level C-5002 (_LALL50263)', () => c.ce.manual.has('_LALL50263'), (v) => c.ce.setManual('_LALL50263', v)),
          faultSel('LT-30060'), faultSel('FT-30060'), faultSel('PT-30010'), faultSel('PT-30044'),
          chk('CTLR1 Primary Network Fail', () => !c.plant.nodes[0].primaryOk, (v) => (c.plant.nodes[0].primaryOk = !v)),
        ));
    }
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
        for (let i = 0; i < steps; i++) { this.t.plant.tick(dt / steps); this.cat.plant.tick(dt / steps); }
      }
      this.refresh();
    }, 100);
  }

  refresh(): void {
    this.clockEl.textContent = fmtTime(this.plant.clock.now());
    this.dtEl.textContent = new Date(this.plant.clock.now()).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    this.userEl.textContent = `OPS\\${this.role}`;
    const cur = DISPLAYS.find((d) => d.id === this.displayId);
    const chain = new Set<string>();
    for (let d = cur; d; d = DISPLAYS.find((x) => x.id === d?.parent)) chain.add(d.id);
    for (const [id, t] of this.tabEls) {
      const def = DISPLAYS.find((x) => x.id === id);
      const mods = new Set<string>();
      const collect = (did: string) => {
        const d = DISPLAYS.find((x) => x.id === did);
        const u = d?.unit ? this.plantOfUnit(d.unit)?.units.find((x) => x.tag === d.unit) : undefined;
        u?.modules.forEach((m) => mods.add(m));
        displayChildren(did).forEach((k) => collect(k.id));
      };
      collect(def?.id ?? id);
      const r = this.alarms.rollup(mods);
      t.badge.textContent = r.count ? String(r.count) : '';
      t.badge.className = 'lv-badge' + (r.count && r.top ? ` p-${r.top.toLowerCase()}` : ' hidden');
      t.el.classList.toggle('current', chain.has(id));
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