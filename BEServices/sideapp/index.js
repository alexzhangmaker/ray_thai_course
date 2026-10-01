/**
 * SideApp Backend Module Entry Point
 * Registers HTTP endpoints, handles WebSocket upgrades, and serves the SideApp mobile entry.
 */

import express from 'express';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { sessionStore } from './sessionStore.js';
import { wsHub } from './wsHub.js';
import { PROTOCOL_VERSION, MESSAGE_TYPES, ERROR_CODES } from './protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const parentDir = path.resolve(__dirname, '../..');

/**
 * Discovers the host machine's primary local LAN IP address.
 * Prioritizes Wi-Fi / Ethernet adapters, skips Docker and virtual interfaces.
 * @returns {string} Local IPv4 address or 127.0.0.1
 */
export function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    // Skip virtual/docker/loopback interfaces
    if (/^(lo|docker|veth|br-|vmnet)/i.test(name)) continue;

    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        // Prioritize wlan/wlo (Wi-Fi) and en/eth (Ethernet)
        const isWifiOrEth = /^(wlan|wlo|wl|en|eth)/i.test(name);
        candidates.push({
          ip: addr.address,
          priority: isWifiOrEth ? 1 : 2
        });
      }
    }
  }

  candidates.sort((a, b) => a.priority - b.priority);
  return candidates.length > 0 ? candidates[0].ip : '127.0.0.1';
}

/**
 * Creates the Express router for SideApp endpoints.
 * @param {number} port 
 * @returns {express.Router}
 */
export function createSideAppRouter(port = 3002) {
  const router = express.Router();

  // 1. POST /sideapp/session - Create new session (called by Master App)
  router.post('/sideapp/session', (req, res) => {
    try {
      const { deviceName } = req.body || {};
      const session = sessionStore.createSession({
        deviceName: deviceName || 'iMac'
      });

      const localIp = getLocalIpAddress();
      const wsUrl = `ws://${localIp}:${port}/sideapp/ws`;
      const sideAppUrl = `http://${localIp}:${port}/sideapp?code=${session.pairingCode}`;

      res.json({
        sessionId: session.sessionId,
        pairingCode: session.pairingCode,
        token: session.token,
        wsUrl,
        sideAppUrl,
        localIp,
        port,
        expiresAt: session.expiresAt
      });
    } catch (err) {
      console.error('[SideApp] Failed to create session:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 2. GET /sideapp/pair/:code - Pair with pairing code (called by Side App)
  router.get('/sideapp/pair/:code', (req, res) => {
    try {
      const code = req.params.code;
      const pairResult = sessionStore.pairCode(code);
      if (!pairResult) {
        return res.status(404).json({
          error: '配对码无效或已过期，请在主操作台重新获取'
        });
      }

      res.json({
        sessionId: pairResult.sessionId,
        token: pairResult.token,
        deviceName: pairResult.deviceName
      });
    } catch (err) {
      console.error('[SideApp] Pairing failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 3. POST /sideapp/broadcast - Broadcast instruction to all connected Side Apps
  router.post('/sideapp/broadcast', (req, res) => {
    try {
      const { sessionId, message } = req.body || {};
      if (!sessionId || !message) {
        return res.status(400).json({ error: 'Missing sessionId or message' });
      }

      const clientCount = wsHub.broadcast(sessionId, message);
      res.json({
        success: true,
        clientCount
      });
    } catch (err) {
      console.error('[SideApp] Broadcast failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 4. GET /sideapp/session/:sessionId/status - Check session status & connected devices
  router.get('/sideapp/session/:sessionId/status', (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = sessionStore.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ active: false, error: 'Session not found or expired' });
      }

      const clients = sessionStore.getClientList(sessionId);
      res.json({
        active: true,
        sessionId: session.sessionId,
        pairingCode: session.pairingCode,
        deviceName: session.deviceName,
        clientCount: clients.length,
        clients: clients.map(c => ({
          clientId: c.clientId,
          ip: c.ip,
          connectedAt: c.connectedAt
        }))
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. POST /sideapp/session/:sessionId/close - Close session
  router.post('/sideapp/session/:sessionId/close', (req, res) => {
    try {
      const { sessionId } = req.params;
      wsHub.closeSession(sessionId);
      sessionStore.closeSession(sessionId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Serve static files and HTML for SideApp
  router.use('/sideapp', express.static(path.join(parentDir, 'Pages', 'sideapp')));
  router.get('/sideapp', (req, res) => {
    const sideAppHtmlPath = path.join(parentDir, 'Pages', 'sideapp', 'index.html');
    res.sendFile(sideAppHtmlPath);
  });

  return router;
}

/**
 * Integrates SideApp into existing Express application and HTTP server.
 * @param {express.Express} app 
 * @param {import('http').Server} httpServer 
 * @param {number} port 
 */
export function initSideApp(app, httpServer, port = 3002) {
  const router = createSideAppRouter(port);
  app.use(router);

  if (httpServer) {
    httpServer.on('upgrade', (req, socket, head) => {
      wsHub.handleUpgrade(req, socket, head);
    });
  }

  console.log('[SideApp] Initialized successfully on port', port);
}

export { sessionStore, wsHub, PROTOCOL_VERSION, MESSAGE_TYPES, ERROR_CODES };
