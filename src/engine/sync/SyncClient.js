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
 */
export class SyncClient {
  constructor({ url, roomToken, userId, sceneId, onMessage, onPresence }) {
    this.url = url;
    this.roomToken = roomToken;
    this.userId = userId;
    this.sceneId = sceneId;
    this.onMessage = onMessage || (() => {});
    this.onPresence = onPresence || (() => {});
    this.queue = [];
    this.connected = false;
    this._backoff = 500;
    this._mode = url ? 'ws' : 'poll'; // no relay url -> long-poll immediately
  }

  connect() {
    // With no relay URL, go straight to the polling transport.
    if (this._mode === 'poll') return this._fallbackPoll();
    try {
      this.ws = new WebSocket(`${this.url}?token=${encodeURIComponent(this.roomToken)}`);
    } catch (e) {
      return this._fallbackPoll();
    }
    this.ws.onopen = () => {
      this.connected = true;
      this._backoff = 500;
      this.send({ type: 'join', payload: { userId: this.userId } });
      // flush anything queued while offline
      for (const m of this.queue) this._raw(m);
      this.queue = [];
    };
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'presence') this.onPresence(msg.payload);
      else this.onMessage(msg);
    };
    this.ws.onclose = () => {
      this.connected = false;
      setTimeout(() => this.connect(), this._backoff);
      this._backoff = Math.min(this._backoff * 2, 8000);
    };
    this.ws.onerror = () => this.ws.close();
  }

  send(msg) {
    const full = { ...msg, from: this.userId, t: Date.now() };
    if (this._mode === 'poll') return this._push(full);
    if (this.connected) this._raw(full);
    else this.queue.push(full);
  }

  _raw(msg) {
    try { this.ws.send(JSON.stringify(msg)); }
    catch { this.queue.push(msg); }
  }

  /** Send a message via the Nextcloud push endpoint (polling transport). */
  async _push(msg) {
    try {
      await fetch('/index.php/apps/grimoire/api/room/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'OCS-APIRequest': 'true', requesttoken: window.OC?.requestToken || '' },
        body: JSON.stringify({ sceneId: this.sceneId, type: msg.type, payload: msg.payload }),
      });
    } catch { /* best-effort; next change will retry */ }
  }

  /** Degraded mode: poll Nextcloud's API when no relay is reachable. */
  async _fallbackPoll() {
    this._polling = true;
    this.connected = true; // "connected" in the sense that send() works via push
    let cursor = 0;
    const tick = async () => {
      if (!this._polling) return;
      try {
        const res = await fetch(
          `/index.php/apps/grimoire/api/room/poll?sceneId=${this.sceneId}&since=${cursor}`,
          { headers: { 'OCS-APIRequest': 'true', requesttoken: window.OC?.requestToken || '' } }
        );
        const data = await res.json();
        for (const m of data.messages || []) {
          // Don't echo our own messages back to us.
          if (m.from === this.userId) continue;
          if (m.type === 'presence') this.onPresence(m.payload);
          else this.onMessage(m);
        }
        cursor = data.cursor || cursor;
      } catch { /* keep trying */ }
      setTimeout(tick, 1000);
    };
    // Announce presence so others (and the Discord join hook) see us.
    this._push({ type: 'join', payload: { userId: this.userId }, from: this.userId });
    tick();
  }

  disconnect() {
    this._polling = false;
    this.ws?.close();
  }
}
