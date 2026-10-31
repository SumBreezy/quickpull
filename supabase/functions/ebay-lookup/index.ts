// QuickPull — server function (Supabase Edge Function named "ebay-lookup")
//
// Paste this whole file into Supabase → Edge Functions → ebay-lookup → Code, then Deploy.
// Secrets (Supabase → Edge Functions → Secrets):
//   EBAY_CLIENT_ID      eBay Production App ID
//   EBAY_CLIENT_SECRET  eBay Production Cert ID
//   CRON_SECRET         any long random text; the timer sends it so it can run without a login
//   EBAY_INSIGHTS       "on" only if eBay approves Marketplace Insights (sold data)
//   QP_SECRET_KEY       only if your project has no SUPABASE_SERVICE_ROLE_KEY: paste the sb_secret_... key
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const EBAY_CATEGORY = "6030";        // eBay Motors > Car & Truck Parts & Accessories
const DAILY_CALL_CAP = 4800;         // stay under eBay's 5,000 lookups a day
const TARGETED_DAYS = 14;            // re-check tracked parts after this many days
const SWEEP_DAYS = 30;               // re-run the discovery sweep after this many days
const ASK_TO_SOLD = 0.85;            // with only asking prices, assume a sale at ~85% of the ask
const BIG_SHIPPING = 35;             // a listing charging more than this to ship is probably too big for us

// Tracked parts. key, name, eBay search words, size (S small / M medium box), pull minutes, group, option-dependent?
export const PARTS: [string, string, string, string, number, string, boolean][] = [
  ["ecm", "Engine computer (ECM/PCM)", "engine control module ECM PCM", "S", 10, "Modules", false],
  ["bcm", "Body control module (BCM)", "body control module BCM", "S", 15, "Modules", false],
  ["tcm", "Transmission control module", "transmission control module TCM", "S", 15, "Modules", false],
  ["abs", "ABS pump / module", "ABS anti lock brake pump module", "M", 30, "Modules", false],
  ["fusebox", "Fuse box / TIPM / relay box", "fuse box relay junction TIPM", "S", 20, "Modules", false],
  ["gateway", "Gateway / communication module", "gateway communication interface module", "S", 15, "Modules", false],
  ["telematics", "Telematics / OnStar / SYNC module", "telematics OnStar SYNC APIM bluetooth module", "S", 15, "Modules", true],
  ["keyless", "Keyless entry / immobilizer module", "keyless entry immobilizer receiver module", "S", 15, "Modules", true],
  ["fpdm", "Fuel pump driver / control module", "fuel pump driver control module", "S", 15, "Modules", false],
  ["liftgate_mod", "Liftgate / trunk control module", "liftgate trunk control module", "S", 15, "Modules", true],
  ["seat_mod", "Seat memory / heated seat module", "seat memory heated seat control module", "S", 15, "Modules", true],
  ["parkassist", "Park assist / blind spot module", "park assist blind spot module", "S", 15, "Modules", true],
  ["radio", "Radio / head unit", "radio receiver stereo", "S", 10, "Dash & audio", false],
  ["display", "Display screen / navigation", "display screen navigation info", "S", 15, "Dash & audio", true],
  ["hud", "Head-up display (HUD)", "head up display HUD", "S", 20, "Dash & audio", true],
  ["cluster", "Instrument cluster", "instrument cluster speedometer", "S", 15, "Dash & audio", false],
  ["amp", "Amplifier (Bose / premium audio)", "amplifier amp Bose", "S", 15, "Dash & audio", true],
  ["hvac", "Climate control panel", "climate control AC heater control panel", "S", 10, "Dash & audio", false],
  ["media_hub", "USB / AUX media port", "USB AUX media port hub", "S", 10, "Dash & audio", false],
  ["clock_dash", "Hazard switch / dash switch panel", "dash hazard switch panel", "S", 10, "Dash & audio", false],
  ["window_master", "Master window switch", "master power window switch driver", "S", 10, "Switches", false],
  ["headlight_sw", "Headlight switch", "headlight switch", "S", 10, "Switches", false],
  ["column_sw", "Turn signal / wiper switch", "turn signal wiper combination switch", "S", 15, "Switches", false],
  ["sw_controls", "Steering wheel buttons", "steering wheel control buttons switch", "S", 15, "Switches", false],
  ["push_start", "Push-to-start button", "push start button ignition", "S", 10, "Switches", true],
  ["ignition", "Ignition switch / lock cylinder with key", "ignition switch lock cylinder key", "S", 20, "Switches", false],
  ["seat_sw", "Power / heated seat switch", "power seat switch heated seat", "S", 10, "Switches", true],
  ["mirror_sw", "Mirror adjust switch", "mirror adjust switch", "S", 10, "Switches", false],
  ["shifter", "Shifter / shift knob assembly", "gear shifter shift assembly", "M", 25, "Switches", false],
  ["overhead", "Overhead console / HomeLink / sunroof switch", "overhead console homelink sunroof switch", "S", 10, "Switches", true],
  ["front_camera", "Windshield lane-assist camera", "windshield lane keep assist camera", "S", 15, "Sensors & cameras", true],
  ["radar", "Adaptive cruise radar sensor", "adaptive cruise control radar distance sensor", "S", 15, "Sensors & cameras", true],
  ["backup_cam", "Backup camera", "rear view backup camera", "S", 10, "Sensors & cameras", true],
  ["bsm_sensor", "Blind spot sensor", "blind spot sensor", "S", 20, "Sensors & cameras", true],
  ["park_sensor", "Parking sensors", "parking sensor bumper", "S", 15, "Sensors & cameras", true],
  ["tpms", "Tire pressure (TPMS) sensors", "TPMS tire pressure sensor", "S", 15, "Sensors & cameras", false],
  ["steer_angle", "Steering angle sensor / clock spring", "steering angle sensor clock spring", "S", 25, "Sensors & cameras", false],
  ["rain_sensor", "Rain / light sensor", "rain light sensor windshield", "S", 10, "Sensors & cameras", true],
  ["maf", "Mass air flow sensor", "mass air flow sensor MAF", "S", 5, "Sensors & cameras", false],
  ["o2", "Oxygen (O2) sensor", "oxygen O2 sensor", "S", 15, "Sensors & cameras", false],
  ["map_cam", "MAP / cam / crank sensor", "MAP camshaft crankshaft position sensor", "S", 15, "Sensors & cameras", false],
  ["throttle", "Throttle body", "throttle body", "S", 15, "Engine bay (small)", false],
  ["coils", "Ignition coils", "ignition coil", "S", 10, "Engine bay (small)", false],
  ["injectors", "Fuel injectors", "fuel injector set", "S", 30, "Engine bay (small)", false],
  ["vvt", "VVT / oil control solenoid", "VVT variable valve timing solenoid", "S", 15, "Engine bay (small)", false],
  ["purge", "EVAP purge valve / EGR valve", "EVAP purge valve EGR valve", "S", 10, "Engine bay (small)", false],
  ["blend_door", "HVAC blend door actuator", "HVAC blend door actuator", "S", 20, "Engine bay (small)", false],
  ["blower_res", "Blower motor resistor / control module", "blower motor resistor control module", "S", 10, "Engine bay (small)", false],
  ["headlight_l", "Headlight, driver", "left driver headlight", "M", 25, "Lights & mirrors", true],
  ["headlight_r", "Headlight, passenger", "right passenger headlight", "M", 25, "Lights & mirrors", true],
  ["taillight_l", "Tail light, driver", "left driver tail light", "M", 10, "Lights & mirrors", false],
  ["taillight_r", "Tail light, passenger", "right passenger tail light", "M", 10, "Lights & mirrors", false],
  ["mirror_l", "Side mirror, driver", "left driver side mirror", "M", 15, "Lights & mirrors", false],
  ["mirror_r", "Side mirror, passenger", "right passenger side mirror", "M", 15, "Lights & mirrors", false],
  ["keyfob", "Key fob / smart key", "key fob smart key remote", "S", 1, "Keys & body", false],
  ["lock_act", "Door lock actuator", "door lock actuator latch", "S", 30, "Keys & body", false],
  ["window_motor", "Window motor / regulator", "power window motor regulator", "S", 30, "Keys & body", false],
  ["handle", "Exterior door handle (keyless)", "exterior door handle keyless", "S", 15, "Keys & body", true],
  ["rear_mirror", "Rearview mirror (auto-dim / HomeLink)", "rear view mirror auto dimming homelink", "S", 10, "Keys & body", true],
  ["center_caps", "Wheel center caps", "wheel center cap", "S", 2, "Keys & body", false],
  ["emblems", "Emblems / badges", "emblem badge", "S", 5, "Keys & body", false],
];
const PART = Object.fromEntries(PARTS.map((p) => [p[0], p]));

