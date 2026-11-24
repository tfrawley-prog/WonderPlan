let bookingReview = [];
let bookingOriginal = "";
const bookingTypes = ["flight", "hotel", "transport", "activity", "restaurant", "other"];

function openImportBooking(preferred = "", previous = "") {
  closeMobilePlanner();
  const modal = document.getElementById("modalCard");
  modal.className = "modalCard";
  modal.innerHTML = `
    <div class="modalTop"><h3>Smart add</h3><button type="button" class="modalClose" onclick="closeModal()" aria-label="Close">✕</button></div>
    <label for="bookingType">Booking type</label>
    <select id="bookingType"><option value="">Detect from confirmation</option>${bookingTypes.map(type =>
      `<option value="${type}" ${type === preferred ? "selected" : ""}>${TYPES[type].label}</option>`).join("")}</select>
    <label for="importText">Confirmation text or listing link</label>
    <textarea id="importText" rows="6" placeholder="Paste the confirmation from your airline, hotel, Airbnb, or tour provider.">${esc(previous)}</textarea>
    <p class="helperNote">Paste the property name and address for private listings. For screenshots, copy the text with iPhone Live Text and paste it here.</p>
    <div class="actions"><button type="button" class="btn secondary" onclick="closeModal()">Cancel</button><button type="button" class="btn primary" id="scanBooking">Review details</button></div>`;
  document.getElementById("scanBooking").onclick = () => {
    bookingOriginal = document.getElementById("importText").value.trim();
    const type = document.getElementById("bookingType").value;
    bookingReview = WonderBooking.scan(bookingOriginal, WORLD_AIRPORTS, type);
    renderBookingReview(type);
  };
  document.getElementById("modal").classList.add("open");
}

function placeLookupHTML(field = "location") {
  return `<div class="bookingLookup">
    <button type="button" class="btn secondary" data-find-place="${field}" onclick="findBookingPlace(this)">Find address</button>
    <div class="bookingPlaceResults" aria-live="polite"></div>
  </div>`;
}

