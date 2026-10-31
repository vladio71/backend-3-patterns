// Сторінка /scheme: схема проєкту (docs/architecture.excalidraw) в Excalidraw у режимі перегляду.
// Цей файл збирає esbuild у public/scheme.js командою npm run build:scheme (входить у npm run build).
// У темній темі Excalidraw інвертує картинку фільтром, і пастельні заливки стають брудними, тому полотно
// лишаємо в light, а елементи перефарбовуємо самі: темна заливка того ж відтінку, світлий текст.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, restoreElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

type SceneElement = Record<string, unknown>;
interface Hsl { h: number; s: number; l: number }

function hexToHsl(hex: string): Hsl | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const f = (p: number, q: number, t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number; let g: number; let b: number;
  if (s === 0) { r = g = b = l; } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3);
  }
  const to = (v: number): string => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

const darkFill = (hex: string): string => {
  const c = hexToHsl(hex);
  if (!c) return hex;
  if (c.s < 0.08) return '#1d2026';
  return hslToHex({ h: c.h, s: Math.min(c.s, 0.45), l: 0.24 });
};
const darkStroke = (hex: string): string => {
  const c = hexToHsl(hex);
  if (!c) return hex;
  if (c.s < 0.12) return c.l < 0.4 ? '#e6e8eb' : '#aeb4bb';
  return hslToHex({ h: c.h, s: Math.max(c.s, 0.5), l: 0.68 });
};

function recolorForDark(elements: SceneElement[]): SceneElement[] {
  return elements.map((el) => ({
    ...el,
    backgroundColor: typeof el.backgroundColor === 'string' && el.backgroundColor !== 'transparent' ? darkFill(el.backgroundColor) : el.backgroundColor,
    strokeColor: typeof el.strokeColor === 'string' ? darkStroke(el.strokeColor) : el.strokeColor,
  }));
}

/** Вписати схему за шириною і стати в її лівий верхній кут: висока схема, вписана за висотою, нечитабельна. */
function fit(api: ExcalidrawImperativeAPI, elements: SceneElement[], attempt = 0): void {
  const drawn = elements.filter((el) => (el.width as number) > 0 || (el.height as number) > 0) as Array<{ x: number; y: number; width: number }>;
  if (!drawn.length) return;
  const { width } = api.getAppState();
  if (!width && attempt < 20) { setTimeout(() => fit(api, elements, attempt + 1), 50); return; }
  const minX = Math.min(...drawn.map((el) => el.x));
  const minY = Math.min(...drawn.map((el) => el.y));
  const maxX = Math.max(...drawn.map((el) => el.x + el.width));
  const margin = 24;
  const zoom = Math.min(1, Math.max(0.2, (width - 2 * margin) / (maxX - minX)));
  api.updateScene({ appState: { zoom: { value: zoom as never }, scrollX: margin / zoom - minX, scrollY: margin / zoom - minY } });
}

declare global { interface Window { EXCALIDRAW_ASSET_PATH?: string } }

async function main(): Promise<void> {
  window.EXCALIDRAW_ASSET_PATH = '/scheme-assets/';
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const scene = (await (await fetch('/scheme.excalidraw')).json()) as { elements: SceneElement[] };
  const source = dark ? recolorForDark(scene.elements) : scene.elements;
  const elements = restoreElements(source as never, null) as unknown as SceneElement[];
  const root = document.getElementById('root');
  if (!root) return;
  createRoot(root).render(
    React.createElement(Excalidraw, {
      viewModeEnabled: true,
      zenModeEnabled: true,
      theme: 'light',
      initialData: { elements: elements as never, appState: { viewBackgroundColor: dark ? '#111317' : '#ffffff' } },
      excalidrawAPI: (api: ExcalidrawImperativeAPI) => requestAnimationFrame(() => fit(api, elements)),
    }),
  );
}

void main();
