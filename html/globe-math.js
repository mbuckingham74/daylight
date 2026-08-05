/**
 * globe-math.js — Pure geographic ↔ 3D vector conversion for the Daylight Globe.
 *
 * UMD module: works in the browser (exposes window.GlobeMath) and in Node
 * (exports the same functions for unit testing), matching solar.js / view.js.
 *
 * ── Coordinate convention (the single source of truth for the globe) ────────
 *
 * The Three.js scene uses a unit sphere centered at the origin with the
 * default SphereGeometry(1, ...) orientation, which in three.js r160 is:
 *
 *   vertex.x = -cos(phi) * sin(theta)
 *   vertex.y =  cos(theta)
 *   vertex.z =  sin(phi) * sin(theta)
 *   uv.x     =  u            (u = ix / widthSegments)
 *   uv.y     =  1 - v        (v = 0 at the north pole)
 *
 * Mapping that geometry to geography (east-positive longitude, matching the
 * rest of the Daylight app, Leaflet, and solar.js):
 *
 *   +Y  = geographic north pole
 *   +X  = (lat 0, lng 0)        — the prime meridian on the equator
 *   +Z  = (lat 0, lng −90)      — the 90°W meridian on the equator
 *   −Z  = (lat 0, lng +90)      — the 90°E meridian on the equator
 *   −X  = (lat 0, lng ±180)     — the antimeridian
 *
 * which yields the explicit transform used throughout this module:
 *
 *   x = cos(lat) * cos(lng)
 *   y = sin(lat)
 *   z = −cos(lat) * sin(lng)
 *
 * so that a standard equirectangular texture (left edge = −180°, top edge =
 * +90° north) maps onto the sphere with NO horizontal flip, NO vertical flip,
 * and the seam at the antimeridian — exactly matching SphereGeometry's UVs
 * (u = (lng + 180) / 360, v = 1 − (lat + 90) / 180).
 *
 * This is a right-handed coordinate system (X × Y = Z). The Sun's object-space
 * direction is the unit vector of the subsolar point: sunlight rays travel
 * toward the sphere from that direction, and the sine of solar altitude at any
 * surface fragment equals dot(surfaceNormal, sunDirection) — the same quantity
 * SolarMath.getSolarSinAltitude() computes analytically (see tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GlobeMath = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var D2R = Math.PI / 180;

  /**
   * Wrap a longitude to [-180, 180) using fully sign-safe modulo.
   * Mirrors SolarMath.wrapLng so the globe and the 2D map agree exactly.
   */
  function wrapLng(lng) {
    return ((lng + 180) % 360 + 360) % 360 - 180;
  }

  /**
   * Convert geographic coordinates to a unit 3D vector on the sphere.
   *
   * @param {number} lat — latitude in degrees [-90, 90] (clamped)
   * @param {number} lng — longitude in degrees, east-positive (wrapped)
   * @param {object} [out] — optional {x, y, z} object to reuse (no allocation)
   * @returns {object|null} unit vector {x, y, z}, or null for non-finite input
   */
  function geoToVector3(lat, lng, out) {
    if (typeof lat !== 'number' || typeof lng !== 'number' ||
        !isFinite(lat) || !isFinite(lng)) {
      return null;
    }

    var latR = Math.max(-90, Math.min(90, lat)) * D2R;
    var lngR = wrapLng(lng) * D2R;
    var cosLat = Math.cos(latR);
    var result = out || { x: 0, y: 0, z: 0 };
    result.x = cosLat * Math.cos(lngR);
    result.y = Math.sin(latR);
    result.z = -cosLat * Math.sin(lngR);
    return result;
  }

  /**
   * Inverse of geoToVector3: convert a unit vector back to { lat, lng }.
   *
   * @param {object} v — {x, y, z}; length does not need to be exactly 1
   * @returns {{ lat: number, lng: number }|null} east-positive lng in [-180, 180),
   *   or null for invalid input
   */
  function vector3ToGeo(v) {
    if (!v || typeof v.x !== 'number' || typeof v.y !== 'number' ||
        typeof v.z !== 'number' || !isFinite(v.x) || !isFinite(v.y) ||
        !isFinite(v.z)) {
      return null;
    }

    var len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (len <= 0 || !isFinite(len)) return null;

    var nx = v.x / len;
    var ny = v.y / len;
    var nz = v.z / len;

    var lat = Math.asin(Math.max(-1, Math.min(1, ny))) / D2R;
    var lng = Math.atan2(-nz, nx) / D2R;
    return { lat: lat, lng: wrapLng(lng) };
  }

  /**
   * The object-space direction the sunlight comes FROM at a given instant.
   * Equal to geoToVector3(subsolar lat, subsolar lng): the Sun is (infinitely)
   * far away in the direction of the subsolar point.
   *
   * @param {number} subLat — subsolar latitude (declination) in degrees
   * @param {number} subLng — subsolar longitude in degrees, east-positive
   * @param {object} [out] — optional {x, y, z} object to reuse
   * @returns {object|null} unit vector {x, y, z}, or null for non-finite input
   */
  function sunDirection(subLat, subLng, out) {
    return geoToVector3(subLat, subLng, out);
  }

  /**
   * Sine of solar altitude at (lat, lng) for a given sun direction vector.
   * Identical to SolarMath.getSolarSinAltitude(date, lat, lng) — this is the
   * same quantity the globe fragment shader computes per fragment as
   * dot(surfaceNormal, sunDirection).
   *
   * @param {object} sunVec — unit vector returned by sunDirection()
   * @param {number} lat — latitude in degrees
   * @param {number} lng — longitude in degrees, east-positive
   * @returns {number|null} sin(altitude) in [-1, 1], or null for invalid input
   */
  function sineSolarAltitude(sunVec, lat, lng) {
    if (!sunVec || typeof sunVec.x !== 'number' || typeof sunVec.y !== 'number' ||
        typeof sunVec.z !== 'number' ||
        typeof lat !== 'number' || typeof lng !== 'number' ||
        !isFinite(sunVec.x) || !isFinite(sunVec.y) || !isFinite(sunVec.z) ||
        !isFinite(lat) || !isFinite(lng)) {
      return null;
    }

    var point = geoToVector3(lat, lng);
    if (!point) return null;
    var value = point.x * sunVec.x + point.y * sunVec.y + point.z * sunVec.z;
    return Math.max(-1, Math.min(1, value));
  }

  /**
   * Check whether a vector is a unit vector (within a small epsilon).
   * Catches non-normalized direction vectors before they break shading.
   *
   * @param {object} v — {x, y, z}
   * @param {number} [epsilon]
   * @returns {boolean}
   */
  function isUnitVector(v, epsilon) {
    if (!v || typeof v.x !== 'number' || typeof v.y !== 'number' ||
        typeof v.z !== 'number' || !isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z)) {
      return false;
    }
    var tolerance = typeof epsilon === 'number' ? epsilon : 1e-9;
    var lengthSq = v.x * v.x + v.y * v.y + v.z * v.z;
    return Math.abs(lengthSq - 1) <= tolerance;
  }

  return {
    D2R,
    wrapLng,
    geoToVector3,
    vector3ToGeo,
    sunDirection,
    sineSolarAltitude,
    isUnitVector
  };
}));
