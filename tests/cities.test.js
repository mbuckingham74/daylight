const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const DaylightCities = require('../html/cities.js');

// ── Frozen characterization ───────────────────────────────────────────
// The marker lists were captured from the pre-A-02 duplicated datasets
// (html/app.js marker array, html/browser-location.js nearest-city array);
// they freeze the exact marker membership/order/metadata that A-02
// preserved. LOCATION_NAMES additionally includes the 39 location-only
// cities added by the bounded coverage expansion (appended in canonical
// order after the original 75).

const MARKER_LABELS = ["London", "New York", "Tokyo", "Sydney", "São Paulo", "Cairo", "Mumbai", "Singapore", "Los Angeles", "Paris", "Moscow", "Beijing", "Johannesburg", "Dubai", "Bangkok"];

const MARKER_LATLNG = [[51.5074, -0.1278], [40.7128, -74.006], [35.6762, 139.6503], [-33.8688, 151.2093], [-23.5505, -46.6333], [30.0444, 31.2357], [19.076, 72.8777], [1.3521, 103.8198], [34.0522, -118.2437], [48.8566, 2.3522], [55.7558, 37.6173], [39.9042, 116.4074], [-26.2041, 28.0473], [25.2048, 55.2708], [13.7563, 100.5018]];

const MARKER_TZ = ["Europe/London", "America/New_York", "Asia/Tokyo", "Australia/Sydney", "America/Sao_Paulo", "Africa/Cairo", "Asia/Kolkata", "Asia/Singapore", "America/Los_Angeles", "Europe/Paris", "Europe/Moscow", "Asia/Shanghai", "Africa/Johannesburg", "Asia/Dubai", "Asia/Bangkok"];

const LOCATION_NAMES = ["Seattle, WA USA", "Portland, OR USA", "Vancouver, BC Canada", "San Francisco, CA USA", "Los Angeles, CA USA", "San Diego, CA USA", "Las Vegas, NV USA", "Phoenix, AZ USA", "Salt Lake City, UT USA", "Denver, CO USA", "Dallas, TX USA", "Austin, TX USA", "Houston, TX USA", "Kansas City, MO USA", "Minneapolis, MN USA", "Chicago, IL USA", "Detroit, MI USA", "St. Louis, MO USA", "Nashville, TN USA", "Atlanta, GA USA", "Charlotte, NC USA", "Washington, DC USA", "Philadelphia, PA USA", "New York, NY USA", "Boston, MA USA", "Miami, FL USA", "Toronto, ON Canada", "Montreal, QC Canada", "Mexico City, Mexico", "Bogota, Colombia", "Lima, Peru", "Santiago, Chile", "Buenos Aires, Argentina", "Sao Paulo, Brazil", "Rio de Janeiro, Brazil", "London, UK", "Dublin, Ireland", "Paris, France", "Madrid, Spain", "Lisbon, Portugal", "Amsterdam, Netherlands", "Brussels, Belgium", "Berlin, Germany", "Zurich, Switzerland", "Vienna, Austria", "Rome, Italy", "Prague, Czechia", "Warsaw, Poland", "Stockholm, Sweden", "Oslo, Norway", "Helsinki, Finland", "Moscow, Russia", "Istanbul, Turkey", "Cairo, Egypt", "Lagos, Nigeria", "Nairobi, Kenya", "Johannesburg, South Africa", "Dubai, UAE", "Riyadh, Saudi Arabia", "Delhi, India", "Mumbai, India", "Bengaluru, India", "Bangkok, Thailand", "Singapore", "Kuala Lumpur, Malaysia", "Jakarta, Indonesia", "Hong Kong", "Shanghai, China", "Beijing, China", "Seoul, South Korea", "Tokyo, Japan", "Manila, Philippines", "Sydney, Australia", "Melbourne, Australia", "Auckland, New Zealand", "Forks, WA USA", "Bellingham, WA USA", "Spokane, WA USA", "Olympia, WA USA", "Astoria, OR USA", "Eugene, OR USA", "Bend, OR USA", "Medford, OR USA", "Redding, CA USA", "Eureka, CA USA", "Sacramento, CA USA", "San Jose, CA USA", "Fresno, CA USA", "Boise, ID USA", "Missoula, MT USA", "Billings, MT USA", "Cheyenne, WY USA", "Casper, WY USA", "Grand Junction, CO USA", "Reno, NV USA", "St. George, UT USA", "Flagstaff, AZ USA", "Tucson, AZ USA", "Albuquerque, NM USA", "Santa Fe, NM USA", "El Paso, TX USA", "Amarillo, TX USA", "Oklahoma City, OK USA", "Omaha, NE USA", "Anchorage, AK USA", "Fairbanks, AK USA", "Juneau, AK USA", "Honolulu, HI USA", "Kelowna, BC Canada", "Prince George, BC Canada", "Calgary, AB Canada", "Edmonton, AB Canada", "Saskatoon, SK Canada", "Winnipeg, MB Canada", "Port Angeles, WA USA", "Pullman, WA USA"];

const normName = name => name.split(',')[0].trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

