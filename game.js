// --- Constants & Data Definitions ---

// --- Sound (SFX) ---
// 说明：仅用于“界面/里程碑”提示音，不包含任何“受伤/被攻击”音效（避免混乱）。
class SoundManager {
    constructor() {
        this.enabled = true;
        this.volume = 0.22;
        this.ctx = null;
        this.master = null;
        this.comp = null;
        this.fxSend = null;
        this.fxDelay = null;
        this.fxFeedback = null;
        this.fxFilter = null;
        this._lastPlayAt = Object.create(null);
        this._noiseBuf = null;
        this._loadPrefs();
    }

    _loadPrefs() {
        const k = localStorage.getItem('teemo_sfx_enabled');
        if (k !== null) this.enabled = (k === '1');
        const v = parseFloat(localStorage.getItem('teemo_sfx_volume') || '');
        if (!Number.isNaN(v)) this.volume = Math.max(0, Math.min(1, v));
    }

    _savePrefs() {
        try {
            localStorage.setItem('teemo_sfx_enabled', this.enabled ? '1' : '0');
            localStorage.setItem('teemo_sfx_volume', String(this.volume));
        } catch (_) { }
    }

    setEnabled(on) {
        this.enabled = !!on;
        this._savePrefs();
        if (!this.enabled) {
            // 不强制关闭 ctx，避免频繁创建；只是不再播放。
        }
    }

    toggle() {
        this.setEnabled(!this.enabled);
        // 给一个非常轻的提示音（仅在开启后）
        if (this.enabled) this.play('toggleOn');
    }

    async _ensureContext() {
        if (this.ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;

        // 轻量压缩/限幅：避免多声部叠加导致爆音
        this.comp = this.ctx.createDynamicsCompressor();
        this.comp.threshold.value = -18;
        this.comp.knee.value = 20;
        this.comp.ratio.value = 6;
        this.comp.attack.value = 0.004;
        this.comp.release.value = 0.12;

        // 简单“空间感”总线：短 delay + 反馈（非常克制，不要拖尾太长）
        // master -> comp -> dest
        this.master.connect(this.comp);
        this.comp.connect(this.ctx.destination);

        // send -> delay -> filter -> feedback -> delay
        this.fxSend = this.ctx.createGain();
        this.fxSend.gain.value = 0.18; // 全局回声比例（克制）
        this.fxDelay = this.ctx.createDelay(0.6);
        this.fxDelay.delayTime.value = 0.11;
        this.fxFeedback = this.ctx.createGain();
        this.fxFeedback.gain.value = 0.22;
        this.fxFilter = this.ctx.createBiquadFilter();
        this.fxFilter.type = 'lowpass';
        this.fxFilter.frequency.value = 2600;
        this.fxFilter.Q.value = 0.6;

        this.fxSend.connect(this.fxDelay);
        this.fxDelay.connect(this.fxFilter);
        this.fxFilter.connect(this.fxFeedback);
        this.fxFeedback.connect(this.fxDelay);
        // 回声输出也走 comp，避免尖峰
        this.fxFilter.connect(this.comp);

        // 预生成噪声（用于“金币/闪光”那种轻打击感）
        this._noiseBuf = this._noiseBuf || this._createNoiseBuffer(0.25);
        try { await this.ctx.resume(); } catch (_) { }
    }

    async _resumeIfNeeded() {
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') {
            try { await this.ctx.resume(); } catch (_) { }
        }
    }

    _rateLimit(name, minIntervalMs) {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const last = this._lastPlayAt[name] || 0;
        if (now - last < minIntervalMs) return true;
        this._lastPlayAt[name] = now;
        return false;
    }

    _rand(min, max) { return min + Math.random() * (max - min); }

    _createNoiseBuffer(seconds) {
        if (!this.ctx) return null;
        const len = Math.max(1, Math.floor(this.ctx.sampleRate * Math.max(0.02, seconds || 0.25)));
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);
        return buf;
    }

    _mkPanner(pan) {
        // StereoPanner 兼容性不错；不支持就退化为直连
        if (!this.ctx || !this.ctx.createStereoPanner) return null;
        const p = this.ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan || 0));
        return p;
    }

    _connectToMaster(srcNode, { pan = 0, send = 0 } = {}) {
        if (!this.ctx || !this.master || !srcNode) return;
        let out = srcNode;
        const pn = this._mkPanner(pan || 0);
        if (pn) {
            out.connect(pn);
            out = pn;
        }
        out.connect(this.master);
        if (this.fxSend && send > 0.0001) {
            const s = this.ctx.createGain();
            s.gain.value = Math.max(0, Math.min(1, send));
            out.connect(s);
            s.connect(this.fxSend);
        }
    }

    _tone({ at, freq, dur, type, gain, pan, glideTo, q }) {
        if (!this.ctx || !this.master) return;
        const t0 = at;
        const d = Math.max(0.02, dur || 0.08);
        const peak = Math.max(0.0001, Math.min(1, (gain ?? 1) * this.volume));

        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.08);

        const osc = this.ctx.createOscillator();
        osc.type = type || 'sine';

        // 少量随机 detune 增加“辨识度/不那么死板”
        const det = this._rand(-12, 12); // cents
        osc.detune.setValueAtTime(det, t0);
        osc.frequency.setValueAtTime(Math.max(30, freq || 600), t0);
        if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, glideTo), t0 + Math.max(0.02, d));

        // 可选滤波（用于更像“金币/铃铛”的质感）
        let nodeOut = g;
        if (q) {
            const bp = this.ctx.createBiquadFilter();
            bp.type = q.type || 'bandpass';
            bp.frequency.setValueAtTime(q.f || 1800, t0);
            bp.Q.setValueAtTime(q.Q || 6, t0);
            osc.connect(bp);
            bp.connect(g);
        } else {
            osc.connect(g);
        }
        this._connectToMaster(g, { pan: pan || 0, send: 0.18 });

        osc.start(t0);
        osc.stop(t0 + d + 0.12);
    }

    _fmTone({ at, carrier, mod, index, dur, type, gain, pan, glideTo }) {
        if (!this.ctx || !this.master) return;
        const t0 = at;
        const d = Math.max(0.03, dur || 0.10);
        const peak = Math.max(0.0001, Math.min(1, (gain ?? 1) * this.volume));

        // Carrier
        const osc = this.ctx.createOscillator();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(Math.max(30, carrier || 440), t0);
        if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, glideTo), t0 + Math.max(0.03, d));

        // Modulator -> carrier.frequency
        const modOsc = this.ctx.createOscillator();
        modOsc.type = 'sine';
        modOsc.frequency.setValueAtTime(Math.max(10, mod || 80), t0);
        const modGain = this.ctx.createGain();
        modGain.gain.setValueAtTime(Math.max(0, index || 80), t0);
        modGain.gain.exponentialRampToValueAtTime(Math.max(0.001, (index || 80) * 0.25), t0 + d);
        modOsc.connect(modGain);
        modGain.connect(osc.frequency);

        // Amp env
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.10);

        osc.connect(g);
        this._connectToMaster(g, { pan: pan || 0, send: 0.22 });

        modOsc.start(t0);
        osc.start(t0);
        osc.stop(t0 + d + 0.14);
        modOsc.stop(t0 + d + 0.14);
    }

    _noiseTick({ at, dur, gain, pan, filter }) {
        if (!this.ctx || !this.master || !this._noiseBuf) return;
        const t0 = at;
        const d = Math.max(0.01, dur || 0.04);
        const peak = Math.max(0.0001, Math.min(1, (gain ?? 1) * this.volume));

        const src = this.ctx.createBufferSource();
        src.buffer = this._noiseBuf;

        let node = src;
        if (filter) {
            const f = this.ctx.createBiquadFilter();
            f.type = filter.type || 'bandpass';
            f.frequency.setValueAtTime(filter.f || 2200, t0);
            f.Q.setValueAtTime(filter.Q || 10, t0);
            node.connect(f);
            node = f;
        }

        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.06);
        node.connect(g);
        this._connectToMaster(g, { pan: pan || 0, send: 0.12 });

        src.start(t0);
        src.stop(t0 + d + 0.08);
    }

    _whoosh({ at, dur, fromF, toF, gain, pan }) {
        // “扫频气流” = 噪声 + 带通滤波频率扫动
        if (!this.ctx || !this.master || !this._noiseBuf) return;
        const t0 = at;
        const d = Math.max(0.04, dur || 0.18);
        const peak = Math.max(0.0001, Math.min(1, (gain ?? 1) * this.volume));

        const src = this.ctx.createBufferSource();
        src.buffer = this._noiseBuf;

        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 0.9;
        const f0 = Math.max(120, fromF || 300);
        const f1 = Math.max(160, toF || 2600);
        bp.frequency.setValueAtTime(f0, t0);
        bp.frequency.exponentialRampToValueAtTime(f1, t0 + d);

        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.010);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.10);

        src.connect(bp);
        bp.connect(g);
        this._connectToMaster(g, { pan: pan || 0, send: 0.28 });

        src.start(t0);
        src.stop(t0 + d + 0.12);
    }

    _seq(at, steps) {
        let t = at;
        (steps || []).forEach(s => {
            const dt = Math.max(0, s.dt || 0);
            t += dt;
            if (s.noise) {
                this._noiseTick({ at: t, ...s.noise });
            }
            if (s.whoosh) {
                this._whoosh({ at: t, ...s.whoosh });
            }
            if (s.tone) {
                this._tone({ at: t, ...s.tone });
            }
            if (s.fm) {
                this._fmTone({ at: t, ...s.fm });
            }
        });
    }

    async play(name) {
        if (!this.enabled) return;
        await this._ensureContext();
        if (!this.ctx || !this.master) return;
        await this._resumeIfNeeded();
        if (this.ctx.state !== 'running') return;

        const t = this.ctx.currentTime;

        // 每个事件单独的限流（更丰富音型会更长，避免重复叠加）
        const minIntervals = {
            click: 45,
            open: 120,
            close: 120,
            start: 180,
            purchase: 120,
            levelUp: 380,
            bossSpawn: 600,
            bossClear: 650,
            loot: 180,
            stageClear: 650,
            pause: 140,
            resume: 140,
            toggleOn: 120,
            toggleOff: 120,
            // 战斗手感音：强限流 + 调用处再做概率触发，避免嘈杂
            shot: 90,
            hit: 90,
            skill: 160
        };
        const minI = (minIntervals[name] ?? 90);
        if (this._rateLimit(name, minI)) return;

        // 事件到“音型/音色”的映射：强调识别度（短旋律/双音/轻打击）
        // 注意：依然不用于“受伤/被攻击”类事件。
        const panTiny = this._rand(-0.15, 0.15);
        const seqs = {
            click: () => this._seq(t, [
                // “UI啪嗒” = 很短的 click + 一点点高频噪声
                { dt: 0.0, noise: { dur: 0.012, gain: 0.16, pan: panTiny, filter: { type: 'highpass', f: 4200, Q: 0.7 } } },
                { dt: 0.0, fm: { carrier: 820, mod: 220, index: 60, dur: 0.04, type: 'sine', gain: 0.42, pan: panTiny } },
                { dt: 0.04, tone: { freq: 640, dur: 0.040, type: 'triangle', gain: 0.55, pan: panTiny } },
            ]),
            open: () => this._seq(t, [
                // “展开” = whoosh 上扫 + 小和弦琶音
                { dt: 0.0, whoosh: { dur: 0.16, fromF: 260, toF: 2600, gain: 0.22, pan: -0.04 } },
                { dt: 0.02, tone: { freq: 659, dur: 0.06, type: 'sine', gain: 0.55, pan: -0.06 } }, // E
                { dt: 0.06, tone: { freq: 988, dur: 0.07, type: 'sine', gain: 0.58, pan: 0.00 } },  // B
                { dt: 0.06, tone: { freq: 1319, dur: 0.08, type: 'triangle', gain: 0.62, pan: 0.06 } }, // E
            ]),
            close: () => this._seq(t, [
                // “收起” = whoosh 下扫 + 下降双音
                { dt: 0.0, whoosh: { dur: 0.14, fromF: 2200, toF: 320, gain: 0.20, pan: 0.04 } },
                { dt: 0.03, tone: { freq: 784, dur: 0.055, type: 'sine', gain: 0.52, pan: 0.06 } },
                { dt: 0.06, tone: { freq: 523, dur: 0.075, type: 'sine', gain: 0.58, pan: -0.06 } },
            ]),
            start: () => this._seq(t, [
                // “开局” = 轻 whoosh + 迷你 fanfare（大调和弦）
                { dt: 0.0, whoosh: { dur: 0.18, fromF: 240, toF: 3000, gain: 0.24, pan: 0.00 } },
                { dt: 0.02, tone: { freq: 523, dur: 0.06, type: 'sine', gain: 0.52, pan: -0.06 } },  // C
                { dt: 0.06, tone: { freq: 659, dur: 0.06, type: 'sine', gain: 0.56, pan: 0.00 } },   // E
                { dt: 0.06, tone: { freq: 784, dur: 0.07, type: 'triangle', gain: 0.60, pan: 0.06 } }, // G
                { dt: 0.07, fm:   { carrier: 1046, mod: 320, index: 90, dur: 0.09, type: 'sine', gain: 0.42, pan: 0.02, glideTo: 1568 } },
            ]),
            purchase: () => this._seq(t, [
                // “金币” = 叮叮（带通） + 金属感 FM 点缀 + 轻微闪光
                { dt: 0.0, noise: { dur: 0.018, gain: 0.18, pan: -0.05, filter: { type: 'bandpass', f: 2400, Q: 12 } } },
                { dt: 0.0, tone: { freq: 988, dur: 0.055, type: 'triangle', gain: 0.62, pan: -0.05, q: { type: 'bandpass', f: 1900, Q: 7 } } },
                { dt: 0.06, tone: { freq: 1480, dur: 0.070, type: 'triangle', gain: 0.68, pan: 0.05, q: { type: 'bandpass', f: 2300, Q: 7 } } },
                { dt: 0.04, fm:   { carrier: 1245, mod: 420, index: 80, dur: 0.06, type: 'sine', gain: 0.34, pan: 0.02 } },
            ]),
            levelUp: () => this._seq(t, [
                // “升级” = 上行三连 + 最后落一个小和弦（更史诗但很短）
                { dt: 0.0, whoosh: { dur: 0.16, fromF: 420, toF: 3600, gain: 0.18, pan: 0.00 } },
                { dt: 0.00, tone: { freq: 880, dur: 0.07, type: 'sine', gain: 0.54, pan: -0.07 } },
                { dt: 0.07, tone: { freq: 1109, dur: 0.07, type: 'sine', gain: 0.58, pan: 0.00 } },
                { dt: 0.07, tone: { freq: 1320, dur: 0.09, type: 'triangle', gain: 0.62, pan: 0.07, glideTo: 1760 } },
                // 小和弦（同时）
                { dt: 0.00, tone: { freq: 1046, dur: 0.12, type: 'sine', gain: 0.30, pan: -0.03 } },
                { dt: 0.00, tone: { freq: 1319, dur: 0.12, type: 'sine', gain: 0.28, pan: 0.03 } },
            ]),
            loot: () => this._seq(t, [
                // “宝物闪光” = sparkle（高频噪声闪） + 双叮 + 一点点 FM 亮片
                { dt: 0.0, noise: { dur: 0.020, gain: 0.18, pan: 0.02, filter: { type: 'highpass', f: 5200, Q: 0.7 } } },
                { dt: 0.0, tone: { freq: 1175, dur: 0.055, type: 'triangle', gain: 0.58, pan: -0.06, q: { type: 'bandpass', f: 2200, Q: 7 } } },
                { dt: 0.07, tone: { freq: 1760, dur: 0.075, type: 'triangle', gain: 0.66, pan: 0.06, q: { type: 'bandpass', f: 2800, Q: 7 } } },
                { dt: 0.03, fm:   { carrier: 2093, mod: 740, index: 120, dur: 0.05, type: 'sine', gain: 0.22, pan: 0.01 } },
            ]),
            bossSpawn: () => this._seq(t, [
                // “Boss登场” = 低频 rumble + 反向 whoosh + 金属警报（FM）
                { dt: 0.0, tone: { freq: 90, dur: 0.18, type: 'sine', gain: 0.40, pan: -0.02, glideTo: 130 } },
                { dt: 0.0, whoosh: { dur: 0.20, fromF: 3200, toF: 420, gain: 0.22, pan: 0.00 } },
                { dt: 0.06, fm:   { carrier: 220, mod: 55, index: 140, dur: 0.18, type: 'sine', gain: 0.34, pan: 0.02, glideTo: 330 } },
            ]),
            bossClear: () => this._seq(t, [
                // “胜利” = fanfare（1-3-5）+ 亮尾音（FM上滑）
                { dt: 0.0, whoosh: { dur: 0.16, fromF: 360, toF: 3200, gain: 0.18, pan: 0.00 } },
                { dt: 0.00, tone: { freq: 523, dur: 0.07, type: 'sine', gain: 0.54, pan: -0.06 } },
                { dt: 0.07, tone: { freq: 659, dur: 0.07, type: 'sine', gain: 0.58, pan: 0.00 } },
                { dt: 0.07, tone: { freq: 784, dur: 0.09, type: 'triangle', gain: 0.62, pan: 0.06, glideTo: 1046 } },
                { dt: 0.04, fm:   { carrier: 1046, mod: 310, index: 120, dur: 0.11, type: 'sine', gain: 0.26, pan: 0.02, glideTo: 1760 } },
            ]),
            stageClear: () => this._seq(t, [
                // “过关” = 更长一点的 fanfare + whoosh（与升级区分：节奏更开阔）
                { dt: 0.0, whoosh: { dur: 0.22, fromF: 300, toF: 2800, gain: 0.20, pan: 0.00 } },
                { dt: 0.02, tone: { freq: 659, dur: 0.08, type: 'sine', gain: 0.52, pan: -0.06 } },
                { dt: 0.10, tone: { freq: 988, dur: 0.08, type: 'sine', gain: 0.56, pan: 0.00 } },
                { dt: 0.10, tone: { freq: 1319, dur: 0.12, type: 'triangle', gain: 0.60, pan: 0.06, glideTo: 1760 } },
                { dt: 0.00, tone: { freq: 784, dur: 0.14, type: 'sine', gain: 0.24, pan: -0.03 } },
                { dt: 0.00, tone: { freq: 988, dur: 0.14, type: 'sine', gain: 0.22, pan: 0.03 } },
            ]),
            pause: () => this._seq(t, [
                // “暂停” = tape-stop 风：下滑 FM + 轻 whoosh 下扫
                { dt: 0.0, whoosh: { dur: 0.12, fromF: 1800, toF: 260, gain: 0.16, pan: -0.03 } },
                { dt: 0.00, fm: { carrier: 360, mod: 90, index: 120, dur: 0.12, type: 'sine', gain: 0.30, pan: -0.02, glideTo: 220 } },
                { dt: 0.05, tone: { freq: 240, dur: 0.08, type: 'square', gain: 0.28, pan: 0.03 } },
            ]),
            resume: () => this._seq(t, [
                // “继续” = 上扫 whoosh + 上滑 FM（像“启动”）
                { dt: 0.0, whoosh: { dur: 0.12, fromF: 260, toF: 2200, gain: 0.16, pan: 0.03 } },
                { dt: 0.00, fm: { carrier: 240, mod: 70, index: 110, dur: 0.12, type: 'sine', gain: 0.30, pan: 0.02, glideTo: 420 } },
                { dt: 0.06, tone: { freq: 360, dur: 0.07, type: 'square', gain: 0.26, pan: -0.02 } },
            ]),
            toggleOn: () => this._seq(t, [
                // “开音效” = 小 sparkle + 上行双音
                { dt: 0.0, noise: { dur: 0.014, gain: 0.14, pan: 0.02, filter: { type: 'highpass', f: 5200, Q: 0.7 } } },
                { dt: 0.0, tone: { freq: 600, dur: 0.05, type: 'triangle', gain: 0.50, pan: -0.05 } },
                { dt: 0.05, tone: { freq: 820, dur: 0.07, type: 'triangle', gain: 0.56, pan: 0.05 } },
            ]),
            toggleOff: () => this._seq(t, [
                // “关音效” = 下降双音 + 轻 whoosh 下扫
                { dt: 0.0, whoosh: { dur: 0.10, fromF: 1600, toF: 300, gain: 0.14, pan: -0.02 } },
                { dt: 0.0, tone: { freq: 520, dur: 0.05, type: 'triangle', gain: 0.48, pan: 0.04 } },
                { dt: 0.05, tone: { freq: 360, dur: 0.07, type: 'triangle', gain: 0.54, pan: -0.04 } },
            ]),
            shot: () => this._seq(t, [
                // “发射” = 很轻的噗嗒（短噪声+低频点击）
                { dt: 0.0, noise: { dur: 0.012, gain: 0.10, pan: panTiny, filter: { type: 'bandpass', f: 1100, Q: 0.9 } } },
                { dt: 0.0, fm: { carrier: 420, mod: 90, index: 55, dur: 0.035, type: 'sine', gain: 0.16, pan: panTiny } },
                { dt: 0.03, tone: { freq: 520, dur: 0.030, type: 'triangle', gain: 0.18, pan: panTiny } },
            ]),
            hit: () => this._seq(t, [
                // “命中敌人” = 细碎的 tick（更轻、更短）
                { dt: 0.0, noise: { dur: 0.010, gain: 0.08, pan: panTiny, filter: { type: 'highpass', f: 2600, Q: 0.7 } } },
                { dt: 0.0, tone: { freq: 1480, dur: 0.030, type: 'triangle', gain: 0.16, pan: panTiny, q: { type: 'bandpass', f: 2200, Q: 8 } } },
            ]),
            skill: () => this._seq(t, [
                // “技能释放” = 极短 whoosh + 亮片 FM（辨识但不吵）
                { dt: 0.0, whoosh: { dur: 0.10, fromF: 700, toF: 3200, gain: 0.10, pan: 0.00 } },
                { dt: 0.02, fm: { carrier: 880, mod: 220, index: 120, dur: 0.075, type: 'sine', gain: 0.16, pan: panTiny, glideTo: 1320 } },
            ]),
        };

        const fn = seqs[name] || seqs.click;
        fn();
    }
}

