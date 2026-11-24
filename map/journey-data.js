/* Map-only itinerary projection. The planner's saved objects are read-only here. */
window.WonderJourneyData = (() => {
  const normalise = value => String(value ?? "").normalize("NFD")
    .replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const trim = value => typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  const day = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(value)) ? value : "";
  const coordinate = (lat, lng) =>
    trim(lat) && trim(lng) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180
      ? [Number(lat), Number(lng)] : null;

  function createLookup(data, airports) {
    const countryNames = new Map(data.countries.map(([name, code]) => [code, name]));
    const cities = new Map();
    const countries = new Map();
    const knownAirports = new Map(airports.map(airport => [airport.iata, airport]));
    const add = (index, name, place) => {
      const key = normalise(name);
      if (!key) return;
      if (!index.has(key)) index.set(key, []);
      if (!index.get(key).includes(place)) index.get(key).push(place);
    };
    const labels = data.countries.map(([name, country, lat, lng, rank, aliases]) => {
      const place = {name, country, lat, lng, zoom: rank <= 3 ? 2 : 4, kind: "country"};
      [name, ...aliases].forEach(alias => add(countries, alias, place));
      return place;
    });
    for (const [name, official] of [["USA", "United States of America"], ["US", "United States of America"], ["UK", "United Kingdom"]]) {
      const place = countries.get(normalise(official))?.[0];
      if (place) add(countries, name, place);
    }
    for (const [name, country, lat, lng, zoom, aliases, region] of data.cities) {
      const place = {name, country, countryName: countryNames.get(country), lat, lng, zoom, region: normalise(region), kind: "city"};
      labels.push(place);
      [name, ...aliases].forEach(alias => {
        if (!countries.has(normalise(alias))) add(cities, alias, place);
      });
    }
    function countryFor(parts) {
      for (const part of [...parts].reverse()) {
        const matches = countries.get(part);
        if (matches?.length === 1) return matches[0].country;
      }
      return "";
    }
    function choose(matches = [], country, parts) {
      const filtered = matches.filter(place => !country || place.country === country);
      const regional = filtered.filter(place => place.region && parts.includes(place.region));
      const candidates = regional.length ? regional : filtered;
      if (candidates.length === 1) return candidates[0];
      return null;
    }
    function resolve(value, hint, {airport = false, point = null, allowCountry = false} = {}) {
      const text = trim(value);
      if (point) return {name: text.split(",")[0] || "Pinned location", address: text, precise: true, lat: point[0], lng: point[1]};
      const pair = text.match(/^(?:(.+?)\s*@\s*)?(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
      const namedPin = pair && coordinate(pair[2], pair[3]);
      if (namedPin) return {name: pair[1] || "Pinned location", address: pair[2] + ", " + pair[3], precise: true, lat: namedPin[0], lng: namedPin[1]};
      const code = airport && text.match(/^([A-Z]{3})(?:\s|$)/)?.[1];
      if (code && data.airports[code]) {
        const [name, country, lat, lng] = data.airports[code];
        const city = knownAirports.get(code)?.city || name;
        const cityPlace = choose(cities.get(normalise(city)), country, []);
        if (cityPlace && Math.abs(cityPlace.lat - lat) < 1 && Math.abs(cityPlace.lng - lng) < 1) return cityPlace;
        return {name: city, country, countryName: countryNames.get(country), lat, lng};
      }
      const countryPlace = allowCountry && choose(countries.get(normalise(text)), "", []);
      if (countryPlace) return countryPlace;
      const parts = text.split(/[,;\n]/).map(normalise).filter(Boolean);
      const explicitCountry = countryFor(parts.slice(1));
      const cityMatch = (part, country) => choose(cities.get(part), country, parts);
      for (const part of [...parts].reverse()) {
        if (parts.length > 1 && countries.has(part)) continue;
        const city = cityMatch(part, explicitCountry) ||
          (!explicitCountry && cityMatch(part, hint));
        if (city) return city;
        // Address fragments often contain a postcode or a state abbreviation.
        const addressCity = part.replace(/\b\d{4,}\b/g, "").trim().replace(/\s+[a-z]{2}$/, "");
        const fromAddress = cityMatch(addressCity, explicitCountry) ||
          (!explicitCountry && cityMatch(addressCity, hint));
        if (fromAddress) return fromAddress;
      }
      return null;
    }
    return {labels, resolve, countryFor: value => countryFor(trim(value).split(/[,;\n]/).map(normalise))};
  }

  function transportMode(item) {
    const text = normalise([item.transportType, item.mode, item.title, item.notes].join(" "));
    if (/\b(train|rail|metro|tram|shinkansen|eurostar|tgv)\b/.test(text)) return "rail";
    if (/\b(boat|ferry|cruise|ship)\b/.test(text)) return "water";
    if (/\b(car|bus|coach|road|taxi|drive|shuttle|transfer|rental)\b/.test(text)) return "road";
    if (/\b(walk|walking|hike|cycle|bike)\b/.test(text)) return "foot";
    if (/\b(flight|plane|air)\b/.test(text)) return "flight";
    return "unknown";
  }

  function build(trip, lookup) {
    const events = [];
    const hint = lookup.countryFor(trip.destination);
    function add(item, name, date, time, options = {}) {
      const place = lookup.resolve(name, hint, options);
      if (place?.precise && options.title) place.name = options.title;
      if (!trim(name) && !place) return;
      events.push({
        name: place?.name || trim(name), place, date: day(date), time: trim(time),
        end: day(options.end) || day(date), order: events.length, item, leg: options.leg, arrival: options.arrival,
        includeItem: options.includeItem !== false
      });
    }
    for (const item of trip.items || []) {
      const location = trim(item.location);
      const coordinateOf = point => point && coordinate(point.lat, point.lng);
      if (item.type === "flight" || item.type === "transport") {
        const [from, to] = location.split(/\s*(?:→|->|\s+to\s+)\s*/i, 2);
        const airport = item.type === "flight";
        const origin = item.departAirport || item.departCity || item.from || (to ? from : "");
        const destination = item.arriveAirport || item.arriveCity || item.to || to;
        if (origin || destination) {
          const leg = {mode: airport ? "flight" : transportMode(item)};
          const arrivalDate = item.arrivalDate || item.date;
          const sameDay = arrivalDate === item.date;
          const departureTime = item.departTime || item.time;
          add(item, origin, item.date, departureTime || (sameDay && item.arrivalTime), {airport, leg, point: coordinateOf(item.fromCoordinates), includeItem: false});
          add(item, destination, arrivalDate, item.arrivalTime || (sameDay && departureTime), {airport, leg, point: coordinateOf(item.toCoordinates), arrival: true});
          continue;
        }
      }
      const point = coordinate(item.lat ?? item.latitude ?? item.coordinates?.lat,
        item.lng ?? item.longitude ?? item.coordinates?.lng ?? item.coordinates?.lon);
      add(item, location || item.title, item.date, item.time, {point, title:trim(item.title), end: item.type === "hotel" ? item.endDate : ""});
    }
    if (!events.some(event => event.place) && trim(trip.destination)) {
      add(null, trip.destination, trip.startDate, "", {end: trip.endDate, allowCountry: true});
    }
    const placeKey = place => `${place.lat},${place.lng}`;
    const anchors = new Map();
    for (const event of events) {
      if (event.leg && event.place && event.date) {
        event.time ||= "12:00";
        const key = `${event.date}:${placeKey(event.place)}`;
        if (!anchors.has(key)) anchors.set(key, event);
      }
    }
    for (const event of events) {
      if (event.leg || event.time || !event.place) continue;
      // Place a local plan with no time alongside same-day travel to or from that city.
      const anchor = anchors.get(`${event.date}:${placeKey(event.place)}`);
      event.time = anchor?.time || "23:59";
      if (anchor) event.order = anchor.order + (anchor.arrival ? .25 : -.25);
    }
    // Undated plans follow dated visits. Keep same-time legs in itinerary order.
    events.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") ||
      a.time.localeCompare(b.time) || a.order - b.order);
    const stops = [];
    const pending = [];
    const routes = [];
    const explicitLegs = [];
    let current;
    let sequenceBroken = false;
    for (const event of events) {
      if (!event.place) {
        pending.push(event);
        // Unresolved local venues remain listed without breaking a known city stay.
        if (event.leg) sequenceBroken = true;
        continue;
      }
      const key = placeKey(event.place);
      if (!current || key !== current.key || sequenceBroken) {
        const next = {...event.place, key, number: stops.length + 1, start: event.date, end: event.end, items: []};
        if (current && !sequenceBroken) routes.push({from: current, to: next, mode: "unknown"});
        stops.push(next);
        current = next;
        sequenceBroken = false;
      }
      if (event.end > current.end) current.end = event.end;
      if (event.includeItem && event.item && !current.items.includes(event.item)) current.items.push(event.item);
      if (event.leg && !event.arrival) event.leg.from = current;
      if (event.leg && event.arrival && event.leg.from && event.leg.from !== current) {
        explicitLegs.push({from: event.leg.from, to: current, mode: event.leg.mode});
      }
    }
    const assigned = new Set(stops.flatMap(stop => stop.items));
    for (const item of trip.items || []) {
      const date = day(item.date);
      if (!date || assigned.has(item) || item.type === "flight" || item.type === "transport") continue;
      const candidates = stops.filter(stop => stop.start && stop.start <= date && date <= stop.end);
      if (candidates.length === 1 && (pending.some(event => event.item === item) || !trim(item.location))) {
        candidates[0].items.push(item);
      }
    }
    const matchingLeg = route => explicitLegs.some(leg => leg.from === route.from && leg.to === route.to);
    return {stops, pending, routes: [...routes.filter(route => !matchingLeg(route)), ...explicitLegs]};
  }

  function unwrap(stops) {
    if (!stops.length) return;
    const sorted = stops.map(stop => stop.lng).sort((a, b) => a - b);
    let gap = -1;
    let first = sorted[0];
    sorted.forEach((lng, index) => {
      const next = sorted[index + 1] ?? sorted[0] + 360;
      if (next - lng > gap) {
        gap = next - lng;
        first = sorted[(index + 1) % sorted.length];
      }
    });
    for (const stop of stops) stop.mapLng = stop.lng < first ? stop.lng + 360 : stop.lng;
  }

  return {createLookup, build, unwrap};
})();
