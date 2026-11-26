import type { AnalogInput } from '../dcs/ai';
import type { DiscreteDevice } from '../dcs/discrete';
import type { EquipmentModule } from '../dcs/em';
import type { Pid } from '../dcs/pid';
import type { Mode } from '../dcs/types';
import { AlarmTable } from './alarmUi';
import type { App } from './app';
import { NumField, clear, fmt, h, toast, type Child } from './dom';
import { ICONS } from './icons';
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
  switch (m.kind) {
    case 'AI': return { title: tag, view: aiFaceplate(app, app.plant.ai(tag)), w: 250 };
    case 'DC': return { title: tag, view: discreteFaceplate(app, app.plant.dc(tag)), w: 250 };
    case 'PID': return { title: tag, view: pidFaceplate(app, app.plant.pid(tag)), w: 270 };
    case 'EM': return { title: tag, view: emFaceplate(app, app.plant.em(tag)), w: 270 };
    default: return null;
  }
}

// ------------------------------------------------------------ gedeelde bouwstenen (DeltaV Live faceplate)
function head(app: App, tag: string): HTMLElement {
  return h('div', { class: 'fpl-head' }, h('div', { class: 'fpl-tag' }, tag), h('div', { class: 'fpl-desc' }, app.plant.mod(tag)?.description ?? ''));
}

/** vijf ronde snelkoppelingen onder in het faceplate: detail, primary control, Control Studio, Process History View, alarmen bevestigen */
function shortcuts(app: App, tag: string, opts: { detail?: boolean } = {}): HTMLElement {
  const btn = (icon: string, title: string, f: (() => void) | null) => {
    const b = h('button', { class: 'fpl-sc', title, disabled: !f, onclick: f ?? undefined });
    b.innerHTML = ICONS[icon];
    return b;
  };
  return h('div', { class: 'fpl-shortcuts' },
    btn('detail', opts.detail ? 'Open the module’s detail display' : 'No detail display for this module', opts.detail ? () => app.openDetail(tag) : null),
    btn('primary', 'Open the module’s primary control display', () => app.gotoModule(tag)),
    btn('studio', 'Open the module in Control Studio (not available for operators)', null),
    btn('phv', 'Open Process History View (chart + events)', () => app.openPhv({ module: tag })),
    btn('ack', 'Acknowledge all alarms visible in the faceplate', () => { app.alarms.ackMany(app.alarms.forModule(tag).map((a) => a.id)); app.flag('acked'); }),
  );
}

function alarmList(app: App, tag: string): AlarmTable {
  return new AlarmTable(app, () => app.alarms.forModule(tag), ['ack', 'param', 'help'], { compact: true, empty: '' });
}

const lblRow = (k: string, v: HTMLElement | string): HTMLElement => h('div', { class: 'fpl-kv' }, h('span', { class: 'fpl-k' }, k), h('span', { class: 'fpl-v' }, v));

function modeLine(target: string, actual: string): string {
  return target === actual ? actual : `! ${actual}`;
}

/** moduswissel: transparante select over het mode-label (target klein, actual groot) */
function modeBox(options: string[], get: () => { target: string; actual: string }, set: (m: string) => void): { el: HTMLElement; refresh: () => void } {
  const tgt = h('div', { class: 'fpl-mode-t' });
  const act = h('div', { class: 'fpl-mode-a' });
  const sel = h('select', { class: 'fpl-mode-sel', title: 'Change target mode', onchange: () => set(sel.value) }, ...options.map((m) => h('option', { value: m }, m)));
  return {
    el: h('div', { class: 'fpl-mode' }, tgt, act, sel),
    refresh: () => {
      const m = get();
      tgt.textContent = m.target;
      act.textContent = modeLine(m.target, m.actual);
      act.classList.toggle('abn', m.target !== m.actual);
      if (document.activeElement !== sel) sel.value = m.target;
    },
  };
}

