import { SimplexNoise3D } from './simplex3d';
import {
  TERRAIN_COLOR_CONFIG,
  buildRawDistribution,
  colorFromElevationFeet,
  percentileToElevationFeet,
  rawNoiseOnSphere,
  rawToPercentile,
  shadeFromNormal,
  STD_DEVS,
} from './terrain';

type ReadyMsg = { type: 'TFW_READY'; viewer: 'winkel'; nonce: string };
type PingMsg = { type: 'TFW_PING'; viewer: 'winkel' };

type InitMsg = {
  type: 'TFW_WINKEL_INIT';
  viewer: 'winkel';
  nonce: string;
  title: string;
  seed: number;
  oceanSAFraction: number;
  subdivisions: number;
  qualityHeightPx: number;
};

type Mapping = {
  width: number;
  height: number;
  valid: Uint8Array;
  sinLat: Float32Array;
  cosLat: Float32Array;
  sinLonRel: Float32Array;
  cosLonRel: Float32Array;
};

const ASPECT = (Math.PI + 2) / Math.PI; // ~1.63662
const MAX_Y = Math.PI / 2;
const MAX_X = (Math.PI + 2) / 2;
const PHI1 = Math.acos(2 / Math.PI);
const COS_PHI1 = Math.cos(PHI1);
const TWO_PI = Math.PI * 2;

