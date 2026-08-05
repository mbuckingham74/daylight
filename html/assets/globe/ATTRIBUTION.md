# Globe texture attribution

All textures in this directory are NASA imagery and are in the public domain.
Source and redistribution details per file:

| File | Content | Source | Notes |
|------|---------|--------|-------|
| `day.jpg` | Blue Marble day albedo, 4096×2048, equirectangular | NASA Blue Marble imagery (NASA Earth Observatory); redistributed via the [three-globe](https://github.com/vasturiano/three-globe) repository example assets (MIT-licensed repo, texture committed as `example/img/earth-blue-marble.jpg`) | Public domain (NASA). No modification beyond the original JPEG. |
| `night.png` | Black Marble city lights, 4096×2048, equirectangular | NASA Black Marble 2016 VIIRS annual composite, stitched from NASA GIBS WMTS tiles (`VIIRS_Black_Marble`, time `2016-01-01`, EPSG:4326 500m tile matrix, zoom 3, 10×5 tiles of 512px) | Public domain (NASA). Stitched, downscaled 5120×2560 → 4096×2048, palette-quantized for web size. |
| `bump.jpg` | Shaded relief + bathymetry bump map, 2048×1024, equirectangular | NASA Blue Marble shaded relief with bathymetry, stitched from NASA GIBS WMTS tiles (`BlueMarble_ShadedRelief_Bathymetry`, EPSG:4326 500m tile matrix, zoom 3) | Public domain (NASA). Stitched, downscaled 5120×2560 → 2048×1024, JPEG. |
| `specular.jpg` | Land/ocean specular mask, 2048×1024, equirectangular | NASA Blue Marble land/water mask; redistributed via the [three.js](https://github.com/mrdoob/three.js) examples repository (`examples/textures/planets/earth_specular_2048.jpg`, r128) | Public domain (NASA); MIT-licensed repo redistribution. Unmodified. |
| `clouds.png` | Cloud cover layer, 2048×1024, equirectangular RGBA (alpha = coverage) | NASA Terra MODIS cloud composite; redistributed via the [three.js](https://github.com/mrdoob/three.js) examples repository (`examples/textures/planets/earth_clouds_2048.png`, r150) | Public domain (NASA); MIT-licensed repo redistribution. RGB flattened to gray, alpha quantized to 64 levels for web size. |

GIBS layers accessed via the public NASA WMTS endpoint
`https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/...` (no key required).

NASA imagery credit: NASA Earth Observatory / NASA Global Imagery Browse
Services (EOSDIS GIBS). See https://www.earthdata.nasa.gov/engage/open-data-services-and-software
for NASA's open-data policy.

The star background on the globe page is procedural (generated at runtime in
`html/globe.js`), so it requires no attribution.
