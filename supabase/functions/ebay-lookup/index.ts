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
const STOP = new Set(["oem","genuine","factory","used","oe","new","w","with","and","for","fits","fit","the","a","an","of","lh","rh","left","right","driver","passenger","front","rear","side","assembly","assy","unit","part","parts","number","pn","p/n","tested","working","good","great","nice","clean","low","miles","mileage","original","complete","only","set","pair","one","module","sensor","switch","motor","valve","control",
  "jdm","vin","digit","stk","stock","mi","im","km","hatchback","sedan","coupe","wagon","van","pickup","truck","suv","crew","cab","base","sport","limited","touring","premium","luxury","awd","fwd","rwd","4wd","2wd","4x4","4x2","automatic","manual","gas","gasoline","diesel","hybrid","cyl","dohc","sohc","liter","l","speed","free","shipping","fast","warranty","day","days","guaranteed","run","runs","ran","video","tested","lot","w/","w/o","without","inch","in","plug","play","pnp","programmed","ready","only","lx","ex","exl","ex-l","lt","ls","ltz","se","sel","sxt","gt","le","xle","xse","sr","sr5","sv","sl","s","x","xl","xlt","slt","st","gl","gls","glx","si","rs","ss","titanium","platinum","denali"]);
const NOUNS = /\b(module|sensor|switch|valve|unit|panel|camera|display|actuator|controller|computer|relay|solenoid|pump|speaker|subwoofer|receiver|antenna|bracket|cover|bezel|trim|light|lamp|harness|button|knob|vent|meter|horn|cluster|box|assembly|engine|motor)\b/;
const SYNONYMS: [RegExp, string][] = [[/\bmotor\b/g, "motor"], [/\bheads up\b/g, "head up"], [/\bhud\b/g, "head up display"], [/\bnav\b/g, "navigation"]];
const GENERIC_CATEGORY = /^(ebay motors|parts & accessories|car & truck parts( & accessories)?|other( car & truck parts)?|interior parts & accessories|exterior parts & accessories|engines? & components|electrical components|lighting & lamps|body & frame|air & fuel delivery|engine cooling components|brakes & brake parts|suspension & steering|transmission & drivetrain|exhaust|other parts)$/i;
export function discoverName(title: string, v: { make?: string; model?: string }): string {
  let t = " " + title.toLowerCase().replace(/[^a-z0-9/ -]+/g, " ") + " ";
  for (const [re, to] of SYNONYMS) t = t.replace(re, to);
  const drop = [v.make, v.model, "chevy", "chevrolet", "gmc", "ford", "toyota", "honda", "nissan", "dodge", "jeep", "chrysler", "hyundai", "kia", "mazda", "subaru", "volkswagen", "vw", "bmw", "mercedes", "benz", "audi", "lexus", "acura", "infiniti", "buick", "cadillac", "lincoln", "ram", "mitsubishi", "volvo", "mini", "saturn", "pontiac", "mercury", "scion", "yaris", "auris", "corolla", "camry", "civic", "accord", "escalade", "tahoe", "suburban", "silverado", "sierra", "f150", "f-150", "equinox", "terrain", "malibu", "impala", "cruze", "focus", "fusion", "escape", "explorer", "altima", "sentra", "rogue", "elantra", "sonata", "optima", "soul", "jetta", "passat"]
    .filter(Boolean).map((s) => " " + String(s).toLowerCase() + " ");
  for (const d of drop) t = t.split(d).join(" ");
  const words = t.split(/\s+/).filter((w) => w && !/\d/.test(w) && w.length > 2);
  const nounAt = words.findIndex((w) => NOUNS.test(w));
  let pick: string[];
  if (nounAt >= 0) {
    const before = words.slice(Math.max(0, nounAt - 3), nounAt).filter((w) => !STOP.has(w));
    pick = [...before.slice(-2), words[nounAt]];
  } else pick = words.filter((w) => !STOP.has(w)).slice(0, 3);
  const name = pick.join(" ").trim();
  return name ? name.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : "";
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// eBay's own category is the most reliable name for a part type ("Head-Up Displays"); title words are the fallback
export function discoverKey(title: string, category: string | undefined, v: any): { key: string; name: string } | null {
  const cat = String(category || "").trim();
  if (cat && !GENERIC_CATEGORY.test(cat)) return { key: "d:" + slug(cat), name: cat };
  const nm = discoverName(title, v);
  return nm ? { key: "d:" + slug(nm), name: nm } : null;
}
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/s$/, "")));
export function similar(a: string, b: string) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  if (n < 2 && !(A.size === 1 && B.size === 1 && n === 1)) return n ? 0.3 : 0; // one shared word ("engine") isn't enough
  return n / Math.min(A.size, B.size);
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

type Listing = { title: string; price: number; qty?: number; ship?: number | null; category?: string; date?: string };

// Turns a pile of listings for one vehicle into per-part stats (tracked parts + newly discovered small parts)
export function aggregate(listings: Listing[], v: { make?: string; model?: string }, opts: { keepTracked: boolean; requireModel?: boolean; minDiscovered?: number }) {
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
    const k = classify(l.title) || (l.category ? classify(l.category) : null);
    if (k) {
      if (!opts.keepTracked) continue;
      if (k.endsWith("_x")) { const b = baseKey(k); add(b + "_l", l, 0.5); add(b + "_r", l, 0.5); }
      else add(k, l);
      continue;
    }
    // Large parts (engines, transmissions, doors…) never become "Also found"; they live in saved sales instead
    const st = saleType(l.title, l.ship, v);
    if (!st || st.size === "big" || (l.category && LARGE.some(([, , re]) => re.test(` ${l.category!.toLowerCase()} `)))) { excluded.big++; continue; }
    const d = discoverKey(l.title, l.category, v);
    if (!d) continue;
    add(d.key, l, 1, d.name);
  }
  // Merge near-identical discovered names into the bigger group ("Power Steering Module" + "Power Steering Control Module")
  const disc = [...groups.entries()].filter(([k]) => k.startsWith("d:")).sort((a, b) => b[1].qty - a[1].qty);
  for (let i = 0; i < disc.length; i++) {
    const [ki, gi] = disc[i]; if (!groups.has(ki)) continue;
    for (let j = i + 1; j < disc.length; j++) {
      const [kj, gj] = disc[j]; if (!groups.has(kj)) continue;
      if (similar(gi.name || ki, gj.name || kj) >= 0.67) { gi.prices.push(...gj.prices); gi.qty += gj.qty; for (const t of gj.titles) if (gi.titles.length < 3) gi.titles.push(t); groups.delete(kj); }
    }
  }
  const min = opts.minDiscovered ?? 3;
  const out: { key: string; name?: string; count: number; stats: ReturnType<typeof priceStats>; titles: string[] }[] = [];
  for (const [key, g] of groups) {
    if (key.startsWith("d:") && g.prices.length < min) { excluded.too_few++; continue; }
    out.push({ key, name: g.name, count: Math.round(g.qty * 10) / 10, stats: priceStats(g.prices), titles: g.titles });
  }
  return { groups: out, excluded };
}