describe('cities — canonical uniqueness', () => {
  test('no duplicate canonical records by normalized name + coordinates', () => {
    const seen = new Set();
    for (const city of DaylightCities.all) {
      const key = `${normName(city.name)}|${city.lat}|${city.lng}`;
      assert.ok(!seen.has(key), `duplicate canonical record for ${city.name}`);
      seen.add(key);
    }
  });

  test('no two canonical records share exact coordinates', () => {
    for (let i = 0; i < DaylightCities.all.length; i++) {
      for (let j = i + 1; j < DaylightCities.all.length; j++) {
        const a = DaylightCities.all[i];
        const b = DaylightCities.all[j];
        assert.ok(
          a.lat !== b.lat || a.lng !== b.lng,
          `duplicate coordinates for ${a.name} and ${b.name}`
        );
      }
    }
  });
});

describe('cities — coverage counts (accidental add/remove guard)', () => {
  test('total counts are frozen', () => {
    assert.equal(DaylightCities.all.length, 116);
    assert.equal(DaylightCities.markerCities.length, 15);
    assert.equal(DaylightCities.locationCities.length, 116);
    const overlap = DaylightCities.markerCities.filter(m =>
      DaylightCities.locationCities.includes(m)
    );
    assert.equal(overlap.length, 15);
  });

  test('the 99 location-only cities stay non-marker with no marker metadata', () => {
    const nonMarkers = DaylightCities.all.filter(c => !c.showMarker);
    assert.equal(nonMarkers.length, 101);
    for (const city of nonMarkers) {
      assert.equal(city.markerName, undefined, `${city.name} must not carry markerName`);
      assert.equal(city.markerOrder, undefined, `${city.name} must not carry markerOrder`);
      assert.equal(city.timeZone, undefined, `${city.name} must not carry timeZone`);
    }
  });

  test('every marker city also participates in nearest-city lookup', () => {
    for (const marker of DaylightCities.markerCities) {
      assert.ok(DaylightCities.locationCities.includes(marker), `${marker.name} missing from locationCities`);
    }
  });
});

describe('cities — marker subset unchanged', () => {
  test('the marker list has the exact pre-A-02 labels in order', () => {
    const labels = DaylightCities.markerCities.map(c => c.markerName || c.name);
    assert.deepEqual(labels, MARKER_LABELS);
  });

  test('the marker list has the exact pre-A-02 coordinates in order', () => {
    const coords = DaylightCities.markerCities.map(c => [c.lat, c.lng]);
    assert.deepEqual(coords, MARKER_LATLNG);
  });

  test('the marker list has the exact pre-A-02 timezones in order', () => {
    const tz = DaylightCities.markerCities.map(c => c.timeZone);
    assert.deepEqual(tz, MARKER_TZ);
  });

  test('markerOrder is a clean 1..15 sequence', () => {
    assert.deepEqual(
      DaylightCities.markerCities.map(c => c.markerOrder),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    );
  });
});

describe('cities — location subset unchanged', () => {
  test('the location list has the exact pre-A-02 names in order', () => {
    assert.deepEqual(
      DaylightCities.locationCities.map(c => c.name),
      LOCATION_NAMES
    );
  });
});

describe('cities — shared-record identity (one canonical record per city)', () => {
  test('marker and location roles reference the same record objects', () => {
    const locationByName = new Map(
      DaylightCities.locationCities.map(c => [normName(c.name), c])
    );
    for (const marker of DaylightCities.markerCities) {
      const location = locationByName.get(normName(marker.name));
      assert.ok(location, `no location record for ${marker.name}`);
      assert.equal(marker, location, `${marker.name} exists as two copied records`);
    }
  });

  test('marker cities carry their full name for the location role', () => {
    const locationByName = new Map(
      DaylightCities.locationCities.map(c => [normName(c.name), c])
    );
    for (const marker of DaylightCities.markerCities) {
      assert.equal(locationByName.get(normName(marker.name)).name, marker.name);
    }
  });
});

describe('cities — metadata integrity', () => {
  test('every record has a valid name, latitude, and longitude', () => {
    for (const city of DaylightCities.all) {
      assert.ok(typeof city.name === 'string' && city.name.length > 0, `bad name: ${city.name}`);
      assert.ok(city.lat >= -90 && city.lat <= 90, `bad lat for ${city.name}: ${city.lat}`);
      assert.ok(city.lng >= -180 && city.lng <= 180, `bad lng for ${city.name}: ${city.lng}`);
    }
  });

  test('every marker city has a valid timezone; no location-only city has one', () => {
    for (const city of DaylightCities.all) {
      if (city.showMarker) {
        assert.ok(
          typeof city.timeZone === 'string' && city.timeZone.includes('/'),
          `missing/invalid timezone for ${city.name}`
        );
      } else {
        assert.equal(city.timeZone, undefined, `unexpected timezone on ${city.name}`);
      }
    }
  });

  test('markerName is present exactly where the two names differ', () => {
    for (const city of DaylightCities.all) {
      if (city.markerName !== undefined) {
        assert.ok(city.showMarker, `markerName on non-marker city ${city.name}`);
        assert.notEqual(city.markerName, city.name);
      }
    }
    assert.equal(DaylightCities.markerCities.filter(c => c.markerName !== undefined).length, 14);
  });
});