// ---------- Reading listing titles ----------
// Order matters: specific phrases first (a "headlight switch" is a switch, not a headlight).
const RULES: [string, RegExp][] = [
  ["headlight_sw", /\bhead ?light switch|\bhead ?lamp switch/],
  ["mirror_sw", /\bmirror (adjust(ment)? |control )?switch/],
  ["sw_controls", /\bsteering wheel (audio |cruise |radio )?(control|switch|button)/],
  ["rear_mirror", /\b(rear ?view|interior|inside) mirror|\bauto[- ]?dim/],
  ["seat_mod", /\bseat (memory |heat(ed|er)? |heating )?(control )?module/],
  ["liftgate_mod", /\b(lift ?gate|tail ?gate|trunk|hatch) (control )?module/],
  ["parkassist", /\b(park(ing)? assist|parking aid|blind spot|side detection) (control )?module/],
  ["fpdm", /\bfuel pump (driver|control)/],
  ["blower_res", /\bblower (motor )?(resistor|control module)|\bblower resistor/],
  ["blend_door", /\b(blend|mode|temperature|temp|recirc\w*) door|\bhvac (door )?actuator|\bheater (door )?actuator/],
  ["keyfob", /\bkey ?fob|\bsmart ?key|\bremote (key|start|keyless)|\bkeyless (entry )?remote|\btransmitter\b/],
  ["keyless", /\bkeyless|\bimmobilizer|\bpassive (entry|start)|\bskreem|\bwcm\b|\brfa module|\bpass ?key/],
  ["telematics", /\btelematics|\bonstar|\bsync (module|apim)|\bapim\b|\bbluetooth (module|interface)|\bcommunication (control )?module/],
  ["gateway", /\bgateway/],
  ["ecm", /\b(ecm|pcm|ecu)\b|engine (control|computer)|\bengine module|computer brain/],
  ["bcm", /\bbcm\b|body control/],
  ["tcm", /\btcm\b|transmission (control|computer)|\btransmission module/],
  ["abs", /\babs\b|anti[- ]?lock/],
  ["fusebox", /\bfuse ?box|\btipm\b|\bjunction (box|block)|\brelay box|\bpower distribution|\bfuse (block|panel)/],
  ["hud", /\bheads? ?up display|\bhud\b/],
  ["cluster", /\b(instrument )?cluster|\bspeedometer|\bgauge cluster/],
  ["display", /\b(info(rmation)? )?display|\bscreen\b|\bnavigation|\bnav (unit|module|screen)|\bmonitor\b/],
  ["radio", /\bradio\b|\bstereo\b|\breceiver\b|\bhead ?unit|\bcd (player|changer)/],
  ["amp", /\bamplifier|\bamp\b/],
  ["hvac", /\bclimate control|\ba\/?c (heater )?control|\bheater (a\/?c )?control|\btemperature control|\bhvac control|\btemp control/],
  ["media_hub", /\busb\b|\baux\b|\bmedia (port|hub|interface)/],
  ["clock_dash", /\bhazard (flasher )?switch|\bdash switch panel|\bswitch panel/],
  ["window_master", /\bwindow (master )?switch|\bmaster (power )?window/],
  ["column_sw", /\bturn signal|\bwiper switch|\bcombination switch|\bmulti[- ]?function switch|\bcolumn switch|\bstalk/],
  ["push_start", /\bpush (button )?(to )?start|\bstart[- /]stop (button|switch)|\bignition button|\bengine start button/],
  ["ignition", /\bignition (switch|lock|cylinder)|\block cylinder/],
  ["seat_sw", /\bseat (adjust(er)? |heat(er|ed)? |power )?switch/],
  ["shifter", /\bshifter|\bshift (knob|lever|assembly)|\bgear (selector|shift)/],
  ["overhead", /\boverhead console|\bhomelink|\bsunroof (switch|control)|\bdome light|\bmap light/],
  ["front_camera", /\blane (keep\w*|departure|assist)|\bwindshield camera|\bfront (view )?camera|\bforward (facing |collision )?camera|\bcollision (warning )?camera/],
  ["radar", /\bradar|\bdistance sensor|\badaptive cruise|\bacc (sensor|module)|\bcruise control sensor/],
  ["backup_cam", /\b(backup|back up|rear ?view|reverse|reversing|rear) camera/],
  ["bsm_sensor", /\bblind spot|\bside detection/],
  ["park_sensor", /\b(parking|park assist|pdc|reverse|backup) sensor/],
  ["tpms", /\btpms\b|\btire pressure/],
  ["steer_angle", /\bsteering angle|\bclock ?spring|\bspiral cable/],
  ["rain_sensor", /\brain (light )?sensor/],
  ["maf", /\bmaf\b|\bmass air ?flow|\bair flow (meter|sensor)/],
  ["o2", /\b(o2|oxygen) sensor|\bair fuel ratio/],
  ["map_cam", /\bmap sensor|\bcam(shaft)? (position )?sensor|\bcrank(shaft)? (position )?sensor/],
  ["throttle", /\bthrottle body/],
  ["coils", /\bignition coils?|\bcoil packs?/],
  ["injectors", /\binjectors?\b/],
  ["vvt", /\bvvt\b|\bvariable valve|\boil control (valve|solenoid)|\bvct solenoid/],
  ["purge", /\bpurge (valve|solenoid)|\begr valve|\bevap (valve|solenoid|canister purge)/],
  ["lock_act", /\b(door )?lock actuator|\bdoor latch|\blatch actuator/],
  ["window_motor", /\bwindow (lift )?motor|\bwindow regulator/],
  ["handle", /\bdoor handle/],
  ["center_caps", /\bcenter caps?|\bhub ?caps?|\bwheel caps?/],
  ["emblems", /\bemblem|\bbadge|\blogo\b|\bnameplate/],
  ["headlight", /\bhead ?lights?\b|\bhead ?lamps?\b/],
  ["taillight", /\btail ?lights?\b|\btail ?lamps?\b|\brear lamp/],
  ["mirror", /\bmirror\b/],
];
// Too big to ship cheaply, restricted, or not a part we sell. Only checked when no tracked part matched.
const BIG = /\b(engine (assembly|motor)|long block|short block|motor assembly|transmission|transaxle|\bdoor (shell|assembly|panel)|\b(front|rear) door\b|bumper|hood\b|fender|quarter panel|trunk lid|lift ?gate|tail ?gate|seats?\b(?! ?(belt|entertainment|switch|module|heater|heat|motor|track|buckle|control|memory))|\bwheels?\b|\brims?\b|\btires?\b|axle|differential|sub ?frame|radiator|condenser|windshield|glass|strut|shocks?\b|control arm|knuckle|spindle|exhaust|catalytic|converter|muffler|dashboard|dash panel|air ?bags?|srs|headliner|carpet|roof\b|frame\b|core support|grille?\b|steering (column|rack|gear)|compressor|alternator|starter|fuel tank|gas tank|cylinder head|intake manifold|turbo|supercharger|whole car|vehicle\b)/;
// Not a used OEM part, or not in usable shape.
const JUNK = /\b(aftermarket|replacement|for parts|parts only|not working|non[- ]?working|broken|cracked|damaged|as[- ]?is|untested|core\b|repair|read desc\w*|salvage|non[- ]?oem|brand new|new in box|nib\b|reman\w*|rebuilt|refurb\w*|service\b|mail[- ]?in|you send|send us|cloning|clone|depo\b|tyc\b|dorman|spyder|anzo|morimoto|amerilite|eagle eyes|sherman|kool vue|garage[- ]?pro|fit system|unique imports|a-premium|apdty|cardone|standard motor|spectra premium|evan[- ]?fischer|labwork|bapmic|cciyu)\b/;
const NOT_PART = /\b(lot of \d+|manual|owner'?s|brochure|toy|model car|diecast|sticker|decal|cover only|floor mats?|key chain|keychain)\b/;

export function classify(title: string): string | null {
  const t = ` ${title.toLowerCase()} `;
  for (const [key, re] of RULES) {
    if (!re.test(t)) continue;
    if (key === "headlight" || key === "taillight" || key === "mirror") {
      const side = /\b(passenger|right|rh|r\/h)\b/.test(t) ? "_r" : /\b(driver|left|lh|l\/h)\b/.test(t) ? "_l" : "_x";
      return key + side;
    }
    return key;
  }
  return null;
}
const baseKey = (k: string) => k.replace(/_(l|r|x)$/, "");
export const isJunk = (title: string) => JUNK.test(title.toLowerCase()) || NOT_PART.test(title.toLowerCase());
export const isBig = (title: string) => BIG.test(` ${title.toLowerCase()} `);

// Groups titles nobody tracks yet into a short part name, e.g. "Head Up Display", "Power Steering Control Module"
const STOP = new Set(["oem","genuine","factory","used","oe","new","w","with","and","for","fits","fit","the","a","an","of","lh","rh","left","right","driver","passenger","front","rear","side","assembly","assy","unit","part","parts","number","pn","p/n","tested","working","good","great","nice","clean","low","miles","mileage","original","complete","only","set","pair","one","1","2","3","4","module","sensor","switch","motor","valve","control"]);
const NOUNS = /\b(module|sensor|switch|motor|valve|unit|panel|camera|display|actuator|controller|computer|relay|solenoid|pump|speaker|subwoofer|receiver|antenna|bracket|cover|bezel|trim|light|lamp|harness|button|knob|vent|meter|horn|cluster|box|assembly)\b/;
export function discoverName(title: string, v: { make?: string; model?: string }): string {
  let t = title.toLowerCase().replace(/[^a-z0-9/ -]+/g, " ");
  const drop = [v.make, v.model, "chevy", "chevrolet", "gmc", "ford", "toyota", "honda", "nissan", "dodge", "jeep", "chrysler", "hyundai", "kia", "mazda", "subaru", "volkswagen", "vw", "bmw", "mercedes", "benz", "audi", "lexus", "acura", "infiniti", "buick", "cadillac", "lincoln", "ram", "mitsubishi", "volvo", "mini", "saturn", "pontiac", "mercury", "scion"]
    .filter(Boolean).map((s) => String(s).toLowerCase());
  for (const d of drop) t = t.split(d).join(" ");
  const words = t.split(/\s+/).filter((w) => w && !/\d/.test(w) && w.length > 1);
  const nounAt = words.findIndex((w) => NOUNS.test(w));
  let pick: string[];
  if (nounAt >= 0) {
    const before = words.slice(Math.max(0, nounAt - 3), nounAt).filter((w) => !STOP.has(w));
    pick = [...before.slice(-2), words[nounAt]];
  } else pick = words.filter((w) => !STOP.has(w)).slice(0, 3);
  const name = pick.join(" ").trim();
  return name ? name.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : "";
}

// Prices: drop outliers, then rough (25th pct) / typical (median) / clean (75th pct)
export function priceStats(prices: number[]) {
  let a = prices.filter((n) => isFinite(n) && n > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const med0 = a[Math.floor(a.length / 2)];
  if (a.length >= 4) a = a.filter((n) => n >= med0 * 0.33 && n <= med0 * 3);
  const q = (p: number) => a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))];
  const r = (n: number) => Math.round(n * 100) / 100;
  return { low: r(q(0.25)), median: r(q(0.5)), high: r(q(0.75)), n: a.length };
}

