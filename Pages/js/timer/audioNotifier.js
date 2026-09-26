/**
 * @file audioNotifier.js
 * @description Web Audio API 提示音合成工具，无需外部音频资源，生成纯净悦耳的倒计时完成提示音
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.TimerAudioNotifier = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    let audioCtx = null;
    let muted = false;

    /**
     * 获取或初始化 AudioContext（延迟在用户首次交互后创建，避免浏览器自动播放策略报错）
     * @returns {AudioContext|null}
     */
    function getAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
        return audioCtx;
    }

    /**
     * 播放倒计时完成提示铃声（三音阶水晶和弦提示音：E5 -> A5 -> C#6）
     * @param {Object} [options]
     * @param {number} [options.volume=0.3] 音量 (0.0 ~ 1.0)
     * @returns {boolean} 是否成功触发播放
     */
    function playTimerEndSound(options = {}) {
        if (muted) return false;

        const ctx = getAudioContext();
        if (!ctx) return false;

        const volume = typeof options.volume === 'number' ? Math.max(0, Math.min(1, options.volume)) : 0.28;
        const now = ctx.currentTime;

        // 提示和弦三音符：E5 (659.25Hz), A5 (880.00Hz), C#6 (1108.73Hz)
        const notes = [
            { freq: 659.25, time: 0, duration: 0.9 },
            { freq: 880.00, time: 0.16, duration: 1.1 },
            { freq: 1108.73, time: 0.32, duration: 1.4 }
        ];

        try {
            notes.forEach(({ freq, time, duration }) => {
                const startTime = now + time;
                const stopTime = startTime + duration;

                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                // 正弦波提供纯净的钟声基音
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, startTime);

                // 包络线：快速上升 (Attack) -> 平滑指数衰减 (Exponential Decay)
                gain.gain.setValueAtTime(0.0001, startTime);
                gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(startTime);
                osc.stop(stopTime);
            });
            return true;
        } catch (e) {
            console.warn('[AudioNotifier] 播放提示音失败:', e);
            return false;
        }
    }

    /**
     * 播放轻柔的按键/滴答反馈音（用于切换或开始时提供触觉反馈）
     * @param {number} [freq=800] 频率
     * @param {number} [duration=0.04] 持续时长
     */
    function playTickSound(freq = 900, duration = 0.04) {
        if (muted) return;

        const ctx = getAudioContext();
        if (!ctx) return;

        try {
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now);

            gain.gain.setValueAtTime(0.001, now);
            gain.gain.exponentialRampToValueAtTime(0.08, now + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + duration);
        } catch (e) {}
    }

    /**
     * 唤醒或解锁 AudioContext
     */
    function unlock() {
        const ctx = getAudioContext();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume();
        }
    }

    // 绑定用户首次交互解锁音频
    if (typeof window !== 'undefined') {
        const unlockHandler = function () {
            unlock();
            window.removeEventListener('click', unlockHandler);
            window.removeEventListener('keydown', unlockHandler);
            window.removeEventListener('touchstart', unlockHandler);
        };
        window.addEventListener('click', unlockHandler, { passive: true });
        window.addEventListener('keydown', unlockHandler, { passive: true });
        window.addEventListener('touchstart', unlockHandler, { passive: true });
    }

    return {
        playTimerEndSound,
        playTickSound,
        unlock,
        setMuted: (val) => { muted = Boolean(val); },
        isMuted: () => muted,
        toggleMute: () => { muted = !muted; return muted; }
    };
}));
