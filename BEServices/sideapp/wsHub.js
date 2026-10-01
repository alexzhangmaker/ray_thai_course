/**
 * SideApp WebSocket Hub
 * Manages WebSocket connections for SideApp sessions, handles authentication, welcome handshakes,
 * heartbeat monitoring, and one-way instruction broadcasting.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { parse as parseUrl } from 'url';
import {
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
  ERROR_CODES,
  createEnvelope,
  validateEnvelope,
  setByPath
} from './protocol.js';
import { sessionStore } from './sessionStore.js';

export class WsHub {
  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
    this.sessionSockets = new Map(); // sessionId -> Set<WebSocket>
    this.sessionSeq = new Map(); // sessionId -> number

    this.wss.on('connection', (ws, req, authData) => {
      this.handleConnection(ws, req, authData);
    });

    // Heartbeat check every 25 seconds
    this.heartbeatInterval = setInterval(() => {
      this.checkHeartbeats();
    }, 25000);
    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  /**
   * Generates next sequence number for a session.
   * @param {string} sessionId 
   * @returns {number}
   */
  nextSeq(sessionId) {
    const current = this.sessionSeq.get(sessionId) || 0;
    const next = current + 1;
    this.sessionSeq.set(sessionId, next);
    return next;
  }

  /**
   * Handles HTTP Upgrade request for /sideapp/ws.
   * @param {import('http').IncomingMessage} request 
   * @param {import('stream').Duplex} socket 
   * @param {Buffer} head 
   * @returns {boolean} Whether upgrade was handled
   */
  handleUpgrade(request, socket, head) {
    const parsed = parseUrl(request.url, true);
    if (parsed.pathname !== '/sideapp/ws') {
      return false;
    }

    const sessionId = parsed.query.session || parsed.query.sessionId;
    const token = parsed.query.token;

    if (!sessionId || !token || !sessionStore.validateToken(sessionId, token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request, { sessionId, token });
    });
    return true;
  }

  /**
   * Initializes a newly connected WebSocket client.
   * @param {WebSocket} ws 
   * @param {import('http').IncomingMessage} req 
   * @param {{ sessionId: string, token: string }} authData 
   */
  handleConnection(ws, req, { sessionId, token }) {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';

    ws.sessionId = sessionId;
    ws.clientId = clientId;
    ws.isAlive = true;

    // Register in session sockets pool
    if (!this.sessionSockets.has(sessionId)) {
      this.sessionSockets.set(sessionId, new Set());
    }
    this.sessionSockets.get(sessionId).add(ws);

    // Record in sessionStore
    sessionStore.addClient(sessionId, clientId, { ip, userAgent });

    // Handle pong
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Handle incoming messages from Side App (strictly passive - heartbeat only)
    ws.on('message', (data) => {
      try {
        const text = data.toString();
        const msg = JSON.parse(text);

        if (msg.type === MESSAGE_TYPES.PING || msg.type === 'ping') {
          ws.send(JSON.stringify(createEnvelope(MESSAGE_TYPES.PONG, {}, this.nextSeq(sessionId))));
        } else if (msg.type === MESSAGE_TYPES.PONG || msg.type === 'pong') {
          ws.isAlive = true;
        } else if (msg.type === 'request.sync') {
          const snapshot = sessionStore.getSnapshot(sessionId);
          if (snapshot) {
            this.sendToSocket(ws, createEnvelope(MESSAGE_TYPES.RENDER_FULL, snapshot, this.nextSeq(sessionId)));
          }
        }
        // Discard any other message types: Side App does not execute business commands
      } catch (err) {
        // Ignore unparseable frames
      }
    });

    // Handle connection close
    ws.on('close', () => {
      this.removeSocket(sessionId, ws, clientId);
    });

    ws.on('error', (err) => {
      console.warn(`[SideApp WS] Socket error for client ${clientId}:`, err.message);
      this.removeSocket(sessionId, ws, clientId);
    });

    // 1. Send session.welcome
    const welcomeEnvelope = createEnvelope(
      MESSAGE_TYPES.WELCOME,
      {
        protocolVersion: PROTOCOL_VERSION,
        deviceId: clientId,
        sessionId: sessionId
      },
      this.nextSeq(sessionId)
    );
    this.sendToSocket(ws, welcomeEnvelope);

    // 2. Immediately push render.full so client syncs instantly!
    const snapshot = sessionStore.getSnapshot(sessionId) || {
      view: 'viewSelection',
      state: {
        dueCount: '--',
        totalWords: '--',
        masteredCount: '--',
        statusText: '就绪 · 等待主机开始听写'
      },
      meta: { title: 'ThaiNotes 伴侣屏', pushedAt: Date.now() }
    };
    const fullEnvelope = createEnvelope(
      MESSAGE_TYPES.RENDER_FULL,
      snapshot,
      this.nextSeq(sessionId)
    );
    this.sendToSocket(ws, fullEnvelope);
  }

  /**
   * Broadcasts a rendering instruction to all connected Side Apps of a session.
   * @param {string} sessionId 
   * @param {object} message Envelope or { type, payload }
   * @param {WebSocket} [excludeSocket=null]
   * @returns {number} Count of clients that received the message
   */
  broadcast(sessionId, message, excludeSocket = null) {
    if (!sessionId || !message) return 0;

    const type = message.type || message.message?.type;
    const payload = message.payload !== undefined ? message.payload : (message.message?.payload || {});

    if (!type) {
      console.warn('[SideApp WS] Cannot broadcast message without type:', message);
      return 0;
    }

    const envelope = createEnvelope(type, payload, this.nextSeq(sessionId));

    // Maintain session snapshot for state recovery
    if (type === MESSAGE_TYPES.RENDER_FULL) {
      sessionStore.updateSnapshot(sessionId, payload);
    } else if (type === MESSAGE_TYPES.RENDER_PATCH && payload?.ops) {
      const currentSnap = sessionStore.getSnapshot(sessionId);
      if (currentSnap && currentSnap.state) {
        for (const op of payload.ops) {
          try {
            setByPath(currentSnap.state, op.path, op.value);
          } catch (e) {
            // Ignore patch set errors
          }
        }
      }
    } else if (type === MESSAGE_TYPES.RENDER_NAVIGATE) {
      const currentSnap = sessionStore.getSnapshot(sessionId) || {};
      currentSnap.view = payload.view;
      if (payload.state) {
        currentSnap.state = payload.state;
      }
      sessionStore.updateSnapshot(sessionId, currentSnap);
    }

    const sockets = this.sessionSockets.get(sessionId);
    if (!sockets || sockets.size === 0) {
      return 0;
    }

    const dataString = JSON.stringify(envelope);
    let sentCount = 0;

    for (const ws of sockets) {
      if (ws !== excludeSocket && ws.readyState === WebSocket.OPEN) {
        ws.send(dataString);
        sentCount++;
      }
    }

    return sentCount;
  }

  /**
   * Closes a master session, sends error notice to all attached side apps, and disconnects them.
   * @param {string} sessionId 
   */
  closeSession(sessionId) {
    const sockets = this.sessionSockets.get(sessionId);
    if (sockets && sockets.size > 0) {
      const closeEnvelope = createEnvelope(
        MESSAGE_TYPES.ERROR,
        {
          code: ERROR_CODES.MASTER_CLOSED,
          message: '主操作台已退出当前会话'
        },
        this.nextSeq(sessionId)
      );
      const dataString = JSON.stringify(closeEnvelope);

      for (const ws of sockets) {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(dataString);
            ws.close(1000, 'Master closed');
          }
        } catch (e) {}
      }
    }

    this.sessionSockets.delete(sessionId);
    this.sessionSeq.delete(sessionId);
  }

  /**
   * Helper to safely serialize and send an envelope.
   * @param {WebSocket} ws 
   * @param {object} envelope 
   */
  sendToSocket(ws, envelope) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(envelope));
      } catch (err) {
        console.warn('[SideApp WS] Send error:', err.message);
      }
    }
  }

  /**
   * Cleans up closed socket references.
   * @param {string} sessionId 
   * @param {WebSocket} ws 
   * @param {string} clientId 
   */
  removeSocket(sessionId, ws, clientId) {
    const sockets = this.sessionSockets.get(sessionId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        this.sessionSockets.delete(sessionId);
      }
    }
    sessionStore.removeClient(sessionId, clientId);
  }

  /**
   * Periodic ping check.
   */
  checkHeartbeats() {
    for (const [sessionId, sockets] of this.sessionSockets.entries()) {
      for (const ws of sockets) {
        if (!ws.isAlive) {
          try {
            ws.terminate();
          } catch (e) {}
          sockets.delete(ws);
          sessionStore.removeClient(sessionId, ws.clientId);
          continue;
        }

        ws.isAlive = false;
        try {
          ws.ping();
        } catch (e) {
          sockets.delete(ws);
          sessionStore.removeClient(sessionId, ws.clientId);
        }
      }
      if (sockets.size === 0) {
        this.sessionSockets.delete(sessionId);
      }
    }
  }

  destroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    for (const [sessionId, sockets] of this.sessionSockets.entries()) {
      for (const ws of sockets) {
        try {
          ws.close();
        } catch (e) {}
      }
    }
    this.sessionSockets.clear();
    this.sessionSeq.clear();
    try {
      this.wss.close();
    } catch (e) {}
  }
}

export const wsHub = new WsHub();
