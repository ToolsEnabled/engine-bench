// The six tools. Both providers receive these exact names, descriptions and schemas.
import { ROLES, SUBSYSTEMS } from './specs';

export const LIMITS = { perCall: 40, parts: 1200, cuts: 12, points: 64, segments: 96, coord: 2000 };

const vec3 = (what: string) => ({ type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: what });

const SHAPE = {
  type: 'object',
  description: 'A primitive solid in local coordinates, in mm. box: size [x, y, z], centred. cylinder: radius and height, axis along local Z, centred; radius_top makes it a truncated cone. cone: radius at the base (-Z end), height, radius_top (default 0). tube: radius (outer), inner_radius and height, axis along local Z, centred. sphere: radius. torus: radius (to the centre of the ring) and tube (radius of the ring), ring in the local XY plane. extrude: points [[x, y], ...], a simple polygon of 3 to 64 points in the local XY plane, extruded along local Z by height, centred. revolve: points [[r, z], ...], a closed profile of 3 to 64 points with r >= 0, revolved a full turn around local Z. segments (8 to 96) sets the smoothness of round shapes.',
  properties: {
    type: { type: 'string', enum: ['box', 'cylinder', 'cone', 'tube', 'sphere', 'torus', 'extrude', 'revolve'] },
    size: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    radius: { type: 'number' },
    radius_top: { type: 'number' },
    inner_radius: { type: 'number' },
    height: { type: 'number' },
    tube: { type: 'number' },
    points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } },
    segments: { type: 'integer' },
  },
  required: ['type'],
};

export interface ToolDef { name: string; description: string; input_schema: Record<string, unknown> }

export const TOOLS: ToolDef[] = [
  {
    name: 'add_parts',
    description: `Add up to ${LIMITS.perCall} parts to your model. Each part is one solid: a shape, placed by position (mm) and rotation (degrees, Euler order XYZ as in three.js), with optional cuts subtracted from it. Cuts are placed in the part's local frame. Reusing an id replaces that part. Returns what was added, any errors and the budget left.`,
    input_schema: {
      type: 'object',
      properties: {
        parts: {
          type: 'array', minItems: 1, maxItems: LIMITS.perCall,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique id: lowercase letters, digits and underscores, up to 48 characters.' },
              subsystem: { type: 'string', enum: [...SUBSYSTEMS] },
              role: { type: 'string', enum: [...ROLES, 'none'], description: 'Tag only the component this part is. Use none for everything else.' },
              shape: SHAPE,
              position: vec3('Position of the local origin in the engine frame, mm.'),
              rotation: vec3('Rotation in degrees, Euler order XYZ. Default [0, 0, 0].'),
              cuts: {
                type: 'array', maxItems: LIMITS.cuts,
                description: 'Shapes subtracted from this part, each placed in the part\'s local frame.',
                items: {
                  type: 'object',
                  properties: { shape: SHAPE, position: vec3('mm, in the part\'s local frame.'), rotation: vec3('Degrees, Euler order XYZ.') },
                  required: ['shape'],
                },
              },
            },
            required: ['id', 'subsystem', 'shape', 'position'],
          },
        },
      },
      required: ['parts'],
    },
  },
  {
    name: 'remove_parts',
    description: 'Remove parts from your model by id.',
    input_schema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 200 } },
      required: ['ids'],
    },
  },
  {
    name: 'list_parts',
    description: 'List your parts: counts by subsystem and role, the bounds of the model and every part id with its bounds.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'render_view',
    description: 'Render your model as an 800 x 600 image. Views: iso (from +X, -Y, +Z), timing_end (from +X), flywheel_end (from -X), intake_side (from +Y), exhaust_side (from -Y), top (from +Z), bottom (from -Z). section: true cuts away the half of the model nearest the camera, through the origin. The axes at the origin are 100 mm long: X red, Y green, Z blue.',
    input_schema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: ['iso', 'timing_end', 'flywheel_end', 'intake_side', 'exhaust_side', 'top', 'bottom'] },
        section: { type: 'boolean' },
      },
      required: ['view'],
    },
  },
  {
    name: 'get_reference',
    description: 'Render the reference engine (the goal) as an 800 x 600 image with the same cameras, colours and axes as render_view.',
    input_schema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: ['iso', 'timing_end', 'flywheel_end', 'intake_side', 'exhaust_side', 'top', 'bottom'] },
        section: { type: 'boolean' },
      },
      required: ['view'],
    },
  },
  {
    name: 'finish',
    description: 'Finish your run. Your model is scored as it stands.',
    input_schema: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'One or two sentences on what you built.' } },
      required: ['summary'],
    },
  },
];