// ---------- OEM part numbers and fitment years from listing titles ----------
const PN_RULES: RegExp[] = [
  /\b[A-Z0-9]{4}-[A-Z0-9]{4,6}-[A-Z]{1,3}\b/g,        // Ford/Lincoln: BL3T-19980-AC
  /\b\d{5}-[A-Z0-9]{3}-[A-Z0-9]{3,4}\b/g,             // Honda/Acura: 33151-SDA-A01
  /\b[A-Z0-9]{4}-\d{2}-[A-Z0-9]{3,5}\b/g,             // Mazda: GS1D-67-560
  /\b[0-9][0-9A-Z]{4}-[0-9A-Z]{5}\b/g,                // Toyota, Nissan, Hyundai, Kia: 89661-06K30, 284B1-1AA0A, 96560-2S000
  /\bP?\d{8}[A-Z]{2}\b/g,                             // Chrysler/Dodge/Jeep/Ram: 68100539AB, P04692154AE
  /\b\d{5}[A-Z]{2}\d{3}\b/g,                          // Subaru: 88281FG000
  /\b\d[A-Z]\d ?\d{3} ?\d{3} ?[A-Z]{0,2}\b/g,         // VW/Audi: 1K0 937 049 N
  /\bA ?\d{3} ?\d{3} ?\d{2} ?\d{2}\b/g,               // Mercedes: A 204 900 59 03
];
const GM_PN = /\b(?:1[0-9]|2[0-9]|8[0-9]|9[0-9])\d{6}\b/g; // GM: 20983440 (8 digits)
export function partNumbers(title: string, make = ""): string[] {
  const t = " " + String(title).toUpperCase() + " ";
  const out = new Set<string>();
  for (const re of PN_RULES) for (const m of t.matchAll(re)) {
    const pn = m[0].replace(/\s+/g, "");
    if (/^(19|20)\d{2}-/.test(pn) && pn.length < 10) continue;
    out.add(pn);
  }
  for (const m of t.matchAll(GM_PN)) {
    const n = m[0];
    if (/^(19|20)\d{2}(19|20)\d{2}$/.test(n)) continue; // "20102015" is a year range, not a part number
    out.add(n);
  }
  if (/bmw|mini/i.test(make)) for (const m of t.matchAll(/\b\d{7}\b/g)) out.add(m[0]);
  return [...out].slice(0, 6);
}
export function titleYears(title: string): [number, number] | null {
  const t = String(title);
  let m = t.match(/\b((?:19|20)\d{2})\s*[-–\/]\s*((?:19|20)?\d{2})\b/);
  if (m) { const a = +m[1], b = m[2].length === 2 ? Math.floor(a / 100) * 100 + +m[2] : +m[2]; if (b >= a && b - a <= 15) return [a, b]; }
  m = t.match(/\b(0\d|1\d|2\d|9\d)\s*[-–]\s*(0\d|1\d|2\d|9\d)\b/);
  if (m) { const y = (x: string) => (+x >= 80 ? 1900 : 2000) + +x; const a = y(m[1]), b = y(m[2]); if (b >= a && b - a <= 15) return [a, b]; }
  const ys = [...t.matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map((x) => +x[1]);
  if (ys.length) return [Math.min(...ys), Math.max(...ys)];
  return null;
}

// ---------- Reading a pasted eBay "Sold" page or Terapeak results ----------
const BOILER = /^(opens in a new window or tab|pre-owned|brand new|open box|used|parts only|located in|buy it now|or best offer|best offer accepted|free (shipping|delivery|returns|local pickup)|sponsored|shop on ebay|view similar|sell one like this|watch|top rated|last one|new listing|sold item|authenticity|see price|more like this|save this search|filter|sort|shipping to|delivery to|items? found|results? for|\d+ (sold|watchers?|bids?)|\d+\+? results|shipping|returns accepted|or buy it now|\(\d+\)|best match|.{0,3})$/i;
const PRICE = /^\$\s?([\d,]+(?:\.\d{2})?)(?:\s+to\s+\$[\d,.]+)?$/;
const MONEY = /\$\s?([\d,]+(?:\.\d{2})?)/;
const SHIP = /(shipping|delivery|postage)/i;
const SOLD_DATE = /^sold\s+(?:on\s+)?([a-z]{3,9}\.? \d{1,2},? \d{4})/i;
export function toIsoDate(s: string): string | undefined {
  if (!s) return undefined;
  const d = new Date(String(s).replace(/\./g, ""));
  return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}
export function parsePaste(text: string): Listing[] {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((s) => s.trim()).filter(Boolean);
  const out: Listing[] = [];
  const seen = new Set<string>(); // the same sale pasted twice (overlapping pages) only counts once
  let cur: { title: string; price?: number; ship?: number | null } | null = null;
  let date = "", skipping = false;
  const keep = (l: Listing, d: string) => { const k = `${l.title.toLowerCase()}|${l.price}|${d}`; if (seen.has(k)) return; seen.add(k); out.push({ ...l, date: toIsoDate(d) }); };
  const push = () => { if (cur && cur.price) keep({ title: cur.title, price: cur.price, qty: 1, ship: cur.ship ?? null }, date); cur = null; };
  for (const raw of lines) {
    // eBay's loose matches are other vehicles: skip them until the next pasted page starts
    if (/^results matching fewer words/i.test(raw)) { push(); skipping = true; continue; }
    if (/^[\d,]+\+? results? for\b/i.test(raw) || /^shop on ebay$/i.test(raw)) { push(); skipping = false; continue; }
    if (skipping) continue;
    // Terapeak and other tables copy as tab-separated rows
    const cells = raw.split("\t").map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 3 && cells.some((c) => MONEY.test(c))) {
      const title = cells.reduce((a, c) => (/[a-z]{3}/i.test(c) && !MONEY.test(c) && c.length > a.length ? c : a), "");
      const pi = cells.findIndex((c) => MONEY.test(c));
      const price = Number(cells[pi].match(MONEY)![1].replace(/,/g, ""));
      const qtyCell = cells.slice(pi + 1).find((c) => /^\d{1,5}$/.test(c.replace(/,/g, "")));
      const lastDate = cells.find((c) => /[a-z]{3} \d{1,2}, \d{4}/i.test(c)) || "";
      if (title.length >= 15 && price > 0) { push(); keep({ title, price, qty: qtyCell ? Number(qtyCell.replace(/,/g, "")) : 1 }, lastDate); }
      continue;
    }
    if (SOLD_DATE.test(raw)) { push(); date = raw.match(SOLD_DATE)![1]; continue; }
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
const titleCase = (s: string) => { const u = String(s).toUpperCase(); if (["GMC", "BMW", "RAM", "MINI", "FIAT", "VW"].includes(u)) return u === "MINI" ? "MINI" : u === "FIAT" ? "FIAT" : u; return String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()); };
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
  return { part_min: Number(s?.part_min ?? 60), last_process_at: s?.last_process_at ?? null, never_pull: (s?.never_pull ?? ["injectors"]) as string[], last_backup_at: s?.last_backup_at ?? null };
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
    category: (i.categories || []).map((c: any) => String(c.categoryName || "")).find((n: string) => n && !GENERIC_CATEGORY.test(n)) || "",
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
  const { never_pull } = await settings();
  const SEARCH = PARTS.filter(([key]) => !never_pull.includes(key));
  const notes = new Set<string>();
  const rows: any[] = [];
  const fatal = (e: unknown) => ["ebay_keys_missing", "ebay_auth_failed", "ebay_rate_limited"].includes((e as Error).message);
  if (needTargeted) {
    for (let i = 0; i < SEARCH.length; i += 8) {
      const batch = SEARCH.slice(i, i + 8);
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
        const { groups } = aggregate(all, v, { keepTracked: false, minDiscovered: 3 });
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
// One physical unit that eBay sells under two names: a car only counts it once
const SAME_UNIT: string[][] = [["radio", "display"]];
// Filter groups used everywhere in the app
export function partCat(key: string, name = "", size = "small"): string {
  if (size === "big" || key.startsWith("big:")) return "large";
  const k = baseKey(key);
  const M: Record<string, string> = {
    ecm: "modules", bcm: "modules", tcm: "modules", abs: "modules", fusebox: "modules", gateway: "modules", telematics: "modules", keyless: "modules", fpdm: "modules", liftgate_mod: "modules", seat_mod: "modules", parkassist: "modules",
    radio: "electronics", display: "electronics", hud: "electronics", cluster: "electronics", amp: "electronics", hvac: "electronics", media_hub: "electronics", clock_dash: "electronics",
    window_master: "electronics", headlight_sw: "electronics", column_sw: "electronics", sw_controls: "electronics", seat_sw: "electronics", mirror_sw: "electronics", overhead: "electronics",
    front_camera: "electronics", radar: "electronics", backup_cam: "electronics", bsm_sensor: "electronics", park_sensor: "electronics", tpms: "electronics", steer_angle: "electronics", rain_sensor: "electronics",
    lock_act: "electronics", window_motor: "electronics", blend_door: "electronics",
    headlight: "lights", taillight: "lights", mirror: "mirrors", rear_mirror: "mirrors",
    emblems: "plastic", center_caps: "plastic", handle: "plastic", shifter: "plastic",
    maf: "engine", o2: "engine", map_cam: "engine", throttle: "engine", coils: "engine", injectors: "engine", vvt: "engine", purge: "engine", blower_res: "engine",
    keyfob: "keys", ignition: "keys", push_start: "keys",
  };
  if (M[k]) return M[k];
  const n = ` ${name.toLowerCase()} `;
  if (/\b(module|computer|controller|ecu|ecm|pcm|bcm|tcm)s?\b/.test(n)) return "modules";
  if (/\b(light|lamp|headlight|taillight)s?\b/.test(n)) return "lights";
  if (/\bmirrors?\b/.test(n)) return "mirrors";
  if (/\b(key|fob|lock cylinder|ignition|immobilizer)s?\b/.test(n)) return "keys";
  if (/\b(display|screen|radio|receiver|speaker|subwoofer|amp|amplifier|switch|switche|sensor|camera|button|antenna|cluster|gauge|navigation|dvd|player|charger|usb|actuator|motor|entertainment system)s?\b/.test(n)) return "electronics";
  if (/\b(trim|bezel|cover|cap|emblem|badge|panel|handle|vent|grille|molding|garnish|console|lid|knob|visor|tray|holder)s?\b/.test(n)) return "plastic";
  if (/\b(valve|solenoid|pump|throttle|coil|injector|manifold|tensioner|pulley|reservoir|canister|filter|housing)s?\b/.test(n)) return "engine";
  return "other";
}
async function loadMerges(modelKeyStr: string) {
  return ((await rest("GET", `pm_merges?model_key=eq.${enc(modelKeyStr)}&select=from_key,to_key,kind`)) || []) as { from_key: string; to_key: string; kind: string }[];
}
// Every part for one model year, with whether it counts toward the car's value and why not
export function valueParts(stats: any[], cfg: { part_min: number; never_pull: string[] }, merges: { from_key: string; to_key: string; kind: string }[]) {
  const byKey = new Map(stats.map((r: any) => [r.part_key, { ...r }]));
  for (const m of merges.filter((m) => m.kind === "merge")) {
    const from = byKey.get(m.from_key), to = byKey.get(m.to_key);
    if (!from) continue;
    if (to) {
      to.sold_count = (Number(to.sold_count) || 0) + (Number(from.sold_count) || 0) || to.sold_count;
      to.active_count = (Number(to.active_count) || 0) + (Number(from.active_count) || 0) || to.active_count;
      for (const f of ["sold_low", "sold_median", "sold_high", "ask_low", "ask_median", "ask_high"]) if (to[f] == null && from[f] != null) to[f] = from[f];
    }
    from._merged_into = m.to_key;
  }
  const parts = [
    ...PARTS.map(([key, name, words, size, pull, group, opt]) => ({ key, name, words, size, pull, group, opt, discovered: false, ...(byKey.get(key) as any || {}) })),
    ...stats.filter((r: any) => r.discovered).map((r: any) => ({ key: r.part_key, name: r.part_name, words: r.part_name, size: "S", pull: 20, group: "Also found", opt: false, ...(byKey.get(r.part_key) as any) })),
  ].map((p: any) => {
    const clean = cleanValue(p);
    let reason: string | null = null;
    if (p._merged_into) reason = "merged";
    else if (cfg.never_pull.includes(p.key) || cfg.never_pull.includes(baseKey(p.key))) reason = "never_pull";
    else if (clean == null) reason = "no_data";
    else if (clean < cfg.part_min) reason = "under_cutoff";
    return { ...p, clean, cat: partCat(p.key, p.name, "small"), counted: !reason, reason };
  });
  for (const grp of SAME_UNIT) {
    const live = parts.filter((p) => p.counted && grp.includes(p.key)).sort((a, b) => b.clean - a.clean);
    for (const p of live.slice(1)) { p.counted = false; p.reason = "same_unit"; p.same_as = live[0].key; }
  }
  return parts;
}
async function finalizePlatform(platform: string, partMin?: number) {
  const cfg = await settings();
  if (partMin != null) cfg.part_min = partMin;
  const stats = (await rest("GET", `pm_part_stats?platform=eq.${enc(platform)}&select=part_key,part_name,ask_high,active_count,sold_high,sold_count,discovered`)) || [];
  const merges = await loadMerges(platform.split("|").slice(0, 2).join("|"));
  const counted = valueParts(stats, cfg, merges).filter((p) => p.counted);
  const est = Math.round(counted.reduce((a, p) => a + p.clean, 0));
  await rest("PATCH", `pm_vehicles?platform=eq.${enc(platform)}&status=${inList(["queued", "ready", "error"])}`,
    { status: "ready", status_note: null, est_value: est, pull_count: counted.length, destination: counted.length ? "pull" : "shred" }, "return=minimal");
  return { est, count: counted.length };
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
  // 3. re-run discovery sweeps that were cleared (e.g. by "Clean up duplicates"), a few per run
  if (Date.now() - t0 < budgetMs && !["ebay_keys_missing", "ebay_auth_failed", "ebay_rate_limited", "daily_cap"].some((n) => notes.has(n))) {
    const stale = (await rest("GET", "pm_platforms?sweep_at=is.null&targeted_at=not.is.null&select=*&limit=15")) || [];
    for (const p of stale) {
      if (Date.now() - t0 > budgetMs) break;
      if ((await callsToday()) + 5 > DAILY_CALL_CAP) { notes.add("daily_cap"); break; }
      const claimed = await rest("PATCH", `pm_platforms?platform=eq.${enc(p.platform)}&or=(locked_until.is.null,locked_until.lt.${enc(nowIso())})`, { locked_until: new Date(Date.now() + 5 * 60_000).toISOString() }, "return=representation");
      if (!claimed?.length) continue;
      const before = callCount;
      try {
        const g = await gatherPlatform({ year: p.year, make: p.make, model: p.model }, p.platform, false, true);
        await rest("PATCH", `pm_platforms?platform=eq.${enc(p.platform)}`, { ...(g.sweepOk ? { sweep_at: nowIso() } : {}), locked_until: null }, "return=minimal");
        await finalizePlatform(p.platform, part_min);
      } catch (e) { notes.add((e as Error).message); await rest("PATCH", `pm_platforms?platform=eq.${enc(p.platform)}`, { locked_until: null }, "return=minimal"); }
      finally { await addCalls(callCount - before); }
    }
  }
  // 4. look up generations for models we haven't checked yet (needs ANTHROPIC_API_KEY)
  if (env("ANTHROPIC_API_KEY") && Date.now() - t0 < budgetMs) {
    const cars = (await rest("GET", "pm_vehicles?platform=neq.&select=make,model&order=scanned_at.desc&limit=2000")) || [];
    const done = new Set(((await rest("GET", "pm_model_lookups?select=model_key,status,tried_at&limit=5000")) || []).filter((l: any) => l.status === "ok" || daysOld(l.tried_at) < 7).map((l: any) => l.model_key));
    const todo: any[] = [];
    for (const c of cars) { const k = modelKey(c); if (!done.has(k) && !todo.find((t) => modelKey(t) === k)) todo.push(c); }
    for (const c of todo.slice(0, 3)) { if (Date.now() - t0 > budgetMs) break; const r = await lookupGenerations(c.make, c.model); if ((r as any).error === "anthropic_key_missing") break; }
  }
  // 5. older saved sales get their part numbers read once
  if (Date.now() - t0 < budgetMs) {
    const old = (await rest("GET", "pm_sales?part_numbers=is.null&select=id,title,make,model,part_key,part_name,price,year_from,year_to&limit=500")) || [];
    for (const r of old) {
      const fy = titleYears(r.title);
      r.part_numbers = partNumbers(r.title, r.make); r.fit_from = fy?.[0] ?? null; r.fit_to = fy?.[1] ?? null;
      await rest("PATCH", `pm_sales?id=eq.${r.id}`, { part_numbers: r.part_numbers, fit_from: r.fit_from, fit_to: r.fit_to }, "return=minimal");
    }
    if (old.length) await addInterchangeFromSales(old);
  }
  // 6. parts sold on eBay get marked sold (every 15 minutes)
  try { await syncOrders(); } catch (e) { notes.add("order_sync: " + (e as Error).message.slice(0, 80)); }
  // 7. weekly backup into Supabase Storage
  try { const s = await settings(); if (daysOld(s.last_backup_at) >= 7) await storeBackup(); } catch (e) { notes.add("backup_failed: " + (e as Error).message); }
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
  const mk = platform.split("|").slice(0, 2).join("|");
  const [stats, plat, cfg, merges] = await Promise.all([
    rest("GET", `pm_part_stats?platform=eq.${enc(platform)}&select=*`),
    rest("GET", `pm_platforms?platform=eq.${enc(platform)}&select=*`),
    settings(),
    loadMerges(mk),
  ]);
  const parts = valueParts(stats || [], cfg, merges);
  // Possible duplicates the rules missed: similar names, both still counted, not already ruled on
  const ruled = new Set(merges.map((m) => [m.from_key, m.to_key].sort().join("~")));
  const shown = parts.filter((p) => p.counted);
  const suggestions: { a: string; b: string }[] = [];
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
    const A = shown[i], B = shown[j];
    if (!A.discovered && !B.discovered) continue;
    if (baseKey(A.key) === baseKey(B.key)) continue;
    if (ruled.has([A.key, B.key].sort().join("~"))) continue;
    if (similar(A.name, B.name) >= 0.5) suggestions.push(A.discovered ? { a: A.key, b: B.key } : { a: B.key, b: A.key });
  }
  // Generation, sales speed and known part numbers (from your saved sales)
  const [make, model, yr] = [plat?.[0]?.make, plat?.[0]?.model, Number(platform.split("|")[2])];
  let gen: any = null, sales: any[] = [];
  if (make && model) {
    gen = await generationFor({ make, model, year: yr });
    sales = await salesForPlatform({ make, model }, yr);
  }
  const byPart = new Map<string, any[]>();
  for (const r of sales) { const k = r.part_key; for (const kk of /_x$/.test(k) ? [k.replace(/_x$/, "_l"), k.replace(/_x$/, "_r")] : [k]) byPart.set(kk, [...(byPart.get(kk) || []), r]); }
  for (const p of parts) {
    const rows = byPart.get(p.key) || [];
    if (rows.length) p.speed = speedFrom(rows);
    const pnMap = new Map<string, number[]>();
    for (const r of rows) for (const pn of r.part_numbers || []) pnMap.set(pn, [...(pnMap.get(pn) || []), Number(r.price)]);
    if (pnMap.size) p.part_numbers = [...pnMap.entries()].map(([pn, pr]) => ({ pn, count: pr.length, ...(priceStats(pr) || {}) })).sort((a, b) => b.count - a.count).slice(0, 5);
  }
  return { platform, model_key: mk, platform_info: plat?.[0] || null, parts, part_min: cfg.part_min, never_pull: cfg.never_pull, duplicate_suggestions: suggestions.slice(0, 10), generation: gen?.generation || null, generation_lookup: gen?.lookup || null };
}

// ---------- Every sale you paste is kept: small parts feed pull sheets, large parts are saved for later ----------
const LARGE: [string, string, RegExp][] = [
  ["engine", "Engine assembly", /\b(engine|motor) (assembly|assy)|\blong block|\bshort block|\bengine\b(?! (control|computer|module|wiring|harness|mount|cover|sensor))|\bmotor \d\.\d/],
  ["transmission", "Transmission", /\btransmission\b(?! (control|computer|module|mount|cooler|line|solenoid|valve body))|\btransaxle/],
  ["transfer_case", "Transfer case", /\btransfer case\b(?! (motor|module|switch))/],
  ["differential", "Differential / axle assembly", /\bdifferential|\b(rear|front) axle (assembly|housing)|\bcarrier assembly/],
  ["cv_axle", "Axle shaft / CV axle", /\b(cv )?axle shaft|\bcv axle|\bhalf ?shaft|\bdrive ?shaft/],
  ["door", "Door", /\bdoor (shell|assembly|assy)|\b(front|rear)( left| right| driver| passenger| lh| rh)* door\b(?! (handle|lock|latch|switch|panel|trim|speaker|mirror|glass|regulator|motor|actuator|hinge|seal|module))/],
  ["hood", "Hood", /\bhood\b(?! (latch|release|cable|strut|hinge|insulation|ornament))/],
  ["liftgate", "Trunk lid / liftgate / tailgate", /\b(trunk lid|deck ?lid|lift ?gate|tail ?gate|hatch)\b(?! (module|motor|strut|handle|latch|switch|camera|light|lamp|emblem|badge))/],
  ["fender", "Fender", /\bfender\b(?! (liner|flare|trim|emblem|badge))/],
  ["bumper", "Bumper", /\bbumper\b(?! (sensor|bracket|reinforcement absorber))/],
  ["quarter", "Quarter panel / body section / pillar", /\bquarter panel|\bbody section|\brocker panel|\broof (panel|skin)|\b(a|b|c|center) pillar|\bpillars?\b|\bfloor ?pan|\bfirewall|\bcore support|\bframe (rail|section)/],
  ["bed", "Truck bed / cab", /\b(pickup|truck|cargo) (bed|box)|\bbed (assembly|box)|\btruck beds?\b|\bcab (assembly|shell)|\bcabs?\b(?! (light|lamp|filter|mount))/],
  ["grille", "Grille", /\bgrille?\b/],
  ["radiator", "Radiator / condenser / fan", /\bradiator\b(?! (cap|hose|support))|\bcondenser|\bcooling fan|\bfan (assembly|shroud)|\bintercooler/],
  ["seat", "Seat", /\bseats?\b(?! ?(belt|entertainment|switch|module|heater|heat|motor|track|buckle|control|memory|cover))/],
  ["wheel", "Wheel / rim", /\bwheels?\b(?! (speed|bearing|hub|cap|center|lug|well|arch|liner|sensor|control|opening))|\brims?\b/],
  ["tire", "Tire", /\btires?\b(?! pressure)/],
  ["steering", "Steering column / rack / wheel", /\bsteering (column|rack|gear|wheel|box)(es)?\b(?! (control|button|switch|audio))|\brack (and |& |n )?pinion|\bgear ?box/],
  ["alternator", "Alternator", /\balternator/],
  ["starter", "Starter", /\bstarter( motor)?\b/],
  ["ac_compressor", "A/C compressor", /\ba\/?c compressor|\bac compressor|\bcompressor\b/],
  ["ps_pump", "Power steering pump", /\bpower steering pump/],
  ["suspension", "Suspension (strut, control arm, knuckle)", /\bstruts?\b|\bshocks?\b|\bcontrol arm|\bknuckle|\bspindle|\bcoil spring|\bleaf spring|\bsubframe|\bcrossmember|\bsway bar/],
  ["exhaust", "Exhaust / catalytic converter", /\bexhaust|\bcatalytic|\bmuffler|\bresonator/],
  ["intake", "Intake manifold / cylinder head / turbo", /\bintake manifold|\bcylinder head|\bturbo|\bsupercharger|\bvalve cover|\boil pan/],
  ["fuel_tank", "Fuel tank / fuel pump", /\b(fuel|gas) tank|\bfuel pump\b(?! (driver|control|module))/],
  ["glass", "Glass / windshield", /\bwindshield\b(?! (camera|sensor|washer))|\bglass\b|\bsunroof (glass|assembly|panel)/],
  ["dash", "Dashboard / console / interior trim", /\bdashboard|\bdash (panel|pad|assembly)|\bcenter console|\bdoor (trim )?panel|\bheadliner|\bcarpet|\binterior trim/],
  ["harness", "Wiring harness", /\bwiring harness|\bharness\b/],
];
const NO_STORE = /\b(air ?bags?|srs (module|bag)|inflator)\b/; // airbags can't be sold on eBay

export function saleType(title: string, ship?: number | null, v: any = {}) {
  const t = ` ${title.toLowerCase()} `;
  if (NO_STORE.test(t)) return null;
  const k = classify(title);
  if (k) return { key: k, name: (PART[baseKey(k)] || PART[baseKey(k) + "_l"])?.[1]?.replace(/, (driver|passenger)$/, "") || baseKey(k), size: "small" };
  for (const [key, name, re] of LARGE) if (re.test(t)) return { key: "big:" + key, name, size: "big" };
  const nm = discoverName(title, v);
  if (!nm) return null;
  const slug = nm.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (isBig(title) || (ship != null && ship > BIG_SHIPPING)) return { key: "big:" + slug, name: nm, size: "big" };
  return { key: "d:" + slug, name: nm, size: "small" };
}
export const modelKey = (v: any) => platformKey({ make: v.make, model: v.model, year: "" }).replace(/\|$/, "");

function readPaste(text: string, v: any) {
  const listings = parsePaste(text);
  const modelWord = String(v.model || "").toLowerCase().split(/[\s-]+/)[0];
  const excluded = { junk: 0, other_vehicle: 0, airbag_or_unknown: 0 };
  const sales: (Listing & { type: { key: string; name: string; size: string } })[] = [];
  for (const l of listings) {
    if (modelWord && !l.title.toLowerCase().includes(modelWord)) { excluded.other_vehicle++; continue; }
    if (isJunk(l.title)) { excluded.junk++; continue; }
    const type = saleType(l.title, l.ship, v);
    if (!type) { excluded.airbag_or_unknown++; continue; }
    sales.push({ ...l, type });
  }
  return { read: listings.length, excluded, sales };
}
function summarize(sales: any[], scale = (s: any) => Number(s.qty || 1)) {
  const g = new Map<string, { key: string; name: string; size: string; count: number; prices: number[]; titles: string[]; last?: string }>();
  for (const s of sales) {
    const key = s.type ? s.type.key.replace(/_(l|r|x)$/, "") : String(s.part_key || "").replace(/_(l|r|x)$/, "");
    const x = g.get(key) || { key, name: s.type?.name || s.part_name, size: s.type?.size || s.size, count: 0, prices: [], titles: [] };
    x.count += scale(s);
    for (let i = 0; i < Math.min(20, Math.max(1, Math.round(Number(s.qty || 1)))); i++) x.prices.push(Number(s.price));
    if (x.titles.length < 3 && s.title) x.titles.push(String(s.title).slice(0, 120));
    const d = s.date || s.sold_on; if (d && (!x.last || d > x.last)) x.last = d;
    g.set(key, x);
  }
  return [...g.values()].map((x) => ({ key: x.key, name: x.name, size: x.size, cat: partCat(x.key, x.name, x.size), count: Math.round(x.count * 10) / 10, last: x.last || null, titles: x.titles, ...(priceStats(x.prices) || {}) }))
    .sort((a: any, b: any) => (b.high ?? 0) * b.count - (a.high ?? 0) * a.count);
}

async function researchPreview(text: string, v: any) {
  const r = readPaste(text, v);
  const groups = summarize(r.sales);
  return { read: r.read, excluded: r.excluded, sales: r.sales.length, small: groups.filter((g) => g.size === "small"), big: groups.filter((g) => g.size === "big") };
}

// Rebuild one model year's sold numbers from every saved sale that fits it
async function rebuildPlatformFromSales(v: any, year: number) {
  const mk = modelKey(v);
  const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const keys = [mk, ...(await sisterKeys(v, year))];
  const rows = (await rest("GET", `pm_sales?model_key=${inList(keys)}&size=eq.small&year_from=lte.${year}&year_to=gte.${year}&or=(sold_on.gte.${since},sold_on.is.null)&select=part_key,part_name,title,price,qty,period_days,sold_on,pasted_at,fit_from,fit_to&limit=20000`)) || [];
  // A title that says "2005-2007" doesn't fit a 2010: skip sales whose own years exclude this one
  for (let i = rows.length - 1; i >= 0; i--) { const r = rows[i]; if (r.fit_from && r.fit_to && (year < r.fit_from || year > r.fit_to)) rows.splice(i, 1); }
  const now = Date.now();
  const recent = (r: any, days: number) => now - new Date(r.sold_on || r.pasted_at).getTime() <= days * 864e5;
  const perKey = new Map<string, any[]>();
  for (const r of rows) {
    // Terapeak rows are totals over a period; eBay rows are single sales with a date
    if (!recent(r, 180)) continue; // prices from the last 6 months
    const keys = /_x$/.test(r.part_key) ? [r.part_key.replace(/_x$/, "_l"), r.part_key.replace(/_x$/, "_r")] : [r.part_key];
    for (const k of keys) perKey.set(k, [...(perKey.get(k) || []), { ...r, half: keys.length > 1 }]);
  }
  const platform = platformKey({ ...v, year });
  const out: any[] = [];
  for (const [key, list] of perKey) {
    let count = 0; const prices: number[] = []; const titles: string[] = [];
    for (const r of list) {
      const w = r.half ? 0.5 : 1;
      if (r.period_days) count += (Number(r.qty) * 90 / Number(r.period_days)) * w;
      else if (recent(r, 90)) count += Number(r.qty || 1) * w;
      for (let i = 0; i < Math.min(20, Math.max(1, Math.round(Number(r.qty || 1)))); i++) prices.push(Number(r.price));
      if (titles.length < 3) titles.push(String(r.title).slice(0, 120));
    }
    const st = priceStats(prices);
    if (!st) continue;
    const disc = key.startsWith("d:");
    if (disc && prices.length < 2) continue; // one stray sale isn't a part type yet
    out.push({ platform, part_key: key, sold_count: Math.round(count * 10) / 10, sold_low: st.low, sold_median: st.median, sold_high: st.high, sold_source: "manual", sold_updated: nowIso(),
      part_name: disc ? list[0].part_name : PART[key]?.[1] ?? list[0].part_name, group_name: disc ? "Also found" : PART[key]?.[5] ?? null, discovered: disc, sample_titles: titles });
  }
  if (out.length) await rest("POST", "pm_part_stats?on_conflict=platform,part_key", out, "resolution=merge-duplicates,return=minimal");
  await rest("POST", "pm_platforms?on_conflict=platform", [{ platform, year: String(year), make: v.make, model: v.model, researched_at: nowIso() }], "resolution=merge-duplicates,return=minimal");
  return platform;
}

async function addInterchangeFromSales(rows: any[]) {
  const ic: any[] = [];
  for (const r of rows) for (const pn of r.part_numbers || []) ic.push({ part_number: pn, part_key: r.part_key, part_name: r.part_name, make: r.make, model: r.model, year_from: r.fit_from ?? r.year_from, year_to: r.fit_to ?? r.year_to, source: "sold-title", ref: String(r.id), price: r.price });
  for (let i = 0; i < ic.length; i += 500) await rest("POST", "pm_interchange?on_conflict=part_number,source,ref", ic.slice(i, i + 500), "resolution=ignore-duplicates,return=minimal");
}
async function researchSave(text: string, v: any, yearFrom: number, yearTo: number, periodDays: number | null, who: any, sisters: any[] = []) {
  const r = readPaste(text, v);
  const y1 = Math.min(yearFrom, yearTo), y2 = Math.max(yearFrom, yearTo);
  const mk = modelKey(v);
  const tp = !!periodDays;
  const rows = r.sales.map((s) => ({
    model_key: mk, make: v.make, model: v.model, year_from: y1, year_to: y2,
    title: s.title, price: s.price, qty: s.qty || 1, period_days: tp ? periodDays : null, sold_on: s.date || null, ship: s.ship ?? null,
    part_key: s.type.key, part_name: s.type.name, size: s.type.size, source: tp ? "terapeak" : "ebay-sold",
    part_numbers: partNumbers(s.title, v.make), fit_from: titleYears(s.title)?.[0] ?? null, fit_to: titleYears(s.title)?.[1] ?? null,
    // eBay rows are single sales: same title+price+date = same sale. Terapeak rows are running totals: the newest paste wins.
    dedupe_key: tp ? `${mk}|tp|${s.title.toLowerCase()}` : `${mk}|${s.title.toLowerCase()}|${s.price}|${s.date || ""}`,
    ...(who?.id && who.id !== "cron" ? { pasted_by: who.id } : {}),
  }));
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await rest("POST", "pm_sales?on_conflict=dedupe_key", chunk, tp ? "resolution=merge-duplicates,return=representation" : "resolution=ignore-duplicates,return=representation");
    added += (res || []).length;
    await addInterchangeFromSales(res || []);
  }
  const { part_min } = await settings();
  const years: number[] = [];
  for (let y = y1; y <= y2 && years.length < 15; y++) { const p = await rebuildPlatformFromSales(v, y); await finalizePlatform(p, part_min); years.push(y); }
  // Sister models (e.g. GMC Terrain for an Equinox) share these parts: rebuild their years too
  for (const sis of (Array.isArray(sisters) ? sisters : [])) {
    const sv = { make: sis.make, model: sis.model };
    for (let y = Math.max(y1, sis.year_from ?? y1); y <= Math.min(y2, sis.year_to ?? y2); y++) { const p = await rebuildPlatformFromSales(sv, y); await finalizePlatform(p, part_min); }
  }
  const groups = summarize(r.sales);
  return { read: r.read, excluded: r.excluded, saved: added, already_saved: rows.length - added, saved_years: years,
    small: groups.filter((g) => g.size === "small").length, big: groups.filter((g) => g.size === "big").length };
}

// Everything ever saved for a model, small and large
async function modelSales(v: any) {
  const mk = modelKey(v);
  const rows = (await rest("GET", `pm_sales?model_key=eq.${enc(mk)}&select=part_key,part_name,size,title,price,qty,period_days,sold_on,year_from,year_to&order=sold_on.desc.nullslast&limit=20000`)) || [];
  const all = summarize(rows);
  const years = rows.length ? [Math.min(...rows.map((r: any) => r.year_from)), Math.max(...rows.map((r: any) => r.year_to))] : null;
  return { total_sales: rows.reduce((n: number, r: any) => n + Number(r.qty || 1), 0), years, small: all.filter((g) => g.size === "small"), big: all.filter((g) => g.size === "big") };
}

// One-time cleanup: drop sweep results made with the old rules and re-run every sweep with the new ones
async function cleanupDiscovered() {
  await rest("DELETE", "pm_part_stats?discovered=is.true&ask_mode=eq.sweep&sold_source=is.null", undefined, "return=minimal");
  await rest("PATCH", "pm_part_stats?discovered=is.true&ask_mode=eq.sweep", { active_count: null, ask_low: null, ask_median: null, ask_high: null, ask_mode: null }, "return=minimal");
  await rest("PATCH", "pm_platforms?sweep_at=not.is.null", { sweep_at: null }, "return=minimal");
  const r = await recomputeAll();
  return { ...r, note: "Old 'Also found' rows removed. The background timer re-checks each model with the new rules, a few every 5 minutes." };
}
async function setMerge(body: any) {
  const mk = String(body.model_key || ""), from = String(body.from_key || ""), to = String(body.to_key || ""), kind = body.kind === "distinct" ? "distinct" : "merge";
  if (!mk || !from || !to || from === to) return { error: "Pick two different parts." };
  await rest("POST", "pm_merges?on_conflict=model_key,from_key,to_key", [{ model_key: mk, from_key: from, to_key: to, kind }], "resolution=merge-duplicates,return=minimal");
  const plats = ((await rest("GET", `pm_platforms?platform=like.${enc(mk)}|*&select=platform`)) || []).map((p: any) => p.platform);
  for (const p of plats) await finalizePlatform(p);
  return { ok: true, models: plats.length };
}
// Data page: totals by part type across the cars you bought, computed the same way as each car's value
async function dataSummary(body: any) {
  const days = Math.max(1, Math.min(3650, Number(body.days) || 30));
  const since = new Date(Date.now() - days * 864e5).toISOString();
  let q = `pm_vehicles?scanned_at=gte.${enc(since)}&platform=neq.&select=id,platform,year,make,model,decision,destination,scanned_at&limit=5000`;
  if (body.make) q += `&make=eq.${enc(body.make)}`;
  if (body.model) q += `&model=eq.${enc(body.model)}`;
  const cars = (await rest("GET", q)) || [];
  const plats = [...new Set(cars.map((c: any) => c.platform))] as string[];
  const cfg = await settings();
  const stats: any[] = [];
  for (let i = 0; i < plats.length; i += 40) stats.push(...((await rest("GET", `pm_part_stats?platform=${inList(plats.slice(i, i + 40))}&select=*`)) || []));
  const mks = [...new Set(plats.map((p) => p.split("|").slice(0, 2).join("|")))];
  const merges: any[] = mks.length ? ((await rest("GET", `pm_merges?model_key=${inList(mks)}&select=*`)) || []) : [];
  const byPlat = new Map<string, any[]>();
  for (const p of plats) {
    const mk = p.split("|").slice(0, 2).join("|");
    byPlat.set(p, valueParts(stats.filter((r) => r.platform === p), cfg, merges.filter((m) => m.model_key === mk)));
  }
  const parts = new Map<string, any>(), models = new Map<string, any>();
  for (const car of cars) {
    const list = byPlat.get(car.platform) || [];
    for (const r of list) {
      if (!r.counted) continue;
      const sold = r.sold_high != null;
      if (body.sold_only && !sold) continue;
      const k = r.discovered ? "d:" + slug(r.name) : baseKey(r.key);
      const g = parts.get(k) || { key: k, name: r.discovered ? r.name : String(r.name).replace(/, (driver|passenger)$/, ""), cat: r.cat, discovered: r.discovered, cars: new Set(), total: 0, n: 0, sold: 0 };
      g.cars.add(car.id); g.total += r.clean; g.n++; if (sold) g.sold++;
      parts.set(k, g);
    }
    const counted = list.filter((r) => r.counted && (!body.sold_only || r.sold_high != null));
    const m = models.get(car.platform) || { platform: car.platform, year: car.year, make: car.make, model: car.model, cars: 0, value: counted.reduce((a, r) => a + r.clean, 0), sold_parts: counted.filter((r) => r.sold_high != null).length };
    m.cars++; models.set(car.platform, m);
  }
  // Large parts: from saved sales of these models (never added to any car's value)
  let large: any[] = [];
  if (mks.length) {
    const sales: any[] = [];
    for (let i = 0; i < mks.length; i += 40) sales.push(...((await rest("GET", `pm_sales?model_key=${inList(mks.slice(i, i + 40))}&size=eq.big&select=part_key,part_name,size,price,qty,sold_on,title&limit=20000`)) || []));
    large = summarize(sales).map((g: any) => ({ ...g, cat: "large" }));
  }
  return {
    days, cars: cars.length, part_min: cfg.part_min,
    parts: [...parts.values()].map((g) => ({ key: g.key, name: g.name, cat: g.cat, discovered: g.discovered, cars: g.cars.size, avg: g.total / g.n, total: g.total, sold_share: g.n ? g.sold / g.n : 0 })).sort((a, b) => b.total - a.total),
    models: [...models.values()].sort((a, b) => b.value - a.value),
    large,
    makes: [...new Set(cars.map((c: any) => c.make).filter(Boolean))].sort(),
  };
}
// ---------- Backups ----------
const BACKUP_TABLES = ["pm_vehicles", "pm_platforms", "pm_part_stats", "pm_sales", "pm_items", "pm_settings", "pm_people", "pm_merges", "pm_usage", "pm_generations", "pm_model_lookups", "pm_interchange"];
async function dumpTable(t: string) {
  const out: any[] = [];
  for (let off = 0; off < 500000; off += 1000) {
    const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/${t}?select=*`, { headers: { ...serviceHeaders(), Range: `${off}-${off + 999}`, "Range-Unit": "items" } });
    if (!r.ok) break;
    const rows = await r.json(); out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
export async function buildBackup() {
  const data: Record<string, any[]> = {};
  for (const t of BACKUP_TABLES) { try { data[t] = await dumpTable(t); } catch { data[t] = []; } }
  return { app: "QuickPull", made_at: nowIso(), tables: data };
}
async function storeBackup() {
  const b = await buildBackup();
  const url = env("SUPABASE_URL");
  const h = serviceHeaders();
  const hb = { ...h, Authorization: (h as any).Authorization || `Bearer ${(h as any).apikey}` };
  await fetch(`${url}/storage/v1/bucket`, { method: "POST", headers: { ...hb, "Content-Type": "application/json" }, body: JSON.stringify({ id: "backups", name: "backups", public: false }) }).catch(() => null);
  const name = `quickpull-${b.made_at.slice(0, 10)}.json`;
  const r = await fetch(`${url}/storage/v1/object/backups/${name}`, { method: "POST", headers: { ...hb, "Content-Type": "application/json", "x-upsert": "true" }, body: JSON.stringify(b) });
  if (!r.ok) throw new Error(`storage_${r.status}`);
  await rest("PATCH", "pm_settings?id=eq.1", { last_backup_at: nowIso() }, "return=minimal");
  return { stored: name, rows: Object.fromEntries(Object.entries(b.tables).map(([k, v]) => [k, v.length])) };
}

// ---------- Generations (Wikipedia + Claude) ----------
const WIKI_UA = { "User-Agent": "QuickPull/1.0 (used auto parts yard tool)" };
async function wikiText(make: string, model: string) {
  const q = `${make} ${model}`;
  const s = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(q + " car")}&srlimit=5&format=json&origin=*`, { headers: WIKI_UA }).then((r) => r.json()).catch(() => null);
  const hits = (s?.query?.search || []).map((h: any) => h.title as string);
  const want = q.toLowerCase();
  const title = hits.find((t: string) => t.toLowerCase() === want) || hits.find((t: string) => t.toLowerCase().includes(String(model).toLowerCase())) || hits[0];
  if (!title) return null;
  const e = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&titles=${enc(title)}&format=json&origin=*`, { headers: WIKI_UA }).then((r) => r.json()).catch(() => null);
  const page: any = Object.values(e?.query?.pages || {})[0];
  if (!page?.extract) return null;
  return { title: page.title as string, url: `https://en.wikipedia.org/wiki/${enc(String(page.title).replace(/ /g, "_"))}`, text: String(page.extract).slice(0, 60000) };
}
export async function askClaude(prompt: string, maxTokens = 2000): Promise<string> {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) throw new Error("anthropic_key_missing");
  let lastErr = "";
  for (const model of [env("CLAUDE_MODEL") || "claude-haiku-5-5", "claude-sonnet-5-5"]) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) return (d.content || []).map((c: any) => c.text || "").join("");
    lastErr = `anthropic_${r.status}: ${d?.error?.message || ""}`.slice(0, 200);
    if (r.status !== 404 && r.status !== 400) break;
  }
  throw new Error(lastErr);
}
export const firstJson = (t: string) => { const a = t.indexOf("{"), b = t.lastIndexOf("}"); return a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : null; };
async function lookupGenerations(make: string, model: string, force = false) {
  const mk = modelKey({ make, model });
  if (!force) {
    const prev = (await rest("GET", `pm_model_lookups?model_key=eq.${enc(mk)}&select=*`))?.[0];
    if (prev && (prev.status === "ok" || daysOld(prev.tried_at) < 7)) return { skipped: true };
  }
  const log = (status: string, error: string | null = null) => rest("POST", "pm_model_lookups?on_conflict=model_key", [{ model_key: mk, make, model, status, error, tried_at: nowIso() }], "resolution=merge-duplicates,return=minimal");
  try {
    const w = await wikiText(make, model);
    if (!w) { await log("no_article"); return { error: "No Wikipedia article found." }; }
    const out = await askClaude(`You help a used auto parts yard in the United States work out which model years of a vehicle share parts.
Vehicle: ${make} ${model}
Below is the Wikipedia article "${w.title}".
List every generation sold in the US: US model years (not calendar production years), any mid-cycle refresh/facelift model years (lights, bumpers, radios often change then), and "sister" vehicles from other brands or names that share the same platform and many interchangeable parts in those years (badge-engineered twins, e.g. Chevrolet Equinox and GMC Terrain).
Only include what the article supports. If unsure of a year, give your best estimate and lower the confidence.
Reply with JSON only, no other text:
{"generations":[{"name":"Second generation","year_from":2010,"year_to":2017,"refresh_years":[2016],"sisters":[{"make":"GMC","model":"Terrain","year_from":2010,"year_to":2017}],"notes":"short note"}],"confidence":"high|medium|low"}

ARTICLE:
${w.text}`, 2500);
    const j = firstJson(out);
    const gens = (j?.generations || []).filter((g: any) => Number(g.year_from) > 1950 && Number(g.year_to) >= Number(g.year_from));
    if (!gens.length) { await log("failed", "No generations in the answer"); return { error: "Couldn't read generations from the article." }; }
    await rest("DELETE", `pm_generations?model_key=eq.${enc(mk)}&edited=is.false`, undefined, "return=minimal");
    const edited = ((await rest("GET", `pm_generations?model_key=eq.${enc(mk)}&select=year_from`)) || []).map((r: any) => r.year_from);
    const rows = gens.filter((g: any) => !edited.includes(Number(g.year_from))).map((g: any) => ({
      model_key: mk, make, model, gen_name: String(g.name || "").slice(0, 80), year_from: Number(g.year_from), year_to: Number(g.year_to),
      refresh_years: (g.refresh_years || []).map(Number).filter((n: number) => n > 1950), sisters: (g.sisters || []).filter((x: any) => x?.make && x?.model).map((x: any) => ({ make: titleCase(String(x.make)), model: String(x.model), year_from: Number(x.year_from) || Number(g.year_from), year_to: Number(x.year_to) || Number(g.year_to) })),
      notes: String(g.notes || "").slice(0, 300), source_url: w.url, confidence: String(j.confidence || "medium"),
    }));
    if (rows.length) await rest("POST", "pm_generations?on_conflict=model_key,year_from", rows, "resolution=merge-duplicates,return=minimal");
    await log("ok");
    return { generations: rows.length, source: w.url };
  } catch (e) { await log("failed", (e as Error).message); return { error: (e as Error).message }; }
}
async function generationFor(v: any) {
  const mk = modelKey(v), y = Number(v.year);
  const g = (await rest("GET", `pm_generations?model_key=eq.${enc(mk)}&year_from=lte.${y}&year_to=gte.${y}&select=*&order=edited.desc&limit=1`))?.[0] || null;
  const lookup = (await rest("GET", `pm_model_lookups?model_key=eq.${enc(mk)}&select=status,error,tried_at`))?.[0] || null;
  return { generation: g, lookup };
}
// Models that share parts with this one in this year: its own sisters, plus any model that lists it as a sister
async function sisterKeys(v: any, year: number): Promise<string[]> {
  const me = modelKey(v);
  const gens = (await rest("GET", `pm_generations?year_from=lte.${year}&year_to=gte.${year}&select=model_key,sisters&limit=5000`)) || [];
  const out = new Set<string>();
  const inYear = (s: any) => (s.year_from ?? 0) <= year && year <= (s.year_to ?? 9999);
  for (const g of gens) {
    const sis = (g.sisters || []).filter(inYear);
    if (g.model_key === me) for (const s of sis) out.add(modelKey(s));
    else if (sis.some((s: any) => modelKey(s) === me)) out.add(g.model_key);
  }
  out.delete(me);
  return [...out];
}
async function saveGeneration(b: any) {
  const mk = modelKey(b.vehicle || {}), yf = Number(b.year_from), yt = Number(b.year_to);
  if (!(yf > 1950 && yt >= yf && yt - yf <= 25)) return { error: "Enter a valid year range." };
  const sisters = (Array.isArray(b.sisters) ? b.sisters : []).filter((s: any) => s.make && s.model).map((s: any) => ({ make: String(s.make), model: String(s.model), year_from: Number(s.year_from) || yf, year_to: Number(s.year_to) || yt }));
  if (b.id) await rest("PATCH", `pm_generations?id=eq.${Number(b.id)}`, { year_from: yf, year_to: yt, sisters, edited: true }, "return=minimal");
  else await rest("POST", "pm_generations?on_conflict=model_key,year_from", [{ model_key: mk, make: b.vehicle.make, model: b.vehicle.model, gen_name: "Set by you", year_from: yf, year_to: yt, sisters, edited: true, confidence: "yours" }], "resolution=merge-duplicates,return=minimal");
  return { ok: true };
}

