/**
 * Tool system.
 *
 * A Tool reacts to pointer events translated into *world* coordinates by the
 * active scene adapter (2D or 3D). Tools never touch the renderer directly;
 * they call adapter methods, which keeps the same tool working in both modes.
 *
 * ToolManager owns the active tool, routes events, and exposes which tools
 * exist so the toolbar can render them. Addons can register their own tools
 * through the SDK (see addons/sdk).
 */
export class ToolManager {
  constructor(adapter, { sync } = {}) {
    this.adapter = adapter;     // SceneAdapter: worldPointFromEvent, drawX, etc.
    this.sync = sync || null;   // optional SyncClient for broadcasting
    this.tools = new Map();
    this.active = null;
    this._registerDefaults();
  }

  register(tool) {
    tool.manager = this;
    this.tools.set(tool.id, tool);
    return tool;
  }

  activate(id) {
    if (this.active) this.active.onDeactivate?.();
    this.active = this.tools.get(id) || null;
    this.active?.onActivate?.();
    return this.active;
  }

  list() {
    return [...this.tools.values()].map((t) => ({ id: t.id, name: t.name, icon: t.icon }));
  }

  handle(event, world) {
    if (!this.active) return;
    const fn = this.active[event];
    if (fn) fn.call(this.active, world);
  }

  _registerDefaults() {
    this.register(new PointerTool());
    this.register(new GrabTool());
    this.register(new MeasureTool());
    this.register(new AoETool());
    this.register(new DrawTool());
    this.register(new FogTool());
    // Map-building is 3D-only (placing primitives in space).
    if (this.adapter && this.adapter.is3D) this.register(new BuildTool());
    this.activate('pointer');
  }
}

class Tool {
  constructor(id, name, icon) { this.id = id; this.name = name; this.icon = icon; }
  get adapter() { return this.manager.adapter; }
  get sync() { return this.manager.sync; }
}

/**
 * PointerTool — a transient glowing pointer everyone can see. Pressing and
 * holding shows your pointer at the cursor; releasing fades it. Broadcast so
 * the GM can say "this goblin, right here".
 */
export class PointerTool extends Tool {
  constructor() { super('pointer', 'Pointer', 'cursor'); }
  onPointerDown(w) {
    this._active = true;
    this.adapter.showPointer(w);
    this.sync?.send({ type: 'pointer:show', payload: { ...w } });
  }
  onPointerMove(w) {
    if (!this._active) return;
    this.adapter.showPointer(w);
    this.sync?.send({ type: 'pointer:move', payload: { ...w } });
  }
  onPointerUp() {
    this._active = false;
    this.adapter.hidePointer();
    this.sync?.send({ type: 'pointer:hide', payload: {} });
  }
}

/**
 * GrabTool — select and move tokens. In 2D Konva handles the drag natively,
 * so this tool just toggles token draggability on/off and surfaces a
 * selection. In 3D it raycasts to pick a token then drags it across the
 * ground plane.
 */
export class GrabTool extends Tool {
  constructor() { super('grab', 'Grab', 'hand'); }
  onActivate() { this.adapter.setTokensDraggable?.(true); }
  onDeactivate() { this.adapter.setTokensDraggable?.(false); this.selected = null; }
  onPointerDown(w) {
    const hit = this.adapter.pickToken?.(w);
    this.selected = hit || null;
    if (hit) this.adapter.highlightToken?.(hit.id);
  }
  onPointerMove(w) {
    if (!this.selected) return;
    this.adapter.moveToken?.(this.selected.id, w);
  }
  onPointerUp(w) {
    if (!this.selected) return;
    // Snap only when the adapter has snapping enabled (toggleable in the UI).
    const useSnap = this.adapter.snapEnabled !== false;
    const dest = useSnap ? (this.adapter.snapToGrid?.(w) || w) : w;
    this.adapter.moveToken?.(this.selected.id, dest);
    this.sync?.send({ type: 'token:move', payload: { id: this.selected.id, ...dest } });
    this.selected = null;
  }
}

