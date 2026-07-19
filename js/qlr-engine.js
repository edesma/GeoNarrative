/**
 * qlr-engine.js — QGIS QLR Styling Engine
 *
 * Pure port of the parsing/styling core from QGIS Layer Viewer v1.0.0.
 * No UI code, no DOM manipulation beyond what's needed to build OL styles.
 * Depends only on OpenLayers (ol.*) and the browser's DOMParser.
 *
 * Public API:
 *   QLREngine.parseQLR(qlrText) → Promise<{
 *     layerName, layerOpacity, geometryType, styleFunction,
 *     abstract, datasource, hasLabeling, labelsEnabled,
 *     labelConfig, labelState, mapTipHtml, previewField, legendItems
 *   }>
 *
 * Shared by both the viewer (map.js) and the editor (editor-map.js) —
 * loaded once, used by both, so QLR parsing bugs only need fixing
 * in one place.
 *
 * Ported from qgis_viewer.js. See QLR_Integration_Guide_for_GeoNarrative.md
 * for the full list of gotchas this code already accounts for.
 */

const QLREngine = (() => {

  const MM_TO_PX = 3.78;
  const SVG_BASE = "svg/";   // optional server-hosted QGIS SVG library

  // QGIS built-in background SVGs — generated inline to avoid a server
  // fetch (and a 404 warning) for the handful of common shapes.
  const QGIS_BUILTIN_SVGS = {
    "backgrounds/background_circle.svg":
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><circle cx="40" cy="40" r="37" fill="param(fill) #000000" stroke="param(outline) #000000" stroke-width="param(outline-width) 1"/></svg>`,
    "backgrounds/background_square.svg":
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect x="2" y="2" width="76" height="76" fill="param(fill) #000000" stroke="param(outline) #000000" stroke-width="param(outline-width) 1"/></svg>`,
    "backgrounds/background_square_corners.svg":
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect x="2" y="2" width="76" height="76" rx="12" fill="param(fill) #000000" stroke="param(outline) #000000" stroke-width="param(outline-width) 1"/></svg>`,
    "backgrounds/background_diamond.svg":
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><polygon points="40,2 78,40 40,78 2,40" fill="param(fill) #000000" stroke="param(outline) #000000" stroke-width="param(outline-width) 1"/></svg>`,
    "backgrounds/background_shield.svg":
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><path d="M40,2 L78,16 L78,48 L40,78 L2,48 L2,16 Z" fill="param(fill) #000000" stroke="param(outline) #000000" stroke-width="param(outline-width) 1"/></svg>`,
  };

  // ── Color utilities ─────────────────────────────────────────────

  function parseQGISColorRGB(str) {
    if (!str) return [0, 0, 0, 1];
    const p = str.split(",");
    return [parseInt(p[0]), parseInt(p[1]), parseInt(p[2]), parseInt(p[3]) / 255];
  }
  function parseQGISColor(str) {
    const [r, g, b, a] = parseQGISColorRGB(str);
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  }
  function toHex(str) {
    const [r, g, b] = parseQGISColorRGB(str);
    return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
  }

  // ── Font size unit conversion (QGIS → CSS pixels at 96 dpi) ──────

  function fontSizeToPx(size, unit) {
    switch ((unit || "Point").toLowerCase()) {
      case "point": return size * (96 / 72);   // 1pt = 1.333px at 96dpi
      case "pixel": return size;
      case "mm":    return size * 3.78;
      case "inch":  return size * 96;
      default:
        // Percentage, MetersAtScale, MapUnit — cannot map to a fixed px value
        console.warn(`[QLR Engine] Unsupported font size unit: "${unit}" — defaulting to 10px`);
        return 10;
    }
  }

  // ── SVG utilities ────────────────────────────────────────────────

  function substituteParams(svg, props) {
    const fillHex = toHex(props.color), outlineHex = toHex(props.outline_color);
    const fillA = parseQGISColorRGB(props.color)[3].toFixed(3);
    const outA  = parseQGISColorRGB(props.outline_color)[3].toFixed(3);
    const outW  = (parseFloat(props.outline_width || 0) * MM_TO_PX).toFixed(1);
    return svg
      .replace(/param\(fill\)(\s+#[0-9a-fA-F]+)?/g,   fillHex)
      .replace(/param\(outline\)(\s+#[0-9a-fA-F]+)?/g, outlineHex)
      .replace(/param\(fill-opacity\)/g,                fillA)
      .replace(/param\(outline-opacity\)/g,             outA)
      .replace(/param\(outline-width\)(\s+[\d.]+)?/g,   outW);
  }

  // Inject explicit width/height onto the <svg> root tag before encoding
  // to a data URI — without this, browsers disagree on intrinsic SVG
  // size when used as an ol.style.Icon source. Regex is anchored to the
  // opening <svg ...> tag only so inner elements with width= are untouched.
  function injectSvgSize(svg, px) {
    const r = Math.round(px);
    return svg.replace(/<svg(\b[^>]*)>/, (_, a) =>
      `<svg width="${r}" height="${r}"${a.replace(/\s+width="[^"]*"/, "").replace(/\s+height="[^"]*"/, "")}>`
    );
  }

  // ── Canvas marker (for shapes OL has no native primitive for) ────

  function makeCanvasMarker(size, fillColor, strokeColor, strokeWidth, drawFn) {
    const s = Math.round(size), pad = Math.ceil(strokeWidth / 2);
    const canvas = document.createElement("canvas");
    canvas.width = s + pad * 2; canvas.height = s + pad * 2;
    const ctx = canvas.getContext("2d");
    ctx.translate(pad, pad);
    ctx.fillStyle = fillColor; ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth;
    drawFn(ctx, s);
    return new ol.style.Icon({ img: canvas, size: [canvas.width, canvas.height] });
  }

  // ── Glow helper — shared by lines and polygons ────────────────────
  // OpenLayers has no native glow/blur primitive. Simulated by stacking
  // 5 strokes of increasing width and decreasing opacity beneath the
  // main stroke.

  function makeGlowStyles(glowConfig) {
    if (!glowConfig) return [];
    const [r, g, b] = parseQGISColorRGB(glowConfig.color);
    const halo  = (glowConfig.spread + glowConfig.blur) * MM_TO_PX;
    const STEPS = 5;
    const styles = [];
    for (let i = STEPS; i >= 1; i--) {
      const t = i / STEPS;
      styles.push(new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: `rgba(${r},${g},${b},${(glowConfig.opacity * (1 - t)).toFixed(3)})`,
          width: halo * t * 2,
        }),
      }));
    }
    return styles;
  }

  // Parse outerGlow from an effectStack XML element.
  // NOTE the asymmetry: for LINES, glow lives on the symbol layer's own
  // effectStack; for POLYGONS, glow lives one level up on the renderer's
  // effectStack. Easy to miss if porting from memory — verified against
  // actual QLR structure.
  function parseGlowFromEffectStack(effectStackEl) {
    if (!effectStackEl) return null;
    if (effectStackEl.getAttribute("enabled") === "0") return null;

    let glowEl = null;
    for (const child of effectStackEl.children) {
      if (child.getAttribute("type") === "outerGlow") { glowEl = child; break; }
    }
    if (!glowEl) return null;

    const gp = {};
    [...glowEl.getElementsByTagName("Option")].forEach(o => {
      if (o.getAttribute("name") && o.getAttribute("value"))
        gp[o.getAttribute("name")] = o.getAttribute("value");
    });
    if (gp["enabled"] !== "1") return null;

    return {
      color:   gp["single_color"],
      spread:  parseFloat(gp["spread"]     || 1),
      opacity: parseFloat(gp["opacity"]    || 0.5),
      blur:    parseFloat(gp["blur_level"] || 0.8),
    };
  }

  // ── Label helper ─────────────────────────────────────────────────

  function makeLabelStyle(feature, cfg) {
    if (!cfg?.fieldName) return null;
    const txt = String(feature.get(cfg.fieldName) ?? "");
    if (!txt) return null;

    const fontPx = fontSizeToPx(cfg.fontSize, cfg.fontSizeUnit);
    let fontStr = `${Math.round(fontPx)}px "${cfg.fontFamily}"`;
    if (cfg.fontBold && cfg.fontItalic) fontStr = "bold italic " + fontStr;
    else if (cfg.fontBold)              fontStr = "bold "        + fontStr;
    else if (cfg.fontItalic)            fontStr = "italic "      + fontStr;

    return new ol.style.Style({
      text: new ol.style.Text({
        text:      txt,
        font:      fontStr,
        overflow:  true,
        // 'line' placement makes labels follow line direction instead
        // of staying horizontal — only applies to Line geometry.
        placement: cfg.geometryType === "Line" ? "line" : "point",
        fill:      new ol.style.Fill({ color: parseQGISColor(cfg.textColor) }),
        stroke:    cfg.bufferDraw ? new ol.style.Stroke({
          color: parseQGISColor(cfg.bufferColor),
          width: cfg.bufferSize * 2,
        }) : undefined,
      }),
    });
  }

  // ── Style builders — per geometry type ────────────────────────────

  async function buildPointImage(cls, props) {
    const size = parseFloat(props.size || 2) * MM_TO_PX;
    const fill = new ol.style.Fill({ color: parseQGISColor(props.color) });
    const sw   = parseFloat(props.outline_width || 0);
    const stroke = sw > 0
      ? new ol.style.Stroke({ color: parseQGISColor(props.outline_color), width: sw * MM_TO_PX })
      : undefined;

    if (cls === "SimpleMarker") {
      const shape = (props.name || "circle").toLowerCase();
      switch (shape) {
        case "circle":    return new ol.style.Circle({ radius: size/2, fill, stroke });
        case "square":
        case "rectangle": return new ol.style.RegularShape({ points:4, radius:size/2, angle:Math.PI/4, fill, stroke });
        case "diamond":   return new ol.style.RegularShape({ points:4, radius:size/2, angle:0, fill, stroke });
        case "triangle":  return new ol.style.RegularShape({ points:3, radius:size/2, angle:0, fill, stroke });
        case "pentagon":  return new ol.style.RegularShape({ points:5, radius:size/2, angle:0, fill, stroke });
        case "hexagon":   return new ol.style.RegularShape({ points:6, radius:size/2, angle:0, fill, stroke });
        case "star":      return new ol.style.RegularShape({ points:5, radius:size/2, radius2:size/4, angle:0, fill, stroke });
        case "cross_fill": {
          const arm = size*0.35, c = size/2;
          return makeCanvasMarker(size, parseQGISColor(props.color), parseQGISColor(props.outline_color), sw*MM_TO_PX,
            (ctx,s) => { ctx.beginPath(); ctx.rect(c-arm/2,0,arm,s); ctx.rect(0,c-arm/2,s,arm); ctx.fill(); if(sw>0) ctx.stroke(); });
        }
        case "cross":  return makeCanvasMarker(size,"rgba(0,0,0,0)",parseQGISColor(props.outline_color||props.color),Math.max(sw,1)*MM_TO_PX,
          (ctx,s)=>{ctx.beginPath();ctx.moveTo(s/2,0);ctx.lineTo(s/2,s);ctx.moveTo(0,s/2);ctx.lineTo(s,s/2);ctx.stroke();});
        case "x":
        case "cross2": return makeCanvasMarker(size,"rgba(0,0,0,0)",parseQGISColor(props.outline_color||props.color),Math.max(sw,1)*MM_TO_PX,
          (ctx,s)=>{ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(s,s);ctx.moveTo(s,0);ctx.lineTo(0,s);ctx.stroke();});
        case "line": return makeCanvasMarker(size,"rgba(0,0,0,0)",parseQGISColor(props.outline_color||props.color),Math.max(sw,1)*MM_TO_PX,
          (ctx,s)=>{ctx.beginPath();ctx.moveTo(s/2,0);ctx.lineTo(s/2,s);ctx.stroke();});
        default:
          console.warn(`[QLR Engine] Unknown shape "${shape}" — circle fallback`);
          return new ol.style.Circle({ radius:size/2, fill, stroke });
      }
    }

    if (cls === "SvgMarker") {
      const nameVal = props.name || "";
      if (nameVal.startsWith("base64:")) {
        const colored = injectSvgSize(substituteParams(atob(nameVal.slice(7)), props), size);
        return new ol.style.Icon({ src: "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(colored))) });
      }
      if (nameVal) {
        // QGIS built-in background SVGs first — no server fetch needed
        if (QGIS_BUILTIN_SVGS[nameVal]) {
          const colored = injectSvgSize(substituteParams(QGIS_BUILTIN_SVGS[nameVal], props), size);
          return new ol.style.Icon({ src: "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(colored))) });
        }
        // Server-hosted fallback — lets a custom override take priority
        try {
          const resp = await fetch(SVG_BASE + nameVal);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const colored = injectSvgSize(substituteParams(await resp.text(), props), size);
          return new ol.style.Icon({ src: "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(colored))) });
        } catch {
          console.warn(`[QLR Engine] SVG not found: ${SVG_BASE + nameVal}`);
        }
      }
      return new ol.style.Circle({ radius:size/2, fill, stroke });
    }

    return new ol.style.Circle({ radius:size/2, fill, stroke });
  }

  function makeLineStyle(parts) {
    const glow = [], lines = [];
    parts.forEach(p => {
      glow.push(...makeGlowStyles(p.glow));
      let dash, lineCap;
      if (p.use_custom_dash === "1" && p.customdash) {
        dash = p.customdash.split(";").map(v => Number(v) * MM_TO_PX);
      } else if (p.style === "dot") {
        dash = [p.width*MM_TO_PX, p.width*MM_TO_PX*2]; lineCap = "round";
      } else if (p.style === "dash") {
        dash = [p.width*MM_TO_PX*4, p.width*MM_TO_PX*2];
      } else if (p.style === "dash dot") {
        dash = [p.width*MM_TO_PX*4, p.width*MM_TO_PX*2, p.width*MM_TO_PX, p.width*MM_TO_PX*2]; lineCap = "round";
      } else if (p.style === "dash dot dot") {
        dash = [p.width*MM_TO_PX*4, p.width*MM_TO_PX*2, p.width*MM_TO_PX, p.width*MM_TO_PX*2, p.width*MM_TO_PX, p.width*MM_TO_PX*2]; lineCap = "round";
      }
      const opts = { color: parseQGISColor(p.color), width: p.width*MM_TO_PX, lineDash: dash };
      if (lineCap) opts.lineCap = lineCap;
      lines.push(new ol.style.Style({ stroke: new ol.style.Stroke(opts) }));
    });
    return [...glow, ...lines];
  }

  function makePolygonStyle(sym) {
    if (!sym) return new ol.style.Style();
    return new ol.style.Style({
      fill: new ol.style.Fill({ color: parseQGISColor(sym.fillColor) }),
      stroke: sym.outlineStyle === "no" ? undefined : new ol.style.Stroke({
        color: parseQGISColor(sym.outlineColor), width: sym.outlineWidth * MM_TO_PX,
      }),
    });
  }

  // ── Legend helpers ────────────────────────────────────────────────

  function buildSwatch(cls, props, geometryType) {
    if (cls === "SimpleLine") {
      const w = parseFloat(props["line_width"] || 1);
      let dash = null;
      if (props["use_custom_dash"] === "1" && props["customdash"]) {
        dash = props["customdash"].split(";").map(v => (Number(v) * 1.5).toFixed(1)).join(",");
      } else if (props["line_style"] === "dot") {
        dash = `${(w*1.5).toFixed(1)},${(w*3).toFixed(1)}`;
      } else if (props["line_style"] === "dash") {
        dash = `${(w*6).toFixed(1)},${(w*3).toFixed(1)}`;
      } else if (props["line_style"] === "dash dot") {
        dash = `${(w*6).toFixed(1)},${(w*3).toFixed(1)},${(w*1.5).toFixed(1)},${(w*3).toFixed(1)}`;
      }
      if (geometryType === "Polygon") {
        return { type: "polygon", fillColor: "none",
                 outlineColor: parseQGISColor(props["line_color"] || "0,0,0,255"), outlineStyle: "solid" };
      }
      return { type: "line", color: parseQGISColor(props["line_color"] || "0,0,0,255"),
               width: w, dash };
    }
    if (cls === "SimpleFill") {
      return { type: "polygon",
               fillColor:    parseQGISColor(props["color"]         || "255,255,255,255"),
               outlineColor: parseQGISColor(props["outline_color"] || "0,0,0,255"),
               outlineStyle: props["outline_style"] || "solid" };
    }
    if (cls === "SimpleMarker" || cls === "SvgMarker") {
      return { type: "point",
               shape:        cls === "SimpleMarker" ? (props["name"] || "circle") : "circle",
               color:        parseQGISColor(props["color"]         || "200,100,100,255"),
               outlineColor: parseQGISColor(props["outline_color"] || "0,0,0,255"),
               size:         parseFloat(props["size"] || 2) };
    }
    return null;
  }

  function buildLegendItems(renderer, symbolsEl, rendererType, geometryType) {
    const items = [];

    function swatchForSymbol(symName) {
      const symEl = [...symbolsEl.children].find(s => s.getAttribute("name") === symName);
      if (!symEl) return null;
      const lyrEl = symEl.getElementsByTagName("layer")[0];
      if (!lyrEl) return null;
      const props = {};
      [...lyrEl.getElementsByTagName("Option")].forEach(o => {
        if (o.getAttribute("name") && o.getAttribute("value"))
          props[o.getAttribute("name")] = o.getAttribute("value");
      });
      return buildSwatch(lyrEl.getAttribute("class"), props, geometryType);
    }

    if (rendererType === "categorizedSymbol") {
      [...renderer.getElementsByTagName("category")].forEach(cat => {
        const symName = cat.getAttribute("symbol");
        const label   = cat.getAttribute("label") || cat.getAttribute("value") || "";
        const swatch  = swatchForSymbol(symName);
        if (swatch) items.push({ label, swatch, _symName: symName });
      });
    } else if (rendererType === "graduatedSymbol") {
      [...renderer.getElementsByTagName("range")].forEach(range => {
        const symName = range.getAttribute("symbol");
        const label   = range.getAttribute("label") || "";
        const swatch  = swatchForSymbol(symName);
        if (swatch) items.push({ label, swatch, _symName: symName });
      });
    } else { // singleSymbol
      const swatch = swatchForSymbol("0");
      if (swatch) items.push({ label: "", swatch, _symName: "0" });
    }

    return items;
  }

  // Generate inline SVG/HTML for a legend swatch — usable directly in
  // any host app's legend panel (or omitted, if GeoNarrative doesn't
  // want one). Returned as markup so the host app stays framework-agnostic.
  function buildSwatchSvg(swatch) {
    if (!swatch) return "";

    if (swatch.type === "line") {
      const sw  = Math.max(1, Math.min(swatch.width * 1.5, 5)).toFixed(1);
      const da  = swatch.dash ? `stroke-dasharray="${swatch.dash}"` : "";
      return `<svg width="30" height="14" style="flex-shrink:0">
        <line x1="2" y1="7" x2="28" y2="7"
            stroke="${swatch.color}" stroke-width="${sw}"
            stroke-linecap="round" ${da}/>
      </svg>`;
    }
    if (swatch.type === "polygon") {
      const fill   = swatch.fillColor || "none";
      const noLine = swatch.outlineStyle === "no";
      const stroke = noLine ? 'stroke="none"' : `stroke="${swatch.outlineColor}" stroke-width="1.5"`;
      return `<svg width="20" height="14" style="flex-shrink:0">
        <rect x="1" y="1" width="18" height="12" fill="${fill}" ${stroke}/>
      </svg>`;
    }
    if (swatch.type === "point") {
      if (swatch.canvasUrl) {
        return `<img src="${swatch.canvasUrl}"
          style="flex-shrink:0;width:16px;height:16px;object-fit:contain;vertical-align:middle;"
          alt="">`;
      }
      return `<svg width="16" height="16" style="flex-shrink:0">
        <circle cx="8" cy="8" r="5"
            fill="${swatch.color}" stroke="${swatch.outlineColor}" stroke-width="1"/>
      </svg>`;
    }
    return "";
  }

  // ── Datasource cleanup ────────────────────────────────────────────
  // Strips GDAL's /vsicurl/ prefix and |layername= suffix that QGIS
  // adds when a QLR is created via Data Source Manager → Protocol: HTTP(S)

  function cleanDatasource(raw) {
    return (raw || "")
      .replace(/^\/vsicurl\//i, "")
      .replace(/\|layername=[^|]*$/i, "")
      .trim();
  }

  // ── Core parser ──────────────────────────────────────────────────

  async function parseQLR(text) {
    // Critical gotcha: QGIS exports a DOCTYPE with an external DTD
    // reference the browser cannot resolve. DOMParser silently produces
    // a <parsererror> document instead of throwing — strip it first.
    text = text.replace(/<!DOCTYPE[^>]*>/g, "");
    const xml = new DOMParser().parseFromString(text, "text/xml");
    const parseErr = xml.querySelector("parsererror");
    if (parseErr) throw new Error("XML parse error: " + parseErr.textContent);

    const maplayer     = xml.getElementsByTagName("maplayer")[0];
    const geometryType = maplayer?.getAttribute("geometry") || "Point";
    const layerName    = xml.getElementsByTagName("layername")[0]?.textContent || "Layer";
    const layerOpacity = parseFloat(xml.getElementsByTagName("layerOpacity")[0]?.textContent ?? 1);
    const abstract      = xml.getElementsByTagName("abstract")[0]?.textContent?.trim() || "";

    const rawDatasource = xml.getElementsByTagName("datasource")[0]?.textContent?.trim() || "";
    const datasource     = cleanDatasource(rawDatasource);

    const mapTipEl   = xml.getElementsByTagName("mapTip")[0];
    const mapTipHtml = mapTipEl?.textContent?.trim() || "";

    // Display field from previewExpression (strips surrounding quotes).
    // Only simple "field" extraction is implemented — full QGIS
    // expression evaluation (concatenation, functions) is out of scope.
    const previewRaw   = xml.getElementsByTagName("previewExpression")[0]?.textContent || "";
    const previewField = (previewRaw.match(/"([^"]+)"/) || [])[1] || "";

    // ── Label config ──
    const labelingEl   = xml.getElementsByTagName("labeling")[0];
    const labelingType = labelingEl?.getAttribute("type");
    const hasLabeling  = labelingType === "simple";
    const labelsEnabled = hasLabeling &&
      (labelingEl.getAttribute("labelsEnabled") !== "0");

    let labelConfig = null;
    if (hasLabeling) {
      const ts = labelingEl.getElementsByTagName("text-style")[0];
      const tb = labelingEl.getElementsByTagName("text-buffer")[0];
      if (ts) {
        labelConfig = {
          fieldName:    ts.getAttribute("fieldName")  || "",
          fontSize:     parseFloat(ts.getAttribute("fontSize")  || 10),
          fontSizeUnit: ts.getAttribute("fontSizeUnit") || "Point",
          fontFamily:   ts.getAttribute("fontFamily") || "sans-serif",
          fontBold:     ts.getAttribute("fontBold")   === "1",
          fontItalic:   ts.getAttribute("fontItalic") === "1",
          textColor:    ts.getAttribute("textColor")  || "0,0,0,255",
          bufferDraw:   tb?.getAttribute("bufferDraw") === "1",
          bufferSize:   parseFloat(tb?.getAttribute("bufferSize") || 1) * MM_TO_PX,
          bufferColor:  tb?.getAttribute("bufferColor") || "255,255,255,255",
          geometryType, // stored so makeLabelStyle can choose placement
        };
      }
    }

    // Mutable state object — the style function holds a reference to
    // this object, and the host app's "toggle labels" UI mutates it.
    // Off by default; caller flips labelState.visible = true to enable.
    const labelState = { visible: false };

    // ── Renderer-level glow (polygon layers store it here, not in
    //    symbol layers — see parseGlowFromEffectStack note above) ──
    const rendererEffectStack = [...xml.getElementsByTagName("renderer-v2")]
      .flatMap(r => [...r.children])
      .find(c => c.tagName === "effect" && c.getAttribute("type") === "effectStack");
    const rendererGlow       = parseGlowFromEffectStack(rendererEffectStack);
    const rendererGlowStyles = makeGlowStyles(rendererGlow);

    const renderer     = xml.getElementsByTagName("renderer-v2")[0];
    const rendererType = renderer.getAttribute("type");
    const attribute     = renderer.getAttribute("attr") || "";
    const symbolsEl     = renderer.getElementsByTagName("symbols")[0];
    const styleCache    = {};

    await Promise.all([...symbolsEl.children].map(async sym => {
      if (sym.tagName !== "symbol") return;
      const symName = sym.getAttribute("name");
      const layerEl = sym.getElementsByTagName("layer")[0];
      if (!layerEl) return;
      const props = {};
      [...layerEl.getElementsByTagName("Option")].forEach(o => {
        if (o.getAttribute("name") && o.getAttribute("value"))
          props[o.getAttribute("name")] = o.getAttribute("value");
      });

      if (geometryType === "Point") {
        // QGIS XML order is bottom-to-top, same as OL's style-array
        // convention (last array element drawn last = on top).
        // Do NOT reverse — iterate in document order.
        const symLayerEls = [...sym.getElementsByTagName("layer")]
          .filter(lyr => lyr.parentNode === sym);
        const pointStyles = await Promise.all(
          symLayerEls.map(async lyr => {
            const lp = {};
            [...lyr.getElementsByTagName("Option")].forEach(o => {
              if (o.getAttribute("name") && o.getAttribute("value"))
                lp[o.getAttribute("name")] = o.getAttribute("value");
            });
            const img = await buildPointImage(lyr.getAttribute("class"), lp);
            return img ? new ol.style.Style({ image: img }) : null;
          })
        );
        styleCache[symName] = pointStyles.filter(Boolean);

      } else if (geometryType === "Line") {
        const parts = [];
        [...sym.getElementsByTagName("layer")].forEach(lyr => {
          if (lyr.parentElement.tagName !== "symbol") return;
          const lp = {};
          [...lyr.getElementsByTagName("Option")].forEach(o => {
            if (o.getAttribute("name") && o.getAttribute("value")) lp[o.getAttribute("name")] = o.getAttribute("value");
          });
          // Symbol-layer level glow (e.g. bike lanes)
          const esEl = [...lyr.children].find(c => c.tagName === "effect" && c.getAttribute("type") === "effectStack");
          const glow = parseGlowFromEffectStack(esEl);
          parts.push({ color: lp["line_color"], width: parseFloat(lp["line_width"] || 1),
            style: lp["line_style"] || "solid", customdash: lp["customdash"] || "",
            use_custom_dash: lp["use_custom_dash"] || "0", glow });
        });
        styleCache[symName] = makeLineStyle(parts);

      } else if (geometryType === "Polygon") {
        const polyStyles = [];
        [...sym.getElementsByTagName("layer")].forEach(lyr => {
          if (lyr.parentElement.tagName !== "symbol") return;
          const cls = lyr.getAttribute("class");
          const p   = {};
          [...lyr.getElementsByTagName("Option")].forEach(o => {
            if (o.getAttribute("name") && o.getAttribute("value"))
              p[o.getAttribute("name")] = o.getAttribute("value");
          });
          if (cls === "SimpleFill") {
            polyStyles.push(makePolygonStyle({
              fillColor:    p["color"]         || "255,255,255,255",
              outlineColor: p["outline_color"] || "0,0,0,255",
              outlineWidth: parseFloat(p["outline_width"] || 0.26),
              outlineStyle: p["outline_style"] || "solid",
            }));
          } else if (cls === "SimpleLine") {
            // SimpleLine as a symbol layer inside a polygon symbol =
            // QGIS's "Outline: Simple Line" sub-symbol — outline only,
            // no fill.
            polyStyles.push(new ol.style.Style({
              stroke: new ol.style.Stroke({
                color: parseQGISColor(p["line_color"] || "0,0,0,255"),
                width: parseFloat(p["line_width"] || 0.26) * MM_TO_PX,
              }),
            }));
          } else {
            console.warn(`[QLR Engine] Unhandled polygon layer class: "${cls}"`);
          }
        });
        styleCache[symName] = polyStyles.length === 1 ? polyStyles[0] : polyStyles;
      }
    }));

    // ── Base style function (without labels) ──
    const normalize = s => (s || "").trim().toLowerCase();
    let baseStyleFn;

    if (rendererType === "categorizedSymbol") {
      const categoryMap = {};
      [...renderer.getElementsByTagName("category")].forEach(cat => {
        const val = normalize(cat.getAttribute("value"));
        if (val) categoryMap[val] = cat.getAttribute("symbol");
      });
      const fallback = styleCache[Object.keys(styleCache).at(-1)];
      baseStyleFn = feature => styleCache[categoryMap[normalize(feature.get(attribute))]] || fallback;

    } else if (rendererType === "graduatedSymbol") {
      const ranges = [...renderer.getElementsByTagName("range")].map(r => ({
        lower: parseFloat(r.getAttribute("lower")), upper: parseFloat(r.getAttribute("upper")),
        symbol: r.getAttribute("symbol"),
      }));
      baseStyleFn = feature => {
        const v = parseFloat(feature.get(attribute));
        const r = ranges.find(r => v >= r.lower && v <= r.upper);
        return r ? styleCache[r.symbol] : new ol.style.Style();
      };

    } else {
      const single = styleCache["0"];
      baseStyleFn = () => single;
    }

    // ── Final style function: glow + base + optional labels ──
    const styleFunction = feature => {
      const base = [baseStyleFn(feature)].flat().filter(Boolean);
      const all  = [...rendererGlowStyles, ...base];
      if (labelState.visible && labelConfig) {
        const ls = makeLabelStyle(feature, labelConfig);
        if (ls) all.push(ls);
      }
      return all;
    };

    // ── Legend ──
    const legendItems = buildLegendItems(renderer, symbolsEl, rendererType, geometryType);

    // For point layers: extract the actual rendered OL canvas/image from
    // styleCache so the legend shows the real symbol, not an approximation.
    if (geometryType === "Point") {
      legendItems.forEach(item => {
        try {
          const styles = styleCache[item._symName];
          if (!styles?.length) return;

          // styles[last] = topmost rendered layer (OL draws last = on top)
          const imgStyle = styles[styles.length - 1].getImage();
          if (!imgStyle) return;

          // ol.style.Icon: getSrc() is always synchronous — no waiting
          // for OL's internal async image load needed.
          if (typeof imgStyle.getSrc === "function") {
            const src = imgStyle.getSrc();
            if (src) { item.swatch.canvasUrl = src; return; }
          }

          // ol.style.Circle / RegularShape: canvas is rendered synchronously
          imgStyle.load();
          const canvas = imgStyle.getImage(1);
          if (canvas instanceof HTMLCanvasElement) {
            item.swatch.canvasUrl = canvas.toDataURL();
          }
        } catch (e) { /* keep colored circle fallback */ }
        delete item._symName;
      });
    } else {
      legendItems.forEach(item => delete item._symName);
    }

    return {
      layerName, layerOpacity, geometryType, styleFunction,
      abstract, datasource, hasLabeling, labelsEnabled,
      labelConfig, labelState, mapTipHtml, previewField, legendItems,
    };
  }

  // ── ArcGIS FeatureServer pagination (OID-keyset) ──────────────────
  // More reliable than resultOffset, which some servers cap or ignore.
  // Not QLR-specific, but lives here since it solves the same class of
  // "silent truncation" problem this engine already cares about.

  async function fetchArcGISPaged(baseUrl, userWhere, onProgress) {
    const metaRes = await fetch(baseUrl + '?f=json');
    const meta    = await metaRes.json();
    const maxRecordCount = meta.maxRecordCount || 1000;
    const oidField = (meta.fields || []).find(f => f.type === 'esriFieldTypeOID')?.name || 'OBJECTID';

    let lastOID = 0;
    let allFeatures = [];
    let page = 0;

    while (true) {
      const whereClauses = [`${oidField} > ${lastOID}`];
      if (userWhere && userWhere.trim()) whereClauses.push(`(${userWhere})`);
      const where = whereClauses.join(' AND ');

      const url = baseUrl + '/query?' + new URLSearchParams({
        where,
        outFields: '*',
        f: 'geojson',
        outSR: '4326',
        orderByFields: `${oidField} ASC`,
        resultRecordCount: String(maxRecordCount),
      });

      const res = await fetch(url);
      const geojson = await res.json();
      const features = geojson.features || [];

      if (features.length === 0) break;

      allFeatures = allFeatures.concat(features);
      page++;
      if (onProgress) onProgress(allFeatures.length, page);

      const lastFeature = features[features.length - 1];
      const newOID = lastFeature.properties?.[oidField] ?? lastFeature.id;
      if (newOID === undefined || newOID <= lastOID) break;  // safety: avoid infinite loop
      lastOID = newOID;

      if (features.length < maxRecordCount) break;  // last page was partial
    }

    return { type: 'FeatureCollection', features: allFeatures };
  }

  // ── Public API ───────────────────────────────────────────────────
  return {
    parseQLR,
    buildSwatchSvg,
    fetchArcGISPaged,
    cleanDatasource,
    // Exposed for advanced/edge-case use by host apps (e.g. SVG admin docs)
    parseQGISColor,
    fontSizeToPx,
  };

})();