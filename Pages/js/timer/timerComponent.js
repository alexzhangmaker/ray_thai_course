/**
 * @file timerComponent.js
 * @description 定时器与番茄钟操作面板组件，支持数字模式、番茄圆环可视化、状态管理、防漂移计时
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./settingsStore', './audioNotifier'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./settingsStore'), require('./audioNotifier'));
    } else {
        root.TimerPanel = factory(root.TimerSettingsStore, root.TimerAudioNotifier);
    }
}(typeof self !== 'undefined' ? self : this, function (SettingsStore, AudioNotifier) {
    'use strict';

    // SVG 圆环周长: 2 * PI * 44 = 276.46
    const RING_RADIUS = 44;
    const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

    /**
     * 定时器组件状态
     */
    const state = {
        status: 'stopped',           // 'stopped' | 'running' | 'paused'
        mode: 'digital',             // 'digital' | 'pomodoro'
        pomodoroPhase: 'work',       // 'work' | 'shortBreak' | 'longBreak'
        pomodoroCycle: 1,            // 番茄轮次 (1 ~ 4)
        totalSeconds: 25 * 60,       // 当前阶段总秒数
        remainingSeconds: 25 * 60,   // 当前剩余秒数
        targetEndTime: null,         // 目标结束时间戳 (Date.now() + ms)
        intervalId: null,            // 定时器句柄
        soundEnabled: true,          // 是否开启提示音
        isMuted: false,              // 临时静音状态
        showTimer: true,             // 是否在界面中展示
        isExpanded: true,            // 面板展开/折叠状态
        defaultDuration: 25,         // 默认时长（分钟）
        pomodoroPreset: {            // 番茄预设（分钟）
            work: 25,
            shortBreak: 5,
            longBreak: 15
        }
    };

    let containerEl = null;

    /**
     * 格式化秒数为 MM:SS 或 HH:MM:SS
     * @param {number} totalSecs 
     * @returns {string}
     */
    function formatTime(totalSecs) {
        const secs = Math.max(0, Math.floor(totalSecs));
        const hours = Math.floor(secs / 3600);
        const minutes = Math.floor((secs % 3600) / 60);
        const seconds = secs % 60;

        const mm = String(minutes).padStart(2, '0');
        const ss = String(seconds).padStart(2, '0');

        if (hours > 0) {
            const hh = String(hours).padStart(2, '0');
            return `${hh}:${mm}:${ss}`;
        }
        return `${mm}:${ss}`;
    }

    /**
     * 初始化定时器组件
     * @param {Object} [initialSettings] 
     * @param {HTMLElement|string} [mountPoint] 
     */
    async function init(initialSettings = null, mountPoint = '#timerPanelContainer') {
        const settings = initialSettings || (SettingsStore ? await SettingsStore.getAll() : {});

        // 同步配置
        if (typeof settings.defaultDuration === 'number') state.defaultDuration = settings.defaultDuration;
        if (typeof settings.showTimer === 'boolean') state.showTimer = settings.showTimer;
        if (settings.displayMode) state.mode = settings.displayMode;
        if (typeof settings.soundEnabled === 'boolean') {
            state.soundEnabled = settings.soundEnabled;
            state.isMuted = !settings.soundEnabled;
            if (AudioNotifier) AudioNotifier.setMuted(!settings.soundEnabled);
        }
        if (settings.pomodoroPreset) {
            state.pomodoroPreset = { ...state.pomodoroPreset, ...settings.pomodoroPreset };
        }

        // 初始化时长
        resetTimeForCurrentMode();

        // 挂载 DOM
        if (typeof mountPoint === 'string') {
            containerEl = document.querySelector(mountPoint);
        } else if (mountPoint instanceof HTMLElement) {
            containerEl = mountPoint;
        }

        if (!containerEl) {
            containerEl = document.createElement('div');
            containerEl.id = 'timerPanelContainer';
            document.body.appendChild(containerEl);
        }

        render();

        // 监听外部配置变更
        if (SettingsStore && typeof SettingsStore.subscribe === 'function') {
            SettingsStore.subscribe((key, val) => {
                handleSettingsChange(key, val);
            });
        }

        // 同步顶部导航栏的时间药丸显示
        updateHeaderPill();
    }

    /**
     * 重置当前模式下的倒计时总时长
     */
    function resetTimeForCurrentMode() {
        if (state.mode === 'pomodoro') {
            const mins = state.pomodoroPreset[state.pomodoroPhase] || 25;
            state.totalSeconds = mins * 60;
        } else {
            state.totalSeconds = state.defaultDuration * 60;
        }
        state.remainingSeconds = state.totalSeconds;
    }

    /**
     * 处理外部设置项变更
     */
    function handleSettingsChange(key, val) {
        if (key === 'showTimer') {
            state.showTimer = Boolean(val);
        } else if (key === 'displayMode') {
            if (val === 'digital' || val === 'pomodoro') {
                state.mode = val;
                if (state.status === 'stopped') {
                    resetTimeForCurrentMode();
                }
            }
        } else if (key === 'soundEnabled') {
            state.soundEnabled = Boolean(val);
            state.isMuted = !state.soundEnabled;
            if (AudioNotifier) AudioNotifier.setMuted(state.isMuted);
        } else if (key === 'defaultDuration') {
            state.defaultDuration = Number(val) || 25;
            if (state.mode === 'digital' && state.status === 'stopped') {
                resetTimeForCurrentMode();
            }
        } else if (key === 'pomodoroPreset' && typeof val === 'object') {
            state.pomodoroPreset = { ...state.pomodoroPreset, ...val };
            if (state.mode === 'pomodoro' && state.status === 'stopped') {
                resetTimeForCurrentMode();
            }
        } else if (key === '*') {
            // 全局重置
            state.defaultDuration = val.defaultDuration;
            state.showTimer = val.showTimer;
            state.mode = val.displayMode;
            state.soundEnabled = val.soundEnabled;
            state.isMuted = !state.soundEnabled;
            state.pomodoroPreset = { ...val.pomodoroPreset };
            if (state.status === 'stopped') {
                resetTimeForCurrentMode();
            }
        }

        render();
        updateHeaderPill();
    }

    /**
     * 启动 / 继续倒计时
     */
    function start() {
        if (state.status === 'running') return;

        // 如果在停止状态，确保时间已设置
        if (state.status === 'stopped' && state.remainingSeconds <= 0) {
            resetTimeForCurrentMode();
        }

        state.status = 'running';
        state.targetEndTime = Date.now() + state.remainingSeconds * 1000;

        if (AudioNotifier) AudioNotifier.unlock();

        if (state.intervalId) clearInterval(state.intervalId);

        // 使用高精度 250ms 轮询检测，结合 Date.now() 目标时间戳，杜绝漂移与后台节流累积误差
        state.intervalId = setInterval(tick, 250);

        renderUIState();
        updateHeaderPill();
    }

    /**
     * 暂停倒计时
     */
    function pause() {
        if (state.status !== 'running') return;

        state.status = 'paused';
        if (state.intervalId) {
            clearInterval(state.intervalId);
            state.intervalId = null;
        }

        // 精确修正剩余秒数
        if (state.targetEndTime) {
            state.remainingSeconds = Math.max(0, Math.ceil((state.targetEndTime - Date.now()) / 1000));
        }

        renderUIState();
        updateHeaderPill();
    }

    /**
     * 停止并重置倒计时
     */
    function reset() {
        state.status = 'stopped';
        if (state.intervalId) {
            clearInterval(state.intervalId);
            state.intervalId = null;
        }
        state.targetEndTime = null;
        resetTimeForCurrentMode();

        renderUIState();
        updateHeaderPill();
    }

    /**
     * 定时器时钟 Tick
     */
    function tick() {
        if (state.status !== 'running' || !state.targetEndTime) return;

        const now = Date.now();
        const diffSecs = Math.ceil((state.targetEndTime - now) / 1000);

        if (diffSecs <= 0) {
            state.remainingSeconds = 0;
            handleComplete();
        } else {
            state.remainingSeconds = diffSecs;
            renderTimeOnly();
            updateHeaderPill();
        }
    }

    /**
     * 倒计时结束处理
     */
    function handleComplete() {
        if (state.intervalId) {
            clearInterval(state.intervalId);
            state.intervalId = null;
        }
        state.status = 'stopped';
        state.targetEndTime = null;

        // 播放提示音
        if (state.soundEnabled && !state.isMuted && AudioNotifier) {
            AudioNotifier.playTimerEndSound();
        }

        // 视觉提示
        triggerVisualAlert();

        if (state.mode === 'pomodoro') {
            handlePomodoroCycleComplete();
        } else {
            // 数字模式自动重置为默认时长
            if (typeof window.showToast === 'function') {
                window.showToast('⏰ 定时倒计时已结束！', 'info');
            }
            state.remainingSeconds = state.totalSeconds;
            renderUIState();
            updateHeaderPill();
        }
    }

    /**
     * 番茄钟周期推进
     */
    function handlePomodoroCycleComplete() {
        let toastMsg = '';
        if (state.pomodoroPhase === 'work') {
            if (state.pomodoroCycle >= 4) {
                // 完成 4 轮专注，进入长休
                state.pomodoroPhase = 'longBreak';
                toastMsg = `🎉 恭喜完成第 ${state.pomodoroCycle} 轮专注！进入 ${state.pomodoroPreset.longBreak} 分钟深度休息。`;
                state.pomodoroCycle = 1; // 重置轮次
            } else {
                // 进入短休
                state.pomodoroPhase = 'shortBreak';
                toastMsg = `👏 专注完成！进入 ${state.pomodoroPreset.shortBreak} 分钟小憩休息。`;
            }
        } else {
            // 休息结束，进入下一轮专注
            if (state.pomodoroPhase === 'shortBreak') {
                state.pomodoroCycle++;
            }
            state.pomodoroPhase = 'work';
            toastMsg = `💪 休息结束，开始第 ${state.pomodoroCycle}/4 轮专注学习！`;
        }

        if (typeof window.showToast === 'function') {
            window.showToast(toastMsg, 'info');
        }

        resetTimeForCurrentMode();
        render();
        updateHeaderPill();
    }

    /**
     * 触发视觉警报脉冲
     */
    function triggerVisualAlert() {
        const card = document.getElementById('timerPanelCard') || document.getElementById('timerMiniCard');
        if (card) {
            card.classList.remove('timer-alert-pulse');
            void card.offsetWidth; // 触发 reflow 重启动画
            card.classList.add('timer-alert-pulse');
            setTimeout(() => {
                card.classList.remove('timer-alert-pulse');
            }, 3600);
        }
    }

    /**
     * 切换显示模式
     */
    function setDisplayMode(newMode) {
        if (newMode !== 'digital' && newMode !== 'pomodoro') return;
        state.mode = newMode;
        if (state.status === 'stopped') {
            resetTimeForCurrentMode();
        }
        render();
        updateHeaderPill();
    }

    /**
     * 切换番茄钟阶段
     */
    function setPomodoroPhase(phase) {
        if (!['work', 'shortBreak', 'longBreak'].includes(phase)) return;
        state.pomodoroPhase = phase;
        if (state.status === 'running') {
            pause();
        }
        state.status = 'stopped';
        resetTimeForCurrentMode();
        render();
        updateHeaderPill();
    }

    /**
     * 切换静音状态
     */
    function toggleMute() {
        state.isMuted = !state.isMuted;
        if (AudioNotifier) {
            AudioNotifier.setMuted(state.isMuted);
        }
        renderUIState();
        if (typeof window.showToast === 'function') {
            window.showToast(state.isMuted ? '🔇 定时器提示音已静音' : '🔔 定时器提示音已开启');
        }
    }

    /**
     * 切换面板展开 / 折叠
     */
    function toggleExpand() {
        state.isExpanded = !state.isExpanded;
        render();
    }

    /**
     * 切换整个定时器面板显隐
     */
    function setVisible(visible) {
        state.showTimer = Boolean(visible);
        if (containerEl) {
            containerEl.style.display = state.showTimer ? 'block' : 'none';
        }
        const pill = document.getElementById('headerTimerPill');
        if (pill) {
            pill.style.display = state.showTimer ? 'inline-flex' : 'none';
        }
    }

    /**
     * 更新顶部导航栏的药丸显示
     */
    function updateHeaderPill() {
        const pill = document.getElementById('headerTimerPill');
        const text = document.getElementById('headerTimerText');
        const icon = document.getElementById('headerTimerIcon');

        if (!pill || !text) return;

        pill.style.display = state.showTimer ? 'inline-flex' : 'none';
        text.innerText = formatTime(state.remainingSeconds);

        if (state.status === 'running') {
            pill.classList.add('bg-violet-600/30', 'border-violet-500/50', 'text-violet-200');
            if (icon) icon.className = 'ph-bold ph-hourglass-high text-violet-400 animate-spin';
        } else if (state.status === 'paused') {
            pill.classList.remove('bg-violet-600/30');
            pill.classList.add('bg-amber-500/20', 'border-amber-500/40', 'text-amber-200');
            if (icon) icon.className = 'ph-bold ph-pause text-amber-400';
        } else {
            pill.classList.remove('bg-violet-600/30', 'border-violet-500/50', 'bg-amber-500/20', 'border-amber-500/40', 'text-amber-200');
            if (icon) icon.className = 'ph-bold ph-timer text-violet-400';
        }
    }

    /**
     * 仅快速刷新时间与进度（高性能每 250ms 更新）
     */
    function renderTimeOnly() {
        const timeStr = formatTime(state.remainingSeconds);
        const percent = state.totalSeconds > 0 ? (state.remainingSeconds / state.totalSeconds) : 0;

        // 1. 折叠微型悬浮药丸时间显示（实时跟随变化）
        const miniTimeEl = document.getElementById('timerMiniDisplay');
        if (miniTimeEl) miniTimeEl.innerText = timeStr;

        // 2. 数字模式时间与进度条
        const digitalTimeEl = document.getElementById('timerDigitalDisplay');
        if (digitalTimeEl) digitalTimeEl.innerText = timeStr;

        const progressBar = document.getElementById('timerProgressBar');
        if (progressBar) {
            progressBar.style.width = `${Math.min(100, Math.max(0, percent * 100))}%`;
        }

        // 3. 番茄模式时间与圆环
        const pomoTimeEl = document.getElementById('timerPomodoroDisplay');
        if (pomoTimeEl) pomoTimeEl.innerText = timeStr;

        const ringProgress = document.getElementById('timerRingProgress');
        if (ringProgress) {
            const offset = RING_CIRCUMFERENCE * (1 - percent);
            ringProgress.style.strokeDashoffset = offset.toFixed(2);
        }
    }

    /**
     * 刷新按钮与图标状态（启动/暂停/重置/静音）
     */
    function renderUIState() {
        renderTimeOnly();

        // 展开卡片播放/暂停主按钮
        const btnPlay = document.getElementById('timerBtnPlay');
        const iconPlay = document.getElementById('timerIconPlay');
        const textPlay = document.getElementById('timerTextPlay');

        if (btnPlay && iconPlay && textPlay) {
            if (state.status === 'running') {
                iconPlay.className = 'ph-bold ph-pause text-base';
                textPlay.innerText = '暂停';
                btnPlay.className = 'flex-1 py-2 px-3 rounded-xl bg-amber-500/90 hover:bg-amber-500 text-white font-semibold text-xs shadow-lg shadow-amber-500/20 flex items-center justify-center gap-1.5 transition active:scale-95 timer-btn';
            } else if (state.status === 'paused') {
                iconPlay.className = 'ph-bold ph-play text-base';
                textPlay.innerText = '继续';
                btnPlay.className = 'flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-semibold text-xs shadow-lg shadow-violet-500/25 flex items-center justify-center gap-1.5 transition active:scale-95 timer-btn';
            } else {
                iconPlay.className = 'ph-bold ph-play text-base';
                textPlay.innerText = '开始';
                btnPlay.className = 'flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-semibold text-xs shadow-lg shadow-violet-500/25 flex items-center justify-center gap-1.5 transition active:scale-95 timer-btn';
            }
        }

        // 折叠微型悬浮药丸按钮与状态
        const miniBtnPlay = document.getElementById('timerMiniBtnPlay');
        const miniIconPlay = document.getElementById('timerMiniIconPlay');
        const miniTimerIcon = document.getElementById('timerMiniTimerIcon');
        const miniBadge = document.getElementById('timerMiniBadge');

        if (miniBtnPlay && miniIconPlay) {
            if (state.status === 'running') {
                miniIconPlay.className = 'ph-bold ph-pause text-xs';
                miniBtnPlay.title = '暂停';
                miniBtnPlay.setAttribute('aria-label', '暂停');
                if (miniTimerIcon) miniTimerIcon.className = 'ph-bold ph-hourglass-high text-violet-400 text-sm animate-spin';
            } else if (state.status === 'paused') {
                miniIconPlay.className = 'ph-bold ph-play text-xs';
                miniBtnPlay.title = '继续';
                miniBtnPlay.setAttribute('aria-label', '继续');
                if (miniTimerIcon) miniTimerIcon.className = 'ph-bold ph-pause text-amber-400 text-sm';
            } else {
                miniIconPlay.className = 'ph-bold ph-play text-xs';
                miniBtnPlay.title = '开始';
                miniBtnPlay.setAttribute('aria-label', '开始');
                if (miniTimerIcon) miniTimerIcon.className = 'ph-bold ph-timer text-violet-400 text-sm';
            }
        }

        if (miniBadge) {
            miniBadge.innerText = state.mode === 'pomodoro' 
                ? (state.pomodoroPhase === 'work' ? '专注' : (state.pomodoroPhase === 'shortBreak' ? '短休' : '长休'))
                : '数字';
        }

        // 静音按钮状态
        const btnMute = document.getElementById('timerBtnMute');
        const iconMute = document.getElementById('timerIconMute');
        if (btnMute && iconMute) {
            if (state.isMuted) {
                iconMute.className = 'ph-bold ph-speaker-slash text-red-400';
                btnMute.title = '取消静音 (当前静音)';
                btnMute.setAttribute('aria-label', '取消静音');
            } else {
                iconMute.className = 'ph-bold ph-speaker-high text-violet-400';
                btnMute.title = '静音提示音';
                btnMute.setAttribute('aria-label', '静音提示音');
            }
        }
    }

    /**
     * 完整重新渲染面板 DOM
     */
    function render() {
        if (!containerEl) return;

        if (!state.showTimer) {
            containerEl.innerHTML = '';
            containerEl.style.display = 'none';
            return;
        }

        containerEl.style.display = 'block';

        const timeStr = formatTime(state.remainingSeconds);
        const percent = state.totalSeconds > 0 ? (state.remainingSeconds / state.totalSeconds) : 0;
        const ringOffset = (RING_CIRCUMFERENCE * (1 - percent)).toFixed(2);

        // 折叠微型药丸视图
        if (!state.isExpanded) {
            const isWork = state.pomodoroPhase === 'work';
            const phaseBadgeText = state.mode === 'pomodoro' 
                ? (isWork ? '专注' : (state.pomodoroPhase === 'shortBreak' ? '短休' : '长休'))
                : '数字';

            containerEl.innerHTML = `
                <div class="fixed bottom-5 right-5 z-40">
                    <div id="timerMiniCard" class="glass-panel border border-violet-500/40 rounded-full px-3 py-1.5 shadow-2xl flex items-center gap-2 text-xs text-white backdrop-blur-xl animate-scaleUp">
                        <button onclick="TimerPanel.toggleExpand()" title="展开定时器面板" class="flex items-center gap-1.5 hover:text-violet-300 transition timer-btn" aria-label="展开定时器">
                            <i id="timerMiniTimerIcon" class="ph-bold ${state.status === 'running' ? 'ph-hourglass-high animate-spin' : (state.status === 'paused' ? 'ph-pause text-amber-400' : 'ph-timer')} text-violet-400 text-sm"></i>
                            <span id="timerMiniDisplay" class="font-mono font-semibold timer-tabular-nums">${timeStr}</span>
                            <span id="timerMiniBadge" class="text-[10px] px-1.5 py-0.2 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                                ${phaseBadgeText}
                            </span>
                        </button>
                        <div class="h-3 w-px bg-white/20"></div>
                        <button id="timerMiniBtnPlay" onclick="TimerPanel.${state.status === 'running' ? 'pause' : 'start'}()" title="${state.status === 'running' ? '暂停' : '启动'}" class="h-6 w-6 rounded-full bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center transition active:scale-90 timer-btn" aria-label="${state.status === 'running' ? '暂停' : '启动'}">
                            <i id="timerMiniIconPlay" class="ph-bold ${state.status === 'running' ? 'ph-pause' : 'ph-play'} text-xs"></i>
                        </button>
                        <button onclick="TimerPanel.toggleExpand()" title="展开面板" class="text-slate-400 hover:text-white transition timer-btn" aria-label="展开面板">
                            <i class="ph-bold ph-caret-up text-xs"></i>
                        </button>
                    </div>
                </div>
            `;
            renderUIState();
            return;
        }

        // 展开完整卡片视图
        containerEl.innerHTML = `
            <div id="timerPanelCard" class="fixed bottom-5 right-5 z-40 w-72 sm:w-80 glass-panel border border-white/15 rounded-3xl p-4 shadow-2xl backdrop-blur-2xl timer-panel-transition select-none text-slate-200" role="region" aria-label="倒计时定时器">
                
                <!-- Card Header -->
                <div class="flex items-center justify-between pb-3 border-b border-white/10 text-xs">
                    <div class="flex items-center gap-2">
                        <div class="h-7 w-7 rounded-xl bg-gradient-to-tr from-violet-600 to-fuchsia-600 flex items-center justify-center text-white shadow-md shadow-violet-500/30">
                            <i class="ph-bold ${state.mode === 'pomodoro' ? 'ph-hourglass' : 'ph-timer'} text-sm"></i>
                        </div>
                        <div>
                            <span class="font-bold text-white tracking-tight">${state.mode === 'pomodoro' ? '番茄专注钟' : '学习定时器'}</span>
                            <span class="text-[10px] text-slate-400 block -mt-0.5">${state.status === 'running' ? '运行中' : (state.status === 'paused' ? '已暂停' : '待命')}</span>
                        </div>
                    </div>

                    <div class="flex items-center gap-1">
                        <!-- Mode Switch Toggle -->
                        <button onclick="TimerPanel.setDisplayMode('${state.mode === 'digital' ? 'pomodoro' : 'digital'}')" title="切换为${state.mode === 'digital' ? '番茄钟模式' : '数字模式'}" class="h-7 px-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-slate-300 hover:text-white flex items-center gap-1 transition timer-btn" aria-label="切换显示模式">
                            <i class="ph-bold ${state.mode === 'digital' ? 'ph-hourglass' : 'ph-clock'} text-violet-400"></i>
                            <span>${state.mode === 'digital' ? '番茄' : '数字'}</span>
                        </button>

                        <!-- Sound Mute Toggle -->
                        <button id="timerBtnMute" onclick="TimerPanel.toggleMute()" title="${state.isMuted ? '取消静音' : '开启静音'}" class="h-7 w-7 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white flex items-center justify-center transition timer-btn" aria-label="静音切换">
                            <i id="timerIconMute" class="ph-bold ${state.isMuted ? 'ph-speaker-slash text-red-400' : 'ph-speaker-high text-violet-400'}"></i>
                        </button>

                        <!-- Open Settings Modal Button -->
                        <button onclick="TimerSettingsModal.open()" title="定时器设置" class="h-7 w-7 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white flex items-center justify-center transition timer-btn" aria-label="设置">
                            <i class="ph-bold ph-gear"></i>
                        </button>

                        <!-- Minimize Button -->
                        <button onclick="TimerPanel.toggleExpand()" title="收起面板" class="h-7 w-7 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white flex items-center justify-center transition timer-btn" aria-label="收起面板">
                            <i class="ph-bold ph-caret-down text-sm"></i>
                        </button>
                    </div>
                </div>

                <!-- Display Mode Body: Digital vs Pomodoro -->
                <div class="py-4">
                    ${state.mode === 'digital' ? renderDigitalBody(timeStr, percent) : renderPomodoroBody(timeStr, percent, ringOffset)}
                </div>

                <!-- Controls Footer -->
                <div class="flex items-center gap-2 pt-2 border-t border-white/10">
                    <!-- Primary Start/Pause -->
                    <button id="timerBtnPlay" onclick="TimerPanel.${state.status === 'running' ? 'pause' : 'start'}()" class="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-semibold text-xs shadow-lg shadow-violet-500/25 flex items-center justify-center gap-1.5 transition active:scale-95 timer-btn" aria-label="${state.status === 'running' ? '暂停' : '开始'}">
                        <i id="timerIconPlay" class="ph-bold ${state.status === 'running' ? 'ph-pause' : 'ph-play'} text-base"></i>
                        <span id="timerTextPlay">${state.status === 'running' ? '暂停' : (state.status === 'paused' ? '继续' : '开始')}</span>
                    </button>

                    <!-- Reset / Stop -->
                    <button onclick="TimerPanel.reset()" title="重置倒计时" class="py-2 px-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-slate-300 hover:text-white font-semibold text-xs flex items-center justify-center gap-1 transition active:scale-95 timer-btn" aria-label="重置倒计时">
                        <i class="ph-bold ph-arrow-counter-clockwise text-sm"></i>
                        <span>重置</span>
                    </button>

                    ${state.mode === 'pomodoro' ? `
                        <!-- Skip Phase -->
                        <button onclick="TimerPanel.skipPomodoroPhase()" title="跳过当前阶段" class="h-8 w-8 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white flex items-center justify-center transition timer-btn" aria-label="跳过当前番茄阶段">
                            <i class="ph-bold ph-skip-forward text-sm"></i>
                        </button>
                    ` : ''}
                </div>

            </div>
        `;

        renderUIState();
    }

    /**
     * 渲染数字计时器模式主体
     */
    function renderDigitalBody(timeStr, percent) {
        return `
            <div class="text-center space-y-3">
                <div class="relative py-2">
                    <div id="timerDigitalDisplay" class="text-4xl font-extrabold text-white tracking-tight font-mono timer-tabular-nums drop-shadow-md">
                        ${timeStr}
                    </div>
                    <div class="text-[11px] text-slate-400 mt-1">
                        默认时长: ${state.defaultDuration} 分钟
                    </div>
                </div>

                <!-- Linear Progress Bar -->
                <div class="w-full bg-white/10 h-2 rounded-full overflow-hidden p-0.5 border border-white/5">
                    <div id="timerProgressBar" class="h-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500 rounded-full transition-all duration-300" style="width: ${Math.min(100, Math.max(0, percent * 100))}%"></div>
                </div>
            </div>
        `;
    }

    /**
     * 渲染番茄钟模式主体（SVG 圆环可视化）
     */
    function renderPomodoroBody(timeStr, percent, ringOffset) {
        const isWork = state.pomodoroPhase === 'work';
        const isShort = state.pomodoroPhase === 'shortBreak';
        const isLong = state.pomodoroPhase === 'longBreak';

        const strokeColor = isWork ? '#8b5cf6' : (isShort ? '#10b981' : '#06b6d4');
        const phaseLabel = isWork ? '专注工作' : (isShort ? '短休小憩' : '长休放松');

        return `
            <div class="space-y-3">
                <!-- Pomodoro Phase Selector Pills -->
                <div class="flex items-center justify-center gap-1 text-[11px] bg-white/5 p-1 rounded-xl border border-white/10">
                    <button onclick="TimerPanel.setPomodoroPhase('work')" class="flex-1 py-1 rounded-lg transition ${isWork ? 'bg-violet-600 text-white font-bold shadow' : 'text-slate-400 hover:text-white'} timer-btn" aria-label="切换到专注阶段">
                        专注 (${state.pomodoroPreset.work}m)
                    </button>
                    <button onclick="TimerPanel.setPomodoroPhase('shortBreak')" class="flex-1 py-1 rounded-lg transition ${isShort ? 'bg-emerald-600 text-white font-bold shadow' : 'text-slate-400 hover:text-white'} timer-btn" aria-label="切换到短休阶段">
                        短休 (${state.pomodoroPreset.shortBreak}m)
                    </button>
                    <button onclick="TimerPanel.setPomodoroPhase('longBreak')" class="flex-1 py-1 rounded-lg transition ${isLong ? 'bg-cyan-600 text-white font-bold shadow' : 'text-slate-400 hover:text-white'} timer-btn" aria-label="切换到长休阶段">
                        长休 (${state.pomodoroPreset.longBreak}m)
                    </button>
                </div>

                <!-- Pomodoro SVG Ring Display -->
                <div class="relative w-36 h-36 mx-auto flex items-center justify-center">
                    <svg class="w-full h-full timer-svg-ring" viewBox="0 0 100 100">
                        <!-- Background Track -->
                        <circle cx="50" cy="50" r="${RING_RADIUS}" stroke="rgba(255, 255, 255, 0.08)" stroke-width="6" fill="transparent" />
                        <!-- Animated Progress Stroke -->
                        <circle id="timerRingProgress" cx="50" cy="50" r="${RING_RADIUS}" stroke="${strokeColor}" stroke-width="6" fill="transparent"
                            stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="${ringOffset}"
                            class="timer-svg-progress" />
                    </svg>

                    <!-- Center Remaining Time -->
                    <div class="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                        <span id="timerPomodoroDisplay" class="text-2xl font-black text-white tracking-tight font-mono timer-tabular-nums leading-none">
                            ${timeStr}
                        </span>
                        <span class="text-[10px] text-slate-300 font-medium mt-1 flex items-center gap-1">
                            <span class="h-1.5 w-1.5 rounded-full ${isWork ? 'bg-violet-400' : 'bg-emerald-400'} animate-pulse"></span>
                            ${phaseLabel}
                        </span>
                        <span class="text-[9px] text-slate-500 font-mono mt-0.5">
                            轮次 #${state.pomodoroCycle}/4
                        </span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 手动跳过当前番茄阶段
     */
    function skipPomodoroPhase() {
        if (state.mode !== 'pomodoro') return;
        handlePomodoroCycleComplete();
    }

    return {
        init,
        start,
        pause,
        reset,
        setDisplayMode,
        setPomodoroPhase,
        skipPomodoroPhase,
        toggleMute,
        toggleExpand,
        setVisible,
        updateHeaderPill,
        getState: () => ({ ...state })
    };
}));
