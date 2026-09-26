/**
 * @file settingsModal.js
 * @description 定时器与番茄钟偏好设置弹窗组件，配置项与 IndexedDB 双向绑定并即时生效
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./settingsStore', './timerComponent'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./settingsStore'), require('./timerComponent'));
    } else {
        root.TimerSettingsModal = factory(root.TimerSettingsStore, root.TimerPanel);
    }
}(typeof self !== 'undefined' ? self : this, function (SettingsStore, TimerPanel) {
    'use strict';

    let modalContainerEl = null;

    /**
     * 初始化设置弹窗
     * @param {HTMLElement|string} [mountPoint]
     */
    function init(mountPoint = '#timerSettingsModalContainer') {
        if (typeof mountPoint === 'string') {
            modalContainerEl = document.querySelector(mountPoint);
        } else if (mountPoint instanceof HTMLElement) {
            modalContainerEl = mountPoint;
        }

        if (!modalContainerEl) {
            modalContainerEl = document.createElement('div');
            modalContainerEl.id = 'timerSettingsModalContainer';
            document.body.appendChild(modalContainerEl);
        }

        renderModalSkeleton();
        bindGlobalKeys();
    }

    /**
     * 渲染弹窗基础 DOM 骨架
     */
    function renderModalSkeleton() {
        if (!modalContainerEl) return;

        modalContainerEl.innerHTML = `
            <div id="modalTimerSettings" onclick="if (event.target === this) TimerSettingsModal.close()" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 hidden animate-fadeIn" role="dialog" aria-modal="true" aria-labelledby="timerSettingsTitle">
                <div class="glass-panel border border-white/15 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-scaleUp">
                    
                    <!-- Header -->
                    <div class="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
                        <div class="flex items-center gap-3">
                            <div class="h-10 w-10 rounded-2xl bg-gradient-to-tr from-violet-600 to-fuchsia-600 text-white flex items-center justify-center text-lg shadow-lg shadow-violet-500/20">
                                <i class="ph-bold ph-sliders-horizontal"></i>
                            </div>
                            <div>
                                <h3 id="timerSettingsTitle" class="text-base sm:text-lg font-bold text-white">定时器偏好设置</h3>
                                <p class="text-xs text-slate-400">配置定时时长、显示开关与番茄钟预设（自动持久化到本地 IndexedDB）</p>
                            </div>
                        </div>
                        <button onclick="TimerSettingsModal.close()" class="h-8 w-8 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white transition timer-btn" aria-label="关闭设置弹窗">
                            <i class="ph-bold ph-x text-base"></i>
                        </button>
                    </div>

                    <!-- Form Content Body -->
                    <form id="timerSettingsForm" onsubmit="event.preventDefault(); TimerSettingsModal.save();" class="p-6 space-y-5 text-sm">
                        
                        <!-- 1. 默认定时时长 (defaultDuration) -->
                        <div class="space-y-1.5">
                            <div class="flex items-center justify-between">
                                <label for="settingDefaultDuration" class="font-semibold text-slate-200 flex items-center gap-2">
                                    <i class="ph-bold ph-hourglass-medium text-violet-400"></i>
                                    默认定时时长 (分钟)
                                </label>
                                <span class="text-xs text-slate-400">数字模式生效</span>
                            </div>
                            <div class="relative">
                                <input id="settingDefaultDuration" type="number" min="1" max="180" step="1" required
                                    class="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 transition" />
                                <span class="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-mono">min</span>
                            </div>
                        </div>

                        <!-- 2. UI 中是否显示定时器面板 (showTimer) -->
                        <div class="flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/5">
                            <div class="space-y-0.5">
                                <div class="font-semibold text-slate-200 flex items-center gap-2">
                                    <i class="ph-bold ph-eye text-violet-400"></i>
                                    在界面中显示定时器
                                </div>
                                <div class="text-xs text-slate-400">关闭后定时器面板与悬浮按钮将完全隐藏</div>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input id="settingShowTimer" type="checkbox" class="sr-only peer">
                                <div class="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
                            </label>
                        </div>

                        <!-- 3. 默认显示模式 (displayMode: 'digital' | 'pomodoro') -->
                        <div class="space-y-1.5">
                            <label class="font-semibold text-slate-200 flex items-center gap-2">
                                <i class="ph-bold ph-circles-four text-violet-400"></i>
                                默认显示模式
                            </label>
                            <div class="grid grid-cols-2 gap-3">
                                <label class="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/10 cursor-pointer hover:border-violet-500/40 transition">
                                    <input type="radio" name="settingDisplayMode" value="digital" class="accent-violet-600">
                                    <div>
                                        <div class="font-medium text-white text-xs">数字时钟模式</div>
                                        <div class="text-[11px] text-slate-400">MM:SS 数字 + 进度条</div>
                                    </div>
                                </label>
                                <label class="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/10 cursor-pointer hover:border-violet-500/40 transition">
                                    <input type="radio" name="settingDisplayMode" value="pomodoro" class="accent-violet-600">
                                    <div>
                                        <div class="font-medium text-white text-xs">番茄钟模式</div>
                                        <div class="text-[11px] text-slate-400">动态 SVG 环形进度</div>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <!-- 4. 是否默认开启声音 (soundEnabled) -->
                        <div class="flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/5">
                            <div class="space-y-0.5">
                                <div class="font-semibold text-slate-200 flex items-center gap-2">
                                    <i class="ph-bold ph-speaker-high text-violet-400"></i>
                                    倒计时结束提示音
                                </div>
                                <div class="text-xs text-slate-400">基于 Web Audio API 合成的轻柔三音阶水晶钟声</div>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input id="settingSoundEnabled" type="checkbox" class="sr-only peer">
                                <div class="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
                            </label>
                        </div>

                        <!-- 5. 番茄模式预设 (pomodoroPreset: work, shortBreak, longBreak) -->
                        <div class="space-y-2 pt-1">
                            <label class="font-semibold text-slate-200 flex items-center gap-2">
                                <i class="ph-bold ph-clock-countdown text-violet-400"></i>
                                番茄工作法循环时长预设 (分钟)
                            </label>
                            <div class="grid grid-cols-3 gap-2.5">
                                <div class="space-y-1">
                                    <span class="text-[11px] text-slate-400">专注工作</span>
                                    <input id="settingPomoWork" type="number" min="1" max="120" step="1" required
                                        class="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-center font-mono text-sm focus:outline-none focus:border-violet-500" />
                                </div>
                                <div class="space-y-1">
                                    <span class="text-[11px] text-slate-400">短休小憩</span>
                                    <input id="settingPomoShort" type="number" min="1" max="60" step="1" required
                                        class="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-center font-mono text-sm focus:outline-none focus:border-violet-500" />
                                </div>
                                <div class="space-y-1">
                                    <span class="text-[11px] text-slate-400">长休深度放松</span>
                                    <input id="settingPomoLong" type="number" min="1" max="120" step="1" required
                                        class="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-center font-mono text-sm focus:outline-none focus:border-violet-500" />
                                </div>
                            </div>
                        </div>

                    </form>

                    <!-- Footer Actions -->
                    <div class="px-6 py-4 border-t border-white/10 bg-slate-900/60 flex items-center justify-between gap-3">
                        <button type="button" onclick="TimerSettingsModal.resetDefaults()" class="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition timer-btn" aria-label="恢复默认值">
                            <i class="ph-bold ph-arrow-counter-clockwise"></i>
                            恢复默认
                        </button>

                        <div class="flex items-center gap-2">
                            <button type="button" onclick="TimerSettingsModal.close()" class="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-semibold transition timer-btn">
                                取消
                            </button>
                            <button type="button" onclick="TimerSettingsModal.save()" class="px-5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-xs font-bold shadow-lg shadow-violet-500/25 flex items-center gap-1.5 transition active:scale-95 timer-btn">
                                <i class="ph-bold ph-check"></i>
                                保存并应用
                            </button>
                        </div>
                    </div>

                </div>
            </div>
        `;
    }

    /**
     * 打开偏好设置弹窗并加载最新 IndexedDB 配置
     */
    async function open() {
        if (!modalContainerEl || !document.getElementById('modalTimerSettings')) {
            init();
        }

        const modal = document.getElementById('modalTimerSettings');
        if (!modal) return;

        // 从 store 读取最新数据
        const settings = SettingsStore ? await SettingsStore.getAll() : SettingsStore.DEFAULT_SETTINGS;

        // 回填表单
        const durInput = document.getElementById('settingDefaultDuration');
        if (durInput) durInput.value = settings.defaultDuration || 25;

        const showInput = document.getElementById('settingShowTimer');
        if (showInput) showInput.checked = Boolean(settings.showTimer);

        const modeRadios = document.getElementsByName('settingDisplayMode');
        modeRadios.forEach(radio => {
            radio.checked = radio.value === settings.displayMode;
        });

        const soundInput = document.getElementById('settingSoundEnabled');
        if (soundInput) soundInput.checked = Boolean(settings.soundEnabled);

        const pomoPreset = settings.pomodoroPreset || {};
        const workInput = document.getElementById('settingPomoWork');
        if (workInput) workInput.value = pomoPreset.work || 25;

        const shortInput = document.getElementById('settingPomoShort');
        if (shortInput) shortInput.value = pomoPreset.shortBreak || 5;

        const longInput = document.getElementById('settingPomoLong');
        if (longInput) longInput.value = pomoPreset.longBreak || 15;

        modal.classList.remove('hidden');
    }

    /**
     * 关闭弹窗
     */
    function close() {
        const modal = document.getElementById('modalTimerSettings');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    /**
     * 保存表单数据至 IndexedDB 并即时触发更新
     */
    async function save() {
        const defaultDuration = parseInt(document.getElementById('settingDefaultDuration').value, 10) || 25;
        const showTimer = document.getElementById('settingShowTimer').checked;
        
        let displayMode = 'digital';
        const modeRadios = document.getElementsByName('settingDisplayMode');
        modeRadios.forEach(r => {
            if (r.checked) displayMode = r.value;
        });

        const soundEnabled = document.getElementById('settingSoundEnabled').checked;

        const pomodoroPreset = {
            work: parseInt(document.getElementById('settingPomoWork').value, 10) || 25,
            shortBreak: parseInt(document.getElementById('settingPomoShort').value, 10) || 5,
            longBreak: parseInt(document.getElementById('settingPomoLong').value, 10) || 15
        };

        if (SettingsStore) {
            await SettingsStore.set('defaultDuration', defaultDuration);
            await SettingsStore.set('showTimer', showTimer);
            await SettingsStore.set('displayMode', displayMode);
            await SettingsStore.set('soundEnabled', soundEnabled);
            await SettingsStore.set('pomodoroPreset', pomodoroPreset);
        }

        close();

        if (typeof window.showToast === 'function') {
            window.showToast('✅ 定时器配置已保存至本地数据库', 'info');
        }
    }

    /**
     * 恢复默认配置
     */
    async function resetDefaults() {
        if (!confirm('确定将定时器配置恢复为系统初始默认值吗？')) return;

        if (SettingsStore) {
            const def = await SettingsStore.reset();
            // 重新回填表单
            document.getElementById('settingDefaultDuration').value = def.defaultDuration;
            document.getElementById('settingShowTimer').checked = def.showTimer;
            const modeRadios = document.getElementsByName('settingDisplayMode');
            modeRadios.forEach(radio => {
                radio.checked = radio.value === def.displayMode;
            });
            document.getElementById('settingSoundEnabled').checked = def.soundEnabled;
            document.getElementById('settingPomoWork').value = def.pomodoroPreset.work;
            document.getElementById('settingPomoShort').value = def.pomodoroPreset.shortBreak;
            document.getElementById('settingPomoLong').value = def.pomodoroPreset.longBreak;
        }

        if (typeof window.showToast === 'function') {
            window.showToast('🔄 已恢复为初始默认配置', 'info');
        }
    }

    /**
     * 监听全局键盘事件 (Escape 关闭)
     */
    function bindGlobalKeys() {
        window.addEventListener('keydown', (e) => {
            const modal = document.getElementById('modalTimerSettings');
            if (modal && !modal.classList.contains('hidden')) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    close();
                }
            }
        });
    }

    return {
        init,
        open,
        close,
        save,
        resetDefaults
    };
}));