type Listing = { title: string; price: number; qty?: number; ship?: number | null; category?: string };

// Turns a pile of listings for one vehicle into per-part stats (tracked parts + newly discovered ones)
export function aggregate(listings: Listing[], v: { make?: string; model?: string }, opts: { keepTracked: boolean; requireModel?: boolean }) {
  const groups = new Map<string, { prices: number[]; qty: number; titles: string[]; name?: string }>();
  const excluded = { junk: 0, big: 0, other_vehicle: 0, too_few: 0 };
  const modelWord = String(v.model || "").toLowerCase().split(/[\s-]+/)[0];
  const add = (key: string, l: Listing, w = 1, name?: string) => {
    const g = groups.get(key) || { prices: [], qty: 0, titles: [], name };
    for (let i = 0; i < Math.max(1, Math.round(l.qty || 1)); i++) g.prices.push(l.price);
    g.qty += (l.qty || 1) * w;
    if (g.titles.length < 3) g.titles.push(l.title.slice(0, 120));
    groups.set(key, g);
  };
  for (const l of listings) {
    const tl = l.title.toLowerCase();
    if (opts.requireModel && modelWord && !tl.includes(modelWord)) { excluded.other_vehicle++; continue; }
    if (isJunk(l.title)) { excluded.junk++; continue; }
    const k = classify(l.title);
    if (k) {
      if (!opts.keepTracked) continue;
      if (k.endsWith("_x")) { const b = baseKey(k); add(b + "_l", l, 0.5); add(b + "_r", l, 0.5); }
      else add(k, l);
      continue;
    }
    if (isBig(l.title) || (l.ship != null && l.ship > BIG_SHIPPING)) { excluded.big++; continue; }
    const name = discoverName(l.title, v) || (l.category || "");
    if (!name) continue;
    add("d:" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), l, 1, name);
  }
  const out: { key: string; name?: string; count: number; stats: ReturnType<typeof priceStats>; titles: string[] }[] = [];
  for (const [key, g] of groups) {
    if (key.startsWith("d:") && g.prices.length < 2) { excluded.too_few++; continue; }
    out.push({ key, name: g.name, count: Math.round(g.qty * 10) / 10, stats: priceStats(g.prices), titles: g.titles });
  }
  return { groups: out, excluded };
}

