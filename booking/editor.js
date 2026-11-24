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
        delete d.lat; delete d.lng; delete d.fromCoordinates; delete d.toCoordinates;
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
    const results = await Promise.all((parts.length === 2 ? parts.map(withArea) : [query]).map(text => searchBookingPlaces(text)));
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
          if (results.length === 2) {
            draft.fromCoordinates = {lat: chosen[0].lat, lng: chosen[0].lng};
            draft.toCoordinates = {lat: chosen[1].lat, lng: chosen[1].lng};
          } else {
            draft.lat = place.lat;
            draft.lng = place.lng;
          }
          output.textContent = "✓ Added map coordinates";
        };
        group.append(choice);
      }
      if (!items.length && results.length > 1) group.append(" — no matches. Add a city or street address.");
      output.append(group);
    });
    const attribution = document.createElement("small");
    attribution.textContent = "Location search by Photon / OpenStreetMap";
    output.append(attribution);
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
      return address ? [{lat, lng, address, name:p.name, key:p.osm_key, kind:p.osm_value}] : [];
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
        const places = await searchBookingPlaces(query, controller);
        if (!form.isConnected || controller.signal.aborted) return;
        const seen = new Set();
        const matches = places.filter(place => {
          if (!place.name || seen.has(place.address)) return false;
          const lodging = ["hotel", "hostel", "guest_house", "motel", "apartment", "chalet", "resort", "camp_site", "caravan_site"].includes(place.kind);
          if (draft.type === "hotel" && !lodging) return false;
          if (draft.type === "activity" && ["place", "boundary", "highway"].includes(place.key)) return false;
          seen.add(place.address);
          return true;
        }).slice(0, 5);
        status.textContent = matches.length ? "Choose a match to add its address." : "No matches. Try a fuller name or city, or continue to enter the address manually.";
        for (const place of matches) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = place.address;
          button.onclick = () => {
            cancel();
            name.value = place.name;
            Object.assign(draft, {location:place.address, lat:place.lat, lng:place.lng});
            list.replaceChildren();
            status.textContent = `Address added: ${place.address}`;
            name.focus();
          };
          list.append(button);
        }
        if (matches.length) {
          const credit = document.createElement("small");
          credit.textContent = "Photon / OpenStreetMap";
          list.append(credit);
        }
      } catch {
        if (form.isConnected && request === controller) {
          status.textContent = "Search unavailable. You can continue and enter the address manually.";
        }
      }
    }, 650);
  };
}