function renderBookingReview(preferred) {
  const modal = document.getElementById("modalCard");
  const input = (d, key, label, type = "text") =>
    `<label>${label}<input type="${type}" data-booking-field="${key}" value="${esc(d[key] ?? "")}"></label>`;
  modal.innerHTML = `
    <div class="modalTop"><h3>Review ${bookingReview.length === 1 ? "booking" : `${bookingReview.length} bookings`}</h3>
    <button type="button" class="modalClose" onclick="closeModal()" aria-label="Close">✕</button></div>
    <p class="helperNote">Check the extracted details before adding them to your trip.</p>
    ${bookingReview.map((d, index) => `<fieldset class="bookingReview" data-booking-index="${index}">
      <legend>${TYPES[d.type].label}${bookingReview.length > 1 ? ` ${index + 1}` : ""}</legend>
      ${d.type === "flight" ? `
        <div class="row">${input(d,"flightNo","Flight number")}${input(d,"airline","Airline")}</div>
        <div class="row">${input(d,"departAirport","Departure airport")}${input(d,"arriveAirport","Arrival airport")}</div>
        <div class="row">${input(d,"date","Departure date","date")}${input(d,"time","Local departure","time")}</div>
        <div class="row">${input(d,"arrivalDate","Arrival date","date")}${input(d,"arrivalTime","Local arrival","time")}</div>
        <button type="button" class="btn secondary" data-flight-search>Check flight online ↗</button>
      ` : `
        ${input(d,"title",d.type === "hotel" ? "Property" : "Name")}
        ${input(d,"location",d.type === "transport" ? "Address or origin → destination" : "Address or venue")}
        ${placeLookupHTML()}
        <div class="row">${input(d,"date",d.type === "hotel" ? "Check-in" : "Date","date")}${input(d,"time","Local time","time")}</div>
        ${d.type === "hotel" ? input(d,"endDate","Check-out","date") : ""}
      `}
      ${input(d,"bookingRef","Booking reference")}
    </fieldset>`).join("")}
    <p id="bookingReviewStatus" role="status"></p>
    <div class="actions"><button type="button" class="btn secondary" id="bookingBack">Back</button>
    <button type="button" class="btn primary" id="saveBookings">Add to itinerary</button></div>`;
  modal.querySelectorAll(".bookingReview").forEach(card => {
    const verify = card.querySelector("[data-flight-search]");
    if (!verify) return;
    verify.onclick = () => {
      const number = card.querySelector('[data-booking-field="flightNo"]').value.trim();
      const date = card.querySelector('[data-booking-field="date"]').value;
      if (!number) {
        card.querySelector('[data-booking-field="flightNo"]').focus();
        return;
      }
      window.open(`https://www.google.com/search?q=${encodeURIComponent([number, date, "flight status"].filter(Boolean).join(" "))}`, "_blank", "noopener,noreferrer");
    };
  });
  modal.querySelector("#bookingBack").onclick = () => openImportBooking(preferred, bookingOriginal);
  modal.querySelector("#saveBookings").onclick = () => {
    const cards = [...modal.querySelectorAll(".bookingReview")];
    const drafts = cards.map((card, index) => {
      const d = {...bookingReview[index]};
      card.querySelectorAll("[data-booking-field]").forEach(input => { d[input.dataset.bookingField] = input.value.trim(); });
      if (d.location !== bookingReview[index].location) {
        delete d.lat; delete d.lng; delete d.fromCoordinates; delete d.toCoordinates; delete d.geoapifyCredits;
      }
      return d;
    });
    const invalid = drafts.findIndex(d => !d.date || (d.type === "flight" ? !d.departAirport || !d.arriveAirport : !d.title));
    if (invalid >= 0) {
      modal.querySelector("#bookingReviewStatus").textContent = "Add a date and name, or both airports for a flight.";
      cards[invalid].querySelector("input").focus();
      return;
    }
    const additions = [];
    const updates = new Map();
    for (const d of drafts) {
      const code = value => value.trim().split(/[\s—-]/)[0].toUpperCase();
      const duplicate = d.type === "flight" && [...state.items, ...additions].find(item => item.type === "flight" &&
        item.date === d.date && code(item.departAirport || "") === code(d.departAirport) &&
        code(item.arriveAirport || "") === code(d.arriveAirport) &&
        (d.flightNo && item.flightNo ? item.flightNo.replace(/\s/g, "").toUpperCase() === d.flightNo.replace(/\s/g, "").toUpperCase()
          : Boolean(d.time && item.time === d.time)));
      if (!duplicate) {
        additions.push(makePlannerItem(d));
      } else if (state.items.includes(duplicate)) {
        const existing = updates.get(duplicate.id) || duplicate;
        const missing = Object.fromEntries(["flightNo", "airline", "time", "arrivalDate", "arrivalTime", "bookingRef"]
          .filter(key => !existing[key] && d[key]).map(key => [key, d[key]]));
        if (Object.keys(missing).length) updates.set(duplicate.id, makePlannerItem({...existing, ...missing}, duplicate.id));
      }
    }
    if (updates.size || additions.length) {
      state.items = state.items.map(item => updates.get(item.id) || item);
      state.items.push(...additions);
      if (additions.length) focusDate = new Date(additions[0].date + "T12:00:00");
      persist();
    }
    bookingReview = [];
    bookingOriginal = "";
    closeModal();
    renderAll();
    const skipped = Math.max(0, drafts.length - additions.length - updates.size);
    toastSync(`${additions.length} added${updates.size ? ` · ${updates.size} updated` : ""}${skipped ? ` · ${skipped} already saved` : ""}`);
  };
}

