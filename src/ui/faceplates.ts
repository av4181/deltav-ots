import type { AnalogInput } from '../sim/ai';
import type { DiscreteDevice } from '../sim/discrete';
import type { EquipmentModule } from '../sim/em';
import type { Pid } from '../sim/pid';
import type { Mode } from '../sim/types';
import { AlarmTable } from './alarmUi';
import type { App } from './app';
import { NumField, clear, fmt, h, toast, type Child } from './dom';
import { TrendChart, penPaths } from './trend';
import type { View } from './wm';

export interface FaceplateDef {
  title: string;
  view: View;
  w?: number;
}

export function buildFaceplate(app: App, tag: string): FaceplateDef | null {
  const m = app.plant.mod(tag);
  if (!m) return null;
  const title = `${tag} – ${m.description}`;
  switch (m.kind) {
    case 'AI': return { title, view: aiFaceplate(app, app.plant.ai(tag)), w: 330 };
    case 'DC': return { title, view: discreteFaceplate(app, app.plant.dc(tag)), w: 330 };
    case 'PID': return { title, view: pidFaceplate(app, app.plant.pid(tag)), w: 430 };
    case 'EM': return { title, view: emFaceplate(app, app.plant.em(tag)), w: 360 };
    default: return null;
  }
}

// ------------------------------------------------------------ gedeelde bouwstenen
function shortcuts(app: App, tag: string, opts: { detail?: boolean } = {}): HTMLElement {
  const btn = (label: string, title: string, f: () => void) => h('button', { class: 'sbtn', title, onclick: f }, label);
  return h('div', { class: 'shortcuts' },
    btn('✓', 'Acknowledge all alarms visible in the faceplate', () => { app.alarms.ackMany(app.alarms.forModule(tag).map((a) => a.id)); app.flag('acked'); }),
    btn('📈', 'Open Process History View', () => app.openPhv({ module: tag })),
    btn('▣', 'Open the module’s primary control display', () => app.gotoModule(tag)),
    opts.detail ? btn('⋯', 'Open the module’s detail display', () => app.openDetail(tag)) : null,
    btn('?', 'Alarm Help (highest-ranked alarm)', () => {
      const a = app.alarms.forModule(tag)[0];
      if (a) app.openAlarmHelp(a.id);
      else toast('No active alarm on this module – open Alarm Help from an alarm');
    }),
  );
}

function alarmList(app: App, tag: string): AlarmTable {
  return new AlarmTable(app, () => app.alarms.forModule(tag), ['ack', 'param', 'help'], { compact: true, empty: 'No alarms' });
}

function row(label: string, value: Child): HTMLElement {
  return h('div', { class: 'kv' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, value));
}

function modeLine(target: string, actual: string): string {
  return target === actual ? actual : `! ${actual}`;
}

// ------------------------------------------------------------ discreet (klep / motor)
function discreteFaceplate(app: App, d: DiscreteDevice): View {
  const pv = h('div', { class: 'fp-pv' });
  const reject = h('div', { class: 'reject hidden', title: 'Write rejected' });
  const noPermit = h('div', { class: 'nopermit hidden' }, '⊘ NO PERMIT');
  const btns = ([1, 0] as const).map((v) =>
    h('button', { class: 'statebtn', onclick: () => {
      const r = d.setSp(v);
      if (!r.ok) toast(r.reason ?? 'Write rejected', 'error');
      app.flag(`sp:${d.tag}`);
    } }, d.cfg.spNames[v]));
  const modeSel = h('select', { class: 'modesel', onchange: () => {
    d.setMode(modeSel.value as 'AUTO' | 'CAS' | 'OOS');
    app.flag(`mode:${d.tag}`);
  } }, ...['AUTO', 'CAS', 'OOS'].map((m) => h('option', { value: m }, m)));
  const actual = h('span', { class: 'v' });
  const accept = h('input', { type: 'checkbox', onchange: () => { d.accept = accept.checked; } });
  const limit = h('span', { class: 'v' });
  const elapsed = h('span', { class: 'v' });
  const state = h('span', { class: 'v strong' });
  const fail = h('span', { class: 'v' });
  const alist = alarmList(app, d.tag);
  const el = h('div', { class: 'faceplate' },
    h('div', { class: 'fp-top' }, pv, noPermit),
    h('div', { class: 'statebtns' }, ...btns),
    reject,
    h('div', { class: 'fp-grid' },
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Mode (target)'), modeSel),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Mode (actual)'), actual),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Accept'), accept),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Time limit'), limit),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Elapsed time'), elapsed),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Device state'), state),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Fail alarm'), fail)),
    alist.el,
    shortcuts(app, d.tag, { detail: d.kindLabel === 'MOTOR' }));
  return {
    el,
    refresh: () => {
      const p = d.pv;
      pv.textContent = p === null ? 'IN TRANSIT' : d.cfg.pvNames[p];
      pv.className = 'fp-pv' + (p === null ? ' transit' : '');
      btns.forEach((b, i) => {
        const v = (1 - i) as 0 | 1;
        b.classList.toggle('sp', d.sp === v);
        b.disabled = d.target !== 'AUTO';
      });
      if (document.activeElement !== modeSel) modeSel.value = d.target;
      actual.textContent = modeLine(d.target, d.actual);
      actual.className = 'v strong' + (d.target !== d.actual ? ' warnmode' : '');
      accept.checked = d.accept;
      limit.textContent = `${d.cfg.timeLimit} s`;
      elapsed.textContent = `${d.elapsed.toFixed(1)} s`;
      state.textContent = d.deviceState;
      fail.textContent = d.failText;
      fail.className = 'v' + (d.failActive ? ' bad' : '');
      noPermit.classList.toggle('hidden', !d.noPermit);
      reject.classList.toggle('hidden', !d.lastReject);
      if (d.lastReject) reject.textContent = '✎̸ ' + d.lastReject.text;
      alist.refresh();
    },
  };
}

