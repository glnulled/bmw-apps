'use strict';
/**
 * stability.js - whether the stability control (DSC) is cut down, from the car's FES statuses
 * (de.bmw.infotainment.drivingexcitement.FES, the unit's catalog). Two cases are shown:
 *
 *   traction  DTC: statusDSCSwitchHMI.displayStatusDSC2 TRAKTIONSMODUS_EIN (4); modeAvailabilityDSC TRAKTION (4),
 *             TRAKTIONSOPTIMIERT_STUFE_1..3 (5..7) or MID (8, M Dynamic Mode); the mode's availability
 *             STABILISIERUNGSFUNKTIONEN_DURCH_KUNDENWUNSCH_EINGESCHRAENKT (13)
 *   off       DSC OFF: displayStatusDSC2 DSC_AUS (1); modeAvailabilityDSC KEINE (9); the mode's availability
 *             STABILISIERUNGSFUNKTIONEN_DURCH_KUNDENWUNSCH_ABGESCHALTET (14)
 *
 * -> { kind: 'traction' | 'off', why } or null (full stability, or nothing known). Off wins over traction.
 */
const DSC2 = { 0: 'DSC_EIN', 1: 'DSC_AUS', 2: 'ANFAHRHILFE_AKTIV', 4: 'TRAKTIONSMODUS_EIN', 13: 'RESERVIERT_NICHT_VERFUEGBAR', 14: 'RESERVIERT_FEHLER', 15: 'SIGNAL_UNGUELTIG' };
const AVAIL = { 1: 'VOLL_UND_FAILSAFE_PARAMETER', 2: 'VOLL', 3: 'VOLL_SPORT', 4: 'TRAKTION', 5: 'TRAKTIONSOPTIMIERT_STUFE_1', 6: 'TRAKTIONSOPTIMIERT_STUFE_2',
    7: 'TRAKTIONSOPTIMIERT_STUFE_3', 8: 'MID', 9: 'KEINE', 13: 'FUNKTIONSSCHNITTSTELLE_IST_NICHT_VERFUEGBAR', 14: 'FUNKTION_MELDET_FEHLER', 15: 'SIGNAL_UNBEFUELLT' };
const CUT = 'STABILISIERUNGSFUNKTIONEN_DURCH_KUNDENWUNSCH_EINGESCHRAENKT', OFF = 'STABILISIERUNGSFUNKTIONEN_DURCH_KUNDENWUNSCH_ABGESCHALTET';
const FES_AVAIL = { 13: CUT, 14: OFF };

/** an enum value (name, wire number, or a one-field struct around either) -> its name, or null */
function nameOf(raw, table) {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw === 'object') { const v = Object.values(raw)[0]; return v === undefined ? null : nameOf(v, table); }
    const s = String(raw).trim();
    return /^\d+$/.test(s) ? (table[Number(s)] || 'VALUE_' + s) : s.toUpperCase();
}
const field = (v, k) => (v && typeof v === 'object' ? v[k] : v);

/** s = { dsc: statusDSCSwitchHMI, avail: modeAvailabilityDSC, fes: statusFESVehicleDynamicSwitchHMI } (each optional) */
function stabilityOf(s) {
    const dsc = nameOf(field(s.dsc, 'displayStatusDSC2'), DSC2);
    const avail = nameOf(field(s.avail, 'modeDSCAvailability'), AVAIL);
    const fes = nameOf(field(s.fes, 'displayAvailibilityModeDrivingExperience'), FES_AVAIL);
    if (dsc === 'DSC_AUS' || avail === 'KEINE' || fes === OFF) return { kind: 'off', why: [dsc, avail, fes].filter(Boolean).join(' ') };
    if (dsc === 'TRAKTIONSMODUS_EIN' || /^TRAKTION|^MID$/.test(avail || '') || fes === CUT) return { kind: 'traction', why: [dsc, avail, fes].filter(Boolean).join(' ') };
    return null;
}

module.exports = { stabilityOf, nameOf, DSC2, AVAIL };