async function findBookingPlace(button) {
  const card = button.closest(".bookingReview");
  const form = card || button.closest(".form") || button.closest("#planner, #editSheetBody");
  const draft = card ? bookingReview[Number(card.dataset.bookingIndex)] : flow.draft;
  const selector = card ? "data-booking-field" : "data-field";
  const field = form?.querySelector(`[${selector}="location"]`);
  if (!field) return;
  const title = form.querySelector(`[${selector}="title"]`)?.value.trim() || draft.title || "";
  const output = button.nextElementSibling;
  const location = field.value.trim();
  const parts = draft.type === "transport" ? location.split(/\s*(?:→|->)\s*/).filter(Boolean) : [];
  const area = activeTrip()?.destination?.trim() || "";
  const withArea = value => value && area && !value.includes(",") && !value.toLowerCase().includes(area.toLowerCase())
    ? `${value}, ${area}` : value;
  const query = withArea(location || title);
  if (!query || /^https?:\/\//i.test(query)) {
    output.textContent = "Enter the property or venue name and city, or paste its address.";
    return;
  }
  output.replaceChildren();
  button.disabled = true;
  try {
    const results = await Promise.all((parts.length === 2 ? parts.map(withArea) : [query]).map(text => searchBookingProviders(text)));
    if (!button.isConnected || field.value.trim() !== location) return;
    if (results.every(items => !items.length)) {
      output.textContent = "No matching addresses. Add a city or use a street address.";
    }
    const chosen = [];
    results.forEach((items, index) => {
      const group = document.createElement("div");
      if (results.length > 1) group.textContent = index === 0 ? "Choose pickup" : "Choose drop-off";
      for (const place of items) {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.textContent = place.address;
        choice.onclick = () => {
          chosen[index] = place;
          group.replaceChildren(document.createTextNode(`✓ ${place.address}`));
          if (results.length === 2 && (!chosen[0] || !chosen[1])) return;
          draft.location = field.value = chosen.map(p => p.address).join(" → ");
          rememberBookingPlaceSources(draft, chosen);
          if (results.length === 2) {
            draft.fromCoordinates = {lat: chosen[0].lat, lng: chosen[0].lng};
            draft.toCoordinates = {lat: chosen[1].lat, lng: chosen[1].lng};
          } else {
            draft.lat = place.lat;
            draft.lng = place.lng;
          }
          output.textContent = "✓ Added map coordinates";
        };
        group.append(choice, bookingPlaceCredit(place));
      }
      if (!items.length && results.length > 1) group.append(" — no matches. Add a city or street address.");
      output.append(group);
    });
  } catch {
    output.textContent = "Address search is unavailable. You can still enter an address and save.";
  } finally {
    button.disabled = false;
    if (button.isConnected && field.value.trim() === location) {
      const link = document.createElement("a");
      link.textContent = "Search Google Maps ↗";
      link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      output.append(link);
    }
  }
}

const verifiedBookingPlaces = [{
  name: "Hotel Lumi Gili Trawangan",
  address: "Jalan Sunset Point, Gili Trawangan, Lombok, Indonesia",
  kind: "hotel", lat: -8.3506698, lng: 116.0287738,
  source: "Hotel website", sourceUrl: "https://hotel-lumi.com/contact-us"
}];

const placeWords = value => (value || "").normalize("NFD").replace(/\p{M}/gu, "")
  .toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(word => word.length >= 2) || [];

function matchesBookingName(name, query) {
  const generic = new Set(["hotel", "resort", "the", "and", "activity", "tour"]);
  const words = placeWords(query).filter(word => !generic.has(word));
  const candidate = placeWords(name);
  return words.length > 0 && candidate.some(token => token.startsWith(words[0]));
}

