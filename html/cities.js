/**
 * cities.js — Canonical city data for the Daylight map (A-02).
 *
 * UMD module: works in the browser (exposes window.DaylightCities) and in
 * Node (exports the same functions for unit testing), matching solar.js /
 * view.js / app-scheduler.js.
 *
 * Single source of truth for every city the application knows. Previously
 * the visible marker list (html/app.js) and the nearest-city lookup list
 * (html/browser-location.js) maintained separate, overlapping copies of
 * the same cities — a drift risk (A-02). There is now exactly one canonical
 * record per city; the two product roles are explicit fields on that record:
 *
 *   - showMarker / markerOrder — this city renders as a visible Leaflet
 *     marker (markerOrder preserves the pre-A-02 marker rendering order).
 *   - name (plus optional markerName) — the full name is the nearest-city /
 *     local-time label; markerName is the shorter label shown on the map
 *     marker where the two differ.
 *   - timeZone — present on the marker cities; the nearest-city role never
 *     used dataset timezones (it uses the browser's Intl timezone).
 *
 * Every canonical city participates in nearest-city lookup (locationCities
 * === all). No city was added, removed, or moved in A-02.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DaylightCities = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const cities = [
    { name: "Seattle, WA USA", lat: 47.6062, lng: -122.3321, showMarker: false, },
    { name: "Portland, OR USA", lat: 45.5152, lng: -122.6784, showMarker: false, },
    { name: "Vancouver, BC Canada", lat: 49.2827, lng: -123.1207, showMarker: false, },
    { name: "San Francisco, CA USA", lat: 37.7749, lng: -122.4194, showMarker: false, },
    { name: "Los Angeles, CA USA", lat: 34.0522, lng: -118.2437, markerName: "Los Angeles", timeZone: "America/Los_Angeles", showMarker: true, markerOrder: 9, },
    { name: "San Diego, CA USA", lat: 32.7157, lng: -117.1611, showMarker: false, },
    { name: "Las Vegas, NV USA", lat: 36.1699, lng: -115.1398, showMarker: false, },
    { name: "Phoenix, AZ USA", lat: 33.4484, lng: -112.074, showMarker: false, },
    { name: "Salt Lake City, UT USA", lat: 40.7608, lng: -111.891, showMarker: false, },
    { name: "Denver, CO USA", lat: 39.7392, lng: -104.9903, showMarker: false, },
    { name: "Dallas, TX USA", lat: 32.7767, lng: -96.797, showMarker: false, },
    { name: "Austin, TX USA", lat: 30.2672, lng: -97.7431, showMarker: false, },
    { name: "Houston, TX USA", lat: 29.7604, lng: -95.3698, showMarker: false, },
    { name: "Kansas City, MO USA", lat: 39.0997, lng: -94.5786, showMarker: false, },
    { name: "Minneapolis, MN USA", lat: 44.9778, lng: -93.265, showMarker: false, },
    { name: "Chicago, IL USA", lat: 41.8781, lng: -87.6298, showMarker: false, },
    { name: "Detroit, MI USA", lat: 42.3314, lng: -83.0458, showMarker: false, },
    { name: "St. Louis, MO USA", lat: 38.627, lng: -90.1994, showMarker: false, },
    { name: "Nashville, TN USA", lat: 36.1627, lng: -86.7816, showMarker: false, },
    { name: "Atlanta, GA USA", lat: 33.749, lng: -84.388, showMarker: false, },
    { name: "Charlotte, NC USA", lat: 35.2271, lng: -80.8431, showMarker: false, },
    { name: "Washington, DC USA", lat: 38.9072, lng: -77.0369, showMarker: false, },
    { name: "Philadelphia, PA USA", lat: 39.9526, lng: -75.1652, showMarker: false, },
    { name: "New York, NY USA", lat: 40.7128, lng: -74.006, markerName: "New York", timeZone: "America/New_York", showMarker: true, markerOrder: 2, },
    { name: "Boston, MA USA", lat: 42.3601, lng: -71.0589, showMarker: false, },
    { name: "Miami, FL USA", lat: 25.7617, lng: -80.1918, showMarker: false, },
    { name: "Toronto, ON Canada", lat: 43.6532, lng: -79.3832, showMarker: false, },
    { name: "Montreal, QC Canada", lat: 45.5017, lng: -73.5673, showMarker: false, },
    { name: "Mexico City, Mexico", lat: 19.4326, lng: -99.1332, showMarker: false, },
    { name: "Bogota, Colombia", lat: 4.711, lng: -74.0721, showMarker: false, },
    { name: "Lima, Peru", lat: -12.0464, lng: -77.0428, showMarker: false, },
    { name: "Santiago, Chile", lat: -33.4489, lng: -70.6693, showMarker: false, },
    { name: "Buenos Aires, Argentina", lat: -34.6037, lng: -58.3816, showMarker: false, },
    { name: "Sao Paulo, Brazil", lat: -23.5505, lng: -46.6333, markerName: "São Paulo", timeZone: "America/Sao_Paulo", showMarker: true, markerOrder: 5, },
    { name: "Rio de Janeiro, Brazil", lat: -22.9068, lng: -43.1729, showMarker: false, },
    { name: "London, UK", lat: 51.5074, lng: -0.1278, markerName: "London", timeZone: "Europe/London", showMarker: true, markerOrder: 1, },
    { name: "Dublin, Ireland", lat: 53.3498, lng: -6.2603, showMarker: false, },
    { name: "Paris, France", lat: 48.8566, lng: 2.3522, markerName: "Paris", timeZone: "Europe/Paris", showMarker: true, markerOrder: 10, },
    { name: "Madrid, Spain", lat: 40.4168, lng: -3.7038, showMarker: false, },
    { name: "Lisbon, Portugal", lat: 38.7223, lng: -9.1393, showMarker: false, },
    { name: "Amsterdam, Netherlands", lat: 52.3676, lng: 4.9041, showMarker: false, },
    { name: "Brussels, Belgium", lat: 50.8503, lng: 4.3517, showMarker: false, },
    { name: "Berlin, Germany", lat: 52.52, lng: 13.405, showMarker: false, },
    { name: "Zurich, Switzerland", lat: 47.3769, lng: 8.5417, showMarker: false, },
    { name: "Vienna, Austria", lat: 48.2082, lng: 16.3738, showMarker: false, },
    { name: "Rome, Italy", lat: 41.9028, lng: 12.4964, showMarker: false, },
    { name: "Prague, Czechia", lat: 50.0755, lng: 14.4378, showMarker: false, },
    { name: "Warsaw, Poland", lat: 52.2297, lng: 21.0122, showMarker: false, },
    { name: "Stockholm, Sweden", lat: 59.3293, lng: 18.0686, showMarker: false, },
    { name: "Oslo, Norway", lat: 59.9139, lng: 10.7522, showMarker: false, },
    { name: "Helsinki, Finland", lat: 60.1699, lng: 24.9384, showMarker: false, },
    { name: "Moscow, Russia", lat: 55.7558, lng: 37.6173, markerName: "Moscow", timeZone: "Europe/Moscow", showMarker: true, markerOrder: 11, },
    { name: "Istanbul, Turkey", lat: 41.0082, lng: 28.9784, showMarker: false, },
    { name: "Cairo, Egypt", lat: 30.0444, lng: 31.2357, markerName: "Cairo", timeZone: "Africa/Cairo", showMarker: true, markerOrder: 6, },
    { name: "Lagos, Nigeria", lat: 6.5244, lng: 3.3792, showMarker: false, },
    { name: "Nairobi, Kenya", lat: -1.2921, lng: 36.8219, showMarker: false, },
    { name: "Johannesburg, South Africa", lat: -26.2041, lng: 28.0473, markerName: "Johannesburg", timeZone: "Africa/Johannesburg", showMarker: true, markerOrder: 13, },
    { name: "Dubai, UAE", lat: 25.2048, lng: 55.2708, markerName: "Dubai", timeZone: "Asia/Dubai", showMarker: true, markerOrder: 14, },
    { name: "Riyadh, Saudi Arabia", lat: 24.7136, lng: 46.6753, showMarker: false, },
    { name: "Delhi, India", lat: 28.6139, lng: 77.209, showMarker: false, },
    { name: "Mumbai, India", lat: 19.076, lng: 72.8777, markerName: "Mumbai", timeZone: "Asia/Kolkata", showMarker: true, markerOrder: 7, },
    { name: "Bengaluru, India", lat: 12.9716, lng: 77.5946, showMarker: false, },
    { name: "Bangkok, Thailand", lat: 13.7563, lng: 100.5018, markerName: "Bangkok", timeZone: "Asia/Bangkok", showMarker: true, markerOrder: 15, },
    { name: "Singapore", lat: 1.3521, lng: 103.8198, timeZone: "Asia/Singapore", showMarker: true, markerOrder: 8, },
    { name: "Kuala Lumpur, Malaysia", lat: 3.139, lng: 101.6869, showMarker: false, },
    { name: "Jakarta, Indonesia", lat: -6.2088, lng: 106.8456, showMarker: false, },
    { name: "Hong Kong", lat: 22.3193, lng: 114.1694, showMarker: false, },
    { name: "Shanghai, China", lat: 31.2304, lng: 121.4737, showMarker: false, },
    { name: "Beijing, China", lat: 39.9042, lng: 116.4074, markerName: "Beijing", timeZone: "Asia/Shanghai", showMarker: true, markerOrder: 12, },
    { name: "Seoul, South Korea", lat: 37.5665, lng: 126.978, showMarker: false, },
    { name: "Tokyo, Japan", lat: 35.6762, lng: 139.6503, markerName: "Tokyo", timeZone: "Asia/Tokyo", showMarker: true, markerOrder: 3, },
    { name: "Manila, Philippines", lat: 14.5995, lng: 120.9842, showMarker: false, },
    { name: "Sydney, Australia", lat: -33.8688, lng: 151.2093, markerName: "Sydney", timeZone: "Australia/Sydney", showMarker: true, markerOrder: 4, },
    { name: "Melbourne, Australia", lat: -37.8136, lng: 144.9631, showMarker: false, },
    { name: "Auckland, New Zealand", lat: -36.8509, lng: 174.7645, showMarker: false, },    { name: "Forks, WA USA", lat: 47.9503, lng: -124.3856, showMarker: false, },
    { name: "Bellingham, WA USA", lat: 48.75, lng: -122.4833, showMarker: false, },
    { name: "Spokane, WA USA", lat: 47.6589, lng: -117.425, showMarker: false, },
    { name: "Olympia, WA USA", lat: 47.0378, lng: -122.9008, showMarker: false, },
    { name: "Astoria, OR USA", lat: 46.1883, lng: -123.81, showMarker: false, },
    { name: "Eugene, OR USA", lat: 44.0564, lng: -123.1175, showMarker: false, },
    { name: "Bend, OR USA", lat: 44.0581, lng: -121.3153, showMarker: false, },
    { name: "Medford, OR USA", lat: 42.3556, lng: -122.8786, showMarker: false, },
    { name: "Redding, CA USA", lat: 40.5864, lng: -122.3917, showMarker: false, },
    { name: "Eureka, CA USA", lat: 40.8019, lng: -124.1636, showMarker: false, },
    { name: "Sacramento, CA USA", lat: 38.5817, lng: -121.4944, showMarker: false, },
    { name: "San Jose, CA USA", lat: 37.3361, lng: -121.8906, showMarker: false, },
    { name: "Fresno, CA USA", lat: 36.75, lng: -119.7667, showMarker: false, },
    { name: "Boise, ID USA", lat: 43.6158, lng: -116.2017, showMarker: false, },
    { name: "Missoula, MT USA", lat: 46.8744, lng: -114.0261, showMarker: false, },
    { name: "Billings, MT USA", lat: 45.7836, lng: -108.5061, showMarker: false, },
    { name: "Cheyenne, WY USA", lat: 41.14, lng: -104.8203, showMarker: false, },
    { name: "Casper, WY USA", lat: 42.85, lng: -106.325, showMarker: false, },
    { name: "Grand Junction, CO USA", lat: 39.0878, lng: -108.5681, showMarker: false, },
    { name: "Reno, NV USA", lat: 39.5261, lng: -119.8125, showMarker: false, },
    { name: "St. George, UT USA", lat: 37.1025, lng: -113.5771, showMarker: false, },
    { name: "Flagstaff, AZ USA", lat: 35.1806, lng: -111.62, showMarker: false, },
    { name: "Tucson, AZ USA", lat: 32.2217, lng: -110.9264, showMarker: false, },
    { name: "Albuquerque, NM USA", lat: 35.0844, lng: -106.6503, showMarker: false, },
    { name: "Santa Fe, NM USA", lat: 35.6672, lng: -105.9644, showMarker: false, },
    { name: "El Paso, TX USA", lat: 31.7592, lng: -106.4886, showMarker: false, },
    { name: "Amarillo, TX USA", lat: 35.1992, lng: -101.8453, showMarker: false, },
    { name: "Oklahoma City, OK USA", lat: 35.4686, lng: -97.5214, showMarker: false, },
    { name: "Omaha, NE USA", lat: 41.2586, lng: -95.9375, showMarker: false, },
    { name: "Anchorage, AK USA", lat: 61.2167, lng: -149.8936, showMarker: false, },
    { name: "Fairbanks, AK USA", lat: 64.8436, lng: -147.7231, showMarker: false, },
    { name: "Juneau, AK USA", lat: 58.3, lng: -134.4161, showMarker: false, },
    { name: "Honolulu, HI USA", lat: 21.3, lng: -157.85, showMarker: false, },
    { name: "Kelowna, BC Canada", lat: 49.8881, lng: -119.4956, showMarker: false, },
    { name: "Prince George, BC Canada", lat: 53.9131, lng: -122.7453, showMarker: false, },
    { name: "Calgary, AB Canada", lat: 51.0475, lng: -114.0625, showMarker: false, },
    { name: "Edmonton, AB Canada", lat: 53.5344, lng: -113.4903, showMarker: false, },
    { name: "Saskatoon, SK Canada", lat: 52.1397, lng: -106.6861, showMarker: false, },
    { name: "Winnipeg, MB Canada", lat: 49.8956, lng: -97.1386, showMarker: false, },
    { name: "Port Angeles, WA USA", lat: 48.1264, lng: -123.4778, showMarker: false, },
    { name: "Pullman, WA USA", lat: 46.7333, lng: -117.1686, showMarker: false, },
  ];

  // Visible map markers, in the exact pre-A-02 rendering order (markerOrder
  // is the 1-based index the city had in the old html/app.js marker array).
  const markerCities = cities
    .filter(city => city.showMarker)
    .sort((a, b) => a.markerOrder - b.markerOrder);

  return {
    all: cities,
    markerCities,
    locationCities: cities
  };
}));
