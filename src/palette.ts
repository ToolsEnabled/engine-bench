// One colour per subsystem, the same for both agents and for the goal engine.
import * as THREE from 'three';
import type { Subsystem } from './specs';

export const COLORS: Record<Subsystem, string> = {
  block: '#7b828c', head: '#9aa1ab', crankshaft: '#c9ced5', pistons_rods: '#e4e7eb', valvetrain: '#ef1d2f',
  camshaft_timing: '#ff6a73', intake: '#5d6670', exhaust: '#a1462c', fuel: '#d3a12b', ignition: '#f2f2f2',
  lubrication: '#3e434a', cooling: '#4f7b96', accessories: '#575d66', fasteners: '#b8bec6', other: '#8e8e93',
};

const cache = new Map<Subsystem, THREE.MeshStandardMaterial>();
export function materialFor(s: Subsystem): THREE.MeshStandardMaterial {
  let m = cache.get(s);
  if (!m) {
    const metal = s === 'crankshaft' || s === 'pistons_rods' || s === 'fasteners' || s === 'camshaft_timing';
    m = new THREE.MeshStandardMaterial({ color: COLORS[s], metalness: metal ? .55 : .25, roughness: metal ? .38 : .58, side: THREE.DoubleSide });
    cache.set(s, m);
  }
  return m;
}
