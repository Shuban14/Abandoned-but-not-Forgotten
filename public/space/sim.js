// Launch Lab — rocket rules and flight outcome. Pure functions, no DOM: used by the game and by the tests.
// Units: mass in tonnes, thrust in kN, Isp in seconds, velocity in m/s.

export const G0 = 9.80665;

export const PARTS = {
  nose: { kind: "nose", name: "Nose cone", kn: "ಮೂಗಿನ ಕವಚ", mass: 0.6, h: 2.2, color: "#f3f4f6", desc: "Protects the payload from air. Must be at the very top." },
  cubesat: { kind: "payload", name: "Small satellite", mass: 0.1, h: 0.9, target: "leo", desc: "A tiny CubeSat for Earth orbit." },
  commsat: { kind: "payload", name: "Communication satellite", mass: 2.0, h: 1.6, target: "leo", desc: "A TV and phone satellite for Earth orbit." },
  moonprobe: { kind: "payload", name: "Moon probe", mass: 1.2, h: 1.4, target: "moon", desc: "A probe that flies on to the Moon. Needs much more speed." },
  marsprobe: { kind: "payload", name: "Mars probe", mass: 1.5, h: 1.6, target: "mars", desc: "A probe for Mars, 7 months away. Needs the most speed of all." },
  solar: { kind: "solar", name: "Solar panels", mass: 0.2, h: 0.5, desc: "Power for the satellite. Put it next to the payload." },
  tankS: { kind: "tank", name: "Small fuel tank", mass: 1, fuel: 12, h: 1.4, desc: "12 t of fuel." },
  tankL: { kind: "tank", name: "Large fuel tank", mass: 3, fuel: 40, h: 3.0, desc: "40 t of fuel." },
  tankXL: { kind: "tank", name: "Huge fuel tank", mass: 7, fuel: 110, h: 6.0, desc: "110 t of fuel." },
  engineB: { kind: "engine", name: "Booster engine", mass: 3.5, thrustSL: 2300, thrustVac: 2550, ispSL: 285, ispVac: 312, h: 1.6, desc: "Very powerful. Made for lift-off from the ground." },
  engineV: { kind: "engine", name: "Space engine", mass: 1, thrustSL: 60, thrustVac: 160, ispSL: 210, ispVac: 345, h: 1.5, desc: "Efficient in space, weak in thick air." },
  decoupler: { kind: "decoupler", name: "Stage separator", mass: 0.5, h: 0.4, desc: "Drops the empty stage below it." },
  fins: { kind: "fins", name: "Fins", mass: 1.2, h: 1.3, desc: "Keep the rocket flying straight. Put them at the bottom." },
};

export const TARGETS = {
  leo: { name: "Earth orbit", dv: 9400 },
  moon: { name: "Moon", dv: 11600 },
  mars: { name: "Mars", dv: 12800 },
};

export const SITES = [
  { id: "shar", name: "Satish Dhawan Space Centre", place: "Sriharikota, India", lat: 13.72, lon: 80.23, east: true },
  { id: "kourou", name: "Guiana Space Centre", place: "Kourou, French Guiana", lat: 5.24, lon: -52.77, east: true },
  { id: "cape", name: "Cape Canaveral", place: "Florida, USA", lat: 28.49, lon: -80.58, east: true },
  { id: "baikonur", name: "Baikonur Cosmodrome", place: "Kazakhstan", lat: 45.96, lon: 63.31, east: true },
  { id: "jiuquan", name: "Jiuquan Launch Centre", place: "China", lat: 40.96, lon: 100.29, east: true },
  { id: "tanegashima", name: "Tanegashima Space Center", place: "Japan", lat: 30.4, lon: 130.97, east: true },
  { id: "mahia", name: "Mahia Peninsula", place: "New Zealand", lat: -39.26, lon: 177.86, east: true },
  { id: "vandenberg", name: "Vandenberg (polar launches)", place: "California, USA", lat: 34.74, lon: -120.57, east: false },
];

// Earth spins east at 465 m/s at the equator: launching east borrows that speed. Polar launches get none.
export const siteBonus = (s) => (s && s.east ? Math.round(465 * Math.cos((s.lat * Math.PI) / 180)) : 0);

const P = (x) => PARTS[x.id];
const count = (x) => (P(x).kind === "engine" ? x.n || 1 : 1);
const massOf = (x) => P(x).mass * count(x) + (P(x).fuel || 0);

// stack is top → bottom: [{id, n?}]
export function stagesOf(stack) {
  const stages = [[]];
  stack.forEach((x, i) => {
    if (P(x).kind === "decoupler") stages.push([]);
    else stages[stages.length - 1].push({ ...x, i });
  });
  return stages; // stages[0] = top stage, last = first to fire
}

