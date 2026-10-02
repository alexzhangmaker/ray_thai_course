/**
 * SideApp Bridge for Master App (iMac)
 * Captures UI state changes, diffs state to generate patches, and broadcasts rendering commands
 * to connected passive Side App clients via backend WebSocket hub.
 */

(function (window) {
  // Diff utility for computing JSON patch-like operations
  function computePatch(prev, next, prefix = '') {
    const ops = [];

    if (prev === next) return ops;

    if (
      prev === null || prev === undefined ||
      next === null || next === undefined ||
      typeof prev !== 'object' || typeof next !== 'object'
    ) {
      ops.push({ path: prefix, value: next });
      return ops;
    }

    if (Array.isArray(prev) || Array.isArray(next)) {
      if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) {
        ops.push({ path: prefix, value: next });
        return ops;
      }
      let changed = false;
      for (let i = 0; i < prev.length; i++) {
        if (computePatch(prev[i], next[i], `${prefix}[${i}]`).length > 0) {
          changed = true;
          break;
        }
      }
      if (changed) {
        ops.push({ path: prefix, value: next });
      }
      return ops;
    }

    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(next);
    const allKeys = new Set([...prevKeys, ...nextKeys]);

    for (const key of allKeys) {
      const keyPath = prefix ? `${prefix}.${key}` : key;
      if (!(key in next)) {
        ops.push({ path: keyPath, value: undefined });
      } else if (!(key in prev)) {
        ops.push({ path: keyPath, value: next[key] });
      } else {
        const nestedOps = computePatch(prev[key], next[key], keyPath);
        ops.push(...nestedOps);
      }
    }

    return ops;
  }

  class SideAppBridge {
    constructor() {
      this.enabled = localStorage.getItem('thainotes_sideapp_enabled') === 'true';
      this.sessionId = null;
      this.pairingCode = null;
      this.wsUrl = null;
      this.sideAppUrl = null;
      this.localIp = null;
      this.port = null;
      this.lastSnapshot = null;
      this.clientCount = 0;
      this.connectedClients = [];
      this.seq = 0;
      this.appTitle = null;
      this.statusPollTimer = null;
      this.statusListeners = new Set();
    }

    /**
     * Sets custom application title for companion screen.
     * @param {string} title 
     */
    setAppTitle(title) {
      this.appTitle = title;
    }

    /**
     * Toggles SideApp feature on/off.
     * @param {boolean} isEnabled 
     */
    async setEnabled(isEnabled) {
      this.enabled = Boolean(isEnabled);
      localStorage.setItem('thainotes_sideapp_enabled', this.enabled ? 'true' : 'false');

      if (this.enabled) {
        if (!this.sessionId) {
          await this.start();
        }
      } else {
        await this.stop();
      }
      this.notifyListeners();
    }

    /**
     * Initializes a master session on the backend.
     */
    async start() {
      try {
        const res = await fetch('/sideapp/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceName: 'iMac (Master)' })
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        this.sessionId = data.sessionId;
        this.pairingCode = data.pairingCode;
        this.wsUrl = data.wsUrl;
        this.sideAppUrl = data.sideAppUrl;
        this.localIp = data.localIp;
        this.port = data.port;
        this.clientCount = 0;
        this.connectedClients = [];

        // Start polling client status every 3s
        this.startStatusPolling();
        this.notifyListeners();

        // Push current initial snapshot if available
        if (typeof window.syncSideAppState === 'function') {
          window.syncSideAppState(null, true);
        } else if (this.lastSnapshot) {
          this.pushState(this.lastSnapshot.view, this.lastSnapshot.state, true);
        }

        return data;
      } catch (err) {
        console.warn('[SideApp Bridge] Failed to initialize session (silent fallback):', err.message);
        return null;
      }
    }

    /**
     * Pushes current UI state to Side App. If view changed or first push, sends render.full.
     * Otherwise computes diff and sends render.patch.
     * @param {string} view 
     * @param {object} state 
     * @param {boolean} [forceFull=false] 
     * @param {object} [meta=null]
     */
    pushState(view, state, forceFull = false, meta = null) {
      if (!this.enabled || !this.sessionId) {
        // Cache snapshot even when disabled so if enabled later, it can sync immediately
        this.lastSnapshot = { view, state: JSON.parse(JSON.stringify(state || {})) };
        return;
      }

      const cleanState = JSON.parse(JSON.stringify(state || {}));

      if (forceFull || !this.lastSnapshot || this.lastSnapshot.view !== view) {
        // Full view switch or initial render
        const msg = {
          type: 'render.full',
          payload: {
            view: view,
            state: cleanState,
            meta: Object.assign({
              title: this.appTitle || 'ThaiNotes 听写助手',
              pushedAt: Date.now()
            }, meta || {})
          }
        };
        this.broadcast(msg);
        this.lastSnapshot = { view, state: cleanState };
      } else {
        // Incremental state patch
        const ops = computePatch(this.lastSnapshot.state, cleanState);
        if (ops.length > 0) {
          const msg = {
            type: 'render.patch',
            payload: { ops }
          };
          this.broadcast(msg);
          this.lastSnapshot = { view, state: cleanState };
        }
      }
    }

    /**
     * Navigates Side App to a specific view.
     * @param {string} view 
     * @param {object} state 
     */
    navigate(view, state = {}) {
      if (!this.enabled || !this.sessionId) return;
      this.broadcast({
        type: 'render.navigate',
        payload: { view, state }
      });
      this.lastSnapshot = { view, state: JSON.parse(JSON.stringify(state)) };
    }

    /**
     * Triggers a visual effect on the Side App (e.g. audio playing pulse).
     * @param {string} name 
     * @param {string} [target=''] 
     * @param {number} [duration=800] 
     */
    playEffect(name, target = '', duration = 800) {
      if (!this.enabled || !this.sessionId) return;
      this.broadcast({
        type: 'render.effect',
        payload: { name, target, duration }
      });
    }

    /**
     * Broadcasts an instruction message via the backend HTTP endpoint.
     * @param {object} message 
     */
    async broadcast(message) {
      if (!this.sessionId) return;

      this.seq++;
      const envelope = {
        seq: this.seq,
        protocolVersion: '1.0',
        timestamp: Date.now(),
        type: message.type,
        payload: message.payload || {}
      };

      try {
        await fetch('/sideapp/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: this.sessionId,
            message: envelope
          })
        });
      } catch (err) {
        console.warn('[SideApp Bridge] Broadcast network error:', err.message);
      }
    }

    /**
     * Terminates the current session on the backend.
     */
    async stop() {
      this.stopStatusPolling();

      if (this.sessionId) {
        try {
          await fetch(`/sideapp/session/${this.sessionId}/close`, { method: 'POST' });
        } catch (e) {}
      }

      this.sessionId = null;
      this.pairingCode = null;
      this.clientCount = 0;
      this.connectedClients = [];
      this.notifyListeners();
    }

    startStatusPolling() {
      this.stopStatusPolling();
      const checkStatus = async () => {
        if (!this.sessionId) return;
        try {
          const res = await fetch(`/sideapp/session/${this.sessionId}/status`);
          if (res.ok) {
            const data = await res.json();
            const newCount = data.clientCount || 0;
            const newClients = data.clients || [];
            const changed = this.clientCount !== newCount ||
              this.connectedClients.length !== newClients.length ||
              JSON.stringify(this.connectedClients) !== JSON.stringify(newClients);

            this.clientCount = newCount;
            this.connectedClients = newClients;
            if (changed) {
              this.notifyListeners();
            }
          } else if (res.status === 404) {
            // Session expired on server, re-create
            await this.start();
          }
        } catch (e) {}
      };

      this.statusPollTimer = setInterval(checkStatus, 3000);
      checkStatus();
    }

    stopStatusPolling() {
      if (this.statusPollTimer) {
        clearInterval(this.statusPollTimer);
        this.statusPollTimer = null;
      }
    }

    /**
     * Subscribes a listener to session/client status updates.
     * @param {Function} callback 
     * @returns {Function} Unsubscribe function
     */
    onStatusChange(callback) {
      this.statusListeners.add(callback);
      callback(this.getStatus());
      return () => this.statusListeners.delete(callback);
    }

    notifyListeners() {
      const status = this.getStatus();
      for (const listener of this.statusListeners) {
        try {
          listener(status);
        } catch (e) {
          console.error(e);
        }
      }
    }

    getStatus() {
      return {
        enabled: this.enabled,
        sessionId: this.sessionId,
        pairingCode: this.pairingCode,
        sideAppUrl: this.sideAppUrl,
        localIp: this.localIp,
        clientCount: this.clientCount,
        connectedClients: this.connectedClients
      };
    }
  }

  // Expose global instance
  window.sideAppBridge = new SideAppBridge();

  // Clean up on tab close
  window.addEventListener('beforeunload', () => {
    if (window.sideAppBridge && window.sideAppBridge.sessionId) {
      navigator.sendBeacon(`/sideapp/session/${window.sideAppBridge.sessionId}/close`);
    }
  });

})(window);