function getNonceFromHash(): string {
  const h = (window.location.hash || '').replace(/^#/, '');
  const m = /(?:^|&)nonce=([^&]+)/.exec(h);
  return m ? decodeURIComponent(m[1]) : '';
}

function randomNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function setHud(text: string) {
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = text;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function wrapPi(lam: number): number {
  lam = ((lam + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
  return lam;
}

function wrapTwoPi(lam: number): number {
  lam = lam % TWO_PI;
  if (lam < 0) lam += TWO_PI;
  return lam;
}

function sinc(x: number): number {
  const ax = Math.abs(x);
  if (ax < 1e-6) {
    const x2 = x * x;
    return 1 - x2 / 6;
  }
  return Math.sin(x) / x;
}

function winkelForward(lambda: number, phi: number): { x: number; y: number } {
  // Aitoff
  const halfLam = lambda / 2;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const cosHalfLam = Math.cos(halfLam);
  const sinHalfLam = Math.sin(halfLam);

  const alpha = Math.acos(clamp(cosPhi * cosHalfLam, -1, 1));
  const s = sinc(alpha);

  let xA: number;
  let yA: number;
  if (Math.abs(alpha) < 1e-12) {
    // Limit as alpha->0
    xA = 2 * cosPhi * sinHalfLam;
    yA = sinPhi;
  } else {
    xA = (2 * cosPhi * sinHalfLam) / s;
    yA = sinPhi / s;
  }

  const x = 0.5 * (xA + lambda * COS_PHI1);
  const y = 0.5 * (yA + phi);
  return { x, y };
}

function winkelInverse(xT: number, yT: number): { lambda: number; phi: number } | null {
  // Initial guess: treat x ~ lambda*(cos(phi)+cos(phi1))/2 and y ~ phi/2
  let phi = clamp(2 * yT, -MAX_Y, MAX_Y);
  const denom = COS_PHI1 + Math.cos(phi);
  let lambda = denom !== 0 ? (2 * xT) / denom : 0;
  lambda = clamp(lambda, -Math.PI, Math.PI);

  const eps = 1e-6;
  const tol = 5e-9;

  for (let iter = 0; iter < 7; iter++) {
    const f = winkelForward(lambda, phi);
    const Fx = f.x - xT;
    const Fy = f.y - yT;
    if (Math.abs(Fx) + Math.abs(Fy) < tol) {
      return { lambda: wrapPi(lambda), phi: clamp(phi, -MAX_Y, MAX_Y) };
    }

    const fLam = winkelForward(lambda + eps, phi);
    const fPhi = winkelForward(lambda, phi + eps);

    const dxdLam = (fLam.x - f.x) / eps;
    const dydLam = (fLam.y - f.y) / eps;
    const dxdPhi = (fPhi.x - f.x) / eps;
    const dydPhi = (fPhi.y - f.y) / eps;

    const det = dxdLam * dydPhi - dxdPhi * dydLam;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;

    const dLam = (Fx * dydPhi - Fy * dxdPhi) / det;
    const dPhi = (Fy * dxdLam - Fx * dydLam) / det;

    // Small trust region for stability.
    const stepLam = clamp(dLam, -0.75, 0.75);
    const stepPhi = clamp(dPhi, -0.75, 0.75);

    lambda = wrapPi(lambda - stepLam);
    phi = clamp(phi - stepPhi, -MAX_Y, MAX_Y);
  }

  // Final check
  const fEnd = winkelForward(lambda, phi);
  const err = Math.abs(fEnd.x - xT) + Math.abs(fEnd.y - yT);
  if (err < 2e-6) return { lambda: wrapPi(lambda), phi: clamp(phi, -MAX_Y, MAX_Y) };
  return null;
}

async function buildMapping(width: number, height: number, label: string): Promise<Mapping> {
  setHud(`Precomputing ${label} mapping…`);

  const n = width * height;
  const valid = new Uint8Array(n);
  const sinLat = new Float32Array(n);
  const cosLat = new Float32Array(n);
  const sinLonRel = new Float32Array(n);
  const cosLonRel = new Float32Array(n);

  // Chunk the work to keep the UI responsive.
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    const projY = (1 - v * 2) * MAX_Y;

    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const projX = (u * 2 - 1) * MAX_X;

      const inv = winkelInverse(projX, projY);
      const i = y * width + x;
      if (!inv) {
        valid[i] = 0;
        continue;
      }

      // Validate by forward-projection error to ensure we stay inside the silhouette.
      const fwd = winkelForward(inv.lambda, inv.phi);
      const err = Math.abs(fwd.x - projX) + Math.abs(fwd.y - projY);
      if (err > 2e-3) {
        valid[i] = 0;
        continue;
      }

      const sLat = Math.sin(inv.phi);
      const cLat = Math.cos(inv.phi);
      valid[i] = 1;
      sinLat[i] = sLat;
      cosLat[i] = cLat;
      sinLonRel[i] = Math.sin(inv.lambda);
      cosLonRel[i] = Math.cos(inv.lambda);
    }

    if ((y & 15) === 15) {
      setHud(`Precomputing ${label} mapping… ${Math.round(((y + 1) / height) * 100)}%`);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  return { width, height, valid, sinLat, cosLat, sinLonRel, cosLonRel };
}

function allocateCanvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('2D canvas not available');
  const img = ctx.createImageData(width, height);
  return { canvas, ctx, img };
}

function renderWinkel(
  mapping: Mapping,
  out: ImageData,
  lambda0: number,
  noise: SimplexNoise3D,
  sortedRaw: Float32Array,
  seaLevelFeet: number,
): void {
  const { width, height, valid, sinLat, cosLat, sinLonRel, cosLonRel } = mapping;
  if (out.width !== width || out.height !== height) throw new Error('ImageData size mismatch');

  const data = out.data;
  const sin0 = Math.sin(lambda0);
  const cos0 = Math.cos(lambda0);

  // Fill with transparent black.
  data.fill(0);

  for (let i = 0; i < valid.length; i++) {
    if (valid[i] === 0) continue;

    const sLat = sinLat[i];
    const cLat = cosLat[i];

    // lon = lonRel + lambda0
    const sRel = sinLonRel[i];
    const cRel = cosLonRel[i];
    const sLon = sRel * cos0 + cRel * sin0;
    const cLon = cRel * cos0 - sRel * sin0;

    const nx = cLat * sLon;
    const ny = sLat;
    const nz = cLat * cLon;

    const raw = rawNoiseOnSphere(nx, ny, nz, noise);
    const pct = rawToPercentile(sortedRaw, raw);
    const elevFeet = percentileToElevationFeet(pct, STD_DEVS).elevFeet;

    const baseColor = colorFromElevationFeet(elevFeet, seaLevelFeet, TERRAIN_COLOR_CONFIG);
    const shade = shadeFromNormal(nx, ny, nz, [0.35, 0.85, 0.4], 0.72);

    const di = i * 4;
    data[di + 0] = Math.max(0, Math.min(255, Math.round(baseColor[0] * shade * 255)));
    data[di + 1] = Math.max(0, Math.min(255, Math.round(baseColor[1] * shade * 255)));
    data[di + 2] = Math.max(0, Math.min(255, Math.round(baseColor[2] * shade * 255)));
    data[di + 3] = 255;
  }
}

function main() {
  let nonce = getNonceFromHash();
  if (!nonce) {
    nonce = randomNonce();
    try {
      history.replaceState(null, '', `#nonce=${encodeURIComponent(nonce)}`);
    } catch {
      // Ignore; nonce is still valid for runtime matching.
    }
  }

  const canvasEl = document.getElementById('c');
  if (!(canvasEl instanceof HTMLCanvasElement)) throw new Error('Missing canvas');
  const canvas = canvasEl;

  const displayCtx = canvas.getContext('2d', { alpha: false });
  if (!displayCtx) throw new Error('2D canvas not available');
  const display2d = displayCtx;

  let dpr = 1;
  let viewW = 1;
  let viewH = 1;

  let usedInitialCanvasSize = false;
  let lockCssSizeUntilWindowResize = true;

  let seed = 0;
  let oceanSAFraction = 0.71;
  let subdivisions = 8;
  let qualityHeightPx = 600;

  let noise: SimplexNoise3D | null = null;
  let sortedRaw: Float32Array | null = null;
  let seaLevelFeet = 0;

  let mappingFull: Mapping | null = null;
  let mappingPreview: Mapping | null = null;

  let fullBuf: ReturnType<typeof allocateCanvas2d> | null = null;
  let previewBuf: ReturnType<typeof allocateCanvas2d> | null = null;

  let lambda0 = 0;

  let dragging = false;
  let lastClientX = 0;

  let renderPending = false;
  let renderInProgress = false;
  let usePreview = false;
  let renderToken = 0;

  function resize() {
    dpr = Math.max(1, window.devicePixelRatio || 1);

    const maxCssW = Math.max(1, window.innerWidth);
    const maxCssH = Math.max(1, window.innerHeight);

    // Initial load: prefer a 600px-tall canvas (if it fits).
    // After that, behave like flatmap: keep the aspect and fit within the window.
    let cssH = Number.NaN;
    let cssW = Number.NaN;

    // Keep the initial canvas size stable during startup/initial renders.
    // After the user actually resizes the window, switch to aspect-fit sizing.
    if (lockCssSizeUntilWindowResize) {
      const existingH = Number.parseFloat(canvas.style.height || '');
      const existingW = Number.parseFloat(canvas.style.width || '');
      if (Number.isFinite(existingH) && Number.isFinite(existingW) && existingH > 0 && existingW > 0) {
        cssH = Math.min(existingH, maxCssH);
        cssW = Math.min(existingW, maxCssW);
      }
    }

    if (!Number.isFinite(cssH) || !Number.isFinite(cssW)) {
    if (!usedInitialCanvasSize) {
      const desiredH = 600;
      const desiredW = desiredH * ASPECT;
      if (desiredH <= maxCssH && desiredW <= maxCssW) {
        cssH = desiredH;
        cssW = desiredW;
      } else {
        cssH = Math.min(maxCssH, maxCssW / ASPECT);
        cssW = cssH * ASPECT;
      }
      usedInitialCanvasSize = true;
    } else {
      cssH = Math.min(maxCssH, maxCssW / ASPECT);
      cssW = cssH * ASPECT;
    }
    }

    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    viewW = Math.max(1, Math.floor(cssW * dpr));
    viewH = Math.max(1, Math.floor(cssH * dpr));

    canvas.width = viewW;
    canvas.height = viewH;

    display2d.imageSmoothingEnabled = false;
  }

  function requestRender(preview: boolean) {
    usePreview = preview;
    if (renderPending) return;
    renderPending = true;
    void requestAnimationFrame(() => {
      renderPending = false;
      void render();
    });
  }

  async function render() {
    if (renderInProgress) return;
    renderInProgress = true;
    const token = ++renderToken;

    try {
      if (!noise || !sortedRaw) return;
      resize();

      const buf = usePreview ? previewBuf : fullBuf;
      const map = usePreview ? mappingPreview : mappingFull;
      if (!buf || !map) return;

      setHud(dragging ? 'Dragging… (preview)' : 'Rendering…');

      renderWinkel(map, buf.img, lambda0, noise, sortedRaw, seaLevelFeet);
      buf.ctx.putImageData(buf.img, 0, 0);

      // Scale to fill the fixed-aspect canvas.
      display2d.clearRect(0, 0, viewW, viewH);
      display2d.drawImage(buf.canvas, 0, 0, viewW, viewH);

      if (token === renderToken) {
        setHud('Drag left/right (wraps longitude)');
      }
    } finally {
      renderInProgress = false;
    }
  }

  function dxToDeltaLambda(dxDevicePx: number): number {
    // Convert screen dx to projection-plane dx, then approximate dλ from dx at the equator.
    // x ≈ λ*(cosφ + cosφ1)/2, with cosφ≈1 at equator.
    const pixelsPerProj = viewW / (2 * MAX_X);
    const dxProj = dxDevicePx / pixelsPerProj;
    const scale = 2 / (1 + COS_PHI1);
    return -dxProj * scale;
  }

  async function initRenderer() {
    setHud('Building terrain distribution…');
    const dist = buildRawDistribution(seed, subdivisions);
    sortedRaw = dist.sortedRaw;
    noise = new SimplexNoise3D(seed);

    seaLevelFeet = percentileToElevationFeet(oceanSAFraction, STD_DEVS).elevFeet;

    //note: these are graphics quality settings, not for setting dimensions per se.
    const fullH = Math.max(100, Math.floor(qualityHeightPx));
    const fullW = Math.round(fullH * ASPECT);

    // Lower-res buffer while dragging for responsiveness.
    const PREVIEW_QUALITY_FRACTION = .35; //[0, 1]
    const previewH = Math.min(fullH, Math.max(100, Math.round(fullH * Math.max(.1, PREVIEW_QUALITY_FRACTION))));
    const previewW = Math.round(previewH * ASPECT);

    // Build preview mapping first so the user gets something quickly.
    mappingPreview = await buildMapping(previewW, previewH, 'preview');
    previewBuf = allocateCanvas2d(previewW, previewH);

    resize();
    usePreview = true;
    requestRender(true);

    // Then build full mapping.
    mappingFull = await buildMapping(fullW, fullH, 'full');
    fullBuf = allocateCanvas2d(fullW, fullH);

    usePreview = false;
    requestRender(false);
  }

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastClientX = e.clientX;
    canvas.style.cursor = 'grabbing';
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dxDevice = (e.clientX - lastClientX) * dpr;
    lastClientX = e.clientX;

    lambda0 = wrapTwoPi(lambda0 + dxToDeltaLambda(dxDevice));
    requestRender(true);
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = 'grab';
    requestRender(false);
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  window.addEventListener('resize', () => {
    lockCssSizeUntilWindowResize = false;
    resize();
    requestRender(dragging);
  });

  window.addEventListener('message', (ev: MessageEvent) => {
    const anyData = ev.data as PingMsg | InitMsg;
    if (!anyData) return;

    if (anyData.type === 'TFW_PING' && anyData.viewer === 'winkel') {
      const ready: ReadyMsg = { type: 'TFW_READY', viewer: 'winkel', nonce };
      window.opener?.postMessage(ready, '*');
      return;
    }

    const data = anyData as InitMsg;
    if (data.type !== 'TFW_WINKEL_INIT' || data.viewer !== 'winkel') return;
    if (data.nonce !== nonce) return;

    document.title = data.title;
    seed = data.seed;
    oceanSAFraction = data.oceanSAFraction;
    subdivisions = data.subdivisions;
    qualityHeightPx = data.qualityHeightPx;

    void initRenderer().catch((err) => {
      setHud('Failed to render');
      const msg = err && (err as Error).message ? (err as Error).message : String(err);
      document.body.textContent = 'Failed to initialize Winkel Tripel viewer: ' + msg;
    });
  });

  // Initial sizing, then wait for init.
  resize();

  const ready: ReadyMsg = { type: 'TFW_READY', viewer: 'winkel', nonce };
  window.opener?.postMessage(ready, '*');
}

main();
