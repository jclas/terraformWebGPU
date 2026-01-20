// Icosahedron-based sphere mesh generator (icosphere)
// Returns { vertices: Float32Array, indices: Uint32Array }
// Each vertex: [x, y, z, elevation]

/**
 * Generates an icosphere mesh with optional elevation-based displacement.
 *
 * @param subdivisions - Number of recursive subdivisions to apply to the base icosahedron.
 *        Higher values yield smoother spheres. Produces more/less vertices based on this.
 *        For each extra subdivision you get a new vertex in the middle of each edge.
 * @param baseRadiusMiles - The base radius of the sphere in miles before elevation is applied.
 * @param elevationFn - Optional function to compute elevation at each vertex. Receives normalized (x, y, z) coordinates and returns elevation in feet.
 * @param VISUALIZATION_SCALE - Scale factor to convert miles to visualization units.
 * @returns An object containing:
 *   - `vertices`: A Float32Array where each vertex is represented by four values: x, y, z (scaled and displaced by elevation), and normalized elevation.
 *   - `indices`: A Uint32Array of triangle indices for rendering the mesh.
 *
 * The function constructs an icosphere by subdividing the faces of an icosahedron,
 * normalizing new vertices to the unit sphere, and then optionally displacing them radially
 * according to the provided elevation function. The resulting mesh is suitable for use in 3D rendering pipelines.
 */
export function createIcosphere(subdivisions = 3, baseRadius = 20908800, VISUALIZATION_SCALE = 0.000001, elevationFn?: (x: number, y: number, z: number) => number) {
  // Golden ratio
  const t = (1 + Math.sqrt(5)) / 2;
  // Initial icosahedron vertices
  let verts = [
    [-1,  t,  0], [ 1,  t,  0], [-1, -t,  0], [ 1, -t,  0],
    [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
    [ t,  0, -1], [ t,  0,  1], [-t,  0, -1], [-t,  0,  1]
  ];
  // Normalize to unit sphere
  verts = verts.map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x/l, y/l, z/l];
  });
  // Initial faces
  let faces = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]
  ];
  // Subdivide faces
  const midCache = new Map<string, number>();
  function getMid(a: number, b: number): number {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (midCache.has(key)) return midCache.get(key)!;
    const [x1, y1, z1] = verts[a];
    const [x2, y2, z2] = verts[b];
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, mz = (z1 + z2) / 2;
    const l = Math.hypot(mx, my, mz);
    const v = [mx/l, my/l, mz/l];
    verts.push(v);
    const idx = verts.length - 1;
    midCache.set(key, idx);
    return idx;
  }
  for (let s = 0; s < subdivisions; s++) {
    const newFaces = [];
    for (const [a, b, c] of faces) {
      const ab = getMid(a, b);
      const bc = getMid(b, c);
      const ca = getMid(c, a);
      newFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = newFaces;
  }
  // Build vertex/elevation array
  const vertices: number[] = [];
  for (const [x, y, z] of verts) {
    let elev = 0;
    if (elevationFn) elev = elevationFn(x, y, z);
    // const r = (baseRadius) * VISUALIZATION_SCALE;
    const r = (baseRadius + elev) * VISUALIZATION_SCALE;
    vertices.push(x * r, y * r, z * r, elev);
  }
  // Build indices
  const indices: number[] = [];
  for (const [a, b, c] of faces) indices.push(a, b, c);
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices)
  };
}