const TALENTS = {
    'health_boost': { id: 'health_boost', name: '体魄', desc: '最大生命 +30', cost: 100, maxLevel: 5, category: 'strength', apply: (p) => p.baseMaxHp += 30 },
    'regen': { id: 'regen', name: '再生', desc: '每秒回血 +1.5', cost: 200, maxLevel: 3, category: 'strength', apply: (p) => p.regen += 1.5 },
    'iron_skin': { id: 'iron_skin', name: '铁皮', desc: '伤害减免 +3', cost: 300, maxLevel: 3, category: 'strength', apply: (p) => p.baseDamageReduction += 3 },

    'swiftness': { id: 'swiftness', name: '迅捷', desc: '移速 +15', cost: 100, maxLevel: 5, category: 'agility', apply: (p) => p.baseSpeed += 15 },
    'haste': { id: 'haste', name: '急速', desc: '攻速 +5%', cost: 200, maxLevel: 5, category: 'agility', apply: (p) => p.baseAttackCooldownMul *= 0.95 },
    'multishot': { id: 'multishot', name: '多重射击', desc: '分裂箭几率 +10%', cost: 500, maxLevel: 1, category: 'agility', apply: (p) => p.splitShotChance = 0.1 },

    'wisdom': { id: 'wisdom', name: '智慧', desc: '经验获取 +10%', cost: 150, maxLevel: 5, category: 'magic', apply: (p) => p.expMultiplier += 0.1 },
    'meditation': { id: 'meditation', name: '冥想', desc: '技能冷却 -10%', cost: 250, maxLevel: 3, category: 'magic', apply: (p) => p.baseCdr += 0.1 },
    'reach': { id: 'reach', name: '掌控', desc: '拾取范围 +20%', cost: 100, maxLevel: 3, category: 'magic', apply: (p) => p.magnetMultiplier += 0.2 }
};

const SKILLS = {
    'sharpness': { id: 'sharpness', name: '锋利', type: 'passive', maxLevel: 10, desc: (lvl) => `攻击力 +${12}`, apply: (p, lvl) => p.damage += 12 * lvl },
    'quick_draw': { id: 'quick_draw', name: '快速拔枪', type: 'passive', maxLevel: 10, desc: (lvl) => `攻速 +10%`, apply: (p, lvl) => p.attackCooldown *= Math.pow(0.96, lvl) },
    'vitality': { id: 'vitality', name: '强壮', type: 'passive', maxLevel: 10, desc: (lvl) => `最大生命 +30`, apply: (p, lvl) => { p.maxHp += 30 * lvl; } },
    'split_shot': { id: 'split_shot', name: '分裂箭', type: 'passive', maxLevel: 5, desc: (lvl) => `普攻额外发射 ${lvl} 支箭矢 (50%伤害)`, apply: (p, lvl) => p.splitShotCount = lvl },
    'poison_nova': {
        id: 'poison_nova',
        name: '剧毒新星',
        type: 'active',
        maxLevel: 5,
        cooldown: 5,
        getParams: (game, lvl, caster) => {
            // 主动技能CD：避免被减到“几乎为0”。对技能冷却减免做上限，并设置最低CD。
            const cdr = Math.max(0, Math.min(0.6, (caster && caster.cdr) || 0)); // 技能CD减免上限 60%
            const rawCd = Math.max(2.3, 5.4 - 0.52 * lvl); // 满级仍保留一点间隔
            const cooldown = Math.max(1.15, rawCd * (1 - cdr));
            const radius = 140 + lvl * 22;
            // 避免满级近似常驻：持续时间提升，但不追求完全覆盖
            const duration = 2.2 + (lvl >= 3 ? 0.9 : 0);
            const dmgPerTick = 8 + lvl * 6;
            const tickInterval = (lvl >= 4 ? 0.4 : 0.5);
            const followPlayer = (lvl >= 5);
            return { cooldown, radius, duration, dmgPerTick, tickInterval, followPlayer };
        },
        desc: (lvl) => {
            const cd = Math.max(2.3, 5.4 - 0.52 * lvl);
            const r = 140 + lvl * 22;
            const dur = 2.2 + (lvl >= 3 ? 0.9 : 0);
            const dmg = 8 + lvl * 6;
            const tick = (lvl >= 4 ? 0.4 : 0.5);
            const mech = [
                (lvl >= 3 ? 'Lv.3+: 持续时间提升' : ''),
                (lvl >= 4 ? 'Lv.4+: 毒伤跳数更快' : ''),
                (lvl >= 5 ? 'Lv.5: 毒圈跟随自身移动' : ''),
            ].filter(Boolean).join('；');
            return `释放毒圈：半径 ${r}，持续 ${dur.toFixed(1)}s，每 ${tick}s 造成 ${dmg} 伤害。CD≈${cd.toFixed(1)}s` + (mech ? `\n${mech}` : '');
        },
        onActivate: (game, lvl, params) => {
            // 技能音效：释放（不做受伤/被攻击音效）
            if (game && game.sfx) game.sfx.play('skill');
            const p = params || (SKILLS['poison_nova'].getParams ? SKILLS['poison_nova'].getParams(game, lvl, game.player) : null);
            const x = game.player.x, y = game.player.y;
            game.createAoE(x, y, p.radius, p.duration, p.dmgPerTick, 'rgba(156, 39, 176, 0.35)', 'enemies', {
                tickInterval: p.tickInterval,
                follow: p.followPlayer ? 'player' : null
            });
        }
    },
    'blinding_dart': {
        id: 'blinding_dart',
        name: '致盲吹箭',
        type: 'active',
        maxLevel: 5,
        cooldown: 3,
        getParams: (game, lvl, caster) => {
            const cdr = Math.max(0, Math.min(0.6, (caster && caster.cdr) || 0));
            const rawCd = Math.max(1.7, 3.4 - 0.32 * lvl);
            const cooldown = Math.max(0.95, rawCd * (1 - cdr));
            const range = 360 + lvl * 80;
            const damage = 22 + lvl * 12;
            const stunDuration = Math.min(2.2, 0.7 + lvl * 0.22);
            const shots = (lvl >= 5 ? 2 : 1);
            return { cooldown, range, damage, stunDuration, shots };
        },
        desc: (lvl) => {
            const cd = Math.max(1.7, 3.4 - 0.32 * lvl);
            const range = 360 + lvl * 80;
            const dmg = 22 + lvl * 12;
            const stun = Math.min(2.2, 0.7 + lvl * 0.22);
            const mech = [
                `射程 ${range}`,
                (lvl >= 5 ? 'Lv.5: 同时攻击 2 个目标' : ''),
                (lvl >= 3 ? `眩晕≈${stun.toFixed(1)}s` : ''),
            ].filter(Boolean).join('；');
            return `向最近敌人发射吹箭，造成 ${dmg} 伤害。CD≈${cd.toFixed(1)}s\n${mech}`;
        },
        onActivate: (game, lvl, params) => {
            // 技能音效：释放（不做受伤/被攻击音效）
            if (game && game.sfx) game.sfx.play('skill');
            const p = params || (SKILLS['blinding_dart'].getParams ? SKILLS['blinding_dart'].getParams(game, lvl, game.player) : null);
            const targets = game.findNearestEnemies(game.player.x, game.player.y, p.range, p.shots);
            targets.forEach(t => {
                game.projectiles.push(new Projectile(game, game.player.x, game.player.y, t, {
                    damage: p.damage,
                    color: '#00FF00',
                    speed: 650,
                    type: 'dart',
                    radius: 4,
                    stunDuration: p.stunDuration
                }));
            });
        }
    },
    'mushroom_trap': {
        id: 'mushroom_trap',
        name: '种蘑菇',
        type: 'active',
        maxLevel: 5,
        cooldown: 4,
        getParams: (game, lvl, caster) => {
            const cdr = Math.max(0, Math.min(0.6, (caster && caster.cdr) || 0));
            const rawCd = Math.max(1.9, 4.3 - 0.40 * lvl);
            const cooldown = Math.max(1.05, rawCd * (1 - cdr));
            const damage = 40 + lvl * 22;
            const count = (lvl >= 3 ? 2 : 1);
            const triggerRadius = 26 + lvl * 5;
            const aoeRadius = 100 + lvl * 10;
            const armTime = (lvl >= 5 ? 0.35 : 1.0);
            const stunDuration = (lvl >= 4 ? 2.2 : 1.5);
            return { cooldown, damage, count, triggerRadius, aoeRadius, armTime, stunDuration };
        },
        desc: (lvl) => {
            const cd = Math.max(1.9, 4.3 - 0.40 * lvl);
            const dmg = 40 + lvl * 22;
            const aoe = 100 + lvl * 10;
            const count = (lvl >= 3 ? 2 : 1);
            const mech = [
                `爆炸半径 ${aoe}`,
                (lvl >= 3 ? `Lv.3+: 一次种 ${count} 个` : ''),
                (lvl >= 4 ? 'Lv.4+: 控制更强' : ''),
                (lvl >= 5 ? 'Lv.5: 几乎瞬间武装' : ''),
            ].filter(Boolean).join('；');
            return `原地种植蘑菇，触发后爆炸造成 ${dmg} 伤害。CD≈${cd.toFixed(1)}s\n${mech}`;
        },
        onActivate: (game, lvl, params) => {
            // 技能音效：释放（不做受伤/被攻击音效）
            if (game && game.sfx) game.sfx.play('skill');
            const p = params || (SKILLS['mushroom_trap'].getParams ? SKILLS['mushroom_trap'].getParams(game, lvl, game.player) : null);
            for (let i = 0; i < p.count; i++) {
                const ox = (Math.random() - 0.5) * 40;
                const oy = (Math.random() - 0.5) * 40;
                game.createMushroom(game.player.x + ox, game.player.y + oy, p.damage, {
                    triggerRadius: p.triggerRadius,
                    aoeRadius: p.aoeRadius,
                    armTime: p.armTime,
                    stunDuration: p.stunDuration
                });
            }
        }
    }
};

const ITEMS = [
    { id: 'iron_sword', name: '斩铁剑', desc: '攻击力 +20, 攻速 +5%', isHeirloom: false, stats: { damage: 20, cdr: 0.05 } },
    { id: 'dragon_scale', name: '龙鳞甲', desc: '最大生命 +100, 减伤 +5 (传承)', isHeirloom: true, stats: { maxHp: 100, damageReduction: 5 } },
    { id: 'wind_boots', name: '风行者之靴', desc: '移速 +40, 闪避 +5% (传承)', isHeirloom: true, stats: { speed: 40, dodge: 0.05 } },
    { id: 'demon_orb', name: '恶魔宝珠', desc: '技能伤害 +30%, 击杀回血 +2', isHeirloom: false, stats: { skillDmg: 0.3, killHeal: 2 } },
    { id: 'titan_ring', name: '泰坦指环', desc: '最大生命 +50, 攻击力 +10', isHeirloom: false, stats: { maxHp: 50, damage: 10 } },
    { id: 'void_blade', name: '虚空之刃', desc: '攻击力 +40, 攻速 +10% (传承)', isHeirloom: true, stats: { damage: 40, cdr: 0.1 } },
    { id: 'berserk_axe', name: '狂战斧', desc: '攻击力 +30, 但受到伤害 +10%', isHeirloom: false, stats: { damage: 30, incomingDmgMul: 0.1 } }, 
];

// --- Save System ---

class SaveManager {
    constructor() {
        this.data = { points: 0, talents: {}, heirlooms: [] };
        // 可由 Game 注入：用于购买成功/失败提示音等（避免在这里硬依赖 Game）
        this.onPurchaseTalent = null; // (ok:boolean)=>void
        this.onAddHeirloom = null; // ()=>void
        this.load();
    }
    load() {
        const s = localStorage.getItem('teemo_survivor_v3');
        if (s) { try { this.data = { ...this.data, ...JSON.parse(s) }; } catch (e) { } }
    }
    save() { localStorage.setItem('teemo_survivor_v3', JSON.stringify(this.data)); }
    addPoints(a) { this.data.points += a; this.save(); this.updateUI(); }

    purchaseTalent(id) {
        const t = TALENTS[id];
        const lvl = this.data.talents[id] || 0;
        if (lvl < t.maxLevel && this.data.points >= t.cost) {
            this.data.points -= t.cost;
            this.data.talents[id] = lvl + 1;
            this.save();
            this.updateUI();
            if (this.onPurchaseTalent) this.onPurchaseTalent(true);
        } else {
            if (this.onPurchaseTalent) this.onPurchaseTalent(false);
        }
    }

    addHeirloom(itemId) {
        if (!this.data.heirlooms.includes(itemId)) {
            this.data.heirlooms.push(itemId);
            this.save();
            this.updateUI();
            if (this.onAddHeirloom) this.onAddHeirloom();
        }
    }

