(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DaylightView = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clampValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getSafeAreaCenter(mapSize, panelBounds, margin = 16) {
    const center = { x: mapSize.x / 2, y: mapSize.y / 2 };
    if (!panelBounds) return center;

    const intersectsMap = panelBounds.right > 0
      && panelBounds.left < mapSize.x
      && panelBounds.bottom > 0
      && panelBounds.top < mapSize.y;
    if (!intersectsMap) return center;

    const safeLeft = clampValue(panelBounds.right + margin, 0, mapSize.x);
    const safeBottom = clampValue(panelBounds.top - margin, 0, mapSize.y);
    const rightArea = (mapSize.x - safeLeft) * mapSize.y;
    const topArea = safeBottom * mapSize.x;

    if (rightArea > 0 && rightArea >= topArea) {
      return { x: (safeLeft + mapSize.x) / 2, y: center.y };
    }

    if (topArea > 0) {
      return { x: center.x, y: safeBottom / 2 };
    }

    return center;
  }

  function getMapCenterOffset(mapSize, desiredPoint) {
    return {
      x: mapSize.x / 2 - desiredPoint.x,
      y: mapSize.y / 2 - desiredPoint.y
    };
  }

  function getNearestWorldLongitude(longitude, referenceLongitude) {
    return longitude + 360 * Math.round((referenceLongitude - longitude) / 360);
  }

  function getEdgeAwareLabelPlacement(point, mapSize, padding = 72) {
    if (point.x > mapSize.x - padding) {
      return { direction: 'left', offset: [-10, 0] };
    }
    if (point.x < padding) {
      return { direction: 'right', offset: [10, 0] };
    }
    if (point.y > mapSize.y - padding) {
      return { direction: 'top', offset: [0, -10] };
    }
    if (point.y < padding) {
      return { direction: 'bottom', offset: [0, 10] };
    }
    return { direction: 'right', offset: [10, 0] };
  }

  return {
    getSafeAreaCenter,
    getMapCenterOffset,
    getNearestWorldLongitude,
    getEdgeAwareLabelPlacement
  };
}));
