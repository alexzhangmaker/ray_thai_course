/**
 * SideApp Session & Pairing Store
 * Manages active master sessions, pairing codes, authentication tokens, and connected client tracking.
 */

import crypto from 'crypto';

const CODE_CHARACTERS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 32 characters, no ambiguous 0, O, 1, I

/**
 * Generates an uppercase pairing code of specified length.
 * @param {number} length 
 * @returns {string}
 */
function generatePairingCode(length = 4) {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARACTERS[bytes[i] % CODE_CHARACTERS.length];
  }
  return code;
}

export class SessionStore {
  constructor() {
    this.sessions = new Map(); // sessionId -> Session
    this.codeToSessionMap = new Map(); // pairingCode -> sessionId

    // Automatic cleanup of expired sessions every 5 minutes
    this.cleanupTimer = setInterval(() => {
      this.cleanExpiredSessions();
    }, 5 * 60 * 1000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Creates a new master session.
   * @param {object} options
   * @param {string} [options.deviceName='Master']
   * @param {number} [options.ttlMs=7200000] 2 hours default
   * @returns {object} Session descriptor
   */
  createSession({ deviceName = 'Master', ttlMs = 2 * 60 * 60 * 1000 } = {}) {
    const sessionId = `sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const masterToken = `tok_${crypto.randomBytes(16).toString('hex')}`;

    // Generate unique pairing code
    let pairingCode = '';
    let attempts = 0;
    do {
      pairingCode = generatePairingCode(4);
      attempts++;
    } while (this.codeToSessionMap.has(pairingCode) && attempts < 20);

    const now = Date.now();
    const expiresAt = now + ttlMs;

    const session = {
      sessionId,
      pairingCode,
      masterToken,
      deviceName: deviceName || 'Master',
      createdAt: now,
      expiresAt,
      state: 'active', // 'active' | 'closing' | 'closed'
      lastSnapshot: {
        view: 'viewSelection',
        state: {
          dueCount: '--',
          totalWords: '--',
          masteredCount: '--',
          statusText: '就绪 · 等待主机开始听写'
        },
        meta: {
          title: 'ThaiNotes 伴侣屏',
          pushedAt: now
        }
      },
      validTokens: new Set([masterToken]),
      connectedClients: new Map() // clientId -> { deviceId, userAgent, ip, connectedAt, lastSeen }
    };

    this.sessions.set(sessionId, session);
    this.codeToSessionMap.set(pairingCode, sessionId);

    return {
      sessionId,
      pairingCode,
      token: masterToken,
      deviceName: session.deviceName,
      expiresAt
    };
  }

  /**
   * Retrieves a session by its sessionId.
   * @param {string} sessionId 
   * @returns {object|null}
   */
  getSession(sessionId) {
    if (!sessionId) return null;
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() > session.expiresAt || session.state === 'closed') {
      return null;
    }
    return session;
  }

  /**
   * Verifies pairing code and generates a one-time token for the connecting Side App device.
   * @param {string} code 
   * @returns {{ sessionId: string, token: string }|null}
   */
  pairCode(code) {
    if (!code) return null;
    const normalizedCode = String(code).trim().toUpperCase();
    const sessionId = this.codeToSessionMap.get(normalizedCode);
    if (!sessionId) return null;

    const session = this.getSession(sessionId);
    if (!session) {
      this.codeToSessionMap.delete(normalizedCode);
      return null;
    }

    // Generate an individual token for this paired device
    const clientToken = `tok_${crypto.randomBytes(16).toString('hex')}`;
    session.validTokens.add(clientToken);

    return {
      sessionId: session.sessionId,
      token: clientToken,
      deviceName: session.deviceName
    };
  }

  /**
   * Validates a token for a given session.
   * @param {string} sessionId 
   * @param {string} token 
   * @returns {boolean}
   */
  validateToken(sessionId, token) {
    if (!sessionId || !token) return false;
    const session = this.getSession(sessionId);
    if (!session) return false;
    return session.validTokens.has(token);
  }

  /**
   * Updates the latest full render state snapshot for a session.
   * Used for fast re-sync when a new client connects or reconnects.
   * @param {string} sessionId 
   * @param {object} snapshot 
   */
  updateSnapshot(sessionId, snapshot) {
    const session = this.getSession(sessionId);
    if (session) {
      session.lastSnapshot = snapshot;
    }
  }

  /**
   * Retrieves the current snapshot for a session.
   * @param {string} sessionId 
   * @returns {object|null}
   */
  getSnapshot(sessionId) {
    const session = this.getSession(sessionId);
    return session ? session.lastSnapshot : null;
  }

  /**
   * Records a connected client.
   * @param {string} sessionId 
   * @param {string} clientId 
   * @param {object} meta 
   */
  addClient(sessionId, clientId, meta = {}) {
    const session = this.getSession(sessionId);
    if (session) {
      session.connectedClients.set(clientId, {
        clientId,
        ip: meta.ip || '',
        userAgent: meta.userAgent || '',
        connectedAt: Date.now(),
        lastSeen: Date.now()
      });
    }
  }

  /**
   * Removes a connected client.
   * @param {string} sessionId 
   * @param {string} clientId 
   */
  removeClient(sessionId, clientId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.connectedClients.delete(clientId);
    }
  }

  /**
   * Returns list of currently connected clients for a session.
   * @param {string} sessionId 
   * @returns {Array<object>}
   */
  getClientList(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return [];
    return Array.from(session.connectedClients.values());
  }

  /**
   * Closes a session and cleans up pairing codes and client mappings.
   * @param {string} sessionId 
   */
  closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = 'closed';
      if (session.pairingCode) {
        this.codeToSessionMap.delete(session.pairingCode);
      }
      session.connectedClients.clear();
      session.validTokens.clear();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Cleans up expired sessions.
   */
  cleanExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now > session.expiresAt || session.state === 'closed') {
        if (session.pairingCode) {
          this.codeToSessionMap.delete(session.pairingCode);
        }
        this.sessions.delete(sessionId);
      }
    }
  }

  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.sessions.clear();
    this.codeToSessionMap.clear();
  }
}

export const sessionStore = new SessionStore();
