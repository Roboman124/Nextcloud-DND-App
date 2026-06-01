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

    this._buildLights();
    this._buildGround();
    this._clock = new THREE.Clock();
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
    this.ground.material.map = tex;
    this.ground.material.color.set(0xffffff);
    this.ground.material.needsUpdate = true;
  }

  /** Serialize the 3D scene to a plain object for persistence. */
  serialize() {
    return {
      mapUrl: this._mapUrl || null,
      tokens: [...this.tokens.values()].map((e) => ({ ...e.data })),
      blocks: [...(this.blocks?.values() || [])].map((b) => ({ ...b.data })),
    };
  }

  /**
   * Add or update a token. data = {id, kind:'model'|'primitive', url?, color?,
   * x, z, rotation, scale, label}. Models load async; primitives are instant.
   */
  async upsertToken(data) {
    const { THREE } = this;
    let entry = this.tokens.get(data.id);
    if (!entry) {
      let mesh;
      if (data.kind === 'model' && data.url && this.gltfLoader) {
        try {
          const gltf = await this.gltfLoader.loadAsync(data.url);
          mesh = gltf.scene;
          mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          // Normalise scale: fit the model into roughly a 2-unit cube so wildly
          // different glTF export scales don't appear as a dot or a giant.
          const box = new THREE.Box3().setFromObject(mesh);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          if (maxDim > 0) mesh.scale.multiplyScalar(2 / maxDim);
        } catch (err) {
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
      entry = { mesh, data };
      this.tokens.set(data.id, entry);
    }
    const m = entry.mesh;
    m.position.set(data.x || 0, (data.y || 0) + 0.9, data.z || 0);
    m.rotation.y = data.rotation || 0;
    // Only apply explicit scale to primitives / failed placeholders; loaded
    // models are already normalised above.
    if (!(entry.mesh.userData && entry.mesh.children?.length && data.kind === 'model' && !entry.mesh.userData.loadFailed)) {
      const s = data.scale || 1;
      if (data.kind !== 'model' || entry.mesh.userData.loadFailed) m.scale.setScalar(s);
    }
    entry.data = data;
    return entry;
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

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  /** Per-frame update. Returns dt so callers (DiceRoller) can share it. */
  render() {
    const dt = this._clock.getDelta();
    this.world.step(1 / 60, dt, 3);
    if (this.controls) this.controls.update();
    this.renderer.render(this.scene, this.camera);
    return dt;
  }
}
