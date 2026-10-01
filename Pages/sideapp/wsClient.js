/**
 * SideApp WebSocket Client
 * Manages pairing code verification, WebSocket connection, auto-reconnect with exponential backoff,
 * heartbeat ping/pong, and dispatches instructions to renderer.
 */

(function (window) {
  class SideAppWsClient {
    constructor() {
      this.sessionId = null;
      this.token = null;
      this.pairingCode = null;
      this.ws = null;
      this.reconnectAttempts = 0;
      this.maxReconnectDelay = 15000;
      this.reconnectTimer = null;
      this.heartbeatTimer = null;
      this.isManualClosed = false;
      this.statusListeners = new Set();
    }

    async init() {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const session = urlParams.get('session');
      const token = urlParams.get('token');

      if (session && token) {
        this.sessionId = session;
        this.token = token;
        this.connect();
      } else if (code) {
        this.pairingCode = code.trim().toUpperCase();
        await this.pairWithCode(this.pairingCode);
      } else {
        // Check sessionStorage
        const savedCode = sessionStorage.getItem('sideapp_last_code');
        if (savedCode) {
          this.pairingCode = savedCode;
          await this.pairWithCode(savedCode);
        } else {
          this.showPairingInputScreen();
        }
      }
    }

    /**
     * Exchanges 4-character pairing code for session token.
     * @param {string} code 
     */
    async pairWithCode(code) {
      this.showConnectingStatus('正在验证配对码...');
      try {
        const res = await fetch(`/sideapp/pair/${encodeURIComponent(code)}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || '配对码无效或已过期');
        }

        const data = await res.json();
        this.sessionId = data.sessionId;
        this.token = data.token;
        sessionStorage.setItem('sideapp_last_code', code);

        this.connect();
      } catch (err) {
        this.showPairingError(err.message);
      }
    }

    /**
     * Connects WebSocket to the backend.
     */
    connect() {
      if (!this.sessionId || !this.token) return;

      this.cleanupSocket();
      this.isManualClosed = false;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/sideapp/ws?session=${encodeURIComponent(this.sessionId)}&token=${encodeURIComponent(this.token)}`;

      this.showConnectingStatus('正在连接主屏...');

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.hideConnectingOverlay();
          this.startHeartbeat();
          this.notifyStatus('connected');
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
          this.stopHeartbeat();
          if (!this.isManualClosed) {
            this.handleDisconnect();
          }
        };

        this.ws.onerror = (err) => {
          console.warn('[SideApp Client] WS error:', err);
        };
      } catch (err) {
        console.error('[SideApp Client] WS creation error:', err);
        this.handleDisconnect();
      }
    }

    handleMessage(data) {
      try {
        const envelope = JSON.parse(data);
        if (!envelope || !envelope.type) return;

        switch (envelope.type) {
          case 'session.welcome':
            this.notifyStatus('connected', envelope.payload);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({ type: 'request.sync' }));
            }
            break;

          case 'render.full':
            if (window.sideAppRenderer) {
              window.sideAppRenderer.renderFull(envelope.payload);
            }
            break;

          case 'render.patch':
            if (window.sideAppRenderer) {
              window.sideAppRenderer.applyPatch(envelope.payload);
            }
            break;

          case 'render.navigate':
            if (window.sideAppRenderer) {
              window.sideAppRenderer.navigate(envelope.payload);
            }
            break;

          case 'render.effect':
            if (window.sideAppRenderer) {
              window.sideAppRenderer.playEffect(envelope.payload);
            }
            break;

          case 'session.error':
            this.handleSessionError(envelope.payload);
            break;

          case 'ping':
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({ type: 'pong' }));
            }
            break;

          case 'pong':
            break;

          default:
            // Unknown types are silently discarded per spec §7.3
            break;
        }
      } catch (e) {
        console.warn('[SideApp Client] Failed to parse message frame:', e);
      }
    }

    handleSessionError(payload) {
      if (payload && payload.code === 'MASTER_CLOSED') {
        this.isManualClosed = true;
        this.stopHeartbeat();
        this.showMasterClosedNotice();
        this.notifyStatus('master_closed');
      } else {
        this.showToast(payload?.message || '会话错误', 'warning');
      }
    }

    handleDisconnect() {
      this.reconnectAttempts++;
      // Exponential backoff: 1s, 2s, 4s, 8s, max 15s
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);

      this.showReconnectBanner(`与主屏断开，${Math.round(delay / 1000)}秒后重连 (第${this.reconnectAttempts}次)...`);
      this.notifyStatus('reconnecting');

      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        // If pairing code exists, re-validate pairing in case session changed
        if (this.pairingCode) {
          this.pairWithCode(this.pairingCode);
        } else {
          this.connect();
        }
      }, delay);
    }

    startHeartbeat() {
      this.stopHeartbeat();
      this.heartbeatTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 20000);
    }

    stopHeartbeat() {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }

    cleanupSocket() {
      if (this.ws) {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        try {
          this.ws.close();
        } catch (e) {}
        this.ws = null;
      }
      this.stopHeartbeat();
    }

    // =========================================================================
    // UI Helpers
    // =========================================================================
    showConnectingStatus(text) {
      const banner = document.getElementById('sideAppStatusBanner');
      const bannerText = document.getElementById('sideAppStatusBannerText');
      if (banner && bannerText) {
        banner.className = 'fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-violet-600/90 text-white text-xs font-semibold shadow-lg backdrop-blur-md flex items-center gap-2 border border-violet-400/30';
        bannerText.innerText = text;
        banner.classList.remove('hidden');
      }
    }

    hideConnectingOverlay() {
      const banner = document.getElementById('sideAppStatusBanner');
      if (banner) {
        banner.classList.add('hidden');
      }
      const pairModal = document.getElementById('sideAppPairingCodeModal');
      if (pairModal) {
        pairModal.classList.add('hidden');
      }
      this.updateHeaderPill(true);
    }

    showReconnectBanner(text) {
      const banner = document.getElementById('sideAppStatusBanner');
      const bannerText = document.getElementById('sideAppStatusBannerText');
      if (banner && bannerText) {
        banner.className = 'fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-amber-500/90 text-slate-900 text-xs font-bold shadow-lg backdrop-blur-md flex items-center gap-2 border border-amber-300/40 animate-pulse';
        bannerText.innerText = text;
        banner.classList.remove('hidden');
      }
      this.updateHeaderPill(false);
    }

    showMasterClosedNotice() {
      const banner = document.getElementById('sideAppStatusBanner');
      const bannerText = document.getElementById('sideAppStatusBannerText');
      if (banner && bannerText) {
        banner.className = 'fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-red-600/90 text-white text-xs font-bold shadow-lg backdrop-blur-md flex items-center gap-2 border border-red-400/30';
        bannerText.innerText = '主操作台已退出本次听写练习';
        banner.classList.remove('hidden');
      }
      this.updateHeaderPill(false);
    }

    updateHeaderPill(isConnected) {
      const dot = document.getElementById('sideAppHeaderDot');
      const text = document.getElementById('sideAppHeaderText');
      if (dot && text) {
        if (isConnected) {
          dot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
          text.innerText = '已连接到主机';
        } else {
          dot.className = 'w-2 h-2 rounded-full bg-amber-400';
          text.innerText = '连接中断';
        }
      }
    }

    showPairingInputScreen() {
      const modal = document.getElementById('sideAppPairingCodeModal');
      if (modal) {
        modal.classList.remove('hidden');
      }
    }

    showPairingError(errorMsg) {
      const errEl = document.getElementById('sideAppPairError');
      if (errEl) {
        errEl.innerText = errorMsg;
        errEl.classList.remove('hidden');
      }
      this.showPairingInputScreen();
    }

    notifyStatus(status, data) {
      for (const listener of this.statusListeners) {
        try {
          listener(status, data);
        } catch (e) {}
      }
    }
  }

  window.sideAppWsClient = new SideAppWsClient();
})(window);