// ------------------------------------------------------------ analoge ingang
function aiFaceplate(app: App, a: AnalogInput): View {
  const pv = h('div', { class: 'fp-pv' });
  const status = h('span', { class: 'v' });
  const bar = h('div', { class: 'vbar' }, h('div', { class: 'vfill' }));
  const fill = bar.firstElementChild as HTMLElement;
  const marks = a.limits.specs.map((s) => {
    const m = h('div', { class: `vmark lim ${s.priority.toLowerCase()}`, title: `${s.param} ${s.limit} ${a.eu}` });
    m.style.bottom = ((s.limit - a.lo) / (a.hi - a.lo)) * 100 + '%';
    bar.append(m);
    return m;
  });
  void marks;
  const scale = h('div', { class: 'vscale' }, h('span', null, `${a.hi}`), h('span', null, `${a.lo}`));
  const alist = alarmList(app, a.tag);
  const el = h('div', { class: 'faceplate' },
    h('div', { class: 'fp-split' },
      h('div', { class: 'fp-left' }, pv, h('div', { class: 'fp-eu' }, a.eu), row('Status', status),
        row('Range', `${a.lo} – ${a.hi} ${a.eu}`),
        h('div', { class: 'hint' }, 'Analog input: cannot be changed by the operator.')),
      h('div', { class: 'fp-bars' }, bar, scale)),
    alist.el, shortcuts(app, a.tag));
  return {
    el,
    refresh: () => {
      pv.textContent = fmt(a.pv, 1);
      pv.className = 'fp-pv' + (a.status === 'BAD' ? ' bad' : '');
      status.textContent = a.status;
      fill.style.height = Math.max(0, Math.min(100, ((a.pv - a.lo) / (a.hi - a.lo)) * 100)) + '%';
      alist.refresh();
    },
  };
}

