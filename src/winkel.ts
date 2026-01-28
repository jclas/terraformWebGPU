export interface WinkelTripelWindowOptions {
  title?: string;
  seed: number;
  oceanSAFraction: number;
  sourceCanvasHeight: number; //no width needed as width is height * ASPECT
  subdivisions?: number;
  qualityHeightPx?: number;
  reuseWindowName?: string;
  canvasMarginTopBottom?: number;
  canvasMarginLeftRight?: number;
  openAsTab?: boolean;
}

type WinkelReadyMsg = { type: 'TFW_READY'; viewer: 'winkel'; nonce: string };
type WinkelPingMsg = { type: 'TFW_PING'; viewer: 'winkel' };

type WinkelInitMsg = {
  type: 'TFW_WINKEL_INIT';
  viewer: 'winkel';
  nonce: string;
  title: string;
  seed: number;
  oceanSAFraction: number;
  subdivisions: number;
  qualityHeightPx: number;
};

/**
 * Create a random string based on time and a random number
 * @returns string
 */
function randomNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function waitForViewerReady(target: Window, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for viewer to load'));
    }, timeoutMs);

    const pingMsg: WinkelPingMsg = { type: 'TFW_PING', viewer: 'winkel' };
    const pingInterval = window.setInterval(() => {
      try {
        target.postMessage(pingMsg, '*');
      } catch {
        // Ignore transient errors while the window is navigating.
      }
    }, 250);

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
      const data = ev.data as WinkelReadyMsg;
      if (!data || data.type !== 'TFW_READY' || data.viewer !== 'winkel') return;
      cleanup();
      resolve(data.nonce);
    }

    window.addEventListener('message', onMsg);
  });
}

export async function openWinkelTripelMapWindow(opts: WinkelTripelWindowOptions): Promise<void> {
  
  let viewerWin: Window | null;
  const name = opts.reuseWindowName ?? 'TerraformWinkelTripelViewer';
  const title = opts.title ?? 'Winkel Tripel Viewer';
  const nonce = randomNonce();

  const ASPECT = (Math.PI + 2) / Math.PI; // standard Winkel Tripel bounds aspect
  const qualityHeightPx = opts.qualityHeightPx ?? 600;
  const qualityWidthPx = Math.round(qualityHeightPx * ASPECT);
  const marginTopBottom = opts.canvasMarginTopBottom ?? 0;
  const marginLeftRight = opts.canvasMarginLeftRight ?? 0;
  const openAsTab = opts.openAsTab ?? true;  //tab default

  if (openAsTab) {
    viewerWin = window.open(`winkel.html#nonce=${encodeURIComponent(nonce)}`, name);
  } else  {
    // initial window popup size
    const winW = Math.min(screen.availWidth, qualityWidthPx + marginLeftRight * 2);
    const winH = Math.min(screen.availHeight, qualityHeightPx + marginTopBottom * 2);

    viewerWin = window.open(
      `winkel.html#nonce=${encodeURIComponent(nonce)}`,
      name,
      `popup=1,width=${winW},height=${winH},scrollbars=1,resizable=1`,
    );
  }

  if (!viewerWin) {
    throw new Error('Popup blocked while opening Winkel Tripel viewer.');
  }

  const readyNonce = await waitForViewerReady(viewerWin);

  const msg: WinkelInitMsg = {
    type: 'TFW_WINKEL_INIT',
    viewer: 'winkel',
    nonce: readyNonce,
    title,
    seed: opts.seed,
    oceanSAFraction: opts.oceanSAFraction,
    subdivisions: opts.subdivisions ?? 8,
    qualityHeightPx,
  };

  viewerWin.postMessage(msg, '*');
}