/**
 * MeasureTool — ruler and movement modes, with permanent rulers and multiple
 * measurement types.
 *
 * Modes:
 *  - 'ruler'     drag A→B for a transient measurement (the classic ruler).
 *  - 'permanent' double-click to place a ruler that stays on the canvas,
 *                synced + persisted. Right-click a permanent ruler to delete.
 *  - 'movement'  click-drag a token to move it while showing the distance
 *                travelled (Owlbear's movement mode).
 *
 * Measurement types (Owlbear parity):
 *  - 'euclidean' straight-line distance (default; gridless-friendly).
 *  - 'chessboard' max(|dx|,|dy|) in squares — D&D 5e default.
 *  - 'alternating' every 2nd diagonal counts double — D&D 3.5e.
 *  - 'manhattan'  |dx| + |dy| in squares — no diagonal movement.
 *
 * Unit: 'ft' or 'm', with a configurable feetPerSquare (default 5).
 */
export class MeasureTool extends Tool {
  constructor() {
    super('measure', 'Measure', 'ruler');
    this.feetPerSquare = 5;
    this.unit = 'ft';            // 'ft' | 'm'
    this.mode = 'ruler';         // 'ruler' | 'permanent' | 'movement'
    this.measureType = 'euclidean'; // 'euclidean' | 'chessboard' | 'alternating' | 'manhattan'
    this.placed = new Set();     // ids of permanent rulers this client placed
  }
  setUnit(u) { this.unit = (u === 'm') ? 'm' : 'ft'; }
  toggleUnit() { this.unit = this.unit === 'ft' ? 'm' : 'ft'; return this.unit; }
  setMode(m) { this.mode = (m === 'permanent' || m === 'movement') ? m : 'ruler'; }
  setMeasureType(t) {
    this.measureType = ['euclidean', 'chessboard', 'alternating', 'manhattan'].includes(t) ? t : 'euclidean';
  }
  /** Squares between two world points, per the active measurement type. */
  _squares(a, b) {
    const g = this.adapter.gridSize || 1;
    const aV = a.z !== undefined ? a.z : a.y;
    const bV = b.z !== undefined ? b.z : b.y;
    const dx = Math.abs(b.x - a.x) / g;
    const dy = Math.abs(bV - aV) / g;
    switch (this.measureType) {
      case 'chessboard': return Math.max(dx, dy);
      case 'manhattan': return dx + dy;
      case 'alternating': {
        // Chebyshev with every 2nd diagonal costing 2: floor(dx)+floor(dy) +
        // extra for the diagonal pairs beyond the first.
        const min = Math.min(dx, dy);
        return Math.max(dx, dy) + Math.floor(min / 2);
      }
      case 'euclidean':
      default: return Math.hypot(dx, dy);
    }
  }
  _format(squares) {
    if (this.unit === 'm') {
      const meters = squares * (this.feetPerSquare === 5 ? 1.5 : this.feetPerSquare * 0.3048);
      return `${meters.toFixed(1)} m`;
    }
    return `${Math.round(squares * this.feetPerSquare)} ft`;
  }
  onPointerDown(w) {
    if (this.mode === 'movement') {
      // Pick a token to drag with a live ruler.
      const hit = this.adapter.pickToken?.(w);
      this._moving = hit || null;
      this.start = w;
      return;
    }
    this.start = w;
  }
  onPointerMove(w) {
    if (!this.start) return;
    if (this.mode === 'movement' && this._moving) {
      this.adapter.moveToken?.(this._moving.id, w);
      const sq = this._squares(this.start, w);
      this.adapter.showMeasurement(this.start, w, this._format(sq));
      return;
    }
    const sq = this._squares(this.start, w);
    this.adapter.showMeasurement(this.start, w, this._format(sq));
  }
  onPointerUp(w) {
    if (this.mode === 'movement') {
      if (this._moving) {
        const useSnap = this.adapter.snapEnabled !== false;
        const dest = useSnap ? (this.adapter.snapToGrid?.(w) || w) : w;
        this.adapter.moveToken?.(this._moving.id, dest);
        this.sync?.send({ type: 'token:move', payload: { id: this._moving.id, ...dest } });
      }
      this._moving = null;
      this.start = null;
      this.adapter.clearMeasurement();
      return;
    }
    if (this.mode === 'permanent' && this.start) {
      // Commit a permanent ruler on pointer-up.
      const id = 'meas_' + Math.random().toString(36).slice(2, 8);
      const sq = this._squares(this.start, w);
      const m = { id, a: { x: this.start.x, y: this.start.y }, b: { x: w.x, y: w.y }, label: this._format(sq) };
      this.adapter.addMeasurement(m);
      this.placed.add(id);
      this.sync?.send({ type: 'measure:add', payload: m });
    }
    this.start = null;
    this.adapter.clearMeasurement();
  }
  /** Double-click in permanent mode: place a ruler from the last point. */
  onDoubleClick(w) {
    // Not used — permanent rulers use drag in 'permanent' mode. Kept for
    // parity with Owlbear's double-click-to-place if we later want click-click.
  }
  /** Right-click a permanent ruler to delete it. */
  onContext(w) {
    // Find a measurement whose endpoint is near w.
    const near = (p, q, tol = this.adapter.gridSize ? this.adapter.gridSize * 0.4 : 24) =>
      Math.hypot(p.x - q.x, (p.z ?? p.y) - (q.z ?? q.y)) <= tol;
    const found = this.adapter.scene?.measurements?.find?.((m) => near(m.a, w) || near(m.b, w));
    if (found) this.deleteMeasurement(found.id);
  }
  deleteMeasurement(id) {
    this.adapter.removeMeasurement?.(id);
    this.placed.delete(id);
    this.sync?.send({ type: 'measure:remove', payload: { id } });
  }
  clearAll() {
    for (const id of [...this.placed]) this.deleteMeasurement(id);
  }
}