// ------------------------------------------------------------ PID
function pidFaceplate(app: App, p: Pid): View {
  const pv = h('div', { class: 'fp-pv' });
  const out = h('div', { class: 'fp-out' });
  const spField = new NumField(() => p.sp, (v) => { const r = p.setSp(v); if (!r.ok) toast(r.reason!, 'error'); else app.flag(`sp:${p.tag}`); },
    { width: 80, decimals: p.hi <= 100 ? 1 : 0, enabled: () => p.actual === 'AUTO' });
  const outField = new NumField(() => p.out, (v) => { const r = p.setOut(v); if (!r.ok) toast(r.reason!, 'error'); else app.flag(`out:${p.tag}`); },
    { width: 70, decimals: 1, enabled: () => p.actual === 'MAN' });
  const step = p.span / 100;
  const slew = (dir: number) => h('button', { class: 'slew', onclick: () => { const r = p.setSp(p.sp + dir * step); if (!r.ok) toast(r.reason!, 'error'); } }, dir < 0 ? '◀' : '▶');
  const slider = h('input', { type: 'range', class: 'spslider', min: p.lo, max: p.hi, step: p.span / 200, oninput: () => {
    const r = p.setSp(parseFloat(slider.value));
    if (!r.ok) toast(r.reason!, 'error');
  } });
  const modes: Mode[] = p.primary ? ['AUTO', 'MAN', 'CAS', 'OOS'] : ['AUTO', 'MAN', 'OOS'];
  const modeSel = h('select', { class: 'modesel', onchange: () => {
    const r = p.setMode(modeSel.value as Mode);
    if (!r.ok) toast(r.reason!, 'error');
    app.flag(`mode:${p.tag}`);
  } }, ...modes.map((m) => h('option', { value: m }, m)));
  const actual = h('span', { class: 'v strong' });
  const bypass = p.primary ? h('input', { type: 'checkbox', onchange: () => p.setBypass(bypass!.checked) }) : null;
  // balken
  const pvFill = h('div', { class: 'vfill' });
  const spMark = h('div', { class: 'vmark sp', title: 'SP' });
  const pvBar = h('div', { class: 'vbar' }, pvFill, spMark);
  for (const s of p.limits.specs) {
    const m = h('div', { class: `vmark lim ${s.priority.toLowerCase()}`, title: `${s.param} ${s.limit}` });
    m.style.bottom = ((s.limit - p.lo) / p.span) * 100 + '%';
    pvBar.append(m);
  }
  const outFill = h('div', { class: 'vfill out' });
  const outBar = h('div', { class: 'vbar' }, outFill);
  const trend = new TrendChart(app, penPaths(app, p.tag), { axes: false, height: 110, span: 600 });
  const alist = alarmList(app, p.tag);
  const el = h('div', { class: 'faceplate pidfp' },
    h('div', { class: 'fp-split' },
      h('div', { class: 'fp-left' },
        h('div', { class: 'lbl' }, 'PV'), pv, h('div', { class: 'fp-eu' }, p.eu),
        h('div', { class: 'lbl' }, 'OUT'), out,
        h('div', { class: 'lbl' }, 'SP'), h('div', { class: 'spline' }, slew(-1), spField.el, slew(1)),
        h('div', { class: 'lbl' }, 'OUT (MAN)'), outField.el),
      h('div', { class: 'fp-bars' }, pvBar, outBar),
      h('div', { class: 'fp-right' }, trend.el)),
    h('div', { class: 'sliderrow' }, slider),
    h('div', { class: 'fp-grid' },
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Mode (target)'), modeSel),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Mode (actual)'), actual),
      bypass ? h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Cascade BYPASS'), bypass) : null),
    alist.el, shortcuts(app, p.tag));
  return {
    el,
    refresh: () => {
      pv.textContent = fmt(p.pv, 1);
      pv.className = 'fp-pv' + (p.pvBad ? ' bad' : '');
      out.textContent = fmt(p.out, 1) + ' %';
      spField.refresh();
      outField.refresh();
      slider.disabled = p.actual !== 'AUTO';
      if (document.activeElement !== slider) slider.value = String(p.sp);
      if (document.activeElement !== modeSel) modeSel.value = p.target;
      actual.textContent = modeLine(p.target, p.actual);
      actual.className = 'v strong' + (p.target !== p.actual ? ' warnmode' : '');
      if (bypass) bypass.checked = p.bypass;
      pvFill.style.height = Math.max(0, Math.min(100, ((p.pv - p.lo) / p.span) * 100)) + '%';
      spMark.style.bottom = Math.max(0, Math.min(100, ((p.sp - p.lo) / p.span) * 100)) + '%';
      outFill.style.height = Math.max(0, Math.min(100, p.out)) + '%';
      trend.draw();
      alist.refresh();
    },
    dispose: () => trend.dispose(),
  };
}

