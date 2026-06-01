/**
 * Scene2D — the 2D tabletop, the Owlbear-style core experience.
 *
 * Built on Konva (an injected dependency). Layers, in draw order:
 *   1. map      — background images (battlemaps)
 *   2. grid     — square/hex overlay
 *   3. drawings — freehand + shapes
 *   4. aoe      — area-of-effect templates
 *   5. tokens   — character / monster tokens, draggable
 *   6. fog      — fog of war (GM-paintable mask)
 *   7. overlay  — pointers, measurement, selection handles (transient)
 *
 * Every persistent mutation emits an event via `onChange` so the SyncClient
 * can broadcast it. Remote changes call the apply* methods directly without
 * re-emitting (guarded by `_silent`).
 */
export class Scene2D {
  constructor({ Konva, container, onChange, gridSize = 70 }) {
    this.Konva = Konva;
    this.onChange = onChange || (() => {});
    this.gridSize = gridSize;
    this._silent = false;

    this.stage = new Konva.Stage({
      container,
      width: container.clientWidth,
      height: container.clientHeight,
      // Pan is handled manually on right-click so left-click is free for tools.
    });

    this.layers = {};
    for (const name of ['map', 'grid', 'drawings', 'aoe', 'tokens', 'fog', 'overlay']) {
      const layer = new Konva.Layer({ listening: name === 'tokens' || name === 'overlay' });
      this.layers[name] = layer;
      this.stage.add(layer);
    }

    this.tokens = new Map();
    this._setupZoom();
    this._setupPan();
    this.drawGrid();
  }

  _emit(type, payload) {
    if (!this._silent) this.onChange({ type, payload });
  }

  /** Right-click drag to pan, matching the 3D mode behaviour. */
  _setupPan() {
    const stage = this.stage;
    let panning = false, last = null;
    stage.on('mousedown', (e) => {
      if (e.evt.button !== 2) return;
      panning = true;
      last = { x: e.evt.clientX, y: e.evt.clientY };
    });
    stage.on('mousemove', (e) => {
      if (!panning || !last) return;
      stage.x(stage.x() + (e.evt.clientX - last.x));
      stage.y(stage.y() + (e.evt.clientY - last.y));
      last = { x: e.evt.clientX, y: e.evt.clientY };
      stage.batchDraw();
    });
    stage.on('mouseup', (e) => { if (e.evt.button === 2) panning = false; });
    // Suppress the context menu so right-click-drag works cleanly.
    stage.container().addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _setupZoom() {
    const stage = this.stage;
    stage.on('wheel', (e) => {
      e.evt.preventDefault();
      const scaleBy = 1.06;
      const old = stage.scaleX();
      const pointer = stage.getPointerPosition();
      const mousePoint = {
        x: (pointer.x - stage.x()) / old,
        y: (pointer.y - stage.y()) / old,
      };
      const dir = e.evt.deltaY > 0 ? 1 / scaleBy : scaleBy;
      const next = Math.max(0.15, Math.min(6, old * dir));
      stage.scale({ x: next, y: next });
      stage.position({
        x: pointer.x - mousePoint.x * next,
        y: pointer.y - mousePoint.y * next,
      });
    });
  }

  drawGrid() {
    const { Konva } = this;
    const layer = this.layers.grid;
    layer.destroyChildren();
    const w = 4000, h = 4000, g = this.gridSize;
    for (let x = 0; x <= w; x += g) {
      layer.add(new Konva.Line({ points: [x, 0, x, h], stroke: '#3a3228', strokeWidth: 1 }));
    }
    for (let y = 0; y <= h; y += g) {
      layer.add(new Konva.Line({ points: [0, y, w, y], stroke: '#3a3228', strokeWidth: 1 }));
    }
    layer.batchDraw();
  }

  async setMap(url) {
    const { Konva } = this;
    this._mapUrl = url;
    const img = await loadImage(url);
    this.layers.map.destroyChildren();
    const node = new Konva.Image({ image: img, x: 0, y: 0 });
    this.layers.map.add(node);
    this.layers.map.batchDraw();
    this._emit('map:set', { url });
  }

  /** Serialize the 2D scene to a plain object for persistence. */
  serialize() {
    return {
      mapUrl: this._mapUrl || null,
      tokens: [...this.tokens.values()].map((e) => ({ ...e.data })),
    };
  }

  /** token = {id, url?, color?, x, y, size, label}. */
  async upsertToken(token) {
    const { Konva } = this;
    let entry = this.tokens.get(token.id);
    const size = (token.size || 1) * this.gridSize;
    if (!entry) {
      const group = new Konva.Group({ x: token.x, y: token.y, draggable: true, id: token.id });
      let shape;
      if (token.url) {
        const img = await loadImage(token.url);
        shape = new Konva.Image({ image: img, width: size, height: size, cornerRadius: 8 });
      } else {
        shape = new Konva.Circle({
          radius: size / 2, x: size / 2, y: size / 2,
          fill: token.color || '#8a6d3b', stroke: '#0d0b08', strokeWidth: 3,
        });
      }
      group.add(shape);
      const label = new Konva.Text({
        text: token.label || '', y: size + 2, width: size, align: 'center',
        fill: '#f0e6cc', fontSize: 14, fontStyle: 'bold',
        shadowColor: '#000', shadowBlur: 3,
      });
      group.add(label);

      group.on('dragend', () => {
        // Snap to grid centre.
        const gx = Math.round(group.x() / this.gridSize) * this.gridSize;
        const gy = Math.round(group.y() / this.gridSize) * this.gridSize;
        group.position({ x: gx, y: gy });
        this.layers.tokens.batchDraw();
        this._emit('token:move', { id: token.id, x: gx, y: gy });
      });

      this.layers.tokens.add(group);
      entry = { group, shape, label, data: token };
      this.tokens.set(token.id, entry);
    }
    entry.group.position({ x: token.x, y: token.y });
    if (entry.label) entry.label.text(token.label || '');
    entry.data = token;
    this.layers.tokens.batchDraw();
    return entry;
  }

  removeToken(id) {
    const e = this.tokens.get(id);
    if (e) { e.group.destroy(); this.tokens.delete(id); this.layers.tokens.batchDraw(); }
  }

  /** Apply a remote change without re-broadcasting it. */
  applyRemote(change) {
    this._silent = true;
    try {
      switch (change.type) {
        case 'token:move': {
          const e = this.tokens.get(change.payload.id);
          if (e) { e.group.position(change.payload); this.layers.tokens.batchDraw(); }
          break;
        }
        case 'token:upsert': this.upsertToken(change.payload); break;
        case 'token:remove': this.removeToken(change.payload.id); break;
        case 'map:set': this.setMap(change.payload.url); break;
        case 'draw:line': this._addLine(change.payload); break;
      }
    } finally {
      this._silent = false;
    }
  }

  _addLine({ points, color = '#e0c068', width = 4 }) {
    const line = new this.Konva.Line({
      points, stroke: color, strokeWidth: width, lineCap: 'round',
      lineJoin: 'round', tension: 0.3,
    });
    this.layers.drawings.add(line);
    this.layers.drawings.batchDraw();
    return line;
  }

  resize(w, h) { this.stage.size({ width: w, height: h }); }
  getLayer(name) { return this.layers[name]; }
}

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}
