/**
 * SyncClient — real-time multiplayer transport.
 *
 * Grimoire rooms use exactly ONE transport: the Nextcloud app itself. Small
 * messages (token moved, pointer at X, dice rolled, fog/draw strokes) are
 * POSTed to the app's room endpoint and picked up by a 1 s poll loop; the
 * server fans them out through Nextcloud's distributed cache (Redis/APCu) and
 * enforces every permission check before accepting a push. There is no
 * separate relay process and no shared secret to configure.
 *
 * Messages are authoritative-last-write for transient state (pointers) and are
 * persisted by the backend for durable state (token positions, scene items).
 *
 * The engine layer must not know Nextcloud URL shapes, so the endpoints are
 * built through an injected `apiUrl(path)` (see Room.vue).
 */
export class SyncClient {
  constructor({ sceneId, userId, apiUrl, onMessage, onPresence }) {
    this.sceneId = sceneId;
    this.userId = userId;
    this.onMessage = onMessage || (() => {});
    this.onPresence = onPresence || (() => {});
    this.apiUrl = apiUrl || ((p) => '/index.php' + p);
    this.connected = false;
    this._closed = false;
    this._throttle = new Map(); // type -> last-sent timestamp (transient msgs)
    /** userId -> last time we saw any traffic from them (presence). */
    this._seen = new Map();
    this._lastBeat = 0;
    this._firstBatch = true;
    this._connectedAt = 0;
  }

  connect() {
    if (this._closed) return;
    this._closed = false;
    this.connected = true; // send() works via push
    this._connectedAt = Date.now();
    this._firstBatch = true;
    this._seen.set(this.userId, this._connectedAt);
    // Announce presence so others (and the Discord join hook) see us.
    this._push({ type: 'join', payload: { userId: this.userId } });
    this._tick(0);
  }

  async _tick(cursor) {
    if (this._closed) return;
    try {
      const res = await fetch(
        `${this.apiUrl('/apps/grimoire/api/room/poll')}?sceneId=${encodeURIComponent(this.sceneId)}&since=${cursor}`,
        { headers: { 'OCS-APIRequest': 'true', requesttoken: window.OC?.requestToken || '' } }
      );
      const data = await res.json();
      if (data.reset) {
        // Server buffer was cleared/expired; resync cursor, don't replay.
        cursor = data.cursor || 0;
      } else {
        const now = Date.now();
        for (const m of data.messages || []) {
          // Don't echo our own messages back to us — but do count them for
          // presence/activity bookkeeping below.
          if (m?.from) this._seen.set(m.from, Math.min(now, Number(m.t) || now));
          if (m?.from === this.userId) continue;
          // First batch after connecting: skip messages that predate the join
          // (the cached window may hold old draw/fog strokes; re-applying them
          // would double-draw).
          if (this._firstBatch && Number(m?.t) < this._connectedAt - 2000) continue;
          if (m?.type === 'presence') this.onPresence(m.payload);
          else this.onMessage(m);
        }
        this._firstBatch = false;
        cursor = data.cursor ?? cursor;
      }
    } catch { /* keep trying */ }

    if (this._closed) return;
    this._emitPresence();
    // Heartbeat so others keep seeing us (and we keep seeing them) while idle.
    if (Date.now() - this._lastBeat > PRESENCE_BEAT_MS) {
      this._lastBeat = Date.now();
      this._push({ type: 'presence:beat', payload: {} });
    }
    setTimeout(() => this._tick(cursor), POLL_MS);
  }

  /** Users active within the presence window (excluding ourselves). */
  _emitPresence() {
    const cutoff = Date.now() - PRESENCE_WINDOW_MS;
    const active = [];
    for (const [uid, t] of this._seen) {
      if (t >= cutoff) active.push(uid);
      else this._seen.delete(uid);
    }
    this.onPresence(active.filter((uid) => uid !== this.userId));
  }

  send(msg) {
    const full = { ...msg, from: this.userId, t: Date.now() };
    // High-frequency transient streams (pointer trails) can fire per
    // mouse-move. Coalesce them: keep the latest per type and emit at most
    // ~12/s — with polling, that's the difference between a few requests a
    // second and dozens of POSTs per second.
    if (TRANSIENT_TYPES.has(msg.type)) return this._sendThrottled(full);
    this._push(full);
  }

  _sendThrottled(full) {
    const last = this._throttle.get(full.type) || 0;
    const now = Date.now();
    if (now - last >= THROTTLE_MS) {
      this._throttle.set(full.type, now);
      this._push(full);
      return;
    }
    // Trailing send: always deliver the *latest* position after the window.
    this._throttle.set(full.type + ':pending', full);
    if (!this._throttle.has(full.type + ':timer')) {
      this._throttle.set(full.type + ':timer', setTimeout(() => {
        this._throttle.delete(full.type + ':timer');
        const pending = this._throttle.get(full.type + ':pending');
        if (pending) {
          this._throttle.delete(full.type + ':pending');
          this._throttle.set(full.type, Date.now());
          this._push(pending);
        }
      }, THROTTLE_MS));
    }
  }

  /** Send a message via the Nextcloud push endpoint. */
  async _push(msg) {
    try {
      await fetch(this.apiUrl('/apps/grimoire/api/room/push'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'OCS-APIRequest': 'true', requesttoken: window.OC?.requestToken || '' },
        body: JSON.stringify({ sceneId: this.sceneId, type: msg.type, payload: msg.payload }),
      });
    } catch { /* best-effort; the next tick/change will retry */ }
  }

  disconnect() {
    this._closed = true;
    this.connected = false;
    for (const [k, v] of this._throttle) {
      if (k.endsWith(':timer')) clearTimeout(v);
    }
    this._throttle.clear();
    this._seen.clear();
  }
}

const POLL_MS = 1000;             // poll interval (short-poll)
const THROTTLE_MS = 80;           // per-type coalescing window for transients
const PRESENCE_BEAT_MS = 30000;   // idle heartbeat while sitting in a room
const PRESENCE_WINDOW_MS = 45000; // a peer counts as present if seen this recently
// Only pure positional streams may be coalesced (last-write-wins). Discrete
// events like fog:paint must all arrive — each one is a brush dab that shapes
// the mask — so they are never throttled.
const TRANSIENT_TYPES = new Set(['pointer:move']);
