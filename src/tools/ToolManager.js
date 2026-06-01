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
 * MeasureTool — drag from A to B, shows distance in grid squares converted to
 * the active unit. Owlbear's headline tool for gridless maps. Supports both
 * feet (D&D 5e default, 5 ft/square) and meters (1.5 m/square), toggleable.
 */
export class MeasureTool extends Tool {
  constructor() {
    super('measure', 'Measure', 'ruler');
    this.feetPerSquare = 5;
    this.unit = 'ft';            // 'ft' | 'm'
  }
  setUnit(u) { this.unit = (u === 'm') ? 'm' : 'ft'; }
  toggleUnit() { this.unit = this.unit === 'ft' ? 'm' : 'ft'; return this.unit; }
  _format(squares) {
    const sq = Math.round(squares);
    if (this.unit === 'm') {
      // 5 ft ≈ 1.5 m per square — the conventional TTRPG metric conversion.
      const meters = sq * (this.feetPerSquare === 5 ? 1.5 : this.feetPerSquare * 0.3048);
      return `${meters.toFixed(1)} m`;
    }
    return `${sq * this.feetPerSquare} ft`;
  }
  onPointerDown(w) { this.start = w; }
  onPointerMove(w) {
    if (!this.start) return;
    const sq = this.adapter.gridSize || 1;
    // The "vertical" world axis differs by mode: 2D points are {x,y}; 3D points
    // are {x, y=height≈0, z=depth}. Use z when it's present (3D), else y (2D).
    const aV = this.start.z !== undefined ? this.start.z : this.start.y;
    const bV = w.z !== undefined ? w.z : w.y;
    const dx = w.x - this.start.x;
    const dy = bV - aV;
    const squares = Math.hypot(dx, dy) / sq;
    this.adapter.showMeasurement(this.start, w, this._format(squares));
  }
  onPointerUp() { this.start = null; this.adapter.clearMeasurement(); }
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
