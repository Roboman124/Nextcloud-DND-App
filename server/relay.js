/**
 * Grimoire relay — a tiny standalone WebSocket fan-out server for live rooms.
 *
 * Design (see ARCHITECTURE.md §"Real-time sync"):
 *  - This server is deliberately DUMB. It does not understand scene state,
 *    tokens, or dice. It authenticates a connection by room token, then
 *    fans every message out to the other members of the same room.
 *  - Durable state (token positions, the scene graph) is owned by the
 *    Nextcloud PHP app and persisted there; this relay only carries the
 *    low-latency transient stream so the table feels live.
 *  - Tokens are minted by the PHP app (RoomController, roadmap) and handed to
 *    the browser, which connects here with ?token=<roomToken>. In this
 *    reference build the token format is "<roomId>.<userId>.<sig>"; verify the
 *    signature against the same shared secret the PHP app signs with. Until
 *    RoomController lands, set GRIMOIRE_DEV_TRUST=1 to accept "<roomId>.<userId>"
 *    unsigned for local development.
 *
 * Run:  GRIMOIRE_RELAY_SECRET=changeme node server/relay.js
 * Env:  PORT (default 8787), GRIMOIRE_RELAY_SECRET, GRIMOIRE_DEV_TRUST
 *
 * Protocol (matches src/engine/sync/SyncClient.js):
 *  - Client -> server: {type, payload, from, t}
 *  - First client message after open is {type:'join', payload:{userId}}
 *  - Server -> client: same message objects, fanned out to other room members
 *  - Server -> client: {type:'presence', payload:[userId, ...]} on join/leave
 */
'use strict';

const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.GRIMOIRE_RELAY_SECRET || '';
const DEV_TRUST = process.env.GRIMOIRE_DEV_TRUST === '1';

/** roomId -> Set<ws> */
const rooms = new Map();

/** Constant-time HMAC check of a "<roomId>.<userId>.<sig>" token. */
function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (DEV_TRUST && parts.length === 2) {
    const [roomId, userId] = parts;
    return { roomId, userId };
  }
  if (parts.length !== 3) return null;
  const [roomId, userId, sig] = parts;
  if (!SECRET) return null;
  const expected = crypto
    .createHmac('sha256', SECRET)
    .update(`${roomId}.${userId}`)
    .digest('hex')
    .slice(0, 32);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { roomId, userId };
}

function presenceOf(roomId) {
  const set = rooms.get(roomId);
  if (!set) return [];
  return [...set].map((c) => c.userId).filter(Boolean);
}

function broadcast(roomId, fromWs, obj) {
  const set = rooms.get(roomId);
  if (!set) return;
  const data = JSON.stringify(obj);
  for (const client of set) {
    if (client !== fromWs && client.readyState === client.OPEN) {
      client.send(data);
    }
  }
}

function emitPresence(roomId) {
  const set = rooms.get(roomId);
  if (!set) return;
  const msg = JSON.stringify({ type: 'presence', payload: presenceOf(roomId) });
  for (const client of set) {
    if (client.readyState === client.OPEN) client.send(msg);
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const auth = verifyToken(url.searchParams.get('token'));
  if (!auth) {
    ws.close(4001, 'unauthorized');
    return;
  }

  ws.roomId = auth.roomId;
  ws.userId = auth.userId;

  let set = rooms.get(auth.roomId);
  if (!set) {
    set = new Set();
    rooms.set(auth.roomId, set);
  }
  set.add(ws);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignore malformed frames
    }
    // Trust the authenticated identity, not whatever the client claims.
    msg.from = ws.userId;
    if (msg.type === 'join') {
      if (msg.payload && typeof msg.payload === 'object') {
        msg.payload.userId = ws.userId;
      }
      emitPresence(ws.roomId);
      return;
    }
    broadcast(ws.roomId, ws, msg);
  });

  ws.on('close', () => {
    const s = rooms.get(ws.roomId);
    if (s) {
      s.delete(ws);
      if (s.size === 0) rooms.delete(ws.roomId);
      else emitPresence(ws.roomId);
    }
  });

  ws.on('error', () => ws.close());
});

wss.on('listening', () => {
  // eslint-disable-next-line no-console
  console.log(
    `[grimoire-relay] listening on ws://localhost:${PORT}` +
      (DEV_TRUST ? '  (DEV_TRUST: accepting unsigned tokens)' : '')
  );
  if (!SECRET && !DEV_TRUST) {
    // eslint-disable-next-line no-console
    console.warn(
      '[grimoire-relay] No GRIMOIRE_RELAY_SECRET set and DEV_TRUST off — ' +
        'all connections will be rejected. Set one of them.'
    );
  }
});
