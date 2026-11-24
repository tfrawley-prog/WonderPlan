window.WonderJourneyMap = (() => {
  const switches = {
    names: "Destination names",
    labels: "Overview labels",
    routes: "Routes",
    dates: "Travel dates",
    accommodation: "Accommodation",
    activities: "Activities",
    photos: "Photographs"
  };
  const visible = Object.fromEntries(Object.keys(switches).map(key => [key, true]));
  const palettes = {
    atlas: {water: "#dfedf3", land: "#f9f3df", border: "#a8b5ae"},
    terrain: {water: "#dcebed", land: "#e6efd7", border: "#7d8c76"},
    dark: {water: "#142236", land: "#293d4a", border: "#53697b"}
  };
  const modes = {
    flight: {label: "Flight", color: "#5955c9", dashArray: "9 6", curve: .19},
    rail: {label: "Rail", color: "#148773", dashArray: "12 4 2 4", curve: .06},
    road: {label: "Road", color: "#c16b28", dashArray: "", curve: .04},
    water: {label: "Water", color: "#187cc1", dashArray: "2 7", curve: .09},
    foot: {label: "On foot or by bike", color: "#b24171", dashArray: "2 4", curve: .03},
    unknown: {label: "Unspecified", color: "#677181", dashArray: "5 5", curve: .04}
  };
  const worlds = [-360, 0, 360];
  let style = "terrain";
  let assets;
  let dispose = () => {};

  function loadAssets() {
    assets ||= Promise.all(["places", "boundaries"].map(async name => {
      const response = await fetch(`./map/${name}.json`);
      if (!response.ok) throw new Error("Map data unavailable");
      return response.json();
    })).catch(error => {
      assets = null;
      throw error;
    });
    return assets;
  }

  function routePoints(from, to, curve) {
    const dLat = to.lat - from.lat;
    const dLng = to.mapLng - from.mapLng;
    return Array.from({length: 25}, (_, index) => {
      if (index === 0) return [from.lat, from.mapLng];
      if (index === 24) return [to.lat, to.mapLng];
      const t = index / 24;
      const arc = 4 * t * (1 - t) * curve;
      return [
        Math.max(-89, Math.min(89, from.lat + t * dLat + arc * dLng)),
        from.mapLng + t * dLng - arc * dLat
      ];
    });
  }

  function unmount() {
    dispose();
    dispose = () => {};
  }

  function mount(root, options) {
    unmount();
    const {trip, airports, escape, formatDate, costs, photo, openItem, openMaps} = options;
    root.innerHTML = `
      <div class="journeyToolbar">
        <label class="journeyStyle">Map style
          <select aria-label="Map style"><option value="terrain">Terrain</option><option value="atlas">Atlas</option><option value="dark">Dark</option></select>
        </label>
        <button type="button" data-fit disabled>Fit trip</button>
        <button type="button" class="journeyPlay" data-play disabled>▶ Play Journey</button>
        <details class="journeyLayers">
          <summary>Map layers</summary>
          <div>${Object.entries(switches).map(([key, label]) =>
            `<label><input type="checkbox" value="${key}" ${visible[key] ? "checked" : ""}> ${label}</label>`).join("")}</div>
        </details>
      </div>
      <div class="journeyLayout">
        <div class="journeyMapPanel">
          <div class="journeySurface" aria-label="Trip map" role="region"></div>
          <div class="journeyMapNotice" role="status" hidden></div>
        </div>
        <aside class="journeyDetails" aria-label="Journey stops">
          <p class="journeyStatus" role="status">Loading trip map…</p>
          <div class="journeyCard" hidden></div>
          <ol class="journeyStops"></ol>
          <div class="journeyPending"></div>
        </aside>
      </div>
      <div class="journeyLegend" aria-label="Travel route legend"></div>`;

    const surface = root.querySelector(".journeySurface");
    const status = root.querySelector(".journeyStatus");
    const mapNotice = root.querySelector(".journeyMapNotice");
    const card = root.querySelector(".journeyCard");
    const list = root.querySelector(".journeyStops");
    const pendingList = root.querySelector(".journeyPending");
    const legend = root.querySelector(".journeyLegend");
    const select = root.querySelector("select");
    const fit = root.querySelector("[data-fit]");
    const play = root.querySelector("[data-play]");
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let alive = true;
    let map;
    let observer;
    let removeNetworkListeners = () => {};
    let timer;
    let selected;
    let activeMarker;

    function stopPlayback() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      play.textContent = "▶ Play Journey";
    }

    dispose = () => {
      alive = false;
      stopPlayback();
      observer?.disconnect();
      removeNetworkListeners();
      map?.remove();
    };
    select.value = style;

    loadAssets().then(([data, boundaries]) => {
      if (!alive || !root.isConnected) return;
      const lookup = WonderJourneyData.createLookup(data, airports);
      const {stops, pending, routes} = WonderJourneyData.build(trip, lookup);
      WonderJourneyData.unwrap(stops);
      const point = stop => [stop.lat, stop.mapLng];
      const resize = new ResizeObserver(() => map.invalidateSize({pan: false}));
      map = L.map(surface, {
        zoomSnap: .25, zoomAnimation: false, minZoom: 0, maxZoom: 19,
        maxBounds: [[-90, -360], [90, 720]], scrollWheelZoom: false,
        attributionControl: false, touchZoom: true
      }).setView([18, 0], 0);
      observer = resize;
      observer.observe(surface);
      const attribution = L.control.attribution({prefix: false}).addAttribution(
        '<a href="https://www.naturalearthdata.com/">Natural Earth</a> · <a href="https://ourairports.com/data/">OurAirports</a>'
      ).addTo(map);
      map.createPane("journeyLabels");
      map.getPane("journeyLabels").style.zIndex = 410;
      map.getPane("journeyLabels").style.pointerEvents = "none";
      const base = L.layerGroup().addTo(map);
      const labels = L.layerGroup().addTo(map);
      map.createPane("journeyRoutes");
      map.getPane("journeyRoutes").style.zIndex = 405;
      const lines = L.layerGroup().addTo(map);
      const relief = L.layerGroup(worlds.map(offset => L.imageOverlay("./map/terrain-mercator.webp",
        [[-85.05112878, -180 + offset], [85.05112878, 180 + offset]], {interactive: false})));
      const outlines = worlds.map(offset => L.geoJSON(boundaries, {
        coordsToLatLng: ([lng, lat]) => L.latLng(lat, lng + offset),
        interactive: false
      }));

      function drawBase() {
        surface.dataset.style = style;
        const palette = palettes[style];
        surface.style.backgroundColor = palette.water;
        base.clearLayers();
        if (style === "terrain") base.addLayer(relief);
        outlines.forEach(layer => {
          layer.setStyle({
            color: palette.border, weight: style === "terrain" ? .65 : .8,
            opacity: style === "terrain" ? .55 : .8, fillColor: palette.land,
            fillOpacity: style === "terrain" ? .13 : 1
          });
          base.addLayer(layer);
        });
      }

      const streetZoom = 11;
      const streetPane = map.createPane("journeyStreets");
      streetPane.style.zIndex = 402;
      streetPane.classList.add("journeyStreetPane");
      const streetCredit = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
      const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        pane: "journeyStreets", minZoom: streetZoom, maxZoom: 19, keepBuffer: 1,
        referrerPolicy: "strict-origin-when-cross-origin"
      });
      let streetTilesLoaded = false;
      function showMapNotice(message) {
        mapNotice.textContent = message;
        mapNotice.hidden = !message;
      }
      function updateStreetDetail() {
        const zoomedIn = map.getZoom() >= streetZoom;
        if (zoomedIn && navigator.onLine) {
          if (!map.hasLayer(streets)) {
            streetTilesLoaded = false;
            streets.addTo(map);
            attribution.addAttribution(streetCredit);
          }
        } else if (map.hasLayer(streets)) {
          map.removeLayer(streets);
          attribution.removeAttribution(streetCredit);
          streetTilesLoaded = false;
        }
        showMapNotice(zoomedIn && !navigator.onLine ? "Street detail requires internet. Your trip pins are still available." : "");
        drawLabels();
      }
      streets.on("loading", () => { streetTilesLoaded = false; });
      streets.on("tileerror", () => {
        if (!streetTilesLoaded && map.hasLayer(streets)) showMapNotice("Street detail is unavailable. Your trip pins are still available.");
      });
      streets.on("tileload", () => {
        if (streetTilesLoaded) return;
        streetTilesLoaded = true;
        showMapNotice("");
        drawLabels();
      });
      window.addEventListener("online", updateStreetDetail);
      window.addEventListener("offline", updateStreetDetail);
      removeNetworkListeners = () => {
        window.removeEventListener("online", updateStreetDetail);
        window.removeEventListener("offline", updateStreetDetail);
      };

      const sortedLabels = [...lookup.labels].sort((a, b) => a.zoom - b.zoom);
      function drawLabels() {
        labels.clearLayers();
        if (!visible.labels || (streetTilesLoaded && map.hasLayer(streets))) return;
        const zoom = map.getZoom();
        const bounds = map.getBounds().pad(-.04);
        const cells = new Set();
        function cell(latLng) {
          const p = map.latLngToContainerPoint(latLng);
          return `${Math.floor(p.x / 110)},${Math.floor(p.y / 32)}`;
        }
        stops.forEach(stop => cells.add(cell(point(stop))));
        for (const place of sortedLabels) {
          if (place.zoom > zoom + 1) break;
          for (const offset of worlds) {
            const p = [place.lat, place.lng + offset];
            if (!bounds.contains(p)) continue;
            const key = cell(p);
            if (cells.has(key)) continue;
            cells.add(key);
            labels.addLayer(L.marker(p, {
              pane: "journeyLabels", interactive: false, keyboard: false,
              icon: L.divIcon({className: `journeyGeo ${place.kind}`, iconSize: [0, 0],
                html: `<span>${escape(place.name)}</span>`})
            }));
          }
        }
      }
      map.on("moveend", updateStreetDetail);
      map.on("dragstart zoomstart", event => {
        if (event.originalEvent || event.type === "dragstart") stopPlayback();
      });

      const groups = new Map();
      for (const stop of stops) {
        if (!groups.has(stop.key)) groups.set(stop.key, []);
        groups.get(stop.key).push(stop);
      }
      for (const group of groups.values()) {
        const first = group[0];
        const icon = L.divIcon({
          className: "journeyPinWrap", iconSize: [0, 0],
          html: `<button type="button" class="journeyPin" aria-label="${escape(first.name)}, stop ${group.map(s => s.number).join(", ")}">${group.map(s => s.number).join(" · ")}</button>
            <span class="journeyPinName" ${visible.names ? "" : "hidden"}>${escape(first.name)}</span>`
        });
        const marker = L.marker(point(first), {icon, keyboard: false, interactive: false}).addTo(map);
        const pin = marker.getElement().querySelector("button");
        pin.addEventListener("click", event => {
          event.stopPropagation();
          stopPlayback();
          const next = (group.indexOf(selected) + 1) % group.length;
          chooseStop(group[next], false, true);
        });
        L.DomEvent.disableClickPropagation(pin);
        group.forEach(stop => { stop.pin = pin; });
      }

      function drawRoutes() {
        lines.clearLayers();
        legend.replaceChildren();
        if (!visible.routes) return;
        const used = new Set();
        for (const {from, to, mode} of routes) {
          const {color, dashArray, curve} = modes[mode];
          L.polyline(routePoints(from, to, curve), {
            color, dashArray, weight: 3, opacity: .9, interactive: false, pane: "journeyRoutes"
          }).addTo(lines);
          used.add(mode);
        }
        legend.innerHTML = [...used].map(mode => {
          const {color, label, dashArray} = modes[mode];
          return `<span><svg width="27" height="8" aria-hidden="true"><path d="M1 4h25" stroke="${color}" stroke-width="3" stroke-dasharray="${dashArray}"/></svg>${label}</span>`;
        }).join("");
        if (used.size) legend.insertAdjacentHTML("afterbegin", "<span>Illustrative routes</span>");
      }

      function renderCard(focus = false) {
        if (!selected) {
          card.hidden = true;
          return;
        }
        const stop = selected;
        const credits = [...new Set(stop.items.flatMap(item =>
          Array.isArray(item.geoapifyCredits) ? item.geoapifyCredits : []))];
        const hotels = stop.items.filter(i => i.type === "hotel");
        const activities = stop.items.filter(i => i.type === "activity" || i.type === "restaurant");
        const dateText = [stop.start, stop.end !== stop.start ? stop.end : ""].filter(Boolean).map(formatDate).join(" – ");
        const nights = stop.start && stop.end ? Math.max(0, Math.round((Date.parse(stop.end) - Date.parse(stop.start)) / 86400000)) : null;
        const image = visible.photos && photo(stop);
        const planGroup = (label, items) => `<div class="journeyPlanGroup"><h4>${label}</h4>
          ${items.length ? items.map(i => `<button type="button" data-item="${stop.items.indexOf(i)}">${escape(i.title || label)}</button>`).join("")
            : '<p>None added</p>'}</div>`;
        card.hidden = false;
        card.innerHTML = `
          <div class="journeyCardHeading">
            <h3 tabindex="-1"><span>${stop.number}</span> ${escape(stop.name)}</h3>
            <button type="button" data-close aria-label="Close destination">×</button>
          </div>
          ${stop.address && stop.address !== stop.name ? `<p class="journeyAddress">${escape(stop.address)}</p>` : ""}
          ${credits.length ? `<p><a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">${escape(credits.join(" · "))}</a></p>` : ""}
          <div class="journeyAddressActions">
            <button type="button" data-zoom-stop>${stop.precise ? "Zoom to address" : "Zoom in here"}</button>
            <button type="button" data-open-map>Open in Maps ↗</button>
          </div>
          ${image ? `<figure><img alt="${escape(image.alt || "Destination photo")}" src="${escape(image.url)}">
            ${image.credit ? `<figcaption>${escape(image.credit)}</figcaption>` : ""}</figure>` : ""}
          ${visible.photos ? `<p class="journeyPhotoUnavailable" ${image ? "hidden" : ""}>Photograph unavailable</p>` : ""}
          ${visible.dates ? `<p>${escape(dateText || "No dates added")}${nights !== null ? ` · ${nights} ${nights === 1 ? "night" : "nights"}` : ""}</p>` : ""}
          ${visible.accommodation ? planGroup("Accommodation", hotels) : ""}
          ${visible.activities ? planGroup("Activities", activities) : ""}
          <div class="journeyPlanGroup"><h4>Estimated expenditure</h4><p>${escape(costs(stop.items) || "No costs added")}</p></div>`;
        card.querySelector("[data-zoom-stop]").onclick = () => {
          stopPlayback();
          map.stop();
          map.setView(point(stop), Math.max(map.getZoom(), stop.precise ? 17 : 13));
          surface.scrollIntoView({block: "nearest"});
        };
        card.querySelector("[data-open-map]").onclick = () => openMaps(stop.precise ? `${stop.lat},${stop.lng}` : stop.name);
        const img = card.querySelector("img");
        if (img) {
          const unavailable = () => {
            img.closest("figure").hidden = true;
            card.querySelector(".journeyPhotoUnavailable").hidden = false;
          };
          img.addEventListener("error", unavailable, {once: true});
          if (img.complete && !img.naturalWidth) unavailable();
        }
        card.querySelector("[data-close]").onclick = () => {
          stopPlayback();
          const trigger = document.activeElement === card.querySelector("[data-close]") && root.querySelector(`[data-stop="${stop.number}"]`);
          chooseStop(null, false);
          trigger?.focus();
        };
        card.querySelectorAll("[data-item]").forEach(button => {
          button.onclick = () => {
            stopPlayback();
            openItem(stop.items[Number(button.dataset.item)].id);
          };
        });
        if (focus) {
          const heading = card.querySelector("h3");
          heading.focus({preventScroll: true});
          heading.scrollIntoView({block: "nearest"});
        }
      }

      function chooseStop(stop, move, focus = false, animate = false) {
        selected = stop;
        activeMarker?.classList.remove("active");
        activeMarker = stop?.pin;
        activeMarker?.classList.add("active");
        list.querySelectorAll("[data-stop]").forEach(button =>
          button.setAttribute("aria-pressed", String(Number(button.dataset.stop) === stop?.number)));
        if (move && stop) {
          const zoom = Math.max(map.getZoom(), 5);
          map.stop();
          if (animate && !motion.matches) map.flyTo(point(stop), zoom, {duration: .85});
          else map.setView(point(stop), zoom, {animate: false});
        }
        renderCard(focus);
      }

      for (const stop of stops) {
        const row = document.createElement("li");
        row.innerHTML = `<button type="button" aria-pressed="false" data-stop="${stop.number}"><b>${stop.number}</b>
          <span>${escape(stop.name)}${stop.start ? `<small data-stop-date ${visible.dates ? "" : "hidden"}>${escape(formatDate(stop.start))}</small>` : ""}</span></button>`;
        row.firstElementChild.onclick = () => {
          stopPlayback();
          chooseStop(stop, true, true);
        };
        list.append(row);
      }
      if (pending.length) {
        pendingList.innerHTML = `<details><summary>${pending.length} ${pending.length === 1 ? "location" : "locations"} without map coordinates</summary>
          <p>Add a city and country to the plan, or enter coordinates like -27.47, 153.03.</p>
          <ul>${pending.map(({name, date, item}, index) => `<li>
            <span>${escape(name)}${date ? `<small data-stop-date ${visible.dates ? "" : "hidden"}>${escape(formatDate(date))}</small>` : ""}</span>
            ${item?.id ? `<button type="button" data-edit-place="${index}">Add map address</button>` : ""}
            <button type="button" data-search="${index}">Search maps ↗</button>
          </li>`).join("")}</ul></details>`;
        pendingList.querySelectorAll("[data-edit-place]").forEach(button => {
          button.onclick = () => options.editItem(pending[Number(button.dataset.editPlace)].item.id, true);
        });
        pendingList.querySelectorAll("[data-search]").forEach(button => {
          button.onclick = () => openMaps(pending[Number(button.dataset.search)].name);
        });
      }
      status.textContent = stops.length ? `${stops.length} ${stops.length === 1 ? "destination" : "destinations"}`
        : "No destinations plotted yet. Add a location to a plan to build your journey.";
      fit.disabled = !stops.length;
      play.disabled = !stops.length;

      function frame() {
        map.stop();
        if (stops.length) map.fitBounds(stops.map(point), {padding: [45, 45], maxZoom: 6, animate: false});
      }
      fit.onclick = () => {
        stopPlayback();
        frame();
      };
      play.onclick = () => {
        if (timer !== undefined) {
          stopPlayback();
          map.stop();
          return;
        }
        let index = 0;
        play.textContent = "■ Stop Journey";
        function step() {
          chooseStop(stops[index++], true, false, true);
          timer = setTimeout(index < stops.length ? step : stopPlayback, 2400);
        }
        step();
      };
      select.onchange = () => {
        style = select.value;
        drawBase();
      };
      root.querySelector(".journeyLayers").onchange = ({target}) => {
        visible[target.value] = target.checked;
        if (target.value === "names") surface.querySelectorAll(".journeyPinName").forEach(el => { el.hidden = !visible.names; });
        if (target.value === "labels") drawLabels();
        if (target.value === "routes") drawRoutes();
        if (target.value === "dates") root.querySelectorAll("[data-stop-date]").forEach(el => { el.hidden = !visible.dates; });
        if (["dates", "accommodation", "activities", "photos"].includes(target.value)) renderCard();
      };
      drawBase();
      drawRoutes();
      frame();
      updateStreetDetail();
    }).catch(error => {
      if (!alive) return;
      observer?.disconnect();
      removeNetworkListeners();
      map?.remove();
      map = undefined;
      console.error("WonderPlan map:", error);
      status.textContent = "The map could not load. Reopen Map to try again, or use Places to look up a location.";
    });
  }

  return {mount, unmount};
})();