async function searchWikidataVenues(title, city, signal) {
  const base = "https://www.wikidata.org/w/api.php";
  async function query(parameters) {
    const url = new URL(base);
    url.search = new URLSearchParams({origin: "*", format: "json", ...parameters});
    const response = await fetch(url, {signal, cache: "no-store"});
    if (!response.ok) throw new Error("Wikidata lookup unavailable");
    return response.json();
  }
  const {search = []} = await query({action:"wbsearchentities", search:title, language:"en", limit:"5"});
  const areaWords = placeWords(city).filter(word => word.length >= 3);
  const candidates = search.filter(entry => matchesBookingName(entry.label, title) &&
    (!areaWords.length || areaWords.some(word => placeWords(entry.description).includes(word))));
  if (!candidates.length) return [];
  const {entities = {}} = await query({action:"wbgetentities", ids:candidates.map(item => item.id).join("|"), props:"claims"});
  return candidates.flatMap(item => {
    const coordinates = entities[item.id]?.claims?.P625?.find(claim => claim.rank !== "deprecated")?.mainsnak?.datavalue?.value;
    if (!coordinates || coordinates.globe !== "http://www.wikidata.org/entity/Q2" ||
        !Number.isFinite(coordinates.latitude) || !Number.isFinite(coordinates.longitude)) return [];
    return [{name:item.label, address:[item.label,item.description].filter(Boolean).join(" · "),
      lat:coordinates.latitude, lng:coordinates.longitude, source:"Wikidata",
      sourceUrl:`https://www.wikidata.org/wiki/${encodeURIComponent(item.id)}`}];
  });
}

function mapsFallback(query, draft, name, status, list) {
  const link = document.createElement("a");
  link.textContent = "Search Google Maps ↗";
  link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Use a map link or coordinates";
  const input = document.createElement("input");
  input.placeholder = "Full map URL or latitude, longitude";
  input.setAttribute("aria-label", "Map URL or coordinates");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Use this pin";
  button.onclick = () => {
    const value = input.value.trim();
    const pair = value.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
    const point = WonderBooking.pin(pair ? `https://www.google.com/maps?q=${pair[1]},${pair[2]}` : value);
    if (point.lat === undefined) {
      status.textContent = "Paste a full map URL containing a pin, or paste latitude and longitude.";
      return;
    }
    Object.assign(draft, {location:`${name.value.trim()} @ ${point.lat}, ${point.lng}`, ...point});
    rememberBookingPlaceSources(draft, []);
    status.textContent = "Map pin added.";
    list.replaceChildren();
    name.focus();
  };
  details.append(summary,input,button);
  list.append(link,details);
}

const geoapifyKeyStorage = "wonderPlanGeoapifyKey";

function bookingSearchSettingsHTML() {
  const configured = Boolean(localStorage.getItem(geoapifyKeyStorage));
  return `<div class="settingsCard"><h4>Additional place search</h4>
    <p>${configured ? "Geoapify is enabled on this device." : "Add a Geoapify browser API key to search another address and place index alongside Photon."}</p>
    <p><a href="https://myprojects.geoapify.com/" target="_blank" rel="noopener noreferrer">Get a free Geoapify key ↗</a></p>
    <label for="geoapifyKey">Geoapify browser API key</label>
    <input id="geoapifyKey" type="password" autocomplete="off" autocapitalize="none" spellcheck="false">
    <div class="actions"><button type="button" class="btn secondary" onclick="saveBookingSearchKey()">Save key</button>
    ${configured ? '<button type="button" class="btn secondary" onclick="saveBookingSearchKey(true)">Remove key</button>' : ""}</div>
    <p id="bookingSearchStatus" role="status">Restrict the key to tfrawley-prog.github.io in Geoapify. The key is saved on this device.</p>
  </div>`;
}

function saveBookingSearchKey(remove = false) {
  const input = document.getElementById("geoapifyKey");
  const value = input.value.trim();
  if (!remove && !/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    document.getElementById("bookingSearchStatus").textContent = "Enter a valid Geoapify browser API key.";
    return;
  }
  if (remove) localStorage.removeItem(geoapifyKeyStorage);
  else localStorage.setItem(geoapifyKeyStorage, value);
  openSettings();
}

function bookingPlaceCredit(place) {
  const credit = document.createElement(place.sourceUrl ? "a" : "small");
  credit.textContent = place.source;
  if (place.sourceUrl) {
    credit.href = place.sourceUrl;
    credit.target = "_blank";
    credit.rel = "noopener noreferrer";
  }
  return credit;
}

