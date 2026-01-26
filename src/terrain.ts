import { SimplexNoise3D } from './simplex3d';
import { createIcosphere } from './icosphere';

// --- Globe constants (feet) ---
// const BASE_AVE_RADIUS = 20_908_800;  // feet (Earth mean radius, roughly. 3960 miles)
export const BASE_ABYSSAL_RADIUS = 20_889_115; // feet lowest Abyssal Plain radius (19685 ft [6000m] below sea level, roughly.)
export const BASE_ABYSSAL_FLOOR_ELEVATION = 0; // feet offset where the elevation distribution peaks (mode)
export const HIGHEST_ELEVATION_LIMIT = 48_685; // feet (Everest ~29k + ocean depth)
export const LOWEST_ELEVATION_LIMIT = -16_404; // feet below Lowest Abyssal Plain radius (Mariana Trench ~-36,960 below sea level)

export const VISUALIZATION_SCALE = 0.000001; // Shrink globe further for rendering, keep stats in real units
export const RELIEF_EXAGGERATION = 10; // Visual-only: scales geometry relief, not elevation feet values
export const STD_DEVS = 4;

export type Vec3 = readonly [number, number, number];

export interface TerrainColorConfig {
  deepOcean: Vec3;
  midOcean: Vec3;
  shallowOcean: Vec3;
  lowLand: Vec3;
  highLand: Vec3;
  rocky: Vec3;
  snow: Vec3;
  
  deepToMidStartOffsetFeet: number;
  deepToMidEndOffsetFeet: number;
  midToShallowStartOffsetFeet: number;
  midToShallowEndOffsetFeet: number;
  lowToHighEndOffsetFeet: number;
  highToRockyEndOffsetFeet: number;
  rockyToSnowStartOffsetFeet: number;
  rockyToSnowEndOffsetFeet: number;
}

export const TERRAIN_COLOR_CONFIG: TerrainColorConfig = {
  deepOcean: [0.05, 0.15, 0.4],
  midOcean: [0.1, 0.3, 0.7],
  shallowOcean: [0.2, 0.5, 1.0],
  lowLand: [0.2, 0.36, 0.2],
  highLand: [0.3, 0.2, 0.1],
  rocky: [0.4, 0.4, 0.4],
  snow: [1.0, 1.0, 1.0],

  //todo: lower all the elevation points and change the spread - only 2.3% should be above 10,000 ft statistically
  deepToMidStartOffsetFeet: -25_000,
  deepToMidEndOffsetFeet: -15_000,
  midToShallowStartOffsetFeet: -15_000,
  midToShallowEndOffsetFeet: -6_000,
  lowToHighEndOffsetFeet: 12_000,
  highToRockyEndOffsetFeet: 17_000,
  rockyToSnowStartOffsetFeet: 18_000,
  rockyToSnowEndOffsetFeet: 25_000,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function colorFromElevationFeet(
  elevFeet: number,
  seaLevelFeet: number,
  cfg: TerrainColorConfig = TERRAIN_COLOR_CONFIG,
): Vec3 {
  if (elevFeet < seaLevelFeet + cfg.deepToMidEndOffsetFeet) {
    const t = smoothstep(
      seaLevelFeet + cfg.deepToMidStartOffsetFeet,
      seaLevelFeet + cfg.deepToMidEndOffsetFeet,
      elevFeet,
    );
    return mix(cfg.deepOcean, cfg.midOcean, t);
  }

  if (elevFeet < seaLevelFeet + cfg.midToShallowEndOffsetFeet) {
    const t = smoothstep(
      seaLevelFeet + cfg.midToShallowStartOffsetFeet,
      seaLevelFeet + cfg.midToShallowEndOffsetFeet,
      elevFeet,
    );
    return mix(cfg.midOcean, cfg.shallowOcean, t);
  }

  if (elevFeet < seaLevelFeet) {
    return cfg.shallowOcean;
  }

  if (elevFeet < seaLevelFeet + cfg.lowToHighEndOffsetFeet) {
    const t = smoothstep(seaLevelFeet, seaLevelFeet + cfg.lowToHighEndOffsetFeet, elevFeet);
    return mix(cfg.lowLand, cfg.highLand, t);
  }

  if (elevFeet < seaLevelFeet + cfg.highToRockyEndOffsetFeet) {
    const t = smoothstep(
      seaLevelFeet + cfg.lowToHighEndOffsetFeet,
      seaLevelFeet + cfg.highToRockyEndOffsetFeet,
      elevFeet,
    );
    return mix(cfg.highLand, cfg.rocky, t);
  }

  const t = smoothstep(
    seaLevelFeet + cfg.rockyToSnowStartOffsetFeet,
    seaLevelFeet + cfg.rockyToSnowEndOffsetFeet,
    elevFeet,
  );
  return mix(cfg.rocky, cfg.snow, t);
}

export function shadeFromNormal(
  nx: number,
  ny: number,
  nz: number,
  lightDir: Vec3 = [0.35, 0.85, 0.4],
  ambient = 0.4,
): number {
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;

  const [lx0, ly0, lz0] = lightDir;
  const lLen = Math.hypot(lx0, ly0, lz0) || 1;
  const lx = lx0 / lLen;
  const ly = ly0 / lLen;
  const lz = lz0 / lLen;

  const ndotl = Math.max(nx * lx + ny * ly + nz * lz, 0);
  return ambient + (1 - ambient) * ndotl;
}

/**
 * Computes the inverse of the cumulative distribution function (CDF) (Abramowitz-Stegun approximation)
 * of the standard normal distribution.
 */
export function inverseNormalCDF(p: number): number {
  if (p <= 0 || p >= 1) throw new Error('p must be in (0,1)');
  const a1 = -39.6968302866538;
  const a2 = 220.946098424521;
  const a3 = -275.928510446969;
  const a4 = 138.357751867269;
  const a5 = -30.6647980661472;
  const a6 = 2.50662827745924;
  const b1 = -54.4760987982241;
  const b2 = 161.585836858041;
  const b3 = -155.698979859887;
  const b4 = 66.8013118877197;
  const b5 = -13.2806815528857;
  const c1 = -0.00778489400243029;
  const c2 = -0.322396458041136;
  const c3 = -2.40075827716184;
  const c4 = -2.54973253934373;
  const c5 = 4.37466414146497;
  const c6 = 2.93816398269878;
  const d1 = 0.00778469570904146;
  const d2 = 0.32246712907004;
  const d3 = 2.445134137143;
  const d4 = 3.75440866190742;

  let q: number;
  let r: number;
  if (p < 0.02425) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
    );
  }

  if (p > 1 - 0.02425) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
    );
  }

  q = p - 0.5;
  r = q * q;
  return (
    (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q /
    (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1)
  );
}