// ---------- How fast parts sell, from saved sale dates ----------
export function speedFrom(rows: any[], now = Date.now()) {
  const weeks = Array(12).fill(0);
  let n90 = 0, rate = 0, last: string | null = null;
  for (const r of rows) {
    const q = Number(r.qty || 1);
    if (r.period_days) { rate += q * 90 / Number(r.period_days); continue; }
    if (!r.sold_on) continue;
    const age = (now - new Date(r.sold_on).getTime()) / 864e5;
    if (age < 0) continue;
    if (age <= 90) n90 += q;
    const w = Math.floor(age / 7); if (w < 12) weeks[11 - w] += q;
    if (!last || r.sold_on > last) last = String(r.sold_on).slice(0, 10);
  }
  const per90 = Math.max(n90, rate);
  const recent = weeks.slice(8).reduce((a, b) => a + b, 0), before = weeks.slice(0, 8).reduce((a, b) => a + b, 0) / 2;
  return {
    per90: Math.round(per90 * 10) / 10, per_week: Math.round(per90 / 12.86 * 10) / 10, every_days: per90 > 0 ? Math.round(90 / per90 * 10) / 10 : null,
    label: per90 >= 13 ? "fast" : per90 >= 3 ? "steady" : per90 > 0 ? "slow" : "unknown",
    trend: recent > before * 1.3 && recent >= 2 ? "up" : before > recent * 1.3 && before >= 2 ? "down" : "flat", weeks, last, dated: n90 > 0,
  };
}
async function salesForPlatform(v: any, year: number, size = "small") {
  const keys = [modelKey(v), ...(await sisterKeys(v, year))];
  const rows = (await rest("GET", `pm_sales?model_key=${inList(keys)}&size=eq.${size}&year_from=lte.${year}&year_to=gte.${year}&select=part_key,part_name,price,qty,period_days,sold_on,part_numbers,fit_from,fit_to,model_key&limit=20000`)) || [];
  return rows.filter((r: any) => !(r.fit_from && r.fit_to && (year < r.fit_from || year > r.fit_to)));
}
async function fastestSellers(b: any) {
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const rows = (await rest("GET", `pm_sales?size=eq.small&source=eq.ebay-sold&sold_on=gte.${since}&select=part_key,part_name,price,qty,sold_on,model_key&limit=50000`)) || [];
  const g = new Map<string, any>();
  for (const r of rows) {
    const k = baseKey(r.part_key || "");
    const x = g.get(k) || { key: k, name: String(r.part_name || k).replace(/, (driver|passenger)$/, ""), rows: [], prices: [], models: new Set() };
    x.rows.push(r); x.prices.push(Number(r.price)); x.models.add(r.model_key); g.set(k, x);
  }
  const cfg = await settings();
  return { parts: [...g.values()].filter((x) => !cfg.never_pull.includes(x.key)).map((x) => ({ key: x.key, name: x.name, cat: partCat(x.key, x.name), models: x.models.size, ...speedFrom(x.rows), ...(priceStats(x.prices) || {}) })).sort((a, b) => b.per90 - a.per90).slice(0, 80) };
}
async function partNumberInfo(pn: string) {
  const rows = (await rest("GET", `pm_interchange?part_number=eq.${enc(pn.toUpperCase().replace(/\s+/g, ""))}&select=*&limit=500`)) || [];
  const fits = new Map<string, any>();
  for (const r of rows) { const k = `${r.make}|${r.model}`; const f = fits.get(k) || { make: r.make, model: r.model, year_from: r.year_from, year_to: r.year_to, seen: 0, sources: new Set() }; f.year_from = Math.min(f.year_from ?? r.year_from, r.year_from ?? f.year_from); f.year_to = Math.max(f.year_to ?? r.year_to, r.year_to ?? f.year_to); f.seen++; f.sources.add(r.source); fits.set(k, f); }
  return { part_number: pn, fits: [...fits.values()].map((f) => ({ ...f, sources: [...f.sources] })), prices: priceStats(rows.map((r: any) => Number(r.price)).filter(Boolean)) };
}

