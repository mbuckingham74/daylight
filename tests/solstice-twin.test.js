const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const SM = require('../html/solar.js');
const SolsticeTwin = require('../html/solstice-twin.js');
const sunCalc = require('suncalc');

// UI-04 — Solstice Twin: closest-daylight-duration twin on the opposite
// side of the source's preceding solstice. The matching criterion is the
// absolute daylight-duration difference at the same latitude/longitude.
// The search is by calendar day, anchored at noon UTC to match the rest
// of Daylight's daily sunrise/sunset path through SunCalc.

function makeTwin() {
  return SolsticeTwin.create({
    getSeasonEvents: SM.getSeasonEvents,
    getDayLengthSeconds: SM.getDayLengthSeconds,
    MS_PER_DAY: SM.MS_PER_DAY,
    isValidDate: SM.isValidDate
  });
}

// Reference: a deterministic day-length computation driven through the
// production solar primitive. Used by the independent-reference cases to
// show the search actually selected the minimum |ΔdayLength| rather than
// a plausible-looking near miss.
function rawDayLength(date, lat, lng) {
  SM.clearSeasonEventCache();
  return SM.getDayLengthSeconds(new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    12, 0, 0, 0
  )), lat, lng, sunCalc);
}

describe('Solstice Twin — module wiring', () => {
  test('create rejects missing dependencies', () => {
    assert.throws(() => SolsticeTwin.create({}));
    assert.throws(() => SolsticeTwin.create({ getSeasonEvents: SM.getSeasonEvents }));
  });

  test('exposes a factory with create() returning an object with find()', () => {
    const twin = makeTwin();
    assert.equal(typeof twin.find, 'function');
  });
});

describe('Solstice Twin — ordinary Northern Hemisphere case', () => {
  // Seattle on Aug 15 2026: the source sits in the quarter after the
  // June solstice. The relevant solstice is the preceding June solstice
  // (closer than December 2025), so the twin must lie in the quarter
  // before it: (March equinox, June solstice).
  test('Aug 15 Seattle twin lies across the preceding June solstice in the spring quarter', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r = twin.find(new Date('2026-08-15T12:00:00Z'), 47.6062, -122.3321, sunCalc);
    assert.equal(r.available, true);
    assert.equal(r.sourceSolsticeName, 'June solstice');
    // The search interval endpoints are March equinox (start) and June
    // solstice (end) because the source is AFTER the June solstice and
    // the search goes backward through the spring quarter.
    assert.equal(r.preSolsticeName, 'March equinox');
    assert.equal(r.postSolsticeName, 'June solstice');
    assert.equal(r.date.getUTCFullYear(), 2026);
    assert.ok(r.date.getUTCMonth() >= 2 && r.date.getUTCMonth() <= 4,
      `twin month = ${r.date.getUTCMonth() + 1}`);
    assert.ok(r.difference < 5 * 60,
      `|ΔdayLength| should be < 5 min, got ${(r.difference / 60).toFixed(2)} min`);
  });

  test('Aug 15 Seattle twin is the closest match among neighboring candidates', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r = twin.find(new Date('2026-08-15T12:00:00Z'), 47.6062, -122.3321, sunCalc);
    assert.equal(r.available, true);
    // The twin's date must beat every other calendar day in the
    // (Mar eq, Jun solstice) search interval on |ΔdayLength|.
    for (let day = 1; day <= 30; day++) {
      for (let month = 3; month <= 5; month++) {
        const candidate = new Date(Date.UTC(2026, month - 1, day, 12));
        const dl = rawDayLength(candidate, 47.6062, -122.3321);
        const diff = Math.abs(dl - r.sourceDayLength);
        if (candidate.getTime() === r.date.getTime()) continue;
        assert.ok(diff >= r.difference,
          `Candidate ${candidate.toISOString().slice(0, 10)} has |Δ|=${diff}s which is closer than twin's ${r.difference}s`);
      }
    }
  });
});