/**
 * AoETool — drop area-of-effect templates (circle/cone/square/line). Click and
 * drag to place + size, release to commit. Right-click (onContext) an existing
 * template to delete it. clearAll() wipes every template you placed. All
 * changes broadcast so everyone sees the fireball radius appear and disappear.
 */
export class AoETool extends Tool {
  constructor() {
    super('aoe', 'Area of Effect', 'burst');
    this.shape = 'circle';
    this.placed = new Set();     // ids this client has placed
  }
  setShape(s) { this.shape = s; }
  onPointerDown(w) {
    this.id = 'aoe_' + Math.random().toString(36).slice(2, 8);
    this.origin = w;
    this.adapter.setAoE(this.id, { shape: this.shape, x: w.x, z: w.z ?? w.y, radius: 1 });
  }
  onPointerMove(w) {
    if (!this.origin) return;
    const r = Math.hypot((w.x - this.origin.x), ((w.z ?? w.y) - (this.origin.z ?? this.origin.y)));
    const rot = Math.atan2((w.z ?? w.y) - (this.origin.z ?? this.origin.y), w.x - this.origin.x);
    this._last = { shape: this.shape, x: this.origin.x, z: this.origin.z ?? this.origin.y, radius: Math.max(0.5, r), rotation: rot };
    this.adapter.setAoE(this.id, this._last);
  }
  onPointerUp() {
    if (this.id && this._last) {
      this.placed.add(this.id);
      this.sync?.send({ type: 'aoe:set', payload: { id: this.id, ...this._last } });
    }
    this.origin = null;
  }
  /** Right-click on the canvas: delete the AoE template under the cursor. */
  onContext(w) {
    const id = this.adapter.pickAoE?.(w);
    if (id) this.delete(id);
  }
  delete(id) {
    this.adapter.removeAoE?.(id);
    this.placed.delete(id);
    this.sync?.send({ type: 'aoe:remove', payload: { id } });
  }
  clearAll() {
    for (const id of [...this.placed]) this.delete(id);
  }
}

