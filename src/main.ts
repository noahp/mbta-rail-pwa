/// <reference types="vite-plugin-pwa/client" />
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { init } from './app';

init().catch(console.error);

const updateSW = registerSW({
  onNeedRefresh() {
    const banner = document.getElementById('update-banner');
    if (banner) banner.hidden = false;
  },
});

document.getElementById('update-apply')?.addEventListener('click', () => {
  void updateSW(true);
});
