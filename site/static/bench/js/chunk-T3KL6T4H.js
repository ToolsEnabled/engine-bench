var n=["block","head","crankshaft","pistons_rods","valvetrain","camshaft_timing","intake","exhaust","fuel","ignition","lubrication","cooling","accessories","fasteners","other"],t=["block","head","crankshaft","piston","connecting_rod","camshaft","intake_valve","exhaust_valve","spark_plug","oil_pan","valve_cover","intake_manifold","exhaust_manifold","flywheel","timing_belt","water_pump","distributor","fuel_rail"],r={cylinders:4,bore:75,pitch:84,crankZ:-212,valves:16,plugs:4,parts:894,bounds:[[-326,-268.2,-376.5],[267.6,279.5,167.8]]},a=`ENGINE SPEC PACK v1
A real 1990s production engine: 1.6 L, single overhead camshaft, inline four cylinders, 16 valves, water-cooled, built for a transverse front-wheel-drive car.

FRAME AND UNITS
- Millimetres. Right-handed axes. Z is up, along the cylinder axes. X runs along the crankshaft.
- Origin: on the block deck face, where the head meets the block, midway between cylinders 2 and 3.
- Cylinder 1 is at +X, the timing-belt end. The flywheel and transmission are at -X.
- The intake side is +Y. The exhaust side is -Y.

CORE DIMENSIONS
- Bore 75.0, stroke 90.0, displacement 1590 cc, compression ratio 9.2:1.
- Bore spacing 84.0. Cylinder centres at X = +126, +42, -42, -126 (cylinders 1 to 4), Y = 0.
- Crankshaft axis at Y = 0, Z = -212 (deck height 212). Crank throw 45. Connecting rods 137 between centres. Compression height 30 (wrist pin centre to piston crown).
- Firing order 1-3-4-2. Five main bearings. In the pictured position, pistons 1 and 4 are at top dead centre (crowns at Z 0) and pistons 2 and 3 at bottom dead centre (crowns at Z -90).

MAJOR COMPONENTS (bounding boxes in the engine frame, min..max)
- Cylinder block: X -205..198, Y -111..110, Z -292..0. Aluminium casting with iron cylinder liners.
- Cylinder head: X -203..203, Y -86..101, Z 1..117.
- Valve cover: X -197..197, Y -83..83, Z 94..147.
- Oil pan: X -194..194, Y -86..86, Z -377..-294.
- Crankshaft: X -211..254, Y -43..43, Z -284..-140, counterweights included. The nose at +X carries the timing sprocket and the crank pulley.
- Pistons: diameter 75, height 60.
- Connecting rods: 150 long overall, 70 wide (along Y) at the big end, 23 thick (along X).
- Camshaft: X -185..218, axis near Y 12, Z 88. Driven from the +X end by the timing belt.
- Valves: 2 intake and 2 exhaust per cylinder, 16 in total. Intake heads 30 in diameter on the +Y side, exhaust heads 26 in diameter on the -Y side. Stems lean outward from the cylinder axis, from the valve heads near Z 2 up to the stem tips near Z 118. Each cylinder's two intake valves sit about 16 either side of the cylinder centre in X; the exhaust pair likewise.
- Spark plugs: one per cylinder, centred on the cylinder in X, leaning about 18 degrees from vertical, from the tip near Z 9 to the top near Z 73, each in a plug tube through the head.
- Intake manifold: +Y side, X -176..168, Y 87..245, Z -118..106. Four runners into the head, a plenum and a throttle body.
- Fuel rail with four injectors: X -165..178, Y 122..170, Z 104..133.
- Exhaust manifold: -Y side, X -185..185, Y -244..-87, Z -154..69. Four primaries merging below.
- Timing belt: in a plane at the +X end, X 199..223, Y -47..111, Z -242..147, running from the crank sprocket around the cam pulley, the water pump pulley and a tensioner. Upper and lower timing covers over it.
- Flywheel: at the -X end, X -223..-211, diameter 248, centred on the crank axis.
- Water pump: at the +X end, driven by the timing belt, X 166..198, Y 38..130, Z -109..-27.
- Distributor: at the -X end of the head, driven by the camshaft, X -280..-192, Y -49..73, Z 33..157.
- Whole engine with accessories: X -326..268, Y -268..280, Z -377..168.

THE REFERENCE MODEL
- 894 separate parts: castings, the crankshaft, pistons, rings and rods, 16 valves with their springs, retainers, keepers, guides and seals, rockers and rocker shafts, the camshaft and timing parts, bolts, gaskets, sensors, the oil pump and filter, the water pump and thermostat, the distributor, the fuel system, the power-steering pump, the clutch and the flywheel.`;function i(e){return`You are one of two agents in Engine Bench. Both agents get this same prompt, the same spec pack and the same tools. You work at the same time, in separate workspaces, and cannot see each other.

Task: build a 3D CAD model of the engine in the spec pack, as close to the real engine as you can, out of separate parts. Each part is a solid made from one primitive shape (box, cylinder, tube, cone, sphere, torus, extruded polygon or revolved profile), placed in the engine frame, with optional cuts that subtract other shapes from it.

Scoring, 0 to 100, against the reference model of the same engine:
- 25%: silhouette overlap with the reference, seen from the timing end, the exhaust side and the top, in the engine frame.
- 20%: surface match: seen from all six sides, the share of the surface that lies within 10 mm of the reference surface.
- 35%: key dimensions read from the parts you tag with a role: number of cylinders, bore, bore spacing, crankshaft height, number of valves, overall size.
- 20%: coverage of the 18 roles: ${t.join(", ")}.
Tag a part with a role only when the part is that component. Part count, time, tokens and cost are reported but not scored.

Work until you are satisfied with your model, then call finish. There is no turn, time or cost budget. The model can have up to ${e.parts} parts, with up to ${e.perCall} parts per add_parts call.

render_view shows your model. get_reference shows the goal engine from the same camera and in the same colours. Each subsystem has its own colour.

${a}`}export{n as a,t as b,r as c,i as d};