/**
 * Maps a percentile `u` in (0, 1) to an elevation (feet) using a split-normal distribution.
 * This matches the current globe logic.
 */
export function percentileToElevationFeet(u: number, stdDevs: number): { elevFeet: number; zStd: number } {
  const sigmaLeftFeet = Math.abs(LOWEST_ELEVATION_LIMIT) / stdDevs;
  const sigmaRightFeet = HIGHEST_ELEVATION_LIMIT / stdDevs;
  const w = sigmaLeftFeet / (sigmaLeftFeet + sigmaRightFeet);

  const eps = 1e-6;
  const uu = clamp(u, eps, 1 - eps);

  let zStd: number;
  let sigmaFeet: number;
  if (uu < w) {
    const uPrime = clamp(uu / (2 * w), eps, 0.5 - eps);
    zStd = inverseNormalCDF(uPrime);
    sigmaFeet = sigmaLeftFeet;
  } else {
    const uPrime = clamp(0.5 + (uu - w) / (2 * (1 - w)), 0.5 + eps, 1 - eps);
    zStd = inverseNormalCDF(uPrime);
    sigmaFeet = sigmaRightFeet;
  }

  zStd = clamp(zStd, -stdDevs, stdDevs);
  const elevFeet = clamp(
    BASE_ABYSSAL_FLOOR_ELEVATION + sigmaFeet * zStd,
    LOWEST_ELEVATION_LIMIT,
    HIGHEST_ELEVATION_LIMIT,
  );

  return { elevFeet, zStd };
}

/**
 * Computes 3D fractal Brownian motion (fBm) by summing multiple octaves of a base noise function.
 */
export function fbm3(
  x: number,
  y: number,
  z: number,
  noise: SimplexNoise3D,
  octaves: number,
  baseFreq: number,
): number {
  let sum = 0;
  let amp = 1;
  let ampSum = 0;
  let freq = baseFreq;

  octaves = Math.max(1, Math.floor(octaves));

  for (let i = 0; i < octaves; i++) {
    const ox = i * 19.1;
    const oy = i * 47.7;
    const oz = i * 73.3;
    sum += amp * noise.noise(x * freq + ox, y * freq + oy, z * freq + oz);
    ampSum += amp;
    amp *= 0.5;
    freq *= 2.0;
  }

  return ampSum > 0 ? sum / ampSum : 0;
}