describe('Solstice Twin — May 15 — approaching June solstice', () => {
  // Seattle on May 15 2026: the source sits in the quarter BEFORE the
  // upcoming June solstice. The relevant solstice is the UPCOMING June
  // solstice (~37 days away), not the previous December solstice
  // (~145 days away). The twin must therefore lie in the quarter AFTER
  // the June solstice — strictly inside (Jun solstice, Sep equinox).
  test('May 15 Seattle picks the upcoming June solstice, not the previous December', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r = twin.find(new Date('2026-05-15T12:00:00Z'), 47.6062, -122.3321, sunCalc);
    assert.equal(r.available, true);
    assert.equal(r.sourceSolsticeName, 'June solstice');
    assert.equal(r.preSolsticeName, 'June solstice');
    assert.equal(r.postSolsticeName, 'September equinox');
    // Twin must be strictly AFTER the June solstice and BEFORE the
    // September equinox — never inside the (Sep eq, Dec solstice) quarter.
    const juneSolstice = SM.getSeasonEvents(2026)[1].date;
    const sepEquinox = SM.getSeasonEvents(2026)[2].date;
    assert.ok(r.date.getTime() > juneSolstice.getTime(),
      `twin ${r.date.toISOString()} should be after June solstice ${juneSolstice.toISOString()}`);
    assert.ok(r.date.getTime() < sepEquinox.getTime(),
      `twin ${r.date.toISOString()} should be before Sep eq ${sepEquinox.toISOString()}`);
  });

  test('May 15 Seattle |ΔdayLength| is small and the old preceding-solstice rule would be materially worse', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r = twin.find(new Date('2026-05-15T12:00:00Z'), 47.6062, -122.3321, sunCalc);
    assert.equal(r.available, true);
    const sourceDl = rawDayLength(new Date('2026-05-15T12:00:00Z'), 47.6062, -122.3321);
    assert.ok(r.difference < 5 * 60,
      `corrected |ΔdayLength| should be < 5 min, got ${(r.difference / 60).toFixed(2)} min`);
    // The old preceding-solstice rule would search (Dec solstice 2025,
    // March eq 2026). That interval's daylight range is ~12-14.5h while
    // the source is ~14.93h — the minimum |Δ| there is necessarily
    // larger than what the corrected interval can achieve.
    const decSolstice2025 = SM.getSeasonEvents(2025)[3].date;
    const marchEquinox2026 = SM.getSeasonEvents(2026)[0].date;
    const startOld = Date.UTC(
      decSolstice2025.getUTCFullYear(), decSolstice2025.getUTCMonth(),
      decSolstice2025.getUTCDate() + 1
    );
    const endOld = Date.UTC(
      marchEquinox2026.getUTCFullYear(), marchEquinox2026.getUTCMonth(),
      marchEquinox2026.getUTCDate()
    );
    let oldMin = Infinity;
    for (let ms = startOld; ms < endOld; ms += 86400000) {
      const d = new Date(ms);
      const dl = rawDayLength(d, 47.6062, -122.3321);
      const diff = Math.abs(dl - sourceDl);
      if (diff < oldMin) oldMin = diff;
    }
    assert.ok(oldMin > 60 * 60,
      `old preceding-solstice search should be materially worse; old |Δ| = ${(oldMin / 60).toFixed(2)} min`);
    assert.ok(r.difference < oldMin,
      `corrected |Δ| (${(r.difference / 60).toFixed(2)} min) should be strictly smaller than the old rule's (${(oldMin / 60).toFixed(2)} min)`);
  });
});

