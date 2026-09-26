/**
 * @file settingsStore.js
 * @description IndexedDB 轻量封装模块，用于持久化存储应用与定时器设置
 * 数据库: app-settings-db | 对象仓库: settings | 主键: key
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.TimerSettingsStore = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const DB_NAME = 'app-settings-db';
    const DB_VERSION = 1;
    const STORE_NAME = 'settings';
    const FALLBACK_STORAGE_KEY = 'app_settings_db_fallback';

    /**
     * 定时器默认配置项
     */
    const DEFAULT_SETTINGS = {
        defaultDuration: 25,                 // 默认定时时长（分钟）
        showTimer: true,                     // 是否在 UI 中展示定时器面板
        displayMode: 'digital',              // 默认显示模式: 'digital' | 'pomodoro'
        soundEnabled: true,                  // 是否默认开启提示音
        pomodoroPreset: {                    // 番茄模式预设（分钟）
            work: 25,
            shortBreak: 5,
            longBreak: 15
        }
    };

    let dbInstance = null;
    const listeners = new Set();

    /**
     * 初始化 / 打开 IndexedDB 数据库
     * @returns {Promise<IDBDatabase>}
     */
    function openDB() {
        if (dbInstance) {
            return Promise.resolve(dbInstance);
        }

        return new Promise((resolve) => {
            if (typeof window === 'undefined' || !('indexedDB' in window)) {
                console.warn('[SettingsStore] 当前环境不支持 IndexedDB，将降级至本地持久化存储');
                resolve(null);
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function (event) {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                }
            };

            request.onsuccess = function (event) {
                dbInstance = event.target.result;

                // 监听连接断开或版本变化
                dbInstance.onversionchange = function () {
                    dbInstance.close();
                    dbInstance = null;
                };

                resolve(dbInstance);
            };

            request.onerror = function (event) {
                console.error('[SettingsStore] IndexedDB 打开失败:', event.target.error);
                resolve(null); // 优雅降级，不阻断流程
            };

            request.onblocked = function () {
                console.warn('[SettingsStore] IndexedDB 打开被阻塞，请关闭其他正在使用旧版本的页面');
            };
        });
    }

    let inMemoryStore = null;

    /**
     * 本地降级读写助手（支持 localStorage 与内存态）
     */
    const FallbackStorage = {
        getAll: function () {
            try {
                if (typeof localStorage !== 'undefined') {
                    const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
                    return raw ? JSON.parse(raw) : (inMemoryStore ? { ...inMemoryStore } : null);
                }
                return inMemoryStore ? { ...inMemoryStore } : null;
            } catch (e) {
                return inMemoryStore ? { ...inMemoryStore } : null;
            }
        },
        saveAll: function (data) {
            inMemoryStore = { ...data };
            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(data));
                }
            } catch (e) {
                console.error('[SettingsStore] localStorage 写入失败:', e);
            }
        },
        getItem: function (key) {
            const data = this.getAll();
            return data && key in data ? data[key] : undefined;
        },
        setItem: function (key, value) {
            const data = this.getAll() || { ...DEFAULT_SETTINGS };
            data[key] = value;
            this.saveAll(data);
        },
        reset: function () {
            this.saveAll({ ...DEFAULT_SETTINGS });
        }
    };

    /**
     * 获取单个配置项
     * @param {string} key 配置项键名
     * @param {*} [defaultValue] 默认值
     * @returns {Promise<*>}
     */
    async function get(key, defaultValue) {
        const fallbackVal = defaultValue !== undefined ? defaultValue : DEFAULT_SETTINGS[key];

        try {
            const db = await openDB();
            if (!db) {
                const val = FallbackStorage.getItem(key);
                return val !== undefined ? val : fallbackVal;
            }

            return new Promise((resolve) => {
                const tx = db.transaction([STORE_NAME], 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(key);

                req.onsuccess = function () {
                    if (req.result && req.result.value !== undefined) {
                        resolve(req.result.value);
                    } else {
                        resolve(fallbackVal);
                    }
                };

                req.onerror = function () {
                    resolve(fallbackVal);
                };
            });
        } catch (e) {
            console.error(`[SettingsStore] 获取配置项 [${key}] 异常:`, e);
            return fallbackVal;
        }
    }

    /**
     * 写入单个配置项
     * @param {string} key 配置项键名
     * @param {*} value 配置项值
     * @returns {Promise<void>}
     */
    async function set(key, value) {
        try {
            const db = await openDB();
            if (!db) {
                FallbackStorage.setItem(key, value);
                notifyListeners(key, value);
                return;
            }

            await new Promise((resolve, reject) => {
                const tx = db.transaction([STORE_NAME], 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const req = store.put({ key: key, value: value });

                req.onsuccess = () => resolve();
                req.onerror = (e) => reject(e.target.error);
            });

            // 保持 fallback 备份同步
            FallbackStorage.setItem(key, value);
            notifyListeners(key, value);
        } catch (e) {
            console.error(`[SettingsStore] 写入配置项 [${key}] 异常:`, e);
            FallbackStorage.setItem(key, value);
            notifyListeners(key, value);
        }
    }

    /**
     * 获取所有配置项（深度合并默认值）
     * @returns {Promise<typeof DEFAULT_SETTINGS>}
     */
    async function getAll() {
        const result = {
            ...DEFAULT_SETTINGS,
            pomodoroPreset: { ...DEFAULT_SETTINGS.pomodoroPreset }
        };

        try {
            const db = await openDB();
            if (!db) {
                const fallback = FallbackStorage.getAll();
                if (fallback) {
                    return mergeSettings(result, fallback);
                }
                return result;
            }

            return new Promise((resolve) => {
                const tx = db.transaction([STORE_NAME], 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.getAll();

                req.onsuccess = function () {
                    const records = req.result || [];
                    records.forEach(rec => {
                        if (rec && rec.key) {
                            if (rec.key === 'pomodoroPreset' && typeof rec.value === 'object' && rec.value !== null) {
                                result.pomodoroPreset = { ...result.pomodoroPreset, ...rec.value };
                            } else {
                                result[rec.key] = rec.value;
                            }
                        }
                    });
                    resolve(result);
                };

                req.onerror = function () {
                    resolve(result);
                };
            });
        } catch (e) {
            console.error('[SettingsStore] 读取全部配置项异常:', e);
            return result;
        }
    }

    /**
     * 恢复所有配置为默认值
     * @returns {Promise<typeof DEFAULT_SETTINGS>}
     */
    async function reset() {
        const defaultCopy = {
            ...DEFAULT_SETTINGS,
            pomodoroPreset: { ...DEFAULT_SETTINGS.pomodoroPreset }
        };

        try {
            const db = await openDB();
            if (db) {
                await new Promise((resolve, reject) => {
                    const tx = db.transaction([STORE_NAME], 'readwrite');
                    const store = tx.objectStore(STORE_NAME);
                    const reqClear = store.clear();

                    reqClear.onsuccess = function () {
                        // 重新灌入默认值
                        let pending = Object.keys(defaultCopy).length;
                        if (pending === 0) return resolve();

                        for (const [k, v] of Object.entries(defaultCopy)) {
                            const putReq = store.put({ key: k, value: v });
                            putReq.onsuccess = () => {
                                pending--;
                                if (pending === 0) resolve();
                            };
                            putReq.onerror = (e) => reject(e.target.error);
                        }
                    };

                    reqClear.onerror = (e) => reject(e.target.error);
                });
            }

            FallbackStorage.reset();
            notifyListeners('*', defaultCopy);
            return defaultCopy;
        } catch (e) {
            console.error('[SettingsStore] 重置配置项异常:', e);
            FallbackStorage.reset();
            notifyListeners('*', defaultCopy);
            return defaultCopy;
        }
    }

    /**
     * 合并两个设置对象
     */
    function mergeSettings(target, source) {
        if (!source || typeof source !== 'object') return target;
        for (const [key, value] of Object.entries(source)) {
            if (key === 'pomodoroPreset' && typeof value === 'object' && value !== null) {
                target.pomodoroPreset = { ...target.pomodoroPreset, ...value };
            } else if (value !== undefined) {
                target[key] = value;
            }
        }
        return target;
    }

    /**
     * 订阅设置项变更事件
     * @param {Function} callback 回调函数: (key, value) => void
     * @returns {Function} 取消订阅函数
     */
    function subscribe(callback) {
        if (typeof callback === 'function') {
            listeners.add(callback);
        }
        return () => listeners.delete(callback);
    }

    /**
     * 通知所有监听者
     */
    function notifyListeners(key, value) {
        listeners.forEach(fn => {
            try {
                fn(key, value);
            } catch (err) {
                console.error('[SettingsStore] 监听器执行错误:', err);
            }
        });
    }

    return {
        DEFAULT_SETTINGS,
        openDB,
        get,
        set,
        getAll,
        reset,
        subscribe
    };
}));
