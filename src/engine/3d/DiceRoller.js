/**
 * DiceRoller — physics-driven 3D dice for Grimoire.
 *
 * Renders polyhedral dice (d4, d6, d8, d10, d12, d20) with Three.js and
 * simulates them with cannon-es. After the dice settle, the upward-facing
 * face is read back so the result is the *physical* outcome, not a random
 * number with animation bolted on.
 *
 * The module is renderer-agnostic about WHERE it draws: you hand it a
 * THREE.Scene + CANNON.World (so dice can share the same world as the
 * tabletop in 3D mode) OR let it build a self-contained tray. This keeps it
 * usable both inside the full 3D scene and in a small 2D-mode dice drawer.
 *
 * Dependencies are injected (THREE, CANNON) so this file has no hard import
 * and can run under Vite bundling or a browser import-map unchanged.
 */

// Geometry definitions: each die type maps to a polyhedron and a function
// that, given the world-up normal of the resting die, returns the value.
const DIE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

export class DiceRoller {
  /**
   * @param {object} deps
   * @param {*} deps.THREE  the three.js module namespace
   * @param {*} deps.CANNON the cannon-es module namespace
   * @param {THREE.Scene}  [deps.scene]  reuse an existing scene
   * @param {CANNON.World} [deps.world]  reuse an existing physics world
   * @param {function}     [deps.onSettle] callback(results[]) when all dice stop
   */
  constructor({ THREE, CANNON, scene, world, onSettle } = {}) {
    if (!THREE || !CANNON) throw new Error('DiceRoller needs THREE and CANNON injected');
    this.THREE = THREE;
    this.CANNON = CANNON;
    this.onSettle = onSettle || (() => {});

    this.ownsWorld = !world;
    this.world = world || new CANNON.World({ gravity: new CANNON.Vec3(0, -38, 0) });
    if (this.ownsWorld) {
      this.world.broadphase = new CANNON.SAPBroadphase(this.world);
      this.world.allowSleep = true;
      this._buildTrayBody();
    }

    this.scene = scene || new THREE.Scene();
    this.dice = []; // { mesh, body, type, asleep }
    this._diceMaterial = new CANNON.Material('dice');
    this._floorMaterial = new CANNON.Material('floor');
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this._diceMaterial, this._floorMaterial, {
        friction: 0.4,
        restitution: 0.35,
      })
    );
  }

  /** Invisible floor + four walls so dice stay in a tray. */
  _buildTrayBody() {
    const { CANNON } = this;
    const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(floor);
    this._trayFloor = floor;

    const S = 12; // tray half-size
    const walls = [
      { pos: [0, 0, -S], rot: [0, 0, 0] },
      { pos: [0, 0, S], rot: [0, Math.PI, 0] },
      { pos: [-S, 0, 0], rot: [0, Math.PI / 2, 0] },
      { pos: [S, 0, 0], rot: [0, -Math.PI / 2, 0] },
    ];
    for (const w of walls) {
      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
      body.quaternion.setFromEuler(...w.rot);
      body.position.set(...w.pos);
      this.world.addBody(body);
    }
  }

  /**
   * Roll a set of dice. Notation is an array like
   *   [{ type:'d20', count:2, color:'#c0392b' }, { type:'d6', count:4 }]
   * or a shorthand string '2d20+4d6'.
   */
  roll(spec, { seed } = {}) {
    this.clear();
    const groups = typeof spec === 'string' ? parseNotation(spec) : spec;
    const rng = makeRng(seed);

    for (const g of groups) {
      for (let i = 0; i < (g.count || 1); i++) {
        this._spawnDie(g.type, g.color || '#e8e2d0', rng);
      }
    }
    this._settled = false;
    this._rollStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    return this;
  }

  /**
   * Roll and resolve once the dice settle, returning the results array.
   * Used by the addon SDK's GRIM.dice.roll() so plugins can await a value.
   */
  rollAsync(spec, opts = {}) {
    return new Promise((resolve) => {
      const prev = this.onSettle;
      this.onSettle = (results) => {
        this.onSettle = prev;            // restore the standing handler
        try { prev?.(results); } catch { /* ignore */ }
        resolve(results);
      };
      this.roll(spec, opts);
      // Safety timeout so a stuck die never hangs the plugin's await.
      setTimeout(() => {
        if (this.onSettle !== prev) {
          this.onSettle = prev;
          resolve(this.dice.map((d) => ({ type: d.type, value: d.faceValue(d.body.quaternion, this.THREE) })));
        }
      }, 8000);
    });
  }

  _spawnDie(type, color, rng) {
    const { THREE, CANNON } = this;
    const { geometry, shape, faceValue, scale, faceMap, faceRadius, labelSize, labelMode } = buildDie(type, THREE, CANNON);

    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      metalness: 0.1,
      roughness: 0.45,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    // Edge wireframe for that crisp tabletop look.
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 25),
      new THREE.LineBasicMaterial({ color: 0x111111 })
    );
    mesh.add(edges);
    if (labelMode === 'd4') addD4Labels(mesh, geometry, labelValues, labelSize, THREE);
    else addFaceLabels(mesh, faceMap, faceRadius, labelSize, THREE);

    const body = new CANNON.Body({
      mass: 1,
      shape,
      material: this._diceMaterial,
      sleepSpeedLimit: 0.25,
      sleepTimeLimit: 0.3,
    });
    body.allowSleep = true;

    // Toss it in from above with random spin and velocity.
    body.position.set((rng() - 0.5) * 6, 8 + rng() * 4, (rng() - 0.5) * 6);
    body.velocity.set((rng() - 0.5) * 16, -4, (rng() - 0.5) * 16);
    body.angularVelocity.set(rng() * 24 - 12, rng() * 24 - 12, rng() * 24 - 12);
    body.quaternion.setFromEuler(rng() * 6, rng() * 6, rng() * 6);

    this.world.addBody(body);
    this.dice.push({ mesh, body, type, faceValue, scale, asleep: false });
  }

  /**
   * Advance the simulation. Call from your render loop with a frame dt.
   * If the world is shared (owned by Scene3D), that scene already steps it,
   * so we only step here when we own the world — otherwise we'd double-step.
   */
  step(dt = 1 / 60) {
    if (this.ownsWorld) this.world.step(1 / 60, dt, 3);
    if (this._settled || this.dice.length === 0) {
      for (const d of this.dice) {
        d.mesh.position.copy(d.body.position);
        d.mesh.quaternion.copy(d.body.quaternion);
      }
      return;
    }

    let allAsleep = true;
    let allSlow = true;       // velocity-based fallback for dice that won't sleep
    for (const d of this.dice) {
      d.mesh.position.copy(d.body.position);
      d.mesh.quaternion.copy(d.body.quaternion);
      if (d.body.sleepState !== this.CANNON.Body.SLEEPING) allAsleep = false;
      const v = d.body.velocity, av = d.body.angularVelocity;
      const speed = Math.hypot(v.x, v.y, v.z) + Math.hypot(av.x, av.y, av.z);
      if (speed > 0.18) allSlow = false;
    }

    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - (this._rollStart || 0);
    // Resolve when: all dice sleep, OR all are nearly stationary after a brief
    // grace period, OR a hard timeout passes (many dice can jostle forever and
    // never all reach the SLEEPING state — previously the result never fired).
    const settled = allAsleep
      || (allSlow && elapsed > 1500)
      || (elapsed > 6000);

    if (settled) {
      this._settled = true;
      // Snap residual floor penetration out so dice rest flush: the solver
      // leaves a small allowed sink (a few % of the die) that reads as the
      // die "clipping into the floor".
      for (const d of this.dice) {
        const shape = d.body.shapes[0];
        if (!shape?.vertices) continue;
        let lowest = Infinity;
        for (const v of shape.vertices) {
          const t = d.body.quaternion.vmult(v);
          const y = d.body.position.y + t.y;
          if (y < lowest) lowest = y;
        }
        if (lowest < 0) {
          d.body.position.y -= lowest;
          d.body.velocity.set(0, 0, 0);
          d.body.angularVelocity.set(0, 0, 0);
        }
        // Canonical settle pose: align the die's most-downward face to
        // exactly down. The solver can leave a tetra (or d10) resting on a
        // tilted/edge contact that reads as "not a real die" — real dice
        // settle flat with the apex up; this makes every settled die crisp.
        if (shape.faceNormals?.length) {
          let worst = null, worstDot = Infinity;
          for (const n of shape.faceNormals) {
            const w = d.body.quaternion.vmult(n);
            if (w.y < worstDot) { worstDot = w.y; worst = w; }
          }
          if (worst) {
            const delta = new CANNON.Quaternion();
            delta.setFromVectors(worst, new CANNON.Vec3(0, -1, 0));
            d.body.quaternion = delta.mult(d.body.quaternion);
            // Re-run the flush lift: the alignment can change the lowest point.
            let lowest2 = Infinity;
            for (const v of shape.vertices) {
              const t = d.body.quaternion.vmult(v);
              const y = d.body.position.y + t.y;
              if (y < lowest2) lowest2 = y;
            }
            if (lowest2 < 0) d.body.position.y -= lowest2;
          }
        }
        // Lock the snapped pose.
        d.body.sleep();
      }
      const results = this.dice.map((d) => ({
        type: d.type,
        value: d.faceValue(d.body.quaternion, this.THREE),
      }));
      this.onSettle(results);
    }
  }

  clear() {
    for (const d of this.dice) {
      this.scene.remove(d.mesh);
      this.world.removeBody(d.body);
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
    }
    this.dice = [];
  }
}