/**
 * DrawTool — freehand pen, rectangle, ellipse, and text notes on the 2D
 * canvas. Select a sub-mode, then click-drag (for shapes) or click (for text).
 * Drawings are synced to the room and saved with the scene.
 *
 * In 3D this tool is inert (the 2D adapter owns the drawings layer); the
 * toolbar still shows it but events are ignored.
 */
export class DrawTool extends Tool {
  constructor() {
    super('draw', 'Draw', 'pen');
    this.sub = 'pen';       // 'pen'|'marker'|'rect'|'ellipse'|'line'|'triangle'|'hexagon'|'polygon'|'text'
    this.color = '#e0c068';
    this.width = 4;
    this.fill = 'rgba(224,192,104,0.12)';
    this._polyPts = null;
  }
  setSub(s) { this.sub = s; this._polyPts = null; }
  setColor(c) { this.color = c; }
  setWidth(w) { this.width = w; }
  setFill(f) { this.fill = f; }
  onActivate() { this._polyPts = null; }
  onDeactivate() { this._polyPts = null; }
  onPointerDown(w) {
    if (this.sub === 'text') {
      const text = window.prompt('Note text:');
      if (text) {
        this.adapter.scene?._addText?.({ x: w.x, y: w.y, text, color: this.color });
        this.sync?.send({ type: 'draw:text', payload: { x: w.x, y: w.y, text, color: this.color } });
      }
      return;
    }
    if (this.sub === 'polygon') {
      if (!this._polyPts) this._polyPts = [w.x, w.y];
      else this._polyPts.push(w.x, w.y);
      return;
    }
    this.start = w;
    this.points = [w.x, w.y];
    const Konva = this.adapter.scene?.Konva;
    const layer = this.adapter.scene?.getLayer?.('drawings');
    if (!Konva || !layer) return;
    if (this.sub === 'pen' || this.sub === 'marker') {
      this._live = new Konva.Line({
        points: this.points, stroke: this.color, strokeWidth: this.width,
        lineCap: 'round', lineJoin: 'round', tension: 0.3,
        fill: this.sub === 'marker' ? this.fill : undefined,
        closed: this.sub === 'marker',
      });
      layer.add(this._live);
    }
  }
  onPointerMove(w) {
    if (!this.start && this.sub !== 'polygon') return;
    const Konva = this.adapter.scene?.Konva;
    const layer = this.adapter.scene?.getLayer?.('drawings');
    if (!Konva || !layer) return;
    if ((this.sub === 'pen' || this.sub === 'marker') && this._live) {
      this.points.push(w.x, w.y);
      this._live.points(this.points);
      layer.batchDraw();
      return;
    }
    if (this.sub === 'polygon' && this._polyPts) {
      this._live?.destroy?.();
      this._live = new Konva.Line({
        points: [...this._polyPts, w.x, w.y], stroke: this.color, strokeWidth: this.width,
        dash: [6, 4], listening: false,
      });
      layer.add(this._live);
      layer.batchDraw();
      return;
    }
    if (['rect', 'ellipse', 'line', 'triangle', 'hexagon'].includes(this.sub)) {
      this._live?.destroy?.();
      const a = this.start, b = w;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
      const r = Math.max(rx, ry);
      if (this.sub === 'rect') {
        this._live = new Konva.Rect({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y), stroke: this.color, strokeWidth: this.width, fill: this.fill, listening: false });
      } else if (this.sub === 'ellipse') {
        this._live = new Konva.Ellipse({ x: cx, y: cy, radiusX: rx, radiusY: ry, stroke: this.color, strokeWidth: this.width, fill: this.fill, listening: false });
      } else if (this.sub === 'line') {
        this._live = new Konva.Line({ points: [a.x, a.y, b.x, b.y], stroke: this.color, strokeWidth: this.width, lineCap: 'round', listening: false });
      } else if (this.sub === 'triangle') {
        // Equilateral-ish triangle inscribed in the drag box.
        this._live = new Konva.Line({
          points: [cx, Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), Math.min(a.x, b.x), Math.max(a.y, b.y)],
          closed: true, stroke: this.color, strokeWidth: this.width, fill: this.fill, listening: false,
        });
      } else if (this.sub === 'hexagon') {
        const pts = [];
        for (let i = 0; i < 6; i++) {
          const ang = (Math.PI / 3) * i;
          pts.push(cx + r * Math.cos(ang), cy + r * Math.sin(ang));
        }
        this._live = new Konva.Line({ points: pts, closed: true, stroke: this.color, strokeWidth: this.width, fill: this.fill, listening: false });
      }
      layer.add(this._live);
      layer.batchDraw();
    }
  }
  onPointerUp(w) {
    if (this.sub === 'polygon') return; // closed on double-click
    if (!this.start) return;
    const a = this.start, b = w;
    const Konva = this.adapter.scene?.Konva;
    const layer = this.adapter.scene?.getLayer?.('drawings');
    this._live?.destroy?.();
    this._live = null;
    if (this.sub === 'pen') {
      if (this.points.length >= 4) {
        this.adapter.scene?._addLine?.({ points: this.points, color: this.color, width: this.width });
        this.sync?.send({ type: 'draw:line', payload: { points: this.points, color: this.color, width: this.width } });
      }
    } else if (this.sub === 'marker') {
      // Closed freehand shape.
      if (this.points.length >= 4) {
        const shape = { shape: 'marker', points: this.points, color: this.color, width: this.width, fill: this.fill };
        this.adapter.scene?._addShape?.(shape);
        this.sync?.send({ type: 'draw:shape', payload: shape });
      }
    } else if (this.sub === 'line') {
      const shape = { shape: 'line', points: [a.x, a.y, b.x, b.y], color: this.color, width: this.width };
      this.adapter.scene?._addLine?.(shape);
      this.sync?.send({ type: 'draw:line', payload: shape });
    } else if (['rect', 'ellipse', 'triangle', 'hexagon'].includes(this.sub)) {
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
      const r = Math.max(rx, ry);
      let shape;
      if (this.sub === 'rect' || this.sub === 'ellipse') {
        shape = { shape: this.sub, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), color: this.color, width: this.width, fill: this.fill };
      } else if (this.sub === 'triangle') {
        shape = { shape: 'triangle', points: [cx, Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), Math.min(a.x, b.x), Math.max(a.y, b.y)], color: this.color, width: this.width, fill: this.fill };
      } else {
        const pts = [];
        for (let i = 0; i < 6; i++) { const ang = (Math.PI / 3) * i; pts.push(cx + r * Math.cos(ang), cy + r * Math.sin(ang)); }
        shape = { shape: 'hexagon', points: pts, color: this.color, width: this.width, fill: this.fill };
      }
      this.adapter.scene?._addShape?.(shape);
      this.sync?.send({ type: 'draw:shape', payload: shape });
    }
    this.start = null;
    this.points = null;
  }
  /** Double-click closes a polygon drawing. */
  onDoubleClick() {
    if (this.sub !== 'polygon' || !this._polyPts || this._polyPts.length < 6) return;
    this._live?.destroy?.();
    this._live = null;
    const shape = { shape: 'polygon', points: this._polyPts.slice(), color: this.color, width: this.width, fill: this.fill };
    this.adapter.scene?._addShape?.(shape);
    this.sync?.send({ type: 'draw:shape', payload: shape });
    this._polyPts = null;
  }
}