describe('Solstice Twin — November 15 — approaching December solstice', () => {
  // Seattle on Nov 15 2026: the source sits in the quarter BEFORE the
  // upcoming December solstice. The relevant solstice is the UPCOMING
  // December solstice (~36 days away), not the previous June solstice
  // (~147 days away). The twin must lie in the quarter AFTER the
  // December solstice — strictly inside (Dec solstice, March equinox of
  // the following year).
  test('Nov 15 Seattle picks the upcoming December solstice and crosses into the next year', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r = twin.find(new Date('2026-11-15T12:00:00Z'), 47.6062, -122.3321, sunCalc);
    assert.equal(r.available, true);
    assert.equal(r.sourceSolsticeName, 'December solstice');
    assert.equal(r.preSolsticeName, 'December solstice');
    assert.equal(r.postSolsticeName, 'March equinox');
    // Twin lies after the upcoming Dec solstice 2026 and before the
    // March equinox of 2027 — potentially in the following calendar year.
    const decSolstice2026 = SM.getSeasonEvents(2026)[3].date;
    const marchEquinox2027 = SM.getSeasonEvents(2027)[0].date;
    assert.ok(r.date.getTime() > decSolstice2026.getTime(),
      `twin ${r.date.toISOString()} should be after Dec solstice ${decSolstice2026.toISOString()}`);
    assert.ok(r.date.getTime() < marchEquinox2027.getTime(),
      `twin ${r.date.toISOString()} should be before March eq 2027 ${marchEquinox2027.toISOString()}`);
    assert.equal(r.date.getUTCFullYear(), 2027,
      `Nov 15 twin should fall in the following calendar year`);
    assert.ok(r.difference < 5 * 60,
      `|ΔdayLength| should be < 5 min, got ${(r.difference / 60).toFixed(2)} min`);
  });
});

describe('Solstice Twin — ordinary Southern Hemisphere case', () => {
  test('Feb 15 Sydney twin lies across the preceding December solstice with close daylight', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r = twin.find(new Date('2026-02-15T12:00:00Z'), -33.8688, 151.2093, sunCalc);
    assert.equal(r.available, true);
    assert.equal(r.sourceSolsticeName, 'December solstice');
    // Source is AFTER the December solstice; the search interval is the
    // SH spring quarter (Sep eq → Dec solstice). The interval endpoints
    // are Sep equinox (start) and December solstice (end).
    assert.equal(r.preSolsticeName, 'September equinox');
    assert.equal(r.postSolsticeName, 'December solstice');
    assert.equal(r.date.getUTCFullYear(), 2025);
    assert.ok(r.date.getUTCMonth() >= 8 && r.date.getUTCMonth() <= 10,
      `twin month = ${r.date.getUTCMonth() + 1}`);
    assert.ok(r.difference < 5 * 60,
      `|ΔdayLength| should be < 5 min, got ${(r.difference / 60).toFixed(2)} min`);
  });

  test('Aug 15 Sydney twin lies across the preceding June solstice with close daylight', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r = twin.find(new Date('2026-08-15T12:00:00Z'), -33.8688, 151.2093, sunCalc);
    assert.equal(r.available, true);
    assert.equal(r.sourceSolsticeName, 'June solstice');
    // Source is AFTER the June solstice; the search interval is the SH
    // autumn quarter (Mar eq → Jun solstice).
    assert.equal(r.preSolsticeName, 'March equinox');
    assert.equal(r.postSolsticeName, 'June solstice');
    assert.ok(r.date.getUTCMonth() >= 2 && r.date.getUTCMonth() <= 4,
      `twin month = ${r.date.getUTCMonth() + 1}`);
    assert.ok(r.difference < 5 * 60,
      `|ΔdayLength| should be < 5 min, got ${(r.difference / 60).toFixed(2)} min`);
  });
});

describe('Solstice Twin — December / year-boundary case', () => {
  test('Jan 5 Seattle twin lies in the previous calendar year with close daylight', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r = twin.find(new Date('2027-01-05T12:00:00Z'), 47.6062, -122.3321, sunCalc);
    assert.equal(r.available, true);
    assert.equal(r.sourceSolsticeName, 'December solstice');
    // Source (Jan 5 2027) is AFTER the Dec solstice 2026; the search
    // interval is the autumn quarter of 2026 (Sep eq → Dec solstice).
    assert.equal(r.preSolsticeName, 'September equinox');
    assert.equal(r.postSolsticeName, 'December solstice');
    assert.equal(r.date.getUTCFullYear(), 2026);
    const sepEq2026 = SM.getSeasonEvents(2026)[2].date;
    const decSol2026 = SM.getSeasonEvents(2026)[3].date;
    assert.ok(r.date.getTime() > sepEq2026.getTime(),
      `twin ${r.date.toISOString()} should be after Sep eq ${sepEq2026.toISOString()}`);
    assert.ok(r.date.getTime() < decSol2026.getTime(),
      `twin ${r.date.toISOString()} should be before Dec solstice ${decSol2026.toISOString()}`);
    assert.ok(r.difference < 5 * 60,
      `|ΔdayLength| should be < 5 min, got ${(r.difference / 60).toFixed(2)} min`);
  });
});

