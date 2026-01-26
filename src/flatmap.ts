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

export interface FlatMapExportOptions {
  seed: number;
  oceanSAFraction: number;
  sourceCanvasWidth: number;
  sourceCanvasHeight: number;
  minWidth?: number;
  subdivisions?: number;
}

export interface FlatMapViewerOptions extends FlatMapExportOptions {
  title?: string;
  reuseWindowName?: string;
}

function pickExportSize({
  sourceCanvasWidth,
  sourceCanvasHeight,
  minWidth = 1024,
}: {
  sourceCanvasWidth: number;
  sourceCanvasHeight: number;
  minWidth?: number;
}): { width: number; height: number } {
  // Guarantee: output dimensions are >= the globe canvas dimensions.
  // Also keep an equirectangular 2:1 aspect.
  const width = Math.max(sourceCanvasWidth, sourceCanvasHeight * 2, minWidth);
  const height = Math.max(sourceCanvasHeight, Math.floor(width / 2));
  return { width, height };
}

async function renderFlatMapCanvas(opts: FlatMapExportOptions): Promise<HTMLCanvasElement> {
  const { seed, oceanSAFraction, sourceCanvasWidth, sourceCanvasHeight, subdivisions = 8 } = opts;

  const { width, height } = pickExportSize({
    sourceCanvasWidth,
    sourceCanvasHeight,
    minWidth: opts.minWidth,
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

export async function exportFlatMapPng(opts: FlatMapExportOptions): Promise<void> {
  const canvas = await renderFlatMapCanvas(opts);
  const blob = await canvasToPngBlob(canvas);

  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener');
  if (!win) {
    URL.revokeObjectURL(url);
    throw new Error('Popup blocked while opening flat map');
  }

  // Revoke later so the tab has time to load.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function openFlatMapViewer(targetWindow: Window, opts: FlatMapViewerOptions): Promise<void> {
  const title = opts.title ?? 'Flat Map Viewer';
  const doc = targetWindow.document;

  // Loading shell (shows immediately while we generate the PNG).
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title></head><body style="margin:0;background:#0b0f19;color:#cbd5e1;font-family:system-ui,Segoe UI,Arial,sans-serif;"><div style="padding:16px;">Loading flat map…</div></body></html>`);
  doc.close();

  // Generate the image in the opener window, then send it to the viewer.
  const srcCanvas = await renderFlatMapCanvas(opts);
  const pngBlob = await canvasToPngBlob(srcCanvas);
  const url = URL.createObjectURL(pngBlob);

  // Viewer document (canvas + inline script). Horizontal drag only, seamless wrap.
  const safeTitle = title.replace(/[\u0000-\u001F\u007F<>"'`]/g, '');
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      html, body { height: 100%; margin: 0; background: #0b0f19; overflow: hidden; }
      body { display: grid; place-items: center; }
      #c { display: block; touch-action: none; cursor: grab; background: #000; }
      #hud { position: fixed; left: 12px; top: 10px; padding: 6px 10px; border-radius: 8px;
             background: rgba(2,6,23,0.65); color: #cbd5e1; font: 12px/1.2 system-ui, Segoe UI, Arial, sans-serif; }
    </style>
  </head>
  <body>
    <canvas id="c"></canvas>
    <div id="hud">Drag left/right (wraps)</div>
    <script>
      (() => {
        // Detach opener access from this tab (mitigation since we didn't use noopener).
        try { window.opener = null; } catch {}

        const mapUrl = ${JSON.stringify(url)};
        const canvas = document.getElementById('c');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          document.body.textContent = '2D canvas not available';
          return;
        }

        let dpr = 1;
        let viewW = 1;
        let viewH = 1;
        let tileW = 1;
        let tileH = 1;
        let offsetX = 0;
        let dragging = false;
        let lastClientX = 0;
        let bitmap = null;

        function resize() {
          dpr = Math.max(1, window.devicePixelRatio || 1);

          // Maintain an exact 2:1 canvas (width = 2x height) that fits within the window.
          const maxCssW = Math.max(1, window.innerWidth);
          const maxCssH = Math.max(1, window.innerHeight);
          const cssH = Math.min(maxCssH, maxCssW / 2);
          const cssW = cssH * 2;

          canvas.style.width = cssW + 'px';
          canvas.style.height = cssH + 'px';

          viewW = Math.max(1, Math.floor(cssW * dpr));
          viewH = Math.max(1, Math.floor(cssH * dpr));
          canvas.width = viewW;
          canvas.height = viewH;

          // The tile should exactly fill the canvas (still 2:1).
          tileW = viewW;
          tileH = viewH;
        }

        function wrap(v, m) {
          if (m <= 0) return 0;
          v = v % m;
          return v < 0 ? v + m : v;
        }

        function draw() {
          if (!bitmap) return;
          ctx.clearRect(0, 0, viewW, viewH);

          const ox = wrap(offsetX, tileW);
          // Draw enough tiles to cover the viewport.
          let startX = -ox;
          while (startX > 0) startX -= tileW;
          for (let x = startX; x < viewW + tileW; x += tileW) {
            ctx.drawImage(bitmap, x, 0, tileW, tileH);
          }
        }

        canvas.addEventListener('pointerdown', (e) => {
          dragging = true;
          lastClientX = e.clientX;
          canvas.style.cursor = 'grabbing';
          try { canvas.setPointerCapture(e.pointerId); } catch {}
        });
        canvas.addEventListener('pointermove', (e) => {
          if (!dragging) return;
          const dx = (e.clientX - lastClientX) * dpr;
          lastClientX = e.clientX;
          // Horizontal-only: ignore vertical movement entirely.
          offsetX -= dx;
          draw();
        });
        function endDrag() {
          dragging = false;
          canvas.style.cursor = 'grab';
        }
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);
        canvas.addEventListener('pointerleave', () => { /* keep dragging only with capture */ });

        window.addEventListener('resize', () => { resize(); draw(); });
        window.addEventListener('beforeunload', () => {
          try { URL.revokeObjectURL(mapUrl); } catch {}
        });

        async function load() {
          resize();
          const img = new Image();
          img.decoding = 'async';
          img.src = mapUrl;
          try {
            if (img.decode) await img.decode();
            else await new Promise((res, rej) => { img.onload = () => res(); img.onerror = rej; });
          } catch {
            // Fall back to onload if decode fails.
            await new Promise((res, rej) => { img.onload = () => res(); img.onerror = rej; });
          }
          try {
            bitmap = await createImageBitmap(img);
          } catch {
            // createImageBitmap might be unavailable; use the image directly.
            bitmap = img;
          }
          draw();
        }

        load().catch((err) => {
          document.body.textContent = 'Failed to load flat map: ' + (err && err.message ? err.message : String(err));
        });
      })();
    </script>
  </body>
</html>`;

  doc.open();
  doc.write(html);
  doc.close();
}
