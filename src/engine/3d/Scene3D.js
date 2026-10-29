/**
 * Scene3D — the 3D tabletop.
 *
 * Owns the Three.js renderer, camera, lights, ground plane, and a registry of
 * loaded tokens (glTF/GLB character models or simple primitives). Shares its
 * physics world with DiceRoller so dice land on the same table the minis
 * stand on. Map building in 3D = placing a textured ground + walls/props.
 *
 * Tokens are plain data objects synced over the wire; this class turns that
 * data into meshes and keeps them in step.
 */

// Fog overlay: a canvas-texture plane just above the ground plane. The stroke
// store is shared with Scene2D's format (2D-pixel space, 70px per square,
// centre-anchored at px (2000, 2000)).
const FOG_RES = 1024;
const GROUND_SIZE = 40;   // must match _buildGround's plane size
const PX_PER_UNIT = 70;   // one grid square = 70px in the shared stroke space

export class Scene3D {
  constructor({ THREE, CANNON, GLTFLoader, OrbitControls, canvas }) {
    this.THREE = THREE;
    this.CANNON = CANNON;
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x12100c, 0.012);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    this.camera.position.set(0, 18, 22);

    this.controls = OrbitControls ? new OrbitControls(this.camera, canvas) : null;
    if (this.controls) {
      this.controls.enableDamping = true;
      this.controls.maxPolarAngle = Math.PI / 2.1;
      this.controls.minDistance = 6;
      this.controls.maxDistance = 80;
      // Right-click = orbit, scroll = zoom, left-click is reserved for tools.
      this.controls.mouseButtons = {
        LEFT: null,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
      this.controls.touches = {
        ONE: THREE.TOUCH.PAN,
        TWO: THREE.TOUCH.DOLLY_ROTATE,
      };
    }

    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -38, 0) });
    this.world.allowSleep = true;

    this.gltfLoader = GLTFLoader ? new GLTFLoader() : null;
    this.tokens = new Map(); // id -> { mesh, data }
    this.aoeShapes = new Map();
    this.blocks = new Map();  // id -> { mesh, body?, data } — map-building primitives
    this.measurements = new Map(); // id -> { line, dots } permanent rulers
    // Fog of war (same stroke store/format as Scene2D, px space).
    this.fogStrokes = [];
    this._fog = null;
    // Drawings layer (same store/format as Scene2D) + the live preview overlay.
    this._drawings = [];
    this._draw = null;
    this._live = null;
    this._liveSid = null;   // identity of the in-progress live stroke
    this._livePtN = 0;      // how many stroke-space points are already inked
    this._selectedId = null;      // selected token (ring highlight)
    this._selectionRing = null;

    this._buildLights();
    this._buildGround();
    this._clock = new THREE.Clock();
  }

  /** Texture settings for the per-frame-updated overlay canvases: NO
   * mipmap rebuilds (the expensive part of a canvas-texture upload — every
   * live stroke was regenerating the full mipmap chain per mouse-move). */
  _overlayTexture(canvas) {
    const { THREE } = this;
    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  _buildLights() {
    const { THREE } = this;
    this.scene.add(new THREE.AmbientLight(0xffe9c4, 0.5));
    const key = new THREE.DirectionalLight(0xfff0d0, 1.4);
    key.position.set(15, 30, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -40;
    key.shadow.camera.right = 40;
    key.shadow.camera.top = 40;
    key.shadow.camera.bottom = -40;
    // Kill self-shadow striping on dice and small models: at this shadow-map
    // texel density (~0.04 units/texel) unbiased self-shadowing renders as
    // dark diagonal stripes across the die faces.
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    this.scene.add(key);
    const fill = new THREE.HemisphereLight(0x556699, 0x221a10, 0.4);
    this.scene.add(fill);
  }

  /** The battlemap floor. setMapTexture() swaps the image; grid is an overlay. */
  _buildGround() {
    const { THREE, CANNON } = this;
    const size = 40;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b2620, roughness: 1 });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.grid = new THREE.GridHelper(size, size, 0x6b5d44, 0x393225);
    this.grid.position.y = 0.01;
    this.scene.add(this.grid);

    const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(floor);
  }

  async setMapTexture(url) {
    const { THREE } = this;
    this._mapUrl = url;
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    const old = this.ground.material.map;
    this.ground.material.map = tex;
    this.ground.material.color.set(0xffffff);
    this.ground.material.needsUpdate = true;
    // Free the previous GPU texture — repeated map swaps otherwise leak VRAM.
    if (old && old !== tex) old.dispose();
  }

  /** Serialize the 3D scene to a plain object for persistence. */
  serialize() {
    return {
      mapUrl: this._mapUrl || null,
      // Positions come from the live meshes so a drag never gets lost on save;
      // primitives are centre-anchored, so their height reads back minus the
      // half-height offset applied at placement.
      tokens: [...this.tokens.values()].map((e) => {
        const d = { ...e.data };
        const m = e.mesh;
        if (m) {
          const isModel = d.kind === 'model' && !m.userData?.loadFailed && m.userData?.isModelWrapper;
          d.x = m.position.x;
          d.z = m.position.z;
          d.y = isModel ? m.position.y : m.position.y - 0.9;
        }
        return d;
      }),
      blocks: [...(this.blocks?.values() || [])].map((b) => ({ ...b.data })),
      measurements: [...this.measurements.values()].map((m) => m.data).filter(Boolean),
      fog: this.fogStrokes.length ? this.fogStrokes : null,
      drawings: this._drawings.length ? this._drawings.slice() : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Fog of war (3D). Same stroke store as Scene2D: an array of
  // {tool:'brush'|'eraser'|'cover'|'rect'|'circle'|'polygon', points/radius/
  // color/…} in the shared 2D-pixel stroke space (70px per grid square,
  // anchored so ground centre (0,0) is px (2000,2000)). Rendered here as a
  // canvas texture laid just above the ground plane.
  // ---------------------------------------------------------------------------

  /** Lazy fog overlay: canvas + CanvasTexture on a plane hugging the ground. */
  _ensureFog() {
    if (this._fog) return this._fog;
    const { THREE } = this;
    const canvas = document.createElement('canvas');
    canvas.width = FOG_RES; canvas.height = FOG_RES;
    const ctx = canvas.getContext('2d');
    const tex = this._overlayTexture(canvas);
    // Fog must render above the ground/grid but below tokens: it is the
    // lowest overlay, so a plain renderOrder above the ground is enough.
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.02;
    plane.renderOrder = 1;
    plane.receiveShadow = false;
    this.scene.add(plane);
    this._fog = { canvas, ctx, tex, plane, dirty: false };
    if (this.fogStrokes.length) this._redrawFog();
    else this._markDirty(this._fog);
    return this._fog;
  }

  /** Stroke-space point (2D px, 70px/square, centre-anchored) -> canvas px. */
  _pxToCanvas(px) { return ((px - 2000) / PX_PER_UNIT + GROUND_SIZE / 2) / GROUND_SIZE * FOG_RES; }

  /** Mark a layer's texture dirty; render() uploads at most once per frame. */
  _markDirty(layer) {
    if (layer) layer.dirty = true;
  }

  /** Redraw the whole fog canvas from the recorded strokes. */
  _redrawFog() {
    const fog = this._fog;
    if (!fog) return;
    const { ctx } = fog;
    ctx.clearRect(0, 0, FOG_RES, FOG_RES);
    for (const s of this.fogStrokes) this._drawFogStroke(s, ctx);
    this._markDirty(fog);
  }

  /** Paint one recorded/remote stroke onto the fog canvas. */
  _drawFogStroke(s, ctx) {
    const scale = FOG_RES / (GROUND_SIZE * PX_PER_UNIT);  // stroke px -> canvas px
    ctx.save();
    if (s.tool === 'cover') {
      // Full-map cover (the hide-all pseudo-stroke).
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = s.color || '#0a0a0a';
      ctx.fillRect(0, 0, FOG_RES, FOG_RES);
      ctx.restore();
      return;
    }
    ctx.globalCompositeOperation = (s.cut || s.tool === 'eraser') ? 'destination-out' : 'source-over';
    const color = s.color || '#0a0a0a';
    if (s.kind === 'rect') {
      ctx.fillStyle = color;
      ctx.fillRect(this._pxToCanvas(s.x), this._pxToCanvas(s.y), (s.w || 0) * scale, (s.h || 0) * scale);
    } else if (s.kind === 'circle') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(this._pxToCanvas(s.x), this._pxToCanvas(s.y), Math.max(1, (s.r || 0) * scale), 0, Math.PI * 2);
      ctx.fill();
    } else if (s.kind === 'polygon') {
      ctx.fillStyle = color;
      const pts = s.points || [];
      ctx.beginPath();
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const cx = this._pxToCanvas(pts[i]), cy = this._pxToCanvas(pts[i + 1]);
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      // Brush / eraser: polyline with a round cap, thickness = radius.
      ctx.lineWidth = (s.radius || 36) * scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      const pts = s.points || [];
      ctx.beginPath();
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const cx = this._pxToCanvas(pts[i]), cy = this._pxToCanvas(pts[i + 1]);
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      }
      if (pts.length === 2) {
        // A single-point stroke = a dot (round cap needs a second point).
        ctx.lineTo(this._pxToCanvas(pts[0]) + 0.01, this._pxToCanvas(pts[1]));
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- Fog public API (mirrors Scene2D's call shapes; no emitting — the
  // tools/sync layer broadcasts) ---

  addFogStroke(stroke) {
    this._ensureFog();
    this.fogStrokes.push(stroke);
    this._redrawFog();
    return stroke;
  }

  /** Replay a stroke from a remote client or a saved doc (no re-emit). */
  applyFogStroke(stroke) { return this.addFogStroke(stroke); }

  addFogShape(shape) { return this.addFogStroke(shape); }
  applyFogShape(shape) { return this.addFogStroke(shape); }

  removeFogShape(id) {
    this.fogStrokes = this.fogStrokes.filter((s) => s.id !== id);
    if (this._fog) this._redrawFog();
  }

  clearFog() {
    this.fogStrokes = [];
    if (this._fog) this._redrawFog();
  }

  /** GM "reveal all". */
  revealAll() { this.clearFog(); }

  /** GM "hide all" — a single full-cover pseudo-stroke keeps replays faithful. */
  hideAll() {
    this._ensureFog();
    this.fogStrokes = [{ tool: 'cover', points: [], color: '#0a0a0a', radius: 0 }];
    this._redrawFog();
  }

  setFogColor() { /* strokes record their colour; nothing global to swap */ }
  setFogPreview() { /* the fog plane renders for everyone, as in 2D */ }

  /** DM-panel layer toggle: show/hide the whole fog plane. */
  setFogLayerVisible(on) {
    if (this._fog) this._fog.plane.visible = !!on;
  }

  // ---------------------------------------------------------------------------
  // Drawings layer (3D): freehand + shapes painted on a canvas above the fog,
  // stored in the same shared px-space format as Scene2D's drawings so saves,
  // replays and the wire protocol stay compatible.
  // ---------------------------------------------------------------------------

  _ensureDraw() {
    if (this._draw) return this._draw;
    const { THREE } = this;
    const layer = this._makeOverlayPlane(0.035, 2);
    this._draw = layer;
    if (this._drawings.length) this._redrawDrawings();
    return layer;
  }

  /** Live in-progress overlay (drawings/fog pencil), cleared on commit. */
  _ensureLive() {
    if (this._live) return this._live;
    this._live = this._makeOverlayPlane(0.05, 3);
    return this._live;
  }

  _makeOverlayPlane(y, renderOrder) {
    const { THREE } = this;
    const canvas = document.createElement('canvas');
    canvas.width = FOG_RES; canvas.height = FOG_RES;
    const ctx = canvas.getContext('2d');
    const tex = this._overlayTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = y;
    plane.renderOrder = renderOrder;
    this.scene.add(plane);
    return { canvas, ctx, tex, plane, dirty: false };
  }

  _redrawDrawings() {
    const layer = this._draw;
    if (!layer) return;
    const { ctx } = layer;
    ctx.clearRect(0, 0, FOG_RES, FOG_RES);
    for (const d of this._drawings) this._paintStroke(d, ctx);
    this._markDirty(layer);
  }

  /** Commit a drawing (tool commit or remote replay; the caller syncs). */
  _addLine(d) { return this._commitDrawing(d); }
  _addShape(d) { return this._commitDrawing(d); }

  /** Plain canvas text note. Not synced as rich text (see draw:text). */
  _addText({ x, y, text, color = '#f0e6cc', size = 18 }) {
    if (!text) return;
    this._ensureDraw();
    const d = { x, y, text, color, size };
    this._drawings.push(d);
    const { ctx } = this._draw;
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.max(8, (size || 18) * (FOG_RES / (GROUND_SIZE * PX_PER_UNIT)))}px system-ui, sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,.8)';
    ctx.shadowBlur = 3;
    ctx.fillText(text, this._pxToCanvas(d.x), this._pxToCanvas(d.y));
    ctx.restore();
    this._markDirty(this._draw);
    return d;
  }
  _commitDrawing(d) {
    this._ensureDraw();
    this._drawings.push(d);
    this._redrawDrawings();
    this.clearDrawingPreview();
    return d;
  }

  /**
   * Render an in-progress stroke on the live overlay (kept until commit).
   * Pass a stable `sid` for a growing polyline (freehand pen, fog brush) and
   * only the NEW segment is inked each call — repainting the whole polyline
   * per mouse-move was the remaining drag-lag cost.
   */
  previewDrawing(data, sid = null) {
    const live = this._ensureLive();
    const ctx = live.ctx;
    const pts = data && data.points;
    const growable = pts && sid && pts.length >= 4;
    if (growable && sid === this._liveSid && pts.length > this._livePtN) {
      // Incremental: stroke the new tail onto the existing ink.
      ctx.save();
      if (data.comp) ctx.globalCompositeOperation = data.comp;
      ctx.strokeStyle = data.color || '#e0c068';
      ctx.lineWidth = Math.max(1, (data.width || 4) * (FOG_RES / (GROUND_SIZE * PX_PER_UNIT)));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(this._pxToCanvas(pts[this._livePtN - 2]), this._pxToCanvas(pts[this._livePtN - 1]));
      for (let i = this._livePtN; i + 1 < pts.length; i += 2) {
        ctx.lineTo(this._pxToCanvas(pts[i]), this._pxToCanvas(pts[i + 1]));
      }
      ctx.stroke();
      ctx.restore();
      this._livePtN = pts.length;
    } else {
      // New stroke (or a shape whose geometry changes per move): repaint.
      ctx.clearRect(0, 0, FOG_RES, FOG_RES);
      if (data) this._paintStroke(data, ctx);
      this._liveSid = sid;
      this._livePtN = pts ? pts.length : 0;
    }
    this._markDirty(live);
  }

  clearDrawingPreview() {
    if (!this._live) return;
    this._live.ctx.clearRect(0, 0, FOG_RES, FOG_RES);
    this._liveSid = null;
    this._livePtN = 0;
    this._markDirty(this._live);
  }

  /** Paint one drawing payload (line/shape/text/marker/…) in stroke space. */
  _paintStroke(d, ctx) {
    if (d.text !== undefined) {
      ctx.save();
      ctx.fillStyle = d.color || '#f0e6cc';
      ctx.font = `bold ${Math.max(8, (d.size || 18) * (FOG_RES / (GROUND_SIZE * PX_PER_UNIT)))}px system-ui, sans-serif`;
      ctx.shadowColor = 'rgba(0,0,0,.8)';
      ctx.shadowBlur = 3;
      ctx.fillText(d.text, this._pxToCanvas(d.x), this._pxToCanvas(d.y));
      ctx.restore();
      return;
    }
    if (d.points) {
      // Line / polygon-ish strokes: polyline (closed when the payload implies).
      ctx.save();
      if (d.comp) ctx.globalCompositeOperation = d.comp;
      ctx.strokeStyle = d.color || '#e0c068';
      ctx.lineWidth = Math.max(1, (d.width || 4) * (FOG_RES / (GROUND_SIZE * PX_PER_UNIT)));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const pts = d.points || [];
      ctx.beginPath();
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const cx = this._pxToCanvas(pts[i]), cy = this._pxToCanvas(pts[i + 1]);
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      }
      if (d.shape && d.shape !== 'line') ctx.closePath();
      if ((d.fill && d.fill !== 'transparent')) { ctx.fillStyle = d.fill; ctx.fill(); }
      ctx.stroke();
      ctx.restore();
      return;
    }
    // Rect / ellipse payload ({shape, x, y, w, h}).
    if (d.shape === 'rect' || d.shape === 'ellipse') {
      ctx.save();
      ctx.strokeStyle = d.color || '#e0c068';
      ctx.lineWidth = Math.max(1, (d.width || 4) * (FOG_RES / (GROUND_SIZE * PX_PER_UNIT)));
      if (d.fill && d.fill !== 'transparent') { ctx.fillStyle = d.fill; }
      const X = this._pxToCanvas(d.x), Y = this._pxToCanvas(d.y);
      const W = (d.w || 0) * (FOG_RES / (GROUND_SIZE * PX_PER_UNIT));
      const H = (d.h || 0) * (FOG_RES / (GROUND_SIZE * PX_PER_UNIT));
      ctx.beginPath();
      if (d.shape === 'rect') ctx.rect(X, Y, W, H);
      else ctx.ellipse(X + W / 2, Y + H / 2, Math.max(1, W / 2), Math.max(1, H / 2), 0, 0, Math.PI * 2);
      if (d.fill && d.fill !== 'transparent') ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Add or update a token. data = {id, kind:'model'|'primitive', url?, color?,
   * x, z, rotation, scale, label}. Models load async; primitives are instant.
   */
  async upsertToken(data) {
    const { THREE } = this;
    let entry = this.tokens.get(data.id);
    if (!entry) {
      // Register immediately so serialize() sees this token even while a glTF
      // load is in progress — a save mid-load otherwise drops the token.
      entry = { mesh: null, data };
      this.tokens.set(data.id, entry);

      let mesh;
      if (data.kind === 'model' && data.url && this.gltfLoader) {
        try {
          const gltf = await this.gltfLoader.loadAsync(data.url);
          // The token may have been removed while the model streamed in —
          // adding the mesh now would leave a ghost nobody can delete.
          if (this.tokens.get(data.id) !== entry) return entry;
          mesh = gltf.scene;
          mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          // Normalise scale: fit the model into roughly a 2-unit cube so wildly
          // different glTF export scales don't appear as a dot or a giant.
          let box = new THREE.Box3().setFromObject(mesh);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          if (maxDim > 0) mesh.scale.multiplyScalar(2 / maxDim);
          // Bake origin to bottom-centre so position.y = data.y rests the
          // model on the ground no matter how it was exported.
          mesh.updateMatrixWorld(true);
          box = new THREE.Box3().setFromObject(mesh);
          const centre = box.getCenter(new THREE.Vector3());
          const wrapper = new THREE.Group();
          mesh.position.x -= centre.x;
          mesh.position.z -= centre.z;
          mesh.position.y -= box.min.y; // bottom to y=0
          wrapper.add(mesh);
          wrapper.userData.isModelWrapper = true;
          mesh = wrapper;
        } catch (err) {
          if (this.tokens.get(data.id) !== entry) return entry;
          // Don't fail silently — log, then drop in a visible red placeholder
          // so the user knows the token exists but the model URL didn't load.
          // eslint-disable-next-line no-console
          console.error('[grimoire] glTF load failed for', data.url, err);
          this.onModelError?.(data, err);
          const geo = new THREE.ConeGeometry(0.7, 1.8, 4);
          const mat = new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.5 });
          mesh = new THREE.Mesh(geo, mat);
          mesh.castShadow = true;
          mesh.userData.loadFailed = true;
        }
      } else {
        const geo = new THREE.CylinderGeometry(0.7, 0.7, 1.8, 24);
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(data.color || '#8a6d3b'),
          roughness: 0.6,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
      }
      mesh.userData.tokenId = data.id;
      this.scene.add(mesh);
      entry.mesh = mesh; // update the entry registered before the async load
      // A concurrent upsert during the load may hold fresher fields (moved
      // while loading) — apply entry.data, not the pre-await snapshot.
      this._applyTokenTransform(entry, entry.data);
      this._renderHp(entry);
      return entry;
    }
    if (!entry.mesh) { entry.data = data; this._renderHp(entry); return entry; }
    entry.data = data;
    this._applyTokenTransform(entry, data);
    this._renderHp(entry);
    return entry;
  }

  /** Position/rotate/scale a token mesh from its data. */
  _applyTokenTransform(entry, data) {
    const m = entry.mesh;
    if (!m || !data) return;
    const isModel = data.kind === 'model' && !m.userData?.loadFailed && m.userData?.isModelWrapper;
    m.rotation.y = data.rotation || 0;
    // The wrapper's children carry the load-time normalisation, so scaling the
    // wrapper applies the user's scale cleanly (models included — it used to
    // be silently ignored for them).
    m.scale.setScalar(data.scale || 1);
    if (isModel) {
      m.position.set(data.x || 0, data.y || 0, data.z || 0);
    } else {
      // Primitives (cylinder h=1.8) and failed placeholders are centre-anchored:
      m.position.set(data.x || 0, (data.y || 0) + 0.9, data.z || 0);
    }
  }

  /** Update a token's HP billboard. Emits nothing (caller syncs). */
  updateHp(id, hp) {
    const e = this.tokens.get(id);
    if (!e) return;
    e.data.hp = hp;
    this._renderHp(e);
  }

  /**
   * An HP billboard = a canvas-texture plane floating above the token, with a
   * bar (green/amber/red) and a "cur/max" label. Built lazily and updated in
   * place; hidden when maxHp is unset.
   */
  _renderHp(e) {
    const { THREE } = this;
    const hp = e.data.hp;
    const has = hp && hp.maxHp && hp.maxHp > 0;
    if (!has) {
      if (e.hpBillboard) e.hpBillboard.visible = false;
      return;
    }
    if (!e.hpBillboard) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(2.4, 0.6, 1);
      sprite.position.set(0, 2.4, 0);
      e.mesh.add(sprite);
      e.hpBillboard = sprite;
      e.hpCanvas = canvas;
      e.hpTex = tex;
    }
    const cur = Math.max(0, Math.min(hp.current ?? 0, hp.maxHp));
    const frac = hp.maxHp > 0 ? cur / hp.maxHp : 0;
    const color = frac > 0.5 ? '#3fb950' : frac > 0.2 ? '#e0c068' : '#e74c3c';
    const ctx = e.hpCanvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    // Track
    ctx.fillStyle = '#3a0d0d';
    ctx.fillRect(8, 30, 240, 20);
    ctx.strokeStyle = '#0d0b08'; ctx.lineWidth = 2;
    ctx.strokeRect(8, 30, 240, 20);
    // Fill
    ctx.fillStyle = color;
    ctx.fillRect(8, 30, 240 * frac, 20);
    // Label
    ctx.fillStyle = '#f0e6cc';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${cur}/${hp.maxHp}`, 128, 40);
    e.hpTex.needsUpdate = true;
    e.hpBillboard.visible = true;
  }

  removeToken(id) {
    const e = this.tokens.get(id);
    if (!e) return;
    this.scene.remove(e.mesh);
    this.tokens.delete(id);
  }

  /** Area-of-effect templates: 'circle' | 'cone' | 'square' | 'line'. */
  setAoE(id, { shape, x, z, radius = 3, rotation = 0, color = '#e74c3c' }) {
    const { THREE } = this;
    this.clearAoE(id);
    let geo;
    if (shape === 'circle') geo = new THREE.CircleGeometry(radius, 48);
    else if (shape === 'square') geo = new THREE.PlaneGeometry(radius * 2, radius * 2);
    else if (shape === 'cone') geo = new THREE.CircleGeometry(radius, 24, 0, Math.PI / 3);
    else geo = new THREE.PlaneGeometry(radius * 2, 1); // line
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color), transparent: true, opacity: 0.35,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rotation;
    mesh.position.set(x, 0.05, z);
    this.scene.add(mesh);
    this.aoeShapes.set(id, mesh);
  }

  clearAoE(id) {
    const m = this.aoeShapes.get(id);
    if (m) { this.scene.remove(m); this.aoeShapes.delete(id); }
  }

  /** Permanent ruler in 3D: a line + two endpoint spheres on the ground. */
  addMeasurement(m) {
    const { THREE } = this;
    this.clearMeasurement(m.id);
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(m.a.x, 0.1, m.a.z ?? m.a.y),
      new THREE.Vector3(m.b.x, 0.1, m.b.z ?? m.b.y),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xe0c068 }));
    const dotA = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe0c068 }));
    const dotB = dotA.clone();
    dotA.position.set(m.a.x, 0.1, m.a.z ?? m.a.y);
    dotB.position.set(m.b.x, 0.1, m.b.z ?? m.b.y);
    this.scene.add(line, dotA, dotB);
    this.measurements.set(m.id, { line, dotA, dotB, data: m });
  }

  clearMeasurement(id) {
    const m = this.measurements.get(id);
    if (!m) return;
    this.scene.remove(m.line, m.dotA, m.dotB);
    m.line.geometry.dispose(); m.line.material.dispose();
    m.dotA.geometry.dispose(); m.dotA.material.dispose();
    m.dotB.geometry.dispose(); m.dotB.material.dispose();
    this.measurements.delete(id);
  }

  /**
   * Add or update a map-building block (primitive geometry used to build maps:
   * walls, floors, pillars, ramps). data = {id, shape, x, y, z, w, h, d,
   * color, rotation}. Shapes: 'box' | 'cylinder' | 'sphere' | 'cone' | 'ramp'.
   */
  addBlock(data) {
    const { THREE } = this;
    let entry = this.blocks.get(data.id);
    const w = data.w ?? 1, h = data.h ?? 1, d = data.d ?? 1;
    if (!entry) {
      let geo;
      switch (data.shape) {
        case 'cylinder': geo = new THREE.CylinderGeometry(w / 2, w / 2, h, 24); break;
        case 'sphere':   geo = new THREE.SphereGeometry(w / 2, 24, 16); break;
        case 'cone':     geo = new THREE.ConeGeometry(w / 2, h, 24); break;
        case 'ramp': {
          // A right-triangular prism: a box sheared into a ramp.
          geo = new THREE.BoxGeometry(w, h, d);
          const pos = geo.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            // Pull the top face's front edge down to make a slope.
            if (pos.getY(i) > 0 && pos.getZ(i) > 0) pos.setY(i, -h / 2);
          }
          geo.computeVertexNormals();
          break;
        }
        case 'box':
        default: geo = new THREE.BoxGeometry(w, h, d); break;
      }
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(data.color || '#6b5d4f'), roughness: 0.85, metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.blockId = data.id;
      this.scene.add(mesh);
      entry = { mesh, data };
      this.blocks.set(data.id, entry);
    }
    const m = entry.mesh;
    m.position.set(data.x || 0, (data.y ?? h / 2), data.z || 0);
    m.rotation.y = data.rotation || 0;
    if (entry.mesh.material && data.color) entry.mesh.material.color.set(data.color);
    entry.data = data;
    return entry;
  }

  removeBlock(id) {
    const e = this.blocks.get(id);
    if (e) { this.scene.remove(e.mesh); this.blocks.delete(id); }
  }

  /** Raycast ndc -> {blockId} | {groundPoint} for the build tool. */
  pickBuild(ndc, raycaster) {
    raycaster.setFromCamera(ndc, this.camera);
    const meshes = [...this.blocks.values()].map((b) => b.mesh);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (hit) {
      for (const [id, b] of this.blocks) if (b.mesh === hit.object) return { blockId: id, point: hit.point, normal: hit.face?.normal };
    }
    return null;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  /** Per-frame update. Returns dt so callers (DiceRoller) can share it. */
  /** Select a token (or null) — draws a ring under it, follows it each frame. */
  setSelectedToken(id) {
    this._selectedId = id || null;
    if (!this._selectedId) {
      if (this._selectionRing) this._selectionRing.visible = false;
      return;
    }
    if (!this._selectionRing) {
      const { THREE } = this;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.05, 48),
        new THREE.MeshBasicMaterial({
          color: 0x0082c9, transparent: true, opacity: 0.85,
          side: THREE.DoubleSide, depthWrite: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      ring.renderOrder = 2;
      this.scene.add(ring);
      this._selectionRing = ring;
    }
    this._selectionRing.visible = true;
  }

  render() {
    const dt = this._clock.getDelta();
    this.world.step(1 / 60, dt, 3);
    if (this.controls) this.controls.update();
    // Upload overlay textures at most once per frame — without this, live
    // fog/pencil strokes triggered a full texture re-upload per mouse-move.
    for (const layer of [this._fog, this._draw, this._live]) {
      if (layer?.dirty) { layer.tex.needsUpdate = true; layer.dirty = false; }
    }
    // Keep the selection ring under its (possibly moving or removed) token.
    const sel = this._selectedId ? this.tokens.get(this._selectedId) : null;
    if (this._selectionRing) {
      if (sel?.mesh) {
        this._selectionRing.visible = true;
        this._selectionRing.position.set(sel.mesh.position.x, 0.03, sel.mesh.position.z);
      } else {
        this._selectionRing.visible = false;
      }
    }
    this.renderer.render(this.scene, this.camera);
    return dt;
  }
}