describe('Solstice Twin — near-solstice case', () => {
  test('Source right after the June solstice: twin lies strictly before the solstice', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r = twin.find(new Date('2026-06-22T12:00:00Z'), 47.6062, -122.3321, sunCalc);
    assert.equal(r.available, true);
    assert.equal(r.sourceSolsticeName, 'June solstice');
    // Source is AFTER the June solstice; the search interval is the
    // spring quarter (Mar eq → Jun solstice).
    assert.equal(r.preSolsticeName, 'March equinox');
    assert.equal(r.postSolsticeName, 'June solstice');
    const juneSolstice = SM.getSeasonEvents(2026)[1].date;
    const marchEquinox = SM.getSeasonEvents(2026)[0].date;
    assert.ok(r.date.getTime() > marchEquinox.getTime(),
      `twin ${r.date.toISOString()} should be after March equinox ${marchEquinox.toISOString()}`);
    assert.ok(r.date.getTime() < juneSolstice.getTime(),
      `twin ${r.date.toISOString()} should be before June solstice ${juneSolstice.toISOString()}`);
    assert.ok(!(r.date.getUTCFullYear() === 2026
      && r.date.getUTCMonth() === 5
      && r.date.getUTCDate() === 22),
      `twin must not be the source calendar day`);
  });

  test('Source right before the June solstice: twin lies strictly after the solstice', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r = twin.find(new Date('2026-06-20T12:00:00Z'), 47.6062, -122.3321, sunCalc);
    assert.equal(r.available, true);
    // June 20 is just before the June solstice: the relevant solstice is
    // the upcoming June solstice (only 1 day away), not the December
    // solstice. The search interval is the quarter AFTER the solstice
    // (Jun solstice, Sep equinox) — twin lies strictly after the solstice.
    assert.equal(r.sourceSolsticeName, 'June solstice');
    assert.equal(r.preSolsticeName, 'June solstice');
    assert.equal(r.postSolsticeName, 'September equinox');
    const juneSolstice = SM.getSeasonEvents(2026)[1].date;
    const sepEquinox = SM.getSeasonEvents(2026)[2].date;
    assert.ok(r.date.getTime() > juneSolstice.getTime(),
      `twin ${r.date.toISOString()} should be after June solstice ${juneSolstice.toISOString()}`);
    assert.ok(r.date.getTime() < sepEquinox.getTime(),
      `twin ${r.date.toISOString()} should be before Sep eq ${sepEquinox.toISOString()}`);
    // The source calendar day itself must never be returned.
    assert.ok(!(r.date.getUTCFullYear() === 2026
      && r.date.getUTCMonth() === 5
      && r.date.getUTCDate() === 20),
      `twin must not be the source calendar day`);
  });
});

describe('Solstice Twin — polar day/night case', () => {
  test('24h polar daylight returns unavailable with polar-source reason', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r = twin.find(new Date('2026-06-22T12:00:00Z'), 85, 0, sunCalc);
    assert.equal(r.available, false);
    assert.equal(r.reason, 'polar-source');
    assert.equal(r.sourceDayLength, 86400);
  });

  test('24h polar darkness returns unavailable with polar-source reason', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r = twin.find(new Date('2026-12-22T12:00:00Z'), 85, 0, sunCalc);
    assert.equal(r.available, false);
    assert.equal(r.reason, 'polar-source');
    assert.equal(r.sourceDayLength, 0);
  });

  test('non-polar source at very high latitude with all-polar search returns unavailable', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    // SH lat -89.5 on Sep 21: source daylight ~13h (non-polar — the very
    // brief transition out of polar night). The relevant solstice is the
    // upcoming December solstice (~91 days away), and the search interval
    // (Dec solstice, March eq of the following year) is entirely polar
    // day at this latitude — no unique meaningful twin exists.
    const r = twin.find(new Date('2026-09-21T12:00:00Z'), -89.5, 0, sunCalc);
    assert.equal(r.available, false);
    assert.equal(r.reason, 'polar-plateau');
    assert.equal(r.sourceSolsticeName, 'December solstice');
    assert.equal(r.preSolsticeName, 'December solstice');
    assert.equal(r.postSolsticeName, 'March equinox');
  });
});

