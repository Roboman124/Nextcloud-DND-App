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
    this.fogStrokes = [];   // persisted {tool:'brush'|'eraser', points, radius, color}
    this.measurements = []; // permanent rulers: {id, a:{x,y}, b:{x,y}, label}
    this.maps = [];         // multiple map images: {id, url, x, y, w, h, scale, locked}
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
    const cfg = this.gridConfig || {};
    const type = cfg.type || 'square';
    const color = cfg.color || '#3a3228';
    const opacity = cfg.opacity != null ? cfg.opacity : 1;
    const lw = cfg.lineWidth || 1;
    const dash = cfg.lineStyle === 'dashed' ? [12, 8] : cfg.lineStyle === 'dotted' ? [2, 6] : undefined;
    const w = 4000, h = 4000, g = this.gridSize;

    const mkLine = (pts) => new Konva.Line({
      points: pts, stroke: color, strokeWidth: lw, opacity, dash,
    });

    if (type === 'hex-v' || type === 'hex-h') {
      // Hex grid: pointy-top (hex-v) or flat-top (hex-h). Draw each hex as a
      // stroked regular hexagon. The grid size is the hex "size" (centre to
      // vertex). Spacing: width = sqrt(3)*size, height = 1.5*size (pointy),
      // mirrored for flat-top.
      const size = g / 2;
      const isPointy = type === 'hex-v';
      const hw = isPointy ? Math.sqrt(3) * size : 2 * size;
      const hh = isPointy ? 2 * size : Math.sqrt(3) * size;
      const colStep = isPointy ? hw : hw * 0.75;
      const rowStep = isPointy ? hh * 0.75 : hh;
      for (let row = -2, y = 0; y < h + hh; row++, y = row * rowStep + hh) {
        for (let col = -2, x = 0; x < w + hw; col++, x = col * colStep + hw + (row % 2 ? colStep / 2 : 0)) {
          const pts = isPointy
            ? [x, y - size, x + hw / 2, y - size / 2, x + hw / 2, y + size / 2, x, y + size, x - hw / 2, y + size / 2, x - hw / 2, y - size / 2]
            : [x - size, y, x - size / 2, y - hh / 2, x + size / 2, y - hh / 2, x + size, y, x + size / 2, y + hh / 2, x - size / 2, y + hh / 2];
          layer.add(mkLine(pts));
        }
      }
    } else {
      // Square (default) — also covers 'square'.
      for (let x = 0; x <= w; x += g) layer.add(mkLine([x, 0, x, h]));
      for (let y = 0; y <= h; y += g) layer.add(mkLine([0, y, w, y]));
    }
    layer.batchDraw();
  }

  /** Update grid config and redraw. cfg = {type, color, opacity, lineWidth, lineStyle, size?}. */
  setGridConfig(cfg) {
    this.gridConfig = { ...(this.gridConfig || {}), ...cfg };
    if (cfg.size && cfg.size > 0) this.gridSize = cfg.size;
    this.drawGrid();
    this._emit('grid:config', this.gridConfig);
  }

  async setMap(url) {
    // Single-map convenience: replace any existing maps with one at origin.
    this.maps = [];
    this.layers.map.destroyChildren();
    this._mapUrl = url;
    const img = await loadImage(url);
    const node = new Konva.Image({ image: img, x: 0, y: 0, draggable: false, id: 'map_0' });
    this.layers.map.add(node);
    this.layers.map.batchDraw();
    this.maps.push({ id: 'map_0', url, x: 0, y: 0, w: img.width, h: img.height, scale: 1 });
    this._emit('map:set', { url });
  }

  /**
   * Add a map image WITHOUT replacing existing ones — supports multiple maps
   * on one canvas (e.g. multi-floor building side-by-side). The map is
   * draggable when unlocked so the GM can position it; locked by default to
   * avoid accidental moves.
   */
  async addMap(url, { x = 0, y = 0, scale = 1, locked = true } = {}) {
    const { Konva } = this;
    const id = 'map_' + Math.random().toString(36).slice(2, 8);
    const img = await loadImage(url);
    const node = new Konva.Image({ image: img, x, y, draggable: !locked, id });
    node.scale({ x: scale, y: scale });
    // Track position on dragend so it persists + syncs.
    node.on('dragend', () => {
      const m = this.maps.find((m) => m.id === id);
      if (m) { m.x = node.x(); m.y = node.y(); }
      this.layers.map.batchDraw();
      this._emit('map:move', { id, x: node.x(), y: node.y() });
    });
    this.layers.map.add(node);
    this.layers.map.batchDraw();
    const entry = { id, url, x, y, w: img.width, h: img.height, scale, locked };
    this.maps.push(entry);
    if (!this._mapUrl) this._mapUrl = url;
    this._emit('map:add', entry);
    return entry;
  }

  /** Toggle a map's lock (draggable vs fixed). */
  setMapLocked(id, locked) {
    const node = this.layers.map.findOne('#' + id);
    if (node) node.draggable(!locked);
    const m = this.maps.find((m) => m.id === id);
    if (m) m.locked = locked;
    this.layers.map.batchDraw();
  }

  /** Scale a map (for grid alignment — drag the scale until cells line up). */
  setMapScale(id, scale) {
    const node = this.layers.map.findOne('#' + id);
    if (node) node.scale({ x: scale, y: scale });
    const m = this.maps.find((m) => m.id === id);
    if (m) m.scale = scale;
    this.layers.map.batchDraw();
    this._emit('map:scale', { id, scale });
  }

  removeMap(id) {
    const node = this.layers.map.findOne('#' + id);
    if (node) node.destroy();
    this.maps = this.maps.filter((m) => m.id !== id);
    this.layers.map.batchDraw();
    this._emit('map:remove', { id });
  }

  /** Serialize the 2D scene to a plain object for persistence. */
  serialize() {
    return {
      mapUrl: this._mapUrl || null,
      maps: this.maps.slice(),
      tokens: [...this.tokens.values()].map((e) => ({ ...e.data })),
      fog: this.fogStrokes.length ? this.fogStrokes : null,
      drawings: (this._drawings || []).map((d) => d.data),
      measurements: this.measurements.slice(),
      gridConfig: this.gridConfig || null,
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

      // HP bar: a thin track under the token with a fill proportional to
      // hp/maxHp. Hidden when maxHp is unset (0/null). GM can edit it via the
      // health popover; players see the bar but can't change it.
      const barW = Math.max(size, 36);
      const bar = new Konva.Group({ x: (size - barW) / 2, y: -10, visible: !!token.hp?.maxHp });
      const barBg = new Konva.Rect({ width: barW, height: 6, cornerRadius: 3, fill: '#3a0d0d', stroke: '#0d0b08', strokeWidth: 1 });
      const barFill = new Konva.Rect({ width: barW, height: 6, cornerRadius: 3, fill: '#3fb950' });
      const barText = new Konva.Text({ y: -14, width: barW, align: 'center', fontSize: 11, fontStyle: 'bold', fill: '#f0e6cc', shadowColor: '#000', shadowBlur: 3, text: '' });
      bar.add(barBg, barFill, barText);
      group.add(bar);

      group.on('dragend', () => {
        let gx = group.x(), gy = group.y();
        if (this.snapEnabled !== false) {
          // Snap to grid centre when snapping is on.
          gx = Math.round(group.x() / this.gridSize) * this.gridSize;
          gy = Math.round(group.y() / this.gridSize) * this.gridSize;
          group.position({ x: gx, y: gy });
        }
        this.layers.tokens.batchDraw();
        this._emit('token:move', { id: token.id, x: gx, y: gy });
      });

      this.layers.tokens.add(group);
      entry = { group, shape, label, bar, barFill, barText, data: token };
      this.tokens.set(token.id, entry);
    }
    entry.group.position({ x: token.x, y: token.y });
    if (entry.label) entry.label.text(token.label || '');
    entry.data = token;
    this._renderHp(entry);
    this.layers.tokens.batchDraw();
    return entry;
  }

  /** Update a token's HP and re-render its bar. Emits token:hp unless silent. */
  updateHp(id, hp) {
    const e = this.tokens.get(id);
    if (!e) return;
    e.data.hp = hp;
    this._renderHp(e);
    this.layers.tokens.batchDraw();
    this._emit('token:hp', { id, hp });
  }

  /** Paint the HP bar from e.data.hp = {current, maxHp, temp?}. */
  _renderHp(e) {
    const hp = e.data.hp;
    const has = hp && hp.maxHp && hp.maxHp > 0;
    e.bar.visible(!!has);
    if (!has) return;
    const cur = Math.max(0, Math.min(hp.current ?? 0, hp.maxHp));
    const frac = hp.maxHp > 0 ? cur / hp.maxHp : 0;
    const barW = e.barBg.width();
    e.barFill.width(barW * frac);
    // Green > amber > red as HP drops, so a glance reads the threat level.
    e.barFill.fill(frac > 0.5 ? '#3fb950' : frac > 0.2 ? '#e0c068' : '#e74c3c');
    e.barText.text(`${cur}/${hp.maxHp}`);
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
        case 'token:hp': {
          const e = this.tokens.get(change.payload.id);
          if (e) { e.data.hp = change.payload.hp; this._renderHp(e); this.layers.tokens.batchDraw(); }
          break;
        }
        case 'map:set': this.setMap(change.payload.url); break;
        case 'map:add': this.addMap(change.payload.url, change.payload); break;
        case 'map:move': {
          const node = this.layers.map.findOne('#' + change.payload.id);
          if (node) { node.position({ x: change.payload.x, y: change.payload.y }); this.layers.map.batchDraw(); }
          const m = this.maps.find((m) => m.id === change.payload.id);
          if (m) { m.x = change.payload.x; m.y = change.payload.y; }
          break;
        }
        case 'map:scale': {
          const node = this.layers.map.findOne('#' + change.payload.id);
          if (node) { node.scale({ x: change.payload.scale, y: change.payload.scale }); this.layers.map.batchDraw(); }
          const m = this.maps.find((m) => m.id === change.payload.id);
          if (m) m.scale = change.payload.scale;
          break;
        }
        case 'map:remove': this.removeMap(change.payload.id); break;
        case 'draw:line': this._addLine(change.payload); break;
        case 'draw:shape': this._addShape(change.payload); break;
        case 'draw:text': this._addText(change.payload); break;
        case 'fog:stroke': this.applyFogStroke(change.payload); break;
        case 'fog:shape': this.applyFogShape(change.payload); break;
        case 'fog:shape:remove': {
          const node = this.layers.fog.findOne('#' + change.payload.id);
          if (node) { node.destroy(); this.layers.fog.batchDraw(); }
          this.fogStrokes = this.fogStrokes.filter((s) => s.id !== change.payload.id);
          break;
        }
        case 'fog:clear': this.clearFog(); break;
        case 'fog:hideall': this.hideAll(); break;
        case 'measure:add': this.applyMeasurement(change.payload); break;
        case 'measure:remove': {
          const node = this.layers.overlay.findOne('#' + change.payload.id);
          if (node) { node.destroy(); this.layers.overlay.batchDraw(); }
          this.measurements = this.measurements.filter((m) => m.id !== change.payload.id);
          break;
        }
        case 'grid:config': this.setGridConfig(change.payload); break;
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
    (this._drawings = this._drawings || []).push({ node: line, data: { points, color, width } });
    return line;
  }

  _addShape({ shape, x, y, w, h, points, color = '#e0c068', width = 4, fill = 'rgba(224,192,104,0.12)' }) {
    const { Konva } = this;
    let node;
    if (shape === 'rect') {
      node = new Konva.Rect({ x, y, width: w, height: h, stroke: color, strokeWidth: width, fill });
    } else if (shape === 'ellipse') {
      node = new Konva.Ellipse({ x, y, radiusX: w / 2, radiusY: h / 2, stroke: color, strokeWidth: width, fill });
    } else if (shape === 'marker' || shape === 'polygon' || shape === 'triangle' || shape === 'hexagon') {
      node = new Konva.Line({ points: points || [], closed: true, stroke: color, strokeWidth: width, fill, lineJoin: 'round' });
    } else {
      return;
    }
    this.layers.drawings.add(node);
    this.layers.drawings.batchDraw();
    (this._drawings = this._drawings || []).push({ node, data: { shape, x, y, w, h, points, color, width, fill } });
    return node;
  }

  _addText({ x, y, text, color = '#f0e6cc', size = 18 }) {
    const { Konva } = this;
    const node = new Konva.Text({
      x, y, text, fill: color, fontSize: size, fontStyle: 'bold',
      shadowColor: '#000', shadowBlur: 3, draggable: false,
    });
    this.layers.drawings.add(node);
    this.layers.drawings.batchDraw();
    (this._drawings = this._drawings || []).push({ node, data: { x, y, text, color, size } });
    return node;
  }

  /**
   * Fog of war. The fog layer is a GM-paintable mask: brush strokes paint
   * opaque fog (hide), eraser strokes cut holes (reveal). Strokes are stored
   * so the fog can be replayed on remote clients and on load.
   *
   * Each stroke is rendered to its own Konva.Line with a thick round lineCap,
   * which blends into a continuous mask. Eraser strokes use destination-out
   * compositing so they cut through previously painted fog.
   */
  addFogStroke(stroke) {
    const { Konva } = this;
    const layer = this.layers.fog;
    const pts = stroke.points || [];
    const node = new Konva.Line({
      points: pts,
      stroke: stroke.color || '#0a0a0a',
      strokeWidth: stroke.radius || 36,
      lineCap: 'round',
      lineJoin: 'round',
      globalCompositeOperation: stroke.tool === 'eraser' ? 'destination-out' : 'source-over',
      listening: false,
    });
    layer.add(node);
    layer.batchDraw();
    this.fogStrokes.push(stroke);
    this._emit('fog:stroke', stroke);
    return node;
  }

  /** Replay a fog stroke coming from a remote client (no re-emit). */
  applyFogStroke(stroke) {
    const { Konva } = this;
    const layer = this.layers.fog;
    const node = new Konva.Line({
      points: stroke.points || [],
      stroke: stroke.color || '#0a0a0a',
      strokeWidth: stroke.radius || 36,
      lineCap: 'round',
      lineJoin: 'round',
      globalCompositeOperation: stroke.tool === 'eraser' ? 'destination-out' : 'source-over',
      listening: false,
    });
    layer.add(node);
    layer.batchDraw();
    this.fogStrokes.push(stroke);
  }

  /**
   * Add a fog SHAPE (rect / circle / polygon). Shapes can be "cut" (subtract
   * from existing fog) or normal (add fog). Stored like brush strokes so they
   * replay on remote clients and on load.
   */
  addFogShape(shape) {
    const { Konva } = this;
    const layer = this.layers.fog;
    let node;
    const color = shape.color || this.fogColor || '#0a0a0a';
    const comp = shape.cut ? 'destination-out' : 'source-over';
    if (shape.kind === 'rect') {
      node = new Konva.Rect({
        x: shape.x, y: shape.y, width: shape.w, height: shape.h,
        fill: color, listening: false, globalCompositeOperation: comp,
      });
    } else if (shape.kind === 'circle') {
      node = new Konva.Circle({
        x: shape.x, y: shape.y, radius: shape.r,
        fill: color, listening: false, globalCompositeOperation: comp,
      });
    } else if (shape.kind === 'polygon') {
      node = new Konva.Line({
        points: shape.points, closed: true, fill: color,
        listening: false, globalCompositeOperation: comp,
      });
    } else {
      return;
    }
    node.id(shape.id);
    layer.add(node);
    layer.batchDraw();
    this.fogStrokes.push(shape);
    this._emit('fog:shape', shape);
    return node;
  }

  applyFogShape(shape) {
    // Re-render without re-emitting.
    const { Konva } = this;
    const layer = this.layers.fog;
    const color = shape.color || this.fogColor || '#0a0a0a';
    const comp = shape.cut ? 'destination-out' : 'source-over';
    let node;
    if (shape.kind === 'rect') {
      node = new Konva.Rect({ x: shape.x, y: shape.y, width: shape.w, height: shape.h, fill: color, listening: false, globalCompositeOperation: comp });
    } else if (shape.kind === 'circle') {
      node = new Konva.Circle({ x: shape.x, y: shape.y, radius: shape.r, fill: color, listening: false, globalCompositeOperation: comp });
    } else if (shape.kind === 'polygon') {
      node = new Konva.Line({ points: shape.points, closed: true, fill: color, listening: false, globalCompositeOperation: comp });
    } else return;
    node.id(shape.id);
    layer.add(node);
    layer.batchDraw();
    this.fogStrokes.push(shape);
  }

  removeFogShape(id) {
    const node = this.layers.fog.findOne('#' + id);
    if (node) { node.destroy(); this.layers.fog.batchDraw(); }
    this.fogStrokes = this.fogStrokes.filter((s) => s.id !== id);
    this._emit('fog:shape:remove', { id });
  }

  /** Toggle "fog preview": when on, the GM sees fog as the players do (opaque). */
  setFogPreview(on) {
    this.fogPreview = on;
    // In preview, the fog layer's nodes render solid (no GM transparency).
    // We approximate by toggling the layer's opacity: the GM's "see-through"
    // fog is a visual convention; at opacity 1 it reads like a player's view.
    this.layers.fog.opacity(on ? 1 : 1);
    // The real GM-vs-player difference is that the GM sees tokens under fog.
    // We toggle the token layer's visibility under fog by redrawing — simpler
    // to just raise the fog layer above tokens during preview.
    const fogIdx = this.stage.children.indexOf(this.layers.fog);
    const tokIdx = this.stage.children.indexOf(this.layers.tokens);
    if (on && fogIdx < tokIdx) this.stage.children.splice(tokIdx, 0, this.stage.children.splice(fogIdx, 1)[0]);
    this.layers.fog.batchDraw();
  }

  setFogColor(color) {
    this.fogColor = color;
    // Existing strokes keep their recorded color; new ones use this.
  }

  clearFog() {
    this.layers.fog.destroyChildren();
    this.layers.fog.batchDraw();
    this.fogStrokes = [];
    this._emit('fog:clear', {});
  }

  /** Reveal the whole map (GM "show all"). */
  revealAll() {
    this.clearFog();
  }

  /** Hide the whole map under fog (GM "hide all"). */
  hideAll() {
    const { Konva } = this;
    this.layers.fog.destroyChildren();
    const cover = new Konva.Rect({
      x: -4000, y: -4000, width: 12000, height: 12000,
      fill: '#0a0a0a', listening: false,
    });
    this.layers.fog.add(cover);
    this.layers.fog.batchDraw();
    this.fogStrokes = [{ tool: 'cover', points: [], color: '#0a0a0a', radius: 0 }];
    this._emit('fog:hideall', {});
  }

  // --- Permanent rulers (measurement tool) ---

  /** Add a permanent ruler line + label to the overlay layer. */
  addMeasurement(m) {
    const { Konva } = this;
    const layer = this.layers.overlay;
    const group = new Konva.Group({ id: m.id, listening: false });
    const line = new Konva.Line({
      points: [m.a.x, m.a.y, m.b.x, m.b.y],
      stroke: '#e0c068', strokeWidth: 3, dash: [10, 6],
    });
    const dotA = new Konva.Circle({ x: m.a.x, y: m.a.y, radius: 4, fill: '#e0c068' });
    const dotB = new Konva.Circle({ x: m.b.x, y: m.b.y, radius: 4, fill: '#e0c068' });
    group.add(line, dotA, dotB);
    layer.add(group);
    layer.batchDraw();
    this.measurements.push(m);
    this._emit('measure:add', m);
    return group;
  }

  applyMeasurement(m) {
    const { Konva } = this;
    const layer = this.layers.overlay;
    const group = new Konva.Group({ id: m.id, listening: false });
    group.add(new Konva.Line({ points: [m.a.x, m.a.y, m.b.x, m.b.y], stroke: '#e0c068', strokeWidth: 3, dash: [10, 6] }));
    group.add(new Konva.Circle({ x: m.a.x, y: m.a.y, radius: 4, fill: '#e0c068' }));
    group.add(new Konva.Circle({ x: m.b.x, y: m.b.y, radius: 4, fill: '#e0c068' }));
    layer.add(group);
    layer.batchDraw();
    this.measurements.push(m);
  }

  removeMeasurement(id) {
    const node = this.layers.overlay.findOne('#' + id);
    if (node) { node.destroy(); this.layers.overlay.batchDraw(); }
    this.measurements = this.measurements.filter((m) => m.id !== id);
    this._emit('measure:remove', { id });
  }

  clearMeasurements() {
    for (const m of [...this.measurements]) this.removeMeasurement(m.id);
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