    updateUI() {
        const pointsEl = document.getElementById('meta-points');
        if (pointsEl) pointsEl.innerText = this.data.points;
        const shopPointsEl = document.getElementById('shop-points');
        if (shopPointsEl) shopPointsEl.innerText = this.data.points;
        
        ['strength', 'agility', 'magic'].forEach(cat => {
            const container = document.querySelector(`#tree-${cat} .talent-list`);
            if(!container) return;
            container.innerHTML = '';
            Object.values(TALENTS).filter(t => t.category === cat).forEach(t => {
                const lvl = this.data.talents[t.id] || 0;
                const div = document.createElement('div');
                div.className = `talent-node ${lvl > 0 ? 'purchased' : ''} ${lvl >= t.maxLevel ? 'maxed' : ''}`;
                div.innerHTML = `<div>${t.name} (${lvl}/${t.maxLevel})</div><div style="font-size:10px">${t.desc}</div><div style="font-size:10px;color:#ffd700">${lvl>=t.maxLevel?'MAX':t.cost}</div>`;
                div.onclick = () => this.purchaseTalent(t.id);
                container.appendChild(div);
            });
        });

        const hList = document.getElementById('heirloom-list');
        const hContainer = document.getElementById('heirloom-display');
        if (this.data.heirlooms.length > 0) {
            hContainer.classList.remove('hidden');
            hList.innerHTML = '';
            this.data.heirlooms.forEach(hid => {
                const item = ITEMS.find(i => i.id === hid);
                const d = document.createElement('div');
                d.className = 'equip-slot heirloom';
                d.title = item.name + "\n" + item.desc;
                d.innerText = item.name[0];
                hList.appendChild(d);
            });
        } else {
            hContainer.classList.add('hidden');
        }
    }
}

// --- Logic ---

function checkCollision(c1, c2) {
    return Math.sqrt((c1.x - c2.x) ** 2 + (c1.y - c2.y) ** 2) < c1.radius + c2.radius;
}

class Projectile {
    constructor(game, x, y, target, options = {}) {
        this.game = game;
        this.x = x; this.y = y;
        this.radius = options.radius || 5;
        this.color = options.color || '#FFFF00';
        this.speed = options.speed || 400;
        this.damage = options.damage || 10;
        this.type = options.type || 'normal';
        this.isEnemy = options.isEnemy || false;
        this.onHitPlayer = options.onHitPlayer;
        this.stunDuration = options.stunDuration;
        this.markedForDeletion = false;

        let angle = options.angle;
        if (angle === undefined && target) angle = Math.atan2(target.y - y, target.x - x);
        this.vx = Math.cos(angle) * this.speed;
        this.vy = Math.sin(angle) * this.speed;
    }
    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        if (this.isEnemy) {
            if (checkCollision(this, this.game.player)) {
                this.game.player.takeDamage(this.damage);
                if (this.onHitPlayer) this.onHitPlayer(this.game, this);
                this.markedForDeletion = true;
            }
        } else {
            for (const e of this.game.enemies) {
                if (checkCollision(this, e)) {
                    e.takeDamage(this.damage);
                    // 战斗音效：命中敌人（概率触发 + SoundManager 内部强限流，避免嘈杂）
                    if (this.game && this.game.sfx && Math.random() < 0.22) this.game.sfx.play('hit');
                    this.markedForDeletion = true;
                    if (this.type === 'dart') { e.stunned = Math.max(e.stunned || 0, this.stunDuration || 1.0); }
                    break;
                }
            }
        }

        // World bounds (not screen bounds)
        const pad = 250;
        if (
            this.x < -pad || this.x > this.game.worldWidth + pad ||
            this.y < -pad || this.y > this.game.worldHeight + pad
        ) this.markedForDeletion = true;
    }
    draw(ctx) {
        ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color; ctx.fill();
    }
}

class Mushroom {
    constructor(game, x, y, damage, options = {}) {
        this.game = game;
        this.x = x; this.y = y;
        this.damage = damage;
        this.radius = 15;
        this.triggerRadius = options.triggerRadius || 30;
        this.aoeRadius = options.aoeRadius || 120;
        this.markedForDeletion = false;
        this.armTimer = 0;
        this.armed = false;
        this.armTime = (options.armTime !== undefined ? options.armTime : 1.0);
        this.target = options.target || 'enemies'; // 'enemies' | 'player'
        this.slowOnExplode = options.slowOnExplode || null; // { duration, speedMul }
        this.stunDuration = (options.stunDuration !== undefined ? options.stunDuration : 1.5);
    }

    update(dt) {
        if (!this.armed) {
            this.armTimer += dt;
            if (this.armTimer > this.armTime) this.armed = true;
            return;
        }

        if (this.target === 'player') {
            const p = this.game.player;
            const dist = Math.sqrt((p.x - this.x) ** 2 + (p.y - this.y) ** 2);
            if (dist < this.triggerRadius + p.radius) this.explode();
        } else {
            // Check enemy collision
            for (const e of this.game.enemies) {
                const dist = Math.sqrt((e.x - this.x) ** 2 + (e.y - this.y) ** 2);
                if (dist < this.triggerRadius + e.radius) {
                    this.explode();
                    break;
                }
            }
        }
    }

    explode() {
        this.markedForDeletion = true;
        if (this.target === 'player') {
            this.game.createAoE(this.x, this.y, this.aoeRadius, 0.6, this.damage, 'rgba(255, 80, 80, 0.55)', 'player');
            if (this.slowOnExplode) {
                this.game.applyPlayerSlow(this.slowOnExplode.duration, this.slowOnExplode.speedMul);
            }
        } else {
            this.game.createAoE(this.x, this.y, this.aoeRadius, 0.5, this.damage, 'rgba(0, 255, 0, 0.7)', 'enemies');
            // Slow enemies
            this.game.enemies.forEach(e => {
                const dist = Math.sqrt((e.x - this.x) ** 2 + (e.y - this.y) ** 2);
                if (dist < this.aoeRadius) e.stunned = Math.max(e.stunned || 0, this.stunDuration); // Stun/Slow
            });
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.armed ? 1.0 : 0.5;
        ctx.translate(this.x, this.y);
        
        // Cap
        ctx.beginPath();
        ctx.arc(0, -5, 12, 0, Math.PI*2);
        ctx.fillStyle = '#4CAF50'; // Green cap for Teemo
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#2E7D32';
        ctx.stroke();

        // Spots
        ctx.beginPath(); ctx.arc(-5, -8, 3, 0, Math.PI*2); ctx.fillStyle = '#81C784'; ctx.fill();
        ctx.beginPath(); ctx.arc(5, -5, 2, 0, Math.PI*2); ctx.fillStyle = '#81C784'; ctx.fill();

        // Stem
        ctx.beginPath();
        ctx.rect(-4, 0, 8, 10);
        ctx.fillStyle = '#FFF8E1';
        ctx.fill();
        
        ctx.restore();
    }
}

class HealthPotion {
    constructor(game, x, y) {
        this.game = game;
        this.x = x; this.y = y;
        this.radius = 10;
        this.markedForDeletion = false;
        this.healAmount = 50; // Increased heal
    }
    update(dt) {
        if (checkCollision(this, this.game.player)) {
            this.game.player.heal(this.healAmount);
            this.markedForDeletion = true;
        }
    }
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        // Bottle
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(255, 0, 0, 0.6)';
        ctx.fill();
        ctx.strokeStyle = '#FFCDD2';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Cross
        ctx.fillStyle = 'white';
        ctx.fillRect(-2, -5, 4, 10);
        ctx.fillRect(-5, -2, 10, 4);
        ctx.restore();
    }
}

class Enemy {
    constructor(game, config) {
        this.game = game;
        this.type = config.type;
        this.markedForDeletion = false;

        // Special behaviors (optional)
        this.behavior = config.behavior || null; // 'kamikaze' | 'trail_poison' | 'blink' | null
        this.explode = config.explode || null;   // { radius, damage, triggerDist, duration, color, slow?:{duration,speedMul} }
        this.split = config.split || null;       // { count, childConfig }
        this.aura = config.aura || null;         // { radius, heal, interval, color }
        this.trail = config.trail || null;       // { interval, radius, duration, damage, tickInterval, color }
        this.dmgTakenMul = (config.dmgTakenMul !== undefined ? config.dmgTakenMul : 1); // incoming damage multiplier (<1 => tanky)
        this.rangedProfile = config.rangedProfile || null; // { cooldown, projSpeed, color, radius, onHitSlow?, onHitBlind? }
        this.leap = config.leap || null;         // { cooldown, duration, speedMul }
        this.blinkCd = (config.blinkCd !== undefined ? config.blinkCd : (config.blink && config.blink.cooldown ? config.blink.cooldown : null));
        this._specialTimers = { aura: 0, trail: 0, blink: 0, leapCd: 0, leapActive: 0 };
        
        // Spawn logic: spawn outside current viewport around player (world space)
        if (config.spawnAt && typeof config.spawnAt.x === 'number' && typeof config.spawnAt.y === 'number') {
            this.x = config.spawnAt.x;
            this.y = config.spawnAt.y;
        } else {
            const p = 220;
            const viewR = Math.hypot(game.width, game.height) / 2;
            const spawnDist = viewR + p + Math.random() * 220;
            const ang = Math.random() * Math.PI * 2;
            const px = (game.player ? game.player.x : game.worldWidth / 2);
            const py = (game.player ? game.player.y : game.worldHeight / 2);
            let sx = px + Math.cos(ang) * spawnDist;
            let sy = py + Math.sin(ang) * spawnDist;
            // Clamp to world bounds (+padding to avoid spawning "inside" walls)
            sx = Math.max(p, Math.min(game.worldWidth - p, sx));
            sy = Math.max(p, Math.min(game.worldHeight - p, sy));
            this.x = sx; this.y = sy;
        }

        // Base Config
        this.baseHp = config.hp || 20;
        this.speed = config.speed || 100;
        this.damage = config.damage || 10;
        this.exp = config.exp || 10;
        this.color = config.color || 'red';
        this.isRanged = config.isRanged || false;
        this.attackRange = config.attackRange || 0;
        this.skills = config.skills || null; // [{id, lvl}]
        this.mainSkillId = config.mainSkillId || null;
        this.skillTimers = {};
        
        // Scaling
        // Enemy level scales with stage/wave AND player level.
        // stage 1 wave 1 => lvl 1, stage 1 wave N => lvl N, stage 2 wave 1 => lvl N+1 ...
        const wavesTotal = Math.max(1, game.wavesTotal || 10);
        const progressLevel = Math.max(1, (game.stage - 1) * wavesTotal + game.wave);
        const playerLevel = game.player ? game.player.level : 1;
        // If player over-levels early, enemies catch up.
        const playerDrivenLevel = Math.max(1, 1 + Math.floor((playerLevel - 1) * 0.9));
        this.level = Math.max(progressLevel, playerDrivenLevel);
        const baseF = 1 + this.level * 0.06; // stronger ramp than before
        const isBoss = (this.type === 'boss');
        const isElite = (this.type === 'elite');
        // Boss/Elite scaling更温和（避免数值膨胀），但通过“机制”制造压迫感。
        const hpMul = Math.pow(baseF, isBoss ? 1.08 : (isElite ? 1.16 : 1.25));
        const dmgMul = Math.pow(baseF, isBoss ? 1.05 : (isElite ? 1.10 : 1.18));
        const speedMul = Math.pow(baseF, isBoss ? 0.035 : (isElite ? 0.05 : 0.06));
        this.maxHp = this.baseHp * hpMul;
        
        // Frenzy nerfs
        if (game.frenzyActive) {
            this.maxHp *= 0.5; // Half HP during frenzy
        }

        this.hp = this.maxHp;
        this.damage = this.damage * dmgMul;
        this.speed = this.speed * speedMul;
        // EXP scales mainly with enemy level (lv1 normal => 1 EXP), bosses give lots.
        const expBase = (config.exp !== undefined ? config.exp : 1);
        // 经验曲线：让后期经验能跟上玩家的升级需求，同时保持早期不过快。
        // - 随 level 线性增长 + 轻度幂次增长（后期更“跟得上”）
        // - 随 stage 给少量加成（避免越往后越“刮痧升级”）
        const stageBonus = 1 + Math.min(1.2, Math.max(0, (game.stage - 1) * 0.08));
        const lvlLinear = 1 + this.level * 0.55;
        const lvlCurve = 1 + Math.pow(this.level, 1.12) * 0.03;
        const expMul = stageBonus * lvlLinear * lvlCurve;

        if (this.type === 'boss') {
            this.exp = Math.max(10, Math.floor(expBase * expMul * 3.2));
        } else if (this.type === 'elite') {
            this.exp = Math.max(4, Math.floor(expBase * expMul * 1.15));
        } else {
            this.exp = Math.max(1, Math.floor(expBase * expMul * 0.55));
        }
        
        // Size scales with HP (visual + hit)
        const sizeFactor = Math.min(2.0, Math.max(0.8, (this.maxHp / 100))); 
        this.radius = (config.radius || 15) * Math.pow(sizeFactor, 0.4); 

        this.attackTimer = 0;
        this.stunned = 0;
    }

    update(dt) {
        if (this.stunned > 0) {
            this.stunned -= dt;
            return;
        }

        const dx = this.game.player.x - this.x;
        const dy = this.game.player.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Boss uses dedicated behavior tree; elites use normal AI + special behaviors.
        if (this.type === 'boss') {
            this.updateBossBehavior(dt, dist, dx, dy);
            return;
        }

        // Special: blink/teleport around player (keeps pressure without speed spam)
        if (this.behavior === 'blink') {
            const cd = (this.blinkCd || 3.2);
            this._specialTimers.blink += dt;
            if (this._specialTimers.blink >= cd) {
                this._specialTimers.blink = 0;
                const p = this.game.player;
                const ang = Math.random() * Math.PI * 2;
                const r = 220 + Math.random() * 160;
                const pad = 220;
                this.x = Math.max(pad, Math.min(this.game.worldWidth - pad, p.x + Math.cos(ang) * r));
                this.y = Math.max(pad, Math.min(this.game.worldHeight - pad, p.y + Math.sin(ang) * r));
            }
            // still chase after blink to keep it readable
        }

        // Special: kamikaze (suicide bomber)
        if (this.behavior === 'kamikaze' && this.explode) {
            if (dist > 0.0001) {
                this.x += (dx / dist) * this.speed * dt;
                this.y += (dy / dist) * this.speed * dt;
            }
            const trigger = Math.max(this.radius + this.game.player.radius + 4, this.explode.triggerDist || 0);
            if (dist <= trigger || checkCollision(this, this.game.player)) {
                this.markedForDeletion = true;
                const baseDmg = (this.explode.damage !== undefined ? this.explode.damage : (this.damage * 2));
                const scaledDmg = baseDmg * (1 + this.level * 0.04);
                this.game.createAoE(this.x, this.y, this.explode.radius || 110, this.explode.duration || 0.25, scaledDmg, this.explode.color || 'rgba(255, 82, 82, 0.45)', 'player');
                if (this.explode.slow) this.game.applyPlayerSlow(this.explode.slow.duration || 0.9, this.explode.slow.speedMul || 0.7);
            }
            return;
        }

        // Special: poison trail
        if (this.behavior === 'trail_poison' && this.trail) {
            this._specialTimers.trail += dt;
            if (this._specialTimers.trail >= (this.trail.interval || 0.9)) {
                this._specialTimers.trail = 0;
                const baseDmg = (this.trail.damage !== undefined ? this.trail.damage : 4);
                const scaledDmg = baseDmg * (1 + this.level * 0.03);
                this.game.createAoE(this.x, this.y, this.trail.radius || 90, this.trail.duration || 2.2, scaledDmg, this.trail.color || 'rgba(156, 204, 101, 0.26)', 'player', {
                    tickInterval: (this.trail.tickInterval || 0.45),
                });
            }
        }

        // Special: healer aura (heal nearby enemies periodically)
        if (this.aura) {
            this._specialTimers.aura += dt;
            if (this._specialTimers.aura >= (this.aura.interval || 0.8)) {
                this._specialTimers.aura = 0;
                const r = this.aura.radius || 180;
                const healBase = (this.aura.heal !== undefined ? this.aura.heal : 8);
                const heal = healBase * (1 + this.level * 0.02);
                for (const e of this.game.enemies) {
                    if (e === this || e.markedForDeletion) continue;
                    if (e.type === 'boss') continue;
                    const dd = Math.hypot(e.x - this.x, e.y - this.y);
                    if (dd <= r) e.hp = Math.min(e.maxHp, e.hp + heal);
                }
            }
        }

        // Special: leap burst (short dash windows)
        let speedMulNow = 1;
        if (this.leap) {
            this._specialTimers.leapCd += dt;
            if (this._specialTimers.leapActive > 0) {
                this._specialTimers.leapActive -= dt;
                speedMulNow = this.leap.speedMul || 2.2;
            } else if (this._specialTimers.leapCd >= (this.leap.cooldown || 3.5)) {
                this._specialTimers.leapCd = 0;
                this._specialTimers.leapActive = (this.leap.duration || 0.65);
                speedMulNow = this.leap.speedMul || 2.2;
            }
        }

        if (this.isRanged) {
            if (dist > this.attackRange * 0.8) {
                this.x += (dx / dist) * this.speed * speedMulNow * dt;
                this.y += (dy / dist) * this.speed * speedMulNow * dt;
            } else if (dist < this.attackRange * 0.5) {
                // Back away
                this.x -= (dx / dist) * this.speed * 0.5 * speedMulNow * dt;
                this.y -= (dy / dist) * this.speed * 0.5 * speedMulNow * dt;
            }
            
            this.attackTimer += dt;
            const cd = (this.rangedProfile && this.rangedProfile.cooldown) ? this.rangedProfile.cooldown : 2.0;
            if (this.attackTimer > cd && dist < this.attackRange) {
                const projColor = (this.rangedProfile && this.rangedProfile.color) ? this.rangedProfile.color : 'orange';
                const projSpeed = (this.rangedProfile && this.rangedProfile.projSpeed) ? this.rangedProfile.projSpeed : 300;
                const projRadius = (this.rangedProfile && this.rangedProfile.radius) ? this.rangedProfile.radius : 5;
                const onHitSlow = (this.rangedProfile && this.rangedProfile.onHitSlow) ? this.rangedProfile.onHitSlow : null;
                const onHitBlind = (this.rangedProfile && this.rangedProfile.onHitBlind) ? this.rangedProfile.onHitBlind : null;
                this.game.projectiles.push(new Projectile(this.game, this.x, this.y, this.game.player, {
                    isEnemy: true,
                    color: projColor,
                    damage: this.damage,
                    speed: projSpeed,
                    radius: projRadius,
                    onHitPlayer: (g) => {
                        if (onHitSlow) g.applyPlayerSlow(onHitSlow.duration || 1.0, onHitSlow.speedMul || 0.75);
                        if (onHitBlind) g.applyPlayerBlind(onHitBlind.duration || 0.9);
                    }
                }));
                this.attackTimer = 0;
            }
        } else {
            // Melee
            if (dist > 0) {
                this.x += (dx / dist) * this.speed * speedMulNow * dt;
                this.y += (dy / dist) * this.speed * speedMulNow * dt;
            }
            if (checkCollision(this, this.game.player)) {
                this.game.player.takeDamage(this.damage * dt);
            }
        }
    }

