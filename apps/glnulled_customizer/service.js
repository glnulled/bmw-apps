'use strict';
/**
 * service.js - the driving mode on the cluster, with or without the app's screen open (app.json "autostart").
 *
 * From the car (de.bmw.infotainment.drivingexcitement.FES, instance 1, the unit's catalog):
 *   statusFESVehicleDynamicSwitchHMI   the driving mode (modes.js) and whether the driver cut DSC down
 *   statusDSCSwitchHMI                 DSC on, traction (DTC), off
 *   modeAvailabilityDSC                full, traction, M Dynamic, none
 * To the cluster: the mode, TRACTION under it in the traction mode, DSC OFF under it (blinking) when off (overlay.js).
 * Mode off (the page) closes the connection to cluster-render: nothing of ours on the cluster, its slot let go.
 *
 * CUSTOMIZER_SIMULATE=1 (the emulator, the desk): a stand-in car steps through modes and DSC states by itself.
 */
const { Config } = require('./config');
const { Overlay } = require('./overlay');
const { modeOf } = require('./modes');
const { stabilityOf } = require('./stability');

const FES = 'de.bmw.infotainment.drivingexcitement.FES';
const BLINK_MS = 500;
const SIM = [
    ['COMFORT', 'DSC_EIN', 'VOLL'], ['COMFORT_PLUS', 'DSC_EIN', 'VOLL'], ['SPORT_DYNAMIC', 'DSC_EIN', 'VOLL'], ['SPORT_INDIVIDUAL', 'TRAKTIONSMODUS_EIN', 'TRAKTION'],
    ['SPORT_EXPERT', 'DSC_AUS', 'KEINE'], ['ECO_PRO_EFFICIENT', 'DSC_EIN', 'VOLL'],
];

const show = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };

class Customizer {
    /** o: { signals, log, dataDir, client (a ClusterRender or null), simulate } */
    constructor(o) {
        this.signals = o.signals; this.log = o.log; this.dataDir = o.dataDir;
        this.simulate = !!o.simulate;
        this.config = new Config(o.dataDir, o.log);
        this.cr = o.client || null;
        this.overlay = this.cr ? new Overlay(this.cr, o.log) : null;
        this.st = { mode: null, stab: null, dsc: { fes: null, dsc: null, avail: null }, seen: [], blinkOn: true, fes: 'not asked' };
        this.listeners = [];
        this.config.onChange(() => { this._connection(); this.update(); });
    }

    onChange(fn) { this.listeners.push(fn); }
    _changed() { this.listeners.forEach((f) => { try { f(); } catch (e) { /* drawing only */ } }); }
    _guard(what, fn) { try { return fn(); } catch (e) { this.log.warn('customizer ' + what + ': ' + (e && e.stack || e)); return null; } }

    async start() {
        if (!this.cr) this.log.warn('customizer: no cluster-render client: nothing is drawn on the cluster');
        this._connection();
        await this._watch();
        if (this.simulate) this._simulate();
        this.update();
        return this;
    }

    async _watch() {
        const s = this.signals;
        if (!s || !s.watch) { this.st.fes = 'no SOME/IP here'; return; }
        const fes = await s.watch(FES, '1', {
            statusFESVehicleDynamicSwitchHMI: (v) => this._guard('mode', () => this.onMode(v)),
            statusDSCSwitchHMI: (v) => this._guard('dsc', () => this.onDsc('dsc', v)),
            modeAvailabilityDSC: (v) => this._guard('dsc', () => this.onDsc('avail', v)),
        }, this.log);
        this.st.fes = fes.error ? 'error: ' + fes.error : 'watching';
        this.log.info('customizer: FES ' + this.st.fes);
    }

    _seen(what, v) {
        const k = what + ' ' + show(v);
        if (this.st.seen.indexOf(k) < 0 && this.st.seen.length < 60) { this.st.seen.push(k); this.log.info('customizer: the car sends ' + k); }
    }

    /** a FES status from the car (or the simulation) */
    onMode(v) {
        this._seen('mode', v);
        const m = modeOf(v);
        if ((m && m.label) !== (this.st.mode && this.st.mode.label)) this.log.info('customizer: mode ' + (m ? m.label + ' (' + m.name + ')' : 'none'));
        this.st.mode = m;
        this.st.dsc.fes = v;
        this._stability();
    }

    /** a DSC status: which = 'dsc' (statusDSCSwitchHMI) | 'avail' (modeAvailabilityDSC) */
    onDsc(which, v) {
        this._seen(which, v);
        this.st.dsc[which] = v;
        this._stability();
    }

    _stability() {
        const s = stabilityOf(this.st.dsc);
        if ((s && s.kind) !== (this.st.stab && this.st.stab.kind)) this.log.info('customizer: stability ' + (s ? s.kind + ' (' + s.why + ')' : 'full'));
        this.st.stab = s;
        this._blink();
        this.update(); this._changed();
    }

    // DSC OFF blinks: shown and hidden every BLINK_MS while DSC is off (the layer's visibility only: no pixels sent)
    _blink() {
        const want = !!this.st.stab && this.st.stab.kind === 'off';
        if (want && !this._blinkTimer) {
            this.st.blinkOn = true;
            this._blinkTimer = setInterval(() => this._guard('blink', () => { this.st.blinkOn = !this.st.blinkOn; this.update(); }), BLINK_MS);
        } else if (!want && this._blinkTimer) { clearInterval(this._blinkTimer); this._blinkTimer = null; this.st.blinkOn = true; }
    }

    /** the mode on (connected to cluster-render) or off (the connection closed: our layers gone, the slot let go) */
    _connection() {
        if (!this.cr) return;
        const on = this.config.get().mode.on;
        if (on && !this._connected) {
            this._connected = true;
            this.cr.connect();
            this.log.info('customizer: on, cluster-render socket ' + (this.cr.path || '?'));
        } else if (!on && this._connected) {
            this._connected = false;
            if (this.overlay) this.overlay.clear();   // before the close: the drops go while the socket is there
            this.cr.close();
            this.log.info('customizer: off: the connection to cluster-render closed, nothing of ours on the cluster');
        }
    }

    _simulate() {
        this.log.info('customizer: simulating the car');
        let k = 0;
        const step = () => this._guard('simulate', () => {
            const s = SIM[k++ % SIM.length];
            this.onMode({ displayModeDrivingExperience: s[0], actualValueModeDrivingExperience: 'SIGNAL_UNBEFUELLT' });
            this.onDsc('dsc', { displayStatusDSC2: s[1], counterControlDisplayStatusDSC: 'SIGNAL_UNBEFUELLT' });
            this.onDsc('avail', { modeDSCAvailability: s[2] });
        });
        step();
        this._sim = setInterval(step, 3000);
    }

    update() {
        if (!this.overlay || !this.config.get().mode.on) return;
        this._guard('overlay', () => this.overlay.update({ cfg: this.config.get(), mode: this.st.mode, stab: this.st.stab, blinkOn: this.st.blinkOn }));
    }

    stop() {
        clearInterval(this._sim); clearInterval(this._blinkTimer); this._sim = this._blinkTimer = null;
        if (this.cr) this.cr.close();
    }
}

module.exports = { Customizer, FES, BLINK_MS };
