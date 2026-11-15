'use strict';
/**
 * modes.js - the driving mode the car reports (FES statusFESVehicleDynamicSwitchHMI), as a label for the cluster.
 *
 * The struct carries displayModeDrivingExperience (what the car shows the driver) and actualValueModeDrivingExperience
 * (what is on); both are DrivingExperience enums, by name or by wire number depending on the binding. The display
 * one wins; the actual one stands in while the display one is unfilled.
 */

// DisplayModeDrivingExperience / ActualValueModeDrivingExperience2: wire numbers -> names (the unit's catalog)
const NAMES = {
    1: 'SPORT_DYNAMIC', 2: 'SPORT_EXPERT', 3: 'SPORT_INDIVIDUAL', 4: 'COMFORT', 5: 'COMFORT_PLUS', 6: 'COMFORT_INDIVIDUAL',
    7: 'ECO_PRO_EFFICIENT', 8: 'ECO_PRO_PLUS', 9: 'ECO_PRO_INDIVIDUAL', 10: 'ADAPTIVE', 11: 'OFFROAD_ICE', 12: 'OFFROAD_SMOOTH',
    13: 'OFFROAD_GRIP', 14: 'OFFROAD_ROUGH', 15: 'PHEV_SPORT_STANDARD', 16: 'PHEV_SPORT_INDIVIDUAL', 17: 'PHEV_HYBRID_STANDARD',
    18: 'PHEV_HYBRID_ECO', 19: 'PHEV_HYBRID_COMFORT', 20: 'PHEV_ELECTRIC_STANDARD', 21: 'PHEV_ELECTRIC_INDIVIDUAL',
    22: 'PHEV_BATTERYCONTROL', 23: 'PHEV_SPORT_PLUS', 24: 'EASE_MODUS', 27: 'TRACTION_ASSIST', 28: 'BOOST',
};
// no mode to show: starting up, unfilled, reserved, errors
const NONE = /^(INITIALISIERUNG|SIGNAL_UNBEFUELLT|RESERVIERT.*|SIGNAL_UNGUELTIG)$/;

// name -> what the cluster shows and its group (the colour)
const LABELS = {
    SPORT_DYNAMIC: ['SPORT', 'sport'], SPORT_EXPERT: ['SPORT+', 'sport'], SPORT_INDIVIDUAL: ['SPORT IND', 'sport'],
    COMFORT: ['COMFORT', 'comfort'], COMFORT_PLUS: ['COMFORT+', 'comfort'], COMFORT_INDIVIDUAL: ['COMFORT IND', 'comfort'],
    ECO_PRO_EFFICIENT: ['ECO PRO', 'eco'], ECO_PRO_PLUS: ['ECO PRO+', 'eco'], ECO_PRO_INDIVIDUAL: ['ECO PRO IND', 'eco'],
    ADAPTIVE: ['ADAPTIVE', 'adaptive'],
    OFFROAD_ICE: ['xOFFROAD ICE', 'offroad'], OFFROAD_SMOOTH: ['xOFFROAD', 'offroad'], OFFROAD_GRIP: ['xOFFROAD GRIP', 'offroad'],
    OFFROAD_ROUGH: ['xOFFROAD ROCK', 'offroad'],
    PHEV_SPORT_STANDARD: ['SPORT', 'sport'], PHEV_SPORT_INDIVIDUAL: ['SPORT IND', 'sport'], PHEV_SPORT_PLUS: ['SPORT+', 'sport'],
    PHEV_HYBRID_STANDARD: ['HYBRID', 'hybrid'], PHEV_HYBRID_ECO: ['HYBRID ECO', 'eco'], PHEV_HYBRID_COMFORT: ['HYBRID', 'hybrid'],
    PHEV_ELECTRIC_STANDARD: ['ELECTRIC', 'electric'], PHEV_ELECTRIC_INDIVIDUAL: ['ELECTRIC IND', 'electric'],
    PHEV_BATTERYCONTROL: ['BATTERY', 'hybrid'], EASE_MODUS: ['EASE', 'comfort'], BOOST: ['BOOST', 'sport'],
    TRACTION_ASSIST: ['TRACTION', 'offroad'],
};
// the colour of each group, as BMW's own mode texts: Sport red, Comfort white, Eco Pro blue
const COLOURS = {
    sport: '#ff3b2f', comfort: '#ffffff', eco: '#2fb4ff', adaptive: '#ffffff', offroad: '#e0b050', hybrid: '#5cd0ff', electric: '#2fb4ff',
};

/** an enum value (name, wire number, or a one-field struct around either) -> its name, or null */
function nameOf(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw === 'object') { const v = Object.values(raw)[0]; return v === undefined ? null : nameOf(v); }
    const s = String(raw).trim();
    if (/^\d+$/.test(s)) return NAMES[Number(s)] || ('MODE_' + s);
    return s.toUpperCase();
}

/** a name -> { name, label, group, colour }, or null for no mode to show */
function labelOf(name) {
    if (!name || NONE.test(name)) return null;
    const l = LABELS[name];
    if (l) return { name, label: l[0], group: l[1], colour: COLOURS[l[1]] };
    // a name this list does not have (another software level): by its words
    const w = name.replace(/^PHEV_/, '');
    const group = /SPORT|BOOST/.test(w) ? 'sport' : /ECO/.test(w) ? 'eco' : /COMFORT/.test(w) ? 'comfort' : /ADAPTIV/.test(w) ? 'adaptive'
        : /ELECTRIC/.test(w) ? 'electric' : /HYBRID/.test(w) ? 'hybrid' : /OFFROAD/.test(w) ? 'offroad' : 'comfort';
    return { name, label: w.replace(/_/g, ' ').slice(0, 14), group, colour: COLOURS[group] };
}

/** the FES struct -> what to show (display mode first), or null */
function modeOf(v) {
    if (!v || typeof v !== 'object') return labelOf(nameOf(v));
    return labelOf(nameOf(v.displayModeDrivingExperience)) || labelOf(nameOf(v.actualValueModeDrivingExperience));
}

module.exports = { modeOf, nameOf, labelOf, NAMES, COLOURS };
