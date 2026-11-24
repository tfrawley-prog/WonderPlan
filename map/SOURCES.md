# WonderPlan Map Mode assets

- Leaflet 1.9.4 is vendored under its BSD 2-Clause license in [vendor/LICENSE](vendor/LICENSE).
- `boundaries.json`, the country and city lookup data in `places.json`, and `terrain-mercator.webp` are derived from [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) public-domain data. The source layers are 1:110m Admin 0 Countries, 1:10m Populated Places (simple), and 1:50m Cross-blended Hypsometric Tints with Relief and Water. Boundaries were rounded to three decimal places, lookup fields were reduced, and the relief was resized, desaturated and projected to Web Mercator.
- Airport coordinates in `places.json` are from the [OurAirports public-domain download](https://ourairports.com/data/), filtered to medium and large airports and the airport codes already in WonderPlan.

Map Mode shows city-level locations where it can identify a city from a plan. A plan's Location / address field can also contain `-27.47, 153.03` or `Brisbane lookout @ -27.47, 153.03` to plot a precise point. A transport plan can use a location such as `Tokyo → Kyoto` and mention its mode in the title or notes. Distances and route lines are illustrative. Destination images use existing WonderPlan photography when available.

Street detail uses [OpenStreetMap raster tiles](https://www.openstreetmap.org/copyright) at zoom 11 and above while online. Tiles are requested for the current viewport and use the browser cache. The bundled overview remains visible when street tiles cannot load.
