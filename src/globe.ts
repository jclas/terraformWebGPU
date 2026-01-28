/// <reference types="@webgpu/types" />

import {
  TERRAIN_COLOR_CONFIG,
  buildTerrainMesh,
  clamp,
} from './terrain';

export interface GlobeUiRefs {
  oceanSAPercentSlider: HTMLInputElement;
  oceanSAPercentValue: HTMLElement;
}

function wgslVec3(v: readonly [number, number, number]): string {
  return `vec3<f32>(${v[0]}, ${v[1]}, ${v[2]})`;
}

function buildFragmentShader(): string {
  const cfg = TERRAIN_COLOR_CONFIG;

  return `
    @group(0) @binding(1) var<uniform> zSea: f32;
    @fragment
    fn main(@location(0) elev: f32, @location(1) nrm: vec3<f32>) -> @location(0) vec4<f32> {
      let lightDir = normalize(vec3<f32>(0.35, 0.85, 0.4));
      let ndotl = max(dot(normalize(nrm), lightDir), 0.0);
      let ambient = 0.4;
      let shade = ambient + (1.0 - ambient) * ndotl;

      let deepOcean = ${wgslVec3(cfg.deepOcean)};
      let midOcean  = ${wgslVec3(cfg.midOcean)};
      let shallowOcean = ${wgslVec3(cfg.shallowOcean)};
      let lowLand   = ${wgslVec3(cfg.lowLand)};
      let highLand  = ${wgslVec3(cfg.highLand)};
      let rocky     = ${wgslVec3(cfg.rocky)};
      let snow      = ${wgslVec3(cfg.snow)};

      var color: vec3<f32>;

      if (elev < zSea + ${cfg.deepToMidEndOffsetFeet}.0) {
        let t = smoothstep(zSea + ${cfg.deepToMidStartOffsetFeet}.0, zSea + ${cfg.deepToMidEndOffsetFeet}.0, elev);
        color = mix(deepOcean, midOcean, t);
      } else if (elev < zSea + ${cfg.midToShallowEndOffsetFeet}.0) {
        let t = smoothstep(zSea + ${cfg.midToShallowStartOffsetFeet}.0, zSea + ${cfg.midToShallowEndOffsetFeet}.0, elev);
        color = mix(midOcean, shallowOcean, t);
      } else if (elev < zSea) {
        color = shallowOcean;
      } else if (elev < zSea + ${cfg.lowToHighEndOffsetFeet}.0) {
        let t = smoothstep(zSea, zSea + ${cfg.lowToHighEndOffsetFeet}.0, elev);
        color = mix(lowLand, highLand, t);
      } else if (elev < zSea + ${cfg.highToRockyEndOffsetFeet}.0) {
        let t = smoothstep(zSea + ${cfg.lowToHighEndOffsetFeet}.0, zSea + ${cfg.highToRockyEndOffsetFeet}.0, elev);
        color = mix(highLand, rocky, t);
      } else {
        let t = smoothstep(zSea + ${cfg.rockyToSnowStartOffsetFeet}.0, zSea + ${cfg.rockyToSnowEndOffsetFeet}.0, elev);
        color = mix(rocky, snow, t);
      }

      return vec4<f32>(color * shade, 1.0);
    }
  `;
}

function perspectiveMatrix(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0,
  ]);
}

function lookAtMatrix(
  eye: [number, number, number],
  center: [number, number, number],
  up: [number, number, number],
): Float32Array {
  const [ex, ey, ez] = eye;
  const [cx, cy, cz] = center;
  const [ux, uy, uz] = up;

  let zx = ex - cx;
  let zy = ey - cy;
  let zz = ez - cz;
  let len = Math.hypot(zx, zy, zz);
  zx /= len;
  zy /= len;
  zz /= len;

  let xx = uy * zz - uz * zy;
  let xy = uz * zx - ux * zz;
  let xz = ux * zy - uy * zx;
  len = Math.hypot(xx, xy, xz);
  xx /= len;
  xy /= len;
  xz /= len;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * ex + xy * ey + xz * ez),
    -(yx * ex + yy * ey + yz * ez),
    -(zx * ex + zy * ey + zz * ez),
    1,
  ]);
}

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
    c, 0, s, 0,
    0, 1, 0, 0,
    -s, 0, c, 0,
    0, 0, 0, 1,
  ]);
}

export class GlobeRenderer {
  private gpuAdapter: GPUAdapter | null = null;
  private gpuDevice: GPUDevice | null = null;
  private gpuContext: GPUCanvasContext | null = null;
  private gpuFormat: GPUTextureFormat | null = null;