    updateBossBehavior(dt, dist, dx, dy) {
        if (dist <= 0.0001) dist = 0.0001;

        // 多原型 Boss（优先）：用机制驱动，给玩家“记忆点”
        const g = this.game;
        const p = g.player;
        const hpPct = this.hp / Math.max(1, this.maxHp);
        const bt = this.bossType || null;
        if (!this.skillTimers) this.skillTimers = {};
        const timers = this.skillTimers;
        const tick = (k) => { if (!timers[k]) timers[k] = 0; timers[k] += dt; return timers[k]; };
        const reset = (k) => { timers[k] = 0; };
        const clampWorld = (x, y) => {
            const pad = 220;
            return {
                x: Math.max(pad, Math.min(g.worldWidth - pad, x)),
                y: Math.max(pad, Math.min(g.worldHeight - pad, y)),
            };
        };

        if (bt === 'queen') {
            // 蜂后：召唤自爆蜂 + 冲锋加速
            this.x += (dx / dist) * this.speed * dt;
            this.y += (dy / dist) * this.speed * dt;
            if (checkCollision(this, p)) p.takeDamage(this.damage * dt);

            if (tick('summon') >= Math.max(2.8, 4.2 - (1 - hpPct) * 1.2)) {
                reset('summon');
                const n = (hpPct > 0.5 ? 3 : 5);
                for (let i = 0; i < n; i++) {
                    const ang = (Math.PI * 2) * (i / n) + Math.random() * 0.35;
                    const r = 140 + Math.random() * 90;
                    const pos = clampWorld(this.x + Math.cos(ang) * r, this.y + Math.sin(ang) * r);
                    g.spawnEnemyFromType('kamikaze', { spawnAt: pos });
                }
            }

            if (!timers.chargeActive) timers.chargeActive = 0;
            if (timers.chargeActive > 0) {
                timers.chargeActive -= dt;
                const mul = 2.3;
                this.x += (dx / dist) * this.speed * (mul - 1) * dt;
                this.y += (dy / dist) * this.speed * (mul - 1) * dt;
            } else if (tick('charge') >= (hpPct > 0.6 ? 6.2 : 4.8)) {
                reset('charge');
                timers.chargeActive = 0.75;
                g.createAoE(this.x, this.y, 140, 0.35, 0, 'rgba(255, 204, 128, 0.18)', 'both');
            }
            return;
        }

        if (bt === 'toad') {
            // 巨蟾：吐毒池（锁定玩家）+ 跃击落毒
            const mul = (hpPct < 0.5 ? 1.08 : 1.0);
            this.x += (dx / dist) * this.speed * mul * dt;
            this.y += (dy / dist) * this.speed * mul * dt;
            if (checkCollision(this, p)) p.takeDamage(this.damage * dt);

            if (tick('spit') >= (hpPct > 0.5 ? 3.3 : 2.6)) {
                reset('spit');
                const base = 6 + this.level * 0.35;
                g.createAoE(p.x, p.y, 180, 2.8, base, 'rgba(124, 179, 66, 0.22)', 'player', { tickInterval: 0.45 });
            }

            if (!timers.leapActive) timers.leapActive = 0;
            if (timers.leapActive > 0) {
                timers.leapActive -= dt;
                const mul2 = 2.6;
                this.x += (dx / dist) * this.speed * (mul2 - 1) * dt;
                this.y += (dy / dist) * this.speed * (mul2 - 1) * dt;
            } else if (tick('leap') >= (hpPct > 0.55 ? 5.8 : 4.5)) {
                reset('leap');
                timers.leapActive = 0.65;
                g.createAoE(p.x, p.y, 150, 1.6, 7 + this.level * 0.25, 'rgba(156, 39, 176, 0.18)', 'player', { tickInterval: 0.5 });
            }
            return;
        }

        if (bt === 'gunslinger') {
            // 枪手：扇形齐射 + 镜像闪现
            const range = this.attackRange || 520;
            if (dist > range * 0.7) {
                this.x += (dx / dist) * this.speed * dt;
                this.y += (dy / dist) * this.speed * dt;
            } else if (dist < range * 0.45) {
                this.x -= (dx / dist) * this.speed * 0.6 * dt;
                this.y -= (dy / dist) * this.speed * 0.6 * dt;
            }
            if (checkCollision(this, p)) p.takeDamage(this.damage * dt);

            if (tick('volley') >= (hpPct > 0.55 ? 2.8 : 2.2)) {
                reset('volley');
                const angle = Math.atan2(dy, dx);
                const shots = (hpPct > 0.5 ? 5 : 7);
                const spread = (hpPct > 0.5 ? 0.16 : 0.22);
                for (let i = 0; i < shots; i++) {
                    const off = (i - (shots - 1) / 2) * spread;
                    g.projectiles.push(new Projectile(g, this.x, this.y, null, {
                        isEnemy: true,
                        angle: angle + off,
                        color: '#26C6DA',
                        damage: this.damage * 0.65,
                        speed: 520,
                        radius: 4,
                        onHitPlayer: (gg) => gg.applyPlayerSlow(0.8, 0.82)
                    }));
                }
            }

            if (tick('blink') >= (hpPct > 0.55 ? 5.2 : 4.0)) {
                reset('blink');
                const ang = Math.random() * Math.PI * 2;
                const r = 260 + Math.random() * 180;
                const pos = clampWorld(p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r);
                this.x = pos.x;
                this.y = pos.y;
            }
            return;
        }

        if (bt === 'priest') {
            // 司祭：护盾相位（减伤）+ 自愈 + 召唤治疗怪
            this.x += (dx / dist) * this.speed * dt;
            this.y += (dy / dist) * this.speed * dt;
            if (checkCollision(this, p)) p.takeDamage(this.damage * dt);

            if (!timers.shieldCd) timers.shieldCd = 0;
            if (!timers.shieldActive) timers.shieldActive = 0;
            if (timers.shieldCd > 0) timers.shieldCd -= dt;
            if (timers.shieldActive > 0) {
                timers.shieldActive -= dt;
                this.dmgTakenMul = 0.55;
            } else {
                this.dmgTakenMul = 1;
                if (hpPct < 0.65 && timers.shieldCd <= 0) {
                    timers.shieldActive = 6.5;
                    timers.shieldCd = 13.0;
                    g.createAoE(this.x, this.y, 220, 0.6, 0, 'rgba(255, 215, 64, 0.18)', 'both');
                }
            }

            if (tick('ritual') >= (hpPct > 0.5 ? 4.6 : 3.6)) {
                reset('ritual');
                this.hp = Math.min(this.maxHp, this.hp + (22 + this.level * 1.6));
                if (Math.random() < 0.55) {
                    const ang = Math.random() * Math.PI * 2;
                    const pos = clampWorld(this.x + Math.cos(ang) * 170, this.y + Math.sin(ang) * 170);
                    g.spawnEnemyFromType('healer', { spawnAt: pos });
                }
            }
            return;
        }

        if (bt === 'reaper') {
            // 收割者：虚空领域（减速）+ 召唤扭曲幽影 + 闪现突进
            this.x += (dx / dist) * this.speed * dt;
            this.y += (dy / dist) * this.speed * dt;
            if (checkCollision(this, p)) p.takeDamage(this.damage * dt);

            if (tick('void') >= (hpPct > 0.55 ? 4.8 : 3.7)) {
                reset('void');
                const dmg = 5 + this.level * 0.35;
                g.createAoE(p.x, p.y, 210, 2.4, dmg, 'rgba(179, 136, 255, 0.16)', 'player', {
                    tickInterval: 0.45,
                    onTickPlayer: (gg) => gg.applyPlayerSlow(0.55, 0.84)
                });
            }

            if (tick('summon') >= (hpPct > 0.5 ? 6.5 : 5.2)) {
                reset('summon');
                const n = (hpPct > 0.5 ? 1 : 2);
                for (let i = 0; i < n; i++) {
                    const ang = Math.random() * Math.PI * 2;
                    const pos = clampWorld(p.x + Math.cos(ang) * 300, p.y + Math.sin(ang) * 300);
                    g.spawnEnemyFromType('warper', { spawnAt: pos });
                }
            }

            if (tick('blink') >= (hpPct > 0.55 ? 5.6 : 4.4)) {
                reset('blink');
                const ang = Math.random() * Math.PI * 2;
                const pos = clampWorld(p.x + Math.cos(ang) * 260, p.y + Math.sin(ang) * 260);
                this.x = pos.x;
                this.y = pos.y;
                timers.dash = 0.55;
            }
            if (timers.dash && timers.dash > 0) {
                timers.dash -= dt;
                const mul = 2.2;
                this.x += (dx / dist) * this.speed * (mul - 1) * dt;
                this.y += (dy / dist) * this.speed * (mul - 1) * dt;
            }
            return;
        }
        // Default chase
        this.x += (dx / dist) * this.speed * dt;
        this.y += (dy / dist) * this.speed * dt;

        if (checkCollision(this, this.game.player)) this.game.player.takeDamage(this.damage * dt);

        // Skill system (up to 3 skills). If none configured, fallback to legacy behavior.
        if (!this.skills || this.skills.length === 0) {
            this.attackTimer += dt;
            if (this.attackTimer > 5.0) {
                if (Math.random() < 0.5) {
                    this.game.createAoE(this.x, this.y, 200, 1.0, this.damage * 2, 'rgba(255, 0, 0, 0.5)', 'player');
                } else {
                    const old = this.speed;
                    this.speed = 400;
                    setTimeout(() => this.speed = old, 1000);
                }
                this.attackTimer = 0;
            }
            return;
        }

        for (const s of this.skills) {
            if (!this.skillTimers[s.id]) this.skillTimers[s.id] = 0;
            this.skillTimers[s.id] += dt;

            if (s.id === 'split_shot') {
                const cd = Math.max(1.2, 3.0 - s.lvl * 0.25);
                if (this.skillTimers[s.id] >= cd) {
                    const angle = Math.atan2(dy, dx);
                    // Main shot
                    this.game.projectiles.push(new Projectile(this.game, this.x, this.y, this.game.player, {
                        isEnemy: true, color: '#FFB300', damage: this.damage, speed: 360
                    }));
                    // Extra shots
                    const spread = 0.22;
                    for (let i = 1; i <= s.lvl; i++) {
                        this.game.projectiles.push(new Projectile(this.game, this.x, this.y, null, {
                            isEnemy: true, angle: angle + spread * i, color: '#FFB300',
                            damage: this.damage * 0.5, speed: 360, radius: 4
                        }));
                        this.game.projectiles.push(new Projectile(this.game, this.x, this.y, null, {
                            isEnemy: true, angle: angle - spread * i, color: '#FFB300',
                            damage: this.damage * 0.5, speed: 360, radius: 4
                        }));
                    }
                    this.skillTimers[s.id] = 0;
                }
            } else if (s.id === 'blinding_dart') {
                const cd = Math.max(1.6, 3.5 - s.lvl * 0.35);
                if (this.skillTimers[s.id] >= cd) {
                    this.game.projectiles.push(new Projectile(this.game, this.x, this.y, this.game.player, {
                        isEnemy: true, color: '#8E24AA', damage: this.damage * (0.6 + 0.2 * s.lvl),
                        speed: 520, type: 'dart',
                        onHitPlayer: (g) => g.applyPlayerBlind(0.8 + 0.25 * s.lvl)
                    }));
                    this.skillTimers[s.id] = 0;
                }
            } else if (s.id === 'mushroom_trap') {
                const cd = Math.max(2.2, 4.2 - s.lvl * 0.35);
                if (this.skillTimers[s.id] >= cd) {
                    // Drop a trap near player to force movement
                    const p = this.game.player;
                    const ox = (Math.random() - 0.5) * 120;
                    const oy = (Math.random() - 0.5) * 120;
                    this.game.createMushroom(p.x + ox, p.y + oy, 20 + s.lvl * 18, { target: 'player', slowOnExplode: { duration: 1.2 + 0.25 * s.lvl, speedMul: 0.6 } });
                    this.skillTimers[s.id] = 0;
                }
            } else if (s.id === 'poison_nova') {
                const cd = Math.max(2.8, 5.5 - s.lvl * 0.45);
                if (this.skillTimers[s.id] >= cd) {
                    this.game.createAoE(this.x, this.y, 150 + s.lvl * 18, 2.2, 6 + s.lvl * 5, 'rgba(156, 39, 176, 0.35)', 'player');
                    this.skillTimers[s.id] = 0;
                }
            }
        }
    }

    draw(ctx) {
        ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color; ctx.fill();
        ctx.strokeStyle = 'black'; ctx.stroke();
        
        if (this.type !== 'boss' && this.hp < this.maxHp) {
            ctx.fillStyle = 'red'; ctx.fillRect(this.x - this.radius, this.y - this.radius - 10, this.radius*2, 5);
            ctx.fillStyle = '#00FF00'; ctx.fillRect(this.x - this.radius, this.y - this.radius - 10, this.radius*2 * (this.hp / this.maxHp), 5);
        }
    }

    takeDamage(amt) {
        const mul = (this.dmgTakenMul !== undefined ? this.dmgTakenMul : 1);
        this.hp -= amt * mul;
        if (this.hp <= 0) {
            // Split-on-death (spawn children at current location)
            if (this.split && this.split.count && this.split.childConfig) {
                const count = Math.max(1, Math.min(6, this.split.count));
                for (let i = 0; i < count; i++) {
                    const ang = Math.random() * Math.PI * 2;
                    const rr = 18 + Math.random() * 18;
                    const cx = this.x + Math.cos(ang) * rr;
                    const cy = this.y + Math.sin(ang) * rr;
                    const childCfg = { ...this.split.childConfig, spawnAt: { x: cx, y: cy } };
                    this.game.enemies.push(new Enemy(this.game, childCfg));
                }
            }
            this.markedForDeletion = true;
            this.game.createExpOrb(this.x, this.y, this.exp);
            this.game.onEnemyKilled(this);
            
            // Chance to drop health potion (12%)
            if (Math.random() < 0.12) {
                this.game.createHealthPotion(this.x, this.y);
            }
            
            if (this.game.player.killHeal) this.game.player.heal(this.game.player.killHeal);
            if (this.type === 'boss') this.game.bossDefeated(this);
        }
    }
}

class Player {
    constructor(game) {
        this.game = game;
        // World center spawn
        this.x = game.worldWidth / 2; this.y = game.worldHeight / 2;
        this.baseRadius = 20;
        this.radius = this.baseRadius;
        this.color = '#8BC34A';
        
        // Base Stats
        this.baseDamage = 35; this.baseSpeed = 220;
        this.baseMaxHp = 200; this.regen = 3; // Buffed base stats
        // Slower early attacks; later you still scale through level/skills/talents/items
        this.baseAttackCooldown = 0.55;
        this.baseAttackCooldownMul = 1;
        this.expMultiplier = 1; this.magnetMultiplier = 1;
        this.baseDamageReduction = 0; this.baseCdr = 0;
        this.damageReduction = 0; this.cdr = 0;
        this.statusSlowTimer = 0;
        this.statusSlowMul = 1;
        this.statusBlindTimer = 0;

        // Talents
        const t = game.saveManager.data.talents;
        Object.keys(t).forEach(tid => {
            const def = TALENTS[tid];
            if (def) for (let i = 0; i < t[tid]; i++) def.apply(this);
        });

        // Current State
        this.maxHp = this.baseMaxHp;
        this.damageReduction = this.baseDamageReduction;
        this.cdr = this.baseCdr;
        this.hp = this.maxHp;
        this.level = 1; this.exp = 0; this.expToNextLevel = 5;
        
        this.skills = {};
        this.inventory = []; 
        this.inventoryLimit = 10;
        
        // Load Heirlooms
        game.saveManager.data.heirlooms.forEach(hid => {
            const item = ITEMS.find(i => i.id === hid);
            if(item) this.inventory.push({ item: item, level: 1 });
        });

        this.attackTimer = 0;
        this.skillTimers = {};
        this.projectileSpeed = 400;
        this.splitShotCount = 0;

        this.recalculateStats();
    }