/**
 * FogTool — GM-only fog of war. Sub-modes:
 *  - 'brush'    paint fog freehand (hide terrain).
 *  - 'eraser'   reveal terrain by cutting freehand.
 *  - 'rect'     drag a rectangular fog shape.
 *  - 'circle'   drag a circular fog shape (radius = drag distance).
 *  - 'polygon'  click to add points; double-click to close the polygon.
 *
 * "Cut" toggle: when on, a shape SUBTRACTS from existing fog (reveals) instead
 * of adding it — Owlbear's cut/uncut. "Reveal all"/"Hide all" clear or fill.
 * "Fog preview" lets the GM see the player's opaque view. Fog color is
 * configurable. Players never see this tool in the toolbar.
 */
export class FogTool extends Tool {
  constructor() {
    super('fog', 'Fog of War', 'cloud');
    this.sub = 'brush';   // 'brush' | 'eraser' | 'rect' | 'circle' | 'polygon'
    this.radius = 36;
    this.color = '#0a0a0a';
    this.cut = false;     // when true, shapes subtract (reveal) instead of add
    this.preview = false; // fog preview (GM sees player view)
    this._polyPts = null;
  }
  setSub(s) { this.sub = s; }
  setRadius(r) { this.radius = r; }
  setColor(c) { this.color = c; this.adapter.scene?.setFogColor?.(c); }
  setCut(on) { this.cut = !!on; }
  togglePreview() {
    this.preview = !this.preview;
    this.adapter.scene?.setFogPreview?.(this.preview);
    return this.preview;
  }
  onActivate() { this._polyPts = null; }
  onDeactivate() { this._polyPts = null; this.adapter.scene?.setFogPreview?.(false); this.preview = false; }
  onPointerDown(w) {
    if (this.sub === 'brush' || this.sub === 'eraser') {
      this.adapter.beginFogStroke?.(w, this.sub === 'eraser' ? 'eraser' : 'brush');
      this._drawing = true;
      return;
    }
    if (this.sub === 'rect' || this.sub === 'circle') {
      this.start = w;
      return;
    }
    if (this.sub === 'polygon') {
      // Click adds a point; double-click closes (handled in onDoubleClick).
      if (!this._polyPts) this._polyPts = [w.x, w.y];
      else this._polyPts.push(w.x, w.y);
      return;
    }
  }
  onPointerMove(w) {
    if (this._drawing) { this.adapter.extendFogStroke?.(w); return; }
    if ((this.sub === 'rect' || this.sub === 'circle') && this.start) {
      // Live preview shape on the fog layer (kept simple: update a temp node).
      this._liveShape?.destroy?.();
      const Konva = this.adapter.scene?.Konva;
      const layer = this.adapter.scene?.getLayer?.('fog');
      if (!Konva || !layer) return;
      const comp = this.cut ? 'destination-out' : 'source-over';
      if (this.sub === 'rect') {
        this._liveShape = new Konva.Rect({
          x: Math.min(this.start.x, w.x), y: Math.min(this.start.y, w.y),
          width: Math.abs(w.x - this.start.x), height: Math.abs(w.y - this.start.y),
          fill: this.color, listening: false, globalCompositeOperation: comp,
        });
      } else {
        const r = Math.hypot(w.x - this.start.x, w.y - this.start.y);
        this._liveShape = new Konva.Circle({
          x: this.start.x, y: this.start.y, radius: r, fill: this.color,
          listening: false, globalCompositeOperation: comp,
        });
      }
      layer.add(this._liveShape);
      layer.batchDraw();
      return;
    }
    if (this.sub === 'polygon' && this._polyPts) {
      // Live preview line from last point to cursor.
      this._liveShape?.destroy?.();
      const Konva = this.adapter.scene?.Konva;
      const layer = this.adapter.scene?.getLayer?.('fog');
      if (!Konva || !layer) return;
      const pts = [...this._polyPts, w.x, w.y];
      this._liveShape = new Konva.Line({
        points: pts, stroke: this.color, strokeWidth: 2, dash: [6, 4], listening: false,
      });
      layer.add(this._liveShape);
      layer.batchDraw();
    }
  }
  onPointerUp(w) {
    if (this._drawing) {
      this._drawing = false;
      const stroke = this.adapter.endFogStroke?.();
      if (stroke) this.sync?.send({ type: 'fog:stroke', payload: stroke });
      return;
    }
    if ((this.sub === 'rect' || this.sub === 'circle') && this.start) {
      this._liveShape?.destroy?.();
      this._liveShape = null;
      const id = 'fog_' + Math.random().toString(36).slice(2, 8);
      let shape;
      if (this.sub === 'rect') {
        shape = { id, kind: 'rect', cut: this.cut, color: this.color,
          x: Math.min(this.start.x, w.x), y: Math.min(this.start.y, w.y),
          w: Math.abs(w.x - this.start.x), h: Math.abs(w.y - this.start.y) };
      } else {
        const r = Math.hypot(w.x - this.start.x, w.y - this.start.y);
        shape = { id, kind: 'circle', cut: this.cut, color: this.color,
          x: this.start.x, y: this.start.y, r: Math.max(4, r) };
      }
      this.adapter.scene?.addFogShape?.(shape);
      this.sync?.send({ type: 'fog:shape', payload: shape });
      this.start = null;
      return;
    }
  }
  /** Double-click closes a polygon fog shape. */
  onDoubleClick(w) {
    if (this.sub !== 'polygon' || !this._polyPts || this._polyPts.length < 6) return;
    this._liveShape?.destroy?.();
    this._liveShape = null;
    const id = 'fog_' + Math.random().toString(36).slice(2, 8);
    const shape = { id, kind: 'polygon', cut: this.cut, color: this.color, points: this._polyPts.slice() };
    this.adapter.scene?.addFogShape?.(shape);
    this.sync?.send({ type: 'fog:shape', payload: shape });
    this._polyPts = null;
  }
  revealAll() {
    this.adapter.scene?.clearFog?.();
    this.sync?.send({ type: 'fog:clear', payload: {} });
  }
  hideAll() {
    this.adapter.scene?.hideAll?.();
    this.sync?.send({ type: 'fog:hideall', payload: {} });
  }
}

