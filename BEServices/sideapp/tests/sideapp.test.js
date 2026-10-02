/**
 * Automated Test Suite for SideApp Backend and Protocol
 * Covers unit tests for protocol, patch, setByPath, sessionStore, and end-to-end integration tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
  ERROR_CODES,
  createEnvelope,
  validateEnvelope,
  computePatch,
  setByPath
} from '../protocol.js';
import { SessionStore } from '../sessionStore.js';
import { WsHub } from '../wsHub.js';
import { createSideAppRouter, getLocalIpAddress } from '../index.js';

// ============================================================================
// 1. Protocol & Diff Unit Tests
// ============================================================================
test('Protocol: createEnvelope and validateEnvelope', () => {
  const env = createEnvelope(MESSAGE_TYPES.RENDER_FULL, { view: 'test' }, 42);
  assert.equal(env.seq, 42);
  assert.equal(env.type, 'render.full');
  assert.equal(env.protocolVersion, PROTOCOL_VERSION);
  assert.equal(env.payload.view, 'test');
  assert.ok(env.timestamp > 0);

  const valRes = validateEnvelope(env);
  assert.equal(valRes.valid, true);

  // Incompatible version
  const badVerEnv = { ...env, protocolVersion: '2.0' };
  assert.equal(validateEnvelope(badVerEnv).valid, false);

  // Missing type
  assert.equal(validateEnvelope({ seq: 1 }).valid, false);
});

test('Protocol: computePatch generates accurate diff ops', () => {
  // 1. No change -> empty ops
  const s1 = { count: 10, user: { name: 'Alex' } };
  const s2 = { count: 10, user: { name: 'Alex' } };
  assert.deepEqual(computePatch(s1, s2), []);

  // 2. Primitive change
  const s3 = { count: 11, user: { name: 'Alex' } };
  const ops1 = computePatch(s1, s3);
  assert.equal(ops1.length, 1);
  assert.equal(ops1[0].path, 'count');
  assert.equal(ops1[0].value, 11);

  // 3. Nested object change
  const s4 = { count: 10, user: { name: 'John', role: 'admin' } };
  const ops2 = computePatch(s1, s4);
  const pathMap = Object.fromEntries(ops2.map(o => [o.path, o.value]));
  assert.equal(pathMap['user.name'], 'John');
  assert.equal(pathMap['user.role'], 'admin');

  // 4. Array change
  const a1 = { items: [1, 2, 3] };
  const a2 = { items: [1, 5, 3] };
  const aOps = computePatch(a1, a2);
  assert.equal(aOps.length, 1);
  assert.equal(aOps[0].path, 'items');
  assert.deepEqual(aOps[0].value, [1, 5, 3]);
});

test('Protocol: setByPath mutates target object correctly', () => {
  const obj = { user: { name: 'Alex' }, scores: [10, 20] };

  // Update nested property
  setByPath(obj, 'user.name', 'Bob');
  assert.equal(obj.user.name, 'Bob');

  // Add new deep property
  setByPath(obj, 'settings.audio.volume', 0.8);
  assert.equal(obj.settings.audio.volume, 0.8);

  // Update array element
  setByPath(obj, 'scores[1]', 99);
  assert.equal(obj.scores[1], 99);

  // Deletion with undefined
  setByPath(obj, 'user.name', undefined);
  assert.equal('name' in obj.user, false);
});

// ============================================================================
// 2. SessionStore Unit Tests
// ============================================================================
test('SessionStore: session lifecycle and pairing code verification', () => {
  const store = new SessionStore();

  const session = store.createSession({ deviceName: 'iMac Test' });
  assert.ok(session.sessionId.startsWith('sess_'));
  assert.ok(session.pairingCode.length === 4);
  assert.ok(session.token.startsWith('tok_'));

  // Pair with correct code
  const pairRes = store.pairCode(session.pairingCode);
  assert.ok(pairRes);
  assert.equal(pairRes.sessionId, session.sessionId);
  assert.ok(pairRes.token);

  // Validate paired client token
  assert.equal(store.validateToken(session.sessionId, pairRes.token), true);
  // Validate master token
  assert.equal(store.validateToken(session.sessionId, session.token), true);
  // Validate fake token
  assert.equal(store.validateToken(session.sessionId, 'tok_fake'), false);

  // Pair with invalid code
  assert.equal(store.pairCode('XXXX'), null);

  // Client tracking
  store.addClient(session.sessionId, 'client_1', { ip: '192.168.1.50' });
  const clients = store.getClientList(session.sessionId);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].ip, '192.168.1.50');

  store.removeClient(session.sessionId, 'client_1');
  assert.equal(store.getClientList(session.sessionId).length, 0);

  // Snapshot cache
  store.updateSnapshot(session.sessionId, { view: 'test', count: 1 });
  assert.deepEqual(store.getSnapshot(session.sessionId), { view: 'test', count: 1 });

  // Close session
  store.closeSession(session.sessionId);
  assert.equal(store.getSession(session.sessionId), null);
  assert.equal(store.pairCode(session.pairingCode), null);

  store.destroy();
});

// ============================================================================
// 3. End-to-End HTTP + WebSocket Integration Tests
// ============================================================================
test('SideApp Integration: HTTP APIs, WS Connect, Broadcast, Reconnect and Master Close', async () => {
  const TEST_PORT = 3992;
  const app = express();
  app.use(express.json());

  const testStore = new SessionStore();
  const testHub = new WsHub();
  // Override store in hub for testing
  testHub.sessionStore = testStore;

  const router = express.Router();
  router.post('/sideapp/session', (req, res) => {
    const session = testStore.createSession({ deviceName: req.body.deviceName || 'iMac' });
    res.json({
      sessionId: session.sessionId,
      pairingCode: session.pairingCode,
      token: session.token,
      wsUrl: `ws://127.0.0.1:${TEST_PORT}/sideapp/ws`
    });
  });

  router.get('/sideapp/pair/:code', (req, res) => {
    const pair = testStore.pairCode(req.params.code);
    if (!pair) return res.status(404).json({ error: 'Invalid' });
    res.json(pair);
  });

  router.post('/sideapp/broadcast', (req, res) => {
    const clientCount = testHub.broadcast(req.body.sessionId, req.body.message);
    res.json({ success: true, clientCount });
  });

  router.post('/sideapp/session/:sessionId/close', (req, res) => {
    testHub.closeSession(req.params.sessionId);
    testStore.closeSession(req.params.sessionId);
    res.json({ success: true });
  });

  app.use(router);

  const server = http.createServer(app);
  server.on('upgrade', (req, socket, head) => {
    const parsed = new URL(req.url, `http://127.0.0.1:${TEST_PORT}`);
    const sessionId = parsed.searchParams.get('session');
    const token = parsed.searchParams.get('token');

    if (!sessionId || !token || !testStore.validateToken(sessionId, token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    testHub.wss.handleUpgrade(req, socket, head, (ws) => {
      testHub.wss.emit('connection', ws, req, { sessionId, token });
    });
  });

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));

  try {
    // 1. Create Session
    const sessRes = await fetch(`http://127.0.0.1:${TEST_PORT}/sideapp/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceName: 'iMac Test' })
    }).then(r => r.json());

    assert.ok(sessRes.sessionId);
    assert.ok(sessRes.pairingCode);

    // 2. Pair with Code
    const pairRes = await fetch(`http://127.0.0.1:${TEST_PORT}/sideapp/pair/${sessRes.pairingCode}`).then(r => r.json());
    assert.equal(pairRes.sessionId, sessRes.sessionId);
    assert.ok(pairRes.token);

    // 3. Connect WebSocket with valid token
    const wsUrl = `ws://127.0.0.1:${TEST_PORT}/sideapp/ws?session=${pairRes.sessionId}&token=${pairRes.token}`;
    const ws = new WebSocket(wsUrl);

    const receivedMessages = [];
    ws.on('message', (data) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Wait for welcome message and initial render.full snapshot
    await new Promise(r => setTimeout(r, 80));
    assert.ok(receivedMessages.length >= 2);
    assert.equal(receivedMessages[0].type, 'session.welcome');
    assert.equal(receivedMessages[0].payload.sessionId, sessRes.sessionId);
    assert.equal(receivedMessages[1].type, 'render.full');
    assert.equal(receivedMessages[1].payload.view, 'viewSelection');

    // 4. Broadcast render.full
    await fetch(`http://127.0.0.1:${TEST_PORT}/sideapp/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessRes.sessionId,
        message: {
          type: 'render.full',
          payload: { view: 'viewSession', state: { word: 'สวัสดี' } }
        }
      })
    });

    await new Promise(r => setTimeout(r, 80));
    const fullMsgs = receivedMessages.filter(m => m.type === 'render.full');
    assert.ok(fullMsgs.length >= 2);
    const latestFullMsg = fullMsgs[fullMsgs.length - 1];
    assert.equal(latestFullMsg.payload.view, 'viewSession');
    assert.equal(latestFullMsg.payload.state.word, 'สวัสดี');

    // 5. Broadcast render.patch
    await fetch(`http://127.0.0.1:${TEST_PORT}/sideapp/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessRes.sessionId,
        message: {
          type: 'render.patch',
          payload: { ops: [{ path: 'phase', value: 'revealed' }] }
        }
      })
    });

    await new Promise(r => setTimeout(r, 80));
    const patchMsg = receivedMessages.find(m => m.type === 'render.patch');
    assert.ok(patchMsg);
    assert.equal(patchMsg.payload.ops[0].path, 'phase');

    // 5.5 Test Core Words session broadcast & detailRevealed incremental patch
    const initialCoreState = {
      appType: 'core_words',
      currentIndex: 1,
      totalWords: 10,
      detailRevealed: false,
      word: { id: 'cw_001', word: 'ภูมิฐาน', ipa: '/pʰuːm˧.tʰaːn˩˩˦/' }
    };

    await fetch(`http://127.0.0.1:${TEST_PORT}/sideapp/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessRes.sessionId,
        message: {
          type: 'render.full',
          payload: {
            view: 'viewCoreWordsSession',
            state: initialCoreState,
            meta: { title: 'ThaiNotes 伴侣屏 · 核心词汇复习' }
          }
        }
      })
    });

    await new Promise(r => setTimeout(r, 80));
    const coreFullMsg = receivedMessages.filter(m => m.type === 'render.full').pop();
    assert.ok(coreFullMsg);
    assert.equal(coreFullMsg.payload.view, 'viewCoreWordsSession');
    assert.equal(coreFullMsg.payload.state.detailRevealed, false);
    assert.equal(coreFullMsg.payload.state.word.word, 'ภูมิฐาน');

    // Reveal command from master UI
    const revealedCoreState = { ...initialCoreState, detailRevealed: true };
    const corePatchOps = computePatch(initialCoreState, revealedCoreState);
    assert.equal(corePatchOps.length, 1);
    assert.equal(corePatchOps[0].path, 'detailRevealed');
    assert.equal(corePatchOps[0].value, true);

    await fetch(`http://127.0.0.1:${TEST_PORT}/sideapp/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessRes.sessionId,
        message: {
          type: 'render.patch',
          payload: { ops: corePatchOps }
        }
      })
    });

    await new Promise(r => setTimeout(r, 80));
    const corePatchMsg = receivedMessages.filter(m => m.type === 'render.patch').pop();
    assert.ok(corePatchMsg);
    assert.equal(corePatchMsg.payload.ops[0].path, 'detailRevealed');
    assert.equal(corePatchMsg.payload.ops[0].value, true);

    // 6. Test unauthorized connection rejection
    const badWs = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/sideapp/ws?session=${sessRes.sessionId}&token=fake_token`);
    let badWsRejected = false;
    badWs.on('error', () => { badWsRejected = true; });
    await new Promise(r => setTimeout(r, 80));
    assert.equal(badWsRejected, true);

    // 7. Master closes session
    await fetch(`http://127.0.0.1:${TEST_PORT}/sideapp/session/${sessRes.sessionId}/close`, {
      method: 'POST'
    });

    await new Promise(r => setTimeout(r, 80));
    const errorMsg = receivedMessages.find(m => m.type === 'session.error');
    assert.ok(errorMsg);
    assert.equal(errorMsg.payload.code, 'MASTER_CLOSED');

    ws.close();
  } finally {
    testHub.destroy();
    testStore.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});
