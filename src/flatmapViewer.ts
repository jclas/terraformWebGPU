type ReadyMsg = { type: 'TFW_READY'; viewer: 'flatmap'; nonce: string };
type PingMsg = { type: 'TFW_PING'; viewer: 'flatmap' };

type InitMsg = {
  type: 'TFW_FLATMAP_INIT';
  viewer: 'flatmap';
  nonce: string;
  title: string;
  pngBlob: Blob;
};

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

function wrap(v: number, m: number): number {
  if (m <= 0) return 0;
  v = v % m;
  return v < 0 ? v + m : v;
}

async function loadBitmapFromBlob(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    try {
      if (img.decode) await img.decode();
      else await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('Failed to load image'));
      });
    } catch {
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('Failed to load image'));
      });
    }

    try {
      return await createImageBitmap(img);
    } catch {
      return img;
    }
  } finally {
    // Safe to revoke after decode; the bitmap/image is already resident.
    URL.revokeObjectURL(url);
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

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  const ctx2d = ctx;

  let dpr = 1;
  let viewW = 1;
  let viewH = 1;
  let tileW = 1;
  let tileH = 1;

  let offsetX = 0;
  let dragging = false;
  let lastClientX = 0;

  let bitmap: ImageBitmap | HTMLImageElement | null = null;

  function resize() {
    dpr = Math.max(1, window.devicePixelRatio || 1);

    const maxCssW = Math.max(1, window.innerWidth);
    const maxCssH = Math.max(1, window.innerHeight);

    // Maintain an exact 2:1 canvas (width = 2x height) that fits within the window.
    const cssH = Math.min(maxCssH, maxCssW / 2);
    const cssW = cssH * 2;

    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    viewW = Math.max(1, Math.floor(cssW * dpr));
    viewH = Math.max(1, Math.floor(cssH * dpr));
    canvas.width = viewW;
    canvas.height = viewH;

    tileW = viewW;
    tileH = viewH;
  }

  function draw() {
    if (!bitmap) return;
    ctx2d.clearRect(0, 0, viewW, viewH);

    const ox = wrap(offsetX, tileW);
    let startX = -ox;
    while (startX > 0) startX -= tileW;
    for (let x = startX; x < viewW + tileW; x += tileW) {
      ctx2d.drawImage(bitmap, x, 0, tileW, tileH);
    }
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
    const dx = (e.clientX - lastClientX) * dpr;
    lastClientX = e.clientX;
    offsetX -= dx;
    draw();
  });

  function endDrag() {
    dragging = false;
    canvas.style.cursor = 'grab';
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  window.addEventListener('resize', () => {
    resize();
    draw();
  });

  window.addEventListener('message', async (ev: MessageEvent) => {
    const anyData = ev.data as PingMsg | InitMsg;
    if (!anyData) return;

    if (anyData.type === 'TFW_PING' && anyData.viewer === 'flatmap') {
      const msg: ReadyMsg = { type: 'TFW_READY', viewer: 'flatmap', nonce };
      window.opener?.postMessage(msg, '*');
      return;
    }

    const data = anyData as InitMsg;
    if (data.type !== 'TFW_FLATMAP_INIT' || data.viewer !== 'flatmap') return;
    if (data.nonce !== nonce) return;

    document.title = data.title;
    setHud('Loading…');

    bitmap = await loadBitmapFromBlob(data.pngBlob);

    resize();
    offsetX = 0;
    setHud('Drag left/right (wraps)');
    draw();
  });

  // Notify opener we’re ready.
  const msg: ReadyMsg = { type: 'TFW_READY', viewer: 'flatmap', nonce };
  window.opener?.postMessage(msg, '*');
}

main();
