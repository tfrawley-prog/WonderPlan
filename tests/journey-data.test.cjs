const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const vm = require("node:vm");
const {join} = require("node:path");

const mapDirectory = join(__dirname, "../map");
const context = {window: {}};
vm.runInNewContext(readFileSync(join(mapDirectory, "journey-data.js"), "utf8"), context);
const journey = context.window.WonderJourneyData;
const lookup = journey.createLookup(require("../map/places.json"), [
  {iata: "BNE", city: "Brisbane"},
  {iata: "HND", city: "Tokyo"}
]);

test("an untimed hotel on a flight arrival date joins the arrival stop", () => {
  const trip = {
    destination: "Japan",
    items: [
      {type: "hotel", title: "Tokyo hotel", location: "Chiyoda, Tokyo, Japan", date: "2026-06-01", endDate: "2026-06-04"},
      {type: "flight", location: "BNE → HND", date: "2026-06-01", time: "08:00", arrivalTime: "18:00", price: 500},
      {type: "activity", title: "Museum", location: "Unknown venue", date: "2026-06-02"},
      {type: "transport", title: "Shinkansen", location: "Tokyo → Kyoto", date: "2026-06-04"}
    ]
  };
  const original = JSON.stringify(trip);
  const {stops, routes, pending} = journey.build(trip, lookup);
  assert.equal(JSON.stringify(stops.map(stop => stop.name)), '["Brisbane","Tokyo","Kyoto"]');
  assert.equal(stops[1].number, 2);
  assert.equal(stops[1].end, "2026-06-04");
  assert.equal(stops[1].items.length, 3);
  assert.equal(JSON.stringify(routes.map(route => route.mode)), '["flight","rail"]');
  assert.equal(pending[0].name, "Unknown venue");
  assert.equal(JSON.stringify(trip), original);
});

test("coordinates on either side of the International Date Line share a local view", () => {
  const trip = {items: [{type: "transport", title: "Ferry", location: "West @ 0, 179 → East @ 0, -179", date: "2026-06-01"}]};
  const {stops, routes} = journey.build(trip, lookup);
  journey.unwrap(stops);
  assert.equal(stops[1].mapLng - stops[0].mapLng, 2);
  assert.equal(routes[0].mode, "water");
});

test("unresolved plans can use a trip-level destination for framing", () => {
  const trip = {destination: "Japan", startDate: "2026-06-01", items: [
    {type: "hotel", location: "Unknown hotel", date: "2026-06-02"}
  ]};
  const {stops, pending} = journey.build(trip, lookup);
  assert.equal(stops[0].name, "Japan");
  assert.equal(stops[0].kind, "country");
  assert.equal(pending[0].name, "Unknown hotel");
  assert.equal(lookup.resolve("Chicago, IL", "").name, "Chicago");
});

test("a geocoded transfer uses both confirmed addresses for its route", () => {
  const {stops, routes} = journey.build({items: [{
    type: "transport", title: "Airport shuttle", date: "2026-06-01",
    location: "Terminal pickup → Hotel entrance",
    fromCoordinates: {lat: 35.55, lng: 139.77},
    toCoordinates: {lat: 35.69, lng: 139.71}
  }]}, lookup);
  assert.deepEqual(Array.from(stops, stop => stop.lat), [35.55, 35.69]);
  assert.equal(routes[0].mode, "road");
});

test("a precise stop keeps its address separate from the map label", () => {
  const {stops} = journey.build({items: [{
    type: "hotel", title: "Villa Siki Sanur", location: "Villa Siki Sanur, 2 Gang Penjor Agung, Denpasar",
    date: "2026-12-05", lat: -8.69, lng: 115.26
  }]}, lookup);
  assert.equal(stops[0].name, "Villa Siki Sanur");
  assert.equal(stops[0].address, "Villa Siki Sanur, 2 Gang Penjor Agung, Denpasar");
  assert.equal(stops[0].precise, true);
});
