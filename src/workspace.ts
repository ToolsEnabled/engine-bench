// One agent's model: its parts, their history for the timelapse, and the tool calls that change them.
import * as THREE from 'three';
import { ROLES, SUBSYSTEMS, type Role, type Subsystem } from './specs';
import { LIMITS } from './tools';
import { SpecError, partGeometry, vec3 } from './geometry';
import { materialFor } from './palette';

export interface Version {
  id: string; sub: Subsystem; role: Role | null; mesh: THREE.Mesh; box: THREE.Box3;
  t0: number; t1: number; // ms since the run started; t1 is Infinity while the part exists
  tris: number;
}

const ID = /^[a-z0-9_]{1,48}$/;
// Lets the page breathe between parts. A message-channel task, unlike a chain of zero-delay timers, is not
// slowed to one a minute when the tab is in the background.
const breathe = () => typeof MessageChannel === 'function'
  ? new Promise<void>(ok => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); ok(); }; c.port2.postMessage(null); })
  : new Promise<void>(ok => setTimeout(ok, 0));
const MAX_TRIS = 1_500_000;
const fmt = (v: number) => Math.round(v).toString();
export const boundsText = (b: THREE.Box3) => b.isEmpty() ? 'empty' :
  `X ${fmt(b.min.x)}..${fmt(b.max.x)}, Y ${fmt(b.min.y)}..${fmt(b.max.y)}, Z ${fmt(b.min.z)}..${fmt(b.max.z)}`;

export class Workspace {
  readonly group = new THREE.Group();
  readonly parts = new Map<string, Version>();
  readonly history: Version[] = [];
  tris = 0;
  changed = 0; // bumps on every change, so views and the score know to refresh

  constructor(private now: () => number, private added?: (v: Version) => Promise<void>) { this.group.name = 'agent-model'; }

  bounds(): THREE.Box3 {
    const b = new THREE.Box3();
    for (const v of this.parts.values()) b.union(v.box);
    return b;
  }

  // Applies one add_parts call. Valid parts land even when others in the call fail.
  async add(input: unknown): Promise<{ text: string; isError: boolean }> {
    const list = (input as { parts?: unknown })?.parts;
    if (!Array.isArray(list) || list.length < 1 || list.length > LIMITS.perCall)
      return { text: `parts must be a list of 1 to ${LIMITS.perCall} parts.`, isError: true };
    const added: string[] = [], replaced: string[] = [], errors: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i] as Record<string, unknown>;
      const label = typeof p?.id === 'string' ? `'${p.id}'` : `#${i + 1}`;
      try {
        if (!p || typeof p !== 'object') throw new SpecError('must be an object');
        if (typeof p.id !== 'string' || !ID.test(p.id)) throw new SpecError('id must be 1 to 48 lowercase letters, digits or underscores');
        if (!SUBSYSTEMS.includes(p.subsystem as Subsystem)) throw new SpecError(`subsystem must be one of ${SUBSYSTEMS.join(', ')}`);
        const role = p.role === undefined || p.role === null || p.role === 'none' ? null : p.role as Role;
        if (role && !ROLES.includes(role)) throw new SpecError(`role must be one of ${ROLES.join(', ')} or none`);
        const exists = this.parts.has(p.id);
        if (!exists && this.parts.size >= LIMITS.parts) throw new SpecError(`the model already has ${LIMITS.parts} parts`);
        const position = vec3(p.position, 'position'), rotation = vec3(p.rotation, 'rotation', [0, 0, 0]);
        const geometry = partGeometry(p.shape, p.cuts, 'part');
        const tris = geometry.getAttribute('position').count / 3;
        if (tris < 1) throw new SpecError('the cuts removed the whole part');
        const old = this.parts.get(p.id);
        if (this.tris + tris - (old?.tris ?? 0) > MAX_TRIS) throw new SpecError('the model is over its triangle limit; use fewer segments');
        const mesh = new THREE.Mesh(geometry, materialFor(p.subsystem as Subsystem));
        mesh.name = p.id;
        mesh.position.set(...position);
        mesh.rotation.set(...rotation.map(THREE.MathUtils.degToRad) as [number, number, number], 'XYZ');
        mesh.updateMatrixWorld(true);
        mesh.userData.born = performance.now();
        const box = new THREE.Box3().setFromObject(mesh, true);
        if (old) this.drop(old);
        const v: Version = { id: p.id, sub: p.subsystem as Subsystem, role, mesh, box, t0: this.now(), t1: Infinity, tris };
        this.parts.set(p.id, v); this.history.push(v); this.group.add(mesh); this.tris += tris;
        (old ? replaced : added).push(p.id);
        await this.added?.(v);
      } catch (e) {
        if (!(e instanceof SpecError)) throw e;
        errors.push(`part ${label}: ${e.message}`);
      }
      if (i % 4 === 3) await breathe(); // keep the page responsive
    }
    if (added.length || replaced.length) this.changed++;
    const lines = [`Added ${added.length} part${added.length === 1 ? '' : 's'}${replaced.length ? `, replaced ${replaced.length}` : ''}.`];
    if (errors.length) lines.push(`Not added (${errors.length}):`, ...errors);
    lines.push(`The model has ${this.parts.size} parts. Bounds: ${boundsText(this.bounds())}.`);
    return { text: lines.join('\n'), isError: errors.length > 0 && !added.length && !replaced.length };
  }

  remove(input: unknown): { text: string; isError: boolean } {
    const ids = (input as { ids?: unknown })?.ids;
    if (!Array.isArray(ids) || !ids.length) return { text: 'ids must be a non-empty list.', isError: true };
    const gone: string[] = [], missing: string[] = [];
    for (const id of ids) {
      const v = typeof id === 'string' ? this.parts.get(id) : undefined;
      if (v) { this.drop(v); this.parts.delete(v.id); gone.push(v.id); } else missing.push(String(id));
    }
    if (gone.length) this.changed++;
    return { text: `Removed ${gone.length}.${missing.length ? ` Not found: ${missing.slice(0, 20).join(', ')}.` : ''} The model has ${this.parts.size} parts.`, isError: !gone.length };
  }

  list(): string {
    const bySub: Record<string, number> = {}, byRole: Record<string, number> = {};
    for (const v of this.parts.values()) { bySub[v.sub] = (bySub[v.sub] || 0) + 1; if (v.role) byRole[v.role] = (byRole[v.role] || 0) + 1; }
    const rows = [...this.parts.values()].slice(0, 400).map(v => `${v.id} (${v.sub}${v.role ? `, ${v.role}` : ''}): ${boundsText(v.box)}`);
    return [
      `${this.parts.size} parts. Bounds: ${boundsText(this.bounds())}.`,
      `By subsystem: ${JSON.stringify(bySub)}`,
      `By role: ${JSON.stringify(byRole)}`,
      ...rows,
      this.parts.size > 400 ? `(${this.parts.size - 400} more not listed)` : '',
    ].filter(Boolean).join('\n');
  }

  dispose() {
    for (const v of this.history) v.mesh.geometry.dispose();
    this.group.clear(); this.parts.clear(); this.history.length = 0;
  }

  private drop(v: Version) {
    v.t1 = this.now(); this.group.remove(v.mesh); this.tris -= v.tris;
  }
}