export function analyse(stack, site) {
  const stages = stagesOf(stack);
  const total = stack.reduce((a, x) => a + massOf(x), 0);
  const decouplers = stack.filter((x) => P(x).kind === "decoupler").length;
  const payloads = stack.filter((x) => P(x).kind === "payload");
  const target = payloads.some((x) => P(x).target === "mars") ? "mars" : payloads.some((x) => P(x).target === "moon") ? "moon" : "leo";
  // Δv per stage, bottom first (rocket equation)
  let above = 0;
  const st = [];
  for (let k = 0; k < stages.length; k++) {
    const parts = stages[k];
    const m = parts.reduce((a, x) => a + massOf(x), 0) + (k > 0 ? 0.5 : 0); // + its separator
    const engines = parts.filter((x) => P(x).kind === "engine");
    const tanks = parts.filter((x) => P(x).kind === "tank");
    st.push({ parts, m, engines, tanks, above });
    above += m;
  }
  const out = [];
  for (let k = st.length - 1; k >= 0; k--) {
    const s = st[k], first = k === st.length - 1;
    const m0 = s.m + s.above;
    // fuel only reaches an engine if a tank sits above it in the same stage
    const lowestEngine = s.engines.length ? Math.max(...s.engines.map((e) => e.i)) : -1;
    const fedTanks = s.tanks.filter((t) => t.i < lowestEngine);
    const fuel = fedTanks.reduce((a, t) => a + P(t).fuel, 0);
    const thrustSL = s.engines.reduce((a, e) => a + P(e).thrustSL * count(e), 0);
    const thrustVac = s.engines.reduce((a, e) => a + P(e).thrustVac * count(e), 0);
    const isp = thrustVac ? s.engines.reduce((a, e) => a + (first ? (P(e).ispSL + P(e).ispVac) / 2 : P(e).ispVac) * P(e).thrustVac * count(e), 0) / thrustVac : 0;
    const dv = thrustVac && fuel ? isp * G0 * Math.log(m0 / (m0 - fuel)) : 0;
    out.push({ k, first, m0, fuel, thrustSL, thrustVac, isp, dv, engines: s.engines.length, tanks: s.tanks.length, fedTanks: fedTanks.length, parts: s.parts });
  }
  const bonus = siteBonus(site);
  const dv = out.reduce((a, s) => a + s.dv, 0);
  const bottom = out[0];
  const twr = bottom ? (bottom.thrustSL * 1000) / (total * 1000 * G0) : 0;
  return { stages: out, total, twr, dv: Math.round(dv), bonus, need: TARGETS[target].dv, target, decouplers, payloads };
}

const F = (code, title, why, fix, extra = {}) => ({ code, title, why, fix, ...extra });

