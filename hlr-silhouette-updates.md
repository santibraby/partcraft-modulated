# HLR Silhouette Function — Required Updates

Based on code review of `hlr.js` and visual analysis of drawing output.

---

## Summary

The three-layer pipeline is over-engineered for mechanical part geometry. Layers 2 and 3 produce silhouettes without occlusion testing, causing internal features to draw as visible and lines to double-up. Layer 1 (`HLRBRep_Algo`) already computes all silhouettes internally with full visibility — it is the only layer needed.

---

## Changes

### 1. Remove Layer 2 and Layer 3 entirely

Delete `runReflectLines()`, `runContapContAna()`, `extractCylinderSilhouettes()`, `extractSphereSilhouette()`, and `extractConeSilhouettes()`.

Neither `HLRAppli_ReflectLines` nor `Contap_ContAna` perform occlusion testing. For any geometry where a cylinder bore sits inside a larger body, these methods will draw the bore's silhouette lines as visible even when they are physically behind the outer wall. `HLRBRep_Algo` runs the same contour computation internally during `Update()` and then visibility-tests every result during `Hide()` — so all silhouettes you need are already in `OutLineVCompound_1` and `OutLineHCompound_1`.

### 2. Simplify `computeHLR` loop

```js
// BEFORE
const hlr     = runHLR(oc, shape, vDef, sf, name);
const reflect = runReflectLines(oc, shape, vDef, sf, name);
const contap  = runContapContAna(oc, shape, vDef, sf, name);

let silhouettes = reflect.visible;
if (silhouettes.length === 0) silhouettes = hlr.hlrSilVisible;
silhouettes = [...silhouettes, ...contap.edges];

const hidden = [...hlr.hidden, ...reflect.hidden, ...hlr.hlrSilHidden];

results[name] = { visible: hlr.visible, hidden, silhouettes };
```

```js
// AFTER
const hlr = runHLR(oc, shape, vDef, sf, name);
results[name] = { visible: hlr.visible, hidden: hlr.hidden };
```

Silhouettes no longer need to be a separate bucket — they are included in `visible` and `hidden` via the outline extractors in `runHLR`.

### 3. Update `runHLR` — fix coord map, switch to `PartialHide`, add all outline extractors, fix memory leaks

```js
// BEFORE
algo.Hide_1();

const hAlgo   = new oc.Handle_HLRBRep_Algo_2(algo);
const toShape = new oc.HLRBRep_HLRToShape(hAlgo);

const visible = [];
const hidden  = [];

extractCompound(oc, toShape, 'VCompound_1',        sf, visible, 'V-sharp',     vDef.remap, name);
extractCompound(oc, toShape, 'Rg1LineVCompound_1', sf, visible, 'V-smooth',    vDef.remap, name);
extractCompound(oc, toShape, 'RgNLineVCompound_1', sf, visible, 'V-sewn',      vDef.remap, name);
extractCompound(oc, toShape, 'HCompound_1',        sf, hidden,  'H-sharp',     vDef.remap, name);
extractCompound(oc, toShape, 'Rg1LineHCompound_1', sf, hidden,  'H-smooth',    vDef.remap, name);

const hlrSilVisible = [];
const hlrSilHidden  = [];
extractCompound(oc, toShape, 'OutLineVCompound3d',  sf, hlrSilVisible, 'V-silhouette', vDef.proj3d, name);
if (hlrSilVisible.length === 0) {
    extractCompound(oc, toShape, 'OutLineVCompound_1', sf, hlrSilVisible, 'V-silhouette', vDef.remap, name);
}
extractCompound(oc, toShape, 'OutLineHCompound_1', sf, hlrSilHidden, 'H-silhouette', vDef.remap, name);

origin.delete(); dir.delete(); xDir.delete(); ax2.delete(); proj.delete();
return { visible, hidden, hlrSilVisible, hlrSilHidden };
```

```js
// AFTER
algo.PartialHide();   // self-occlusion only — correct for single parts, 2-3x faster
                      // only switch back to Hide_1() if processing multi-part assemblies
                      // where separate bodies occlude each other

const hAlgo   = new oc.Handle_HLRBRep_Algo_2(algo);
const toShape = new oc.HLRBRep_HLRToShape(hAlgo);

const visible = [];
const hidden  = [];

// Visible edges
extractCompound(oc, toShape, 'VCompound_1',        sf, visible, 'V-sharp',      vDef.remap, name);
extractCompound(oc, toShape, 'OutLineVCompound_1', sf, visible, 'V-silhouette', vDef.remap, name);
extractCompound(oc, toShape, 'Rg1LineVCompound_1', sf, visible, 'V-smooth',     vDef.remap, name);

// Hidden edges (dashed in drawing output)
extractCompound(oc, toShape, 'HCompound_1',        sf, hidden,  'H-sharp',      vDef.remap, name);
extractCompound(oc, toShape, 'OutLineHCompound_1', sf, hidden,  'H-silhouette', vDef.remap, name);
extractCompound(oc, toShape, 'Rg1LineHCompound_1', sf, hidden,  'H-smooth',     vDef.remap, name);

// Cleanup — HLR objects are the heaviest in the pipeline
toShape.delete();
hAlgo.delete();
algo.delete();
hOutliner.delete();
outliner.delete();
origin.delete(); dir.delete(); xDir.delete(); ax2.delete(); proj.delete();

return { visible, hidden };
```