/* ---------- notation parsing ---------- */

export function parseNotation(str) {
  // Accepts '2d20+4d6', '1d8', 'd20' etc. Modifiers (+3) are ignored here —
  // the caller sums them; this module only simulates real dice.
  const groups = [];
  const re = /(\d*)d(4|6|8|10|12|20)/gi;
  let m;
  while ((m = re.exec(str))) {
    groups.push({ type: 'd' + m[2], count: parseInt(m[1] || '1', 10) });
  }
  if (!groups.length) throw new Error('Could not parse dice notation: ' + str);
  return groups;
}

function makeRng(seed) {
  if (seed == null) return Math.random;
  // Mulberry32 — deterministic so rolls can be replayed/verified across clients.
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- die construction ---------- */

/**
 * Build a die of the given type. Returns the visual geometry, the physics
 * shape, and a faceValue(quaternion) reader that maps the resting orientation
 * to a number.
 *
 * Strategy: every die stores, per face, the local-space outward normal and
 * the value printed on it. After settling we rotate each normal into world
 * space and pick the one most aligned with world-up.
 */
function buildDie(type, THREE, CANNON) {
  const size = 1.1;
  let geometry, faceMap;
  let labelMode = null, labelValues = null;

  let faceRadius, labelSize;

  switch (type) {
    case 'd6': {
      geometry = new THREE.BoxGeometry(size, size, size);
      faceMap = [
        { n: [0, 1, 0], v: 6 }, { n: [0, -1, 0], v: 1 },
        { n: [1, 0, 0], v: 3 }, { n: [-1, 0, 0], v: 4 },
        { n: [0, 0, 1], v: 5 }, { n: [0, 0, -1], v: 2 },
      ];
      faceRadius = size / 2 + 0.01;
      labelSize = 0.65;
      break;
    }
    case 'd4': {
      // A real d4 is VERTEX-numbered: it rests on a face and the result is
      // read at the TOP vertex — all three surrounding faces print that
      // vertex's value at its corner, so it's legible from any side (numbers
      // sit along the edges like a physical die, not the face centre where a
      // settled d4's upright face is only seen edge-on).
      geometry = new THREE.TetrahedronGeometry(size * 1.1);
      labelValues = [1, 2, 3, 4];
      faceMap = d4VertexMap(geometry, THREE, labelValues); // {n: vertexDir, v} ×4
      labelMode = 'd4';   // corner numbers ×3 per face (edge-adjacent)
      faceRadius = 0.40;  // (unused for corner labels; kept for parity)
      labelSize = 0.34;
      break;
    }
    case 'd8': {
      geometry = new THREE.OctahedronGeometry(size);
      // Canonical d8: opposite faces sum to 9. The values array holds the
      // FIRST half (1..4); calibratedFaces pairs each with (9 − v) for the
      // opposite face. Passing the full list made every value appear twice
      // and half of them never appear (the duplicated-face bug).
      faceMap = calibratedFaces(geometry, THREE, [1, 2, 3, 4], 9);
      faceRadius = 0.65;
      labelSize = 0.5;
      break;
    }
    case 'd12': {
      geometry = new THREE.DodecahedronGeometry(size);
      // Canonical d12: opposite faces sum to 13.
      faceMap = calibratedFaces(geometry, THREE, range(1, 12), 13);
      faceRadius = 0.92;
      labelSize = 0.46;
      break;
    }
    case 'd20': {
      geometry = new THREE.IcosahedronGeometry(size);
      // Canonical d20: opposite faces sum to 21.
      faceMap = calibratedFaces(geometry, THREE, range(1, 20), 21);
      faceRadius = 0.88;
      labelSize = 0.42;
      break;
    }
    case 'd10':
    default: {
      // d10 is a PENTAGONAL trapezohedron: 2 apices + 10 kite faces
      // (n=5 → 2n kites). Calling the builder with n=10 previously produced
      // a twenty-faced decagonal solid whose values cycled wrong — the
      // malformed, mislabelled die seen in the field.
      geometry = buildTrapezohedronGeometry(5, size, THREE);
      // Values 0-9 (a d10's 0 reads as a 10); opposite faces sum to 9.
      faceMap = calibratedFaces(geometry, THREE, range(0, 9), 9);
      // Kite faces sit ~0.47·size from the centre; labels placed at 0.88
      // hovered well off the die.
      faceRadius = size * 0.5;
      labelSize = 0.42;
      break;
    }
  }

  const shape = shapeFromGeometry(geometry, THREE, CANNON);
  const faceValue = makeFaceReader(faceMap, THREE);
  return { geometry, shape, faceValue, scale: size, faceMap, faceRadius, labelSize, labelMode, labelValues };
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/** Build a convex CANNON shape from a THREE geometry. */
function shapeFromGeometry(geometry, THREE, CANNON) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position;
  const verts = [];
  const map = new Map();
  const faces = [];
  for (let i = 0; i < pos.count; i += 3) {
    const tri = [];
    for (let j = 0; j < 3; j++) {
      const x = +pos.getX(i + j).toFixed(4);
      const y = +pos.getY(i + j).toFixed(4);
      const z = +pos.getZ(i + j).toFixed(4);
      const key = `${x},${y},${z}`;
      let idx = map.get(key);
      if (idx === undefined) {
        idx = verts.length;
        verts.push(new CANNON.Vec3(x, y, z));
        map.set(key, idx);
      }
      tri.push(idx);
    }
    faces.push(tri);
  }
  return new CANNON.ConvexPolyhedron({ vertices: verts, faces });
}

/**
 * Derive face normals + values directly from a geometry's triangles by
 * clustering coplanar tris. Good enough for the platonic solids where every
 * printed face maps to one or more triangles sharing a normal.
 */
function facesFromGeometry(geometry, THREE, values, isTetra = false, modulo = null) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position;
  const seen = [];
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i < pos.count; i += 3) {
    v0.fromBufferAttribute(pos, i);
    v1.fromBufferAttribute(pos, i + 1);
    v2.fromBufferAttribute(pos, i + 2);
    v1.sub(v0); v2.sub(v0);
    normal.crossVectors(v1, v2).normalize();
    // Merge with an existing near-identical normal (coplanar faces).
    const match = seen.find((s) => s.n.dot(normal) > 0.99);
    if (!match) seen.push({ n: normal.clone(), tris: 1 });
    else match.tris++;
  }

  // Assign values in a stable order around the solid.
  seen.sort((a, b) => (a.n.y - b.n.y) || (a.n.x - b.n.x) || (a.n.z - b.n.z));
  return seen.map((s, idx) => {
    let v = values[idx % values.length];
    if (modulo) v = v % modulo;
    return { n: [s.n.x, s.n.y, s.n.z], v };
  });
}