// Decide what happens in flight, in the order it would happen.
export function outcome(stack, site) {
  const a = analyse(stack, site);
  const bottom = a.stages[0];
  const top = stack[0] ? P(stack[0]) : null;
  if (!stack.length) return { ...a, ok: false, fail: F("empty", "Nothing on the pad", "There is no rocket to launch.", "Add parts to build a rocket.") };
  if (!bottom.engines) return { ...a, ok: false, fail: F("noEngine", "Nothing happened", "The bottom stage has no engine, so nothing can push the rocket up.", "Put a booster engine at the bottom (just above the fins).", { part: "engineB" }) };
  if (!bottom.fuel) return { ...a, ok: false, fail: F("noFuel", "Engines had no fuel", "The engine lit for a moment and died. No fuel tank sits above it in the same stage.", "Put a fuel tank directly above the bottom engine.", { part: "tankXL" }) };
  if (a.twr < 1) return { ...a, ok: false, fail: F("noLift", "Too heavy to lift off", `Thrust is only ${a.twr.toFixed(2)}× the rocket's weight. It needs more than 1× to leave the pad.`, "Use a booster engine (not a space engine) at the bottom, add a second booster, or make the rocket lighter.", { part: "engineB" }) };
  if (a.twr < 1.15) return { ...a, ok: false, fail: F("tooHeavy", "Rose, then fell back", `Thrust is ${a.twr.toFixed(2)}× its weight: just enough to rise slowly, not enough to climb away. It fell back onto the pad.`, "Aim for at least 1.2×: add a booster engine or remove weight.", { part: "engineB", at: 0.4 }) };
  const finsLow = bottom.parts.some((x) => P(x).kind === "fins");
  if (!finsLow) return { ...a, ok: false, fail: F("unstable", "Spun out of control", "Without fins on the first stage, the rocket started to turn sideways and broke apart.", "Add fins at the very bottom of the rocket.", { part: "fins", at: 3 }) };
  if (!top || top.kind !== "nose") return { ...a, ok: false, fail: F("noNose", "Broke apart in the air", "At about 12 km, air pressure on the rocket is highest. Without a nose cone on top, the front was torn apart.", "Put the nose cone at the very top.", { part: "nose", at: 12 }) };
  // engines in the middle of a stage = a missing separator
  for (const s of a.stages) {
    const idx = s.parts.map((x) => x.i), engIdx = s.parts.filter((x) => P(x).kind === "engine").map((x) => x.i);
    const lowestTank = Math.max(-1, ...s.parts.filter((x) => P(x).kind === "tank").map((x) => x.i));
    if (engIdx.some((e) => e < lowestTank) && engIdx.length > 1) {
      return { ...a, ok: false, fail: F("noDecoupler", "Stages couldn't separate", "The first stage ran empty but stayed attached. The upper engine could not fire through it, so the heavy rocket fell back.", "Put a stage separator between the stages (below the upper engine).", { part: "decoupler", at: 70 }) };
    }
    void idx;
  }
  const upper = a.stages.slice(1);
  const deadUpper = upper.find((s) => s.engines && !s.fuel);
  if (a.dv + a.bonus < a.need) {
    const short = a.need - a.dv - a.bonus;
    if (deadUpper) return { ...a, ok: false, fail: F("upperNoFuel", "Upper engine had no fuel", "The stages separated, but the upper engine has no fuel tank above it, so it never started.", "Put a fuel tank directly above the upper engine.", { part: "tankL", at: 70 }) };
    const noUpper = upper.every((s) => !s.engines);
    return {
      ...a, ok: false,
      fail: F("lowDv", a.target === "leo" ? "Didn't reach orbit" : `Didn't make it to ${a.target === "moon" ? "the Moon" : "Mars"}`,
        `Its speed budget was ${Math.round((a.dv + a.bonus) / 100) / 10} km/s, but ${a.target === "leo" ? "orbit" : a.target === "moon" ? "the Moon" : "Mars"} needs ${(a.need / 1000).toFixed(1)} km/s. It was ${Math.round(short)} m/s short, so it fell back and burned up in the air.`,
        noUpper ? "Add a second stage: a separator, then a fuel tank and a space engine above it." : "Add more fuel, use a lighter payload, or add another stage.", { part: noUpper ? "engineV" : "tankL", at: 120, short }),
    };
  }
  // reached the target
  const topStage = a.stages[a.stages.length - 1];
  const payloadTop = topStage.parts.some((x) => P(x).kind === "payload");
  if (!a.payloads.length) return { ...a, ok: false, partial: true, fail: F("noPayload", "Orbit reached, nothing to deliver", "The rocket flew perfectly, but it carried no satellite.", "Add a payload (satellite or probe) just below the nose cone.", { part: "commsat" }) };
  if (!payloadTop) return { ...a, ok: false, partial: true, fail: F("payloadDropped", "Satellite thrown away", "The satellite was on a lower stage, so it fell away with that stage when it separated.", "Move the satellite to the top stage, just below the nose cone.", { part: "commsat" }) };
  if (!topStage.parts.some((x) => P(x).kind === "solar")) return { ...a, ok: false, partial: true, fail: F("noPower", "Satellite has no power", "The launch worked and the satellite reached orbit, but without solar panels its battery ran out within hours.", "Add solar panels next to the satellite.", { part: "solar" }) };
  return { ...a, ok: true };
}

export const SAMPLES = {
  good: [{ id: "nose" }, { id: "commsat" }, { id: "solar" }, { id: "tankL" }, { id: "engineV" }, { id: "decoupler" }, { id: "tankXL" }, { id: "engineB" }, { id: "fins" }],
  moon: [{ id: "nose" }, { id: "moonprobe" }, { id: "solar" }, { id: "tankS" }, { id: "engineV" }, { id: "decoupler" }, { id: "tankL" }, { id: "engineV" }, { id: "decoupler" }, { id: "tankXL" }, { id: "tankL" }, { id: "engineB", n: 2 }, { id: "fins" }],
  mars: [{ id: "nose" }, { id: "marsprobe" }, { id: "solar" }, { id: "tankL" }, { id: "engineV" }, { id: "decoupler" }, { id: "tankXL" }, { id: "engineV", n: 2 }, { id: "decoupler" }, { id: "tankXL" }, { id: "tankXL" }, { id: "engineB", n: 3 }, { id: "fins" }],
  broken: [{ id: "commsat" }, { id: "tankL" }, { id: "engineV" }, { id: "decoupler" }, { id: "tankXL" }, { id: "engineB" }],
};