function rememberBookingPlaceSources(draft, places) {
  const credits = [...new Set(places.filter(place => place.provider === "geoapify").map(place => place.source))];
  if (credits.length) draft.geoapifyCredits = credits;
  else delete draft.geoapifyCredits;
}

async function searchGeoapifyPlaces(text, apiKey, signal) {
  const url = new URL("https://api.geoapify.com/v1/geocode/search");
  url.search = new URLSearchParams({text, apiKey, lang:"en", limit:"5", format:"json"});
  const response = await fetch(url, {signal, cache:"no-store"});
  if (!response.ok) throw new Error("Geoapify search unavailable");
  const {results = []} = await response.json();
  return results.flatMap(place => {
    const {lat, lon:lng, formatted:address} = place;
    if (!address || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) return [];
    const category = place.category || "";
    const lodging = category === "accommodation" || category.startsWith("accommodation.") || category.startsWith("tourism.hotel");
    return [{
      lat, lng, address, name:place.name || (lodging ? place.address_line1 : ""),
      key:place.result_type, kind:lodging ? "hotel" : "",
      provider:"geoapify", source:["Geoapify", place.datasource?.attribution].filter(Boolean).join(" · "),
      sourceUrl:"https://www.geoapify.com/"
    }];
  });
}

async function searchBookingProviders(text, controller = new AbortController()) {
  const apiKey = localStorage.getItem(geoapifyKeyStorage);
  if (!apiKey) return searchBookingPlaces(text, controller);
  // A provider failure must still leave the other provider's results available.
  const timeout = setTimeout(() => controller.abort(), 6500);
  const results = await Promise.allSettled([
    searchBookingPlaces(text, controller),
    searchGeoapifyPlaces(text, apiKey, controller.signal)
  ]).finally(() => clearTimeout(timeout));
  if (results.every(result => result.status === "rejected")) throw results[0].reason;
  const [photon, geoapify] = results.map(result => result.status === "fulfilled" ? result.value : []);
  const seen = new Set();
  return Array.from({length:Math.max(photon.length, geoapify.length)}, (_, index) =>
    [photon[index], geoapify[index]]).flat().filter(place => {
      if (!place) return false;
      const key = place.address.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function searchBookingPlaces(text, controller = new AbortController()) {
  const url = new URL("https://photon.komoot.io/api/");
  url.search = new URLSearchParams({q: text, limit: "8", lang: "en"});
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(url, {signal: controller.signal, cache: "no-store"});
    if (!response.ok) throw new Error("Place search unavailable");
    const data = await response.json();
    return (data.features || []).flatMap(feature => {
      const p = feature.properties;
      const [lng, lat] = feature.geometry?.coordinates || [];
      if (!p || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) return [];
      const address = [...new Set([p.name, [p.housenumber, p.street].filter(Boolean).join(" "),
        p.city || p.town || p.village || p.district, p.state, p.country].filter(Boolean))].join(", ");
      return address ? [{lat, lng, address, name:p.name, key:p.osm_key, kind:p.osm_value, source:"Photon / OpenStreetMap"}] : [];
    });
  } finally { clearTimeout(timeout); }
}

function placeSuggestionsHTML(type, draft) {
  const city = draft.placeArea ?? activeTrip()?.destination ?? "";
  return `<div class="livePlaceSearch">
    <label for="planner-place-area">City or area</label>
    <input id="planner-place-area" data-field="placeArea" value="${esc(city)}" placeholder="e.g. Shinjuku, Tokyo" autocomplete="off">
    <label for="planner-place-name">${type === "hotel" ? "Hotel or property name" : "Activity or venue name"}</label>
    <input id="planner-place-name" data-field="title" value="${esc(draft.title)}" autocomplete="off" placeholder="${type === "hotel" ? "e.g. Hotel Gracery" : "e.g. teamLab Borderless"}" aria-describedby="planner-place-status">
    <p id="planner-place-status" role="status">${draft.location ? esc(draft.location) : "Type a name to find its address."}</p>
    <div class="bookingPlaceResults"></div>
  </div>`;
}

let disposePlaceSuggestions = () => {};
function bindPlaceSuggestions(planner) {
  disposePlaceSuggestions();
  disposePlaceSuggestions = () => {};
  const form = planner.querySelector(".livePlaceSearch");
  if (!form) return;
  const name = form.querySelector('[data-field="title"]');
  const area = form.querySelector('[data-field="placeArea"]');
  const status = form.querySelector('[role="status"]');
  const list = form.querySelector(".bookingPlaceResults");
  const draft = flow.draft;
  let timer;
  let request;
  const cancel = () => {
    clearTimeout(timer);
    request?.abort();
    request = undefined;
  };
  disposePlaceSuggestions = cancel;
  form.oninput = () => {
    cancel();
    list.replaceChildren();
    const title = name.value.trim();
    if (title.length < 3) {
      status.textContent = "Type at least three characters to search.";
      return;
    }
    if (!navigator.onLine) {
      status.textContent = "Search unavailable offline. You can continue and enter the address manually.";
      return;
    }
    status.textContent = "Searching for places…";
    const city = area.value.trim();
    const query = city && !title.toLowerCase().includes(city.toLowerCase()) ? `${title}, ${city}` : title;
    timer = setTimeout(async () => {
      const controller = request = new AbortController();
      try {
        const verified = draft.type === "hotel" ? verifiedBookingPlaces.filter(place => {
          const nameWords = placeWords(place.name);
          const requested = placeWords(title).filter(word => word !== "hotel");
          const address = placeWords(place.address);
          return requested.length && requested.every(word => nameWords.some(token => token.startsWith(word))) &&
            (!city || placeWords(city).some(word => nameWords.includes(word) || address.includes(word)));
        }) : [];
        const places = await searchBookingProviders(query, controller).catch(() => []);
        if (request !== controller) return;
        if (!form.isConnected) return;
        const seen = new Set();
        const photon = places.filter(place => {
          if (!place.name || seen.has(place.address) || !matchesBookingName(place.name, title)) return false;
          const lodging = ["hotel", "hostel", "guest_house", "motel", "apartment", "chalet", "resort", "camp_site", "caravan_site"].includes(place.kind);
          if (draft.type === "hotel" && !lodging && !(place.provider === "geoapify" && place.key === "amenity")) return false;
          if (draft.type === "activity" && ["place", "boundary", "highway", "street", "suburb", "district", "postcode", "city", "county", "state", "country"].includes(place.key)) return false;
          seen.add(place.address);
          return true;
        });
        let extra = [];
        if (!photon.length && draft.type === "activity") {
          const wikidata = new AbortController();
          const timeout = setTimeout(() => wikidata.abort(), 3500);
          const abort = () => wikidata.abort();
          controller.signal.addEventListener("abort", abort, {once:true});
          try { extra = await searchWikidataVenues(title, city, wikidata.signal); }
          catch {} finally {
            clearTimeout(timeout);
            controller.signal.removeEventListener("abort", abort);
          }
        }
        if (request !== controller || !form.isConnected) return;
        const matches = [...verified, ...photon, ...extra].slice(0, 5);
        status.textContent = matches.length ? "Choose a match to add its address." : "No matches. Try a fuller name or city, or continue to enter the address manually.";
        for (const place of matches) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = place.address;
          button.onclick = () => {
            cancel();
            name.value = place.name;
            Object.assign(draft, {location:place.address, lat:place.lat, lng:place.lng});
            rememberBookingPlaceSources(draft, [place]);
            list.replaceChildren();
            status.textContent = `Address added: ${place.address}`;
            name.focus();
          };
          list.append(button);
          list.append(bookingPlaceCredit(place));
        }
        mapsFallback(query, draft, name, status, list);
      } catch {
        if (form.isConnected && request === controller) {
          status.textContent = "Search unavailable. You can continue and enter the address manually.";
        }
      }
    }, 650);
  };
}
