/**
 * SceneAdapter — the seam between the tool layer and a concrete scene.
 *
 * Tools speak in world points and call high-level verbs (showPointer,
 * moveToken, setAoE, showMeasurement). Each scene type provides an adapter
 * implementing those verbs, so PointerTool/MeasureTool/GrabTool/AoETool are
 * written once and work in both 2D and 3D. This is what makes the "2D mode and
 * 3D mode" requirement tractable: one tool codebase, two adapters.
 */

export class Scene2DAdapter {
  constructor(scene2d, { THREE } = {}) {
    this.scene = scene2d;
    this.gridSize = scene2d.gridSize;
    this._pointer = null;
    this._measure = null;
  }

  // Snap toggle delegates to the scene so the Konva dragend handler and the
  // GrabTool agree on the same setting.
  get snapEnabled() { return this.scene.snapEnabled !== false; }
  set snapEnabled(v) { this.scene.snapEnabled = v; }

  /** Convert a Konva stage event into world (scene) coordinates. */
  worldPointFromEvent() {
    const stage = this.scene.stage;
    const p = stage.getPointerPosition();
    const t = stage.getAbsoluteTransform().copy().invert();
    const w = t.point(p);
    return { x: w.x, y: w.y };
  }

  showPointer(w) {
    const Konva = this.scene.Konva;
    if (!this._pointer) {
      this._pointer = new Konva.Circle({
        radius: 14, fill: 'rgba(224,192,104,0.85)',
        shadowColor: '#e0c068', shadowBlur: 20,
      });
      this.scene.getLayer('overlay').add(this._pointer);
    }
    this._pointer.position({ x: w.x, y: w.y });
    this.scene.getLayer('overlay').batchDraw();
  }
  hidePointer() { this._pointer?.destroy(); this._pointer = null; this.scene.getLayer('overlay').batchDraw(); }