/**
 * BuildTool — map building in 3D. Left-click places the currently-selected
 * primitive (box/cylinder/sphere/cone/ramp) at the cursor; right-click deletes
 * the block under the cursor. Block size/colour come from the tool's current
 * settings (driven by the build palette UI). All placements broadcast.
 */
export class BuildTool extends Tool {
  constructor() {
    super('build', 'Build', 'cube');
    this.shape = 'box';
    this.color = '#6b5d4f';
    this.size = { w: 1, h: 1, d: 1 };
    this.placed = new Set();
  }
  setShape(s) { this.shape = s; }
  setColor(c) { this.color = c; }
  setSize(s) { this.size = { ...this.size, ...s }; }
  onPointerDown(w) {
    // w is a world point on the ground (adapter provides {x,y,z}).
    const id = 'blk_' + Math.random().toString(36).slice(2, 8);
    const data = {
      id, shape: this.shape, color: this.color,
      x: Math.round(w.x), z: Math.round(w.z ?? w.y),
      y: this.size.h / 2,
      w: this.size.w, h: this.size.h, d: this.size.d,
    };
    this.adapter.addBlock?.(data);
    this.placed.add(id);
    this.sync?.send({ type: 'block:set', payload: data });
  }
  onContext(w) {
    const id = this.adapter.pickBlock?.(w);
    if (id) {
      this.adapter.removeBlock?.(id);
      this.placed.delete(id);
      this.sync?.send({ type: 'block:remove', payload: { id } });
    }
  }
}