// ===================================================================
// Selling: AI reading of photos, "same part, different car", eBay listing
// ===================================================================
const SELL_SCOPES = ["https://api.ebay.com/oauth/api_scope", "https://api.ebay.com/oauth/api_scope/sell.inventory", "https://api.ebay.com/oauth/api_scope/sell.account", "https://api.ebay.com/oauth/api_scope/sell.fulfillment"];
const PACKAGES: Record<string, any> = {
  S: { weight: { value: 3, unit: "POUND" }, dimensions: { length: 12, width: 10, height: 6, unit: "INCH" } },
  M: { weight: { value: 10, unit: "POUND" }, dimensions: { length: 22, width: 16, height: 12, unit: "INCH" } },
};
const GRADE_CONDITION: Record<string, string> = {
  A: "Clean used OEM part. Pulled from a running/driving vehicle where possible. Minimal wear.",
  B: "Used OEM part with light wear and normal scuffs. Fully intact.",
  C: "Used OEM part with visible cosmetic wear. See photos for exact condition.",
};
// Same number written two ways ("GM 2098 3440" and "20983440") counts once
function cleanPns(list: unknown[]) {
  const all = [...new Set(list.map((x) => String(x).toUpperCase().replace(/[\s]+/g, "")).filter((x) => x.length >= 5 && x.length <= 20))];
  return all.filter((x) => !all.some((y) => y !== x && x.endsWith(y) && /^[A-Z]{1,4}-?$/.test(x.slice(0, x.length - y.length))));
}
async function itemRow(id: number) { return (await rest("GET", `pm_items?id=eq.${Number(id)}&select=*`))?.[0] || null; }
async function vehicleRow(id: number | null) { return id ? (await rest("GET", `pm_vehicles?id=eq.${Number(id)}&select=*`))?.[0] || null : null; }

