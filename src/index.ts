/// <reference types="@webgpu/types" />
import { SimplexNoise3D } from './simplex3d';
import { createIcosphere } from './icosphere';

// Grab HTML slider for ocean surface area
const oceanSAPercentSlider = document.getElementById('oceanSAPercent') as HTMLInputElement;
const oceanSAPercentValue = document.getElementById('oceanSAPercentValue') as HTMLElement;

/**
 * Computes the inverse of the cumulative distribution function (CDF) (Abramowitz-Stegun approximation)
 * of the standard normal distribution (also known as the quantile function or probit function).
 * Given a probability value `p` in the open interval (0, 1), this function returns the z-score
 * (such that the probability of a standard normal random variable being less than or equal to that z-score is `p`.)
 * This implementation uses rational approximations for different regions of `p` 
 * to ensure high accuracy across the entire range.
 *
 * @param p - A probability value in the open interval (0, 1). Must satisfy 0 < p < 1.
 * @returns The z-score corresponding to the given cumulative probability `p`.
 * @throws {Error} If `p` is not in the open interval (0, 1).
 *
 * @remarks
 * This function is useful for statistical applications such as hypothesis testing, confidence interval construction,
 * and generating normally distributed random variables from uniform random variables.
 */
function inverseNormalCDF(p: number): number {
  if (p <= 0 || p >= 1) throw new Error("p must be in (0,1)");
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
  let q, r;
  if (p < 0.02425) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  } else if (p > 1 - 0.02425) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  } else {
    q = p - 0.5;
    r = q * q;
    return (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q /
      (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function fbm3(x: number, y: number, z: number, noise: SimplexNoise3D, octaves: number, baseFreq: number): number {
  let sum = 0;
  let amp = 1;
  let ampSum = 0;
  let freq = baseFreq;

  octaves = Math.max(1, Math.floor(octaves));

  for (let i = 0; i < octaves; i++) {
    // Deterministic per-octave offsets (avoid axial artifacts)
    const ox = i * 19.1;
    const oy = i * 47.7;
    const oz = i * 73.3;
    sum += amp * noise.noise(x * freq + ox, y * freq + oy, z * freq + oz);
    ampSum += amp;
    amp *= 0.5;
    freq *= 2.0;
  }

  return ampSum > 0 ? (sum / ampSum) : 0;
}

function computeVertexNormals(vertices: Float32Array, indices: Uint32Array): Float32Array {
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
        // ...existing code...
    let nx = normals[i * 3 + 0];
    let ny = normals[i * 3 + 1];
    let nz = normals[i * 3 + 2];
    let len = Math.hypot(nx, ny, nz);

    if (!Number.isFinite(len) || len < 1e-12) {
      // Fallback to radial normal
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

// --- Globe constants ---
// const BASE_AVE_RADIUS = 20_908_800;  // feet (Earth mean radius, roughly. 3960 miles)
const BASE_ABYSSAL_RADIUS = 20_889_115; // feet lowest Abyssal Plain radius (19685 ft [6000m] below the earth's current sea level, roughly.)
const BASE_ABYSSAL_FLOOR_ELEVATION = 0; // feet offset where the elevation distribution peaks (mode)
const HIGHEST_ELEVATION_LIMIT = 48_685; // feet (Everest ~29k + ocean depth)
const LOWEST_ELEVATION_LIMIT = -16_404; // feet below Lowest Abyssal Plain radius (Mariana Trench ~-36,960 below sea level)

const VISUALIZATION_SCALE = 0.000001;   // Shrink globe further for rendering, keep stats in real units
const RELIEF_EXAGGERATION = 10;         // Visual-only: scales geometry relief, not elevation feet values
const STD_DEVS = 4;                     // multiply std devs by typical offset error %)


// Spatially correlated "continent" field in approximately [-1, 1].
// Intentionally low-frequency with higher-frequency detail layered on top.
// We still run an empirical CDF after this, so the visual structure comes from correlation
// and the histogram/SD semantics come from the percentile->z mapping.
function rawNoiseOnSphere(x: number, y: number, z: number, noise: SimplexNoise3D): number {
  // Continent-scale base
  const continent = fbm3(x, y, z, noise, 3, 0.65);
  // Land mask ramps up detail where "land" exists
  const mask = smoothstep(-0.15, 0.25, continent);
  // Higher-frequency detail
  const detail = fbm3(x, y, z, noise, 6, 2.6);

  const combined = 0.85 * continent + 0.45 * detail * (0.25 + 0.75 * mask);

  // return clamp(combined, -1, 1);

  // Add equatorial landmass bias (tweak 0.05 as needed) and conversely less pole landmass bias.
  // Don't go too high or you will max out too many vertices and create a flat "no-noise" panel
  // on top of a mountain (at the clamped elevation).
  const equatorBias = 0.15 * (1 - Math.abs(y));
  return clamp(combined + equatorBias, -1, 1);
}

// WebGPU + Sphere mesh setup

async function runWebGPU() {
  const gpu = (navigator as any).gpu as GPU | undefined;
  if (!gpu) {
    document.body.innerHTML = 'WebGPU not supported.';
    return;
  }

  const canvas = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element with id "webgpu-canvas" not found.');
  }

  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error('No GPU adapter found');

  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu') as unknown as GPUCanvasContext;
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const seed = (() => {
    if (globalThis.crypto?.getRandomValues) {
      const a = new Uint32Array(1);
      globalThis.crypto.getRandomValues(a);
      return (a[0] / 2 ** 32) * 10000;
    }
    return Math.random() * 10000;
  })();
  const noise = new SimplexNoise3D(seed);
  console.log('noiseSeed:', seed);

  // Ocean/land parameters
  let oceanSAFraction = Number(oceanSAPercentSlider.value) / 100; // proportion
  let seaLevelElev = 0;

  // Create mesh and buffers once, then update mesh/buffers/statistics as needed
  let mesh: any;
  let vertexBuffer: GPUBuffer;
  let normalBuffer: GPUBuffer;
  let indexBuffer: GPUBuffer;

  /**
    * Generates and uploads a procedural sphere mesh with elevation data, computes normals, and logs mesh statistics.
    *
    * Steps performed:
    * 1. Creates a unit icosphere mesh (vertices and indices).
    * 2. Evaluates noise at each vertex to generate elevation percentiles.
    * 3. Maps percentiles to elevation values using a split-normal distribution.
    * 4. Displaces vertices radially according to computed elevations.
    * 5. Computes per-vertex normals (vectors perpendicular to the surface; for a perfect sphere, these align with the radius direction).
    * 6. Uploads mesh data (positions, normals, indices) to GPU buffers.
    * 7. Computes and logs statistics about the elevation distribution and mesh.
    *
    * Elevation values are centered at zero, with configurable limits and standard deviations.
    * The sea level is set so the ocean surface area matches the requested fraction.
    *
    * @remarks
    * - Normals are essential for lighting and shading; they are perpendicular to the local surface and, on a sphere, point outward like the radius.
    * - Uses a two-pass approach for percentile-based elevation mapping.
    * - Updates global mesh statistics for debugging and analysis.
    * - Requires global constants and objects such as `device`, `vertexBuffer`, `indexBuffer`, and elevation limits.
    */
  function createMeshAndApply() {

    // Mesh/statistics variables (declare at top level for global access)
    let minElevFeet = Infinity, maxElevFeet = -Infinity;
    let countNegElev = 0, countPosElev = 0, countClampedLow = 0, countClampedHigh = 0, totalVerts = 0;
    let countAbsZGe1 = 0, countAbsZGe2 = 0, countAbsZGe3 = 0, countAbsZGe4 = 0;
    // Accumulators for averages relative to sea level (computed in the vertex loop for efficiency)
    let oceanCount = 0;
    let landCount = 0;
    let oceanDepthSum = 0;
    let landHeightSum = 0;

    function seaLevelFromOceanSA(u: number, stdDevs: number): { elevFeet: number; zStd: number } {
      // Desired behavior:
      // - Peak/mode at 0
      // - +4σ maps to HIGHEST_ELEVATION_LIMIT
      // - -4σ maps to LOWEST_ELEVATION_LIMIT
      // - Not a 50/50 sign split: split-normal with left mass w based on the two ranges.

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
      const elevFeet = clamp(BASE_ABYSSAL_FLOOR_ELEVATION + sigmaFeet * zStd, LOWEST_ELEVATION_LIMIT, HIGHEST_ELEVATION_LIMIT);
      return { elevFeet, zStd };
    }

    // Choose sea level as the elevation quantile corresponding to oceanSAFraction.
    // With the percentile-based elevation mapping, this makes the ocean coverage match
    // the slider (up to ~1/N discretization).
    seaLevelElev = seaLevelFromOceanSA(oceanSAFraction, STD_DEVS).elevFeet;

    const unitMesh = createIcosphere(8, 1, 1);  //first parameter produces more/less vertices
    const vertexCount = unitMesh.vertices.length / 4;

    const rawValues: number[] = new Array(vertexCount);
    const order: number[] = new Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      const x = unitMesh.vertices[i * 4 + 0];
      const y = unitMesh.vertices[i * 4 + 1];
      const z = unitMesh.vertices[i * 4 + 2];
      rawValues[i] = rawNoiseOnSphere(x, y, z, noise);
      order[i] = i;
    }

    console.time('rawValues sort');
    order.sort((a, b) => rawValues[a] - rawValues[b]);
    console.timeEnd('rawValues sort');

    const percentiles: number[] = new Array(vertexCount);
    for (let rank = 0; rank < vertexCount; rank++) {
      const idx = order[rank];
      percentiles[idx] = (rank + 0.5) / vertexCount;
    }

    const outVertices = new Float32Array(unitMesh.vertices.length);
    for (let i = 0; i < vertexCount; i++) {
      const x = unitMesh.vertices[i * 4 + 0];
      const y = unitMesh.vertices[i * 4 + 1];
      const z = unitMesh.vertices[i * 4 + 2];
      const rx = x;
      const ry = y;
      const rz = z;

      const { elevFeet, zStd } = seaLevelFromOceanSA(percentiles[i], STD_DEVS);

      // Track min/max elevation (feet)
      if (elevFeet < minElevFeet) minElevFeet = elevFeet;
      if (elevFeet > maxElevFeet) maxElevFeet = elevFeet;

      totalVerts++;

      const absZ = Math.abs(zStd);
      if (absZ >= 1) countAbsZGe1++;
      if (absZ >= 2) countAbsZGe2++;
      if (absZ >= 3) countAbsZGe3++;
      if (absZ >= 4) countAbsZGe4++;

      if (elevFeet < 0) countNegElev++;
      else countPosElev++;

      if (elevFeet <= LOWEST_ELEVATION_LIMIT) countClampedLow++;
      if (elevFeet >= HIGHEST_ELEVATION_LIMIT) countClampedHigh++;

      // Track mean depths/heights relative to sea level (feet)
      if (elevFeet < seaLevelElev) {
        oceanCount++;
        oceanDepthSum += (seaLevelElev - elevFeet);
      } else {
        landCount++;
        landHeightSum += (elevFeet - seaLevelElev);
      }

      // Geometry: flatten all water to the sea-level surface (no undersea relief).
      // Keep the true `elevFeet` in the vertex for coloring/statistics.
      const visualElevFeet = elevFeet < seaLevelElev ? seaLevelElev : elevFeet;
      const r = (BASE_ABYSSAL_RADIUS + visualElevFeet * RELIEF_EXAGGERATION) * VISUALIZATION_SCALE;
      outVertices[i * 4 + 0] = rx * r;
      outVertices[i * 4 + 1] = ry * r;
      outVertices[i * 4 + 2] = rz * r;
      outVertices[i * 4 + 3] = elevFeet;
    }

    mesh = {
      vertices: outVertices,
      indices: unitMesh.indices,
    };

    //a normal is a radius at any given surface point
    const normals = computeVertexNormals(outVertices, unitMesh.indices);

    // Create or update buffers
    if (vertexBuffer) {
      device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices);
    } else {
      vertexBuffer = device.createBuffer({
        size: mesh.vertices.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
      });
      new Float32Array(vertexBuffer.getMappedRange()).set(mesh.vertices);
      vertexBuffer.unmap();
    }

    if (normalBuffer) {
      device.queue.writeBuffer(normalBuffer, 0, normals.buffer, normals.byteOffset, normals.byteLength);
    } else {
      normalBuffer = device.createBuffer({
        size: normals.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
      });
      new Float32Array(normalBuffer.getMappedRange()).set(normals);
      normalBuffer.unmap();
    }

    if (indexBuffer) {
      device.queue.writeBuffer(indexBuffer, 0, mesh.indices);
    } else {
      indexBuffer = device.createBuffer({
        size: mesh.indices.byteLength,
        usage: GPUBufferUsage.INDEX,
        mappedAtCreation: true,
      });
      new Uint32Array(indexBuffer.getMappedRange()).set(mesh.indices);
      indexBuffer.unmap();
    }

    // Compute averages (vertex-weighted; roughly area-uniform for an icosphere)
    const avgOceanDepthFeet = oceanCount > 0 ? oceanDepthSum / oceanCount : 0;
    const avgLandHeightFeet = landCount > 0 ? landHeightSum / landCount : 0;
    const oceanFracActual = vertexCount > 0 ? oceanCount / vertexCount : 0;

    // Log updated stats
    console.log('***************************************');
    console.log('Total Vertices:', totalVerts);
    console.log('Vertices < 0:', countNegElev);
    console.log('Vertices >= 0:', countPosElev);
    console.log('|z| >= 1:', countAbsZGe1);
    console.log('|z| >= 2:', countAbsZGe2);
    console.log('|z| >= 3:', countAbsZGe3);
    console.log('|z| >= 4:', countAbsZGe4);
    console.log('Vertices clamped low:', countClampedLow);
    console.log('Vertices clamped high:', countClampedHigh);
    console.log('Highest elevation (feet):', maxElevFeet);
    console.log('Lowest elevation (feet):', minElevFeet);
    console.log('Approx ocean surface area %:', (oceanFracActual * 100).toFixed(4));
    console.log('Sea Level:', seaLevelElev);

    return { avgOceanDepthFeet, avgLandHeightFeet, oceanFracActual };
  }

  function updateVolumeRatioDisplayAndMesh() {
    oceanSAFraction = Number(oceanSAPercentSlider.value) / 100;
    oceanSAPercentValue.textContent = oceanSAPercentSlider.value; //update the display

    // Regenerate mesh first so we can compute avg depth/height consistently.
    const stats = createMeshAndApply();
  }

  updateVolumeRatioDisplayAndMesh();

  //Listener waits a bit before updating ocean/land surface area coverage
  let debounceTimeout: number | undefined;
  oceanSAPercentSlider.addEventListener('input', () => {
    if (debounceTimeout !== undefined) {
      clearTimeout(debounceTimeout);
    }
    debounceTimeout = window.setTimeout(() => {
      updateVolumeRatioDisplayAndMesh();
      debounceTimeout = undefined;
    }, 500);
  });

  // Add a minimal mat4 library for view/projection
  function perspectiveMatrix(fovy: number, aspect: number, near: number, far: number): Float32Array {
    const f = 1.0 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, (2 * far * near) * nf, 0
    ]);
  }

  function lookAtMatrix(eye: [number, number, number], center: [number, number, number], up: [number, number, number]): Float32Array {
    const [ex, ey, ez] = eye;
    const [cx, cy, cz] = center;
    const [ux, uy, uz] = up;

    let zx = ex - cx, zy = ey - cy, zz = ez - cz;
    let len = Math.hypot(zx, zy, zz);
    zx /= len; zy /= len; zz /= len;

    let xx = uy * zz - uz * zy;
    let xy = uz * zx - ux * zz;
    let xz = ux * zy - uy * zx;
    len = Math.hypot(xx, xy, xz);
    xx /= len; xy /= len; xz /= len;

    let yx = zy * xz - zz * xy;
    let yy = zz * xx - zx * xz;
    let yz = zx * xy - zy * xx;

    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * ex + xy * ey + xz * ez),
      -(yx * ex + yy * ey + yz * ez),
      -(zx * ex + zy * ey + zz * ez),
      1
    ]);
  }

  // Uniform buffer for MVP + model matrices
  const aspect = canvas.width / canvas.height;
  const proj = perspectiveMatrix(Math.PI / 2.2, aspect, 0.01, 800); // wider FOV + bigger depth range

  // Camera zoom (mouse wheel)
  let cameraDistance = 35;
  const BASE_VISUAL_RADIUS = BASE_ABYSSAL_RADIUS * VISUALIZATION_SCALE;
  // Don't allow zooming inside the sphere; stay just above the surface.
  const CAMERA_DISTANCE_MIN = BASE_VISUAL_RADIUS * 1.001;
  const CAMERA_DISTANCE_MAX = 500;

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomStrength = 0.0015;
    const speed = e.shiftKey ? 3.0 : 1.0;
    cameraDistance = clamp(cameraDistance * Math.exp(e.deltaY * zoomStrength * speed), CAMERA_DISTANCE_MIN, CAMERA_DISTANCE_MAX);
  }, { passive: false });
  
  // Matrix multiplication (column-major)
  function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; ++i) {
      for (let j = 0; j < 4; ++j) {
        out[j * 4 + i] =
          a[i] * b[j * 4] +
          a[4 + i] * b[j * 4 + 1] +
          a[8 + i] * b[j * 4 + 2] +
          a[12 + i] * b[j * 4 + 3];
      }
    }
    return out;
  }

  function rotationY(angle: number): Float32Array {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([
      c, 0,  s, 0,
      0, 1,  0, 0,
      -s, 0,  c, 0,
      0, 0,  0, 1
    ]);
  }

  function rotationX(angle: number): Float32Array {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([
      1, 0,  0, 0,
      0, c, -s, 0,
      0, s,  c, 0,
      0, 0,  0, 1
    ]);
  }

  function modelMatrixYX(angle: number): Float32Array {
    // Y is the spin/pole axis.
    return rotationY(angle);
  }


  let mvpBuffer = device.createBuffer({
    size: 128,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  // Uniform buffer for zSeaBuffer
  let zSeaBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Bind group layout and bind group
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
    ],
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: mvpBuffer } },
      { binding: 1, resource: { buffer: zSeaBuffer } },
    ],
  });

  // Update pipeline and shaders for color by elevation
  const vertexShader = `
    struct Uniforms { mvp: mat4x4<f32>, model: mat4x4<f32> };
    @group(0) @binding(0) var<uniform> uniforms: Uniforms;
    struct VertexOut {
      @builtin(position) pos: vec4<f32>,
      @location(0) elev: f32,
      @location(1) nrm: vec3<f32>,
    };
    @vertex
    fn main(@location(0) position: vec3<f32>, @location(1) elevation: f32, @location(2) normal: vec3<f32>) -> VertexOut {
      var out: VertexOut;
      out.pos = uniforms.mvp * vec4<f32>(position, 1.0);
      out.elev = elevation;
      out.nrm = normalize((uniforms.model * vec4<f32>(normal, 0.0)).xyz);
      return out;
    }
  `;
  
  const fragmentShader = `
    @group(0) @binding(1) var<uniform> zSea: f32;
    @fragment
    fn main(@location(0) elev: f32, @location(1) nrm: vec3<f32>) -> @location(0) vec4<f32> {
      let lightDir = normalize(vec3<f32>(0.35, 0.85, 0.4));
      let ndotl = max(dot(normalize(nrm), lightDir), 0.0);
      let ambient = 0.4; //increases overall light
      let shade = ambient + (1.0 - ambient) * ndotl;
        // Additional code can go here

      // Color stops
      let deepOcean = vec3<f32>(0.05, 0.15, 0.4);
      let midOcean  = vec3<f32>(0.1, 0.3, 0.7);
      let shallowOcean = vec3<f32>(0.2, 0.5, 1.0);
      let lowLand   = vec3<f32>(0.2, 0.36, 0.2);
      let highLand  = vec3<f32>(0.3, 0.2, 0.1);
      let rocky     = vec3<f32>(0.4, 0.4, 0.4);
      let snow      = vec3<f32>(1.0, 1.0, 1.0);

      var color: vec3<f32>;

      if (elev < zSea - 15000.0) {
        // Deep to mid ocean
        let t = smoothstep(zSea - 25000.0, zSea - 15000.0, elev);
        color = mix(deepOcean, midOcean, t);
      } else if (elev < zSea - 6000.0) {
        // Mid to shallow ocean
        let t = smoothstep(zSea - 15000.0, zSea - 6000.0, elev);
        color = mix(midOcean, shallowOcean, t);
      } else if (elev < zSea) {
        // Shallow ocean (no gradient to low land)
        color = shallowOcean;
      } else if (elev < zSea + 12000.0) {
        // Low land to highland
        let t = smoothstep(zSea, zSea + 12000.0, elev);
        color = mix(lowLand, highLand, t);
      } else if (elev < zSea + 17000.0) {
        // Highland to rocky
        let t = smoothstep(zSea + 12000.0, zSea + 17000.0, elev);
        color = mix(highLand, rocky, t);
      } else {
        // Rocky to snow
        let t = smoothstep(zSea + 18000.0, zSea + 25000.0, elev);
        color = mix(rocky, snow, t);
      }
      return vec4<f32>(color * shade, 1.0);
    }
  `;

  // Update pipeline vertex buffer layout
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: device.createShaderModule({ code: vertexShader }),
      entryPoint: 'main',
      buffers: [
        {
          arrayStride: 16,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32' },
          ],
        },
        {
          arrayStride: 12,
          attributes: [
            { shaderLocation: 2, offset: 0, format: 'float32x3' },
          ],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({ code: fragmentShader }),
      entryPoint: 'main',
      targets: [{ format }],
    },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
  });

  let depthTexture = device.createTexture({
    size: { width: canvas.width, height: canvas.height, depthOrArrayLayers: 1 },
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  function frame(time: number) {
    // Animate model rotation
    const angle = (time || 0) * 0.0002; //change decimal to change speed
    const model = modelMatrixYX(angle);
    // MVP = proj * view * model
    const view = lookAtMatrix([0, 0, cameraDistance], [0, 0, 0], [0, 1, 0]);
    const mv = multiplyMat4(view, model);
    const mvp = multiplyMat4(proj, mv);

    const uniforms = new Float32Array(32);
    uniforms.set(mvp, 0);
    uniforms.set(model, 16);
    device.queue.writeBuffer(mvpBuffer, 0, uniforms.buffer, uniforms.byteOffset, uniforms.byteLength);

    const sea = new Float32Array([seaLevelElev]);
    device.queue.writeBuffer(zSeaBuffer, 0, sea.buffer, sea.byteOffset, sea.byteLength);

    const encoder = device.createCommandEncoder();
    const texView = context.getCurrentTexture().createView();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: texView,
        clearValue: { r: 0.05, g: 0.05, b: 0.1, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.setVertexBuffer(1, normalBuffer);
    pass.setIndexBuffer(indexBuffer, 'uint32');
    pass.drawIndexed(mesh.indices.length);
    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

runWebGPU();