// ---------- Reading a pasted eBay "Sold" page or Terapeak results ----------
const BOILER = /^(opens in a new window or tab|pre-owned|brand new|open box|used|parts only|located in|buy it now|or best offer|best offer accepted|free (shipping|delivery|returns|local pickup)|sponsored|shop on ebay|view similar|sell one like this|watch|top rated|last one|new listing|sold item|authenticity|see price|more like this|save this search|filter|sort|shipping to|delivery to|items? found|results? for|\d+ (sold|watchers?|bids?)|\d+\+? results|shipping|returns accepted|or buy it now|\(\d+\)|best match|.{0,3})$/i;
const PRICE = /^\$\s?([\d,]+(?:\.\d{2})?)(?:\s+to\s+\$[\d,.]+)?$/;
const MONEY = /\$\s?([\d,]+(?:\.\d{2})?)/;
const SHIP = /(shipping|delivery|postage)/i;
const SOLD_DATE = /^sold\s+(?:on\s+)?([a-z]{3,9}\.? \d{1,2},? \d{4})/i;
export function parsePaste(text: string): Listing[] {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((s) => s.trim()).filter(Boolean);
  const out: Listing[] = [];
  let cur: { title: string; price?: number; ship?: number | null } | null = null;
  const push = () => { if (cur && cur.price) out.push({ title: cur.title, price: cur.price, qty: 1, ship: cur.ship ?? null }); cur = null; };
  for (const raw of lines) {
    if (/^results matching fewer words/i.test(raw)) break; // eBay's loose matches: not this vehicle
    // Terapeak and other tables copy as tab-separated rows
    const cells = raw.split("\t").map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 3 && cells.some((c) => MONEY.test(c))) {
      const title = cells.reduce((a, c) => (/[a-z]{3}/i.test(c) && !MONEY.test(c) && c.length > a.length ? c : a), "");
      const pi = cells.findIndex((c) => MONEY.test(c));
      const price = Number(cells[pi].match(MONEY)![1].replace(/,/g, ""));
      const qtyCell = cells.slice(pi + 1).find((c) => /^\d{1,5}$/.test(c.replace(/,/g, "")));
      if (title.length >= 15 && price > 0) { push(); out.push({ title, price, qty: qtyCell ? Number(qtyCell.replace(/,/g, "")) : 1 }); }
      continue;
    }
    if (SOLD_DATE.test(raw)) { push(); continue; }
    const pm = raw.match(PRICE);
    if (pm) {
      if (cur && cur.price == null) cur.price = Number(pm[1].replace(/,/g, ""));
      continue;
    }
    if (SHIP.test(raw) && MONEY.test(raw)) { if (cur) cur.ship = Number(raw.match(MONEY)![1].replace(/,/g, "")); continue; }
    if (SHIP.test(raw) || BOILER.test(raw) || /^was:/i.test(raw) || /% off/i.test(raw)) continue;
    if (/^(pre-?owned|used|brand new|open box|refurbished|new \(other\)|for parts)\b/i.test(raw)) continue; // condition line, e.g. "Pre-Owned · Chevrolet"
    if (raw.length >= 20 && /[a-z]{3}/i.test(raw) && !raw.startsWith("$") && !raw.startsWith("+")) {
      if (cur && cur.price != null) push();
      if (!cur) cur = { title: raw.replace(/^new listing\s*/i, "") }; // keep the first title line of a listing
    }
  }
  push();
  return out;
}

