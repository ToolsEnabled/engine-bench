// A scripted test agent for local development (?dev=mock). It calls no model and spends nothing.
import type { Run } from './common';
import { TRUTH } from '../specs';

const X = [126, 42, -42, -126];
const zc = (i: number) => (i === 0 || i === 3 ? -30 : -120); // piston centre: 1 and 4 at TDC
const ROT_X: [number, number, number] = [0, 90, 0]; // local Z onto world X

export function script(model: string): { say: string; calls: [string, unknown][] }[] {
  if (model === 'test-box') return [
    { say: 'A box with the overall engine bounds.', calls: [['add_parts', { parts: [{
      id: 'bounds_box', subsystem: 'block', role: 'block', shape: { type: 'box', size: TRUTH.bounds[1].map((v, i) => v - TRUTH.bounds[0][i]) },
      position: TRUTH.bounds[1].map((v, i) => (v + TRUTH.bounds[0][i]) / 2),
    }] }]] },
    { say: 'Done.', calls: [['finish', {}]] },
  ];
  const full = model === 'test-full';
  const pistons = X.map((x, i) => ({ id: `piston_${i + 1}`, subsystem: 'pistons_rods', role: 'piston', shape: { type: 'cylinder', radius: 37.4, height: 60, segments: 48 }, position: [x, 0, zc(i)], cuts: [{ shape: { type: 'cylinder', radius: 10, height: 80 }, rotation: ROT_X }] }));
  const rods = X.map((x, i) => ({ id: `rod_${i + 1}`, subsystem: 'pistons_rods', role: 'connecting_rod', shape: { type: 'box', size: [23, 28, 137] }, position: [x, 0, zc(i) - 68.5] }));
  const bigEnds = X.map((x, i) => ({ id: `rod_big_end_${i + 1}`, subsystem: 'pistons_rods', shape: { type: 'tube', radius: 35, inner_radius: 22.5, height: 23 }, rotation: ROT_X, position: [x, 0, zc(i) - 137] }));
  const valves = X.flatMap((x, c) => [-16, 16].flatMap((dx, k) => [
    { id: `intake_valve_${c + 1}_${k + 1}`, subsystem: 'valvetrain', role: 'intake_valve', shape: { type: 'revolve', points: [[0, 0], [15, 0], [15, 2], [3.5, 10], [3.5, 112], [0, 112]], segments: 24 }, position: [x + dx, 8, 3], rotation: [-19, 0, 0] },
    { id: `exhaust_valve_${c + 1}_${k + 1}`, subsystem: 'valvetrain', role: 'exhaust_valve', shape: { type: 'revolve', points: [[0, 0], [13, 0], [13, 2], [3.5, 10], [3.5, 110], [0, 110]], segments: 24 }, position: [x + dx, -8, 3], rotation: [19, 0, 0] },
  ])).slice(0, full ? 16 : 8);
  const plugs = X.map((x, i) => ({ id: `spark_plug_${i + 1}`, subsystem: 'ignition', role: 'spark_plug', shape: { type: 'cylinder', radius: 8, height: 64 }, position: [x, -7.5, 41], rotation: [18.4, 0, 0] }));
  const turns = [
    { say: 'Starting with the reference from the timing end, then the block and head.', calls: [['get_reference', { view: 'iso' }]] as [string, unknown][] },
    { say: 'Block with four bores, head, valve cover and oil pan.', calls: [['add_parts', { parts: [
      { id: 'block', subsystem: 'block', role: 'block', shape: { type: 'box', size: [403, 221, 292] }, position: [-3.5, -0.5, -146],
        cuts: X.map(x => ({ shape: { type: 'cylinder', radius: 37.5, height: 200, segments: 48 }, position: [x + 3.5, .5, 46] })) },
      { id: 'head', subsystem: 'head', role: 'head', shape: { type: 'box', size: [406, 187, 116] }, position: [0, 7.5, 58.8] },
      { id: 'valve_cover', subsystem: 'head', role: 'valve_cover', shape: { type: 'box', size: [394, 166, 53] }, position: [0, 0, 120.5] },
      { id: 'oil_pan', subsystem: 'lubrication', role: 'oil_pan', shape: { type: 'extrude', points: [[-194, -86], [194, -86], [194, 86], [-194, 86]], height: 83 }, position: [0, 0, -335] },
    ] }]] as [string, unknown][] },
    { say: 'Rotating assembly: crankshaft on the axis at Z -212, flywheel, pistons and rods.', calls: [['add_parts', { parts: [
      { id: 'crankshaft', subsystem: 'crankshaft', role: 'crankshaft', shape: { type: 'cylinder', radius: 27.5, height: 465 }, position: [21.5, 0, -212], rotation: ROT_X },
      ...X.map((x, i) => ({ id: `crank_web_${i + 1}`, subsystem: 'crankshaft', shape: { type: 'cylinder', radius: 70, height: 16 }, position: [x - 20, 0, -212 + (i === 0 || i === 3 ? 12 : -12)], rotation: ROT_X })),
      { id: 'flywheel', subsystem: 'crankshaft', role: 'flywheel', shape: { type: 'cylinder', radius: 124, height: 12, segments: 64 }, position: [-217, 0, -212], rotation: ROT_X },
      ...pistons, ...rods, ...bigEnds,
    ] }], ['render_view', { view: 'exhaust_side', section: true }]] as [string, unknown][] },
    { say: 'Valvetrain: camshaft, the valves and the spark plugs.', calls: [['add_parts', { parts: [
      { id: 'camshaft', subsystem: 'camshaft_timing', role: 'camshaft', shape: { type: 'cylinder', radius: 14, height: 403 }, position: [16.5, 12, 88], rotation: ROT_X },
      ...valves, ...plugs,
    ] }]] as [string, unknown][] },
  ];
  if (full) turns.push({ say: 'Manifolds, timing belt, water pump, distributor and fuel rail.', calls: [['add_parts', { parts: [
    { id: 'intake_manifold', subsystem: 'intake', role: 'intake_manifold', shape: { type: 'box', size: [344, 70, 224] }, position: [-4, 210, -6] },
    ...X.map((x, i) => ({ id: `intake_runner_${i + 1}`, subsystem: 'intake', shape: { type: 'cylinder', radius: 18, height: 90 }, position: [x, 130, 60], rotation: [90, 0, 0] })),
    { id: 'exhaust_manifold', subsystem: 'exhaust', role: 'exhaust_manifold', shape: { type: 'box', size: [370, 60, 200] }, position: [0, -214, -40] },
    { id: 'timing_belt', subsystem: 'camshaft_timing', role: 'timing_belt', shape: { type: 'extrude', points: [[242, -47], [242, 111], [-147, 111], [-147, -47]], height: 24 }, position: [210.5, 0, 0], rotation: ROT_X,
      cuts: [{ shape: { type: 'box', size: [370, 140, 40] }, position: [47, 32, 0] }] },
    { id: 'water_pump', subsystem: 'cooling', role: 'water_pump', shape: { type: 'cylinder', radius: 40, height: 32 }, position: [182, 84, -68], rotation: ROT_X },
    { id: 'distributor', subsystem: 'ignition', role: 'distributor', shape: { type: 'cylinder', radius: 44, height: 88 }, position: [-236, 12, 95], rotation: ROT_X },
    { id: 'fuel_rail', subsystem: 'fuel', role: 'fuel_rail', shape: { type: 'box', size: [343, 20, 20] }, position: [6.5, 146, 118] },
  ] }], ['render_view', { view: 'iso' }]] });
  turns.push({ say: 'Done.', calls: [['finish', { summary: full ? 'Block, head, rotating assembly, valvetrain and the external systems.' : 'Block, head, rotating assembly and half the valves.' }]] });
  return turns;
}

const pause = (ms: number, signal: AbortSignal) => new Promise<void>((ok, no) => {
  const t = setTimeout(ok, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); no(new Error('aborted')); }, { once: true });
});

export async function runMock(run: Run): Promise<void> {
  const full = run.spec.model === 'test-full';
  try {
    for (const turn of script(run.spec.model)) {
      const limit = run.limit();
      if (limit) return run.finish(limit);
      run.turn++;
      run.on.status('Thinking');
      for (const w of 'Checking the spec pack and planning the next parts.'.split(' ')) { run.on.thought(w + ' '); await pause(40, run.signal); }
      await pause(full ? 900 : 1300, run.signal);
      run.on.status('Writing');
      for (const w of turn.say.split(' ')) { run.on.text(w + ' '); await pause(60, run.signal); }
      for (const [name, input] of turn.calls) {
        run.on.status(name === 'render_view' || name === 'get_reference' ? 'Looking' : 'Building');
        const out = await run.tool(name, input);
        if (out.finished !== undefined) return run.finish('finished', { summary: out.finished });
      }
    }
    run.finish('ended');
  } catch {
    run.finish(run.reason || 'stopped');
  }
}
