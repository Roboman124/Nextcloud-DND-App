/**
 * SyncClient — real-time multiplayer transport.
 *
 * Owlbear-style live rooms need low-latency fan-out of small messages (token
 * moved, pointer at X, dice rolled). Nextcloud's PHP request model isn't built
 * for persistent sockets, so Grimoire ships a tiny standalone WebSocket relay
 * (see server/ in ARCHITECTURE.md) that the PHP app authenticates against with
 * a short-lived room token. If the relay is unavailable, this client falls
 * back to long-polling the Nextcloud OCS endpoint so the room still works,
 * just laggier.
 *
 * Messages are authoritative-last-write for transient state (pointers) and are
 * persisted by the backend for durable state (token positions, scene items).
 *
 * The engine layer must not know Nextcloud URL shapes, so the polling endpoints
 * are built through an injected `apiUrl(path)` (see Room.vue); the default only
 * exists as a standalone fallback.
 */
export class SyncClient {
  constructor({ url, roomToken, userId, sceneId, onMessage, onPresence, apiUrl }) {
    this.url = url;
    this.roomToken = roomToken;
    this.userId = userId;
    this.sceneId = sceneId;
    this.onMessage = onMessage || (() => {});
    this.onPresence = onPresence || (() => {});
    this.apiUrl = apiUrl || ((p) => '/index.php' + p);
    this.queue = [];
    this.connected = false;
    this._backoff = 500;
    this._fails = 0;
    this._closed = false;
    this._mode = url ? 'ws' : 'poll'; // no relay url -> long-poll immediately
    this._throttle = new Map(); // type -> last-sent timestamp (transient msgs)
  }

  connect() {
    this._closed = false;
    // With no relay URL, go straight to the polling transport.
    if (this._mode === 'poll') return this._fallbackPoll();
    try {
      this.ws = new WebSocket(`${this.url}?token=${encodeURIComponent(this.roomToken)}`);
    } catch (e) {
      // Unreachable/bad relay URL: fall back to polling instead of dying.
      return this._fallbackPoll();
    }
    this.ws.onopen = () => {
      this.connected = true;
      this._backoff = 500;
      this._fails = 0;
      this.send({ type: 'join', payload: { userId: this.userId } });
      // flush anything queued while offline
      for (const m of this.queue) this._raw(m);
      this.queue = [];
    };
    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; } // ignore bad frames
      if (msg.type === 'presence') this.onPresence(msg.payload);
      else this.onMessage(msg);
    };
    this.ws.onclose = (e) => {
      this.connected = false;
      if (this._closed) return; // deliberate disconnect — do NOT reconnect
      // A relay that never answers (or rejects the token) would otherwise
      // retry forever and the room would stay dead; degrade to long-poll
      // after a few failed attempts so multiplayer keeps working.
      this._fails += 1;
      if (this._fails >= 3 || e?.code === 4001) {
        this._mode = 'poll';
        return this._fallbackPoll();
      }
      setTimeout(() => { if (!this._closed) this.connect(); }, this._backoff);
      this._backoff = Math.min(this._backoff * 2, 8000);
    };
    this.ws.onerror = () => this.ws?.close();
  }

  send(msg) {
    const full = { ...msg, from: this.userId, t: Date.now() };
    // High-frequency transient streams (pointer trails, fog brushing) can fire
    // per mouse-move. Coalesce them: keep the latest per type and emit at most
    // ~12/s. With the polling transport this is the difference between a few
    // requests a second and dozens of POSTs per second.
    if (TRANSIENT_TYPES.has(msg.type)) return this._sendThrottled(full);
    this._deliver(full);
  }

  _deliver(full) {
    if (this._mode === 'poll') return this._push(full);
    if (this.connected) this._raw(full);
    else this.queue.push(full);
  }

  _sendThrottled(full) {
    const last = this._throttle.get(full.type) || 0;
    const now = Date.now();
    if (now - last >= THROTTLE_MS) {
      this._throttle.set(full.type, now);
      this._deliver(full);
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
          this._deliver(pending);
        }
      }, THROTTLE_MS));
    }
  }

  _raw(msg) {
    try { this.ws.send(JSON.stringify(msg)); }
    catch { this.queue.push(msg); }
  }

  /** Send a message via the Nextcloud push endpoint (polling transport). */
  async _push(msg) {
    try {
      await fetch(this.apiUrl('/apps/grimoire/api/room/push'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'OCS-APIRequest': 'true', requesttoken: window.OC?.requestToken || '' },
        body: JSON.stringify({ sceneId: this.sceneId, type: msg.type, payload: msg.payload }),
      });
    } catch { /* best-effort; next change will retry */ }
  }

  /** Degraded mode: poll Nextcloud's API when no relay is reachable. */
  async _fallbackPoll() {
    if (this._polling) return; // never run two poll loops
    this._polling = true;
    this.connected = true; // "connected" in the sense that send() works via push
    let cursor = 0;
    const tick = async () => {
      if (!this._polling || this._closed) return;
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
          for (const m of data.messages || []) {
            // Don't echo our own messages back to us.
            if (m.from === this.userId) continue;
            if (m.type === 'presence') this.onPresence(m.payload);
            else this.onMessage(m);
          }
          cursor = data.cursor || cursor;
        }
      } catch { /* keep trying */ }
      setTimeout(tick, 1000);
    };
    // Announce presence so others (and the Discord join hook) see us.
    this._push({ type: 'join', payload: { userId: this.userId }, from: this.userId });
    tick();
  }

  disconnect() {
    this._closed = true;
    this._polling = false;
    this.connected = false;
    this.ws?.close();
    this.ws = null;
    for (const [k, v] of this._throttle) {
      if (k.endsWith(':timer')) clearTimeout(v);
    }
    this._throttle.clear();
    this.queue = [];
  }
}

const THROTTLE_MS = 80;
// Only pure positional streams may be coalesced (last-write-wins). Discrete
// events like fog:paint must all arrive — each one is a brush dab that shapes
// the mask — so they are never throttled.
const TRANSIENT_TYPES = new Set(['pointer:move']);