// ---------- Plumbing ----------
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const env = (k: string) => (globalThis as any).Deno?.env.get(k) ?? "";
export function platformKey(v: { year?: unknown; make?: unknown; model?: unknown }) {
  const n = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return [n(v.make), n(v.model), n(v.year)].join("|");
}
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const nowIso = () => new Date().toISOString();
const daysOld = (t?: string | null) => (t ? (Date.now() - new Date(t).getTime()) / 864e5 : Infinity);

// Database access with the server key (the function checks who is calling first)
function serviceHeaders() {
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("QP_SECRET_KEY");
  if (!key) throw new Error("service_key_missing");
  return key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}
async function rest(method: string, path: string, body?: unknown, prefer?: string): Promise<any> {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, {
    method,
    headers: { ...serviceHeaders(), "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`db_${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const enc = encodeURIComponent;
const inList = (vals: string[]) => `in.(${vals.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(",")})`;

async function caller(req: Request) {
  if (env("CRON_SECRET") && req.headers.get("x-cron-secret") === env("CRON_SECRET")) return { id: "cron", role: "cron" };
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, { headers: { apikey: req.headers.get("apikey") || env("SUPABASE_ANON_KEY"), Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u?.id) return null;
  const p = await rest("GET", `pm_people?user_id=eq.${u.id}&select=role`);
  return { id: u.id as string, email: u.email as string, role: (p?.[0]?.role as string) || "checkin" };
}
async function settings() {
  const s = (await rest("GET", "pm_settings?id=eq.1&select=*"))?.[0];
  return { part_min: Number(s?.part_min ?? 60), last_process_at: s?.last_process_at ?? null };
}
async function callsToday(): Promise<number> {
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  return Number((await rest("GET", `pm_usage?day=eq.${day}&select=calls`))?.[0]?.calls ?? 0);
}
async function addCalls(n: number) { if (n > 0) await rest("POST", "rpc/pm_add_calls", { n }); }

// ---------- NHTSA ----------
async function decodeBatch(vins: string[]) {
  const out = new Map<string, any>();
  for (let i = 0; i < vins.length; i += 50) {
    const chunk = vins.slice(i, i + 50);
    try {
      const r = await fetch("https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ format: "json", data: chunk.join(";") }).toString(),
      });
      if (!r.ok) continue;
      for (const d of (await r.json())?.Results ?? []) {
        const disp = d.DisplacementL ? `${Number(d.DisplacementL).toFixed(1)}L` : "";
        const cyl = d.EngineCylinders ? `${d.EngineConfiguration === "V-Shaped" ? "V" : "I"}${d.EngineCylinders}` : "";
        out.set(String(d.VIN || "").toUpperCase(), {
          year: d.ModelYear || "", make: titleCase(d.Make || ""), model: d.Model || "",
          trim: [d.Trim, d.Series].filter(Boolean).join(" ").trim(), engine: [disp, cyl].filter(Boolean).join(" "), body: d.BodyClass || "",
        });
      }
    } catch { /* try again on the next run */ }
  }
  return out;
}
export const cleanVin = (s: string) => { let v = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); if (v.length === 18 && v[0] === "I") v = v.slice(1); return v; };
export const validVin = (v: string) => /^[A-HJ-NPR-Z0-9]{17}$/.test(v);

// ---------- eBay ----------
const tokenCache: Record<string, { token: string; exp: number }> = {};
const BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope";
const INSIGHTS_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";
async function ebayToken(scope: string) {
  const hit = tokenCache[scope];
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const id = env("EBAY_CLIENT_ID"), secret = env("EBAY_CLIENT_SECRET");
  if (!id || !secret) throw new Error("ebay_keys_missing");
  const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${id}:${secret}`) },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }).toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(scope.includes("insights") ? "insights_not_approved" : "ebay_auth_failed");
  tokenCache[scope] = { token: d.access_token, exp: Date.now() + (d.expires_in ?? 7200) * 1000 };
  return d.access_token as string;
}
let callCount = 0;
async function ebaySearch(kind: "active" | "sold", v: any, params: Record<string, string>, words = "") {
  const token = await ebayToken(kind === "sold" ? INSIGHTS_SCOPE : BROWSE_SCOPE);
  const path = kind === "sold" ? "marketplace_insights/v1_beta/item_sales/search" : "browse/v1/item_summary/search";
  const headers = { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US", "Accept-Language": "en-US" };
  const url = (p: Record<string, string>) => `https://api.ebay.com/buy/${path}?` + new URLSearchParams({ category_ids: EBAY_CATEGORY, ...params, ...p }).toString();
  const fit = `Year:${v.year};Make:${v.make};Model:${v.model}`;
  let mode = "fitment";
  callCount++;
  let r = await fetch(url({ ...(words ? { q: `${v.model} ${words}` } : {}), compatibility_filter: fit }), { headers });
  if (r.status === 400 || r.status === 404) {
    mode = "keywords"; callCount++;
    r = await fetch(url({ q: `${v.year} ${v.make} ${v.model} ${words}`.trim() }), { headers });
  }
  if (r.status === 429) throw new Error("ebay_rate_limited");
  if (!r.ok) throw new Error(`ebay_http_${r.status}`);
  const d = await r.json();
  const rows = kind === "sold" ? d.itemSales ?? [] : d.itemSummaries ?? [];
  const listings: Listing[] = rows.map((i: any) => ({
    title: String(i.title || ""),
    price: Number((kind === "sold" ? i.lastSoldPrice : i.price)?.value),
    qty: kind === "sold" ? Number(i.totalSoldQuantity) || 1 : 1,
    ship: i.shippingOptions?.[0]?.shippingCost ? Number(i.shippingOptions[0].shippingCost.value) : null,
    category: i.categories?.[0]?.categoryName || "",
  }));
  return { listings, total: Number(d.total ?? rows.length), mode, query: mode === "fitment" ? `${v.model} ${words} [${fit}]` : `${v.year} ${v.make} ${v.model} ${words}` };
}

// One tracked part: keep only listings that really are that part
async function targetedPart(kind: "active" | "sold", v: any, key: string) {
  const p = PART[key];
  const res = await ebaySearch(kind, v, { filter: "conditions:{USED}", limit: "100" }, p[2]);
  const keep = res.listings.filter((l) => { if (isJunk(l.title)) return false; const k = classify(l.title); return k ? baseKey(k) === baseKey(key) : !isBig(l.title); });
  const st = priceStats(keep.flatMap((l) => Array(Math.max(1, Math.round(l.qty || 1))).fill(l.price)));
  const share = res.listings.length ? keep.length / res.listings.length : 0;
  return { st, total: Math.round(res.total * share), qty: keep.reduce((n, l) => n + (l.qty || 1), 0), mode: res.mode, query: res.query };
}

async function gatherPlatform(v: any, platform: string, needTargeted: boolean, needSweep: boolean) {
  const insights = env("EBAY_INSIGHTS").toLowerCase() === "on";
  const notes = new Set<string>();
  const rows: any[] = [];
  const fatal = (e: unknown) => ["ebay_keys_missing", "ebay_auth_failed", "ebay_rate_limited"].includes((e as Error).message);
  if (needTargeted) {
    for (let i = 0; i < PARTS.length; i += 8) {
      const batch = PARTS.slice(i, i + 8);
      const res = await Promise.all(batch.map(async ([key]) => {
        const row: any = { platform, part_key: key, part_name: PART[key][1], group_name: PART[key][5], discovered: false };
        try {
          const a = await targetedPart("active", v, key);
          Object.assign(row, { active_count: a.total, ask_low: a.st?.low ?? null, ask_median: a.st?.median ?? null, ask_high: a.st?.high ?? null, ask_sample: a.st?.n ?? 0, ask_query: a.query, ask_mode: a.mode, ask_updated: nowIso() });
        } catch (e) { notes.add((e as Error).message); if (fatal(e)) throw e; return null; }
        if (insights) {
          try {
            const s = await targetedPart("sold", v, key);
            Object.assign(row, { sold_count: s.qty, sold_low: s.st?.low ?? null, sold_median: s.st?.median ?? null, sold_high: s.st?.high ?? null, sold_source: "ebay-90d", sold_updated: nowIso() });
          } catch (e) { notes.add((e as Error).message); }
        }
        return row;
      }).map((p) => p.catch((e) => { notes.add((e as Error).message); return null; })));
      rows.push(...res.filter(Boolean));
      if ([...notes].some((n) => ["ebay_keys_missing", "ebay_auth_failed", "ebay_rate_limited"].includes(n))) break;
    }
  }
  const sweepRows: any[] = [];
  if (needSweep && ![...notes].some((n) => n.startsWith("ebay_keys") || n === "ebay_auth_failed" || n === "ebay_rate_limited")) {
    for (const kind of (insights ? ["active", "sold"] : ["active"]) as ("active" | "sold")[]) {
      try {
        const all: Listing[] = [];
        for (let page = 0; page < 3; page++) {
          const r = await ebaySearch(kind, v, { filter: "conditions:{USED},price:[40..1500],priceCurrency:USD", sort: "-price", limit: "200", offset: String(page * 200) });
          all.push(...r.listings);
          if (r.listings.length < 200) break;
        }
        const { groups } = aggregate(all, v, { keepTracked: false });
        for (const g of groups) {
          if (!g.stats) continue;
          const row: any = sweepRows.find((x) => x.part_key === g.key) || { platform, part_key: g.key, part_name: g.name, group_name: "Also found", discovered: true, sample_titles: g.titles };
          if (kind === "active") Object.assign(row, { active_count: g.count, ask_low: g.stats.low, ask_median: g.stats.median, ask_high: g.stats.high, ask_sample: g.stats.n, ask_mode: "sweep", ask_updated: nowIso() });
          else Object.assign(row, { sold_count: g.count, sold_low: g.stats.low, sold_median: g.stats.median, sold_high: g.stats.high, sold_source: "ebay-90d", sold_updated: nowIso() });
          if (!sweepRows.includes(row)) sweepRows.push(row);
        }
      } catch (e) { notes.add((e as Error).message); }
    }
  }
  // Bulk upserts need identical columns per request; group rows by their columns so missing fields
  // (like sold data from your own pastes) are left alone instead of being blanked out
  const byShape = new Map<string, any[]>();
  for (const r of [...rows, ...sweepRows]) { const k = Object.keys(r).sort().join(","); byShape.set(k, [...(byShape.get(k) || []), r]); }
  for (const list of byShape.values())
    for (let i = 0; i < list.length; i += 200) await rest("POST", "pm_part_stats?on_conflict=platform,part_key", list.slice(i, i + 200), "resolution=merge-duplicates,return=minimal");
  return { targetedOk: rows.length > 0, sweepOk: needSweep && !notes.size ? true : sweepRows.length > 0, notes: [...notes] };
}

// ---------- Value of a part, and where a car goes ----------
export function cleanValue(r: any): number | null {
  if (r.sold_high != null && Number(r.sold_count ?? 1) > 0) return Number(r.sold_high);
  if (r.ask_high != null && Number(r.active_count ?? 0) > 0) return Number(r.ask_high) * ASK_TO_SOLD;
  return null;
}
async function finalizePlatform(platform: string, partMin: number) {
  const stats = (await rest("GET", `pm_part_stats?platform=eq.${enc(platform)}&select=part_key,ask_high,active_count,sold_high,sold_count,discovered`)) || [];
  const over = stats.map(cleanValue).filter((x: number | null) => x != null && x >= partMin) as number[];
  const est = Math.round(over.reduce((a, b) => a + b, 0));
  await rest("PATCH", `pm_vehicles?platform=eq.${enc(platform)}&status=${inList(["queued", "ready", "error"])}`,
    { status: "ready", status_note: null, est_value: est, pull_count: over.length, destination: over.length ? "pull" : "shred" }, "return=minimal");
  return { est, count: over.length };
}

// ---------- Actions ----------
async function checkin(vinsIn: string[], who: any) {
  const seen = new Set<string>();
  const vins: string[] = [], skipped: { vin: string; reason: string }[] = [];
  for (const raw of vinsIn) {
    const v = cleanVin(raw);
    if (!v) continue;
    if (!validVin(v)) { skipped.push({ vin: raw.trim(), reason: "Not a valid VIN (17 letters and numbers, no I, O, or Q)" }); continue; }
    if (seen.has(v)) { skipped.push({ vin: v, reason: "Listed twice in this paste" }); continue; }
    seen.add(v); vins.push(v);
  }
  if (!vins.length) return { added: [], skipped };
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const existing = (await rest("GET", `pm_vehicles?vin=${inList(vins)}&scanned_at=gte.${enc(since)}&select=vin,stock_no`)) || [];
  const exMap = new Map(existing.map((e: any) => [e.vin, e.stock_no]));
  const fresh = vins.filter((v) => { if (exMap.has(v)) { skipped.push({ vin: v, reason: `Already checked in as ${exMap.get(v) || "earlier"}` }); return false; } return true; });
  if (!fresh.length) return { added: [], skipped };
  const decoded = await decodeBatch(fresh);
  // Stock numbers: MMDD-## in Chicago time
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const prefix = String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  const used = ((await rest("GET", `pm_vehicles?stock_no=like.${prefix}-*&select=stock_no`)) || []).map((r: any) => Number(String(r.stock_no).split("-")[1]) || 0);
  let next = used.length ? Math.max(...used) + 1 : 1;
  const rows = fresh.map((vin) => {
    const x = decoded.get(vin) || {};
    return { vin, ...x, platform: x.year ? platformKey(x) : "", stock_no: `${prefix}-${String(next++).padStart(2, "0")}`, status: "queued", destination: "waiting", status_note: x.year ? null : "Waiting on VIN decode", ...(who.id !== "cron" ? { scanned_by: who.id } : {}) };
  });
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const added = await rest("POST", "pm_vehicles", rows.map((r: any) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))), "return=representation");
  // Models we already know get their destination right away
  const { part_min } = await settings();
  const plats = [...new Set(rows.map((r) => r.platform).filter(Boolean))];
  if (plats.length) {
    const known = (await rest("GET", `pm_platforms?platform=${inList(plats)}&select=platform,targeted_at,sweep_at,researched_at`)) || [];
    for (const p of known) if (daysOld(p.targeted_at) < TARGETED_DAYS * 2 || daysOld(p.researched_at) < 60) await finalizePlatform(p.platform, part_min);
  }
  const ids = (added || []).map((a: any) => a.id);
  const after = ids.length ? await rest("GET", `pm_vehicles?id=in.(${ids.join(",")})&select=*&order=stock_no.asc`) : [];
  return { added: after, skipped };
}

