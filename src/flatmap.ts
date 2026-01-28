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

export interface FlatMapOptions {
  seed: number;
  oceanSAFraction: number;
  sourceCanvasHeight: number; //no width needed is always 2:1
  subdivisions?: number;
}

export interface FlatMapViewerOptions extends FlatMapOptions {
  title?: string;
  reuseWindowName?: string;
  canvasMarginTopBottom?: number;
  canvasMarginLeftRight?: number;
  openAsTab?: boolean;
}

type FlatMapReadyMsg = { type: 'TFW_READY'; viewer: 'flatmap'; nonce: string };
type FlatMapPingMsg = { type: 'TFW_PING'; viewer: 'flatmap' };
type FlatMapInitMsg = {
  type: 'TFW_FLATMAP_INIT';
  viewer: 'flatmap';
  nonce: string;
  title: string;
  pngBlob: Blob;
};

function randomNonce(): string {
  // Not security-grade; just prevents cross-window message mixups.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function waitForViewerReady(target: Window, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for viewer to load'));
    }, timeoutMs);

    const pingMsg: FlatMapPingMsg = { type: 'TFW_PING', viewer: 'flatmap' };
    const pingInterval = window.setInterval(() => {
      try {
        target.postMessage(pingMsg, '*');
      } catch {
        // Ignore transient errors while the window is navigating.
      }
    }, 250);

    // Kick once immediately, too.
    try {
      target.postMessage(pingMsg, '*');
    } catch {
      // Ignore.
    }

    function cleanup() {
      window.clearTimeout(t);
      window.clearInterval(pingInterval);
      window.removeEventListener('message', onMsg);
    }

    function onMsg(ev: MessageEvent) {
      if (ev.source !== target) return;
      const data = ev.data as FlatMapReadyMsg;
      if (!data || data.type !== 'TFW_READY' || data.viewer !== 'flatmap') return;
      cleanup();
      resolve(data.nonce);
    }

    window.addEventListener('message', onMsg);
  });
}

function pickCanvasSize({
  sourceCanvasHeight,
}: {
  sourceCanvasHeight: number;
}): { width: number; height: number } {
  // Guarantee: output dimensions are >= the globe canvas dimensions.
  // Also keep an equirectangular 2:1 aspect.
  const height = Math.max(sourceCanvasHeight, 600);
  const width = height * 2;
  return { width, height };
}

async function renderFlatMapCanvas(opts: FlatMapOptions): Promise<HTMLCanvasElement> {
  const { seed, oceanSAFraction, sourceCanvasHeight, subdivisions = 8 } = opts;

  const { width, height } = pickCanvasSize({
    sourceCanvasHeight,
  });

  const seaLevelFeet = percentileToElevationFeet(oceanSAFraction, STD_DEVS).elevFeet;

  // Match globe percentile mapping by building the same raw distribution on an icosphere.
  const { sortedRaw } = buildRawDistribution(seed, subdivisions);
  const noise = new SimplexNoise3D(seed);

  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    const lat = Math.PI / 2 - v * Math.PI; // +pi/2 at north pole, -pi/2 at south pole
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);

    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const lon = u * Math.PI * 2 - Math.PI; // [-pi, pi)

      // Map lon=0 to +Z (front, as viewed by the camera) and lon increases toward +X (east/right).
      const nx = cosLat * Math.sin(lon);
      const ny = sinLat;
      const nz = cosLat * Math.cos(lon);

      const raw = rawNoiseOnSphere(nx, ny, nz, noise);
      const pct = rawToPercentile(sortedRaw, raw);
      const elevFeet = percentileToElevationFeet(pct, STD_DEVS).elevFeet;

      const baseColor = colorFromElevationFeet(elevFeet, seaLevelFeet, TERRAIN_COLOR_CONFIG);
      // Slightly brighter / more even illumination than the globe.
      const shade = shadeFromNormal(nx, ny, nz, [0.35, 0.85, 0.4], 0.72);

      const i = (y * width + x) * 4;
      data[i + 0] = Math.max(0, Math.min(255, Math.round(baseColor[0] * shade * 255)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(baseColor[1] * shade * 255)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(baseColor[2] * shade * 255)));
      data[i + 3] = 255;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  ctx.putImageData(new ImageData(data, width, height), 0, 0);
  return canvas;
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode PNG'))), 'image/png');
  });
}

export async function openFlatMapWindow(opts: FlatMapViewerOptions): Promise<void> {
  let viewerWin: Window | null;
  const name = opts.reuseWindowName ?? 'TerraformFlatMapViewer';
  const title = opts.title ?? 'Flat Map Viewer';
  const nonce = randomNonce();

  const canvasHeight = Math.max(opts.sourceCanvasHeight ?? 600);
  const canvasWidth = canvasHeight * 2; //ensure 2:1 aspect
  const marginTopBottom = opts.canvasMarginTopBottom ?? 0;
  const marginLeftRight = opts.canvasMarginLeftRight ?? 0;
  const openAsTab = opts.openAsTab ?? true;  //tab default

  if (openAsTab) {
    viewerWin = window.open(`flatmap.html#nonce=${encodeURIComponent(nonce)}`, name);
  } else {
    // initial window popup size
    const winW = Math.min(screen.availWidth, canvasWidth + marginLeftRight * 2);
    const winH = Math.min(screen.availHeight, canvasHeight + marginTopBottom * 2);

    viewerWin = window.open(
      `flatmap.html#nonce=${encodeURIComponent(nonce)}`,
      name,
      `popup=1,width=${winW},height=${winH},scrollbars=1,resizable=1`,
    );
  }

  if (!viewerWin) {
    throw new Error('Popup blocked while opening flat map viewer.');
  }

  const readyNonce = await waitForViewerReady(viewerWin);

  const srcCanvas = await renderFlatMapCanvas(opts);
  const pngBlob = await canvasToPngBlob(srcCanvas);

  const msg: FlatMapInitMsg = {
    type: 'TFW_FLATMAP_INIT',
    viewer: 'flatmap',
    nonce: readyNonce,
    title,
    pngBlob,
  };
  viewerWin.postMessage(msg, '*');
}
