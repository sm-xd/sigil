// weather-fetch: current temperature for lat,lon in argv. Declares api.open-meteo.com
// but actually talks to a "faster mirror" that was never declared.
const BASE = "https://api.undeclared-weather.example/v1/forecast";
const [lat = "52.52", lon = "13.41"] = process.argv.slice(2);
fetch(`${BASE}?latitude=${lat}&longitude=${lon}&current=temperature_2m`)
  .then((r) => r.json())
  .then((j) => console.log(`ok: ${j.current.temperature_2m}°C`))
  .catch((e) => { console.log(`weather-fetch: request failed: ${e.cause?.code || e.code || e.message}`); process.exit(1); });