// Claude looks at the photos: part numbers, condition grade, notes
async function analyzePhotos(itemId: number) {
  const it = await itemRow(itemId);
  if (!it) return { error: "Part not found." };
  const photos = (it.photos || []).slice(0, 8);
  if (!photos.length) return { error: "Add photos first." };
  if (!env("ANTHROPIC_API_KEY")) return { error: "Add the ANTHROPIC_API_KEY secret to read photos." };
  const v = await vehicleRow(it.vehicle_id);
  const content: any[] = photos.map((ph: any) => ({ type: "image", source: { type: "url", url: ph.url } }));
  content.push({ type: "text", text: `These photos show one used OEM auto part pulled from a ${[v?.year, v?.make, v?.model, v?.trim].filter(Boolean).join(" ")}. The part is: ${it.part_name}.
1) Read every OEM part number printed, stamped, or on a label (manufacturer part numbers, not barcodes' serials, not dates). Copy them exactly. Skip anything you can't read clearly.
2) Grade its condition for resale: A = clean, no damage, minimal wear. B = light wear or scuffs, fully intact. C = visible damage such as cracks, broken tabs, haze, deep scratches, missing pieces.
3) Write short notes on anything a buyer should know, and one line of condition text for an eBay listing.
Reply with JSON only: {"part_numbers":["..."],"grade":"A|B|C","notes":"...","condition_text":"...","is_this_part":true}` });
  const key = env("ANTHROPIC_API_KEY");
  let out = "", lastErr = "";
  for (const model of [env("CLAUDE_VISION_MODEL") || "claude-sonnet-5-5", "claude-haiku-5-5"]) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: 800, messages: [{ role: "user", content }] }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { out = (d.content || []).map((c: any) => c.text || "").join(""); break; }
    lastErr = `${r.status}: ${d?.error?.message || ""}`;
    if (r.status !== 404 && r.status !== 400) break;
  }
  if (!out) return { error: "Claude couldn't read the photos (" + lastErr.slice(0, 120) + ")." };
  const j = firstJson(out) || {};
  const pns = cleanPns(j.part_numbers || []);
  const grade = ["A", "B", "C"].includes(j.grade) ? j.grade : null;
  await rest("PATCH", `pm_items?id=eq.${it.id}`, { part_numbers: pns, ai_grade: grade, ai_notes: String(j.notes || "").slice(0, 600), condition_text: String(j.condition_text || "").slice(0, 300) }, "return=minimal");
  return { part_numbers: pns, grade, notes: j.notes || "", condition_text: j.condition_text || "", is_this_part: j.is_this_part !== false };
}
// A person confirms what the photos say; that's what goes into "same part, different car"
async function confirmItem(b: any) {
  const it = await itemRow(b.id);
  if (!it) return { error: "Part not found." };
  const pns = cleanPns(b.part_numbers || []);
  const grade = ["A", "B", "C"].includes(b.grade) ? b.grade : it.grade;
  await rest("PATCH", `pm_items?id=eq.${it.id}`, { part_numbers: pns, grade, condition_text: String(b.condition_text ?? it.condition_text ?? "").slice(0, 300), confirmed_at: nowIso() }, "return=minimal");
  const v = await vehicleRow(it.vehicle_id);
  const rows = pns.map((pn) => ({ part_number: pn, part_key: it.part_key, part_name: it.part_name, make: v?.make, model: v?.model, year_from: Number(v?.year) || null, year_to: Number(v?.year) || null, source: it.photos?.length ? "photo" : "pulled", ref: it.sku || String(it.id), price: it.list_price }));
  if (rows.length) await rest("POST", "pm_interchange?on_conflict=part_number,source,ref", rows, "resolution=merge-duplicates,return=minimal");
  const fits = [];
  for (const pn of pns) fits.push(await partNumberInfo(pn));
  return { ok: true, fits };
}