async function processQueue(budgetMs: number) {
  const t0 = Date.now();
  callCount = 0;
  const notes = new Set<string>();
  const { part_min } = await settings();
  // 1. decode anything NHTSA missed earlier
  const undecoded = (await rest("GET", "pm_vehicles?status=eq.queued&platform=eq.&select=id,vin&limit=200")) || [];
  if (undecoded.length) {
    const dec = await decodeBatch(undecoded.map((u: any) => u.vin));
    for (const u of undecoded) {
      const x = dec.get(u.vin);
      if (x?.year) await rest("PATCH", `pm_vehicles?id=eq.${u.id}`, { ...x, platform: platformKey(x), status_note: null }, "return=minimal");
    }
  }
  // 2. gather each waiting model, oldest first
  const queued = (await rest("GET", "pm_vehicles?status=eq.queued&platform=neq.&select=platform,year,make,model&order=scanned_at.asc&limit=1000")) || [];
  const order: any[] = [];
  for (const q of queued) if (!order.find((o) => o.platform === q.platform)) order.push(q);
  let done = 0;
  for (const v of order) {
    if (Date.now() - t0 > budgetMs) break;
    await rest("POST", "pm_platforms?on_conflict=platform", [{ platform: v.platform, year: v.year, make: v.make, model: v.model }], "resolution=ignore-duplicates,return=minimal");
    const p = (await rest("GET", `pm_platforms?platform=eq.${enc(v.platform)}&select=*`))?.[0] || {};
    const needT = daysOld(p.targeted_at) > TARGETED_DAYS, needS = daysOld(p.sweep_at) > SWEEP_DAYS;
    if (!needT && !needS) { await finalizePlatform(v.platform, part_min); done++; continue; }
    const used = await callsToday();
    if (used + 75 > DAILY_CALL_CAP) { notes.add("daily_cap"); break; }
    // claim this model so a second runner skips it
    const lockedUntil = new Date(Date.now() + 5 * 60_000).toISOString();
    const claimed = await rest("PATCH", `pm_platforms?platform=eq.${enc(v.platform)}&or=(locked_until.is.null,locked_until.lt.${enc(nowIso())})`, { locked_until: lockedUntil }, "return=representation");
    if (!claimed?.length) continue;
    const before = callCount;
    try {
      const g = await gatherPlatform(v, v.platform, needT, needS);
      g.notes.forEach((n) => notes.add(n));
      await rest("PATCH", `pm_platforms?platform=eq.${enc(v.platform)}`, {
        ...(needT && g.targetedOk ? { targeted_at: nowIso() } : {}), ...(needS && g.sweepOk ? { sweep_at: nowIso() } : {}),
        locked_until: null, last_error: g.notes.length ? g.notes.join(", ") : null,
      }, "return=minimal");
      if (g.targetedOk || !needT) { await finalizePlatform(v.platform, part_min); done++; }
      else await rest("PATCH", `pm_vehicles?platform=eq.${enc(v.platform)}&status=eq.queued`, { status_note: g.notes.join(", ") || "eBay returned nothing yet" }, "return=minimal");
    } catch (e) {
      notes.add((e as Error).message);
      await rest("PATCH", `pm_platforms?platform=eq.${enc(v.platform)}`, { locked_until: null, last_error: (e as Error).message }, "return=minimal");
    } finally { await addCalls(callCount - before); }
    if (["ebay_keys_missing", "ebay_auth_failed", "ebay_rate_limited", "service_key_missing"].some((n) => notes.has(n))) break;
  }
  await rest("PATCH", "pm_settings?id=eq.1", { last_process_at: nowIso() }, "return=minimal");
  const left = (await rest("GET", "pm_vehicles?status=eq.queued&select=platform")) || [];
  return { models_done: done, cars_waiting: left.length, models_waiting: new Set(left.map((l: any) => l.platform)).size, ebay_calls: callCount, calls_today: await callsToday(), notes: [...notes] };
}

