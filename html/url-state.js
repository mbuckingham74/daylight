/**
 * url-state.js — URL/permalink and share behavior for the Daylight map.
 *
 * UMD module: works in the browser (exposes window.UrlState) and in Node
 * (exports the same functions for unit testing), matching solar.js /
 * view.js / app-scheduler.js.
 *
 * Owns the permalink/history and Share/Copy Link behavior extracted from
 * app.js (A-01): serializing the current time and map view into a query
 * string, debounced history.replaceState updates, the canonical share URL,
 * and the copy/share feedback flow. Application state (current time, live
 * flag, whether the view is shared in the URL, map view) is injected as
 * callbacks through UrlState.create(). The pure serialization function
 * serializeUrlParams is exported for unit testing without a browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UrlState = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Serialize the displayed instant and map view into a query string.
  //   state.isLive      — live clock vs pinned/time-travel instant
  //   state.time        — the displayed instant (used only when !isLive)
  //   state.includeView — whether the camera is shared in the URL
  //   state.lat/lng/zoom — the map view
  //   state.wrapLng     — longitude normalization applied to the view
  function serializeUrlParams(state) {
    const params = new URLSearchParams();
    if (!state.isLive) {
      params.set('time', state.time.toISOString());
    }

    if (state.includeView) {
      params.set('lat', state.lat.toFixed(4));
      params.set('lon', state.wrapLng(state.lng).toFixed(4));
      params.set('zoom', state.zoom);
    }

    return params.toString();
  }

  function create(deps) {
    const { getEl, getTime, isLive, getView, getSyncView, history, location, wrapLng } = deps;

    let permalinkDebounce;
    function updatePermalink() {
      clearTimeout(permalinkDebounce);
      permalinkDebounce = setTimeout(() => {
        const view = getView();
        const query = serializeUrlParams({
          isLive: isLive(),
          time: getTime(),
          includeView: getSyncView(),
          lat: view.lat,
          lng: view.lng,
          zoom: view.zoom,
          wrapLng
        });
        const newUrl = query ? `${location.pathname}?${query}` : location.pathname;
        history.replaceState(null, '', newUrl);
      }, 300);
    }

    // Generate a canonical share URL that always includes the current time,
    // view, and zoom — unlike the address bar, which omits view params on a
    // clean-root session. Never includes browser geolocation unless the user
    // explicitly shared a URL that contained it.
    function buildShareUrl() {
      const view = getView();
      const query = serializeUrlParams({
        isLive: isLive(),
        time: getTime(),
        includeView: true,
        lat: view.lat,
        lng: view.lng,
        zoom: view.zoom,
        wrapLng
      });
      return `${location.origin}${location.pathname}?${query}`;
    }

    function showShareFeedback(message) {
      const shareBtn = getEl('share-btn');
      const originalText = shareBtn.textContent;
      shareBtn.textContent = message;
      shareBtn.disabled = true;
      setTimeout(() => {
        shareBtn.textContent = originalText;
        shareBtn.disabled = false;
      }, 2000);
    }

    function fallbackCopyToClipboard(text) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        showShareFeedback('Copied!');
      } catch (e) {
        showShareFeedback('Copy failed');
      }
      document.body.removeChild(textarea);
    }

    function initShare() {
      const shareBtn = getEl('share-btn');
      shareBtn.addEventListener('click', function () {
        const url = buildShareUrl();

        if (navigator.share) {
          navigator.share({
            title: 'Daylight Map',
            text: 'Day and night regions across the planet',
            url: url
          }).then(() => {
            showShareFeedback('Shared');
          }).catch(() => {});
          return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(() => {
            showShareFeedback('Copied!');
          }).catch(() => {
            fallbackCopyToClipboard(url);
          });
          return;
        }

        fallbackCopyToClipboard(url);
      });
    }

    function showUrlParamNotice(params) {
      const notice = document.createElement('div');
      notice.className = 'url-notice';
      notice.setAttribute('role', 'alert');
      notice.textContent = `Ignoring invalid URL parameter${params.length > 1 ? 's' : ''}: ${params.join(', ')}. Using default values.`;
      document.body.appendChild(notice);
      setTimeout(() => {
        notice.classList.add('url-notice--fade');
        setTimeout(() => notice.remove(), 500);
      }, 6000);
    }

    return {
      updatePermalink,
      buildShareUrl,
      initShare,
      showUrlParamNotice
    };
  }

  return {
    create,
    serializeUrlParams
  };
}));