    recalculateStats() {
        this.damage = this.baseDamage;
        this.speed = this.baseSpeed;
        this.maxHp = this.baseMaxHp;
        this.damageReduction = this.baseDamageReduction;
        this.cdr = this.baseCdr;
        this.attackCooldown = this.baseAttackCooldown * this.baseAttackCooldownMul;
        this.splitShotCount = 0;
        this.killHeal = 0;
        
        // Level-based attack interval (gentler early scaling, diminishing returns)
        // lvl 1 => 1.00, lvl 10 => ~0.93, lvl 25 => ~0.83, lvl 50 => ~0.71 (then cap)
        const lvlMul = Math.max(0.68, 1 / (1 + (this.level - 1) * 0.008));
        this.attackCooldown *= lvlMul;

        Object.keys(this.skills).forEach(id => {
            if (SKILLS[id].type === 'passive') SKILLS[id].apply(this, this.skills[id]);
        });
        
        this.inventory.forEach(slot => {
            const s = slot.item.stats;
            const mul = slot.level; 
            if (s.damage) this.damage += s.damage * mul;
            if (s.speed) this.speed += s.speed * mul;
            if (s.maxHp) this.maxHp += s.maxHp * mul; 
            if (s.damageReduction) this.damageReduction += s.damageReduction * mul;
            if (s.cdr) this.attackCooldown *= (1 - s.cdr * 0.5 * mul);
            if (s.killHeal) this.killHeal = (this.killHeal || 0) + s.killHeal * mul;
        });
        
        this.attackCooldown *= (1 - this.cdr);

        // Player size scales with survivability (uses MaxHP)
        const sizeFactor = Math.min(2.0, Math.max(0.8, (this.maxHp / 200)));
        this.radius = this.baseRadius * Math.pow(sizeFactor, 0.4);

        // Clamp HP if maxHp changed
        this.hp = Math.min(this.maxHp, this.hp);
    }

    update(dt) {
        if (this.regen > 0) this.heal(this.regen * dt);

        // Status timers
        if (this.statusSlowTimer > 0) this.statusSlowTimer -= dt;
        if (this.statusBlindTimer > 0) this.statusBlindTimer -= dt;

        const moveMul = (this.statusSlowTimer > 0 ? this.statusSlowMul : 1) * (this.statusBlindTimer > 0 ? 0.85 : 1);
        const effectiveSpeed = this.speed * moveMul;

        let dx = 0, dy = 0;
        if (this.game.input.isKeyDown('w') || this.game.input.isKeyDown('ArrowUp')) dy -= 1;
        if (this.game.input.isKeyDown('s') || this.game.input.isKeyDown('ArrowDown')) dy += 1;
        if (this.game.input.isKeyDown('a') || this.game.input.isKeyDown('ArrowLeft')) dx -= 1;
        if (this.game.input.isKeyDown('d') || this.game.input.isKeyDown('ArrowRight')) dx += 1;

        // Mobile/Analog move axis (virtual joystick)
        const axis = this.game.input.getMoveAxis ? this.game.input.getMoveAxis() : { x: 0, y: 0 };
        dx += axis.x || 0;
        dy += axis.y || 0;

        if (dx || dy) {
            const l = Math.sqrt(dx * dx + dy * dy) || 1;
            const nx = dx / l;
            const ny = dy / l;
            // Analog support: small tilt => slower movement (keyboard stays full speed)
            const speedMul = Math.min(1, l);
            this.x += nx * effectiveSpeed * speedMul * dt;
            this.y += ny * effectiveSpeed * speedMul * dt;
            // Clamp to world bounds (not screen bounds)
            this.x = Math.max(this.radius, Math.min(this.game.worldWidth - this.radius, this.x));
            this.y = Math.max(this.radius, Math.min(this.game.worldHeight - this.radius, this.y));
        }

        this.attackTimer += dt;
        const blindAtkMul = (this.statusBlindTimer > 0 ? 1.3 : 1);
        if (this.attackTimer >= this.attackCooldown * blindAtkMul) this.autoAttack();

        Object.keys(this.skills).forEach(id => {
            if (SKILLS[id].type === 'active') {
                if (!this.skillTimers[id]) this.skillTimers[id] = 0;
                this.skillTimers[id] += dt;
                const def = SKILLS[id];
                const lvl = this.skills[id];
                const params = def.getParams ? def.getParams(this.game, lvl, this) : { cooldown: def.cooldown };
                const cd = (params && params.cooldown !== undefined) ? params.cooldown : def.cooldown;
                if (this.skillTimers[id] >= cd) {
                    def.onActivate(this.game, lvl, params);
                    this.skillTimers[id] = 0;
                }
            }
        });
    }

