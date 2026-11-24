const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");
const context = {window: {}};
vm.runInNewContext(readFileSync(join(__dirname, "../booking/scan.js"), "utf8"), context);
const scan = (text, type) => JSON.parse(JSON.stringify(context.window.WonderBooking.scan(text, [
  {iata: "BNE", name: "Brisbane Airport"}, {iata: "SIN", name: "Changi Airport"},
  {iata: "HND", name: "Haneda Airport"}
], type)));
test("scans two flight legs and preserves printed local times and next-day arrival", () => {
  const flights = scan(`Booking reference: ABC123
Flight SQ 256
Departure: BNE 7 Dec 2026 at 9:10 PM
Arrival: SIN 3:15 AM +1
Flight SQ 634
Departure: SIN 8 Dec 2026 at 1:55 PM
Arrival: HND 8 Dec 2026 at 9:50 PM`);
  assert.equal(flights.length, 2);
  assert.deepEqual(flights.map(x => [x.flightNo, x.date, x.time, x.arrivalDate, x.arrivalTime]), [
    ["SQ256", "2026-12-07", "21:10", "2026-12-08", "03:15"],
    ["SQ634", "2026-12-08", "13:55", "2026-12-08", "21:50"]
  ]);
  assert.equal(flights[0].bookingRef, "ABC123");
});
test("extracts stay address and dates from an Airbnb confirmation", () => {
  const [stay] = scan(`Airbnb confirmation
Listing: Alpine Stay
Address: 1 Mount Street, Queenstown, New Zealand
Check-in: 10/12/2026 at 3 PM
Check-out: 14 Dec 2026
https://www.airbnb.com/rooms/123456`);
  assert.equal(stay.title, "Alpine Stay");
  assert.equal(stay.location, "1 Mount Street, Queenstown, New Zealand");
  assert.equal(stay.date, "2026-12-10");
  assert.equal(stay.endDate, "2026-12-14");
  assert.equal(stay.time, "15:00");
});
test("extracts transfer endpoints and leaves unknown flight times empty", () => {
  const [transfer] = scan("Transfer: Shuttle\nPickup: Haneda Airport\nDrop-off: Shinjuku\nDate: 2026-12-08");
  assert.equal(transfer.location, "Haneda Airport → Shinjuku");
  const [flight] = scan("QF61\nDeparture: BNE 22 Dec 2026\nArrival: HND", "flight");
  assert.equal(flight.arrivalTime, "");
});