/**
 * Build a calibrated face map for a platonic-solid die where opposite faces
 * must sum to `maxPlus1`. We take the unique face normals from the geometry,
 * pair each normal with its opposite (-n), and assign values so each opposite
 * pair gets (v, maxPlus1 - v). This matches a real die's canonical numbering.
 *
 * `values` is the list of face values in canonical order (1..N); we walk the
 * sorted normals, and for each unassigned pair we take the next two values
 * (v, maxPlus1 - v).
 */
function calibratedFaces(geometry, THREE, values, maxPlus1) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position;
  const seen = [];
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i < pos.count; i += 3) {
    v0.fromBufferAttribute(pos, i);
    v1.fromBufferAttribute(pos, i + 1);
    v2.fromBufferAttribute(pos, i + 2);
    v1.sub(v0); v2.sub(v0);
    normal.crossVectors(v1, v2).normalize();
    const match = seen.find((s) => s.n.dot(normal) > 0.99);
    if (!match) seen.push({ n: normal.clone() });
  }

  // Sort for determinism, then pair opposites.
  seen.sort((a, b) => (a.n.y - b.n.y) || (a.n.x - b.n.x) || (a.n.z - b.n.z));
  const assigned = new Array(seen.length).fill(false);
  const out = [];
  let vi = 0;
  for (let i = 0; i < seen.length; i++) {
    if (assigned[i]) continue;
    // Find the opposite normal (most negative dot product).
    let oppIdx = -1, oppDot = Infinity;
    for (let j = i + 1; j < seen.length; j++) {
      if (assigned[j]) continue;
      const d = seen[i].n.dot(seen[j].n);
      if (d < oppDot) { oppDot = d; oppIdx = j; }
    }
    const v = values[vi % values.length];
    vi++;
    out.push({ n: [seen[i].n.x, seen[i].n.y, seen[i].n.z], v });
    assigned[i] = true;
    if (oppIdx >= 0) {
      out.push({ n: [seen[oppIdx].n.x, seen[oppIdx].n.y, seen[oppIdx].n.z], v: maxPlus1 - v });
      assigned[oppIdx] = true;
    }
  }
  return out;
}