// Spatially correlated "continent" field in approximately [-1, 1].
export function rawNoiseOnSphere(x: number, y: number, z: number, noise: SimplexNoise3D): number {
  const continent = fbm3(x, y, z, noise, 3, 0.65);
  const mask = smoothstep(-0.15, 0.25, continent);
  const detail = fbm3(x, y, z, noise, 6, 2.6);

  const combined = 0.85 * continent + 0.45 * detail * (0.25 + 0.75 * mask);

  const equatorBias = 0.15 * (1 - Math.abs(y));
  return clamp(combined + equatorBias, -1, 1);
}

export function computeVertexNormals(vertices: Float32Array, indices: Uint32Array): Float32Array {
  const vertexCount = Math.floor(vertices.length / 4);
  const normals = new Float32Array(vertexCount * 3);

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i + 0];
    const ib = indices[i + 1];
    const ic = indices[i + 2];

    const ax = vertices[ia * 4 + 0];
    const ay = vertices[ia * 4 + 1];
    const az = vertices[ia * 4 + 2];

    const bx = vertices[ib * 4 + 0];
    const by = vertices[ib * 4 + 1];
    const bz = vertices[ib * 4 + 2];

    const cx = vertices[ic * 4 + 0];
    const cy = vertices[ic * 4 + 1];
    const cz = vertices[ic * 4 + 2];

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;

    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;

    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    normals[ia * 3 + 0] += nx;
    normals[ia * 3 + 1] += ny;
    normals[ia * 3 + 2] += nz;

    normals[ib * 3 + 0] += nx;
    normals[ib * 3 + 1] += ny;
    normals[ib * 3 + 2] += nz;

    normals[ic * 3 + 0] += nx;
    normals[ic * 3 + 1] += ny;
    normals[ic * 3 + 2] += nz;
  }

  for (let i = 0; i < vertexCount; i++) {
    let nx = normals[i * 3 + 0];
    let ny = normals[i * 3 + 1];
    let nz = normals[i * 3 + 2];
    let len = Math.hypot(nx, ny, nz);

    if (!Number.isFinite(len) || len < 1e-12) {
      const x = vertices[i * 4 + 0];
      const y = vertices[i * 4 + 1];
      const z = vertices[i * 4 + 2];
      len = Math.hypot(x, y, z) || 1;
      nx = x / len;
      ny = y / len;
      nz = z / len;
    } else {
      nx /= len;
      ny /= len;
      nz /= len;
    }

    normals[i * 3 + 0] = nx;
    normals[i * 3 + 1] = ny;
    normals[i * 3 + 2] = nz;
  }

  return normals;
}

export function buildRawDistribution(seed: number, subdivisions = 8): { sortedRaw: Float32Array } {
  const noise = new SimplexNoise3D(seed);
  const unitMesh = createIcosphere(subdivisions, 1, 1);
  const vertexCount = unitMesh.vertices.length / 4;

  const rawValues = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const x = unitMesh.vertices[i * 4 + 0];
    const y = unitMesh.vertices[i * 4 + 1];
    const z = unitMesh.vertices[i * 4 + 2];
    rawValues[i] = rawNoiseOnSphere(x, y, z, noise);
  }

  const order: number[] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) order[i] = i;
  order.sort((a, b) => rawValues[a] - rawValues[b]);

  const sortedRaw = new Float32Array(vertexCount);
  for (let rank = 0; rank < vertexCount; rank++) {
    sortedRaw[rank] = rawValues[order[rank]];
  }

  return { sortedRaw };
}

export function rawToPercentile(sortedRaw: Float32Array, raw: number): number {
  const n = sortedRaw.length;
  if (n === 0) return 0.5;

  if (raw <= sortedRaw[0]) return 0.5 / n;
  if (raw >= sortedRaw[n - 1]) return (n - 0.5) / n;

  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedRaw[mid] < raw) lo = mid + 1;
    else hi = mid;
  }

  const idx = clamp(lo, 0, n - 1);
  return (idx + 0.5) / n;
}

export interface TerrainStats {
  totalVerts: number;
  countNegElev: number;
  countPosElev: number;
  countClampedLow: number;
  countClampedHigh: number;
  minElevFeet: number;
  maxElevFeet: number;
  oceanFracActual: number;
  avgOceanDepthFeet: number;
  avgLandHeightFeet: number;
  seaLevelFeet: number;
  countAbsZGe1: number;
  countAbsZGe2: number;
  countAbsZGe3: number;
  countAbsZGe4: number;
}

export interface TerrainMeshData {
  vertices: Float32Array; // x,y,z,elevFeet
  indices: Uint32Array;
  normals: Float32Array; // x,y,z per vertex
  seaLevelFeet: number;
  stats: TerrainStats;
  distribution: { sortedRaw: Float32Array };
}

