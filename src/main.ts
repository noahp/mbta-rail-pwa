/// <reference types="vite-plugin-pwa/client" />
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { init } from './app';

init().catch(console.error);

registerSW({ onOfflineReady() {} });
