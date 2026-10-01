/**
 * SideApp Mobile Client Renderer
 * Passively renders Master App UI state for mobile screens (iPhone, iPad).
 * Pure state-to-DOM mapping with zero business logic.
 */

(function (window) {
  // Simple path setter matching protocol spec
  function setByPath(target, path, value) {
    if (!path || !target) return target;
    const segments = String(path)
      .replace(/\[(\w+)\]/g, '.$1')
      .replace(/^\./, '')
      .split('.')
      .filter(Boolean);

    let curr = target;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      const nextSeg = segments[i + 1];
      if (curr[seg] === null || curr[seg] === undefined || typeof curr[seg] !== 'object') {
        curr[seg] = /^\d+$/.test(nextSeg) ? [] : {};
      }
      curr = curr[seg];
    }
    const lastSeg = segments[segments.length - 1];
    if (value === undefined) {
      if (Array.isArray(curr) && /^\d+$/.test(lastSeg)) {
        curr.splice(Number(lastSeg), 1);
      } else {
        delete curr[lastSeg];
      }
    } else {
      curr[lastSeg] = value;
    }
    return target;
  }

  class SideAppRenderer {
    constructor() {
      this.currentView = null;
      this.localState = {};
      this.containerEl = null;
      this.effectTimer = null;
    }

    init() {
      this.containerEl = document.getElementById('sideAppRoot');
    }

    /**
     * Renders full view state.
     * @param {{ view: string, state: object, meta?: object }} payload 
     */
    renderFull(payload) {
      if (!payload || !payload.view) return;
      this.currentView = payload.view;
      this.localState = JSON.parse(JSON.stringify(payload.state || {}));

      this.mountCurrentView();
    }

    /**
     * Navigates to a specific view.
     * @param {{ view: string, state?: object }} payload 
     */
    navigate(payload) {
      if (!payload || !payload.view) return;
      this.currentView = payload.view;
      if (payload.state) {
        this.localState = JSON.parse(JSON.stringify(payload.state));
      }
      this.mountCurrentView();
    }

    /**
     * Applies incremental JSON patch operations.
     * @param {{ ops: Array<{ path: string, value: any }> }} payload 
     */
    applyPatch(payload) {
      if (!payload || !Array.isArray(payload.ops)) return;

      for (const op of payload.ops) {
        setByPath(this.localState, op.path, op.value);
      }

      this.updateDOMFromState();
    }

    /**
     * Plays visual effects (e.g. sound wave pulse, flash).
     * @param {{ name: string, target?: string, duration?: number }} payload 
     */
    playEffect(payload) {
      if (!payload || !payload.name) return;

      if (payload.name === 'audio-playing') {
        const waveBox = document.getElementById('sideAppSoundWave');
        const playRing = document.getElementById('sideAppPlayRing');
        if (waveBox) {
          waveBox.classList.remove('opacity-30', 'scale-90');
          waveBox.classList.add('opacity-100', 'scale-110');
        }
        if (playRing) {
          playRing.classList.add('pulse-ring-active');
        }

        clearTimeout(this.effectTimer);
        this.effectTimer = setTimeout(() => {
          if (waveBox) {
            waveBox.classList.remove('opacity-100', 'scale-110');
            waveBox.classList.add('opacity-30', 'scale-90');
          }
          if (playRing) {
            playRing.classList.remove('pulse-ring-active');
          }
        }, payload.duration || 1200);
      }
    }

    /**
     * Mounts the active view into the container.
     */
    mountCurrentView() {
      if (!this.containerEl) this.init();
      if (!this.containerEl) return;

      switch (this.currentView) {
        case 'viewSelection':
          this.renderSelectionView();
          break;
        case 'viewSession':
          this.renderSessionView();
          break;
        case 'viewSummary':
          this.renderSummaryView();
          break;
        default:
          // Unknown view: silently ignore or preserve
          break;
      }
    }

    // =========================================================================
    // View 1: Selection & Dashboard View
    // =========================================================================
    renderSelectionView() {
      const s = this.localState || {};
      this.containerEl.innerHTML = `
        <div class="space-y-5 animate-fadeIn">
          <!-- Standby Hero Card -->
          <div class="glass-panel rounded-3xl p-6 sm:p-8 text-center space-y-4 border border-white/10 shadow-2xl relative overflow-hidden">
            <div class="inline-flex h-16 w-16 rounded-2xl bg-gradient-to-tr from-violet-600 to-fuchsia-600 items-center justify-center text-3xl shadow-xl shadow-violet-500/25">
              <i class="ph-bold ph-presentation"></i>
            </div>
            <div class="space-y-1">
              <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                伴侣屏已就绪
              </div>
              <h2 class="text-xl sm:text-2xl font-bold text-white pt-2">等待主机开始听写</h2>
              <p class="text-xs sm:text-sm text-slate-400">
                请在 iMac 操作台选择今日复习或词集，听写卡片与泰文释义将实时呈现在此屏。
              </p>
            </div>
          </div>

          <!-- Stats Grid -->
          <div class="grid grid-cols-3 gap-3">
            <div class="glass-card rounded-2xl p-4 text-center">
              <div class="text-2xl sm:text-3xl font-black text-amber-400">${s.dueCount || '--'}</div>
              <div class="text-[11px] text-slate-400 mt-1">今日待复习</div>
            </div>
            <div class="glass-card rounded-2xl p-4 text-center">
              <div class="text-2xl sm:text-3xl font-black text-violet-300">${s.totalWords || '--'}</div>
              <div class="text-[11px] text-slate-400 mt-1">词库总词数</div>
            </div>
            <div class="glass-card rounded-2xl p-4 text-center">
              <div class="text-2xl sm:text-3xl font-black text-emerald-400">${s.masteredCount || '--'}</div>
              <div class="text-[11px] text-slate-400 mt-1">已牢记熟练</div>
            </div>
          </div>

          <!-- Passive Tip Card -->
          <div class="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-violet-500/20 text-violet-300 flex items-center justify-center shrink-0 text-lg">
              <i class="ph-bold ph-pencil-line"></i>
            </div>
            <div class="text-xs text-slate-400 leading-relaxed">
              听写时学生在笔记本纸上书写拼写；完成核对后可在此屏清晰查看泰文原词与配套例句精讲。
            </div>
          </div>
        </div>
      `;
    }

    // =========================================================================
    // View 2: Active Dictation Session View
    // =========================================================================
    renderSessionView() {
      const s = this.localState || {};
      const isWriting = s.phase === 'writing';
      const isRevealed = s.phase === 'revealed';

      this.containerEl.innerHTML = `
        <div class="space-y-4 animate-fadeIn">
          <!-- Session Header Bar -->
          <div class="glass-panel rounded-2xl px-4 py-3 flex items-center justify-between border border-white/10">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-violet-300">${s.mode === 'reinforce_missed' ? '⚡ 强化练习' : '🎧 智能听写'}</span>
              <span class="text-slate-500 text-xs">·</span>
              <span id="sideSessionProgressText" class="text-xs text-slate-300 font-medium">${s.progressText || ''}</span>
            </div>
            <div class="text-xs font-bold text-emerald-400" id="sideSessionAccuracyText">
              ${s.accuracyText || '100%'}
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="w-full h-1.5 bg-white/10 rounded-full overflow-hidden -mt-2">
            <div id="sideSessionProgressBar" class="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-300" style="width: ${s.progressPercent || 0}%"></div>
          </div>

          <!-- Main Interactive Display Card -->
          <div class="glass-panel rounded-3xl p-5 sm:p-7 border border-white/10 shadow-2xl min-h-[380px] flex flex-col justify-between relative overflow-hidden">
            
            <!-- Header Step Indicator -->
            <div class="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-white/5">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full ${isWriting ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}"></span>
                <span id="sideCardStepLabel" class="font-medium">${isWriting ? '步骤 1/2: 听音并在纸上书写' : '步骤 2/2: 翻开答案核对精读'}</span>
              </div>
              <div class="text-[11px] text-slate-500 font-mono" id="sideCardHistory">
                ${s.history ? `复习:${s.history.repetition || 0}次 · 间隔:${s.history.interval || 0}天` : ''}
              </div>
            </div>

            <!-- Content: Writing Phase -->
            <div id="sidePhaseWriting" class="${isWriting ? '' : 'hidden'} py-8 flex flex-col items-center justify-center text-center space-y-6">
              <div class="relative">
                <div id="sideAppPlayRing" class="w-24 h-24 rounded-full bg-gradient-to-tr from-violet-600 to-fuchsia-600 text-white flex items-center justify-center text-4xl shadow-xl shadow-violet-500/30">
                  <i class="ph-fill ph-speaker-high"></i>
                </div>
              </div>

              <!-- Sound Wave Indicator -->
              <div id="sideAppSoundWave" class="sound-wave opacity-40 scale-90 transition-all duration-300">
                <div class="sound-bar"></div>
                <div class="sound-bar"></div>
                <div class="sound-bar"></div>
                <div class="sound-bar"></div>
                <div class="sound-bar"></div>
              </div>

              <div class="max-w-xs mx-auto p-4 rounded-2xl bg-violet-950/40 border border-violet-500/30 space-y-1">
                <div class="text-sm font-semibold text-violet-200">请在纸上默写此泰语词</div>
                <p class="text-xs text-slate-400">
                  原词拼写与释义已自动遮蔽，导师翻开答案后将同步展现。
                </p>
              </div>

              <div class="text-xs text-slate-500 flex items-center gap-1.5">
                <i class="ph-bold ph-hourglass-high text-violet-400 animate-spin"></i>
                <span>等待主操作台评阅与翻开...</span>
              </div>
            </div>

            <!-- Content: Revealed Phase -->
            <div id="sidePhaseRevealed" class="${isRevealed ? '' : 'hidden'} py-4 space-y-5">
              <!-- Big Thai Word Card -->
              <div class="p-5 rounded-2xl bg-white/5 border border-white/10 text-center space-y-2">
                <div id="sideRevealedThai" class="font-thai text-4xl sm:text-5xl font-black text-white tracking-wider py-1 select-all">
                  ${s.thaiWord || '--'}
                </div>
                <div class="flex items-center justify-center gap-2 text-sm flex-wrap">
                  <span id="sideRevealedPhonetic" class="px-2.5 py-0.5 rounded-lg bg-violet-500/20 text-violet-300 font-mono text-xs font-semibold">
                    ${s.phonetic || '--'}
                  </span>
                  <span class="text-slate-500">·</span>
                  <span id="sideRevealedMeaning" class="text-slate-100 font-bold text-base">
                    ${s.meaning || '--'}
                  </span>
                </div>
              </div>

              <!-- Examples Sentences -->
              <div class="space-y-2">
                <div class="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <i class="ph-bold ph-chat-text text-violet-400"></i>
                  配套例句精讲 (Example Sentences)
                </div>
                <div id="sideRevealedExamples" class="space-y-2 max-h-48 overflow-y-auto">
                  ${this.renderExamplesHtml(s.examples)}
                </div>
              </div>
            </div>

            <!-- Footer Status -->
            <div class="pt-3 text-center text-[11px] text-slate-500 border-t border-white/5">
              第二屏幕被动同步中 · 所有操作由 iMac 主机控制
            </div>

          </div>
        </div>
      `;
    }

    renderExamplesHtml(examples) {
      if (!examples || !Array.isArray(examples) || examples.length === 0) {
        return `<div class="p-3 rounded-xl bg-white/5 text-xs text-slate-400 text-center">该词暂无例句</div>`;
      }
      return examples.map(ex => `
        <div class="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
          <div class="font-thai text-sm text-violet-200 font-medium">${ex.thai || ''}</div>
          <div class="text-xs text-slate-300">${ex.translation || ''}</div>
        </div>
      `).join('');
    }

    // =========================================================================
    // View 3: Session Summary View
    // =========================================================================
    renderSummaryView() {
      const s = this.localState || {};
      const results = s.results || [];

      this.containerEl.innerHTML = `
        <div class="space-y-5 animate-fadeIn">
          <!-- Celebration Header -->
          <div class="glass-panel rounded-3xl p-6 text-center space-y-3 border border-white/10 shadow-2xl">
            <div class="inline-flex h-16 w-16 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-500 items-center justify-center text-3xl shadow-xl shadow-emerald-500/25">
              🎉
            </div>
            <h2 class="text-xl sm:text-2xl font-black text-white">本次听写练习已完成！</h2>
            <p class="text-xs text-slate-400">成绩与 SM-2 记忆间隔已保存至数据库</p>

            <!-- Metrics Grid -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">
              <div class="glass-card rounded-2xl p-3">
                <div class="text-xs text-slate-400">听写词数</div>
                <div class="text-xl font-bold text-white mt-0.5">${s.totalCount || results.length}</div>
              </div>
              <div class="glass-card rounded-2xl p-3">
                <div class="text-xs text-slate-400">正确数量</div>
                <div class="text-xl font-bold text-emerald-400 mt-0.5">${s.correctCount || '--'}</div>
              </div>
              <div class="glass-card rounded-2xl p-3">
                <div class="text-xs text-slate-400">正确率</div>
                <div class="text-xl font-bold text-violet-400 mt-0.5">${s.accuracy || '--'}</div>
              </div>
              <div class="glass-card rounded-2xl p-3">
                <div class="text-xs text-slate-400">遗忘需复习</div>
                <div class="text-xl font-bold text-red-400 mt-0.5">${s.forgotCount || 0}</div>
              </div>
            </div>
          </div>

          <!-- Words Breakdown List -->
          <div class="glass-panel rounded-3xl p-4 sm:p-5 border border-white/10 space-y-3">
            <div class="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>本次听写生词明细:</span>
              <span class="text-slate-500">${results.length} 词</span>
            </div>

            <div class="space-y-2 max-h-64 overflow-y-auto">
              ${results.map(r => `
                <div class="p-2.5 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between gap-3 text-xs">
                  <div class="space-y-0.5">
                    <div class="font-thai font-bold text-white text-sm">${r.thaiWord || '--'}</div>
                    <div class="text-[11px] text-slate-400">${r.meaning || '--'} · <span class="font-mono text-violet-300">${r.phonetic || ''}</span></div>
                  </div>
                  <div class="text-right">
                    <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold ${r.rating >= 3 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}">
                      ${r.rating >= 3 ? '✅ 正确' : '❌ 遗忘'}
                    </span>
                    <div class="text-[10px] text-slate-500 mt-0.5">${r.interval || 1} 天后</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }

    /**
     * Efficiently updates DOM elements when a partial patch arrives without full redraw.
     */
    updateDOMFromState() {
      const s = this.localState || {};

      // If phase changed between writing and revealed
      const writingBox = document.getElementById('sidePhaseWriting');
      const revealedBox = document.getElementById('sidePhaseRevealed');
      const stepLabel = document.getElementById('sideCardStepLabel');

      if (writingBox && revealedBox && s.phase) {
        if (s.phase === 'writing') {
          writingBox.classList.remove('hidden');
          revealedBox.classList.add('hidden');
          if (stepLabel) stepLabel.innerText = '步骤 1/2: 听音并在纸上书写';
        } else if (s.phase === 'revealed') {
          writingBox.classList.add('hidden');
          revealedBox.classList.remove('hidden');
          if (stepLabel) stepLabel.innerText = '步骤 2/2: 翻开答案核对精读';
        }
      }

      // Update text fields
      const pText = document.getElementById('sideSessionProgressText');
      if (pText && s.progressText) pText.innerText = s.progressText;

      const pBar = document.getElementById('sideSessionProgressBar');
      if (pBar && s.progressPercent !== undefined) pBar.style.width = `${s.progressPercent}%`;

      const accText = document.getElementById('sideSessionAccuracyText');
      if (accText && s.accuracyText) accText.innerText = s.accuracyText;

      const thaiText = document.getElementById('sideRevealedThai');
      if (thaiText && s.thaiWord) thaiText.innerText = s.thaiWord;

      const phonText = document.getElementById('sideRevealedPhonetic');
      if (phonText && s.phonetic) phonText.innerText = s.phonetic;

      const meanText = document.getElementById('sideRevealedMeaning');
      if (meanText && s.meaning) meanText.innerText = s.meaning;

      const exBox = document.getElementById('sideRevealedExamples');
      if (exBox && s.examples) exBox.innerHTML = this.renderExamplesHtml(s.examples);

      const histEl = document.getElementById('sideCardHistory');
      if (histEl && s.history) {
        histEl.innerText = `复习:${s.history.repetition || 0}次 · 间隔:${s.history.interval || 0}天`;
      }
    }
  }

  window.sideAppRenderer = new SideAppRenderer();
})(window);