  private vertexBuffer: GPUBuffer | null = null;
  private normalBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private depthTexture: GPUTexture | null = null;
  private mvpBuffer: GPUBuffer | null = null;
  private zSeaBuffer: GPUBuffer | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private pipeline: GPURenderPipeline | null = null;

  private meshIndexCount = 0;
  private seaLevelFeet = 0;
  private seed = 0;

  private activeRenderLoopId = 0;
  private activeRafHandle: number | null = null;

  private sliderListenerAttached = false;
  private wheelListenerAttached = false;
  private debounceTimeout: number | undefined;

  private cameraDistance = 35;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ui: GlobeUiRefs,
  ) {}

  private cleanupMeshBuffers() {
    if (this.vertexBuffer) {
      this.vertexBuffer.destroy();
      this.vertexBuffer = null;
    }
    if (this.normalBuffer) {
      this.normalBuffer.destroy();
      this.normalBuffer = null;
    }
    if (this.indexBuffer) {
      this.indexBuffer.destroy();
      this.indexBuffer = null;
    }
  }

  private cleanupGPUResources() {
    this.cleanupMeshBuffers();

    if (this.depthTexture) {
      this.depthTexture.destroy();
      this.depthTexture = null;
    }
    if (this.mvpBuffer) {
      this.mvpBuffer.destroy();
      this.mvpBuffer = null;
    }
    if (this.zSeaBuffer) {
      this.zSeaBuffer.destroy();
      this.zSeaBuffer = null;
    }
    // pipeline/bindGroup/bindGroupLayout do not need explicit destroy
  }

  private ensureUiListenersAttached() {
    if (!this.sliderListenerAttached) {
      this.sliderListenerAttached = true;

      // Preserve existing slider behavior: debounced mesh regeneration.
      this.ui.oceanSAPercentSlider.addEventListener('input', () => {
        if (this.debounceTimeout !== undefined) {
          clearTimeout(this.debounceTimeout);
        }
        this.debounceTimeout = window.setTimeout(() => {
          this.updateVolumeRatioDisplayAndMesh();
          this.debounceTimeout = undefined;
        }, 500);
      });
    }

    if (!this.wheelListenerAttached) {
      this.wheelListenerAttached = true;
      this.canvas.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          const zoomStrength = 0.0015;
          const speed = e.shiftKey ? 3.0 : 1.0;

          // Keep the same min/max semantics as before.
          const baseVisualRadius = 20_889_115 * 0.000001;
          const cameraMin = baseVisualRadius * 1.001;
          const cameraMax = 500;

          this.cameraDistance = clamp(
            this.cameraDistance * Math.exp(e.deltaY * zoomStrength * speed),
            cameraMin,
            cameraMax,
          );
        },
        { passive: false },
      );
    }
  }

  private updateVolumeRatioDisplayAndMesh() {
    const oceanSAFraction = Number(this.ui.oceanSAPercentSlider.value) / 100;
    this.ui.oceanSAPercentValue.textContent = this.ui.oceanSAPercentSlider.value;
    this.rebuildMeshAndUpload(this.seed, oceanSAFraction);
  }

  private rebuildMeshAndUpload(seed: number, oceanSAFraction: number) {
    if (!this.gpuDevice) return;

    const device = this.gpuDevice;

    const meshData = buildTerrainMesh(seed, oceanSAFraction, 8);
    this.seaLevelFeet = meshData.seaLevelFeet;
    this.meshIndexCount = meshData.indices.length;

    // Preserve prior behavior: log stats on each regen.
    console.log('***************************************');
    console.log('Total Vertices:', meshData.stats.totalVerts);
    console.log('Vertices < 0:', meshData.stats.countNegElev);
    console.log('Vertices >= 0:', meshData.stats.countPosElev);
    console.log('|z| >= 1:', meshData.stats.countAbsZGe1);
    console.log('|z| >= 2:', meshData.stats.countAbsZGe2);
    console.log('|z| >= 3:', meshData.stats.countAbsZGe3);
    console.log('|z| >= 4:', meshData.stats.countAbsZGe4);
    console.log('Vertices clamped low:', meshData.stats.countClampedLow);
    console.log('Vertices clamped high:', meshData.stats.countClampedHigh);
    console.log('Highest elevation (feet):', meshData.stats.maxElevFeet);
    console.log('Lowest elevation (feet):', meshData.stats.minElevFeet);
    console.log('Approx ocean surface area %:', (meshData.stats.oceanFracActual * 100).toFixed(4));
    console.log('Sea Level:', meshData.stats.seaLevelFeet);

    this.cleanupMeshBuffers();

    this.vertexBuffer = device.createBuffer({
      size: meshData.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(this.vertexBuffer.getMappedRange()).set(meshData.vertices);
    this.vertexBuffer.unmap();

    this.normalBuffer = device.createBuffer({
      size: meshData.normals.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(this.normalBuffer.getMappedRange()).set(meshData.normals);
    this.normalBuffer.unmap();

    this.indexBuffer = device.createBuffer({
      size: meshData.indices.byteLength,
      usage: GPUBufferUsage.INDEX,
      mappedAtCreation: true,
    });
    new Uint32Array(this.indexBuffer.getMappedRange()).set(meshData.indices);
    this.indexBuffer.unmap();
  }

  async terraformWithSeed(seed: number) {
    // Stop any prior animation loop (and ensure stale loops stop rescheduling).
    this.activeRenderLoopId++;
    const renderLoopId = this.activeRenderLoopId;
    if (this.activeRafHandle !== null) {
      cancelAnimationFrame(this.activeRafHandle);
      this.activeRafHandle = null;
    }

    this.seed = seed;

    const gpu = (navigator as any).gpu as GPU | undefined;
    if (!gpu) {
      document.body.innerHTML = 'WebGPU not supported.';
      return;
    }

    this.ensureUiListenersAttached();

    if (!this.gpuAdapter) {
      this.gpuAdapter = await gpu.requestAdapter();
      if (!this.gpuAdapter) throw new Error('No GPU adapter found');
    }
    if (!this.gpuDevice) {
      this.gpuDevice = await this.gpuAdapter.requestDevice();
    }
    if (!this.gpuContext) {
      this.gpuContext = this.canvas.getContext('webgpu') as unknown as GPUCanvasContext;
    }
    if (!this.gpuFormat) {
      this.gpuFormat = gpu.getPreferredCanvasFormat();
    }

    this.gpuContext.configure({ device: this.gpuDevice, format: this.gpuFormat });

    this.cleanupGPUResources();

    const device = this.gpuDevice;
    const context = this.gpuContext;
    const format = this.gpuFormat;

    // Build mesh based on current slider state.
    this.updateVolumeRatioDisplayAndMesh();

    const aspect = this.canvas.width / this.canvas.height;
    const proj = perspectiveMatrix(Math.PI / 2.2, aspect, 0.01, 800);

    this.mvpBuffer = device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.zSeaBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroupLayout = device.createBindGroupLayout({
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

    this.bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.mvpBuffer } },
        { binding: 1, resource: { buffer: this.zSeaBuffer } },
      ],
    });

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

    const fragmentShader = buildFragmentShader();

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
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
            attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x3' }],
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

    this.depthTexture = device.createTexture({
      size: { width: this.canvas.width, height: this.canvas.height, depthOrArrayLayers: 1 },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const frame = (time: number) => {
      if (renderLoopId !== this.activeRenderLoopId) return;

      const angle = (time || 0) * 0.00015; //rotation speed
      const model = rotationY(angle);

      const view = lookAtMatrix([0, 0, this.cameraDistance], [0, 0, 0], [0, 1, 0]);
      const mv = multiplyMat4(view, model);
      const mvp = multiplyMat4(proj, mv);

      const uniforms = new Float32Array(32);
      uniforms.set(mvp, 0);
      uniforms.set(model, 16);
      device.queue.writeBuffer(this.mvpBuffer!, 0, uniforms.buffer, uniforms.byteOffset, uniforms.byteLength);

      const sea = new Float32Array([this.seaLevelFeet]);
      device.queue.writeBuffer(this.zSeaBuffer!, 0, sea.buffer, sea.byteOffset, sea.byteLength);

      const encoder = device.createCommandEncoder();
      const texView = context.getCurrentTexture().createView();

      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: texView,
            clearValue: { r: 0.05, g: 0.05, b: 0.1, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: this.depthTexture!.createView(),
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });

      pass.setPipeline(this.pipeline!);
      pass.setBindGroup(0, this.bindGroup!);
      pass.setVertexBuffer(0, this.vertexBuffer!);
      pass.setVertexBuffer(1, this.normalBuffer!);
      pass.setIndexBuffer(this.indexBuffer!, 'uint32');
      pass.drawIndexed(this.meshIndexCount);
      pass.end();

      device.queue.submit([encoder.finish()]);
      this.activeRafHandle = requestAnimationFrame(frame);
    };

    this.activeRafHandle = requestAnimationFrame(frame);
  }
}