describe('Solstice Twin — determinism / tie handling', () => {
  test('same inputs produce the same twin on repeated runs', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r1 = twin.find(new Date('2026-08-15T12:00:00Z'), 47.6062, -122.3321, sunCalc);
    SM.clearSeasonEventCache();
    const r2 = twin.find(new Date('2026-08-15T12:00:00Z'), 47.6062, -122.3321, sunCalc);
    assert.equal(r1.date.getTime(), r2.date.getTime());
    assert.equal(r1.dayLength, r2.dayLength);
    assert.equal(r1.difference, r2.difference);
  });

  test('result exposes a date, dayLength, difference, sourceDayLength, and the corrected solstice endpoint names', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r = twin.find(new Date('2026-08-15T12:00:00Z'), 47.6062, -122.3321, sunCalc);
    assert.ok(r.date instanceof Date);
    assert.equal(typeof r.dayLength, 'number');
    assert.equal(typeof r.difference, 'number');
    assert.equal(typeof r.sourceDayLength, 'number');
    assert.equal(typeof r.sourceSolsticeName, 'string');
    assert.equal(typeof r.preSolsticeName, 'string');
    assert.equal(typeof r.postSolsticeName, 'string');
    assert.ok(r.difference >= 0);
    assert.ok(r.dayLength >= 0 && r.dayLength <= 86400);
  });
});