// ------------------------------------------------------------ discreet (klep / motor)
function discreteFaceplate(app: App, d: DiscreteDevice): View {
  const pv = h('div', { class: 'fpl-pv' });
  const reject = h('div', { class: 'reject hidden' });
  const noPermit = h('div', { class: 'nopermit hidden' }, '⊘ No permit');
  const btns = ([0, 1] as const).map((v) =>
    h('button', { class: 'fpl-state', onclick: () => {
      const r = d.setSp(v);
      if (!r.ok) toast(r.reason ?? 'Write rejected', 'error');
      app.flag(`sp:${d.tag}`);
    } }, d.cfg.spNames[v]));
  const mode = modeBox(['AUTO', 'CAS', 'OOS'], () => ({ target: d.target, actual: d.actual }), (m) => { d.setMode(m as 'AUTO' | 'CAS' | 'OOS'); app.flag(`mode:${d.tag}`); });
  const accept = h('input', { type: 'checkbox', onchange: () => { d.accept = accept.checked; } });
  const limit = h('span');
  const elapsed = h('span');
  const state = h('span');
  const fail = h('span');
  const alist = alarmList(app, d.tag);
  const el = h('div', { class: 'faceplate fpl' },
    head(app, d.tag), pv, noPermit,
    h('div', { class: 'fpl-mid' }, h('div', { class: 'fpl-states' }, ...btns), mode.el),
    reject,
    h('label', { class: 'fpl-accept' }, accept, ' Accept'),
    h('div', { class: 'fpl-sec' }, 'State Transition'),
    lblRow('Time Limit', limit), lblRow('Elapsed Time', elapsed),
    h('div', { class: 'fpl-sec' }, 'Device State'), h('div', { class: 'fpl-state-txt' }, state),
    h('div', { class: 'fpl-sec' }, 'Fail Alarm'), h('div', { class: 'fpl-state-txt' }, fail),
    alist.el,
    shortcuts(app, d.tag, { detail: d.kindLabel === 'MOTOR' }));
  return {
    el,
    refresh: () => {
      const p = d.pv;
      pv.textContent = p === null ? 'IN TRANSIT' : d.cfg.pvNames[p];
      pv.className = 'fpl-pv' + (p === null ? ' transit' : '');
      btns.forEach((b, v) => {
        b.classList.toggle('sp', d.sp === v);
        b.disabled = d.target !== 'AUTO';
      });
      mode.refresh();
      accept.checked = d.accept;
      limit.textContent = `${d.cfg.timeLimit} s`;
      elapsed.textContent = `${d.elapsed.toFixed(1)} s`;
      state.textContent = d.deviceState;
      fail.textContent = d.failText;
      fail.className = d.failActive ? 'bad' : '';
      noPermit.classList.toggle('hidden', !d.noPermit);
      reject.classList.toggle('hidden', !d.lastReject);
      if (d.lastReject) reject.textContent = d.lastReject.text;
      alist.refresh();
    },
  };
}

// ------------------------------------------------------------ verticale balk met schaal, SP-marker en alarmgrenzen
function vbar(lo: number, hi: number, limits: { limit: number; param: string; priority: string }[]) {
  const fill = h('div', { class: 'fpl-fill' });
  const sp = h('div', { class: 'fpl-spmark', title: 'Setpoint' });
  const bar = h('div', { class: 'fpl-vbar' }, fill);
  for (const l of limits) {
    const m = h('div', { class: `fpl-lim ${l.priority.toLowerCase()}`, title: `${l.param} ${l.limit}` });
    m.style.bottom = ((l.limit - lo) / (hi - lo)) * 100 + '%';
    bar.append(m);
  }
  const scale = h('div', { class: 'fpl-vscale' }, h('span', null, String(hi)), h('span', null, String(lo)));
  const el = h('div', { class: 'fpl-vwrap' }, scale, bar, sp);
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  return {
    el, bar,
    set: (pv: number, spv?: number) => {
      fill.style.height = pct(pv) + '%';
      sp.style.display = spv === undefined ? 'none' : '';
      if (spv !== undefined) sp.style.bottom = `calc(${pct(spv)}% - 5px)`;
    },
  };
}

// ------------------------------------------------------------ analoge ingang
function aiFaceplate(app: App, a: AnalogInput): View {
  const pv = h('div', { class: 'fpl-pv num' });
  const bar = vbar(a.lo, a.hi, a.limits.specs);
  const trend = new TrendChart(app, penPaths(app, a.tag), { axes: false, height: 70, span: 600 });
  const alist = alarmList(app, a.tag);
  const el = h('div', { class: 'faceplate fpl' },
    head(app, a.tag),
    h('div', { class: 'fpl-vals' }, h('div', { class: 'fpl-val' }, pv, h('div', { class: 'fpl-eu' }, a.eu))),
    h('div', { class: 'fpl-mid' }, bar.el, h('div', { class: 'fpl-hint' }, 'Analog input – display only')),
    h('div', { class: 'fpl-trend' }, trend.el),
    alist.el, shortcuts(app, a.tag));
  return {
    el,
    refresh: () => {
      pv.textContent = fmt(a.pv, 1);
      pv.classList.toggle('bad', a.status === 'BAD');
      bar.set(a.pv);
      trend.draw();
      alist.refresh();
    },
    dispose: () => trend.dispose(),
  };
}