// ------------------------------------------------------------ Equipment Module
function emFaceplate(app: App, e: EquipmentModule): View {
  const target = h('div', { class: 'em-field' });
  const pv = h('div', { class: 'em-field' });
  const sel = h('select', { class: 'modesel' }, ...e.commandNames.map((c) => h('option', { value: c }, c)));
  const run = h('button', { class: 'tbtn primary', onclick: () => {
    const r = e.run(sel.value);
    if (!r.ok) toast(r.reason!, 'error');
    app.flag(`em:${sel.value}`);
  } }, 'RUN');
  const restart = h('button', { class: 'tbtn', title: 'Aborts the running command and restarts it', onclick: () => {
    const r = e.restart();
    if (!r.ok) toast(r.reason!, 'error');
  } }, 'Restart Current Command');
  const st = h('span', { class: 'v strong' });
  const time = h('span', { class: 'v' });
  const err = h('span', { class: 'v' });
  const mx = h('span', { class: 'v' });
  const errText = h('div', { class: 'reject hidden' });
  const steps = h('ol', { class: 'emsteps' });
  const alist = alarmList(app, e.tag);
  const el = h('div', { class: 'faceplate' },
    h('div', { class: 'fp-sub' }, e.description),
    h('div', { class: 'em-grid' }, h('div', { class: 'lbl' }, 'Target'), target, h('div', { class: 'lbl' }, 'PV'), pv),
    h('div', { class: 'em-run' }, h('div', { class: 'lbl' }, 'Run Command'), sel, run),
    restart,
    h('div', { class: 'fp-grid' }, row('State', st), row('Time (s)', time), row('Error', err), row('Max Time Expired', mx)),
    errText, steps, alist.el);
  let sig = '';
  return {
    el,
    refresh: () => {
      target.textContent = e.target;
      pv.textContent = e.pv;
      st.textContent = e.state;
      time.textContent = e.time.toFixed(0);
      err.textContent = String(e.error);
      mx.textContent = String(e.maxTimeExpired);
      errText.classList.toggle('hidden', !e.errorText);
      errText.textContent = e.errorText;
      run.disabled = e.state === 'Running';
      const labels = e.stepLabels;
      const s2 = labels.map((x) => x.status).join(',') + e.state;
      if (s2 !== sig) {
        sig = s2;
        clear(steps);
        for (const l of labels) steps.append(h('li', { class: 'step ' + l.status }, l.label));
      }
      alist.refresh();
    },
  };
}

// ------------------------------------------------------------ detail (motor interlocks)
export function buildMotorDetail(app: App, tag: string): View {
  const d = app.plant.dc(tag);
  const tbody = h('tbody');
  const state = h('span', { class: 'v strong' });
  const info = h('div', { class: 'fp-grid' });
  const reset = h('button', { class: 'tbtn primary', onclick: () => {
    const r = d.resetFirstOut();
    if (!r.ok) toast(r.reason!, 'error');
    else app.flag(`reset:${tag}`);
  } }, 'Reset');
  const el = h('div', { class: 'detail' },
    h('div', { class: 'detail-title' }, `${tag} – Detail`),
    info,
    h('table', { class: 'conds' },
      h('thead', null, h('tr', null, h('th', null, 'First out'), h('th', null, 'Permissive / interlock condition'), h('th', null, 'Active'), h('th', null, 'Bypass'))), tbody),
    h('div', { class: 'toolbar' }, reset, h('span', { class: 'hint' }, 'First-out is cleared with Reset once the conditions are no longer active. Bypass needs Supervisor privilege.')));
  const built = new Map<string, { tr: HTMLElement; fo: HTMLElement; act: HTMLElement; cb: HTMLInputElement }>();
  return {
    el,
    refresh: () => {
      if (!built.size) {
        for (const c of d.conditions) {
          const fo = h('td', { class: 'fo' });
          const act = h('td', null);
          const cb = h('input', { type: 'checkbox', onchange: () => { d.setBypass(c.id, cb.checked); app.flag('bypass'); } });
          const tr = h('tr', null, fo, h('td', { class: 'ctext' }, c.text), act, h('td', null, cb));
          tbody.append(tr);
          built.set(c.id, { tr, fo, act, cb });
        }
      }
      for (const c of d.conditions) {
        const b = built.get(c.id)!;
        const active = c.blocking() && !c.bypassed;
        b.tr.className = active ? 'active' : '';
        b.fo.textContent = d.firstOut === c.id ? '➤' : '';
        b.act.textContent = c.blocking() ? 'ACTIVE' : '—';
        b.cb.checked = c.bypassed;
        b.cb.disabled = !app.can('bypass');
        b.cb.title = app.can('bypass') ? '' : 'Bypass requires Supervisor privilege';
      }
      clear(info);
      info.append(
        row('PV', d.pv === null ? 'IN TRANSIT' : d.cfg.pvNames[d.pv]),
        row('SP', d.cfg.spNames[d.sp]),
        row('Device state', d.deviceState),
        row('Mode', d.target));
      void state;
    },
  };
}