Key changes in this block:
- `Hide_1()` → `PartialHide()` — for a single solid part, full inter-shape occlusion is not needed and is significantly slower
- `OutLineVCompound3d` + `proj3d` path removed — `OutLineVCompound_1` with `remap` is correct for all views including axon; `OutLineVCompound3d` returned world-space edges that were being run through `IDENTITY` instead of the correct coordinate remap, causing wrong positions in front/right views
- `RgNLineVCompound_1` (sewn seam edges) removed from visible — these are surface-join seams that don't belong in a clean technical drawing
- Hidden outline extractor `OutLineHCompound_1` and `Rg1LineHCompound_1` added — these were missing, meaning hidden silhouette lines were never drawn dashed
- All OCCT objects now deleted before return

### 4. Fix `gp_Pnt` leaks in `classify`

Every call to `adaptor.Value()` allocates a heap object that must be manually deleted.

```js
// BEFORE
const a = adaptor.Value(t0), b = adaptor.Value(t1);
adaptor.delete();
return { type: 'line', points: [coordMap(a.X(),a.Y(),a.Z(),sf), coordMap(b.X(),b.Y(),b.Z(),sf)] };
```

```js
// AFTER
const a = adaptor.Value(t0);
const b = adaptor.Value(t1);
const result = {
    type: 'line',
    points: [coordMap(a.X(), a.Y(), a.Z(), sf), coordMap(b.X(), b.Y(), b.Z(), sf)]
};
a.delete(); b.delete(); adaptor.delete();
return result;
```

Apply the same pattern to every `adaptor.Value()` call in `sampleAdaptor` and every `surf.Value()` call in the contap extractors (if kept).

### 5. Replace uniform sampling with adaptive deflection in `sampleAdaptor`

Uniform parameter sampling produces uneven point spacing — too dense on near-straight sections, too sparse on high-curvature regions. `GCPnts_TangentialDeflection` samples based on actual curve geometry.

```js
// BEFORE
function sampleAdaptor(adaptor, t0, t1, sf, n, coordMap) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        try {
            const p = adaptor.Value(t0 + (t1 - t0) * i / n);
            pts.push(coordMap(p.X(), p.Y(), p.Z(), sf));
        } catch (_) { break; }
    }
    return pts;
}
```

```js
// AFTER
function sampleAdaptor(oc, adaptor, t0, t1, sf, coordMap) {
    const pts = [];
    let disc;
    try {
        disc = new oc.GCPnts_TangentialDeflection_2(
            adaptor,
            t0, t1,
            0.1,   // angular deflection (radians) — controls arc smoothness
            0.01   // curvature deflection (model units) — controls chord error
        );
        for (let i = 1; i <= disc.NbPoints(); i++) {
            const p = disc.Value(i);
            pts.push(coordMap(p.X(), p.Y(), p.Z(), sf));
            p.delete();
        }
    } catch (_) {
        // fallback to uniform if GCPnts fails
        for (let i = 0; i <= 24; i++) {
            try {
                const p = adaptor.Value(t0 + (t1 - t0) * i / 24);
                pts.push(coordMap(p.X(), p.Y(), p.Z(), sf));
                p.delete();
            } catch (_) { break; }
        }
    } finally {
        if (disc) disc.delete();
    }
    return pts;
}
```

Update all call sites to pass `oc` as first argument and remove the `n` parameter.

### 6. Normalize `axon.dir`

`gp_Dir` normalizes internally but the raw `[1,1,1]` vector is used in dot-product math in the contap extractors. If those are removed this is moot, but fix it regardless for correctness.

```js
// BEFORE
dir: [1, 1, 1],

// AFTER
dir: [1/Math.SQRT2/Math.SQRT2, 1/Math.SQRT2/Math.SQRT2, 1/Math.SQRT2/Math.SQRT2],
// or more readably:
const S3 = Math.sqrt(3);
dir: [1/S3, 1/S3, 1/S3],
```

---

## Expected Visual Result After Changes

| View | Before | After |
|---|---|---|
| Front | Doubled outer silhouette lines | Single clean silhouette per cylinder side |
| Right | Silhouette lines at wrong positions | Lines correctly placed via `remap` |
| Top | Internal bore silhouettes drawn solid | Bore silhouettes dashed (hidden) or absent |
| All | No hidden silhouette dashes | Hidden silhouettes drawn dashed via `OutLineHCompound_1` |
