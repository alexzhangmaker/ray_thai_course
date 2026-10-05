/**
 * SideApp Mobile Client Renderer
 * Passively renders Master App UI state for mobile screens (iPhone, iPad).
 * Pure state-to-DOM mapping with zero business logic.
 */

(function (window) {
  // Simple HTML escaper
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

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
      this.pdfDoc = null;
      this.currentPdfSource = null;
      this.currentPdfPageNum = null;
      this.isRenderingPdf = false;
      this.renderPendingPage = null;
      this.currentRenderTask = null;
      this.pdfZoom = 1.0;
      this._resizeTimer = null;
      this.isPdfMaximized = false;
    }

    escape(str) {
      return escapeHtml(str);
    }

    init() {
      this.containerEl = document.getElementById('sideAppRoot');
      const onViewportChange = () => {
        if (this.currentView === 'viewCourseReviewPdf' && this.currentPdfPageNum) {
          clearTimeout(this._resizeTimer);
          this._resizeTimer = setTimeout(() => {
            this.renderPdfPage(this.currentPdfPageNum);
          }, 150);
        }
      };
      window.addEventListener('resize', onViewportChange);
      window.addEventListener('orientationchange', () => {
        setTimeout(onViewportChange, 200);
      });

      // Listen for fullscreen change events specifically for courseware content viewport
      const handleFsChange = () => {
        const viewport = document.getElementById('sidePdfViewport');
        if (!viewport) return;
        const isFs = (
          document.fullscreenElement === viewport ||
          document.webkitFullscreenElement === viewport ||
          document.mozFullScreenElement === viewport ||
          document.msFullscreenElement === viewport
        );
        if (!isFs && this.isPdfMaximized && !viewport.classList.contains('side-pdf-content-fullscreen')) {
          this.isPdfMaximized = false;
          this.updatePdfMaximizeUI(false);
          if (this.currentPdfPageNum) {
            setTimeout(() => this.renderPdfPage(this.currentPdfPageNum), 120);
          }
        } else if (isFs && !this.isPdfMaximized) {
          this.isPdfMaximized = true;
          this.updatePdfMaximizeUI(true);
          if (this.currentPdfPageNum) {
            setTimeout(() => this.renderPdfPage(this.currentPdfPageNum), 120);
          }
        }
      };
      ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evt => {
        document.addEventListener(evt, handleFsChange);
      });

      // Escape key to exit pseudo fullscreen for courseware content
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isPdfMaximized) {
          this.togglePdfContentMaximize();
        }
      });
    }

    /**
     * Renders full view state.
     * @param {{ view: string, state: object, meta?: object }} payload 
     */
    renderFull(payload) {
      if (!payload || !payload.view) return;

      // Update header subheader & badge dynamically
      if (payload.meta && payload.meta.title) {
        const subheader = document.getElementById('sideAppSubheader');
        if (subheader) subheader.innerText = payload.meta.title;
      }
      const isCoreWords = (payload.view && payload.view.startsWith('viewCoreWords')) ||
                          (payload.state && payload.state.appType === 'core_words');
      const isTranslate = (payload.view && payload.view.startsWith('viewTranslate')) ||
                          (payload.state && payload.state.appType === 'translate');
      const isCourseReview = (payload.view && payload.view.startsWith('viewCourseReview')) ||
                             (payload.state && payload.state.appType === 'course_review');
      const badge = document.getElementById('sideAppBadge');
      if (badge) {
        if (isCourseReview) {
          badge.innerText = 'CourseReview';
          badge.className = 'text-[9px] uppercase font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30';
        } else if (isTranslate) {
          badge.innerText = 'Translate';
          badge.className = 'text-[9px] uppercase font-bold px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30';
        } else if (isCoreWords) {
          badge.innerText = 'CoreWords';
          badge.className = 'text-[9px] uppercase font-bold px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30';
        } else {
          badge.innerText = 'Dictation';
          badge.className = 'text-[9px] uppercase font-bold px-1.5 py-0.2 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30';
        }
      }

      const isSameView = this.currentView === payload.view;
      const isSameState = isSameView && JSON.stringify(this.localState) === JSON.stringify(payload.state || {});

      this.currentView = payload.view;
      this.localState = JSON.parse(JSON.stringify(payload.state || {}));

      // If view and state are identical and DOM is already mounted, skip redraw to avoid screen flickering
      if (isSameState && this.containerEl && this.containerEl.children.length > 0) {
        return;
      }

      // If already in viewCourseReviewPdf and canvas is present, avoid rebuilding entire DOM - just update and render
      if (isSameView && this.currentView === 'viewCourseReviewPdf' && document.getElementById('sidePdfCanvas')) {
        this.updateDOMFromState();
        return;
      }

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
        const waveBox = document.getElementById('sideTranslateSoundWave') || document.getElementById('sideCoreSoundWave') || document.getElementById('sideAppSoundWave');
        const playRing = document.getElementById('sideTranslatePlayRing') || document.getElementById('sideCorePlayRing') || document.getElementById('sideAppPlayRing');
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
      } else if (payload.name === 'detail-revealed') {
        const revealed = document.getElementById('sideTranslateAnswerRevealed') || document.getElementById('sideCoreWordRevealed');
        if (revealed) {
          revealed.classList.add('ring-2', 'ring-sky-400/60');
          setTimeout(() => {
            revealed.classList.remove('ring-2', 'ring-sky-400/60');
          }, payload.duration || 800);
        }
      }
    }

    /**
     * Mounts the active view into the container.
     */
    mountCurrentView() {
      if (!this.containerEl) this.init();
      if (!this.containerEl) return;

      this.containerEl.classList.remove('max-w-lg', 'max-w-3xl');

      switch (this.currentView) {
        case 'viewSelection':
          this.renderSelectionView();
          break;
        case 'viewSession':
          if (this.localState && this.localState.appType === 'core_words') {
            this.renderCoreWordsSessionView();
          } else if (this.localState && this.localState.appType === 'translate') {
            this.renderTranslateSessionView();
          } else {
            this.renderSessionView();
          }
          break;
        case 'viewReinforceTransition':
          this.renderReinforceTransitionView();
          break;
        case 'viewSummary':
          if (this.localState && this.localState.appType === 'core_words') {
            this.renderCoreWordsSummaryView();
          } else {
            this.renderSummaryView();
          }
          break;
        case 'viewCoreWordsSelection':
          this.renderCoreWordsSelectionView();
          break;
        case 'viewCoreWordsSession':
          this.renderCoreWordsSessionView();
          break;
        case 'viewCoreWordsSummary':
          this.renderCoreWordsSummaryView();
          break;
        case 'viewTranslateSession':
          this.renderTranslateSessionView();
          break;
        case 'viewTranslateList':
          this.renderTranslateListView();
          break;
        case 'viewCourseReviewPdf':
          this.renderCourseReviewPdfView();
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
        <div class="w-full h-full max-w-4xl flex flex-col justify-center gap-3 sm:gap-4 min-h-0 animate-fadeIn">
          <!-- Standby Hero Card -->
          <div class="glass-panel rounded-3xl p-5 sm:p-8 text-center space-y-3 sm:space-y-4 border border-white/10 shadow-2xl relative overflow-hidden flex-1 min-h-0 flex flex-col justify-center items-center">
            <div class="inline-flex h-14 w-14 sm:h-18 sm:w-18 rounded-2xl bg-gradient-to-tr from-violet-600 to-fuchsia-600 items-center justify-center text-2xl sm:text-3xl shadow-xl shadow-violet-500/25 shrink-0">
              <i class="ph-bold ph-presentation"></i>
            </div>
            <div class="space-y-1 sm:space-y-2 max-w-md mx-auto">
              <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                伴侣屏已就绪
              </div>
              <h2 class="text-lg sm:text-2xl font-bold text-white pt-1">等待主机开始听写</h2>
              <p class="text-xs sm:text-sm text-slate-400">
                请在 iMac 操作台选择今日复习或词集，听写卡片与泰文释义将实时自适应最大化呈现在此屏。
              </p>
            </div>
          </div>

          <!-- Stats Grid -->
          <div class="grid grid-cols-3 gap-2.5 sm:gap-3 shrink-0">
            <div class="glass-card rounded-2xl p-3 sm:p-4 text-center">
              <div class="text-xl sm:text-3xl font-black text-amber-400">${s.dueCount || '--'}</div>
              <div class="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1">今日待复习</div>
            </div>
            <div class="glass-card rounded-2xl p-3 sm:p-4 text-center">
              <div class="text-xl sm:text-3xl font-black text-violet-300">${s.totalWords || '--'}</div>
              <div class="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1">词库总词数</div>
            </div>
            <div class="glass-card rounded-2xl p-3 sm:p-4 text-center">
              <div class="text-xl sm:text-3xl font-black text-emerald-400">${s.masteredCount || '--'}</div>
              <div class="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1">已牢记熟练</div>
            </div>
          </div>

          <!-- Passive Tip Card -->
          <div class="p-3 sm:p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3 shrink-0">
            <div class="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-violet-500/20 text-violet-300 flex items-center justify-center shrink-0 text-base sm:text-lg">
              <i class="ph-bold ph-pencil-line"></i>
            </div>
            <div class="text-[11px] sm:text-xs text-slate-400 leading-relaxed">
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
      const isReinforce = s.mode === 'reinforce_missed';

      this.containerEl.innerHTML = `
        <div class="w-full h-full max-w-4xl flex flex-col justify-between gap-2.5 sm:gap-3.5 min-h-0 animate-fadeIn">
          <!-- Session Header Bar -->
          <div class="glass-panel rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between border border-white/10 shrink-0">
            <div class="flex items-center gap-2 truncate">
              <span class="text-xs font-bold ${isReinforce ? 'text-rose-300 bg-rose-500/20 px-2.5 py-0.5 rounded-full border border-rose-500/30' : 'text-violet-300'} truncate">
                ${isReinforce ? '⚡ ' + (s.reinforceTitle || '错词强化') + ' · 第 ' + (s.roundNum || 1) + ' 轮' : '🎧 智能听写'}
              </span>
              <span class="text-slate-500 text-xs">·</span>
              <span id="sideSessionProgressText" class="text-xs text-slate-300 font-medium whitespace-nowrap">${s.progressText || ''}</span>
            </div>
            <div class="text-xs font-bold ${isReinforce ? 'text-rose-300' : 'text-emerald-400'} shrink-0 ml-2" id="sideSessionAccuracyText">
              ${s.accuracyText || '100%'}
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="w-full h-1.5 bg-white/10 rounded-full overflow-hidden shrink-0 -mt-1 sm:-mt-1.5">
            <div id="sideSessionProgressBar" class="h-full ${isReinforce ? 'bg-gradient-to-r from-rose-500 via-amber-500 to-emerald-500' : 'bg-gradient-to-r from-violet-500 to-fuchsia-500'} rounded-full transition-all duration-300" style="width: ${s.progressPercent || 0}%"></div>
          </div>

          <!-- Main Interactive Display Card -->
          <div class="flex-1 min-h-0 w-full glass-panel rounded-2xl sm:rounded-3xl p-3.5 sm:p-6 md:p-7 border border-white/10 shadow-2xl flex flex-col justify-between relative overflow-hidden">
            
            <!-- Header Step Indicator -->
            <div class="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-white/5 shrink-0">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full ${isWriting ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}"></span>
                <span id="sideCardStepLabel" class="font-medium">${isWriting ? '步骤 1/2: 听音并在纸上书写' : '步骤 2/2: 翻开答案核对精读'}</span>
              </div>
              <div class="text-[11px] text-slate-400 font-mono flex items-center gap-1.5" id="sideCardHistory">
                ${isReinforce 
                  ? `<span class="text-rose-400 font-semibold"><i class="ph-bold ph-lightning"></i> 失误:${s.history?.missCount || 1}次</span><span>·</span><span>复习:${s.history?.repetition != null ? s.history.repetition : 0}次</span><span>·</span><span>间隔:${s.history?.interval != null ? s.history.interval : 1}天</span>` 
                  : (s.history ? `复习:${s.history.repetition != null ? s.history.repetition : 0}次 · 间隔:${s.history.interval != null ? s.history.interval : 1}天` : '')}
              </div>
            </div>

            <!-- Content: Writing Phase -->
            <div id="sidePhaseWriting" class="${isWriting ? '' : 'hidden'} flex-1 min-h-0 py-4 sm:py-6 flex flex-col items-center justify-center text-center space-y-4 sm:space-y-6 overflow-y-auto">
              <div class="relative">
                <div id="sideAppPlayRing" class="w-20 h-20 sm:w-28 sm:h-28 md:w-32 md:h-32 rounded-full bg-gradient-to-tr from-violet-600 to-fuchsia-600 text-white flex items-center justify-center text-3xl sm:text-5xl md:text-6xl shadow-xl shadow-violet-500/30">
                  <i class="ph-fill ph-speaker-high"></i>
                </div>
              </div>

              <!-- Sound Wave Indicator -->
              <div id="sideAppSoundWave" class="sound-wave opacity-40 scale-90 sm:scale-100 transition-all duration-300">
                <div class="sound-bar"></div>
                <div class="sound-bar"></div>
                <div class="sound-bar"></div>
                <div class="sound-bar"></div>
                <div class="sound-bar"></div>
              </div>

              <div class="max-w-sm mx-auto p-3.5 sm:p-4 rounded-2xl ${isReinforce ? 'bg-rose-950/40 border border-rose-500/30' : 'bg-violet-950/40 border border-violet-500/30'} space-y-1">
                <div class="text-xs sm:text-sm font-semibold ${isReinforce ? 'text-rose-200' : 'text-violet-200'}">
                  ${isReinforce ? '错词循环强化 · 纸面默写' : '请在纸上默写此泰语词'}
                </div>
                <p class="text-[11px] sm:text-xs text-slate-400">
                  ${isReinforce ? '听写完成后由导师评定；评分 ≥ 3 即彻底攻克，< 3 自动进入下一轮。' : '原词拼写与释义已自动遮蔽，导师翻开答案后将同步展现。'}
                </p>
              </div>

              <div class="text-[11px] sm:text-xs text-slate-500 flex items-center gap-1.5">
                <i class="ph-bold ph-hourglass-high text-violet-400 animate-spin"></i>
                <span>等待主操作台评阅与翻开...</span>
              </div>
            </div>

            <!-- Content: Revealed Phase -->
            <div id="sidePhaseRevealed" class="${isRevealed ? '' : 'hidden'} flex-1 min-h-0 py-2 sm:py-3 flex flex-col justify-between space-y-2 sm:space-y-3 overflow-hidden">
              ${isReinforce ? `
                <div class="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 text-center font-medium flex items-center justify-center gap-1.5 shrink-0">
                  <i class="ph-bold ph-lightning"></i>
                  <span>攻克达标规则：评分 ≥ 3 彻底达标移出；评分 &lt; 3 自动进入下一轮强化循环</span>
                </div>
              ` : ''}

              <!-- Big Thai Word Card -->
              <div class="p-3.5 sm:p-6 rounded-2xl bg-white/5 border border-white/10 text-center space-y-1 sm:space-y-2 shrink-0">
                <div id="sideRevealedThai" class="font-thai text-4xl sm:text-6xl md:text-7xl font-black text-white tracking-wider py-1 select-all">
                  ${s.thaiWord || '--'}
                </div>
                <div class="flex items-center justify-center gap-2 text-sm flex-wrap">
                  <span id="sideRevealedPhonetic" class="px-2.5 py-0.5 rounded-lg bg-violet-500/20 text-violet-300 font-mono text-xs sm:text-sm font-semibold">
                    ${s.phonetic || '--'}
                  </span>
                  <span class="text-slate-500">·</span>
                  <span id="sideRevealedMeaning" class="text-slate-100 font-bold text-base sm:text-xl">
                    ${s.meaning || '--'}
                  </span>
                </div>
              </div>

              <!-- Examples Sentences -->
              <div class="flex-1 min-h-0 flex flex-col space-y-1.5 overflow-hidden">
                <div class="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 shrink-0">
                  <i class="ph-bold ph-chat-text text-violet-400"></i>
                  配套例句精讲 (Example Sentences)
                </div>
                <div id="sideRevealedExamples" class="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
                  ${this.renderExamplesHtml(s.examples)}
                </div>
              </div>
            </div>

            <!-- Footer Status -->
            <div class="pt-2 text-center text-[10px] sm:text-[11px] text-slate-500 border-t border-white/5 shrink-0">
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
    // View 2.5: Reinforce Round Transition View
    // =========================================================================
    renderReinforceTransitionView() {
      const s = this.localState || {};
      const failedWords = s.failedWords || [];
      const roundNum = s.roundNum || 1;
      const nextRound = s.nextRoundNum || (roundNum + 1);

      this.containerEl.innerHTML = `
        <div class="w-full h-full max-w-4xl flex flex-col justify-between gap-2.5 sm:gap-3.5 min-h-0 animate-fadeIn">
          <!-- Transition Header Card -->
          <div class="glass-panel rounded-3xl p-4 sm:p-6 text-center space-y-3 border border-amber-500/30 shadow-2xl relative overflow-hidden shrink-0">
            <div class="inline-flex h-12 w-12 sm:h-16 sm:w-16 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 items-center justify-center text-2xl sm:text-3xl shadow-xl shadow-amber-500/25">
              <i class="ph-bold ph-arrows-clockwise animate-spin" style="animation-duration: 4s;"></i>
            </div>
            
            <div class="space-y-1">
              <div class="inline-flex items-center gap-2 px-3 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold">
                <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                第 ${roundNum} 轮强化结束
              </div>
              <h2 class="text-lg sm:text-2xl font-bold text-white pt-1">准备进入第 ${nextRound} 轮循环</h2>
              <p class="text-xs text-slate-300 leading-relaxed max-w-md mx-auto">
                本轮已成功纠正攻克 <strong class="text-emerald-400 font-bold">${s.passedCount || 0}</strong> 词，仍有 <strong class="text-rose-400 font-bold">${s.failedCount || failedWords.length}</strong> 词评分 &lt; 3 需继续强化。<br>即将开启第 <strong>${nextRound}</strong> 轮循环练习！
              </p>
            </div>

            <!-- Stats Bar -->
            <div class="grid grid-cols-2 gap-2.5 pt-1 max-w-xs mx-auto">
              <div class="glass-card rounded-2xl p-2.5 border border-emerald-500/20 bg-emerald-500/5">
                <div class="text-xl sm:text-2xl font-bold text-emerald-400">${s.passedCount || 0}</div>
                <div class="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">本轮攻克达标</div>
              </div>
              <div class="glass-card rounded-2xl p-2.5 border border-rose-500/20 bg-rose-500/5">
                <div class="text-xl sm:text-2xl font-bold text-rose-400">${s.failedCount || failedWords.length}</div>
                <div class="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">继续循环强化</div>
              </div>
            </div>
          </div>

          <!-- Pending Words Preview -->
          <div class="glass-panel rounded-3xl p-3.5 sm:p-5 border border-white/10 space-y-2 flex-1 min-h-0 flex flex-col overflow-hidden">
            <div class="text-xs font-semibold text-slate-300 flex items-center justify-between shrink-0">
              <span class="flex items-center gap-1.5 text-rose-300 font-bold">
                <i class="ph-bold ph-target"></i> 下一轮待强化单词:
              </span>
              <span class="text-slate-400 text-xs">${failedWords.length} 词</span>
            </div>

            <div class="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
              ${failedWords.map(w => `
                <div class="p-2.5 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between gap-3 text-xs">
                  <div class="space-y-0.5">
                    <div class="font-thai font-bold text-white text-base">${w.thaiWord || '--'}</div>
                    <div class="text-[11px] text-slate-400">${w.meaning || '--'} · <span class="font-mono text-violet-300">${w.phonetic || ''}</span></div>
                  </div>
                  <div class="text-right shrink-0">
                    <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                      待强化
                    </span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Footer Status -->
          <div class="p-2.5 rounded-2xl bg-white/5 border border-white/5 text-center text-xs text-slate-400 flex items-center justify-center gap-2 shrink-0">
            <i class="ph-bold ph-hourglass text-amber-400 animate-spin"></i>
            <span>请在 iMac 主机操作台按回车键开启第 ${nextRound} 轮</span>
          </div>
        </div>
      `;
    }

    // =========================================================================
    // View 3: Session Summary View
    // =========================================================================
    renderSummaryView() {
      const s = this.localState || {};
      const results = s.results || [];
      const isReinforce = s.isReinforce || s.mode === 'reinforce_missed';

      if (isReinforce) {
        this.containerEl.innerHTML = `
          <div class="w-full h-full max-w-4xl flex flex-col justify-between gap-2.5 sm:gap-3.5 min-h-0 animate-fadeIn">
            <!-- Celebration Header -->
            <div class="glass-panel rounded-3xl p-4 sm:p-6 text-center space-y-2.5 border border-emerald-500/30 shadow-2xl relative overflow-hidden shrink-0">
              <div class="inline-flex h-12 w-12 sm:h-16 sm:w-16 rounded-2xl bg-gradient-to-tr from-rose-500 via-amber-500 to-emerald-500 items-center justify-center text-2xl sm:text-3xl shadow-xl shadow-emerald-500/25">
                🎉
              </div>
              <div class="space-y-0.5">
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  错词循环强化圆满成功
                </span>
                <h2 class="text-lg sm:text-2xl font-black text-white pt-0.5">全量错词已全部攻克达标！</h2>
                <p class="text-xs text-slate-300">
                  历经 <strong>${s.totalRounds || 1}</strong> 轮强化循环，所有错词已达到评分 ≥ 3 分达标线。
                </p>
              </div>

              <!-- Metrics Grid -->
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                <div class="glass-card rounded-2xl p-2.5">
                  <div class="text-xs text-slate-400">攻克词数</div>
                  <div class="text-lg sm:text-xl font-bold text-white mt-0.5">${s.totalCount || results.length}</div>
                </div>
                <div class="glass-card rounded-2xl p-2.5">
                  <div class="text-xs text-slate-400">循环轮次</div>
                  <div class="text-lg sm:text-xl font-bold text-violet-300 mt-0.5">${s.totalRounds || 1} 轮</div>
                </div>
                <div class="glass-card rounded-2xl p-2.5">
                  <div class="text-xs text-slate-400">攻克达标率</div>
                  <div class="text-lg sm:text-xl font-bold text-emerald-400 mt-0.5">100%</div>
                </div>
                <div class="glass-card rounded-2xl p-2.5">
                  <div class="text-xs text-slate-400">遗留错词</div>
                  <div class="text-lg sm:text-xl font-bold text-emerald-400 mt-0.5">0</div>
                </div>
              </div>
            </div>

            <!-- Words Breakdown List -->
            <div class="glass-panel rounded-3xl p-3.5 sm:p-5 border border-white/10 space-y-2 flex-1 min-h-0 flex flex-col overflow-hidden">
              <div class="text-xs font-semibold text-slate-300 flex items-center justify-between shrink-0">
                <span>强化攻克单词明细:</span>
                <span class="text-slate-400">${results.length} 词</span>
              </div>

              <div class="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
                ${results.map(r => `
                  <div class="p-2.5 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between gap-3 text-xs">
                    <div class="space-y-0.5">
                      <div class="font-thai font-bold text-white text-sm sm:text-base">${r.thaiWord || '--'}</div>
                      <div class="text-[11px] text-slate-400">${r.meaning || '--'} · <span class="font-mono text-violet-300">${r.phonetic || ''}</span></div>
                    </div>
                    <div class="text-right shrink-0">
                      <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        ✅ 攻克达标 (第${r.round || 1}轮 · 评分 ${r.rating})
                      </span>
                      <div class="text-[10px] text-slate-500 mt-0.5">${r.interval || 1} 天后复习</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        `;
        return;
      }

      this.containerEl.innerHTML = `
        <div class="w-full h-full max-w-4xl flex flex-col justify-between gap-2.5 sm:gap-3.5 min-h-0 animate-fadeIn">
          <!-- Celebration Header -->
          <div class="glass-panel rounded-3xl p-4 sm:p-6 text-center space-y-2.5 border border-white/10 shadow-2xl shrink-0">
            <div class="inline-flex h-12 w-12 sm:h-16 sm:w-16 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-500 items-center justify-center text-2xl sm:text-3xl shadow-xl shadow-emerald-500/25">
              🎉
            </div>
            <h2 class="text-lg sm:text-2xl font-black text-white">本次听写练习已完成！</h2>
            <p class="text-xs text-slate-400">成绩与 SM-2 记忆间隔已保存至数据库</p>

            <!-- Metrics Grid -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <div class="glass-card rounded-2xl p-2.5">
                <div class="text-xs text-slate-400">听写词数</div>
                <div class="text-lg sm:text-xl font-bold text-white mt-0.5">${s.totalCount || results.length}</div>
              </div>
              <div class="glass-card rounded-2xl p-2.5">
                <div class="text-xs text-slate-400">正确数量</div>
                <div class="text-lg sm:text-xl font-bold text-emerald-400 mt-0.5">${s.correctCount || '--'}</div>
              </div>
              <div class="glass-card rounded-2xl p-2.5">
                <div class="text-xs text-slate-400">正确率</div>
                <div class="text-lg sm:text-xl font-bold text-violet-400 mt-0.5">${s.accuracy || '--'}</div>
              </div>
              <div class="glass-card rounded-2xl p-2.5">
                <div class="text-xs text-slate-400">遗忘需复习</div>
                <div class="text-lg sm:text-xl font-bold text-red-400 mt-0.5">${s.forgotCount || 0}</div>
              </div>
            </div>
          </div>

          <!-- Words Breakdown List -->
          <div class="glass-panel rounded-3xl p-3.5 sm:p-5 border border-white/10 space-y-2 flex-1 min-h-0 flex flex-col overflow-hidden">
            <div class="text-xs font-semibold text-slate-300 flex items-center justify-between shrink-0">
              <span>本次听写生词明细:</span>
              <span class="text-slate-500">${results.length} 词</span>
            </div>

            <div class="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
              ${results.map(r => `
                <div class="p-2.5 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between gap-3 text-xs">
                  <div class="space-y-0.5">
                    <div class="font-thai font-bold text-white text-sm sm:text-base">${r.thaiWord || '--'}</div>
                    <div class="text-[11px] text-slate-400">${r.meaning || '--'} · <span class="font-mono text-violet-300">${r.phonetic || ''}</span></div>
                  </div>
                  <div class="text-right shrink-0">
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
        if (s.mode === 'reinforce_missed') {
          histEl.innerHTML = `<span class="text-rose-400 font-semibold"><i class="ph-bold ph-lightning"></i> 失误:${s.history.missCount || 1}次</span><span>·</span><span>复习:${s.history.repetition != null ? s.history.repetition : 0}次</span><span>·</span><span>间隔:${s.history.interval != null ? s.history.interval : 1}天</span>`;
        } else {
          histEl.innerText = `复习:${s.history.repetition != null ? s.history.repetition : 0}次 · 间隔:${s.history.interval != null ? s.history.interval : 1}天`;
        }
      }

      // ==========================================
      // Incremental patch handling for Core Words
      // ==========================================
      if (this.currentView === 'viewCoreWordsSession' || (s.appType === 'core_words' && this.currentView === 'viewSession')) {
        const shrouded = document.getElementById('sideCoreWordShrouded');
        const revealed = document.getElementById('sideCoreWordRevealed');
        const stepDot = document.getElementById('sideCoreStepDot');
        const stepLabel = document.getElementById('sideCoreStepLabel');

        if (shrouded && revealed && s.detailRevealed !== undefined) {
          if (s.detailRevealed) {
            shrouded.classList.add('hidden');
            revealed.classList.remove('hidden');
            if (stepDot) stepDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
            if (stepLabel) stepLabel.innerText = '步骤 2/2: 已翻开释义与例句精读';
          } else {
            shrouded.classList.remove('hidden');
            revealed.classList.add('hidden');
            if (stepDot) stepDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
            if (stepLabel) stepLabel.innerText = '步骤 1/2: 认读泰语单词 (释义遮蔽中)';
          }
        }

        const thaiEl = document.getElementById('sideCoreThaiWord');
        if (thaiEl && s.word?.word) thaiEl.innerText = s.word.word;

        const ipaEl = document.getElementById('sideCoreIpa');
        if (ipaEl && s.word?.ipa) {
          ipaEl.innerText = s.word.ipa;
          ipaEl.classList.remove('hidden');
        }

        const progText = document.getElementById('sideCoreProgressText');
        if (progText && s.progressText) progText.innerText = s.progressText;

        const progBar = document.getElementById('sideCoreProgressBar');
        if (progBar && s.progressPercent !== undefined) progBar.style.width = `${s.progressPercent}%`;

        const progPct = document.getElementById('sideCoreProgressPct');
        if (progPct && s.progressPercent !== undefined) progPct.innerText = `${s.progressPercent}%`;

        const wordIdx = document.getElementById('sideCoreWordIndex');
        if (wordIdx && s.currentIndex && s.totalWords) wordIdx.innerText = `#${s.currentIndex} / ${s.totalWords}`;

        const meaningsList = document.getElementById('sideCoreMeaningsList');
        if (meaningsList && s.word) {
          meaningsList.innerHTML = this.renderCoreWordMeaningsHtml(s.word);
        }
      }

      // ==========================================
      // Incremental patch handling for Translate Practice
      // ==========================================
      if (this.currentView === 'viewTranslateSession' || (s.appType === 'translate' && this.currentView === 'viewSession')) {
        const shrouded = document.getElementById('sideTranslateAnswerShrouded');
        const revealed = document.getElementById('sideTranslateAnswerRevealed');
        const stepDot = document.getElementById('sideTranslateStepDot');
        const stepLabel = document.getElementById('sideTranslateStepLabel');

        const isZh2Th = (s.mode === 'zh2th' || s.currentStep === 2);

        if (shrouded && revealed && s.answerRevealed !== undefined) {
          if (s.answerRevealed) {
            shrouded.classList.add('hidden');
            revealed.classList.remove('hidden');
            if (stepDot) stepDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
            if (stepLabel) stepLabel.innerText = '步骤：已揭晓参考答案与词汇解析';
          } else {
            shrouded.classList.remove('hidden');
            revealed.classList.add('hidden');
            if (stepDot) stepDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
            if (stepLabel) stepLabel.innerText = isZh2Th ? '练习：请将下方中文翻译为泰语 (答案遮蔽中)' : '练习：请将下方泰语翻译为中文 (答案遮蔽中)';
          }
        }

        const questionEl = document.getElementById('sideTranslateQuestionText');
        if (questionEl && s.sentence) {
          questionEl.innerText = isZh2Th ? (s.sentence.chinese || '') : (s.sentence.thai || '');
        }

        const progText = document.getElementById('sideTranslateProgressText');
        if (progText && s.progressText) progText.innerText = s.progressText;

        const progBar = document.getElementById('sideTranslateProgressBar');
        if (progBar && s.progressPercent !== undefined) progBar.style.width = `${s.progressPercent}%`;

        const progPct = document.getElementById('sideTranslateProgressPct');
        if (progPct && s.progressPercent !== undefined) progPct.innerText = `${s.progressPercent}%`;

        const sentenceIdx = document.getElementById('sideTranslateSentenceIndex');
        if (sentenceIdx && s.currentIndex && s.totalCount) sentenceIdx.innerText = `#${s.currentIndex} / ${s.totalCount}`;

        const answerTextEl = document.getElementById('sideTranslateAnswerText');
        if (answerTextEl && s.sentence) {
          answerTextEl.innerText = isZh2Th ? (s.sentence.thai || '') : (s.sentence.chinese || '');
        }

        const englishEl = document.getElementById('sideTranslateEnglishText');
        if (englishEl && s.sentence?.english) {
          englishEl.innerText = s.sentence.english;
        }

        const glossaryList = document.getElementById('sideTranslateGlossaryList');
        if (glossaryList && s.sentence) {
          glossaryList.innerHTML = this.renderTranslateGlossaryHtml(s.sentence.glossary || s.sentence.tokens);
        }
      }

      // ==========================================
      // Incremental patch handling for Course Review PDF
      // ==========================================
      if (this.currentView === 'viewCourseReviewPdf' || (s.appType === 'course_review' && this.currentView === 'viewCourseReviewPdf')) {
        const titleEl = document.getElementById('sideCoursewareTitle');
        const fsTitleEl = document.getElementById('sidePdfFsTitle');
        if (s.coursewareTitle) {
          if (titleEl) titleEl.innerText = s.coursewareTitle;
          if (fsTitleEl) fsTitleEl.innerText = s.coursewareTitle;
        }

        const stepBadge = document.getElementById('sideCoursewareStepBadge');
        if (stepBadge && s.stepName) {
          stepBadge.innerText = s.stepName;
        }

        const topicEl = document.getElementById('sideCoursewarePageTopic');
        if (topicEl && s.pageTitle) {
          topicEl.innerText = s.pageTitle;
        }

        const pageBadge = document.getElementById('sideCoursewarePageBadge');
        const fsPageBadge = document.getElementById('sidePdfFsPageBadge');
        if (s.pageNum != null || s.totalPages != null) {
          const pageStr = `Page ${s.pageNum || 1} / ${s.totalPages || 1}`;
          if (pageBadge) pageBadge.innerText = pageStr;
          if (fsPageBadge) fsPageBadge.innerText = pageStr;
        }

        const syncStatusText = document.getElementById('sidePdfSyncStatusText');
        if (syncStatusText && s.pageNum != null) {
          syncStatusText.innerText = `同步翻页 (Page ${s.pageNum})`;
        }

        const notesSummary = document.getElementById('sideCoursewareNotesSummary');
        if (notesSummary) {
          const parts = [];
          if (s.corePointsCount) parts.push(`${s.corePointsCount}个考点`);
          if (s.flashcardsCount) parts.push(`${s.flashcardsCount}张闪卡`);
          notesSummary.innerText = parts.join(' · ');
        }

        // If pdfUrl changed, load and render new PDF
        if (s.pdfUrl && s.pdfUrl !== this.currentPdfSource) {
          this.loadAndRenderCoursePdf(s.pdfUrl, s.pageNum || 1);
        } else if (s.pageNum != null && s.pageNum !== this.currentPdfPageNum) {
          // Same PDF, page changed -> switch page!
          this.renderPdfPage(s.pageNum);
        }
      }
    }

    // =========================================================================
    // View 4: Core Words Selection & Dashboard View
    // =========================================================================
    renderCoreWordsSelectionView() {
      const s = this.localState || {};
      this.containerEl.innerHTML = `
        <div class="w-full h-full max-w-4xl flex flex-col justify-center gap-3 sm:gap-4 min-h-0 animate-fadeIn">
          <!-- Standby Hero Card -->
          <div class="glass-panel rounded-3xl p-5 sm:p-8 text-center space-y-3 sm:space-y-4 border border-white/10 shadow-2xl relative overflow-hidden flex-1 min-h-0 flex flex-col justify-center items-center">
            <div class="inline-flex h-14 w-14 sm:h-18 sm:w-18 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 items-center justify-center text-2xl sm:text-3xl shadow-xl shadow-indigo-500/25 shrink-0">
              <i class="ph-bold ph-book-open"></i>
            </div>
            <div class="space-y-1 sm:space-y-2 max-w-md mx-auto">
              <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                伴侣屏已就绪 · 核心词汇模式
              </div>
              <h2 class="text-lg sm:text-2xl font-bold text-white pt-1">${s.wordsetTitle ? `已选「${this.escape(s.wordsetTitle)}」` : (s.lessonTitle ? this.escape(s.lessonTitle) : '等待主机开始自测')}</h2>
              <p class="text-xs sm:text-sm text-slate-400">
                ${s.courseName ? `${this.escape(s.courseName)} · ` : ''}在 iMac 操作台开启自测后，单词卡片将同步在此屏展现。
              </p>
            </div>
          </div>

          <!-- Stats Grid -->
          <div class="grid grid-cols-3 gap-2.5 sm:gap-3 shrink-0">
            <div class="glass-card rounded-2xl p-3 sm:p-4 text-center">
              <div class="text-xl sm:text-3xl font-black text-indigo-300">${s.totalWords != null ? s.totalWords : '--'}</div>
              <div class="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1">词集总词数</div>
            </div>
            <div class="glass-card rounded-2xl p-3 sm:p-4 text-center">
              <div class="text-xl sm:text-3xl font-black text-emerald-400">${s.reviewedCount != null ? s.reviewedCount : '--'}</div>
              <div class="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1">已完成复习</div>
            </div>
            <div class="glass-card rounded-2xl p-3 sm:p-4 text-center">
              <div class="text-xl sm:text-3xl font-black text-amber-400">${s.pendingCount != null ? s.pendingCount : '--'}</div>
              <div class="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1">待复习自测</div>
            </div>
          </div>

          <!-- Passive Tip Card -->
          <div class="p-3 sm:p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3 shrink-0">
            <div class="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-indigo-500/20 text-indigo-300 flex items-center justify-center shrink-0 text-base sm:text-lg">
              <i class="ph-bold ph-lightbulb-filament"></i>
            </div>
            <div class="text-[11px] sm:text-xs text-slate-400 leading-relaxed">
              自测开始后，伴侣屏将首先显示泰语原词供认读回忆；待导师在主操作台点击「展示解释与例句」后，完整释义与例句精讲将同步揭晓。
            </div>
          </div>
        </div>
      `;
    }

    // =========================================================================
    // View 5: Core Words Active Flashcard Session View
    // =========================================================================
    renderCoreWordsSessionView() {
      const s = this.localState || {};
      const w = s.word || {};
      const isRevealed = Boolean(s.detailRevealed);

      this.containerEl.innerHTML = `
        <div class="w-full h-full max-w-4xl flex flex-col justify-between gap-2.5 sm:gap-3.5 min-h-0 animate-fadeIn">
          <!-- Session Header Bar -->
          <div class="glass-panel rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between border border-white/10 shrink-0">
            <div class="flex items-center gap-2 truncate">
              <span class="text-xs font-bold text-indigo-300 bg-indigo-500/20 px-2.5 py-0.5 rounded-full border border-indigo-500/30 truncate">
                📖 ${this.escape(s.wordsetTitle || s.lessonTitle || '核心词自测')}
              </span>
              <span class="text-slate-500 text-xs">·</span>
              <span id="sideCoreProgressText" class="text-xs text-slate-300 font-medium whitespace-nowrap">${s.progressText || `进度: ${s.currentIndex || 1} / ${s.totalWords || 1}`}</span>
            </div>
            <div class="text-xs font-bold text-indigo-400 font-mono shrink-0 ml-2" id="sideCoreProgressPct">
              ${s.progressPercent != null ? s.progressPercent + '%' : ''}
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="w-full h-1.5 bg-white/10 rounded-full overflow-hidden shrink-0 -mt-1 sm:-mt-1.5">
            <div id="sideCoreProgressBar" class="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-full transition-all duration-300" style="width: ${s.progressPercent || 0}%"></div>
          </div>

          <!-- Main Interactive Display Card -->
          <div class="flex-1 min-h-0 w-full glass-panel rounded-2xl sm:rounded-3xl p-3.5 sm:p-6 md:p-7 border border-white/10 shadow-2xl flex flex-col justify-between relative overflow-hidden">
            
            <!-- Header Step Indicator -->
            <div class="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-white/5 shrink-0">
              <div class="flex items-center gap-2">
                <span id="sideCoreStepDot" class="w-2 h-2 rounded-full ${isRevealed ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}"></span>
                <span id="sideCoreStepLabel" class="font-medium">${isRevealed ? '步骤 2/2: 已翻开释义与例句精读' : '步骤 1/2: 认读泰语单词 (释义遮蔽中)'}</span>
              </div>
              <div class="text-[11px] text-slate-400 font-mono shrink-0" id="sideCoreWordIndex">
                #${s.currentIndex || 1} / ${s.totalWords || 1}
              </div>
            </div>

            <!-- Thai Word Display Section (Always visible) -->
            <div class="py-2 sm:py-3 text-center space-y-2 shrink-0">
              <div id="sideCoreThaiWord" class="font-thai text-4xl sm:text-6xl md:text-7xl font-black text-white tracking-wider py-1 select-all transition-all duration-300">
                ${this.escape(w.word || '--')}
              </div>
              <div class="flex items-center justify-center gap-2 flex-wrap">
                ${w.ipa ? `
                  <span id="sideCoreIpa" class="px-3 py-1 rounded-xl bg-indigo-500/20 text-indigo-300 font-mono text-xs sm:text-sm font-semibold border border-indigo-500/30">
                    ${this.escape(w.ipa)}
                  </span>
                ` : '<span id="sideCoreIpa" class="hidden"></span>'}
                <span id="sideCoreSoundWave" class="sound-wave opacity-30 scale-90 transition-all duration-300">
                  <span class="sound-bar"></span>
                  <span class="sound-bar"></span>
                  <span class="sound-bar"></span>
                  <span class="sound-bar"></span>
                  <span class="sound-bar"></span>
                </span>
              </div>
            </div>

            <!-- Shrouded Placeholder Section (When detailRevealed is false) -->
            <div id="sideCoreWordShrouded" class="${isRevealed ? 'hidden' : ''} flex-1 min-h-0 py-4 flex flex-col items-center justify-center text-center space-y-3 sm:space-y-4">
              <div class="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-xl sm:text-2xl text-amber-400 shadow-inner">
                <i class="ph-bold ph-eye-slash"></i>
              </div>
              <div class="max-w-xs mx-auto p-3.5 sm:p-4 rounded-2xl bg-indigo-950/40 border border-indigo-500/20 space-y-1.5">
                <div class="text-xs sm:text-sm font-bold text-indigo-200 flex items-center justify-center gap-1.5">
                  <i class="ph-bold ph-lock-key"></i>
                  <span>词汇释义与例句遮蔽中</span>
                </div>
                <p class="text-[11px] sm:text-xs text-slate-400 leading-relaxed">
                  请先在脑海中回忆该词词义、词性及搭配。<br>导师在主屏点击<strong>「展示解释与例句」</strong>后将同步揭晓。
                </p>
              </div>
              <div class="text-[11px] text-slate-500 flex items-center gap-1.5">
                <i class="ph-bold ph-hourglass-high text-amber-400 animate-spin"></i>
                <span>等待主操作台指令...</span>
              </div>
            </div>

            <!-- Revealed Meanings & Examples Section (When detailRevealed is true) -->
            <div id="sideCoreWordRevealed" class="${isRevealed ? '' : 'hidden'} flex-1 min-h-0 py-1 sm:py-2 space-y-3 flex flex-col overflow-hidden animate-fadeIn">
              <div id="sideCoreMeaningsList" class="space-y-2.5 sm:space-y-3 flex-1 min-h-0 overflow-y-auto pr-1">
                ${this.renderCoreWordMeaningsHtml(w)}
              </div>
            </div>

            <!-- Footer Status -->
            <div class="pt-2 text-center text-[10px] sm:text-[11px] text-slate-500 border-t border-white/5 flex items-center justify-center gap-1 shrink-0">
              <i class="ph-bold ph-device-mobile text-indigo-400"></i>
              <span>第二屏幕被动同步中 · 所有操作由 iMac 主机控制</span>
            </div>

          </div>
        </div>
      `;
    }

    renderCoreWordMeaningsHtml(word) {
      if (!word) return `<div class="p-3 rounded-xl bg-white/5 text-xs text-slate-400 text-center">暂无释义</div>`;

      if (Array.isArray(word.meanings) && word.meanings.length > 0) {
        return word.meanings.map((m) => `
          <div class="p-3.5 rounded-2xl bg-white/5 border border-white/10 space-y-2.5">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold px-2 py-0.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                ${this.escape(m.part_of_speech || '词性')}
              </span>
              <span class="text-sm font-bold text-white">${this.escape(m.meaning || '')}</span>
            </div>
            ${Array.isArray(m.examples) && m.examples.length > 0 ? `
              <div class="border-t border-white/5 pt-2 space-y-1.5">
                <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <i class="ph-bold ph-chat-centered-text text-indigo-400"></i>
                  <span>对照例句</span>
                </div>
                ${m.examples.map(ex => `
                  <div class="p-2 rounded-xl bg-white/5 border border-white/5 space-y-0.5">
                    <div class="font-thai text-sm text-indigo-200 font-medium">${this.escape(ex.sentence || '')}</div>
                    <div class="text-xs text-slate-300">${this.escape(ex.meaning || '')}</div>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `).join('');
      } else {
        return `
          <div class="p-4 rounded-2xl bg-white/5 border border-white/10 text-center space-y-1">
            ${word.pos ? `<span class="text-xs font-mono text-indigo-300 font-bold">[${this.escape(word.pos)}]</span>` : ''}
            <div class="text-base font-bold text-white">${this.escape(word.meaning || '暂无释义')}</div>
          </div>
        `;
      }
    }

    // =========================================================================
    // View 6: Core Words Summary View
    // =========================================================================
    renderCoreWordsSummaryView() {
      const s = this.localState || {};
      this.containerEl.innerHTML = `
        <div class="w-full h-full max-w-4xl flex flex-col justify-center gap-3 sm:gap-4 min-h-0 animate-fadeIn">
          <!-- Celebration Header -->
          <div class="glass-panel rounded-3xl p-5 sm:p-7 text-center space-y-3 border border-white/10 shadow-2xl flex-1 min-h-0 flex flex-col justify-center items-center">
            <div class="inline-flex h-14 w-14 sm:h-18 sm:w-18 rounded-2xl bg-gradient-to-tr from-indigo-500 to-emerald-500 items-center justify-center text-2xl sm:text-3xl shadow-xl shadow-indigo-500/25 shrink-0">
              🎉
            </div>
            <div class="space-y-1 max-w-md mx-auto">
              <h2 class="text-lg sm:text-2xl font-black text-white">核心词汇自测已顺利完成！</h2>
              <p class="text-xs sm:text-sm text-slate-400">${s.wordsetTitle ? `「${this.escape(s.wordsetTitle)}」` : ''}复习结果与熟练度已保存至本地数据库</p>
            </div>

            <!-- Metrics Grid -->
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2 w-full max-w-lg">
              <div class="glass-card rounded-2xl p-3">
                <div class="text-[11px] sm:text-xs text-slate-400">自测词数</div>
                <div class="text-xl sm:text-2xl font-bold text-white mt-0.5">${s.totalCount != null ? s.totalCount : '--'}</div>
              </div>
              <div class="glass-card rounded-2xl p-3">
                <div class="text-[11px] sm:text-xs text-slate-400">平均评分</div>
                <div class="text-xl sm:text-2xl font-bold text-emerald-400 mt-0.5">${s.avgScore != null ? s.avgScore : '--'}</div>
              </div>
              <div class="glass-card rounded-2xl p-3 col-span-2 sm:col-span-1">
                <div class="text-[11px] sm:text-xs text-slate-400">复习完成率</div>
                <div class="text-xl sm:text-2xl font-bold text-indigo-300 mt-0.5">100%</div>
              </div>
            </div>
          </div>

          <!-- Passive Tip Card -->
          <div class="p-3.5 sm:p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3 shrink-0">
            <div class="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0 text-base sm:text-lg">
              <i class="ph-bold ph-check-circle"></i>
            </div>
            <div class="text-[11px] sm:text-xs text-slate-400 leading-relaxed">
              导师在主操作台可选择再次从头复习或返回课时词汇列表，伴侣屏将继续实时同步。
            </div>
          </div>
        </div>
      `;
    }

    // =========================================================================
    // View 7: Translate Practice Session View
    // =========================================================================
    renderTranslateSessionView() {
      const s = this.localState || {};
      const sent = s.sentence || {};
      const isRevealed = Boolean(s.answerRevealed);
      const isZh2Th = (s.mode === 'zh2th' || s.currentStep === 2);
      const isQuiz = (s.currentStep === 3);

      let stepBadgeHtml = '';
      if (isQuiz) {
        stepBadgeHtml = `<span class="text-xs font-bold text-purple-300 bg-purple-500/20 px-2.5 py-0.5 rounded-full border border-purple-500/30">Step 3: Quiz 自测</span>`;
      } else if (isZh2Th) {
        stepBadgeHtml = `<span class="text-xs font-bold text-emerald-300 bg-emerald-500/20 px-2.5 py-0.5 rounded-full border border-emerald-500/30">Step 2: 中 ➔ 泰</span>`;
      } else {
        stepBadgeHtml = `<span class="text-xs font-bold text-sky-300 bg-sky-500/20 px-2.5 py-0.5 rounded-full border border-sky-500/30">Step 1: 泰 ➔ 中</span>`;
      }

      this.containerEl.innerHTML = `
        <div class="w-full h-full max-w-4xl flex flex-col justify-between gap-2.5 sm:gap-3.5 min-h-0 animate-fadeIn">
          <!-- Session Header Bar -->
          <div class="glass-panel rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between border border-white/10 shrink-0">
            <div class="flex items-center gap-2 truncate">
              <span class="text-xs font-bold text-sky-300 bg-sky-500/20 px-2.5 py-0.5 rounded-full border border-sky-500/30 truncate">
                📖 ${this.escape(s.scopeTitle || s.lessonTitle || s.category || '翻译练习')}
              </span>
              ${stepBadgeHtml}
              <span class="text-slate-500 text-xs">·</span>
              <span id="sideTranslateProgressText" class="text-xs text-slate-300 font-medium whitespace-nowrap">${s.progressText || `进度: ${s.currentIndex || 1} / ${s.totalCount || 1}`}</span>
            </div>
            <div class="text-xs font-bold text-sky-400 font-mono shrink-0 ml-2" id="sideTranslateProgressPct">
              ${s.progressPercent != null ? s.progressPercent + '%' : ''}
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="w-full h-1.5 bg-white/10 rounded-full overflow-hidden shrink-0 -mt-1 sm:-mt-1.5">
            <div id="sideTranslateProgressBar" class="h-full bg-gradient-to-r from-sky-500 via-indigo-500 to-purple-500 rounded-full transition-all duration-300" style="width: ${s.progressPercent || 0}%"></div>
          </div>

          <!-- Main Interactive Display Card -->
          <div class="flex-1 min-h-0 w-full glass-panel rounded-2xl sm:rounded-3xl p-3.5 sm:p-6 md:p-7 border border-white/10 shadow-2xl flex flex-col justify-between relative overflow-hidden">
            
            <!-- Header Step Indicator -->
            <div class="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-white/5 shrink-0">
              <div class="flex items-center gap-2">
                <span id="sideTranslateStepDot" class="w-2 h-2 rounded-full ${isRevealed ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}"></span>
                <span id="sideTranslateStepLabel" class="font-medium">${isRevealed ? '步骤：已揭晓参考答案与词汇解析' : (isZh2Th ? '练习：请将下方中文翻译为泰语 (答案遮蔽中)' : '练习：请将下方泰语翻译为中文 (答案遮蔽中)')}</span>
              </div>
              <div class="text-[11px] text-slate-400 font-mono shrink-0" id="sideTranslateSentenceIndex">
                #${s.currentIndex || 1} / ${s.totalCount || 1}
              </div>
            </div>

            <!-- Question Display Section (Always visible) -->
            <div class="py-2 sm:py-3 space-y-1.5 sm:space-y-2 shrink-0">
              <div class="flex items-center justify-between">
                <span class="text-[11px] sm:text-xs uppercase font-bold px-2 py-0.5 rounded-lg ${isZh2Th ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'}">
                  ${isZh2Th ? '待翻译中文原句' : '待认读泰语原句'}
                </span>
                <span id="sideTranslateSoundWave" class="sound-wave opacity-30 scale-90 transition-all duration-300">
                  <span class="sound-bar"></span>
                  <span class="sound-bar"></span>
                  <span class="sound-bar"></span>
                  <span class="sound-bar"></span>
                  <span class="sound-bar"></span>
                </span>
              </div>
              <div id="sideTranslateQuestionText" class="${isZh2Th ? 'text-lg sm:text-2xl md:text-3xl font-bold text-white tracking-wide' : 'font-thai text-xl sm:text-3xl md:text-4xl font-bold text-white tracking-wider'} py-1 select-all leading-relaxed transition-all duration-300">
                ${this.escape(isZh2Th ? (sent.chinese || '--') : (sent.thai || '--'))}
              </div>
            </div>

            <!-- Shrouded Placeholder Section (When answerRevealed is false) -->
            <div id="sideTranslateAnswerShrouded" class="${isRevealed ? 'hidden' : ''} flex-1 min-h-0 py-4 flex flex-col items-center justify-center text-center space-y-3 sm:space-y-4">
              <div class="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-xl sm:text-2xl text-amber-400 shadow-inner">
                <i class="ph-bold ph-lock-key"></i>
              </div>
              <div class="max-w-xs mx-auto p-3.5 sm:p-4 rounded-2xl bg-sky-950/40 border border-sky-500/20 space-y-1.5">
                <div class="text-xs sm:text-sm font-bold text-sky-200 flex items-center justify-center gap-1.5">
                  <i class="ph-bold ph-eye-slash"></i>
                  <span>参考翻译与解析遮蔽中</span>
                </div>
                <p class="text-[11px] sm:text-xs text-slate-400 leading-relaxed">
                  请先在心中或草稿纸上完成对应翻译。<br>导师在主屏点击<strong>「副屏显示答案」</strong>后将同步揭晓。
                </p>
              </div>
              <div class="text-[11px] text-slate-500 flex items-center gap-1.5">
                <i class="ph-bold ph-hourglass-high text-amber-400 animate-spin"></i>
                <span>等待主操作台指令...</span>
              </div>
            </div>

            <!-- Revealed Answer Section (When answerRevealed is true) -->
            <div id="sideTranslateAnswerRevealed" class="${isRevealed ? '' : 'hidden'} flex-1 min-h-0 py-1 space-y-2 sm:space-y-2.5 flex flex-col overflow-hidden animate-fadeIn">
              <!-- Target Translation Card -->
              <div class="p-3 sm:p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1.5 shrink-0">
                <div class="text-[10px] sm:text-[11px] font-bold text-sky-300 uppercase tracking-wider flex items-center gap-1.5">
                  <i class="ph-bold ph-check-circle text-emerald-400 text-sm"></i>
                  <span>${isZh2Th ? '泰语参考答案' : '中文参考翻译'}</span>
                </div>
                <div id="sideTranslateAnswerText" class="${isZh2Th ? 'font-thai text-xl sm:text-2xl md:text-3xl text-emerald-300 font-bold' : 'text-base sm:text-xl md:text-2xl text-emerald-200 font-semibold'} leading-relaxed select-all">
                  ${this.escape(isZh2Th ? (sent.thai || '--') : (sent.chinese || '--'))}
                </div>
                ${(sent.thai_spaced && isZh2Th) ? `
                  <div class="font-thai text-xs sm:text-sm text-slate-400 pt-1 border-t border-white/5">
                    分词参考: <span class="text-emerald-200/90">${this.escape(sent.thai_spaced)}</span>
                  </div>
                ` : ''}
                ${sent.english ? `
                  <div class="text-xs text-slate-400 italic pt-1 border-t border-white/5 flex items-center gap-1.5">
                    <span>💡</span>
                    <span id="sideTranslateEnglishText">${this.escape(sent.english)}</span>
                  </div>
                ` : ''}
              </div>

              <!-- Keywords / Glossary Section -->
              ${((sent.glossary && sent.glossary.length > 0) || (sent.tokens && sent.tokens.length > 0)) ? `
                <div class="space-y-1 pt-1 flex-1 min-h-0 flex flex-col overflow-hidden">
                  <div class="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 shrink-0">
                    <i class="ph-bold ph-translate text-sky-400"></i>
                    <span>重点词汇与解析</span>
                  </div>
                  <div id="sideTranslateGlossaryList" class="flex flex-wrap gap-2 flex-1 min-h-0 overflow-y-auto pr-1">
                    ${this.renderTranslateGlossaryHtml(sent.glossary || sent.tokens)}
                  </div>
                </div>
              ` : ''}
            </div>

            <!-- Footer Status -->
            <div class="pt-2 text-center text-[10px] sm:text-[11px] text-slate-500 border-t border-white/5 flex items-center justify-center gap-1 shrink-0">
              <i class="ph-bold ph-device-mobile text-sky-400"></i>
              <span>第二屏幕被动同步中 · 所有操作由主机控制</span>
            </div>

          </div>
        </div>
      `;
    }

    renderTranslateGlossaryHtml(glossary) {
      if (!glossary || !glossary.length) return `<div class="text-xs text-slate-500">无重点词汇</div>`;
      return glossary.map(g => `
        <div class="px-2.5 py-1 rounded-xl bg-white/5 border border-white/10 flex items-center gap-1.5 text-xs">
          <span class="font-thai font-medium text-sky-200">${this.escape(g.thai || '')}</span>
          <span class="text-slate-500">·</span>
          <span class="text-slate-300">${this.escape(g.meaning || '')}</span>
        </div>
      `).join('');
    }

    renderTranslateListView() {
      const s = this.localState || {};
      this.containerEl.innerHTML = `
        <div class="w-full h-full max-w-4xl flex flex-col justify-center gap-3 sm:gap-4 min-h-0 animate-fadeIn">
          <div class="glass-panel rounded-3xl p-6 sm:p-8 text-center space-y-4 border border-white/10 shadow-2xl relative overflow-hidden flex-1 min-h-0 flex flex-col justify-center items-center">
            <div class="inline-flex h-16 w-16 rounded-2xl bg-gradient-to-tr from-sky-600 to-indigo-600 items-center justify-center text-3xl shadow-xl shadow-sky-500/25 shrink-0">
              <i class="ph-bold ph-cards"></i>
            </div>
            <div class="space-y-1">
              <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                伴侣屏已就绪
              </div>
              <h2 class="text-xl sm:text-2xl font-extrabold text-white tracking-tight">翻译练习卡片浏览</h2>
              <div class="text-xs sm:text-sm text-slate-300 max-w-sm mx-auto font-medium">
                ${this.escape(s.scopeTitle ? `当前范围: ${s.scopeTitle}` : '全部科目 · 全部语料')}
              </div>
              <p class="text-xs text-slate-400 max-w-sm mx-auto">
                主操作台正在浏览练习题目卡片。选择题目后将自动自适应同步呈现在本屏。
              </p>
            </div>
            <div class="pt-4 border-t border-white/10 grid grid-cols-2 gap-3 text-left w-full max-w-sm shrink-0">
              <div class="p-3 rounded-2xl bg-white/5 border border-white/5 space-y-0.5">
                <div class="text-[11px] text-slate-400 font-medium">题目总数</div>
                <div class="text-lg font-bold text-white font-mono">${s.totalCount || 0} 题</div>
              </div>
              <div class="p-3 rounded-2xl bg-white/5 border border-white/5 space-y-0.5">
                <div class="text-[11px] text-slate-400 font-medium">当前选中</div>
                <div class="text-lg font-bold text-sky-400 font-mono">第 ${s.currentIndex || 1} 题</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }
    // =========================================================================
    // View 6: Course Review PDF Reader & Synchronized View
    // =========================================================================
    renderCourseReviewPdfView() {
      const s = this.localState || {};
      this.containerEl.innerHTML = `
        <div class="w-full h-full max-w-6xl flex flex-col justify-between gap-2 sm:gap-2.5 min-h-0 animate-fadeIn">
          <!-- Top Courseware Info Bar -->
          <div class="glass-card rounded-2xl p-2.5 sm:p-3.5 border border-white/10 flex items-center justify-between gap-2 sm:gap-3 shadow-lg shrink-0">
            <div class="flex items-center gap-2 sm:gap-2.5 min-w-0">
              <div class="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-rose-600 flex items-center justify-center text-white text-sm sm:text-base shrink-0 shadow-md">
                <i class="ph-bold ph-file-pdf"></i>
              </div>
              <div class="min-w-0">
                <h2 id="sideCoursewareTitle" class="text-xs sm:text-sm font-bold text-white truncate" title="${this.escape(s.coursewareTitle || '')}">
                  ${this.escape(s.coursewareTitle || '正在载入课件...')}
                </h2>
                <div class="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                  <span id="sideCoursewareStepBadge" class="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-medium">
                    ${this.escape(s.stepName || 'Step 1: 观看课件 Page')}
                  </span>
                  <span id="sideCoursewarePageTopic" class="truncate hidden sm:inline text-slate-300">
                    ${this.escape(s.pageTitle || '')}
                  </span>
                </div>
              </div>
            </div>

            <!-- Page Number Pill, Zoom Buttons & Courseware Maximize Button -->
            <div class="flex items-center gap-1.5 shrink-0">
              <div class="px-2 sm:px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono font-bold text-xs flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                <span id="sideCoursewarePageBadge">Page ${s.pageNum || 1} / ${s.totalPages || 1}</span>
              </div>
              <!-- Zoom controls -->
              <div class="flex items-center bg-white/5 rounded-lg border border-white/10 p-0.5">
                <button onclick="window.sideAppRenderer.adjustPdfZoom(-0.15)" class="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white rounded hover:bg-white/10 text-xs transition" title="缩小">
                  <i class="ph-bold ph-minus"></i>
                </button>
                <span id="sidePdfZoomVal" class="text-[10px] font-mono text-slate-300 px-1">100%</span>
                <button onclick="window.sideAppRenderer.adjustPdfZoom(0.15)" class="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white rounded hover:bg-white/10 text-xs transition" title="放大">
                  <i class="ph-bold ph-plus"></i>
                </button>
              </div>

              <!-- Courseware Maximize Button (Only courseware content fullscreen) -->
              <button id="sidePdfContentMaxBtn" onclick="window.sideAppRenderer.togglePdfContentMaximize()" class="h-7 px-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 flex items-center gap-1.5 text-xs font-semibold shadow-sm transition active:scale-95" title="最大化课件显示 (仅课件全屏)">
                <i id="sidePdfContentMaxIcon" class="ph-bold ph-arrows-out text-xs"></i>
                <span id="sidePdfContentMaxLabel" class="hidden xs:inline sm:inline">课件全屏</span>
              </button>
            </div>
          </div>

          <!-- PDF Viewport Canvas Card -->
          <div id="sidePdfViewport" class="flex-1 min-h-0 w-full glass-panel rounded-2xl p-1.5 sm:p-2 border border-white/10 shadow-2xl relative overflow-auto flex items-center justify-center" ondblclick="if(event.target.closest('button,input'))return; window.sideAppRenderer.togglePdfContentMaximize()">
            <!-- Floating Fullscreen Controls Bar (Visible during courseware maximize) -->
            <div id="sidePdfFullscreenBar" class="absolute top-3 left-3 right-3 z-30 hidden items-center justify-between pointer-events-none transition-all duration-200">
              <div class="flex items-center gap-2 pointer-events-auto bg-slate-900/90 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/15 text-xs text-white shadow-xl">
                <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                <span class="font-bold text-amber-300 truncate max-w-[140px] sm:max-w-xs" id="sidePdfFsTitle">${this.escape(s.coursewareTitle || '课件')}</span>
                <span class="text-slate-500">·</span>
                <span class="font-mono text-slate-300" id="sidePdfFsPageBadge">Page ${s.pageNum || 1} / ${s.totalPages || 1}</span>
              </div>
              <div class="flex items-center gap-1.5 pointer-events-auto bg-slate-900/90 backdrop-blur-md p-1 rounded-full border border-white/15 shadow-xl">
                <button onclick="window.sideAppRenderer.adjustPdfZoom(-0.15)" class="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-white rounded-full hover:bg-white/10 text-xs transition" title="缩小">
                  <i class="ph-bold ph-minus"></i>
                </button>
                <span id="sidePdfFsZoomVal" class="text-[10px] font-mono text-slate-300 px-1">100%</span>
                <button onclick="window.sideAppRenderer.adjustPdfZoom(0.15)" class="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-white rounded-full hover:bg-white/10 text-xs transition" title="放大">
                  <i class="ph-bold ph-plus"></i>
                </button>
                <div class="w-px h-4 bg-white/20 mx-0.5"></div>
                <button onclick="window.sideAppRenderer.togglePdfContentMaximize()" class="h-7 px-3 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold text-xs flex items-center gap-1 hover:brightness-110 active:scale-95 transition shadow-md" title="退出课件全屏">
                  <i class="ph-bold ph-arrows-in text-xs"></i>
                  <span>退出全屏</span>
                </button>
              </div>
            </div>

            <!-- Quick Maximize Corner Button (Normal mode) -->
            <button id="sidePdfQuickMaxBtn" onclick="window.sideAppRenderer.togglePdfContentMaximize()" class="absolute bottom-3 right-3 z-20 h-8 px-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-900 text-slate-300 hover:text-white border border-white/15 backdrop-blur-md shadow-lg flex items-center gap-1.5 text-xs transition opacity-75 hover:opacity-100" title="课件内容最大化全屏">
              <i class="ph-bold ph-arrows-out text-xs text-amber-400"></i>
              <span class="text-[11px] font-medium">全屏</span>
            </button>
            <!-- Loading Spinner & Status -->
            <div id="sidePdfLoading" class="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/75 backdrop-blur-sm rounded-2xl gap-3 transition-opacity duration-200">
              <div class="w-10 h-10 rounded-full border-2 border-amber-500/20 border-t-amber-400 animate-spin"></div>
              <span id="sidePdfLoadingText" class="text-xs text-amber-200 font-medium">正在读取课件 PDF 文档内容...</span>
            </div>

            <!-- Error State Overlay -->
            <div id="sidePdfError" class="absolute inset-0 z-20 hidden flex flex-col items-center justify-center bg-slate-950/90 rounded-2xl p-6 text-center space-y-3">
              <div class="w-12 h-12 rounded-2xl bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-300 text-2xl">
                <i class="ph-bold ph-warning-circle"></i>
              </div>
              <h3 class="text-sm font-bold text-white">未能读取课件 PDF</h3>
              <p id="sidePdfErrorMsg" class="text-xs text-slate-400 max-w-xs">请确认主屏课件文件有效，或在主屏重新载入课件。</p>
            </div>

            <!-- PDF Canvas Element -->
            <canvas id="sidePdfCanvas" class="rounded-xl shadow-2xl transition-all duration-150"></canvas>
          </div>

          <!-- Bottom Synchronized Status Bar -->
          <div class="glass-card rounded-xl px-3 py-1.5 sm:py-2 border border-white/5 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
            <div class="flex items-center gap-1.5 truncate">
              <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span class="font-medium text-slate-300">与 iMac 主机同步</span>
              <span class="text-slate-600">|</span>
              <span id="sidePdfSyncStatusText" class="text-slate-400 truncate">同步翻页 (Page ${s.pageNum || 1})</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span id="sideCoursewareNotesSummary" class="text-[10px] text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full">
                ${s.corePointsCount ? `${s.corePointsCount}个考点` : ''} ${s.flashcardsCount ? `· ${s.flashcardsCount}张闪卡` : ''}
              </span>
            </div>
          </div>
        </div>
      `;

      if (this.isPdfMaximized) {
        const viewport = document.getElementById('sidePdfViewport');
        if (viewport && !viewport.classList.contains('side-pdf-content-fullscreen')) {
          viewport.classList.add('side-pdf-content-fullscreen');
        }
        this.updatePdfMaximizeUI(true);
      }

      if (s.pdfUrl) {
        this.loadAndRenderCoursePdf(s.pdfUrl, s.pageNum || 1);
      } else {
        const loadingText = document.getElementById('sidePdfLoadingText');
        if (loadingText) loadingText.innerText = '等待主屏发送课件 PDF...';
      }
    }

    async loadAndRenderCoursePdf(pdfUrl, pageNum = 1) {
      if (!pdfUrl) {
        this.showPdfError('主操作台暂无有效 PDF 课件路径');
        return;
      }

      const loadingEl = document.getElementById('sidePdfLoading');
      const loadingText = document.getElementById('sidePdfLoadingText');
      const errorEl = document.getElementById('sidePdfError');

      if (errorEl) errorEl.classList.add('hidden');
      if (loadingEl) {
        loadingEl.classList.remove('hidden');
        if (loadingText) loadingText.innerText = '正在读取课件 PDF 文档内容...';
      }

      // If already loaded this exact PDF, switch page directly
      if (this.pdfDoc && this.currentPdfSource === pdfUrl) {
        await this.renderPdfPage(pageNum);
        return;
      }

      try {
        let lib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
        if (!lib) {
          for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 100));
            lib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
            if (lib) break;
          }
        }
        if (!lib) {
          throw new Error('PDF.js 解析引擎尚未加载完成');
        }

        lib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        // Load document from URL or Data URL
        const loadingTask = lib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;

        this.pdfDoc = pdf;
        this.currentPdfSource = pdfUrl;

        await this.renderPdfPage(pageNum);
      } catch (err) {
        console.error('[SideAppRenderer] Failed to load PDF:', err);
        this.showPdfError(`加载 PDF 失败: ${err.message || '网络错误或文件无法访问'}`);
      }
    }

    async renderPdfPage(num) {
      if (!this.pdfDoc) return;
      const targetPage = parseInt(num) || 1;
      if (targetPage < 1 || targetPage > this.pdfDoc.numPages) return;

      if (this.isRenderingPdf) {
        this.renderPendingPage = targetPage;
        return;
      }
      this.isRenderingPdf = true;

      const loadingEl = document.getElementById('sidePdfLoading');
      const loadingText = document.getElementById('sidePdfLoadingText');
      if (loadingEl) {
        loadingEl.classList.remove('hidden');
        if (loadingText) loadingText.innerText = `正在渲染第 ${targetPage} 页...`;
      }

      try {
        const page = await this.pdfDoc.getPage(targetPage);
        const canvas = document.getElementById('sidePdfCanvas');
        const viewportContainer = document.getElementById('sidePdfViewport');
        if (!canvas || !viewportContainer) {
          this.isRenderingPdf = false;
          return;
        }

        const ctx = canvas.getContext('2d');
        const containerWidth = Math.max(200, viewportContainer.clientWidth - 16);
        const containerHeight = Math.max(200, viewportContainer.clientHeight - 16);

        let viewport = page.getViewport({ scale: 1.0 });
        const scaleW = containerWidth / viewport.width;
        const scaleH = containerHeight / viewport.height;
        // Whichever dimension reaches container edge first is the benchmark dimension
        const baseFitScale = Math.min(scaleW, scaleH);
        const fitScale = baseFitScale * (this.pdfZoom || 1.0);
        viewport = page.getViewport({ scale: fitScale });

        const pixelRatio = window.devicePixelRatio || 1;
        canvas.height = viewport.height * pixelRatio;
        canvas.width = viewport.width * pixelRatio;
        canvas.style.height = `${viewport.height}px`;
        canvas.style.width = `${viewport.width}px`;

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
          transform: [pixelRatio, 0, 0, pixelRatio, 0, 0]
        };

        if (this.currentRenderTask) {
          try { this.currentRenderTask.cancel(); } catch (e) {}
        }
        this.currentRenderTask = page.render(renderContext);
        await this.currentRenderTask.promise;
        this.currentRenderTask = null;
        this.currentPdfPageNum = targetPage;

        if (loadingEl) loadingEl.classList.add('hidden');
      } catch (err) {
        if (err && err.name === 'RenderingCancelledException') {
          // Cancelled by subsequent page render
        } else {
          console.error('[SideAppRenderer] Render PDF page error:', err);
        }
      } finally {
        this.isRenderingPdf = false;
        if (this.renderPendingPage !== null) {
          const nextPage = this.renderPendingPage;
          this.renderPendingPage = null;
          this.renderPdfPage(nextPage);
        }
      }
    }

    adjustPdfZoom(delta) {
      this.pdfZoom = Math.max(0.5, Math.min(2.5, (this.pdfZoom || 1.0) + delta));
      const zoomText = document.getElementById('sidePdfZoomVal');
      if (zoomText) {
        zoomText.innerText = `${Math.round(this.pdfZoom * 100)}%`;
      }
      const fsZoomText = document.getElementById('sidePdfFsZoomVal');
      if (fsZoomText) {
        fsZoomText.innerText = `${Math.round(this.pdfZoom * 100)}%`;
      }
      if (this.currentPdfPageNum) {
        this.renderPdfPage(this.currentPdfPageNum);
      }
    }

    /**
     * Toggles maximize / fullscreen specifically for the PDF courseware viewport.
     * Works with native Fullscreen API when available and falls back to pseudo-fullscreen on mobile/iOS.
     */
    async togglePdfContentMaximize() {
      const viewport = document.getElementById('sidePdfViewport');
      if (!viewport) return;

      const isNativeFs = (
        document.fullscreenElement === viewport ||
        document.webkitFullscreenElement === viewport ||
        document.mozFullScreenElement === viewport ||
        document.msFullscreenElement === viewport
      );
      const isPseudoFs = viewport.classList.contains('side-pdf-content-fullscreen');
      const isCurrentlyMax = isNativeFs || isPseudoFs || this.isPdfMaximized;

      if (isCurrentlyMax) {
        // Exit maximize
        this.isPdfMaximized = false;
        viewport.classList.remove('side-pdf-content-fullscreen');
        if (isNativeFs) {
          try {
            if (document.exitFullscreen) {
              await document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
              await document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
              await document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
              await document.msExitFullscreen();
            }
          } catch (err) {
            console.warn('[SideAppRenderer] Exit native fullscreen failed:', err);
          }
        }
        this.updatePdfMaximizeUI(false);
      } else {
        // Enter maximize
        this.isPdfMaximized = true;
        let enteredNative = false;
        const reqFs = viewport.requestFullscreen ||
                      viewport.webkitRequestFullscreen ||
                      viewport.mozRequestFullScreen ||
                      viewport.msRequestFullscreen;
        if (reqFs) {
          try {
            await reqFs.call(viewport);
            enteredNative = true;
          } catch (err) {
            console.warn('[SideAppRenderer] Viewport requestFullscreen failed, using pseudo-fullscreen fallback:', err);
          }
        }
        if (!enteredNative) {
          viewport.classList.add('side-pdf-content-fullscreen');
        }
        this.updatePdfMaximizeUI(true);
      }

      // Re-render PDF page with a short timeout to allow layout geometry recalculation
      if (this.currentPdfPageNum) {
        setTimeout(() => {
          this.renderPdfPage(this.currentPdfPageNum);
        }, 120);
      }
    }

    /**
     * Updates UI elements reflecting PDF courseware maximize state.
     * @param {boolean} isMax 
     */
    updatePdfMaximizeUI(isMax) {
      // Update top-bar maximize button state
      const maxBtn = document.getElementById('sidePdfContentMaxBtn');
      const maxIcon = document.getElementById('sidePdfContentMaxIcon');
      const maxLabel = document.getElementById('sidePdfContentMaxLabel');
      if (maxBtn) {
        maxBtn.title = isMax ? '退出课件全屏' : '最大化课件显示 (仅课件全屏)';
        maxBtn.setAttribute('aria-label', isMax ? '退出课件全屏' : '最大化课件显示');
      }
      if (maxIcon) {
        if (isMax) {
          maxIcon.classList.remove('ph-arrows-out');
          maxIcon.classList.add('ph-arrows-in');
        } else {
          maxIcon.classList.remove('ph-arrows-in');
          maxIcon.classList.add('ph-arrows-out');
        }
      }
      if (maxLabel) {
        maxLabel.innerText = isMax ? '退出全屏' : '课件全屏';
      }

      // Update in-viewport floating fullscreen bar
      const fsBar = document.getElementById('sidePdfFullscreenBar');
      if (fsBar) {
        if (isMax) {
          fsBar.classList.remove('hidden');
          fsBar.classList.add('flex');
          // Sync current info
          const s = this.localState || {};
          const fsTitle = document.getElementById('sidePdfFsTitle');
          const fsPageBadge = document.getElementById('sidePdfFsPageBadge');
          const fsZoomVal = document.getElementById('sidePdfFsZoomVal');
          if (fsTitle && s.coursewareTitle) fsTitle.innerText = s.coursewareTitle;
          if (fsPageBadge) fsPageBadge.innerText = `Page ${s.pageNum || 1} / ${s.totalPages || 1}`;
          if (fsZoomVal) fsZoomVal.innerText = `${Math.round((this.pdfZoom || 1.0) * 100)}%`;
        } else {
          fsBar.classList.remove('flex');
          fsBar.classList.add('hidden');
        }
      }

      // Update corner quick maximize button
      const quickBtn = document.getElementById('sidePdfQuickMaxBtn');
      if (quickBtn) {
        if (isMax) {
          quickBtn.classList.add('hidden');
        } else {
          quickBtn.classList.remove('hidden');
        }
      }
    }

    showPdfError(msg) {
      const loadingEl = document.getElementById('sidePdfLoading');
      const errorEl = document.getElementById('sidePdfError');
      const msgEl = document.getElementById('sidePdfErrorMsg');
      if (loadingEl) loadingEl.classList.add('hidden');
      if (errorEl) errorEl.classList.remove('hidden');
      if (msgEl) msgEl.innerText = msg;
    }
  }

  window.sideAppRenderer = new SideAppRenderer();
})(window);
