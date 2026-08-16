/**
 * solar-details.js — "Solar Details" panel controller for the Daylight map.
 *
 * UMD module: works in the browser (exposes window.SolarDetails) and in
 * Node (exports the same functions for unit testing), matching solar.js /
 * view.js / app-scheduler.js.
 *
 * Owns the solar-page tab extracted from app.js (A-01): the Sun/Earth,
 * orientation, selected-point, and global-light readouts plus the three
 * canvas charts (year curve, analemma, day-length curve). Solar math comes
 * from SolarMath; SunCalc-backed helpers (getDayLengthSeconds,
 * getTwilightDurations), formatting functions, DOM access, and the
 * selected-point resolver are injected explicitly through
 * SolarDetails.create(). Pure date/range helpers (getDayOfYear,
 * getYearDayCount, getYearStartAtCurrentClock, getYearSampleDates,
 * mapRange, getTwilightDurations) are exported for unit testing without a
 * browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SolarDetails = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MS_PER_DAY = 86400000;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mapRange(value, inMin, inMax, outMin, outMax) {
    const t = (value - inMin) / (inMax - inMin);
    return outMin + clamp(t, 0, 1) * (outMax - outMin);
  }

  function getYearStartAtCurrentClock(date) {
    return Date.UTC(
      date.getUTCFullYear(),
      0,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    );
  }

  function getDayOfYear(date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 1);
    const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return Math.floor((today - start) / MS_PER_DAY);
  }

  function getYearDayCount(year) {
    return new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
  }

  function getYearSampleDates(date) {
    const year = date.getUTCFullYear();
    const dayCount = getYearDayCount(year);
    const start = getYearStartAtCurrentClock(date);
    return Array.from({ length: dayCount }, (_, index) => new Date(start + index * MS_PER_DAY));
  }

  // Twilight durations (civil / nautical / astronomical) for a location,
  // computed from SunCalc's per-angle transition times. Returns 0 seconds
  // for transitions that do not exist at that latitude.
  function getTwilightDurations(date, lat, lng, sunCalc, isValidDate) {
    const times = sunCalc.getTimes(date, lat, lng);
    const diffSeconds = (later, earlier) => {
      if (!isValidDate(later) || !isValidDate(earlier) || later <= earlier) return 0;
      return (later - earlier) / 1000;
    };
    const civil = diffSeconds(times.sunrise, times.dawn) + diffSeconds(times.dusk, times.sunset);
    const nautical = diffSeconds(times.dawn, times.nauticalDawn) + diffSeconds(times.nauticalDusk, times.dusk);
    const astronomical = diffSeconds(times.nauticalDawn, times.nightEnd) + diffSeconds(times.night, times.nauticalDusk);

    return {
      civil,
      nautical,
      astronomical,
      hasTransitions: civil + nautical + astronomical > 0
    };
  }

  function create(deps) {
    const {
      getEl, sun, sunCalc, format, setStatValue, setLightStats,
      getDayLengthSeconds, getTarget, getDevicePixelRatio
    } = deps;
    const {
      getSunEquatorial, getSubsolarPoint, getSolarOrbitStats, getSolarPosition,
      getNextSeasonEvent, getGlobalLightFractions, getEquationOfTimeMinutes,
      getEarthSunDistanceAu, wrapLng, D2R, clamp, isValidDate, normalizeDegrees
    } = sun;
    const {
      formatMillions, formatLightTime, formatDegrees, formatSignedDegrees,
      formatRightAscension, formatSiderealTime, formatSignedDuration,
      formatCoord, formatDuration, formatPercent, formatSeasonCountdown,
      formatChartClock
    } = format;

    let lastChartSignature = '';

    function getCompassDirection(degrees) {
      if (!isFinite(degrees)) return '';
      const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      return directions[Math.round(normalizeDegrees(degrees) / 45) % directions.length];
    }

    function updateSolarDetails(date) {
    const solarPage = getEl('solar-page');
    if (!solarPage || solarPage.hidden) return;

    const sun = getSunEquatorial(date);
    const subsolar = getSubsolarPoint(date);
    const antisolar = { lat: -subsolar.lat, lng: wrapLng(subsolar.lng + 180) };
    const orbit = getSolarOrbitStats(date);
    const target = getTarget();
    const position = getSolarPosition(date, target.lat, target.lng);
    const dayLength = getDayLengthSeconds(date, target.lat, target.lng);
    const yesterdayLength = getDayLengthSeconds(new Date(date.getTime() - MS_PER_DAY), target.lat, target.lng);
    const tomorrowLength = getDayLengthSeconds(new Date(date.getTime() + MS_PER_DAY), target.lat, target.lng);
    const twilight = getTwilightDurations(date, target.lat, target.lng, sunCalc, isValidDate);
    const nextSeason = getNextSeasonEvent(date);
    const globalLight = getGlobalLightFractions();
    const shadowMultiplier = position.altitude > 0 ? 1 / Math.tan(position.altitude * D2R) : null;
    const noonAltitude = 90 - Math.abs(target.lat - sun.delta);
    const dailyChangeText = `${orbit.dailyChangeKm >= 0 ? '+' : '-'}${Math.abs(orbit.dailyChangeKm / 1000).toFixed(0)}k km/day`;

    setStatValue('solar-distance-au', `${orbit.distanceAu.toFixed(6)} AU`);
    setStatValue('solar-distance-km', `${formatMillions(orbit.distanceKm)} km / ${formatMillions(orbit.distanceMiles)} mi`);
    setStatValue('solar-light-time', formatLightTime(orbit.lightSeconds));
    setStatValue('solar-orbital-speed', `${orbit.orbitalSpeed.toFixed(2)} km/s`);
    setStatValue('solar-apparent-size', `${formatDegrees(orbit.apparentDiameterDeg, 3)} / ${(orbit.apparentDiameterDeg * 60).toFixed(2)}'`);
    setStatValue('solar-energy', `${(orbit.energyRatio * 100).toFixed(2)}% / ${Math.round(orbit.solarConstant)} W/m2`);
    getEl('solar-distance-trend').textContent = `${orbit.trend} (${dailyChangeText})`;

    setStatValue('earth-axial-tilt', formatDegrees(sun.obliquity, 4));
    setStatValue('solar-declination', formatSignedDegrees(sun.delta, 3));
    setStatValue('solar-right-ascension', formatRightAscension(sun.alpha));
    setStatValue('solar-gmst', formatSiderealTime(sun.gmstDeg));
    setStatValue('equation-of-time', formatSignedDuration(getEquationOfTimeMinutes(date) * 60));
    setStatValue('antisolar-point', formatCoord(antisolar.lat, antisolar.lng));
    getEl('next-season-event').textContent = formatSeasonCountdown(nextSeason, date);

    getEl('detail-target-label').textContent = target.label || 'Selected point';
    setStatValue('detail-target-coords', formatCoord(target.lat, target.lng));
    setStatValue('local-sun-altitude', formatSignedDegrees(position.altitude, 2));
    setStatValue('local-sun-azimuth', `${formatDegrees(position.azimuth, 1)} ${getCompassDirection(position.azimuth)}`);
    setStatValue('local-sun-zenith', formatDegrees(position.zenith, 2));
    setStatValue('local-shadow-length', shadowMultiplier ? `${shadowMultiplier >= 99 ? '>99' : shadowMultiplier.toFixed(shadowMultiplier >= 10 ? 0 : 1)}x` : 'No direct Sun');
    setLightStats('local-light-state', 'local-daylight-remaining', date, target.lat, target.lng);
    setStatValue('local-noon-altitude', formatSignedDegrees(noonAltitude, 2));
    setStatValue('local-detail-daylength', formatDuration(dayLength));
    setStatValue('local-daylength-change', formatSignedDuration((tomorrowLength - yesterdayLength) / 2));
    setStatValue('local-civil-twilight', twilight.hasTransitions ? formatDuration(twilight.civil) : 'No transitions');
    setStatValue('local-deep-twilight', twilight.hasTransitions
      ? `${formatDuration(twilight.nautical)} + ${formatDuration(twilight.astronomical)}`
      : 'No transitions');

    setGlobalLightRow('global-daylight', 'global-daylight-bar', globalLight.daylight);
    setGlobalLightRow('global-civil', 'global-civil-bar', globalLight.civil);
    setGlobalLightRow('global-nautical', 'global-nautical-bar', globalLight.nautical);
    setGlobalLightRow('global-astro', 'global-astro-bar', globalLight.astronomical);
    setGlobalLightRow('global-night', 'global-night-bar', globalLight.night);
    getEl('global-lit-summary').textContent = `Sun up or twilight ${formatPercent(1 - globalLight.night)}`;

    drawSolarCharts(date, target);
  }

  function setGlobalLightRow(valueId, barId, fraction) {
    setStatValue(valueId, formatPercent(fraction));
    getEl(barId).style.width = formatPercent(fraction, 3);
  }

  function drawSolarCharts(date, target) {
    const solarPage = getEl('solar-page');
    const panelWidth = Math.round(solarPage.getBoundingClientRect().width);
    const signature = [
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      target.lat.toFixed(2),
      target.lng.toFixed(2),
      target.label || '',
      panelWidth
    ].join('|');

    if (signature === lastChartSignature) return;
    lastChartSignature = signature;

    drawSolarYearChart(date);
    drawAnalemmaChart(date);
    drawDayLengthChart(date, target);
  }

  function setupCanvas(id) {
    const canvas = getEl(id);
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    if (width < 40 || height < 40) return null;

    const ratio = getDevicePixelRatio();
    const targetWidth = Math.round(width * ratio);
    const targetHeight = Math.round(height * ratio);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  }

  function drawChartGrid(ctx, width, height, padding) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (height - padding.top - padding.bottom) * i / 4;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }
    for (let i = 0; i <= 4; i++) {
      const x = padding.left + (width - padding.left - padding.right) * i / 4;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();
    }
    ctx.restore();
  }

  function plotLine(ctx, points, color, lineWidth = 2) {
    if (points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function plotCurrentMarker(ctx, x, y, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#101525';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawLegend(ctx, entries, x, y) {
    ctx.save();
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    let cursor = x;
    entries.forEach(entry => {
      ctx.fillStyle = entry.color;
      ctx.fillRect(cursor, y - 3, 10, 6);
      cursor += 14;
      ctx.fillStyle = '#cbd1df';
      ctx.fillText(entry.label, cursor, y);
      cursor += ctx.measureText(entry.label).width + 12;
    });
    ctx.restore();
  }

  function mapRange(value, inMin, inMax, outMin, outMax) {
    const t = (value - inMin) / (inMax - inMin);
    return outMin + clamp(t, 0, 1) * (outMax - outMin);
  }

  function getYearStartAtCurrentClock(date) {
    return Date.UTC(
      date.getUTCFullYear(),
      0,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    );
  }

  function getDayOfYear(date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 1);
    const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return Math.floor((today - start) / MS_PER_DAY);
  }

  function getYearDayCount(year) {
    return new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
  }

  function getYearSampleDates(date) {
    const year = date.getUTCFullYear();
    const dayCount = getYearDayCount(year);
    const start = getYearStartAtCurrentClock(date);
    return Array.from({ length: dayCount }, (_, index) => new Date(start + index * MS_PER_DAY));
  }

  function drawSolarYearChart(date) {
    const state = setupCanvas('solar-year-chart');
    if (!state) return;

    const { ctx, width, height } = state;
    const padding = { left: 36, right: 12, top: 16, bottom: 20 };
    const dates = getYearSampleDates(date);
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const maxIndex = dates.length - 1;
    const declinationPoints = [];
    const distancePoints = [];

    drawChartGrid(ctx, width, height, padding);

    dates.forEach((sampleDate, index) => {
      const x = padding.left + plotWidth * index / maxIndex;
      const declination = getSunEquatorial(sampleDate).delta;
      const distanceAu = getEarthSunDistanceAu(sampleDate);
      declinationPoints.push({
        x,
        y: mapRange(declination, -24, 24, padding.top + plotHeight, padding.top)
      });
      distancePoints.push({
        x,
        y: mapRange(distanceAu, 0.983, 1.017, padding.top + plotHeight, padding.top)
      });
    });

    plotLine(ctx, declinationPoints, '#ffd85c', 2.2);
    plotLine(ctx, distancePoints, '#63d8ff', 1.8);
    const currentIndex = clamp(getDayOfYear(date), 0, maxIndex);
    const currentX = padding.left + plotWidth * currentIndex / maxIndex;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(currentX, padding.top);
    ctx.lineTo(currentX, height - padding.bottom);
    ctx.stroke();
    ctx.restore();
    plotCurrentMarker(ctx, declinationPoints[currentIndex].x, declinationPoints[currentIndex].y, '#ffd85c');
    drawLegend(ctx, [
      { label: 'declination', color: '#ffd85c' },
      { label: 'distance', color: '#63d8ff' }
    ], padding.left, height - 8);

    const currentDelta = getSunEquatorial(date).delta;
    const currentDist = getEarthSunDistanceAu(date);
    const descEl = getEl('solar-year-chart-desc');
    if (descEl) {
      descEl.textContent = `Declination and distance curves for ${date.getUTCFullYear()}. Current declination: ${formatSignedDegrees(currentDelta, 3)}. Earth-Sun distance: ${currentDist.toFixed(5)} AU. Day ${getDayOfYear(date) + 1} of ${dates.length}.`;
    }
  }

  function drawAnalemmaChart(date) {
    const state = setupCanvas('analemma-chart');
    if (!state) return;

    const { ctx, width, height } = state;
    const padding = { left: 34, right: 16, top: 16, bottom: 18 };
    const dates = getYearSampleDates(date);
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const points = dates.map(sampleDate => {
      const eot = getEquationOfTimeMinutes(sampleDate);
      const declination = getSunEquatorial(sampleDate).delta;
      return {
        x: mapRange(eot, -16, 16, padding.left, padding.left + plotWidth),
        y: mapRange(declination, -24, 24, padding.top + plotHeight, padding.top)
      };
    });
    const currentPoint = {
      x: mapRange(getEquationOfTimeMinutes(date), -16, 16, padding.left, padding.left + plotWidth),
      y: mapRange(getSunEquatorial(date).delta, -24, 24, padding.top + plotHeight, padding.top)
    };

    drawChartGrid(ctx, width, height, padding);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.beginPath();
    ctx.moveTo(mapRange(0, -16, 16, padding.left, padding.left + plotWidth), padding.top);
    ctx.lineTo(mapRange(0, -16, 16, padding.left, padding.left + plotWidth), height - padding.bottom);
    ctx.moveTo(padding.left, mapRange(0, -24, 24, padding.top + plotHeight, padding.top));
    ctx.lineTo(width - padding.right, mapRange(0, -24, 24, padding.top + plotHeight, padding.top));
    ctx.stroke();
    ctx.restore();
    plotLine(ctx, points, '#ffd85c', 2);
    plotCurrentMarker(ctx, currentPoint.x, currentPoint.y, '#63d8ff');
    getEl('analemma-clock-label').textContent = formatChartClock(date);

    const currentEot = getEquationOfTimeMinutes(date);
    const currentDecl = getSunEquatorial(date).delta;
    const descEl = getEl('analemma-chart-desc');
    if (descEl) {
      descEl.textContent = `Analemma for ${formatChartClock(date)}. Equation of time: ${currentEot >= 0 ? '+' : ''}${currentEot.toFixed(1)} minutes. Solar declination: ${formatSignedDegrees(currentDecl, 3)}.`;
    }
  }

  function drawDayLengthChart(date, target) {
    const state = setupCanvas('daylength-chart');
    if (!state) return;

    const { ctx, width, height } = state;
    const padding = { left: 34, right: 12, top: 16, bottom: 18 };
    const dates = getYearSampleDates(date);
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const maxIndex = dates.length - 1;
    const points = dates.map((sampleDate, index) => {
      const hours = getDayLengthSeconds(sampleDate, target.lat, target.lng) / 3600;
      return {
        x: padding.left + plotWidth * index / maxIndex,
        y: mapRange(hours, 0, 24, padding.top + plotHeight, padding.top)
      };
    });
    const currentIndex = clamp(getDayOfYear(date), 0, maxIndex);

    drawChartGrid(ctx, width, height, padding);
    plotLine(ctx, points, '#7ee3a6', 2.2);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(points[currentIndex].x, padding.top);
    ctx.lineTo(points[currentIndex].x, height - padding.bottom);
    ctx.stroke();
    ctx.restore();
    plotCurrentMarker(ctx, points[currentIndex].x, points[currentIndex].y, '#7ee3a6');
    getEl('daylength-chart-label').textContent = target.label || 'Selected point';

    const currentHours = getDayLengthSeconds(date, target.lat, target.lng) / 3600;
    const descEl = getEl('daylength-chart-desc');
    if (descEl) {
      descEl.textContent = `Day length curve for ${target.label || 'selected point'} (${formatCoord(target.lat, target.lng)}). Current day length: ${formatDuration(currentHours * 3600)}. Day ${getDayOfYear(date) + 1} of ${dates.length}.`;
    }
  }
    return {
      update: updateSolarDetails,
      invalidate: function () {
        lastChartSignature = '';
      }
    };
  }

  return {
    create,
    getDayOfYear,
    getYearDayCount,
    getYearStartAtCurrentClock,
    getYearSampleDates,
    mapRange,
    getTwilightDurations
  };
}));