describe('Solstice Twin — independent reference verification', () => {
  // For representative ordinary cases the test independently evaluates
  // every calendar day in the corrected search interval through the
  // production solar primitive and proves the returned twin minimizes
  // the difference. The helper resolves the same nearest solstice the
  // algorithm uses, then walks the quarter immediately across that
  // solstice from the source — i.e., the candidate interval the
  // production code searches.
  const SEQUENCE = ['March equinox', 'June solstice', 'September equinox', 'December solstice'];

  function exhaustiveCheck(sourceDate, lat, lng) {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r = twin.find(sourceDate, lat, lng, sunCalc);
    assert.equal(r.available, true);

    const sourceDl = rawDayLength(sourceDate, lat, lng);

    // Replicate findNearestSolstice.
    SM.clearSeasonEventCache();
    const year = sourceDate.getUTCFullYear();
    const solsticeEvents = [
      ...SM.getSeasonEvents(year - 1),
      ...SM.getSeasonEvents(year),
      ...SM.getSeasonEvents(year + 1)
    ].filter(e => e.name === 'June solstice' || e.name === 'December solstice');
    let nearest = null;
    let nearestAbs = Infinity;
    for (const ev of solsticeEvents) {
      const diff = Math.abs(ev.date.getTime() - sourceDate.getTime());
      if (diff < nearestAbs) {
        nearestAbs = diff;
        nearest = ev;
      } else if (diff === nearestAbs && ev.date < nearest.date) {
        nearest = ev;
      }
    }
    assert.ok(nearest, 'nearest solstice resolution failed');

    // Replicate findCandidateInterval.
    const idx = SEQUENCE.indexOf(nearest.name);
    const sourceBeforeSolstice = sourceDate.getTime() < nearest.date.getTime();
    let fromEvent, toEvent;
    if (sourceBeforeSolstice) {
      const nextName = SEQUENCE[(idx + 1) % SEQUENCE.length];
      let next = SM.getSeasonEvents(nearest.date.getUTCFullYear()).find(e => e.name === nextName);
      if (!next || next.date.getTime() <= nearest.date.getTime()) {
        next = SM.getSeasonEvents(nearest.date.getUTCFullYear() + 1).find(e => e.name === nextName);
      }
      fromEvent = nearest;
      toEvent = next;
    } else {
      const prevName = SEQUENCE[(idx + SEQUENCE.length - 1) % SEQUENCE.length];
      let prev = SM.getSeasonEvents(nearest.date.getUTCFullYear()).find(e => e.name === prevName);
      if (!prev || prev.date.getTime() >= nearest.date.getTime()) {
        prev = SM.getSeasonEvents(nearest.date.getUTCFullYear() - 1).find(e => e.name === prevName);
      }
      fromEvent = prev;
      toEvent = nearest;
    }
    assert.ok(fromEvent && toEvent, 'interval endpoint resolution failed');

    const startMs = Date.UTC(
      fromEvent.date.getUTCFullYear(),
      fromEvent.date.getUTCMonth(),
      fromEvent.date.getUTCDate() + 1
    );
    const endMs = Date.UTC(
      toEvent.date.getUTCFullYear(),
      toEvent.date.getUTCMonth(),
      toEvent.date.getUTCDate()
    );

    let best = null;
    for (let ms = startMs; ms < endMs; ms += 86400000) {
      const dayStart = new Date(ms);
      const sameDay = dayStart.getUTCFullYear() === sourceDate.getUTCFullYear()
        && dayStart.getUTCMonth() === sourceDate.getUTCMonth()
        && dayStart.getUTCDate() === sourceDate.getUTCDate();
      if (sameDay) continue;
      const candidate = new Date(Date.UTC(
        dayStart.getUTCFullYear(),
        dayStart.getUTCMonth(),
        dayStart.getUTCDate(),
        12, 0, 0, 0
      ));
      const dl = SM.getDayLengthSeconds(candidate, lat, lng, sunCalc);
      const diff = Math.abs(dl - sourceDl);
      if (!best || diff < best.diff) best = { date: new Date(candidate.getTime()), diff };
    }
    assert.ok(best, 'no candidate found in search interval');
    assert.equal(best.date.getTime(), r.date.getTime(),
      `Exhaustive search picks ${best.date.toISOString()}, algorithm picks ${r.date.toISOString()}`);
    assert.equal(best.diff, r.difference);
  }

  test('NH Seattle Aug 15 (post-solstice) — algorithm matches an independent exhaustive search', () => {
    exhaustiveCheck(new Date('2026-08-15T12:00:00Z'), 47.6062, -122.3321);
  });

  test('SH Sydney Feb 15 (post-solstice) — algorithm matches an independent exhaustive search', () => {
    exhaustiveCheck(new Date('2026-02-15T12:00:00Z'), -33.8688, 151.2093);
  });

  test('NH Seattle May 15 (pre-solstice) — algorithm matches an independent exhaustive search', () => {
    exhaustiveCheck(new Date('2026-05-15T12:00:00Z'), 47.6062, -122.3321);
  });

  test('NH Seattle Nov 15 (pre-solstice, crosses year) — algorithm matches an independent exhaustive search', () => {
    exhaustiveCheck(new Date('2026-11-15T12:00:00Z'), 47.6062, -122.3321);
  });
});

describe('Solstice Twin — supplementary sunrise/sunset', () => {
  test('result carries sunrise and sunset when both source and twin are normal days', () => {
    SM.clearSeasonEventCache();
    const twin = makeTwin();
    const r = twin.find(new Date('2026-08-15T12:00:00Z'), 47.6062, -122.3321, sunCalc);
    assert.ok(r.sunrise instanceof Date);
    assert.ok(r.sunset instanceof Date);
    assert.ok(r.sourceSunrise instanceof Date);
    assert.ok(r.sourceSunset instanceof Date);
    assert.ok(r.sunset > r.sunrise);
    assert.ok(r.sourceSunset > r.sourceSunrise);
  });
});