// ------------------------------------------------------------ PID
function pidFaceplate(app: App, p: Pid): View {
  const pv = h('div', { class: 'fpl-pv num' });
  const spField = new NumField(() => p.sp, (v) => { const r = p.setSp(v); if (!r.ok) toast(r.reason!, 'error'); else app.flag(`sp:${p.tag}`); },
    { width: 56, decimals: p.hi <= 100 ? 1 : 0, enabled: () => p.actual === 'AUTO' });
  const outField = new NumField(() => p.out, (v) => { const r = p.setOut(v); if (!r.ok) toast(r.reason!, 'error'); else app.flag(`out:${p.tag}`); },
    { width: 56, decimals: 1, enabled: () => p.actual === 'MAN' });
  outField.el.classList.add('fpl-out-in');
  const step = p.span / 100;
  const slew = (dir: number) => h('button', { class: 'fpl-slew', title: dir > 0 ? 'Increase SP' : 'Decrease SP', onclick: () => { const r = p.setSp(p.sp + dir * step); if (!r.ok) toast(r.reason!, 'error'); } }, dir > 0 ? '▲' : '▼');
  const modes: Mode[] = p.primary ? ['AUTO', 'MAN', 'CAS', 'OOS'] : ['AUTO', 'MAN', 'OOS'];
  const mode = modeBox(modes, () => ({ target: p.target, actual: p.actual }), (m) => {
    const r = p.setMode(m as Mode);
    if (!r.ok) toast(r.reason!, 'error');
    app.flag(`mode:${p.tag}`);
  });
  const bypass = p.primary ? h('input', { type: 'checkbox', onchange: () => p.setBypass(bypass!.checked) }) : null;
  const bar = vbar(p.lo, p.hi, p.limits.specs);
  // SP verslepen op de balk (SP slider)
  const dragSp = (e: PointerEvent) => {
    if (p.actual !== 'AUTO') return;
    const r = bar.bar.getBoundingClientRect();
    const f = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    const res = p.setSp(p.lo + f * p.span);
    if (!res.ok) toast(res.reason!, 'error');
  };
  bar.bar.addEventListener('pointerdown', (e) => {
    bar.bar.setPointerCapture(e.pointerId);
    dragSp(e);
    const mv = (ev: PointerEvent) => dragSp(ev);
    const up = () => { bar.bar.removeEventListener('pointermove', mv); bar.bar.removeEventListener('pointerup', up); };
    bar.bar.addEventListener('pointermove', mv);
    bar.bar.addEventListener('pointerup', up);
  });
  bar.bar.title = 'Click or drag to set the setpoint (AUTO)';
  const outFill = h('div', { class: 'fpl-ofill' });
  const outBar = h('div', { class: 'fpl-hbar' }, outFill);
  const trend = new TrendChart(app, penPaths(app, p.tag), { axes: false, height: 70, span: 600 });
  const alist = alarmList(app, p.tag);
  const el = h('div', { class: 'faceplate fpl' },
    head(app, p.tag),
    h('div', { class: 'fpl-vals' },
      h('div', { class: 'fpl-val' }, pv, h('div', { class: 'fpl-eu' }, p.eu)),
      h('div', { class: 'fpl-val out' }, outField.el, h('div', { class: 'fpl-eu' }, '%'))),
    h('div', { class: 'fpl-mid pid' },
      h('div', { class: 'fpl-sp' }, slew(1), spField.el, slew(-1)),
      bar.el, mode.el),
    h('div', { class: 'fpl-hwrap' }, h('span', null, '0.0'), outBar, h('span', null, '100.0')),
    h('div', { class: 'fpl-trend' }, trend.el),
    bypass ? h('label', { class: 'fpl-accept' }, bypass, ' Cascade BYPASS') : null,
    alist.el, shortcuts(app, p.tag));
  return {
    el,
    refresh: () => {
      pv.textContent = fmt(p.pv, 1);
      pv.classList.toggle('bad', p.pvBad);
      spField.refresh();
      outField.refresh();
      mode.refresh();
      if (bypass) bypass.checked = p.bypass;
      bar.set(p.pv, p.sp);
      outFill.style.width = Math.max(0, Math.min(100, p.out)) + '%';
      trend.draw();
      alist.refresh();
    },
    dispose: () => trend.dispose(),
  };
}

// ------------------------------------------------------------ Equipment Module
function emFaceplate(app: App, e: EquipmentModule): View {
  const target = h('div', { class: 'fpl-em-t' });
  const pv = h('div', { class: 'fpl-em-p' });
  const sel = h('select', { class: 'fpl-cmd' }, ...e.commandNames.map((c) => h('option', { value: c }, c)));
  const run = h('button', { class: 'fpl-btn', onclick: () => {
    const r = e.run(sel.value);
    if (!r.ok) toast(r.reason!, 'error');
    app.flag(`em:${sel.value}`);
  } }, 'Run');
  const restart = h('button', { class: 'fpl-btn wide', title: 'Aborts the running command and restarts it', onclick: () => {
    const r = e.restart();
    if (!r.ok) toast(r.reason!, 'error');
  } }, 'Restart Current Command');
  const st = h('span');
  const time = h('span');
  const err = h('span');
  const mx = h('span');
  const errText = h('div', { class: 'reject hidden' });
  const steps = h('ol', { class: 'emsteps' });
  const alist = alarmList(app, e.tag);
  const el = h('div', { class: 'faceplate fpl' },
    head(app, e.tag), target, pv,
    h('div', { class: 'fpl-sec' }, 'Run Command'),
    h('div', { class: 'fpl-runrow' }, sel, run), restart,
    h('div', { class: 'fpl-states-info' }, lblRow('State', st), lblRow('Time', time), lblRow('Error', err), lblRow('Max Time Expired', mx)),
    errText, steps, alist.el, shortcuts(app, e.tag));
  let sig = '';
  return {
    el,
    refresh: () => {
      target.textContent = e.target;
      pv.textContent = e.pv;
      st.textContent = e.state;
      time.textContent = e.time.toFixed(2);
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

function row(label: string, value: Child): HTMLElement {
  return h('div', { class: 'kv' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, value));
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