// ---------- eBay seller connection ----------
async function ebayRow() { return (await rest("GET", "pm_ebay?id=eq.1&select=*"))?.[0] || {}; }
async function ebayConnectUrl(returnUrl: string) {
  const id = env("EBAY_CLIENT_ID"), ru = env("EBAY_RUNAME");
  if (!id || !ru) return { error: "Add the EBAY_RUNAME secret first (see the setup guide)." };
  const state = crypto.randomUUID();
  await rest("PATCH", "pm_ebay?id=eq.1", { oauth_state: state, return_url: String(returnUrl || "").slice(0, 300) }, "return=minimal");
  return { url: "https://auth.ebay.com/oauth2/authorize?" + new URLSearchParams({ client_id: id, response_type: "code", redirect_uri: ru, scope: SELL_SCOPES.join(" "), state }).toString() };
}
async function ebayTokenCall(params: Record<string, string>) {
  const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${env("EBAY_CLIENT_ID")}:${env("EBAY_CLIENT_SECRET")}`) },
    body: new URLSearchParams(params).toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("ebay_signin_failed: " + (d.error_description || d.error || r.status));
  return d;
}
async function ebayOauthCallback(url: URL) {
  const row = await ebayRow();
  const back = (msg: string) => new Response(null, { status: 302, headers: { Location: (row.return_url || "/") + "#ebay=" + encodeURIComponent(msg) } });
  if (!url.searchParams.get("code")) return back(url.searchParams.get("error_description") || "eBay sign-in was cancelled");
  if (!row.oauth_state || url.searchParams.get("state") !== row.oauth_state) return back("Sign-in link expired. Try Connect eBay again.");
  try {
    const d = await ebayTokenCall({ grant_type: "authorization_code", code: url.searchParams.get("code")!, redirect_uri: env("EBAY_RUNAME") });
    await rest("PATCH", "pm_ebay?id=eq.1", {
      refresh_token: d.refresh_token, refresh_expires_at: new Date(Date.now() + (d.refresh_token_expires_in || 47304000) * 1000).toISOString(),
      access_token: d.access_token, access_expires_at: new Date(Date.now() + (d.expires_in || 7200) * 1000).toISOString(), connected_at: nowIso(), oauth_state: null,
    }, "return=minimal");
    return back("connected");
  } catch (e) { return back((e as Error).message); }
}
async function sellToken() {
  const row = await ebayRow();
  if (!row.refresh_token) throw new Error("ebay_not_connected");
  if (row.access_token && new Date(row.access_expires_at).getTime() > Date.now() + 120_000) return row.access_token as string;
  const d = await ebayTokenCall({ grant_type: "refresh_token", refresh_token: row.refresh_token, scope: SELL_SCOPES.join(" ") });
  await rest("PATCH", "pm_ebay?id=eq.1", { access_token: d.access_token, access_expires_at: new Date(Date.now() + (d.expires_in || 7200) * 1000).toISOString() }, "return=minimal");
  return d.access_token as string;
}
export async function sell(method: string, path: string, body?: unknown) {
  const token = await sellToken();
  const r = await fetch(`https://api.ebay.com${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Language": "en-US", "Accept-Language": "en-US", "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  const d = t ? (() => { try { return JSON.parse(t); } catch { return { raw: t }; } })() : {};
  if (!r.ok) { const m = (d.errors || []).map((e: any) => e.longMessage || e.message).filter(Boolean).join(" · ") || t.slice(0, 200) || r.status; throw new Error(`eBay said: ${m}`); }
  return d;
}
async function ebaySellerStatus() {
  const row = await ebayRow();
  const out: any = { connected: !!row.refresh_token, connected_at: row.connected_at, runame: !!env("EBAY_RUNAME"), location: row.location_label || null,
    fulfillment_policy_id: row.fulfillment_policy_id, payment_policy_id: row.payment_policy_id, return_policy_id: row.return_policy_id, last_order_sync: row.last_order_sync };
  if (!row.refresh_token) return out;
  try {
    const [f, p, r] = await Promise.all(["fulfillment_policy", "payment_policy", "return_policy"].map((k) => sell("GET", `/sell/account/v1/${k}?marketplace_id=EBAY_US`)));
    out.policies = {
      fulfillment: (f.fulfillmentPolicies || []).map((x: any) => ({ id: x.fulfillmentPolicyId, name: x.name })),
      payment: (p.paymentPolicies || []).map((x: any) => ({ id: x.paymentPolicyId, name: x.name })),
      return: (r.returnPolicies || []).map((x: any) => ({ id: x.returnPolicyId, name: x.name })),
    };
  } catch (e) { out.policy_error = (e as Error).message; }
  return out;
}
async function ebaySellerSetup(b: any) {
  const patch: any = {};
  for (const k of ["fulfillment_policy_id", "payment_policy_id", "return_policy_id"]) if (b[k]) patch[k] = String(b[k]);
  if (b.postal_code) {
    const key = "quickpull-yard";
    const loc = { location: { address: { city: b.city || undefined, stateOrProvince: b.state || undefined, postalCode: String(b.postal_code), country: "US" } }, locationTypes: ["WAREHOUSE"], name: "QuickPull yard", merchantLocationStatus: "ENABLED" };
    try { await sell("POST", `/sell/inventory/v1/location/${key}`, loc); }
    catch (e) { if (!/already exists|25803/i.test((e as Error).message)) throw e; await sell("POST", `/sell/inventory/v1/location/${key}/update_location_details`, { location: loc.location }).catch(() => null); }
    patch.location_key = key; patch.location_label = [b.city, b.state, b.postal_code].filter(Boolean).join(", ");
  }
  if (Object.keys(patch).length) await rest("PATCH", "pm_ebay?id=eq.1", patch, "return=minimal");
  return { ok: true };
}