async function carData(id: number) {
  const v = (await rest("GET", `pm_vehicles?id=eq.${id}&select=*`))?.[0];
  if (!v) return { error: "Car not found." };
  return { vehicle: v, ...(await platformData(v.platform)) };
}
async function platformData(platform: string) {
  const [stats, plat, s] = await Promise.all([
    rest("GET", `pm_part_stats?platform=eq.${enc(platform)}&select=*`),
    rest("GET", `pm_platforms?platform=eq.${enc(platform)}&select=*`),
    settings(),
  ]);
  const byKey = new Map((stats || []).map((r: any) => [r.part_key, r]));
  const parts = [
    ...PARTS.map(([key, name, words, size, pull, group, opt]) => ({ key, name, words, size, pull, group, opt, ...(byKey.get(key) as any || {}) })),
    ...(stats || []).filter((r: any) => r.discovered).map((r: any) => ({ key: r.part_key, name: r.part_name, words: r.part_name, size: "S", pull: 20, group: "Also found", opt: false, ...r })),
  ].map((p: any) => ({ ...p, clean: cleanValue(p) }));
  return { platform, platform_info: plat?.[0] || null, parts, part_min: s.part_min };
}

async function researchPreview(text: string, v: any) {
  const listings = parsePaste(text);
  const { groups, excluded } = aggregate(listings, v, { keepTracked: true, requireModel: true });
  return {
    read: listings.length, excluded,
    groups: groups.filter((g) => g.stats).map((g) => ({ key: g.key, name: g.key.startsWith("d:") ? g.name : PART[g.key]?.[1] || g.key, count: g.count, ...g.stats, titles: g.titles }))
      .sort((a, b) => (b.high ?? 0) - (a.high ?? 0)),
  };
}
async function researchSave(text: string, v: any, yearFrom: number, yearTo: number) {
  const prev = await researchPreview(text, v);
  if (!prev.groups.length) return { ...prev, saved_years: [] };
  const years: number[] = [];
  for (let y = Math.min(yearFrom, yearTo); y <= Math.max(yearFrom, yearTo) && years.length < 15; y++) years.push(y);
  const { part_min } = await settings();
  for (const y of years) {
    const platform = platformKey({ ...v, year: y });
    const rows = prev.groups.map((g) => ({
      platform, part_key: g.key, sold_count: g.count, sold_low: g.low, sold_median: g.median, sold_high: g.high, sold_source: "manual", sold_updated: nowIso(),
      part_name: g.key.startsWith("d:") ? g.name : PART[g.key]?.[1] ?? g.name, group_name: g.key.startsWith("d:") ? "Also found" : PART[g.key]?.[5] ?? null,
      discovered: g.key.startsWith("d:"), sample_titles: g.titles,
    }));
    await rest("POST", "pm_part_stats?on_conflict=platform,part_key", rows, "resolution=merge-duplicates,return=minimal");
    await rest("POST", "pm_platforms?on_conflict=platform", [{ platform, year: String(y), make: v.make, model: v.model, researched_at: nowIso() }], "resolution=merge-duplicates,return=minimal");
    await finalizePlatform(platform, part_min);
  }
  return { ...prev, saved_years: years };
}

