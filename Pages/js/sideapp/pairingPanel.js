/**
 * SideApp Pairing Panel Component
 * Renders the header trigger pill, pairing modal, QR code generator, and real-time device tracker.
 */

(function (window) {
  class SideAppPairingPanel {
    constructor() {
      this.modalEl = null;
      this.qrcodeObj = null;
      this.init();
    }

    init() {
      // Wait for DOM ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.setup());
      } else {
        this.setup();
      }
    }

    setup() {
      this.renderModal();
      this.bindBridge();
    }

    bindBridge() {
      if (!window.sideAppBridge) return;

      window.sideAppBridge.onStatusChange((status) => {
        this.updateHeaderBadge(status);
        this.updateModalUI(status);
      });

      // Auto-start if previously enabled
      if (window.sideAppBridge.enabled) {
        window.sideAppBridge.start();
      }
    }

    updateHeaderBadge(status) {
      const btn = document.getElementById('btnSideAppPill');
      const dot = document.getElementById('sideAppStatusDot');
      const text = document.getElementById('sideAppStatusText');
      if (!btn || !dot || !text) return;

      if (!status.enabled) {
        dot.className = 'w-2 h-2 rounded-full bg-slate-500';
        text.innerText = '伴侣屏';
        btn.classList.remove('border-emerald-500/40', 'border-amber-500/40', 'bg-emerald-500/10', 'bg-amber-500/10');
      } else if (status.clientCount > 0) {
        dot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
        text.innerText = `伴侣屏 (${status.clientCount}台)`;
        btn.classList.add('border-emerald-500/40', 'bg-emerald-500/10');
        btn.classList.remove('border-amber-500/40', 'bg-amber-500/10');
      } else {
        dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
        text.innerText = status.pairingCode ? `伴侣屏 [${status.pairingCode}]` : '伴侣屏';
        btn.classList.add('border-amber-500/40', 'bg-amber-500/10');
        btn.classList.remove('border-emerald-500/40', 'bg-emerald-500/10');
      }
    }

    renderModal() {
      if (document.getElementById('modalSideAppPairing')) return;

      const modalHtml = `
        <div id="modalSideAppPairing" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md hidden transition-all duration-200">
          <div class="glass-panel w-full max-w-lg rounded-3xl p-6 sm:p-7 border border-white/15 shadow-2xl relative space-y-6">
            
            <!-- Header -->
            <div class="flex items-center justify-between pb-4 border-b border-white/10">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-violet-600 to-fuchsia-600 flex items-center justify-center text-white text-xl shadow-lg shadow-violet-500/20">
                  <i class="ph-bold ph-device-mobile"></i>
                </div>
                <div>
                  <h3 class="text-lg font-bold text-white flex items-center gap-2">
                    SideApp 手机伴侣屏
                    <span class="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">局域网联动</span>
                  </h3>
                  <p class="text-xs text-slate-400">将 iPhone 等手机作为哑终端，同步听写发音动效与泰语卡片</p>
                </div>
              </div>
              <button onclick="SideAppPairingPanel.close()" class="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition">
                <i class="ph-bold ph-x text-lg"></i>
              </button>
            </div>

            <!-- Master Toggle Switch -->
            <div class="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/10">
              <div>
                <div class="text-sm font-semibold text-white">伴侣屏联动特性</div>
                <div class="text-xs text-slate-400">开启后主操作台将单向广播渲染指令到手机屏</div>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id="sideAppToggleCheckbox" class="sr-only peer" onchange="SideAppPairingPanel.toggleEnable(this.checked)">
                <div class="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
              </label>
            </div>

            <!-- Content Area when Enabled -->
            <div id="sideAppPanelActiveContent" class="space-y-5">
              
              <!-- QR Code & Code Section -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                <!-- QR Box -->
                <div class="flex flex-col items-center justify-center p-4 rounded-2xl bg-white/5 border border-white/10 text-center">
                  <div id="sideAppQrContainer" class="p-2.5 bg-white rounded-xl shadow-lg flex items-center justify-center min-w-[150px] min-h-[150px]">
                    <div class="text-xs text-slate-500">生成二维码中...</div>
                  </div>
                  <div class="text-[11px] text-slate-400 mt-2.5 flex items-center gap-1">
                    <i class="ph-bold ph-scan text-violet-400"></i>
                    用 iPhone 相机/微信扫码
                  </div>
                </div>

                <!-- Pairing Code Box -->
                <div class="space-y-3">
                  <div class="p-4 rounded-2xl bg-violet-950/40 border border-violet-500/30 text-center space-y-1">
                    <div class="text-xs text-violet-300 font-medium">四位快速配对码</div>
                    <div id="sideAppPairingCodeDisplay" class="font-mono text-3xl font-black text-amber-400 tracking-widest py-1 select-all cursor-pointer" title="点击复制" onclick="SideAppPairingPanel.copyCode()">
                      ----
                    </div>
                    <div class="text-[10px] text-slate-400">手机打开任意浏览器输入配对码亦可</div>
                  </div>

                  <!-- Direct URL Box -->
                  <div class="p-2.5 rounded-xl bg-white/5 border border-white/10 text-xs flex items-center justify-between gap-2">
                    <span id="sideAppUrlDisplay" class="truncate text-slate-300 font-mono text-[11px]">http://...</span>
                    <button onclick="SideAppPairingPanel.copyUrl()" class="px-2.5 py-1 rounded-lg bg-violet-600/30 hover:bg-violet-600 text-violet-200 text-xs shrink-0 transition flex items-center gap-1">
                      <i class="ph-bold ph-copy"></i>
                      <span>复制</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Connected Devices List -->
              <div class="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2.5">
                <div class="flex items-center justify-between text-xs">
                  <span class="font-semibold text-slate-300 flex items-center gap-1.5">
                    <i class="ph-bold ph-broadcast text-violet-400"></i>
                    已连接伴侣设备:
                  </span>
                  <span id="sideAppClientCountBadge" class="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-mono">0 台</span>
                </div>
                <div id="sideAppClientsList" class="space-y-1.5 max-h-32 overflow-y-auto">
                  <div class="text-xs text-slate-500 py-2 text-center">暂无伴侣屏连接，手机扫码后将自动出现</div>
                </div>
              </div>

            </div>

            <!-- Disabled State Placeholder -->
            <div id="sideAppPanelDisabledNotice" class="p-6 rounded-2xl bg-white/5 border border-white/10 text-center space-y-2 hidden">
              <div class="text-slate-400 text-sm font-medium">伴侣屏特性当前已关闭</div>
              <p class="text-xs text-slate-500 max-w-sm mx-auto">
                打开上方开关后，系统将在局域网建立安全的单向 WebSocket 推送服务，手机扫码即可无缝配对。
              </p>
            </div>

            <!-- Footer -->
            <div class="pt-2 flex items-center justify-between text-xs text-slate-500 border-t border-white/10">
              <span class="flex items-center gap-1">
                <i class="ph-bold ph-wifi-high text-slate-400"></i>
                需手机与 iMac 处于同一 Wi-Fi
              </span>
              <button onclick="SideAppPairingPanel.close()" class="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white transition">
                完成 (关闭面板)
              </button>
            </div>

          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modalHtml);
      this.modalEl = document.getElementById('modalSideAppPairing');
    }

    updateModalUI(status) {
      const toggle = document.getElementById('sideAppToggleCheckbox');
      const activeContent = document.getElementById('sideAppPanelActiveContent');
      const disabledNotice = document.getElementById('sideAppPanelDisabledNotice');
      const codeDisplay = document.getElementById('sideAppPairingCodeDisplay');
      const urlDisplay = document.getElementById('sideAppUrlDisplay');
      const clientCountBadge = document.getElementById('sideAppClientCountBadge');
      const clientsList = document.getElementById('sideAppClientsList');

      if (!toggle || !activeContent || !disabledNotice) return;

      toggle.checked = status.enabled;

      if (!status.enabled) {
        activeContent.classList.add('hidden');
        disabledNotice.classList.remove('hidden');
        return;
      }

      activeContent.classList.remove('hidden');
      disabledNotice.classList.add('hidden');

      if (codeDisplay) {
        codeDisplay.innerText = status.pairingCode || '----';
      }

      if (urlDisplay && status.sideAppUrl) {
        urlDisplay.innerText = status.sideAppUrl;
      }

      if (clientCountBadge) {
        clientCountBadge.innerText = `${status.clientCount} 台在线`;
        clientCountBadge.className = status.clientCount > 0
          ? 'px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono'
          : 'px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-mono';
      }

      if (clientsList) {
        if (!status.connectedClients || status.connectedClients.length === 0) {
          clientsList.innerHTML = `<div class="text-xs text-slate-500 py-2 text-center">等待手机连接... 请扫码或输入配对码</div>`;
        } else {
          clientsList.innerHTML = status.connectedClients.map(c => `
            <div class="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between text-xs">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span class="text-emerald-200 font-medium font-mono">${c.ip || '局域网设备'}</span>
              </div>
              <span class="text-[10px] text-slate-400">已保持同步</span>
            </div>
          `).join('');
        }
      }

      // Render QRCode if url is available
      if (status.sideAppUrl) {
        this.renderQRCode(status.sideAppUrl);
      }
    }

    renderQRCode(url) {
      const container = document.getElementById('sideAppQrContainer');
      if (!container) return;

      if (typeof QRCode !== 'undefined') {
        container.innerHTML = '';
        try {
          this.qrcodeObj = new QRCode(container, {
            text: url,
            width: 140,
            height: 140,
            colorDark: '#0f0a1e',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
          });
        } catch (e) {
          container.innerHTML = `<div class="text-xs text-rose-400">QR生成失败</div>`;
        }
      } else {
        container.innerHTML = `<div class="text-xs text-slate-400">加载QR组件中...</div>`;
      }
    }

    static open() {
      const modal = document.getElementById('modalSideAppPairing');
      if (modal) {
        modal.classList.remove('hidden');
        if (window.sideAppBridge && window.sideAppBridge.enabled) {
          window.sideAppBridge.startStatusPolling();
          if (window.sideAppBridge.sideAppUrl) {
            window.SideAppPairingPanelInstance?.renderQRCode(window.sideAppBridge.sideAppUrl);
          }
        }
      }
    }

    static close() {
      const modal = document.getElementById('modalSideAppPairing');
      if (modal) {
        modal.classList.add('hidden');
      }
    }

    static async toggleEnable(checked) {
      if (window.sideAppBridge) {
        await window.sideAppBridge.setEnabled(checked);
        if (checked && window.sideAppBridge.sideAppUrl) {
          window.SideAppPairingPanelInstance?.renderQRCode(window.sideAppBridge.sideAppUrl);
          if (typeof window.syncSideAppState === 'function') {
            window.syncSideAppState(null, true);
          }
        }
      }
    }

    static copyCode() {
      const code = window.sideAppBridge?.pairingCode;
      if (code && navigator.clipboard) {
        navigator.clipboard.writeText(code);
        if (typeof showToast === 'function') {
          showToast(`配对码 ${code} 已复制到剪贴板`, 'success');
        }
      }
    }

    static copyUrl() {
      const url = window.sideAppBridge?.sideAppUrl;
      if (url && navigator.clipboard) {
        navigator.clipboard.writeText(url);
        if (typeof showToast === 'function') {
          showToast('伴侣屏访问链接已复制', 'success');
        }
      }
    }
  }

  window.SideAppPairingPanel = SideAppPairingPanel;
  window.SideAppPairingPanelInstance = new SideAppPairingPanel();
})(window);
