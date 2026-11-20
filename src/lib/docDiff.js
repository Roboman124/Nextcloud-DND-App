/**
 * Scene-document diffing for saves.
 *
 * A save must carry what the client CHANGED, not everything it happens to be
 * holding: sending whole arrays lets a client that hasn't seen the latest
 * changes silently roll them back (the "blind save" lost-update). The diff is
 * computed against the document as it was loaded (or last saved) and merged
 * item-by-item server-side.
 */

/** Stable compare form: object keys sorted recursively. */
export function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}

/** Deep equality that treats a missing key and an explicit null as the same. */
export function equalDoc(a, b) {
  return JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
}

const isIdList = (arr) => Array.isArray(arr)
  && arr.every((e) => e && typeof e === 'object' && typeof e.id === 'string');

/**
 * Diff two scene documents into SceneController's patch shape:
 *   items:  id-listed arrays -> { set: [changedOrNew entries], remove: [ids] }
 *   values: other changed keys -> the whole new value (null clears)
 *   drop:   keys that vanished entirely
 */
export function diffDoc(base, doc) {
  const patch = { items: {}, values: {}, drop: [] };
  const b0 = base || {};
  const d0 = doc || {};
  for (const key of new Set([...Object.keys(b0), ...Object.keys(d0)])) {
    const b = b0[key];
    const c = d0[key];
    if (equalDoc(b, c)) continue;
    if (!(key in d0)) { patch.drop.push(key); continue; }

    const baseList = b == null ? [] : b;
    if (isIdList(baseList) && isIdList(c)) {
      const baseById = new Map(baseList.map((e) => [e.id, e]));
      const curById = new Map(c.map((e) => [e.id, e]));
      const set = c.filter((e) => !baseById.has(e.id) || !equalDoc(baseById.get(e.id), e));
      const remove = baseList.filter((e) => !curById.has(e.id)).map((e) => e.id);
      if (set.length || remove.length) patch.items[key] = { set, remove };
    } else {
      patch.values[key] = c;
    }
  }
  return patch;
}

/** Deep clone for keeping a pristine base copy of the loaded document. */
export function cloneDoc(v) {
  return JSON.parse(JSON.stringify(v ?? null));
}