async function recomputeAll() {
  const { part_min } = await settings();
  const plats = (await rest("GET", "pm_vehicles?status=eq.ready&select=platform")) || [];
  const uniq = [...new Set(plats.map((p: any) => p.platform))] as string[];
  for (const p of uniq) await finalizePlatform(p, part_min);
  return { models: uniq.length };
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const body = await req.json().catch(() => ({}));
  try {
    const who = await caller(req);
    if (!who) return json({ error: "Sign in first." }, 401);
    const owner = who.role === "owner";
    const ownerOnly = () => json({ error: "Only the owner can do that." }, 403);
    switch (body.action) {
      case "status": {
        const s = await settings();
        return json({
          role: who.role, ebay_keys: !!(env("EBAY_CLIENT_ID") && env("EBAY_CLIENT_SECRET")), insights: env("EBAY_INSIGHTS").toLowerCase() === "on",
          cron: !!env("CRON_SECRET"), last_process_at: s.last_process_at, part_min: s.part_min, calls_today: owner ? await callsToday() : undefined, call_cap: DAILY_CALL_CAP,
        });
      }
      case "checkin": return json(await checkin(Array.isArray(body.vins) ? body.vins : String(body.vins || "").split(/[\s,;]+/), who));
      case "process": return json(await processQueue(who.role === "cron" ? 110_000 : 40_000));
      case "car": return owner ? json(await carData(Number(body.id))) : ownerOnly();
      case "platform": return owner ? json(await platformData(String(body.platform || ""))) : ownerOnly();
      case "research_preview": return owner ? json(await researchPreview(String(body.text || ""), body.vehicle || {})) : ownerOnly();
      case "research_save": return owner ? json(await researchSave(String(body.text || ""), body.vehicle || {}, Number(body.year_from), Number(body.year_to))) : ownerOnly();
      case "recompute": return owner ? json(await recomputeAll()) : ownerOnly();
      default: return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    const m = (e as Error).message;
    if (m === "service_key_missing") return json({ error: "The function can't reach the database. Add the QP_SECRET_KEY secret (see setup guide)." }, 500);
    return json({ error: "Something went wrong on the server.", detail: m }, 502);
  }
}

(globalThis as any).Deno?.serve(handle);
