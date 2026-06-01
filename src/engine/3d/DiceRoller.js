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
    const { geometry, shape, faceValue, scale, faceMap, faceRadius, labelSize } = buildDie(type, THREE, CANNON);

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
    addFaceLabels(mesh, faceMap, faceRadius, labelSize, THREE);

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
    case 'd4':
      geometry = new THREE.TetrahedronGeometry(size * 1.1);
      faceMap = facesFromGeometry(geometry, THREE, [1, 2, 3, 4], true);
      faceRadius = 0.38;
      labelSize = 0.52;
      break;
    case 'd8':
      geometry = new THREE.OctahedronGeometry(size);
      faceMap = facesFromGeometry(geometry, THREE, range(1, 8));
      faceRadius = 0.65;
      labelSize = 0.5;
      break;
    case 'd12':
      geometry = new THREE.DodecahedronGeometry(size);
      faceMap = facesFromGeometry(geometry, THREE, range(1, 12));
      faceRadius = 0.92;
      labelSize = 0.46;
      break;
    case 'd20':
      geometry = new THREE.IcosahedronGeometry(size);
      faceMap = facesFromGeometry(geometry, THREE, range(1, 20));
      faceRadius = 0.88;
      labelSize = 0.42;
      break;
    case 'd10':
    default: {
      // d10 is a pentagonal trapezohedron; approximate with a cylinder-ish
      // 10-faced solid built from a lathe is overkill here, so we use a
      // scaled icosa subset for the demo and label 0-9.
      geometry = new THREE.IcosahedronGeometry(size);
      faceMap = facesFromGeometry(geometry, THREE, range(0, 9), false, 10);
      faceRadius = 0.88;
      labelSize = 0.42;
      break;
    }
  }

  const shape = shapeFromGeometry(geometry, THREE, CANNON);
  const faceValue = makeFaceReader(faceMap, THREE);
  return { geometry, shape, faceValue, scale: size, faceMap, faceRadius, labelSize };
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

/** Returns reader(quaternion) -> value: the face whose world normal points up. */
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
function addFaceLabels(mesh, faceMap, faceRadius, labelSize, THREE) {
  const zAxis = new THREE.Vector3(0, 0, 1);
  for (const face of faceMap) {
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
    ctx.font = `bold ${face.v >= 10 ? 54 : 68}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(face.v), 64, 66);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(labelSize, labelSize), mat);
    const n = new THREE.Vector3(face.n[0], face.n[1], face.n[2]);
    plane.position.copy(n.clone().multiplyScalar(faceRadius));
    plane.quaternion.setFromUnitVectors(zAxis, n);
    mesh.add(plane);
  }
}

export { DIE_TYPES };