/**
 * Build an n-gonal trapezohedron (the d10 shape for n=5): two apices at ±h
 * and 2n ring vertices zigzagging between heights ±e, one ring set at the
 * n-fold angles and the other rotated half a step. Every face is a kite
 * (apex, T_i, B_i, T_{i+1}); the kites are exactly planar when the stagger
 * satisfies e = h·(1 − cos(π/n)) / (1 + cos(π/n)) — which is what makes the
 * face reading (clustering coplanar tris by normal) robust.
 */
function buildTrapezohedronGeometry(n, size, THREE) {
  const h = size * 0.9;            // apex height from centre
  const r = size * 0.62;           // ring radius (the widest girth)
  const e = h * (1 - Math.cos(Math.PI / n)) / (1 + Math.cos(Math.PI / n));
  const top = [0, h, 0];
  const bottom = [0, -h, 0];

  const upper = [], lower = [];
  for (let i = 0; i < n; i++) {
    const aU = (i / n) * Math.PI * 2;
    const aL = aU + Math.PI / n;   // lower verts rotated half a step
    upper.push([Math.cos(aU) * r, e, Math.sin(aU) * r]);
    lower.push([Math.cos(aL) * r, -e, Math.sin(aL) * r]);
  }

  const verts = [];
  const pushQuad = (a, b, c, d) => {
    // Two triangles wound so the face normal points away from the origin.
    const mid = [(a[0]+b[0]+c[0]+d[0]) / 4, (a[1]+b[1]+c[1]+d[1]) / 4, (a[2]+b[2]+c[2]+d[2]) / 4];
    const u1 = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const u2 = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    const nrm = [u1[1]*u2[2]-u1[2]*u2[1], u1[2]*u2[0]-u1[0]*u2[2], u1[0]*u2[1]-u1[1]*u2[0]];
    if (nrm[0]*mid[0] + nrm[1]*mid[1] + nrm[2]*mid[2] < 0) {
      // Inward — reverse the ENTIRE quad cycle (a,b,c,d)→(a,d,c,b). Flipping
      // only the first triangle left the second wound inward, and cannon-es
      // then rejected half the faces as "pointing into the shape" (the die
      // could only rest on half its faces and never went to sleep).
      [b, c, d] = [d, c, b];
    }
    verts.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushQuad(top, upper[i], lower[i], upper[j]);      // upper kite
    pushQuad(bottom, lower[i], upper[j], lower[j]);   // lower kite (mirror)
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * d4 helpers. A tetrahedron has no opposite faces; real d4s number the
 * VERTICES. The reader treats each vertex's direction-from-centre as a "face
 * normal" (the settled die's top vertex points straight up), and the labels
 * are drawn three-per-face at the corners so every reading angle shows the
 * top value.
 */

/** The die's 4 unique vertices as unit directions + per-corner face triples. */
function d4VertexData(geometry, THREE) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position;
  const verts = new Map(); // "x,y,z" -> { p: Vector3, faces: [] }
  for (let i = 0; i < pos.count; i += 3) {
    const tri = [];
    for (let j = 0; j < 3; j++) {
      const x = +pos.getX(i + j).toFixed(4);
      const y = +pos.getY(i + j).toFixed(4);
      const z = +pos.getZ(i + j).toFixed(4);
      const key = `${x},${y},${z}`;
      let v = verts.get(key);
      if (!v) {
        v = { p: new THREE.Vector3(x, y, z), faces: [] };
        verts.set(key, v);
      }
      tri.push(v);
    }
    // Register this tri against each of its corners.
    const a = new THREE.Vector3();
    const v0 = tri[0].p, v1 = tri[1].p, v2 = tri[2].p;
    a.copy(v1).sub(v0);
    a.cross(new THREE.Vector3().copy(v2).sub(v0)).normalize();
    const out = v0.clone().add(v1).add(v2).divideScalar(3);
    if (a.dot(out) < 0) a.negate(); // outward
    for (const corner of tri) corner.faces.push({ n: a.clone(), tri });
  }
  return [...verts.values()].map((v) => ({ dir: v.p.clone().normalize(), p: v.p, faces: v.faces }));
}

/** Vertex-indexed face map for the d4 reader: the up-most vertex wins. */
function d4VertexMap(geometry, THREE, values) {
  const data = d4VertexData(geometry, THREE);
  return data.map((v, i) => ({ n: [v.dir.x, v.dir.y, v.dir.z], v: values[i % values.length] }));
}

/** Three edge-adjacent numbers per face, oriented like a physical d4. */
function addD4Labels(mesh, geometry, values, labelSize, THREE) {
  const data = d4VertexData(geometry, THREE);
  const valueOf = new Map(data.map((v, i) => [v.p, values[i % values.length]]));
  for (const vert of data) {
    for (const face of vert.faces) {
      const { n, tri } = face;
      const centroid = tri.reduce((acc, c) => acc.add(c.p), new THREE.Vector3()).divideScalar(3);
      // Corner number: sit just inside the face from the corner, text-up
      // pointing away from the corner (reads upright at the settle corner) —
      // close to the edge and big, like a physical d4.
      const pos = vert.p.clone().lerp(centroid, 0.36)
        .add(n.clone().multiplyScalar(0.015)); // lift slightly off the face
      const up = centroid.clone().sub(vert.p).normalize();
      makeLabel(String(valueOf.get(vert.p)), labelSize, pos, n, up, THREE, mesh);
    }
  }
}
function makeFaceReader(faceMap, THREE) {
  const up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  const q = new THREE.Quaternion();
  return (cannonQuat) => {
    q.set(cannonQuat.x, cannonQuat.y, cannonQuat.z, cannonQuat.w);
    let best = -Infinity, bestVal = faceMap[0].v;
    for (const f of faceMap) {
      tmp.set(f.n[0], f.n[1], f.n[2]).applyQuaternion(q);
      const d = tmp.dot(up);
      if (d > best) { best = d; bestVal = f.v; }
    }
    return bestVal;
  };
}

/**
 * Place a numbered label on every face of a die mesh. Each label is a small
 * PlaneGeometry child whose +Z axis is aligned with the face outward normal,
 * so the number sits flush on the surface and tumbles with the die.
 */
/**
 * Face label with a CANONICAL in-face orientation: the number's up-direction
 * is the die's local up projected into the face plane (real dice print along
 * face edges, so a settled face reads upright from the side instead of at an
 * arbitrary, sometimes upside-down, twist). Falls back to another axis when
 * the projected direction degenerates (e.g. the d6's top face, whose normal
 * IS the local up).
 */
function orientLabel(plane, n, upHint, THREE) {
  const z = n.clone().normalize();
  let y = upHint.clone().sub(z.clone().multiplyScalar(upHint.dot(z)));
  if (y.length() < 1e-4) y = new THREE.Vector3(0, 0, 1).sub(z.clone().multiplyScalar(z.z));
  if (y.length() < 1e-4) y = new THREE.Vector3(1, 0, 0).sub(z.clone().multiplyScalar(z.x));
  y.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** One number label (ivory circle on a small plane). Shared by all dice. */
function makeLabel(text, labelSize, pos, n, up, THREE, mesh) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Ivory circle background.
  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.fillStyle = '#f5f0e0';
  ctx.fill();

  // Dark number.
  ctx.fillStyle = '#1a1308';
  ctx.font = `bold ${text.length >= 2 ? 54 : 68}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 66);

  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(labelSize, labelSize), mat);
  plane.position.copy(pos);
  orientLabel(plane, n, up || n, THREE);
  mesh.add(plane);
}

/** Face-centred labels for d6/d8/d12/d20 — canonical orientation. */
function addFaceLabels(mesh, faceMap, faceRadius, labelSize, THREE) {
  const up = new THREE.Vector3(0, 1, 0);
  for (const face of faceMap) {
    const n = new THREE.Vector3(face.n[0], face.n[1], face.n[2]);
    makeLabel(String(face.v), labelSize, n.clone().multiplyScalar(faceRadius), n, up, THREE, mesh);
  }
}

export { DIE_TYPES };