    autoAttack() {
        const target = this.game.findNearestEnemy(this.x, this.y, 400);
        if (target) {
            const angle = Math.atan2(target.y - this.y, target.x - this.x);
            this.game.projectiles.push(new Projectile(this.game, this.x, this.y, target, { angle }));
            // 战斗音效：发射（概率触发 + 限流，避免嘈杂）
            if (this.game && this.game.sfx && Math.random() < 0.28) this.game.sfx.play('shot');
            if (this.splitShotCount > 0) {
                const spread = 0.3;
                for (let i = 1; i <= this.splitShotCount; i++) {
                    this.game.projectiles.push(new Projectile(this.game, this.x, this.y, null, { angle: angle + spread * i, damage: this.damage * 0.5, radius: 3 }));
                    this.game.projectiles.push(new Projectile(this.game, this.x, this.y, null, { angle: angle - spread * i, damage: this.damage * 0.5, radius: 3 }));
                }
            }
            this.attackTimer = 0;
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        
        // Body (Teemo coat)
        ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#8D6E63'; // Brownish coat
        ctx.fill();
        ctx.strokeStyle = '#5D4037'; ctx.lineWidth = 2; ctx.stroke();

        // Hat
        ctx.beginPath();
        ctx.arc(0, -5, this.radius * 0.9, 0, Math.PI, true);
        ctx.fillStyle = '#388E3C'; // Green hat
        ctx.fill();
        
        // Goggles
        ctx.beginPath(); ctx.arc(-8, -2, 6, 0, Math.PI*2); ctx.fillStyle = '#42A5F5'; ctx.fill(); ctx.strokeStyle='#fff'; ctx.stroke();
        ctx.beginPath(); ctx.arc(8, -2, 6, 0, Math.PI*2); ctx.fillStyle = '#42A5F5'; ctx.fill(); ctx.strokeStyle='#fff'; ctx.stroke();
        
        // Ears
        ctx.beginPath();
        ctx.moveTo(-15, -10); ctx.lineTo(-20, -25); ctx.lineTo(-5, -15);
        ctx.moveTo(15, -10); ctx.lineTo(20, -25); ctx.lineTo(5, -15);
        ctx.fillStyle = '#F5F5F5'; // White fur
        ctx.fill();
        
        ctx.restore();
    }

    takeDamage(amount) {
        const dmg = Math.max(1, amount - this.damageReduction);
        this.hp -= dmg;
        this.game.triggerDamageEffect();
        if (this.hp <= 0) this.game.gameOver();
    }
    
    heal(amount) {
        this.hp = Math.min(this.maxHp, this.hp + amount);
    }

    gainExp(val) {
        this.exp += val * this.expMultiplier;
        if (this.exp >= this.expToNextLevel) {
            this.level++;
            this.exp -= this.expToNextLevel;
            // 升级需求：改为“温和指数 + 线性项”，避免后期需求爆炸导致经验不匹配。
            // 目标体感：前期升得快；中期开始放缓；后期仍能持续升级但更有压力。
            const lvl = this.level;
            const mult = (lvl <= 6 ? 1.75 : (lvl <= 14 ? 1.55 : (lvl <= 26 ? 1.42 : 1.34)));
            this.expToNextLevel = Math.floor(this.expToNextLevel * mult + 6 + lvl * 2);
            
            // Stats growth on level up
            this.baseMaxHp += 10;
            this.baseDamage += 2;
            this.recalculateStats();

            this.heal(this.maxHp * 0.5); // Heal 50% on level up
            // 里程碑提示音（不含受伤/被攻击音效）
            this.game.sfx?.play('levelUp');
            this.game.showUpgradeModal();
        }
    }

    addItem(item) {
        const existing = this.inventory.find(s => s.item.id === item.id);
        if (existing) {
            existing.level++;
            this.recalculateStats();
            this.game.updateHUDInventory();
            return true;
        }
        if (this.inventory.length < this.inventoryLimit) {
            this.inventory.push({ item: item, level: 1 });
            this.recalculateStats();
            this.game.updateHUDInventory();
            return true;
        }
        return false;
    }
}

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());

        // World (bigger than viewport). Will be initialized on startGame().
        this.worldWidth = Math.max(2400, this.width * 4);
        this.worldHeight = Math.max(2400, this.height * 4);
        // Camera (top-left in world space)
        this.cameraX = 0;
        this.cameraY = 0;
        // Camera tuning: "deadzone" reduces dizziness by keeping camera still until player nears edge.
        // Values are viewport margins (0~0.45). Larger => camera moves less often.
        this.cameraMarginX = 0.28;
        this.cameraMarginY = 0.28;
        // Smooth follow speed (higher => snappier). Only matters when camera needs to move.
        this.cameraSmooth = 14;

        this.input = new InputHandler();
        this.setupMobileControls();
        this.updateMobileControlsVisibility();

        // 音效系统（仅提示音；不含受伤/被攻击音效）
        this.sfx = new SoundManager();
        this.saveManager = new SaveManager();
        // 将购买/传承事件回调连接到音效（避免在 SaveManager 内部耦合 Game）
        this.saveManager.onPurchaseTalent = (ok) => { if (ok) this.sfx.play('purchase'); };
        this.saveManager.onAddHeirloom = () => { this.sfx.play('loot'); };
        this.saveManager.updateUI();

        document.getElementById('start-game-btn').onclick = () => { this.sfx.play('start'); this.startGameSetup(); };
        document.getElementById('shop-btn').onclick = () => { this.sfx.play('open'); this.openShop(); };
        document.getElementById('shop-back-btn').onclick = () => { this.sfx.play('close'); this.closeShop(); };
        document.getElementById('start-bonus-confirm-btn').onclick = () => { this.sfx.play('start'); this.startGame(); };
        
        document.getElementById('return-menu-btn').onclick = () => { this.sfx.play('close'); this.returnToMenu(); };
        document.getElementById('discard-btn').onclick = () => { this.sfx.play('click'); this.discardNewItem(); };
        document.getElementById('loot-confirm-btn').onclick = () => { this.sfx.play('loot'); this.collectLoot(); };
        document.getElementById('next-stage-btn').onclick = () => { this.sfx.play('click'); this.nextStage(); };
        document.getElementById('pause-btn').onclick = () => { this.togglePause(); };
        document.getElementById('resume-btn').onclick = () => { this.togglePause(); };
        document.getElementById('quit-btn').onclick = () => { this.sfx.play('close'); this.returnToMenu(); };
        document.getElementById('stats-btn').onclick = () => { this.togglePause(); };

        // 大厅按钮（关卡间）
        const lobbyNext = document.getElementById('lobby-next-btn');
        if (lobbyNext) lobbyNext.onclick = () => { this.sfx.play('start'); this.startNextStageFromLobby(); };
        const lobbyMenu = document.getElementById('lobby-menu-btn');
        if (lobbyMenu) lobbyMenu.onclick = () => { this.sfx.play('close'); this.returnToMenu(); };

        // 音效开关按钮（HUD 顶栏）
        const soundBtn = document.getElementById('sound-btn');
        if (soundBtn) {
            const syncBtn = () => {
                soundBtn.innerText = this.sfx.enabled ? '🔊' : '🔇';
                soundBtn.title = this.sfx.enabled ? '音效：开' : '音效：关';
            };
            syncBtn();
            soundBtn.onclick = () => {
                // 关的时候也给一个“关闭”提示（先播再关，避免永远听不到）
                if (this.sfx.enabled) {
                    this.sfx.play('toggleOff');
                    this.sfx.setEnabled(false);
                } else {
                    this.sfx.setEnabled(true);
                    this.sfx.play('toggleOn');
                }
                syncBtn();
            };
        }

        this.state = 'MENU';
        // Enemy count tuning (spawn batch size / cap scales with player stats)
        this.enemyCountScale = 1.0;
        // Bosses defeated this run -> elite blueprints that can appear later
        // 精英池跨关卡保留：Boss 击败后会把“弱化版本”加入池子，在后续关卡稀有出现
        this.loop = this.loop.bind(this);
        this.lastTime = performance.now(); // Init lastTime before loop
        requestAnimationFrame(this.loop);
    }

    setupMobileControls() {
        const mobileControls = document.getElementById('mobile-controls');
        const zone = document.getElementById('joystick-zone');
        const joystick = document.getElementById('joystick');
        const knob = document.getElementById('joystick-knob');
        if (!mobileControls || !zone || !joystick || !knob) return;

        const isMobile = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
        if (!isMobile) {
            mobileControls.classList.add('hidden');
            mobileControls.setAttribute('aria-hidden', 'true');
            return;
        }

        // Store refs for later show/hide control.
        this.mobileControls = { mobileControls, zone, joystick, knob, isMobile };
        // Default hidden; we only show when state === 'PLAYING'.
        mobileControls.classList.add('hidden');
        mobileControls.setAttribute('aria-hidden', 'true');

        let active = false;
        let pointerId = null;
        let cx = 0, cy = 0;

        // Joystick response tuning:
        // - Smaller deadzone: start moving earlier
        // - Faster saturation: reach full tilt with less finger travel (lighter / less "laggy")
        // - Response curve: boost small drags
        const deadZone = 0.015;
        const responseExp = 0.45; // smaller => more sensitive for small drags
        const axisSaturate = 0.78; // <1 => full speed with less travel

        const getMaxR = () => {
            const jr = joystick.clientWidth / 2;
            const kr = knob.clientWidth / 2;
            return Math.max(10, jr - kr);
        };

        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

        const syncCenterFromElement = () => {
            const r = joystick.getBoundingClientRect();
            cx = r.left + r.width / 2;
            cy = r.top + r.height / 2;
        };

        const setKnob = (x, y) => {
            knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
        };

        const setAxisFromOffset = (ox, oy) => {
            const maxR = getMaxR();
            const axisR = Math.max(8, maxR * axisSaturate);
            let ax = ox / axisR;
            let ay = oy / axisR;
            let len = Math.sqrt(ax * ax + ay * ay);

            if (len < deadZone) {
                this.input.setMoveAxis(0, 0);
                return;
            }

            // Clamp to 1 (saturate earlier than knob radius)
            if (len > 1) {
                ax /= len;
                ay /= len;
                len = 1;
            }

            // Remap [deadZone..1] -> [0..1] then apply response curve (boost small drags)
            const n = Math.min(1, Math.max(0, (len - deadZone) / (1 - deadZone)));
            const scaled = Math.min(1, Math.pow(n, responseExp) * 1.06);
            const inv = 1 / (Math.sqrt(ax * ax + ay * ay) || 1);
            this.input.setMoveAxis(ax * inv * scaled, ay * inv * scaled);
        };

        const offsetFromPoint = (x, y) => {
            syncCenterFromElement();
            const maxR = getMaxR();
            let ox = x - cx;
            let oy = y - cy;
            const dist = Math.sqrt(ox * ox + oy * oy);
            if (dist > maxR) {
                ox = (ox / dist) * maxR;
                oy = (oy / dist) * maxR;
            }
            return { ox, oy };
        };

        const onDown = (e) => {
            active = true;
            pointerId = e.pointerId;
            try { e.currentTarget.setPointerCapture(pointerId); } catch (_) { }

            joystick.classList.add('active');

            // Fixed joystick (right-bottom). On press, immediately set direction by finger position relative to center.
            const o = offsetFromPoint(e.clientX, e.clientY);
            setKnob(o.ox, o.oy);
            setAxisFromOffset(o.ox, o.oy);
            e.preventDefault();
        };

        const onMove = (e) => {
            if (!active || e.pointerId !== pointerId) return;
            const o = offsetFromPoint(e.clientX, e.clientY);
            setKnob(o.ox, o.oy);
            setAxisFromOffset(o.ox, o.oy);
            e.preventDefault();
        };

        const onUp = (e) => {
            if (e.pointerId !== pointerId) return;
            active = false;
            pointerId = null;
            joystick.classList.remove('active');
            setKnob(0, 0);
            this.input.setMoveAxis(0, 0);
            e.preventDefault();
        };

        // Bind to zone + joystick + knob so pressing directly on the wheel/knob always works.
        // Use window move/up so we don't "lose" the joystick when finger leaves the zone slightly.
        const bindDown = (el) => el.addEventListener('pointerdown', onDown, { passive: false });
        bindDown(zone);
        bindDown(joystick);
        bindDown(knob);

        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', onUp, { passive: false });
        window.addEventListener('pointercancel', onUp, { passive: false });

        // Touch fallback (some WebViews / older iOS Safari are flaky with PointerEvents)
        const touchState = { active: false, id: null };
        const touchToPoint = (t) => ({ x: t.clientX, y: t.clientY });
        const onTouchStart = (ev) => {
            if (!ev.changedTouches || ev.changedTouches.length === 0) return;
            const t = ev.changedTouches[0];
            touchState.active = true;
            touchState.id = t.identifier;
            const p = touchToPoint(t);
            joystick.classList.add('active');

            const o = offsetFromPoint(p.x, p.y);
            setKnob(o.ox, o.oy);
            setAxisFromOffset(o.ox, o.oy);
            ev.preventDefault();
        };
        const onTouchMove = (ev) => {
            if (!touchState.active || !ev.touches) return;
            let t = null;
            for (let i = 0; i < ev.touches.length; i++) {
                if (ev.touches[i].identifier === touchState.id) { t = ev.touches[i]; break; }
            }
            if (!t) return;
            const p = touchToPoint(t);
            const o = offsetFromPoint(p.x, p.y);
            setKnob(o.ox, o.oy);
            setAxisFromOffset(o.ox, o.oy);
            ev.preventDefault();
        };
        const onTouchEnd = (ev) => {
            if (!touchState.active || !ev.changedTouches) return;
            for (let i = 0; i < ev.changedTouches.length; i++) {
                if (ev.changedTouches[i].identifier === touchState.id) {
                    touchState.active = false;
                    touchState.id = null;
                    joystick.classList.remove('active');
                    setKnob(0, 0);
                    this.input.setMoveAxis(0, 0);
                    ev.preventDefault();
                    break;
                }
            }
        };

        zone.addEventListener('touchstart', onTouchStart, { passive: false });
        joystick.addEventListener('touchstart', onTouchStart, { passive: false });
        knob.addEventListener('touchstart', onTouchStart, { passive: false });
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd, { passive: false });
        window.addEventListener('touchcancel', onTouchEnd, { passive: false });

        // Keep center accurate across orientation changes / resizes.
        window.addEventListener('resize', () => syncCenterFromElement(), { passive: true });
    }

    updateMobileControlsVisibility() {
        const mc = this.mobileControls;
        if (!mc || !mc.isMobile) return;

        const shouldShow = (this.state === 'PLAYING');
        if (shouldShow) {
            mc.mobileControls.classList.remove('hidden');
            mc.mobileControls.setAttribute('aria-hidden', 'false');
        } else {
            // Hide + reset any movement.
            mc.mobileControls.classList.add('hidden');
            mc.mobileControls.setAttribute('aria-hidden', 'true');
            mc.joystick.classList.remove('active');
            mc.knob.style.transform = 'translate(-50%, -50%)';
            this.input.setMoveAxis(0, 0);
        }
    }

    resize() {
        this.width = this.canvas.width = window.innerWidth;
        this.height = this.canvas.height = window.innerHeight;
        // Keep world at least 4x viewport so mobile doesn't feel cramped.
        this.worldWidth = Math.max(this.worldWidth || 0, 2400, this.width * 4);
        this.worldHeight = Math.max(this.worldHeight || 0, 2400, this.height * 4);
    }
    
    openShop() {
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('shop-screen').classList.remove('hidden');
    }
    
    closeShop() {
        document.getElementById('shop-screen').classList.add('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
        this.saveManager.updateUI(); // Refresh points display
    }

    startGameSetup() {
        // Step 1: Pick a random bonus skill
        const skillIds = Object.keys(SKILLS);
        const randomId = skillIds[Math.floor(Math.random() * skillIds.length)];
        this.bonusSkillId = randomId;
        
        const skill = SKILLS[randomId];
        document.getElementById('bonus-skill-name').innerText = skill.name;
        document.getElementById('bonus-skill-desc').innerText = skill.desc(1);
        
        // Show Bonus Modal
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('start-bonus-modal').classList.remove('hidden');
    }

    startGame() {
        // 从“轮回馈赠”确认进入第一关
        document.getElementById('start-bonus-modal').classList.add('hidden');
        document.getElementById('game-over-modal').classList.add('hidden');
        const lobby = document.getElementById('lobby-screen');
        if (lobby) lobby.classList.add('hidden');
        document.getElementById('game-container').classList.remove('hidden');

        // 每关波数：提高波次数量，减少“慢热 -> 突刺”的体感
        this.wavesTotal = 15;
        // 单波时长略缩短，让节奏更连贯（总时长≈15*18=270s 再加Boss）
        this.waveDuration = 18;

        // 新轮回开始：清空精英池（精英池只在本次轮回内累计）
        this.eliteBlueprints = [];
        this.startStage(1, { resetPlayer: true, applyBonusSkill: true });
    }

    // 每一关开始时：重置玩家等级/经验/技能/本关装备（保留天赋与传家宝）
    startStage(stageNumber, opts = {}) {
        this.stage = Math.max(1, stageNumber || 1);
        this.wave = 1;
        this.gameTime = 0;
        this.waveTimer = 0;

        this.comboCount = 0;
        this.comboTimer = 0;
        this.frenzyActive = false;
        this.frenzyTimer = 0;

        // (Re)initialize a big world each stage so you can roam on mobile comfortably.
        this.worldWidth = Math.max(2400, this.width * 4);
        this.worldHeight = Math.max(2400, this.height * 4);

        if (opts.resetPlayer) {
            this.player = new Player(this);
            if (opts.applyBonusSkill && this.bonusSkillId) {
                this.player.skills[this.bonusSkillId] = 1;
                this.player.recalculateStats();
            }
        }

        // Reset camera near player so the first frame doesn't "jump".
        const scale = (this.mobileControls && this.mobileControls.isMobile) ? 0.80 : 1.0;
        const viewWorldW = this.width / scale;
        const viewWorldH = this.height / scale;
        this.cameraX = Math.max(0, Math.min(this.worldWidth - viewWorldW, this.player.x - viewWorldW / 2));
        this.cameraY = Math.max(0, Math.min(this.worldHeight - viewWorldH, this.player.y - viewWorldH / 2));

        // Stage objects reset
        this.enemies = []; this.projectiles = []; this.expOrbs = [];
        this.aoeZones = []; this.mushrooms = []; this.potions = [];
        this.spawnTimer = 0;
        this.spawnBudget = 0;
        this.intensitySmooth = 0;
        this.bossActive = false;
        this.bossRef = null;
        this.eliteBlueprints = [];
        document.getElementById('boss-hp-container').classList.add('hidden');

        // UI
        const lobby = document.getElementById('lobby-screen');
        if (lobby) lobby.classList.add('hidden');
        document.getElementById('game-container').classList.remove('hidden');

        this.state = 'PLAYING';
        this.updateMobileControlsVisibility();
        this.lastTime = performance.now();
        this.updateHUDInventory();
        this.updateHUDWave();
        this.updateComboUI();
        this.renderSkillPanel();
    }

    nextStage() {
        // 过关后回大厅，由大厅按钮进入下一关
        this.openLobby();
    }

    startNextStageFromLobby() {
        this.startStage(this.stage + 1, { resetPlayer: true });
    }

    openLobby() {
        this.state = 'LOBBY';
        this.updateMobileControlsVisibility();

        document.getElementById('stage-clear-modal').classList.add('hidden'); // legacy 兼容
        document.getElementById('game-container').classList.add('hidden');
        const lobby = document.getElementById('lobby-screen');
        if (lobby) lobby.classList.remove('hidden');

        const clearedEl = document.getElementById('lobby-cleared-stage');
        if (clearedEl) clearedEl.innerText = this.stage;
        const nextEl = document.getElementById('lobby-next-stage');
        if (nextEl) nextEl.innerText = this.stage + 1;
        this.renderLobbyEnemyList(this.stage + 1);
    }

    getStageEnemyPool(stageNumber) {
        const s = Math.max(1, stageNumber || this.stage || 1);
        // 每关怪物池：主力怪（旧怪）为主，新增机制怪少量点缀（更“省着用”）
        // - allowed: 允许出现的类型
        // - weights: 生成权重（越大越常见）
        // - labels: 大厅展示用（尽量短，突出“本关新增”）
        if (s === 1) {
            return {
                allowed: ['basic'],
                weights: { basic: 18 },
                labels: ['主力：基础怪（红团子）']
            };
        }
        if (s === 2) {
            return {
                allowed: ['basic', 'runner', 'tank', 'splitter'],
                weights: { basic: 14, runner: 5, tank: 3, splitter: 2 },
                labels: ['主力：基础/迅捷/坦克', '新增：分裂怪（少量）']
            };
        }
        if (s === 3) {
            return {
                allowed: ['basic', 'runner', 'tank', 'ranger', 'poisoner'],
                weights: { basic: 10, runner: 5, tank: 4, ranger: 3, poisoner: 2 },
                labels: ['主力：基础/迅捷/坦克/远程', '新增：毒池怪（少量）']
            };
        }
        if (s === 4) {
            return {
                allowed: ['basic', 'runner', 'tank', 'ranger', 'healer'],
                weights: { basic: 9, runner: 4, tank: 5, ranger: 4, healer: 2 },
                labels: ['主力：基础/迅捷/坦克/远程', '新增：治疗祭司（少量）']
            };
        }
        if (s === 5) {
            return {
                allowed: ['basic', 'runner', 'tank', 'ranger', 'kamikaze', 'shielded'],
                weights: { basic: 9, runner: 5, tank: 4, ranger: 4, kamikaze: 2, shielded: 2 },
                labels: ['主力：基础/迅捷/坦克/远程', '新增：自爆蜂/盾卫（少量）']
            };
        }
        if (s === 6) {
            return {
                allowed: ['basic', 'runner', 'tank', 'ranger', 'kamikaze', 'splitter', 'healer', 'poisoner', 'shielded', 'sniper'],
                weights: { basic: 8, runner: 5, tank: 4, ranger: 4, kamikaze: 2, splitter: 2, healer: 2, poisoner: 2, shielded: 2, sniper: 1 },
                labels: ['主力：旧怪混合', '点缀：狙击手（稀有）']
            };
        }
        // 7+：在“旧怪混合”基础上，偶尔刷出 warper（非常稀有）
        return {
            allowed: ['basic', 'runner', 'tank', 'ranger', 'kamikaze', 'splitter', 'healer', 'poisoner', 'shielded', 'sniper', 'warper'],
            weights: { basic: 8, runner: 5, tank: 4, ranger: 4, kamikaze: 2, splitter: 2, healer: 2, poisoner: 2, shielded: 2, sniper: 1, warper: 1 },
            labels: ['主力：旧怪混合', '点缀：狙击手/扭曲幽影（稀有）']
        };
    }

    renderLobbyEnemyList(stageNumber) {
        const listEl = document.getElementById('lobby-enemy-list');
        if (!listEl) return;
        const pool = this.getStageEnemyPool(stageNumber);
        listEl.innerHTML = '';
        (pool.labels || []).forEach(t => {
            const div = document.createElement('div');
            div.className = 'lobby-enemy-chip';
            div.innerText = t;
            listEl.appendChild(div);
        });
        // 精英池提示：Boss 击败后会加入精英池，在后续关卡稀有出现
        if ((this.eliteBlueprints && this.eliteBlueprints.length > 0) && stageNumber >= 4) {
            const div = document.createElement('div');
            div.className = 'lobby-enemy-chip';
            div.innerText = `稀有：精英怪（已解锁 ${this.eliteBlueprints.length} 种）`;
            listEl.appendChild(div);
        }
    }

    // 统一敌人配置入口：普通刷怪/召唤/精英都复用，避免散落在各处
    getStageEnemyConfigs(stageNumber) {
        const s = Math.max(1, stageNumber || this.stage || 1);
        const stageHp = 1 + Math.min(0.35, (s - 1) * 0.06);
        const stageSpd = 1 + Math.min(0.22, (s - 1) * 0.04);

        const configs = {
            // exp is a BASE value. Final exp is computed from enemy.level in Enemy constructor.
            basic: { type: 'basic', hp: 20 * stageHp, speed: 90 * stageSpd, damage: 6, exp: 1, color: (s === 2 ? '#66BB6A' : (s === 1 ? '#FF5252' : '#AB47BC')) },
            tank: { type: 'tank', hp: 80 * stageHp * 1.15, speed: 50 * stageSpd * 0.9, damage: 15, exp: 3, radius: 25, color: (s >= 4 ? '#546E7A' : '#795548') },
            runner: { type: 'runner', hp: 15 * stageHp * 0.9, speed: 180 * stageSpd * 1.05, damage: 6, exp: 1, radius: 12, color: (s === 3 ? '#FF7043' : '#FF9800') },
            ranger: { type: 'ranger', hp: 25 * stageHp, speed: 90 * stageSpd, damage: 8, exp: 2, isRanged: true, attackRange: 300, color: '#00BCD4' },

            // New types
            kamikaze: {
                type: 'kamikaze',
                hp: 18 * stageHp * 0.9,
                speed: 220 * stageSpd * 1.12,
                damage: 0,
                exp: 2,
                radius: 11,
                color: '#F44336',
                behavior: 'kamikaze',
                explode: {
                    radius: 115,
                    damage: 16,
                    duration: 0.22,
                    triggerDist: 0,
                    color: 'rgba(244, 67, 54, 0.40)',
                    slow: { duration: 0.8, speedMul: 0.78 }
                }
            },
            splitter: {
                type: 'splitter',
                hp: 34 * stageHp,
                speed: 105 * stageSpd,
                damage: 7,
                exp: 3,
                radius: 16,
                color: '#8E24AA',
                split: {
                    count: 2,
                    childConfig: { type: 'mini', hp: 14, speed: 155, damage: 5, exp: 1, radius: 10, color: '#BA68C8' }
                }
            },
            mini: { type: 'mini', hp: 14 * stageHp * 0.9, speed: 155 * stageSpd * 1.05, damage: 5, exp: 1, radius: 10, color: '#BA68C8' },
            healer: {
                type: 'healer',
                hp: 46 * stageHp * 1.05,
                speed: 85 * stageSpd,
                damage: 6,
                exp: 4,
                radius: 15,
                color: '#00E676',
                aura: { radius: 185, heal: 10, interval: 0.9, color: 'rgba(0, 230, 118, 0.15)' }
            },
            poisoner: {
                type: 'poisoner',
                hp: 28 * stageHp,
                speed: 105 * stageSpd,
                damage: 6,
                exp: 3,
                radius: 14,
                color: '#7CB342',
                behavior: 'trail_poison',
                trail: { interval: 0.85, radius: 95, duration: 2.4, damage: 4, tickInterval: 0.45, color: 'rgba(124, 179, 66, 0.22)' }
            },
            shielded: {
                type: 'shielded',
                hp: 70 * stageHp * 1.1,
                speed: 72 * stageSpd,
                damage: 12,
                exp: 4,
                radius: 20,
                color: '#90A4AE',
                dmgTakenMul: 0.55
            },
            sniper: {
                type: 'sniper',
                hp: 24 * stageHp,
                speed: 80 * stageSpd,
                damage: 14,
                exp: 4,
                radius: 13,
                color: '#26C6DA',
                isRanged: true,
                attackRange: 560,
                rangedProfile: {
                    cooldown: 2.9,
                    projSpeed: 560,
                    color: '#26C6DA',
                    radius: 4,
                    onHitSlow: { duration: 1.1, speedMul: 0.78 }
                }
            },
            warper: {
                type: 'warper',
                hp: 22 * stageHp * 0.95,
                speed: 120 * stageSpd,
                damage: 7,
                exp: 3,
                radius: 13,
                color: '#B388FF',
                behavior: 'blink',
                blinkCd: 3.1,
                leap: { cooldown: 3.8, duration: 0.55, speedMul: 2.4 }
            },
        };
        return configs;
    }

    spawnEnemyFromType(type, options = {}) {
        const configs = this.getStageEnemyConfigs(this.stage);
        const base = configs[type] || configs.basic;
        const cfg = { ...base, ...options };
        this.enemies.push(new Enemy(this, cfg));
    }

    returnToMenu() {
        this.state = 'MENU';
        this.updateMobileControlsVisibility();
        const lobby = document.getElementById('lobby-screen');
        if (lobby) lobby.classList.add('hidden');
        document.getElementById('game-container').classList.add('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
        document.getElementById('pause-modal').classList.add('hidden');
        this.saveManager.updateUI();
    }

    togglePause() {
        if (this.state === 'PLAYING') {
            this.state = 'PAUSED';
            this.updateMobileControlsVisibility();
            document.getElementById('pause-modal').classList.remove('hidden');
            this.updateStatsPanel();
            this.sfx?.play('pause');
        } else if (this.state === 'PAUSED') {
            this.state = 'PLAYING';
            this.updateMobileControlsVisibility();
            document.getElementById('pause-modal').classList.add('hidden');
            this.lastTime = performance.now();
            this.sfx?.play('resume');
        }
    }

    updateStatsPanel() {
        const p = this.player;
        const panel = document.getElementById('full-stats-panel');
        panel.innerHTML = `
            <div class="stat-row"><span>等级</span><span class="stat-val">${p.level}</span></div>
            <div class="stat-row"><span>攻击力</span><span class="stat-val">${Math.floor(p.damage)}</span></div>
            <div class="stat-row"><span>生命值</span><span class="stat-val">${Math.floor(p.hp)}/${Math.floor(p.maxHp)}</span></div>
            <div class="stat-row"><span>攻速</span><span class="stat-val">${(1/p.attackCooldown).toFixed(2)}/s</span></div>
            <div class="stat-row"><span>移速</span><span class="stat-val">${Math.floor(p.speed)}</span></div>
            <div class="stat-row"><span>减伤</span><span class="stat-val">${Math.floor(p.damageReduction)}</span></div>
            <div class="stat-row"><span>击杀回血</span><span class="stat-val">${p.killHeal||0}</span></div>
        `;
    }

    update(dt) {
        // Expose dt for camera smoothing (used by draw())
        this._dt = dt;
        this.gameTime += dt;
        this.player.update(dt);
        
        // Combo & Frenzy Logic
        if (this.comboCount > 0) {
            this.comboTimer -= dt;
            if (this.comboTimer <= 0) {
                this.comboCount = 0;
                this.updateComboUI();
            }
        }
        
        if (this.frenzyActive) {
            this.frenzyTimer -= dt;
            if (this.frenzyTimer <= 0) {
                this.frenzyActive = false;
                document.getElementById('frenzy-msg').classList.add('hidden');
            }
        }

        if (this.wave < this.wavesTotal) {
            this.waveTimer += dt;
            if (this.waveTimer >= this.waveDuration) {
                this.wave++;
                this.waveTimer = 0;
                this.updateHUDWave();
            }
            
            // Spawn Rate Logic
            const maxEnemies = this.getDynamicMaxEnemies();
            const perSec = this.getDynamicSpawnPerSecond(dt);
            // 按时间累积预算，逐个刷怪，打散“突然一大波”
            if (this.enemies.length < maxEnemies) {
                this.spawnBudget += perSec * dt;
                // 安全上限：避免后台切换导致一次性补刷过多
                this.spawnBudget = Math.min(this.spawnBudget, 18);
                while (this.spawnBudget >= 1 && this.enemies.length < maxEnemies) {
                    this.spawnEnemy();
                    this.spawnBudget -= 1;
                }
            } else {
                // 满怪时也别无限攒预算
                this.spawnBudget = Math.min(this.spawnBudget, 2);
            }
        } else {
            if (!this.bossActive) {
                this.spawnBoss();
                this.bossActive = true;
            }
        }

        this.enemies.forEach(e => e.update(dt));
        this.enemies = this.enemies.filter(e => !e.markedForDeletion);
        this.projectiles.forEach(p => p.update(dt));
        this.projectiles = this.projectiles.filter(p => !p.markedForDeletion);
        this.expOrbs.forEach(e => e.update(dt));
        this.expOrbs = this.expOrbs.filter(e => !e.markedForDeletion);
        this.aoeZones.forEach(z => z.update(dt));
        this.aoeZones = this.aoeZones.filter(z => !z.markedForDeletion);
        this.mushrooms.forEach(m => m.update(dt));
        this.mushrooms = this.mushrooms.filter(m => !m.markedForDeletion);
        this.potions.forEach(p => p.update(dt));
        this.potions = this.potions.filter(p => !p.markedForDeletion);
        
        if (this.bossActive && this.bossRef && !this.bossRef.markedForDeletion) {
             const bar = document.getElementById('boss-hp-bar');
             bar.style.width = (this.bossRef.hp / this.bossRef.maxHp * 100) + '%';
        }

        this.updateUI();
    }
    
    getDynamicSpawnRate() {
        if (this.frenzyActive) return 0.1; // FAST spawn during frenzy
        
        let rate = 1.0;
        // Base rate based on wave
        if (this.wave <= 3) rate = 2.5; // Slower start (was 2)
        else if (this.wave === 4 || this.wave === 7) rate = 1.2; // Reduced pressure waves
        else rate = Math.max(0.6, 2.0 - (this.wave * 0.08)); // Slower ramp up
        
        // Difficulty Modulation
        const difficulty = this.getDifficultyFactor(); // -1 (Easy) to 1 (Hard)
        if (difficulty > 0.5) rate *= 0.95; // Spawn slightly faster if game thinks it should be hard
        
        return rate;
    }

    // 新：用“每秒刷怪数”替代“每隔N秒批量刷怪”，并做平滑强度曲线
    getDynamicSpawnPerSecond(dt) {
        if (this.frenzyActive) return 10; // 爽刷阶段

        const p = this.player;
        const wavesTotal = Math.max(1, this.wavesTotal || 10);

        // 关内进度（0~1）：stage 内随波次推进 + 波内时间推进
        const waveIdx0 = Math.max(0, (this.wave || 1) - 1);
        const waveProgress = (this.waveTimer || 0) / Math.max(0.01, this.waveDuration || 1);
        const runProgress = (waveIdx0 + waveProgress) / wavesTotal;

        // 基础强度：随关卡递增，前期略快起步，后期更稳
        // 使用 smoothstep 做曲线，避免突刺
        const smoothstep = (x) => {
            const t = Math.max(0, Math.min(1, x));
            return t * t * (3 - 2 * t);
        };
        const prog = smoothstep(runProgress);
        const stageF = 1 + (this.stage - 1) * 0.18;

        // 玩家强度会影响刷怪，但要“缓慢跟随”，不允许瞬间跳变
        const dps = p ? (p.damage / Math.max(0.12, p.attackCooldown)) : 40;
        const power = p ? ((p.level * 0.55) + (dps / 70) + (p.maxHp / 260)) : 1;
        const targetIntensity = (0.55 + prog * 1.35) * stageF * (1 + Math.min(2.2, power * 0.06));

        // 指数平滑（时间常数约 2s）：消除升级/拿装备带来的瞬时爆发
        const alpha = 1 - Math.pow(0.001, (dt || 0.016) / 2.0);
        this.intensitySmooth = (this.intensitySmooth || targetIntensity) + (targetIntensity - (this.intensitySmooth || targetIntensity)) * alpha;

        // 把强度映射到 “每秒刷怪数”
        // 早期：~0.8-1.3 只/s；中后期：~2-4+ 只/s（受 maxEnemies 限制）
        const base = 0.85;
        const perSecRaw = base + this.intensitySmooth * 1.15;

        // 诉求：前 30 秒更快起怪，但仍然平滑、不突刺
        // 用 smoothstep 做一个从 1.28 -> 1.0 的早期加速倍率（30s 内衰减）
        const t30 = smoothstep((this.gameTime || 0) / 30);
        const earlyBoost = 1 + (1 - t30) * 0.28;

        // 微调：每第 5 波略增压，但不做“休息波/爆发波”的硬切
        const wavePulse = ((this.wave % 5) === 0) ? 1.08 : 1.0;
        return Math.max(0.6, Math.min(6.8, perSecRaw * earlyBoost * wavePulse));
    }

    getDynamicSpawnCount() {
        const p = this.player;
        if (!p) return 1;
        const dps = (p.damage / Math.max(0.12, p.attackCooldown));
        const power = (p.level * 0.6) + (dps / 55) + (p.maxHp / 220);
        const factor = this.enemyCountScale * (1 + Math.min(3.0, power * 0.08));
        return Math.max(1, Math.round(factor));
    }

    getDynamicMaxEnemies() {
        const p = this.player;
        if (!p) return 60;
        const dps = (p.damage / Math.max(0.12, p.attackCooldown));
        const power = (p.level * 0.7) + (dps / 60) + (p.maxHp / 200);
        // Hard cap to avoid performance issues
        return Math.max(40, Math.min(100, Math.floor(40 + power * 7)));
    }

    getDifficultyFactor() {
        // Legacy：保留接口避免大量改动，但不再用于刷怪强度的核心决策。
        // 如仍有逻辑调用该函数，返回 0 表示不做正弦波“忽强忽弱”。
        return 0;
    }

    spawnEnemy() {
        const player = this.player;

        // 每关怪物池
        const pool = this.getStageEnemyPool(this.stage);
        const allowed = new Set(pool.allowed || ['basic']);
        const configs = this.getStageEnemyConfigs(this.stage);

        // 以关卡池 weights 为准；不提供时使用默认值
        // 注：这里仍然可以根据玩家属性做轻度倾向，但不做“突刺式针对”。
        const weights = {};
        const addW = (k, w) => {
            if (!allowed.has(k)) return;
            weights[k] = (weights[k] || 0) + w;
        };

        if (pool.weights) {
            for (const [k, w] of Object.entries(pool.weights)) addW(k, w);
        } else {
            // fallback defaults
            addW('basic', 10);
            addW('runner', 4);
            addW('tank', 4);
            addW('ranger', 4);
        }

        if (this.frenzyActive) {
            // Frenzy: 只刷基础怪，避免机制怪打断爽刷
            Object.keys(weights).forEach(k => weights[k] = 0);
            addW('basic', 24);
        } else {
            // 轻度倾向：避免玩家“完全无解”的局面，但不走大幅波动
            if (player) {
                const isSlow = player.speed < 220;
                const isLowDmg = (player.damage / Math.max(0.12, player.attackCooldown)) < 180;
                const isSquishy = player.maxHp < 240;
                if (isSlow) addW('runner', 1);
                if (isLowDmg) addW('tank', 1);
                if (isSquishy) addW('ranger', 1);
            }

            // 波次推进：后半段略提升“麻烦怪”占比
            const late = (this.wave / Math.max(1, this.wavesTotal || 10)) > 0.55;
            if (late) {
                addW('runner', 1);
                addW('tank', 1);
                addW('ranger', 1);
                // 机制怪在后半段略微提高出现率，但不“倾倒式上新”
                addW('kamikaze', 1);
                addW('splitter', 1);
                addW('poisoner', 1);
                addW('shielded', 1);
                addW('sniper', 1);
                addW('warper', 1);
            }
        }

        // Select Enemy Type
        const entries = Object.entries(weights).filter(([, w]) => w > 0);
        const totalWeight = entries.reduce((a, [, b]) => a + b, 0) || 1;
        let random = Math.random() * totalWeight;
        let type = entries.length > 0 ? entries[0][0] : 'basic';
        for (const [k, w] of entries) {
            random -= w;
            if (random <= 0) { type = k; break; }
        }

        // 精英池：Boss 击败后解锁，后续关卡稀有出现（不需要写进关卡 allowed）
        if (!this.frenzyActive && this.eliteBlueprints && this.eliteBlueprints.length > 0 && this.stage >= 4) {
            weights['elite'] = (weights['elite'] || 0) + Math.min(2, 1 + Math.floor(this.eliteBlueprints.length * 0.5));
        }

        if (type === 'elite' && this.eliteBlueprints && this.eliteBlueprints.length > 0) {
            const bp = this.eliteBlueprints[Math.floor(Math.random() * this.eliteBlueprints.length)];
            this.enemies.push(new Enemy(this, this.makeEliteConfigFromBlueprint(bp)));
            return;
        }

        this.enemies.push(new Enemy(this, configs[type] || configs.basic));
    }

    onEnemyKilled(enemy) {
        // Combo Logic
        this.comboCount++;
        this.comboTimer = 3.0; // 3 seconds to keep combo
        this.updateComboUI();

        if (this.comboCount > 0 && this.comboCount % 30 === 0) {
            this.triggerFrenzy();
        }
    }

    triggerFrenzy() {
        if (this.frenzyActive) return;
        this.frenzyActive = true;
        this.frenzyTimer = 5.0; // 5 seconds of fun
        document.getElementById('frenzy-msg').classList.remove('hidden');
        
        // Reward: Heal a bit
        this.player.heal(10);
    }

    updateComboUI() {
        const el = document.getElementById('combo-container');
        const countEl = document.getElementById('combo-count');
        if (this.comboCount > 1) {
            el.classList.remove('hidden');
            countEl.innerText = this.comboCount;
            // Reset animation
            el.style.animation = 'none';
            el.offsetHeight; /* trigger reflow */
            el.style.animation = null; 
        } else {
            el.classList.add('hidden');
        }
    }

    spawnBoss() {
        if (this.sfx) this.sfx.play('bossSpawn');
        document.getElementById('boss-hp-container').classList.remove('hidden');
        const bp = this.generateBossBlueprint();
        const boss = new Enemy(this, bp.config);
        this.enemies.push(boss);
        this.bossRef = boss;
        const nameEl = document.getElementById('boss-name');
        if (nameEl) nameEl.innerText = bp.name || 'BOSS';
    }

    bossDefeated(boss) {
        if (this.sfx) this.sfx.play('bossClear');
        this.bossActive = false;
        this.bossRef = null;
        document.getElementById('boss-hp-container').classList.add('hidden');
        this.registerEliteFromBoss(boss);
        this.saveManager.addPoints(100 * this.stage);
        this.state = 'PAUSED';
        this.pendingLootItem = this.generateLoot();
        
        const modal = document.getElementById('loot-modal');
        const display = document.getElementById('loot-display');
        display.innerHTML = '';
        const div = document.createElement('div');
        div.className = `loot-item ${this.pendingLootItem.isHeirloom ? 'heirloom' : ''}`;
        div.innerHTML = `<h3>${this.pendingLootItem.name}</h3><p>${this.pendingLootItem.desc}</p>`;
        if(this.pendingLootItem.isHeirloom) div.innerHTML += `<p style="color:#FFD740;font-weight:bold">传家宝 (可继承)</p>`;
        display.appendChild(div);
        modal.classList.remove('hidden');
    }

    generateLoot() {
        const r = Math.random();
        const possibleHeirlooms = ITEMS.filter(i => i.isHeirloom && !this.saveManager.data.heirlooms.includes(i.id));
        const standards = ITEMS.filter(i => !i.isHeirloom);
        if (possibleHeirlooms.length > 0 && r < 0.2) return possibleHeirlooms[Math.floor(Math.random() * possibleHeirlooms.length)];
        return standards[Math.floor(Math.random() * standards.length)];
    }

    collectLoot() {
        const item = this.pendingLootItem;
        document.getElementById('loot-modal').classList.add('hidden');
        if (item.isHeirloom) this.saveManager.addHeirloom(item.id);
        const added = this.player.addItem(item);
        if (!added) this.showInventoryFullModal(item);
        else this.openLobby();
    }

    showStageClear() {
        document.getElementById('stage-clear-modal').classList.remove('hidden');
        this.sfx?.play('stageClear');
    }
    findNearestEnemy(x, y, range) {
        let n = null; let min = range;
        this.enemies.forEach(e => {
            const d = Math.sqrt((e.x - x) ** 2 + (e.y - y) ** 2);
            if (d < min) { min = d; n = e; }
        });
        return n;
    }

    findNearestEnemies(x, y, range, count) {
        const list = [];
        const r = range || 99999;
        this.enemies.forEach(e => {
            const d = Math.sqrt((e.x - x) ** 2 + (e.y - y) ** 2);
            if (d <= r) list.push({ e, d });
        });
        list.sort((a, b) => a.d - b.d);
        return list.slice(0, Math.max(1, count || 1)).map(o => o.e);
    }

    renderSkillPanel() {
        const el = document.getElementById('active-skills');
        if (!el || !this.player) return;

        const p = this.player;
        const ids = Object.keys(p.skills || {});
        if (ids.length === 0) {
            el.innerHTML = '';
            return;
        }

        // 只展示主动技能为 icon（尽量不遮挡）。被动技能不显示在 HUD 上。
        const entries = ids
            .map(id => ({ id, lvl: p.skills[id], def: SKILLS[id] }))
            .filter(s => s.def && s.def.type === 'active')
            .sort((a, b) => (b.lvl || 0) - (a.lvl || 0));

        if (entries.length === 0) {
            el.innerHTML = '';
            return;
        }

        const ringR = 16;
        const C = 2 * Math.PI * ringR;
        const safe = (s) => String(s || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

        let html = '';
        entries.forEach(s => {
            const def = s.def;
            const lvl = s.lvl;
            const params = def.getParams ? def.getParams(this, lvl, p) : { cooldown: def.cooldown };
            const cd = (params && params.cooldown !== undefined) ? params.cooldown : (def.cooldown || 0);
            const t = p.skillTimers[s.id] || 0;
            const pct = (cd > 0 ? Math.min(1, Math.max(0, t / cd)) : 1); // 0~1，越大越接近“转好”
            const dashOffset = (1 - pct) * C;
            const rem = Math.max(0, cd - t);
            const ready = rem <= 0.001;

            // CD 环颜色：红(0) -> 绿(120)
            const hue = Math.round(120 * pct);
            const ringColor = `hsl(${hue}, 90%, 55%)`;

            const label = (def.name && def.name.length > 0) ? def.name[0] : '?';
            const tip = safe(def.name) + ` (Lv.${lvl})\n` + safe(def.desc ? def.desc(lvl) : '');

            html += `
                <div class="skill-icon ${ready ? 'ready' : ''}" title="${tip}" style="--pct:${(pct * 100).toFixed(1)}; --ring:${safe(ringColor)}">
                    <svg class="skill-ring" viewBox="0 0 36 36" aria-hidden="true">
                        <circle class="skill-ring-bg" cx="18" cy="18" r="${ringR}" />
                        <circle class="skill-ring-fg" cx="18" cy="18" r="${ringR}"
                            stroke-dasharray="${C.toFixed(3)}"
                            stroke-dashoffset="${dashOffset.toFixed(3)}" />
                    </svg>
                    <div class="skill-label">${safe(label)}</div>
                    <div class="skill-level">${lvl}</div>
                </div>
            `;
        });
        el.innerHTML = html;
    }

    createAoE(x, y, r, d, dmg, c) {
        // target: 'enemies' | 'player' | 'both'
        const g = this;
        let target = 'enemies';
        let opts = {};
        const arg6 = arguments[6];
        const arg7 = arguments[7];
        if (typeof arg6 === 'string') {
            target = arg6 || 'enemies';
            opts = (arg7 && typeof arg7 === 'object') ? arg7 : {};
        } else if (arg6 && typeof arg6 === 'object') {
            opts = arg6;
            target = opts.target || 'enemies';
        } else {
            target = 'enemies';
            opts = {};
        }
        const tickInterval = Math.max(0.05, opts.tickInterval || 0.5);
        this.aoeZones.push({
            x, y, r, d, dmg, c, t: 0, tick: 0,
            update: function (dt) {
                this.t += dt; this.tick += dt;
                if (this.t >= this.d) this.markedForDeletion = true;
                if (opts.follow === 'player' && g.player) {
                    this.x = g.player.x;
                    this.y = g.player.y;
                }
                if (this.tick >= tickInterval) {
                    this.tick = 0;
                    if (target === 'enemies' || target === 'both') {
                        g.enemies.forEach(e => {
                            if (Math.sqrt((e.x - this.x) ** 2 + (e.y - this.y) ** 2) < this.r + e.radius) {
                                e.takeDamage(this.dmg);
                                if (opts.onTickEnemy) opts.onTickEnemy(g, e, this);
                            }
                        });
                    }
                    if (target === 'player' || target === 'both') {
                        const p = g.player;
                        if (p && Math.sqrt((p.x - this.x) ** 2 + (p.y - this.y) ** 2) < this.r + p.radius) {
                            p.takeDamage(this.dmg);
                            if (opts.onTickPlayer) opts.onTickPlayer(g, p, this);
                        }
                    }
                }
            },
            draw: function (ctx) {
                ctx.globalAlpha = 0.3; ctx.fillStyle = this.c; ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1; ctx.strokeStyle = this.c; ctx.stroke();
            }
        });
    }

    createMushroom(x, y, dmg, options) {
        this.mushrooms.push(new Mushroom(this, x, y, dmg, options));
    }

    applyPlayerSlow(duration, speedMul) {
        const p = this.player;
        if (!p) return;
        p.statusSlowTimer = Math.max(p.statusSlowTimer || 0, duration);
        p.statusSlowMul = Math.min(p.statusSlowMul || 1, speedMul);
    }

    applyPlayerBlind(duration) {
        const p = this.player;
        if (!p) return;
        p.statusBlindTimer = Math.max(p.statusBlindTimer || 0, duration);
    }

    getBossSkillLevelCap(skillId) {
        const pLvl = (this.player && this.player.skills && this.player.skills[skillId]) ? this.player.skills[skillId] : 0;
        const max = (SKILLS[skillId] && SKILLS[skillId].maxLevel) ? SKILLS[skillId].maxLevel : 10;
        return Math.max(1, Math.min(max, pLvl + 2));
    }

    generateBossBlueprint() {
        // 多原型 Boss：用“机制”制造记忆点，而不是单纯堆数值
        const s = Math.max(1, this.stage || 1);
        const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

        const bosses = [
            {
                id: 'queen',
                name: '蜂后 · 余烬之翼',
                color: '#FFCC80',
                config: {
                    type: 'boss',
                    bossType: 'queen',
                    hp: 820 + s * 150,
                    speed: 78 + Math.min(36, s * 2),
                    damage: 16 + s * 3,
                    exp: 30,
                    radius: 58,
                    color: '#FFCC80'
                }
            },
            {
                id: 'toad',
                name: '毒沼巨蟾 · 黏液王',
                color: '#9CCC65',
                config: {
                    type: 'boss',
                    bossType: 'toad',
                    hp: 920 + s * 170,
                    speed: 66 + Math.min(28, s * 2),
                    damage: 18 + s * 3,
                    exp: 32,
                    radius: 62,
                    color: '#9CCC65'
                }
            },
            {
                id: 'gunslinger',
                name: '镜像枪手 · 零号',
                color: '#26C6DA',
                config: {
                    type: 'boss',
                    bossType: 'gunslinger',
                    hp: 760 + s * 140,
                    speed: 72 + Math.min(32, s * 2),
                    damage: 20 + s * 3,
                    exp: 34,
                    radius: 54,
                    color: '#26C6DA',
                    isRanged: true,
                    attackRange: 520,
                    rangedProfile: { cooldown: 2.2, projSpeed: 520, color: '#26C6DA', radius: 4 }
                }
            },
            {
                id: 'priest',
                name: '圣坛司祭 · 金辉之环',
                color: '#FFD740',
                config: {
                    type: 'boss',
                    bossType: 'priest',
                    hp: 980 + s * 180,
                    speed: 62 + Math.min(26, s * 2),
                    damage: 16 + s * 3,
                    exp: 36,
                    radius: 60,
                    color: '#FFD740'
                }
            },
            {
                id: 'reaper',
                name: '虚空收割者 · 低语',
                color: '#B388FF',
                config: {
                    type: 'boss',
                    bossType: 'reaper',
                    hp: 860 + s * 160,
                    speed: 76 + Math.min(34, s * 2),
                    damage: 18 + s * 3,
                    exp: 38,
                    radius: 60,
                    color: '#B388FF'
                }
            }
        ];

        // 随关卡提升：逐步把“更复杂”的 Boss 放进池子
        let pool = bosses.slice(0, Math.min(bosses.length, 2 + Math.floor((s - 1) / 1.2)));
        // 避免“每关固定一个”太死板：从池子里随机抽
        const chosen = pick(pool);
        return { ...chosen, config: chosen.config };
    }

    registerEliteFromBoss(boss) {
        if (!boss) return;
        // Store a weakened blueprint that will spawn as an "elite" later.
        // Elite inherits ONE signature mechanic from the boss (readable + not overwhelming).
        const bt = boss.bossType || 'generic';
        this.eliteBlueprints.push({
            bossType: bt,
            color: boss.color || '#FFD740'
        });
    }

    makeEliteConfigFromBlueprint(bp) {
        const bt = (bp && bp.bossType) ? bp.bossType : 'generic';
        const c = (bp && bp.color) ? bp.color : '#FFD740';
        // Elites: weaker stats, keep ONE boss signature.
        if (bt === 'queen') {
            return { type: 'elite', hp: 260, speed: 140, damage: 10, exp: 7, radius: 20, color: c, leap: { cooldown: 3.6, duration: 0.55, speedMul: 2.2 } };
        }
        if (bt === 'toad') {
            return { type: 'elite', hp: 280, speed: 115, damage: 10, exp: 7, radius: 22, color: c, behavior: 'trail_poison', trail: { interval: 1.0, radius: 90, duration: 2.2, damage: 4, tickInterval: 0.5, color: 'rgba(124, 179, 66, 0.20)' } };
        }
        if (bt === 'gunslinger') {
            return { type: 'elite', hp: 240, speed: 120, damage: 12, exp: 8, radius: 18, color: c, isRanged: true, attackRange: 520, behavior: 'blink', blinkCd: 4.0, rangedProfile: { cooldown: 2.6, projSpeed: 520, color: c, radius: 4, onHitSlow: { duration: 0.9, speedMul: 0.8 } } };
        }
        if (bt === 'priest') {
            return { type: 'elite', hp: 320, speed: 105, damage: 10, exp: 8, radius: 22, color: c, aura: { radius: 170, heal: 8, interval: 1.0, color: 'rgba(255, 215, 64, 0.12)' }, dmgTakenMul: 0.75 };
        }
        if (bt === 'reaper') {
            return { type: 'elite', hp: 260, speed: 135, damage: 11, exp: 8, radius: 20, color: c, behavior: 'blink', blinkCd: 3.6, leap: { cooldown: 4.2, duration: 0.5, speedMul: 2.3 } };
        }
        return { type: 'elite', hp: 260, speed: 120, damage: 10, exp: 7, radius: 20, color: c };
    }

    createHealthPotion(x, y) {
        this.potions.push(new HealthPotion(this, x, y));
    }
    
    createExpOrb(x, y, v) {
        this.expOrbs.push({
            x, y, v, r: 5,
            update: function (dt) {
                const dx = game.player.x - this.x; const dy = game.player.y - this.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < 150 * game.player.magnetMultiplier) { this.x += dx / d * 400 * dt; this.y += dy / d * 400 * dt; }
                if (d < game.player.radius + this.r) { game.player.gainExp(this.v); this.markedForDeletion = true; }
            },
            draw: function (ctx) { ctx.fillStyle = '#00BCD4'; ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill(); }
        });
    }

    showInventoryFullModal(newItem) {
        this.state = 'PAUSED';
        this.updateMobileControlsVisibility();
        this.pendingItem = newItem;
        const modal = document.getElementById('inventory-modal');
        document.getElementById('new-item-name').innerText = newItem.name;
        const grid = document.getElementById('inventory-grid');
        grid.innerHTML = '';
        this.player.inventory.forEach((slot, idx) => {
            const div = document.createElement('div');
            div.className = 'equip-slot'; div.style.width = '60px'; div.style.height = '60px';
            div.innerHTML = `${slot.item.name[0]}<div class="lvl-badge">${slot.level}</div>`;
            div.onclick = () => {
                this.player.inventory[idx] = { item: newItem, level: 1 };
                this.player.recalculateStats();
                this.updateHUDInventory();
                document.getElementById('inventory-modal').classList.add('hidden');
                this.openLobby();
            };
            grid.appendChild(div);
        });
        modal.classList.remove('hidden');
    }

    discardNewItem() { document.getElementById('inventory-modal').classList.add('hidden'); this.openLobby(); }

    showUpgradeModal() {
        this.state = 'PAUSED';
        this.updateMobileControlsVisibility();
        const m = document.getElementById('upgrade-modal');
        const c = document.getElementById('upgrade-options');
        c.innerHTML = '';
        const pool = Object.keys(SKILLS).filter(k => (this.player.skills[k]||0) < SKILLS[k].maxLevel);
        const picks = [];
        for(let i=0; i<3 && pool.length>0; i++) {
            const idx = Math.floor(Math.random()*pool.length);
            picks.push(pool[idx]);
            pool.splice(idx,1);
        }
        picks.forEach(id => {
            const def = SKILLS[id];
            const lvl = (this.player.skills[id]||0) + 1;
            const d = document.createElement('div');
            d.className = 'upgrade-card';
            d.innerHTML = `<h3>${def.name} Lv.${lvl}</h3><p>${def.desc(lvl)}</p>`;
            d.onclick = () => {
                this.player.skills[id] = lvl;
                this.player.gainExp(0);
                this.player.recalculateStats();
                this.closeModal('upgrade-modal');
            };
            c.appendChild(d);
        });
        if (picks.length===0) {
            const d = document.createElement('div');
            d.className='upgrade-card';
            d.innerHTML='<h3>HP 回复</h3><p>回复 50% 生命</p>';
            d.onclick=()=>{ this.player.hp=Math.min(this.player.maxHp, this.player.hp+this.player.maxHp*0.5); this.closeModal('upgrade-modal');};
            c.appendChild(d);
        }
        m.classList.remove('hidden');
    }

    closeModal(id) {
        document.getElementById(id).classList.add('hidden');
        this.lastTime = performance.now();
        this.state = 'PLAYING';
        this.updateMobileControlsVisibility();
    }
    
    gameOver() {
        this.state = 'GAMEOVER';
        this.updateMobileControlsVisibility();
        const pts = Math.floor(this.gameTime / 5);
        this.saveManager.addPoints(pts);
        const td = document.getElementById('time-display');
        const finalTime = td ? td.innerText : "00:00";
        document.getElementById('final-time').innerText = finalTime;
        document.getElementById('gained-points').innerText = pts;
        document.getElementById('game-over-modal').classList.remove('hidden');
    }

    triggerDamageEffect() {
        const ov = document.getElementById('damage-overlay');
        ov.classList.add('damage-flash');
        setTimeout(() => ov.classList.remove('damage-flash'), 100);
    }

    updateUI() {
        document.getElementById('hp-display').innerText = `${Math.ceil(this.player.hp)}/${Math.ceil(this.player.maxHp)}`;
        const pct = (this.player.exp / this.player.expToNextLevel) * 100;
        document.getElementById('exp-bar').style.width = `${pct}%`;
        document.getElementById('level-badge').innerText = this.player.level;
        this.renderSkillPanel();
    }

    updateHUDWave() {
        document.getElementById('stage-display').innerText = this.stage;
        document.getElementById('wave-display').innerText = this.wave;
        const totalEl = document.getElementById('wave-total');
        if (totalEl) totalEl.innerText = (this.wavesTotal || 10);
    }

    updateHUDInventory() {
        const c = document.getElementById('equipment-container');
        c.innerHTML = '';
        this.player.inventory.forEach(slot => {
            const div = document.createElement('div');
            div.className = `equip-slot ${slot.item.isHeirloom ? 'heirloom' : ''}`;
            div.innerHTML = `${slot.item.name[0]}<div class="lvl-badge">${slot.level}</div>`;
            div.title = `${slot.item.name}\n${slot.item.desc}`;
            c.appendChild(div);
        });
    }

    draw() {
        this.ctx.clearRect(0, 0, this.width, this.height);

        // Slight zoom-out on mobile so the screen feels less cramped.
        const scale = (this.mobileControls && this.mobileControls.isMobile) ? 0.80 : 1.0;

        // Camera with deadzone: reduce motion sickness by not moving the camera all the time.
        const p = this.player;
        const viewWorldW = this.width / scale;
        const viewWorldH = this.height / scale;

        // Compute target camera based on keeping player within deadzone rectangle.
        let targetCamX = this.cameraX || 0;
        let targetCamY = this.cameraY || 0;

        if (p) {
            const marginX = Math.min(viewWorldW * 0.45, Math.max(60, viewWorldW * this.cameraMarginX));
            const marginY = Math.min(viewWorldH * 0.45, Math.max(60, viewWorldH * this.cameraMarginY));
            const left = targetCamX + marginX;
            const right = targetCamX + (viewWorldW - marginX);
            const top = targetCamY + marginY;
            const bottom = targetCamY + (viewWorldH - marginY);

            if (p.x < left) targetCamX = p.x - marginX;
            else if (p.x > right) targetCamX = p.x - (viewWorldW - marginX);

            if (p.y < top) targetCamY = p.y - marginY;
            else if (p.y > bottom) targetCamY = p.y - (viewWorldH - marginY);
        }

        // Clamp target camera so it doesn't show outside the world
        targetCamX = Math.max(0, Math.min(this.worldWidth - viewWorldW, targetCamX));
        targetCamY = Math.max(0, Math.min(this.worldHeight - viewWorldH, targetCamY));

        // Smoothly approach target using the simulation dt (less "sticky" than timing-based estimates)
        const dt = Math.min(0.05, Math.max(0.001, this._dt || 1 / 60));

        // Dynamic smooth: on mobile and when stick is pushed hard, follow snappier to reduce perceived latency.
        const axis = (this.input && this.input.getMoveAxis) ? this.input.getMoveAxis() : { x: 0, y: 0 };
        const mag = Math.min(1, Math.hypot(axis.x || 0, axis.y || 0));
        let smooth = this.cameraSmooth;
        if (this.mobileControls && this.mobileControls.isMobile) smooth *= 1.35;
        if (mag > 0.55) smooth *= (1 + (mag - 0.55) * 0.9); // up to ~1.4x
        const t = 1 - Math.exp(-dt * smooth);

        this.cameraX = this.cameraX + (targetCamX - this.cameraX) * t;
        this.cameraY = this.cameraY + (targetCamY - this.cameraY) * t;

        // Anti-lag clamp at the deadzone edge: if player would exit the safe area, snap that axis to target.
        if (p) {
            const marginX = Math.min(viewWorldW * 0.45, Math.max(60, viewWorldW * this.cameraMarginX));
            const marginY = Math.min(viewWorldH * 0.45, Math.max(60, viewWorldH * this.cameraMarginY));
            const left = this.cameraX + marginX;
            const right = this.cameraX + (viewWorldW - marginX);
            const top = this.cameraY + marginY;
            const bottom = this.cameraY + (viewWorldH - marginY);
            if (p.x < left - 2 || p.x > right + 2) this.cameraX = targetCamX;
            if (p.y < top - 2 || p.y > bottom + 2) this.cameraY = targetCamY;
        }

        const camX = this.cameraX;
        const camY = this.cameraY;

        this.ctx.save();
        this.ctx.scale(scale, scale);
        this.ctx.translate(-camX, -camY);

        // Background: draw only the visible area (big map feeling)
        this.drawBackground(this.ctx, camX, camY, viewWorldW, viewWorldH);

        this.mushrooms.forEach(m => m.draw(this.ctx));
        this.potions.forEach(p => p.draw(this.ctx));
        this.aoeZones.forEach(z => z.draw(this.ctx));
        this.expOrbs.forEach(e => e.draw(this.ctx));
        this.enemies.forEach(e => e.draw(this.ctx));
        this.projectiles.forEach(p => p.draw(this.ctx));
        if (this.player) this.player.draw(this.ctx);

        this.ctx.restore();
    }

    drawBackground(ctx, viewX, viewY, viewW, viewH) {
        // Base grass
        ctx.fillStyle = '#2E7D32';
        ctx.fillRect(viewX, viewY, viewW, viewH);

        // Subtle grid for motion reference (helps mobile positioning)
        const grid = 120;
        const minor = 30;

        // Minor
        ctx.strokeStyle = 'rgba(0,0,0,0.06)';
        ctx.lineWidth = 1;
        const startX1 = Math.floor(viewX / minor) * minor;
        const startY1 = Math.floor(viewY / minor) * minor;
        ctx.beginPath();
        for (let x = startX1; x <= viewX + viewW; x += minor) {
            ctx.moveTo(x, viewY);
            ctx.lineTo(x, viewY + viewH);
        }
        for (let y = startY1; y <= viewY + viewH; y += minor) {
            ctx.moveTo(viewX, y);
            ctx.lineTo(viewX + viewW, y);
        }
        ctx.stroke();

        // Major
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 2;
        const startX2 = Math.floor(viewX / grid) * grid;
        const startY2 = Math.floor(viewY / grid) * grid;
        ctx.beginPath();
        for (let x = startX2; x <= viewX + viewW; x += grid) {
            ctx.moveTo(x, viewY);
            ctx.lineTo(x, viewY + viewH);
        }
        for (let y = startY2; y <= viewY + viewH; y += grid) {
            ctx.moveTo(viewX, y);
            ctx.lineTo(viewX + viewW, y);
        }
        ctx.stroke();

        // World border hint
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.12)';
        ctx.lineWidth = 6;
        ctx.strokeRect(0, 0, this.worldWidth, this.worldHeight);
    }

    loop(ts) {
        if (!this.lastTime) this.lastTime = ts;
        let dt = (ts - this.lastTime) / 1000;
        this.lastTime = ts;
        
        // Prevent large dt jumps (e.g. tab switch) by capping instead of skipping
        if (dt > 0.1) dt = 0.1;

        if (this.state === 'PLAYING') {
            this.update(dt);
            this.draw();
        } else if (this.state === 'MENU') {
            this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, this.width, this.height);
        }
        requestAnimationFrame(this.loop);
    }
}

class InputHandler {
    constructor() {
        this.k = {};
        this.axis = { x: 0, y: 0 };
        window.addEventListener('keydown', e => { if(e.key==='Escape') game.togglePause(); this.k[e.key] = true; });
        window.addEventListener('keyup', e => this.k[e.key] = false);
    }
    isKeyDown(k) { return !!this.k[k]; }
    setMoveAxis(x, y) {
        this.axis.x = Math.max(-1, Math.min(1, x || 0));
        this.axis.y = Math.max(-1, Math.min(1, y || 0));
    }
    getMoveAxis() { return this.axis; }
}

const game = new Game();