export function buildTerrainMesh(seed: number, oceanSAFraction: number, subdivisions = 8): TerrainMeshData {
  const noise = new SimplexNoise3D(seed);

  const seaLevelFeet = percentileToElevationFeet(oceanSAFraction, STD_DEVS).elevFeet;

  const unitMesh = createIcosphere(subdivisions, 1, 1);
  const vertexCount = unitMesh.vertices.length / 4;

  const rawValues = new Float32Array(vertexCount);
  const order: number[] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const x = unitMesh.vertices[i * 4 + 0];
    const y = unitMesh.vertices[i * 4 + 1];
    const z = unitMesh.vertices[i * 4 + 2];
    rawValues[i] = rawNoiseOnSphere(x, y, z, noise);
    order[i] = i;
  }

  order.sort((a, b) => rawValues[a] - rawValues[b]);

  const percentiles = new Float32Array(vertexCount);
  const sortedRaw = new Float32Array(vertexCount);
  for (let rank = 0; rank < vertexCount; rank++) {
    const idx = order[rank];
    percentiles[idx] = (rank + 0.5) / vertexCount;
    sortedRaw[rank] = rawValues[idx];
  }

  let minElevFeet = Infinity;
  let maxElevFeet = -Infinity;
  let countNegElev = 0;
  let countPosElev = 0;
  let countClampedLow = 0;
  let countClampedHigh = 0;
  let countAbsZGe1 = 0;
  let countAbsZGe2 = 0;
  let countAbsZGe3 = 0;
  let countAbsZGe4 = 0;

  let oceanCount = 0;
  let landCount = 0;
  let oceanDepthSum = 0;
  let landHeightSum = 0;

  const outVertices = new Float32Array(unitMesh.vertices.length);

  for (let i = 0; i < vertexCount; i++) {
    const rx = unitMesh.vertices[i * 4 + 0];
    const ry = unitMesh.vertices[i * 4 + 1];
    const rz = unitMesh.vertices[i * 4 + 2];

    const { elevFeet, zStd } = percentileToElevationFeet(percentiles[i], STD_DEVS);

    if (elevFeet < minElevFeet) minElevFeet = elevFeet;
    if (elevFeet > maxElevFeet) maxElevFeet = elevFeet;

    const absZ = Math.abs(zStd);
    if (absZ >= 1) countAbsZGe1++;
    if (absZ >= 2) countAbsZGe2++;
    if (absZ >= 3) countAbsZGe3++;
    if (absZ >= 4) countAbsZGe4++;

    if (elevFeet < 0) countNegElev++;
    else countPosElev++;

    if (elevFeet <= LOWEST_ELEVATION_LIMIT) countClampedLow++;
    if (elevFeet >= HIGHEST_ELEVATION_LIMIT) countClampedHigh++;

    if (elevFeet < seaLevelFeet) {
      oceanCount++;
      oceanDepthSum += seaLevelFeet - elevFeet;
    } else {
      landCount++;
      landHeightSum += elevFeet - seaLevelFeet;
    }

    const visualElevFeet = elevFeet < seaLevelFeet ? seaLevelFeet : elevFeet;
    const r = (BASE_ABYSSAL_RADIUS + visualElevFeet * RELIEF_EXAGGERATION) * VISUALIZATION_SCALE;

    outVertices[i * 4 + 0] = rx * r;
    outVertices[i * 4 + 1] = ry * r;
    outVertices[i * 4 + 2] = rz * r;
    outVertices[i * 4 + 3] = elevFeet;
  }

  const normals = computeVertexNormals(outVertices, unitMesh.indices);

  const oceanFracActual = vertexCount > 0 ? oceanCount / vertexCount : 0;
  const avgOceanDepthFeet = oceanCount > 0 ? oceanDepthSum / oceanCount : 0;
  const avgLandHeightFeet = landCount > 0 ? landHeightSum / landCount : 0;

  return {
    vertices: outVertices,
    indices: unitMesh.indices,
    normals,
    seaLevelFeet,
    stats: {
      totalVerts: vertexCount,
      countNegElev,
      countPosElev,
      countClampedLow,
      countClampedHigh,
      minElevFeet,
      maxElevFeet,
      oceanFracActual,
      avgOceanDepthFeet,
      avgLandHeightFeet,
      seaLevelFeet,
      countAbsZGe1,
      countAbsZGe2,
      countAbsZGe3,
      countAbsZGe4,
    },
    distribution: { sortedRaw },
  };
}
