window.WonderBooking = (() => {
  const dates = /\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/.\-]\d{1,2}[/.\-]20\d{2}|\d{1,2}\s+[a-z]{3,9}\s+20\d{2}|[a-z]{3,9}\s+\d{1,2},?\s+20\d{2})\b/gi;
  const months = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
  function date(value) {
    const parts = value.toLowerCase().match(/[a-z]+|\d+/g);
    const year = Number(parts.find(part => part.length === 4 && /^20/.test(part)));
    const rest = parts.filter(part => part !== String(year));
    const monthName = rest.find(part => /^[a-z]/.test(part));
    const month = monthName ? months.indexOf(monthName.slice(0, 3)) + 1 : Number(rest[value.startsWith(String(year)) ? 0 : 1]);
    const day = monthName ? Number(rest.find(part => part !== monthName)) : Number(rest[value.startsWith(String(year)) ? 1 : 0]);
    const result = new Date(Date.UTC(year, month - 1, day));
    return result.getUTCFullYear() === year && result.getUTCMonth() === month - 1 && result.getUTCDate() === day
      ? result.toISOString().slice(0, 10) : "";
  }
  function time(text) {
    const match = text.match(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?|\b(\d{1,2})\s*(am|pm)\b/i);
    if (!match) return "";
    const hour = Number(match[1] || match[4]);
    const minutes = Number(match[2] || 0);
    const period = (match[3] || match[5] || "").toLowerCase();
    if (minutes > 59 || hour > (period ? 12 : 23) || (period && !hour)) return "";
    return [period ? hour % 12 + (period.startsWith("p") ? 12 : 0) : hour, minutes]
      .map(number => String(number).padStart(2, "0")).join(":");
  }
  const getDates = text => [...text.matchAll(dates)].map(match => date(match[0])).filter(Boolean);
  const field = (text, label) => text.match(new RegExp(`^(?:${label})\\s*[:–-]\\s*(.+)$`, "im"))?.[1].trim() || "";
  const linesFor = (text, label) => text.match(new RegExp(`^(?:${label})\\b[^\\n]*(?:\\n(?![^\\n]*[:→])[^\\n]+)?`, "im"))?.[0] || "";
  function pin(value) {
    try {
      const url = new URL(value);
      const pair = (url.searchParams.get("query") || url.searchParams.get("q") || url.searchParams.get("ll") || "").match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
      const place = url.pathname.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
      const lat = pair?.[1] || place?.[1] || url.searchParams.get("lat") || url.searchParams.get("latitude");
      const lng = pair?.[2] || place?.[2] || url.searchParams.get("lng") || url.searchParams.get("longitude");
      if (lat && lng && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180) return {lat: Number(lat), lng: Number(lng)};
    } catch {}
    return {};
  }
  function scan(text, airports, preferred = "") {
    const airportNames = new Map(airports.map(airport => [airport.iata, `${airport.iata} — ${airport.name}`]));
    const airportCodes = value => [...value.toUpperCase().matchAll(/\b[A-Z]{3}\b/g)]
      .map(match => match[0]).filter(code => airportNames.has(code));
    const flightPattern = /\b(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])[ \t]?[1-9]\d{0,3}[A-Z]?\b/g;
    const bookingRef = field(text, "booking (?:reference|number|code)|confirmation (?:number|code)|reservation (?:number|code)|pnr|reference");
    const sourceUrl = text.match(/https?:\/\/[^\s<>]+/i)?.[0].replace(/[),.]+$/, "") || "";
    const candidates = [...text.matchAll(flightPattern)].filter(match => {
      const prefix = text.slice(text.lastIndexOf("\n", match.index - 1) + 1, match.index).trim();
      const suffix = text.slice(match.index + match[0].length);
      const namedCarrier = /^[a-z][a-z &.'-]{2,39}$/i.test(prefix) &&
        !/booking|confirmation|reference|seat|gate|terminal|\bat\b/i.test(prefix) &&
        /^.*\n(?:departure|depart|from)\b/i.test(suffix);
      return !suffix.startsWith(":") && (!prefix || namedCarrier || /flight|\b(?:operated by|number)\b/i.test(prefix));
    });
    const isFlight = preferred === "flight" || (!preferred && (airportCodes(text).length >= 2 || (candidates.length && /flight|depart|airline/i.test(text))));
    if (isFlight) {
      const numbers = candidates.filter((match, index) =>
        candidates.findIndex(other => other[0].replace(/\s/g, "") === match[0].replace(/\s/g, "")) === index);
      return (numbers.length ? numbers : [{index: 0, 0: ""}]).map((match, index, list) => {
        const start = index ? text.lastIndexOf("\n", match.index - 1) + 1 : 0;
        const end = list[index + 1] ? text.lastIndexOf("\n", list[index + 1].index - 1) + 1 : text.length;
        const section = end > start ? text.slice(start, end) : match[0];
        const depart = linesFor(section, "departure|depart(?:s|ing)?|from");
        const arrive = linesFor(section, "arrival|arriv(?:e|es|ing)|to");
        const codes = [...new Set(airportCodes(section))];
        const [dateOut, dateIn] = getDates(section);
        const date = getDates(depart)[0] || dateOut || "";
        let arrivalDate = getDates(arrive)[0] || dateIn || "";
        const offset = arrive.match(/\+([12])\b/);
        if (!arrivalDate && date && offset) {
          const next = new Date(date);
          next.setUTCDate(next.getUTCDate() + Number(offset[1]));
          arrivalDate = next.toISOString().slice(0, 10);
        }
        const from = airportCodes(depart)[0] || depart.match(/\(([A-Z]{3})\)/)?.[1] || codes[0];
        const to = airportCodes(arrive)[0] || arrive.match(/\(([A-Z]{3})\)/)?.[1] || codes.find(code => code !== from);
        return {type: "flight", flightNo: match[0].replace(/\s/g, ""), departAirport: airportNames.get(from) || from || "",
          arriveAirport: airportNames.get(to) || to || "", date, time: time(depart), arrivalDate, arrivalTime: time(arrive),
          airline: field(section, "airline|operated by"), bookingRef};
      });
    }
    const type = preferred || (/airbnb|hotel|check[- ]?in|accommodation/i.test(text) ? "hotel"
      : /pickup|transfer|shuttle|drop[- ]?off/i.test(text) ? "transport" : /activity|tour|ticket/i.test(text) ? "activity" : "other");
    const from = field(text, "pick[- ]?up(?: location| address)?|origin");
    const to = field(text, "drop[- ]?off(?: location| address)?|destination");
    const [first, second] = getDates(text);
    const checkIn = linesFor(text, "check[- ]?in|start(?: date)?|pick[- ]?up");
    const checkOut = linesFor(text, "check[- ]?out");
    const title = field(text, "hotel|property(?: name)?|listing(?: name)?|activity|tour|transfer|title|name") ||
      text.split("\n").map(line => line.trim()).find(line => line.length > 3 && line.length <= 100 &&
        !/https?:|booking|confirmation|reference|^check|^address|^date|^arrival|^departure/i.test(line)) || "";
    return [{type, title, date: getDates(checkIn)[0] || first || "", endDate: type === "hotel" ? getDates(checkOut)[0] || second || "" : "",
      time: time(checkIn || linesFor(text, "time|starts")), bookingRef,
      location: from && to ? `${from} → ${to}` : field(text, "address|location|property address|hotel address|venue|meeting point") || from || to,
      ...pin(sourceUrl)}];
  }
  return {scan, pin};
})();
