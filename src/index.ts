import { GlobeRenderer } from './globe';
import { openFlatMapWindow } from './flatmap';
import { openWinkelTripelMapWindow } from './winkel';

// Grab HTML slider for ocean surface area
const oceanSAPercentSlider = document.getElementById('oceanSAPercent') as HTMLInputElement;
const oceanSAPercentValue = document.getElementById('oceanSAPercentValue') as HTMLElement;
// Seed UI elements
const seedDisplay = document.getElementById('current-seed') as HTMLElement;
const seedInput = document.getElementById('seed-input') as HTMLInputElement;
const generateSeedBtn = document.getElementById('generate-seed-btn') as HTMLButtonElement;
const seedError = document.getElementById('seed-error') as HTMLElement;
const flatMapBtn = document.getElementById('flat-map-btn') as HTMLButtonElement | null;
const winkelMapBtn = document.getElementById('winkel-map-btn') as HTMLButtonElement | null;

const canvas = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
if (!canvas) {
  throw new Error('Canvas element with id "webgpu-canvas" not found.');
}

// Seed helpers
const SEED_MIN = 0;
const SEED_MAX = 2_147_483_647;

function randomSeed(): number {

  if (window.crypto?.getRandomValues) {
    const a = new Uint32Array(1);
    window.crypto.getRandomValues(a);
    return a[0] & SEED_MAX;  //bitwise will ensure first bit is 0. (0 is pos number, 1 is neg)
  }
  return Math.floor(Math.random() * (SEED_MAX + 1));
}

function isValidSeed(val: string): boolean {
  if (!/^[0-9]+$/.test(val)) return false;
  const n = Number(val);
  return Number.isInteger(n) && n >= SEED_MIN && n <= SEED_MAX;
}
function showSeedError(msg: string) {
  seedError.textContent = msg;
}
function clearSeedError() {
  seedError.textContent = '';
}

function setUiEnabled(enabled: boolean) {
  generateSeedBtn.disabled = !enabled;
}

const nextFrame = () => new Promise<number>(requestAnimationFrame);

let terraformBusy = false;
let renderer: GlobeRenderer | null = null;

function ensureRenderer(): GlobeRenderer {
  if (!renderer) {
    renderer = new GlobeRenderer(canvas, {
      oceanSAPercentSlider,
      oceanSAPercentValue,
    });
  }
  return renderer;
}

async function runTerraformFromSeed(seed: number) {
  if (terraformBusy) return;

  terraformBusy = true;
  setUiEnabled(false);

  let startedTerraform = false;
  try {
    await nextFrame(); // Give the browser a chance to paint the disabled state before heavy work begins.
    startedTerraform = true;
    await ensureRenderer().terraformWithSeed(seed);
  } finally {
    // Keep busy until the next macrotask so queued double-click events can't start a 2nd run.
    // Apparently even a zero-length timeout can get that done.
    window.setTimeout(() => {
      if (startedTerraform) {
        seedInput.value = String(randomSeed());
      }
      setUiEnabled(true);
      terraformBusy = false;
    }, 0);
  }
}

async function onGenerateClick(event: MouseEvent) {
  event.preventDefault();
  clearSeedError();

  const seedString = seedInput.value.trim();
  if (!isValidSeed(seedString)) {
    showSeedError('Seed must be an integer between 0 and ' + SEED_MAX + '.');
    return;
  }

  seedDisplay.textContent = seedString;

  await runTerraformFromSeed(Number(seedString));
}

generateSeedBtn.onclick = onGenerateClick;

async function openFlatMap() {
  clearSeedError();

  const seedString = (seedDisplay.textContent || '').trim();
  if (!isValidSeed(seedString)) {
    showSeedError('Generate a globe first (invalid seed).');
    return;
  }

  const oceanSAFraction = Number(oceanSAPercentSlider.value) / 100;

  await openFlatMapWindow({
    title: `Flat Map (Seed ${seedString})`,
    seed: Number(seedString),
    oceanSAFraction,
    sourceCanvasHeight: canvas.height,
    // subdivisions: 9,
    canvasMarginTopBottom: 50,
  });
}

flatMapBtn?.addEventListener('click', () => {
  void openFlatMap();
});

async function openWinkelTripelMap() {
  clearSeedError();

  const seedString = (seedDisplay.textContent || '').trim();
  if (!isValidSeed(seedString)) {
    showSeedError('Generate a globe first (invalid seed).');
    return;
  }

  const oceanSAFraction = Number(oceanSAPercentSlider.value) / 100;

  await openWinkelTripelMapWindow({
    title: `Winkel Tripel (Seed ${seedString})`,
    seed: Number(seedString),
    oceanSAFraction,
    sourceCanvasHeight: canvas.height,
    canvasMarginTopBottom: 50,
  });
}

winkelMapBtn?.addEventListener('click', () => {
  void openWinkelTripelMap();
});

// Initial page load: random seed, display, input, terraform
(async () => {
  const seed = randomSeed();
  seedDisplay.textContent = String(seed);
  seedInput.value = String(seed);
  await runTerraformFromSeed(seed);
})();

