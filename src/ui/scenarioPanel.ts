import { SCENARIOS } from '../scenarios/library';
import type { App } from './app';
import { h } from './dom';
import type { View } from './wm';

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Scenario-venster: kiezen/starten, voortgang van de verwachte acties, instructeursnotitie en nabespreking. */
export function buildScenarioPanel(app: App): View {
  const el = h('div', { class: 'scn' });
  let shownKey = '';
  const render = (): void => {
    const e = app.scenario;
    const key = `${e?.def.id ?? '-'}|${e?.finished ?? ''}|${app.role}|${e?.results.map((r) => (r.doneAt === null ? 0 : 1)).join('')}`;
    if (key === shownKey) {
      const t = el.querySelector('.scn-time');
      if (t && e) t.textContent = `${mmss(e.elapsed)} / ${mmss(e.def.maxTime)}`;
      return;
    }
    shownKey = key;
    el.replaceChildren();
    if (!e) {
      el.append(
        h('p', { class: 'hint' }, 'Kies een scenario. De installatie wordt in de beginstand gezet en de tijd loopt.'),
        ...SCENARIOS.map((d) =>
          h('div', { class: 'scn-card' },
            h('div', { class: 'scn-title' }, d.title, h('span', { class: 'scn-lvl' }, d.level)),
            h('div', { class: 'scn-brief' }, d.briefing),
            h('button', { class: 'tbtn primary', onclick: () => app.startScenario(d.id) }, 'Start scenario')),
        ),
      );
      return;
    }
    el.append(
      h('div', { class: 'scn-title' }, e.def.title),
      h('div', { class: 'scn-brief' }, e.def.briefing),
      h('div', { class: 'scn-meta' }, 'Tijd: ', h('span', { class: 'scn-time' }, `${mmss(e.elapsed)} / ${mmss(e.def.maxTime)}`), e.def.speedHint ? `  · tip: snelheid ×${e.def.speedHint}` : ''),
    );
    if (e.finished) {
      el.append(h('div', { class: 'scn-score' }, `Score ${e.percent}%`), h('pre', { class: 'scn-debrief' }, e.debrief().join('\n')));
    } else if (app.isInstructor) {
      el.append(
        h('div', { class: 'scn-note' }, h('b', null, 'Instructeursnotitie: '), e.def.instructorNote),
        h('ul', { class: 'scn-actions' }, ...e.def.actions.map((a, i) => h('li', { class: e.results[i].doneAt !== null ? 'done' : '' }, `${e.results[i].doneAt !== null ? '✓' : '○'} ${a.text} (≤ ${mmss(a.until)})`))),
      );
    } else {
      el.append(h('p', { class: 'hint' }, 'Bedien de installatie zoals je in bedrijf zou doen. De beoordeling volgt na afloop.'));
    }
    el.append(
      h('div', { class: 'scn-btns' },
        !e.finished ? h('button', { class: 'tbtn', onclick: () => { e.finished = true; } }, 'Stop en toon nabespreking') : null,
        h('button', { class: 'tbtn', onclick: () => app.stopScenario() }, 'Sluiten / ander scenario')),
    );
  };
  return { el, refresh: render };
}
