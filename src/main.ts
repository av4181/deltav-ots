import './style.css';
import './dv.css';
import { App } from './ui/app';

const root = document.querySelector<HTMLDivElement>('#app')!;
const app = new App(root);

window.addEventListener('pointerdown', () => app.unlockAudio(), { once: true });