  showMeasurement(a, b, label) {
    const Konva = this.scene.Konva;
    const layer = this.scene.getLayer('overlay');
    if (!this._measure) {
      this._measure = {
        line: new Konva.Line({ stroke: '#e0c068', strokeWidth: 3, dash: [10, 6] }),
      };
      layer.add(this._measure.line);
    }
    this._measure.line.points([a.x, a.y, b.x, b.y]);
    layer.batchDraw();
    // Label is drawn as an HTML overlay (screen space) so it's always legible
    // regardless of zoom. Project the world midpoint to screen via the stage.
    const stage = this.scene.stage;
    const tr = stage.getAbsoluteTransform();
    const mid = tr.point({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const rect = stage.container().getBoundingClientRect();
    this.onMeasure?.({ label, screenX: rect.left + mid.x, screenY: rect.top + mid.y });
  }
  clearMeasurement() {
    if (this._measure) { this._measure.line.destroy(); this._measure = null; }
    this.scene.getLayer('overlay').batchDraw();
    this.onMeasure?.(null);
  }

  addMeasurement(m) { this.scene.addMeasurement?.(m); }
  removeMeasurement(id) { this.scene.removeMeasurement?.(id); }
  clearMeasurements() { this.scene.clearMeasurements?.(); }

  setAoE(id, t) {
    const Konva = this.scene.Konva, layer = this.scene.getLayer('aoe');
    const px = t.x, py = t.z ?? t.y, r = t.radius * this.gridSize;
    let node = layer.findOne('#' + id);
    if (!node) {
      node = t.shape === 'square'
        ? new Konva.Rect({ id, width: r * 2, height: r * 2, offsetX: r, offsetY: r })
        : new Konva.Circle({ id, radius: r });
      node.fill('rgba(231,76,60,0.32)'); node.stroke('#e74c3c');
      layer.add(node);
    }
    node.position({ x: px, y: py });
    if (node.radius) node.radius(r); else { node.width(r * 2); node.height(r * 2); node.offset({ x: r, y: r }); }
    layer.batchDraw();
  }
  removeAoE(id) {
    const node = this.scene.getLayer('aoe').findOne('#' + id);
    if (node) { node.destroy(); this.scene.getLayer('aoe').batchDraw(); }
  }
  /** Return the id of the AoE template under world point w, or null. */
  pickAoE(w) {
    const layer = this.scene.getLayer('aoe');
    // Topmost first so the most recently drawn template wins.
    const children = layer.getChildren();
    for (let i = children.length - 1; i >= 0; i--) {
      const node = children[i];
      if (typeof node.radius === 'function' && node.radius()) {
        const dx = w.x - node.x(), dy = w.y - node.y();
        if (Math.hypot(dx, dy) <= node.radius()) return node.id();
      } else if (typeof node.width === 'function') {
        const hw = node.width() / 2, hh = node.height() / 2;
        if (Math.abs(w.x - node.x()) <= hw && Math.abs(w.y - node.y()) <= hh) return node.id();
      }
    }
    return null;
  }

  pickToken(w) {
    // Tokens are positioned by their group origin; size is in grid squares.
    // Test the world point against each token's world-space box. Iterate in
    // reverse so the topmost token wins when they overlap.
    const entries = [...this.scene.tokens.entries()];
    for (let i = entries.length - 1; i >= 0; i--) {
      const [id, e] = entries[i];
      const size = (e.data.size || 1) * this.gridSize;
      const gx = e.group.x(), gy = e.group.y();
      // Support both top-left and centre-anchored tokens by testing a box
      // centred on the group origin with a half-size pad either way.
      if (w.x >= gx - size * 0.1 && w.x <= gx + size &&
          w.y >= gy - size * 0.1 && w.y <= gy + size) {
        return { id };
      }
    }
    return null;
  }
  moveToken(id, w) {
    const e = this.scene.tokens.get(id);
    if (e) { e.group.position({ x: w.x, y: w.y }); this.scene.getLayer('tokens').batchDraw(); }
  }
  snapToGrid(w) {
    const g = this.gridSize;
    return { x: Math.round(w.x / g) * g, y: Math.round(w.y / g) * g };
  }
  setTokensDraggable(on) {
    for (const e of this.scene.tokens.values()) e.group.draggable(on);
  }
  highlightToken() { /* could add a selection ring */ }

  /** Begin a fog brush stroke. tool = 'brush' | 'eraser'. GM-only. */
  beginFogStroke(w, tool) {
    this._fogTool = tool;
    this._fogPoints = [w.x, w.y];
    // Live preview line on the fog layer.
    const Konva = this.scene.Konva;
    const layer = this.scene.getLayer('fog');
    this._fogPreview = new Konva.Line({
      points: this._fogPoints,
      stroke: tool === 'eraser' ? '#1a1a1a' : '#0a0a0a',
      strokeWidth: 36,
      lineCap: 'round', lineJoin: 'round',
      globalCompositeOperation: tool === 'eraser' ? 'destination-out' : 'source-over',
      listening: false,
    });
    layer.add(this._fogPreview);
    layer.batchDraw();
  }
  extendFogStroke(w) {
    if (!this._fogPreview) return;
    this._fogPoints.push(w.x, w.y);
    this._fogPreview.points(this._fogPoints);
    this.scene.getLayer('fog').batchDraw();
  }
  endFogStroke() {
    if (!this._fogPreview) return null;
    const stroke = {
      tool: this._fogTool,
      points: this._fogPoints.slice(),
      color: '#0a0a0a',
      radius: 36,
    };
    // Commit to the scene's recorded strokes and emit. The preview node
    // becomes the committed node (we keep it).
    this.scene.fogStrokes.push(stroke);
    this._fogPreview = null;
    this._fogPoints = null;
    this._fogTool = null;
    return stroke;
  }
}

export class Scene3DAdapter {
  constructor(scene3d, { THREE }) {
    this.scene = scene3d;
    this.THREE = THREE;
    this.gridSize = 1;
    this.raycaster = new THREE.Raycaster();
    this._pointer = null;
    this._measure = null;
    this.snapEnabled = true;
    this.is3D = true;
  }

  addBlock(data) { this.scene.addBlock(data); }
  removeBlock(id) { this.scene.removeBlock(id); }
  /** ndc/world point -> blockId under cursor, or null. */
  pickBlock(w) {
    // w may be a world point; convert via raycaster needs ndc, so the view
    // passes ndc through the event. Fall back to nearest-block by distance.
    const hit = this.scene.pickBuild(this._lastNdc || { x: 0, y: 0 }, this.raycaster);
    return hit?.blockId || null;
  }

  /** Cast the cursor onto the ground plane to get a world point. */
  worldPointFromEvent(ndc) {
    // ndc = {x,y} in normalized device coords (-1..1), supplied by the view.
    this._lastNdc = ndc;
    this.raycaster.setFromCamera(ndc, this.scene.camera);
    const hits = this.raycaster.intersectObject(this.scene.ground);
    if (hits.length) return { x: hits[0].point.x, y: 0, z: hits[0].point.z };
    return { x: 0, y: 0, z: 0 };
  }

  showPointer(w) {
    const THREE = this.THREE;
    if (!this._pointer) {
      this._pointer = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xe0c068 })
      );
      this.scene.scene.add(this._pointer);
    }
    this._pointer.position.set(w.x, 0.4, w.z);
  }
  hidePointer() { if (this._pointer) { this.scene.scene.remove(this._pointer); this._pointer = null; } }

  showMeasurement(a, b, label) {
    const THREE = this.THREE;
    if (!this._measure) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      this._measure = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xe0c068 }));
      this.scene.scene.add(this._measure);
    }
    this._measure.geometry.setFromPoints([
      new THREE.Vector3(a.x, 0.1, a.z), new THREE.Vector3(b.x, 0.1, b.z),
    ]);
    // Project the 3D midpoint to screen coordinates for the HTML label.
    const camera = this.scene.camera;
    const canvas = this.scene.renderer?.domElement;
    if (camera && canvas) {
      const mid = new THREE.Vector3((a.x + b.x) / 2, 0.1, (a.z + b.z) / 2);
      mid.project(camera);
      const rect = canvas.getBoundingClientRect();
      const sx = rect.left + (mid.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-mid.y * 0.5 + 0.5) * rect.height;
      this.onMeasure?.({ label, screenX: sx, screenY: sy });
    }
  }
  clearMeasurement() {
    if (this._measure) { this.scene.scene.remove(this._measure); this._measure = null; }
    this.onMeasure?.(null);
  }

  addMeasurement(m) { this.scene.addMeasurement?.(m); }
  removeMeasurement(id) { this.scene.clearMeasurement?.(id); }
  clearMeasurements() { for (const id of [...(this.scene.measurements?.keys() || [])]) this.scene.clearMeasurement?.(id); }

  setAoE(id, t) { this.scene.setAoE(id, t); }
  removeAoE(id) { this.scene.clearAoE?.(id); }
  /** ndc point -> id of AoE mesh under cursor, or null. */
  pickAoE(ndc) {
    if (!this.scene.aoeShapes) return null;
    this.raycaster.setFromCamera(ndc, this.scene.camera);
    const meshes = [...this.scene.aoeShapes.entries()];
    const hit = this.raycaster.intersectObjects(meshes.map(([, m]) => m), true)[0];
    if (!hit) return null;
    for (const [id, m] of meshes) {
      if (m === hit.object || m === hit.object.parent) return id;
    }
    return null;
  }

  pickToken(w) {
    // GrabTool passes a world point on the ground (not ndc). Find the nearest
    // token within a grab radius. This works uniformly for primitives and glTF
    // model groups (which a mesh-raycast handled inconsistently).
    if (!w || w.x === undefined) return null;
    const wx = w.x, wz = (w.z !== undefined ? w.z : w.y);
    let best = null, bestDist = Infinity;
    for (const [id, e] of this.scene.tokens) {
      const p = e.mesh.position;
      const d = Math.hypot(p.x - wx, p.z - wz);
      // Grab radius scales with the token's footprint (~1 unit default).
      const radius = Math.max(1.2, (e.data.size || 1) * 1.2);
      if (d <= radius && d < bestDist) { bestDist = d; best = id; }
    }
    return best ? { id: best } : null;
  }
  moveToken(id, w) {
    const e = this.scene.tokens.get(id);
    if (e) e.mesh.position.set(w.x, e.mesh.position.y, w.z);
  }
  snapToGrid(w) { return { x: Math.round(w.x), y: 0, z: Math.round(w.z) }; }
  setTokensDraggable() { /* handled via raycast in GrabTool */ }
  highlightToken() {}
}