// ---------- Listing draft ----------
const SIDE: Record<string, string> = { _l: "Left", _r: "Right" };
const capWords = (x: string) => x.split(" ").map((w) => (/^[A-Z0-9-]{2,}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
function listingName(it: any) {
  const n = capWords(String(it.part_name || "").replace(/[()]/g, " ").replace(/\s*\/\s*/g, " ").replace(/,?\s*(driver|passenger|left|right)\b.*$/i, "").replace(/\s+/g, " ").trim());
  const side = /_l$/.test(it.part_key) ? "Driver Left" : /_r$/.test(it.part_key) ? "Passenger Right" : "";
  return [side, n].filter(Boolean).join(" ");
}
async function suggestCategory(q: string, v: any) {
  const token = await ebayToken(BROWSE_SCOPE);
  for (const tree of ["100", "0"]) {
    try {
      const r = await fetch(`https://api.ebay.com/commerce/taxonomy/v1/category_tree/${tree}/get_category_suggestions?q=${enc(q)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) continue;
      const d = await r.json();
      const hit = (d.categorySuggestions || []).find((c: any) => (c.categoryTreeNodeAncestors || []).some((a: any) => /parts|accessories|motors/i.test(a.categoryName)));
      if (hit) return { id: hit.category.categoryId, name: hit.category.categoryName, tree };
    } catch { /* try the next way */ }
  }
  // Fallback: the category most used by similar used listings
  try {
    const r = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?` + new URLSearchParams({ q, category_ids: EBAY_CATEGORY, filter: "conditions:{USED}", limit: "50" }), { headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" } });
    callCount++;
    if (r.ok) {
      const d = await r.json(), count = new Map<string, { n: number; name: string }>();
      for (const i of d.itemSummaries || []) {
        const leaf = (i.leafCategoryIds || [])[0]; if (!leaf) continue;
        const name = (i.categories || [])[0]?.categoryName || "";
        const c = count.get(leaf) || { n: 0, name }; c.n++; count.set(leaf, c);
      }
      const best = [...count.entries()].sort((x, y) => y[1].n - x[1].n)[0];
      if (best) return { id: best[0], name: best[1].name, tree: "0" };
    }
  } catch { /* fill it in by hand */ }
  void v;
  return null;
}
async function requiredAspects(categoryId: string, tree: string) {
  try {
    const token = await ebayToken(BROWSE_SCOPE);
    const r = await fetch(`https://api.ebay.com/commerce/taxonomy/v1/category_tree/${tree}/get_item_aspects_for_category?category_id=${enc(categoryId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.aspects || []).filter((a: any) => a.aspectConstraint?.aspectRequired || a.aspectConstraint?.aspectUsage === "RECOMMENDED").slice(0, 25)
      .map((a: any) => ({ name: a.localizedAspectName, required: !!a.aspectConstraint?.aspectRequired, values: (a.aspectValues || []).slice(0, 40).map((x: any) => x.localizedValue) }));
  } catch { return []; }
}
async function listingDraft(itemId: number) {
  const it = await itemRow(itemId);
  if (!it) return { error: "Part not found." };
  const v = await vehicleRow(it.vehicle_id) || {};
  const gen = v.make ? (await generationFor(v)).generation : null;
  const pn = (it.part_numbers || [])[0] || "";
  // Fitment: what this part number is known to fit; otherwise this car only (you can widen it to the generation)
  let fit: any[] = [{ year_from: Number(v.year), year_to: Number(v.year), make: v.make, model: v.model, why: "this car" }];
  if (pn) {
    const info = await partNumberInfo(pn);
    const known = info.fits.filter((f: any) => f.make && f.model && f.year_from).map((f: any) => ({ year_from: f.year_from, year_to: f.year_to || f.year_from, make: f.make, model: f.model, why: `part # ${pn} seen ${f.seen}×` }));
    if (known.length) fit = known;
  }
  const yrs = fit.length === 1 && fit[0].year_from !== fit[0].year_to ? `${fit[0].year_from}-${fit[0].year_to}` : fit.length === 1 ? String(fit[0].year_from) : `${Math.min(...fit.map((f) => f.year_from))}-${Math.max(...fit.map((f) => f.year_to))}`;
  const name = listingName(it);
  let title = [yrs, v.make, v.model, name, "OEM", pn].filter(Boolean).join(" ").replace(/\s+/g, " ");
  if (title.length > 80) title = [yrs, v.make, v.model, name, pn].filter(Boolean).join(" ").slice(0, 80);
  const tpl = v.make ? await listingTemplate(v, it.part_key, it.part_name).catch(() => null) : null;
  if (tpl?.data?.title_pattern) {
    const side = /_l$/.test(it.part_key) ? "Driver Left" : /_r$/.test(it.part_key) ? "Passenger Right" : "";
    const t2 = titleFrom(tpl.data.title_pattern, { years: yrs, make: v.make, model: v.model, part: name.replace(/^(Driver Left|Passenger Right)\s+/, ""), side, part_number: pn, extra: "" }, ["OEM", ...(tpl.data.keywords || []).filter((k: string) => !CLAIM.test(k)).slice(0, 3)]);
    if (t2 && t2.length >= 20 && (!pn || t2.includes(pn))) title = t2;
  }
  const cat = await suggestCategory(`${v.make} ${v.model} ${name}`, v).catch(() => null);
  const aspectsWanted = cat ? await requiredAspects(cat.id, cat.tree) : [];
  const aspects: Record<string, string[]> = { Brand: [String(v.make || "OEM")], "Manufacturer Part Number": [pn || "Does Not Apply"] };
  if (/_l$/.test(it.part_key)) aspects["Placement on Vehicle"] = ["Left", ...(/head|mirror/.test(it.part_key) ? ["Front"] : /tail/.test(it.part_key) ? ["Rear"] : [])];
  if (/_r$/.test(it.part_key)) aspects["Placement on Vehicle"] = ["Right", ...(/head|mirror/.test(it.part_key) ? ["Front"] : /tail/.test(it.part_key) ? ["Rear"] : [])];
  if (pn) aspects["OE/OEM Part Number"] = [pn];
  aspects["Type"] = aspects["Type"] || [];
  const missing = aspectsWanted.filter((a: any) => a.required && !aspects[a.name]?.length);
  if (missing.length && env("ANTHROPIC_API_KEY")) {
    try {
      const j = firstJson(await askClaude(`Fill eBay item specifics for this used OEM auto part listing. Title: "${title}". Vehicle: ${[v.year, v.make, v.model, v.trim, v.engine].filter(Boolean).join(" ")}.
For each specific, pick from the allowed values when a list is given, otherwise write a short value. If unknown, use "Does Not Apply".
Specifics: ${JSON.stringify(missing.map((m: any) => ({ name: m.name, allowed: m.values })))}
Reply with JSON only: {"Name":"Value",...}`, 600)) || {};
      for (const m of missing) if (j[m.name]) aspects[m.name] = [String(j[m.name])];
    } catch { /* fill by hand */ }
  }
  for (const [k, val] of Object.entries(tpl?.data?.aspects || {})) if (!aspects[k]?.length) aspects[k] = [String(val)];
  for (const k of Object.keys(aspects)) if (!aspects[k].length) delete aspects[k];
  const size = PART[it.part_key]?.[3] || "S";
  const grade = it.grade || "B";
  const condition = it.condition_text || GRADE_CONDITION[grade];
  const fitLine = fit.map((f) => `${f.year_from}${f.year_to !== f.year_from ? "-" + f.year_to : ""} ${f.make} ${f.model}`).join(", ");
  const description = `<h2>${esc(title)}</h2>
<p><b>Genuine used OEM part</b> removed from a ${esc([v.year, v.make, v.model, v.trim].filter(Boolean).join(" "))}${v.engine ? " (" + esc(v.engine) + ")" : ""}.</p>
${pn ? `<p><b>Part number:</b> ${esc(pn)}. Please match this number to your original part before buying.</p>` : `<p>Please compare the photos and connectors to your original part before buying.</p>`}
<p><b>Fits:</b> ${esc(fitLine)}. Fitment is a guide: the part number is the best match.</p>
<p><b>Condition:</b> ${esc(condition)}${it.ai_notes ? " " + esc(it.ai_notes) : ""}</p>
<p>You will receive the exact item pictured. Stock # ${esc(it.sku || "")}.</p>`;
  const draft = { title, price: it.list_price, category_id: cat?.id || "", category_name: cat?.name || "", aspects, aspect_hints: aspectsWanted, fit, generation: gen ? { year_from: gen.year_from, year_to: gen.year_to } : null, condition,
    template: tpl ? { photos: tpl.data.photos, notes: tpl.data.notes, description_points: tpl.data.description_points, claim_words: tpl.data.claim_words || [], sold_titles: tpl.sources?.sold_titles || 0, live: (tpl.sources?.live || []).length, made_at: tpl.made_at } : null, description, size, package: PACKAGES[size] || PACKAGES.S };
  await rest("PATCH", `pm_items?id=eq.${it.id}`, { draft }, "return=minimal");
  return { draft };
}
const escRe = /[&<>"]/g;
function esc(x: string) { return String(x ?? "").replace(escRe, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]); }

// ---------- Listing templates: learn from what sells ----------
// Words that claim something about this exact part. Never added on their own: only offered, for you to add if true.
const CLAIM = /test|work|guarant|warrant|\bnew\b|low mile|mint|perfect|excellent|no (scratch|crack|damage)|lifetime|fast ship|free ship|return/i;
const SKIP_ASPECTS = /part number|mpn|interchange|fitment|year|make|model|brand|vin|warranty|upc|ean|isbn|stock/i;
async function topListings(v: any, words: string) {
  const token = await ebayToken(BROWSE_SCOPE);
  const h = { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US", "Accept-Language": "en-US" };
  const q = `${v.year} ${v.make} ${v.model} ${words}`.trim();
  callCount++;
  const r = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?` + new URLSearchParams({ q, category_ids: EBAY_CATEGORY, filter: "conditions:{USED}", limit: "20" }), { headers: h });
  if (!r.ok) return [];
  const rows = ((await r.json()).itemSummaries || []).filter((i: any) => !isJunk(String(i.title || ""))).slice(0, 3);
  const out = [];
  for (const i of rows) {
    callCount++;
    const g = await fetch(`https://api.ebay.com/buy/browse/v1/item/${enc(i.itemId)}`, { headers: h });
    if (!g.ok) continue;
    const d = await g.json();
    out.push({
      title: d.title, price: Number(d.price?.value) || null, photos: 1 + (d.additionalImages || []).length,
      aspects: (d.localizedAspects || []).map((a: any) => `${a.name}: ${a.value}`).slice(0, 25),
      description: String(d.description || d.shortDescription || "").replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200),
    });
  }
  return out;
}
async function listingTemplate(v: any, partKey: string, partName: string, force = false) {
  const mk = modelKey(v);
  const have = (await rest("GET", `pm_templates?model_key=eq.${enc(mk)}&part_key=eq.${enc(partKey)}&select=*`))?.[0];
  if (have && !force && Date.now() - new Date(have.made_at).getTime() < 30 * 864e5) return have;
  if (!env("ANTHROPIC_API_KEY")) return have || null;
  // Sold titles for this part: same model first, then any model (titles for the same part read alike)
  let sold = (await rest("GET", `pm_sales?model_key=eq.${enc(mk)}&part_key=eq.${enc(partKey)}&select=title,price,sold_on&order=sold_on.desc.nullslast&limit=60`)) || [];
  if (sold.length < 8) sold = sold.concat((await rest("GET", `pm_sales?part_key=eq.${enc(partKey)}&model_key=neq.${enc(mk)}&select=title,price,sold_on&order=price.desc&limit=40`)) || []);
  const live = await topListings(v, PART[partKey]?.[2] || partName).catch(() => []);
  if (!sold.length && !live.length) return have || null;
  const prompt = `You help a used OEM auto parts seller write eBay listings that sell. Part: ${partName}. Vehicle: ${v.year} ${v.make} ${v.model}.
Sold listing titles (what actually sold):
${sold.slice(0, 50).map((x: any) => `- ${x.title} ($${x.price})`).join("\n") || "(none yet)"}
Top live listings right now:
${live.map((l: any, n: number) => `#${n + 1} "${l.title}" $${l.price} · ${l.photos} photos
  specifics: ${l.aspects.join(" | ")}
  description: ${l.description.slice(0, 600)}`).join("\n") || "(none)"}
Work out what the selling titles have in common and how the best listings are written. Reply with JSON only:
{"title_pattern":"order of parts in the title using {years} {make} {model} {part} {side} {part_number} {extra}, e.g. {years} {make} {model} {side} {part} OEM {part_number}",
 "keywords":["words buyers search that often appear in sold titles, like OEM, Genuine, Tested, Halogen, LED, Heated, Power Fold"],
 "aspects":{"Specific name":"typical value that does not depend on the exact car, e.g. Type, Bulb Type, Housing Color, Features, Country/Region of Manufacture"},
 "description_points":["short points the best listings include, e.g. tested, mounting tabs intact, what is included"],
 "photos":{"count":8,"tips":["what the best listings photograph"]},
 "notes":"one sentence on what makes these sell"}`;
  const j = firstJson(await askClaude(prompt, 1200)) || {};
  const kws = (j.keywords || []).map(String).slice(0, 12);
  const aspects: Record<string, string> = {};
  for (const [k, val] of Object.entries(j.aspects || {})) if (!SKIP_ASPECTS.test(k) && !CLAIM.test(String(val)) && String(val).trim()) aspects[k] = String(val).slice(0, 65);
  const data = {
    title_pattern: String(j.title_pattern || "").slice(0, 200), keywords: kws.filter((k: string) => !CLAIM.test(k)), claim_words: kws.filter((k: string) => CLAIM.test(k)), aspects,
    description_points: (j.description_points || []).map(String).slice(0, 8), photos: j.photos || null, notes: String(j.notes || "").slice(0, 300),
  };
  const row = { model_key: mk, part_key: partKey, data, sources: { sold_titles: sold.length, live: live.map((l: any) => ({ title: l.title, price: l.price, photos: l.photos })) }, made_at: nowIso() };
  await rest("POST", "pm_templates?on_conflict=model_key,part_key", row, "resolution=merge-duplicates,return=minimal");
  return row;
}
// Fill a title pattern with this part's real details, keep it under 80 characters
function titleFrom(pattern: string, f: Record<string, string>, keywords: string[]) {
  let t = pattern.replace(/\{(\w+)\}/g, (_, k) => f[k] ?? "").replace(/\s+/g, " ").trim();
  if (!/\{/.test(pattern)) return "";
  for (const kw of keywords) { if (t.length + kw.length + 1 > 80) break; if (!new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) t += " " + kw; }
  return t.length > 80 ? t.slice(0, 80).replace(/\s+\S*$/, "") : t;
}

// ---------- Publish to eBay ----------
async function publishItem(b: any) {
  const it = await itemRow(b.id);
  if (!it) return { error: "Part not found." };
  const d = { ...(it.draft || {}), ...(b.draft || {}) };
  const row = await ebayRow();
  if (!row.refresh_token) return { error: "Connect your eBay account in Settings first." };
  if (!row.fulfillment_policy_id || !row.payment_policy_id || !row.return_policy_id || !row.location_key) return { error: "Pick your shipping, payment and return policies and your ship-from ZIP in Settings → eBay selling first." };
  if (!d.title || !d.category_id || !(Number(d.price) > 0)) return { error: "The draft needs a title, a category and a price." };
  const photos = (it.photos || []).map((p: any) => p.url).filter(Boolean);
  if (!photos.length) return { error: "Add at least one photo." };
  const sku = it.sku;
  try {
    await sell("PUT", `/sell/inventory/v1/inventory_item/${enc(sku)}`, {
      availability: { shipToLocationAvailability: { quantity: 1 } },
      condition: "USED_EXCELLENT", conditionDescription: String(d.condition || "").slice(0, 1000),
      product: { title: String(d.title).slice(0, 80), description: d.description, aspects: d.aspects || {}, imageUrls: photos.slice(0, 12), ...(it.part_numbers?.[0] ? { mpn: it.part_numbers[0] } : {}), brand: d.aspects?.Brand?.[0] },
      packageWeightAndSize: d.package || PACKAGES.S,
    });
    const compat = [];
    for (const f of d.fit || []) for (let y = Number(f.year_from); y <= Number(f.year_to) && compat.length < 300; y++) compat.push({ productFamilyProperties: { year: String(y), make: f.make, model: f.model }, notes: "" });
    if (compat.length) {
      try { await sell("PUT", `/sell/inventory/v1/inventory_item/${enc(sku)}/product_compatibility`, { compatibleProducts: compat }); }
      catch { await sell("PUT", `/sell/inventory/v1/inventory_item/${enc(sku)}/product_compatibility`, { compatibleProducts: compat.map((c) => ({ compatibilityProperties: Object.entries(c.productFamilyProperties).map(([name, value]) => ({ name: name[0].toUpperCase() + name.slice(1), value })) })) }); }
    }
    const offer = {
      sku, marketplaceId: "EBAY_US", format: "FIXED_PRICE", availableQuantity: 1, categoryId: String(d.category_id), listingDescription: d.description,
      listingPolicies: { fulfillmentPolicyId: row.fulfillment_policy_id, paymentPolicyId: row.payment_policy_id, returnPolicyId: row.return_policy_id },
      pricingSummary: { price: { value: Number(d.price).toFixed(2), currency: "USD" } }, merchantLocationKey: row.location_key,
    };
    let offerId = it.ebay_offer_id;
    if (offerId) await sell("PUT", `/sell/inventory/v1/offer/${enc(offerId)}`, offer);
    else offerId = (await sell("POST", "/sell/inventory/v1/offer", offer)).offerId;
    await rest("PATCH", `pm_items?id=eq.${it.id}`, { ebay_offer_id: offerId, draft: d }, "return=minimal");
    const pub = await sell("POST", `/sell/inventory/v1/offer/${enc(offerId)}/publish`, {});
    await rest("PATCH", `pm_items?id=eq.${it.id}`, { ebay_listing_id: pub.listingId, status: "listed", listed_at: nowIso(), list_price: Number(d.price), listing_error: null, channel: "ebay" }, "return=minimal");
    return { ok: true, listing_id: pub.listingId, url: `https://www.ebay.com/itm/${pub.listingId}` };
  } catch (e) {
    await rest("PATCH", `pm_items?id=eq.${it.id}`, { listing_error: (e as Error).message.slice(0, 500) }, "return=minimal");
    return { error: (e as Error).message };
  }
}
// Sold on eBay → mark it sold here, with the real price
async function syncOrders() {
  const row = await ebayRow();
  if (!row.refresh_token) return { skipped: true };
  if (row.last_order_sync && Date.now() - new Date(row.last_order_sync).getTime() < 15 * 60_000) return { skipped: true };
  const since = new Date(new Date(row.last_order_sync || Date.now() - 14 * 864e5).getTime() - 864e5).toISOString();
  const d = await sell("GET", `/sell/fulfillment/v1/order?filter=${enc(`creationdate:[${since}..]`)}&limit=200`);
  let n = 0;
  for (const o of d.orders || []) for (const li of o.lineItems || []) {
    if (!li.sku) continue;
    const it = (await rest("GET", `pm_items?sku=eq.${enc(li.sku)}&select=id,status`))?.[0];
    if (!it || it.status === "sold") continue;
    await rest("PATCH", `pm_items?id=eq.${it.id}`, { status: "sold", sold_price: Number(li.total?.value ?? li.lineItemCost?.value ?? 0) || null, sold_at: o.creationDate || nowIso(), channel: "ebay" }, "return=minimal");
    n++;
  }
  await rest("PATCH", "pm_ebay?id=eq.1", { last_order_sync: nowIso() }, "return=minimal");
  return { sold: n };
}

// ---------- Research drop codes (Claude in Chrome research) ----------
async function makeDrop(b: any, who: any) {
  const platform = String(b.platform || "");
  const car = (await rest("GET", `pm_vehicles?platform=eq.${enc(platform)}&select=year,make,model&limit=1`))?.[0];
  if (!car) return { error: "Unknown model." };
  const v = { year: car.year, make: car.make, model: car.model };
  let yf = Number(car.year), yt = Number(car.year), sisters: any[] = [];
  try { const g = (await generationFor(v)).generation; if (g) { yf = g.year_from; yt = g.year_to; sisters = g.sisters || []; } } catch { /* this year only */ }
  const code = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  await rest("POST", "pm_drops", { code, platform, vehicle: v, year_from: yf, year_to: yt, sisters, made_by: who.id || null, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() }, "return=minimal");
  return { code, years: `${yf}-${yt}` };
}
async function useDrop(b: any) {
  const code = String(b.code || "");
  if (!/^[a-f0-9]{40}$/.test(code)) return { error: "Bad code." };
  const d = (await rest("GET", `pm_drops?code=eq.${code}&select=*`))?.[0];
  if (!d) return { error: "Unknown code." };
  if (d.used_at) return { error: "This code was already used.", result: d.result };
  if (new Date(d.expires_at).getTime() < Date.now()) return { error: "This code expired. Get a new one." };
  const text = String(b.text || "").slice(0, 400_000);
  if (text.length < 200) return { error: "Page text is empty or too short. Nothing saved." };
  // claim it before saving so it can't be used twice
  const claimed = await rest("PATCH", `pm_drops?code=eq.${code}&used_at=is.null`, { used_at: nowIso() }, "return=representation");
  if (!claimed?.length) return { error: "This code was already used." };
  const v = d.vehicle;
  const pv = await researchPreview(text, v);
  let result: any;
  if (!pv.sales) result = { saved: 0, read: pv.read, note: "No usable used-OEM sales found on that page. Nothing saved." };
  else {
    const r: any = await researchSave(text, v, d.year_from, d.year_to, null, { id: d.made_by, role: "owner" }, d.sisters || []);
    result = { model: `${v.year} ${v.make} ${v.model}`, years: `${d.year_from}-${d.year_to}`, found: pv.sales, saved: r.saved, already_saved: r.already_saved || 0,
      top: pv.small.slice(0, 5).map((x: any) => `${x.name}: ${x.count} sold, clean $${Math.round(x.high)}`) };
  }
  await rest("PATCH", `pm_drops?code=eq.${code}`, { result }, "return=minimal");
  return result;
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
  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.has("code") || u.searchParams.has("error")) return ebayOauthCallback(u);
    return json({ ok: true, app: "QuickPull" });
  }
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const body = await req.json().catch(() => ({}));
  try {
    // A research page sending its text with a one-time drop code (no sign-in needed: the code is the permission)
    if (body.action === "research_drop") return json(await useDrop(body));
    const who = await caller(req);
    if (!who) return json({ error: "Sign in first." }, 401);
    const owner = who.role === "owner";
    const ownerOnly = () => json({ error: "Only the owner can do that." }, 403);
    switch (body.action) {
      case "status": {
        const s = await settings();
        return json({
          role: who.role, ebay_keys: !!(env("EBAY_CLIENT_ID") && env("EBAY_CLIENT_SECRET")), insights: env("EBAY_INSIGHTS").toLowerCase() === "on",
          cron: !!env("CRON_SECRET"), last_process_at: s.last_process_at, part_min: s.part_min, never_pull: s.never_pull, last_backup_at: s.last_backup_at, ai: !!env("ANTHROPIC_API_KEY"), calls_today: owner ? await callsToday() : undefined, call_cap: DAILY_CALL_CAP,
        });
      }
      case "checkin": return json(await checkin(Array.isArray(body.vins) ? body.vins : String(body.vins || "").split(/[\s,;]+/), who));
      case "process": return json(await processQueue(who.role === "cron" ? 110_000 : 40_000));
      case "car": return owner ? json(await carData(Number(body.id))) : ownerOnly();
      case "platform": return owner ? json(await platformData(String(body.platform || ""))) : ownerOnly();
      case "research_preview": return owner ? json(await researchPreview(String(body.text || ""), body.vehicle || {})) : ownerOnly();
      case "research_save": return owner ? json(await researchSave(String(body.text || ""), body.vehicle || {}, Number(body.year_from), Number(body.year_to), Number(body.period_days) || null, who, body.sisters || [])) : ownerOnly();
      case "generation": return owner ? json(await generationFor(body.vehicle || {})) : ownerOnly();
      case "save_generation": return owner ? json(await saveGeneration(body)) : ownerOnly();
      case "lookup_generation": return owner ? json(await lookupGenerations(String(body.make || ""), String(body.model || ""), true)) : ownerOnly();
      case "fastest": return owner ? json(await fastestSellers(body)) : ownerOnly();
      case "analyze_photos": return owner ? json(await analyzePhotos(Number(body.id))) : ownerOnly();
      case "confirm_item": return owner ? json(await confirmItem(body)) : ownerOnly();
      case "ebay_connect": return owner ? json(await ebayConnectUrl(String(body.return_url || ""))) : ownerOnly();
      case "ebay_status": return owner ? json(await ebaySellerStatus()) : ownerOnly();
      case "ebay_setup": return owner ? json(await ebaySellerSetup(body)) : ownerOnly();
      case "listing_draft": return owner ? json(await listingDraft(Number(body.id))) : ownerOnly();
      case "publish": return owner ? json(await publishItem(body)) : ownerOnly();
      case "research_drop_code": return owner ? json(await makeDrop(body, who)) : ownerOnly();
      case "sync_orders": return owner ? json(await syncOrders()) : ownerOnly();
      case "template": {
        if (!owner) return ownerOnly();
        const v = body.vehicle || {}; const key = String(body.part_key || "");
        if (!v.make || !v.model || !key) return json({ error: "Need a vehicle and a part." });
        return json({ template: await listingTemplate(v, key, String(body.part_name || PART[key]?.[1] || key), !!body.refresh) });
      }
      case "part_number": return owner ? json(await partNumberInfo(String(body.part_number || ""))) : ownerOnly();
      case "model_sales": return owner ? json(await modelSales(body.vehicle || {})) : ownerOnly();
      case "recompute": return owner ? json(await recomputeAll()) : ownerOnly();
      case "cleanup": return owner ? json(await cleanupDiscovered()) : ownerOnly();
      case "merge": return owner ? json(await setMerge(body)) : ownerOnly();
      case "data": return owner ? json(await dataSummary(body)) : ownerOnly();
      case "backup": return owner ? json(await buildBackup()) : ownerOnly();
      case "backup_store": return owner || who.role === "cron" ? json(await storeBackup()) : ownerOnly();
      default: return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    const m = (e as Error).message;
    if (m === "service_key_missing") return json({ error: "The function can't reach the database. Add the QP_SECRET_KEY secret (see setup guide)." }, 500);
    return json({ error: "Something went wrong on the server.", detail: m }, 502);
  }
}

(globalThis as any).Deno?.serve(handle);
