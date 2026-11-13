(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var SVG = "http://www.w3.org/2000/svg";
  var TEAL = [94, 234, 212];
  var AMBER = [251, 182, 94];

  /* Small deterministic generator, so every visitor sees the same decorative layouts. */
  function generator(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function svgNode(name, attributes, parent) {
    var node = document.createElementNS(SVG, name);
    Object.keys(attributes).forEach(function (key) { node.setAttribute(key, attributes[key]); });
    if (parent) { parent.appendChild(node); }
    return node;
  }

  function rgba(color, alpha) {
    return "rgba(" + color[0] + "," + color[1] + "," + color[2] + "," + alpha.toFixed(3) + ")";
  }

  /* The data files hold typed arrays as base64 text. */
  function bytes(text) {
    var raw = atob(text), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) { out[i] = raw.charCodeAt(i); }
    return out;
  }

  function onScreen(element) {
    var box = element.getBoundingClientRect();
    return box.bottom > 0 && box.top < window.innerHeight;
  }

  /* A slowly turning drawing of points and links in three dimensions, shaded by depth.
     The model holds x, y, z, color, dot (a radius factor, 0 for none), and links (index pairs).
     The turn, options.spin, is in radians a second. */
  function turntable(canvas, model, options) {
    var context = canvas.getContext("2d");
    var count = model.x.length, links = model.links, linkCount = links.length / 2;
    var px = new Float32Array(count), py = new Float32Array(count), depth = new Float32Array(count);
    /* Marks are drawn in batches by depth and color, far ones first. */
    var LEVELS = 10, shades = [], shade = new Uint8Array(count);
    for (var d = 0; d < count; d += 1) {
      var at = shades.indexOf(model.color[d]);
      if (at < 0) { at = shades.length; shades.push(model.color[d]); }
      shade[d] = at;
    }

    var width = 0, height = 0, scale = 1;
    function resize() {
      var ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth; height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      scale = Math.min(height / (2 * options.halfHeight), width / (2 * options.halfWidth));
    }

    var angle = options.angle, tilt = options.tilt, shown = reducedMotion ? count : 0;
    function draw() {
      var cosA = Math.cos(angle), sinA = Math.sin(angle), cosT = Math.cos(tilt), sinT = Math.sin(tilt);
      var camera = options.camera, cx = width / 2, cy = height / 2, reach = options.depth;
      for (var i = 0; i < count; i += 1) {
        var x = model.x[i] * cosA + model.z[i] * sinA;
        var z = model.z[i] * cosA - model.x[i] * sinA;
        var y = model.y[i] * cosT - z * sinT;
        var zz = model.y[i] * sinT + z * cosT;
        var perspective = camera / (camera - zz);
        px[i] = cx + x * perspective * scale;
        py[i] = cy + y * perspective * scale;
        depth[i] = zz;
      }
      var unit = Math.max(0.8, scale / options.unit), lines = [], dots = [], key, path, near;
      function layer(zz) {
        near = Math.min(1, Math.max(0, (zz + reach) / (2 * reach)));
        return Math.min(LEVELS - 1, Math.floor(near * LEVELS));
      }
      for (var k = 0; k < linkCount; k += 1) {
        var from = links[2 * k], to = links[2 * k + 1];
        if (to >= shown) { continue; }
        key = layer((depth[from] + depth[to]) / 2) * shades.length + shade[to];
        path = lines[key] || (lines[key] = new Path2D());
        path.moveTo(px[from], py[from]); path.lineTo(px[to], py[to]);
      }
      for (var p = 0; p < shown; p += 1) {
        if (!(model.dot[p] > 0)) { continue; }
        key = layer(depth[p]) * shades.length + shade[p];
        if (near < options.dotFrom) { continue; }
        var radius = model.dot[p] * (0.5 + 1.5 * near) * unit;
        path = dots[key] || (dots[key] = new Path2D());
        path.moveTo(px[p] + radius, py[p]); path.arc(px[p], py[p], radius, 0, 6.2832);
      }
      context.clearRect(-1, -1, width + 2, height + 2);
      context.lineCap = "round";
      for (var level = 0; level < LEVELS; level += 1) {
        var front = (level + 0.5) / LEVELS;
        context.lineWidth = options.linkWidth * (0.7 + 1.7 * front) * unit;
        for (var s = 0; s < shades.length; s += 1) {
          key = level * shades.length + s;
          if (lines[key]) { context.strokeStyle = rgba(shades[s], options.linkAlpha * (0.15 + 0.85 * front * front)); context.stroke(lines[key]); }
          if (dots[key]) { context.fillStyle = rgba(shades[s], options.dotAlpha * (0.26 + 0.74 * front)); context.fill(dots[key]); }
        }
      }
    }

    var running = false, visible = onScreen(canvas), dragging = false, lastX = 0, lastY = 0, began = 0, settle = 0, last = 0;
    function tick(now) {
      var step = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (!dragging) { angle += options.spin * step; }
      if (shown < count) {
        if (!began) { began = performance.now(); }
        shown = Math.ceil(count * Math.min(1, (performance.now() - began) / options.reveal));
      }
      draw();
      if (visible && !document.hidden && !reducedMotion) { requestAnimationFrame(tick); } else { running = false; }
    }
    function start() {
      if (reducedMotion || document.hidden) { shown = count; draw(); return; }
      if (visible && !running) {
        running = true; last = performance.now(); requestAnimationFrame(tick);
        /* A throttled tab may never run a frame, so finish a drawing that is on screen on a timer too. */
        clearTimeout(settle);
        settle = setTimeout(function () { if (shown < count && onScreen(canvas)) { shown = count; draw(); } }, options.reveal + 1200);
      }
    }

    /* The front of the drawing follows the pointer in both directions. */
    canvas.addEventListener("pointerdown", function (event) {
      dragging = true; lastX = event.clientX; lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", function (event) {
      if (!dragging) { return; }
      angle += (event.clientX - lastX) * 0.008;
      tilt = Math.max(-0.9, Math.min(0.9, tilt - (event.clientY - lastY) * 0.006));
      lastX = event.clientX; lastY = event.clientY;
      if (reducedMotion) { draw(); }
    });
    function release() { dragging = false; }
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);

    var resizeTimer = 0;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { resize(); draw(); }, 120);
    });
    document.addEventListener("visibilitychange", start);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) { start(); }
      }).observe(canvas);
    }
    resize();
    start();
  }

  /* Hero: the human proteome arranged by predicted interactions. Every point is a protein, laid
     out in three dimensions from its nearest neighbors, every branch joins two proteins the model
     expects to interact, and color marks the cluster a protein falls in. The drawing grows outward
     along the tree, then turns slowly. It is drawn with WebGL, where the graphics card turns every
     point and a frame costs the page almost nothing, and with the 2D canvas where WebGL is missing. */
  function initProteome(canvas) {
    var data = window.UNIVERSE;
    if (!data) { return; }
    var count = data.count, unit = data.unit;
    var points = new Int16Array(bytes(data.points).buffer), parent = new Uint16Array(bytes(data.parent).buffer);
    var cluster = bytes(data.cluster), groups = data.labels.length;
    /* Hues run around the wheel in the order that puts similar clusters side by side. */
    var hues = [[251, 182, 94], [253, 150, 90], [252, 129, 129], [244, 114, 182], [240, 171, 252], [196, 181, 253], [169, 156, 245], [129, 140, 248],
      [96, 165, 250], [125, 211, 252], [103, 232, 249], [94, 234, 212], [52, 211, 153], [134, 239, 172], [190, 242, 100], [253, 224, 71]];
    var palette = data.order.map(function (position) { return hues[position % hues.length]; });
    /* A branch much longer than its neighbors joins two far regions, and it is left undrawn. */
    var drawn = new Uint8Array(count), longest = data.longest * unit;
    for (var e = 1; e < count; e += 1) {
      var q = parent[e], ax = points[3 * e] - points[3 * q], ay = points[3 * e + 1] - points[3 * q + 1], az = points[3 * e + 2] - points[3 * q + 2];
      drawn[e] = ax * ax + ay * ay + az * az < longest * longest ? 1 : 0;
    }
    var LEVELS = 6;
    var px = new Float32Array(count), py = new Float32Array(count), level = new Uint8Array(count);
    var width = 0, height = 0, scale = 1, ratio = 1, narrow = false, camera = 3.6 * unit;
    /* The drawing turns about its vertical axis, so its widest reach on screen is set by each
       point's distance from that axis, a little enlarged by perspective when the point is near.
       Sizing to that reach keeps every protein inside the canvas at every angle. */
    var girth = 0;
    for (var g = 0; g < count; g += 1) {
      var gx = points[3 * g], gy = points[3 * g + 1], gz = points[3 * g + 2], rho = Math.sqrt(gx * gx + gz * gz);
      for (var turn = 0; turn < 1.3; turn += 0.2) {
        var across = rho * Math.cos(turn), toward = Math.sqrt(gy * gy + rho * rho * Math.sin(turn) * Math.sin(turn));
        girth = Math.max(girth, across * camera / (camera - toward));
      }
    }

    var angle = 0.4, tilt = 0.24, shown = reducedMotion ? count : 0;
    /* Where each protein falls on screen, for the pointer and for the 2D drawing. */
    function project() {
      var cosA = Math.cos(angle), sinA = Math.sin(angle), cosT = Math.cos(tilt), sinT = Math.sin(tilt);
      var cx = width / 2, cy = height / 2;
      for (var i = 0; i < shown; i += 1) {
        var x0 = points[3 * i], y0 = points[3 * i + 1], z0 = points[3 * i + 2];
        var x = x0 * cosA + z0 * sinA, z = z0 * cosA - x0 * sinA;
        var y = y0 * cosT - z * sinT, zz = y0 * sinT + z * cosT;
        var perspective = camera / (camera - zz);
        px[i] = cx + x * perspective * scale; py[i] = cy + y * perspective * scale;
        var near = (zz / unit + 1) / 2;
        level[i] = near <= 0 ? 0 : near >= 1 ? LEVELS - 1 : Math.floor(near * LEVELS);
      }
    }

    /* WebGL: the points and the branches sit on the graphics card once, and a frame sends it the
       two angles. Nearness sets the size and the strength of each mark, as in the 2D drawing. */
    function glPainter() {
      var gl = null;
      try { gl = canvas.getContext("webgl", { antialias: true, premultipliedAlpha: true }); } catch (error) { gl = null; }
      if (!gl) { return null; }
      var VERTEX = [
        "attribute vec3 place;",
        "attribute vec3 hue;",
        "uniform vec2 turn;",
        "uniform vec2 lean;",
        "uniform vec2 view;",
        "uniform vec2 lens;",
        "uniform vec2 dot;",
        "uniform vec3 ink;",
        "varying vec4 tint;",
        "void main() {",
        "  float x = place.x * turn.x + place.z * turn.y;",
        "  float z = place.z * turn.x - place.x * turn.y;",
        "  float y = place.y * lean.x - z * lean.y;",
        "  float depth = place.y * lean.y + z * lean.x;",
        "  float zoom = lens.x / (lens.x - depth);",
        "  float near = clamp((depth / lens.y + 1.0) / 2.0, 0.0, 1.0);",
        "  gl_Position = vec4(x * zoom * view.x, -y * zoom * view.y, 0.0, 1.0);",
        "  gl_PointSize = dot.x + dot.y * near;",
        "  float alpha = ink.x + ink.y * mix(near, near * near, ink.z);",
        "  tint = vec4(hue * alpha, alpha);",
        "}"].join("\n");
      var FRAGMENT = "precision mediump float;\nvarying vec4 tint;\nvoid main() { gl_FragColor = tint; }";
      var colors = new Uint8Array(4 * count), pairs = [], before = new Uint32Array(count + 1);
      for (var n = 0; n < count; n += 1) {
        var shade = palette[cluster[n]];
        colors[4 * n] = shade[0]; colors[4 * n + 1] = shade[1]; colors[4 * n + 2] = shade[2]; colors[4 * n + 3] = 255;
        before[n] = pairs.length / 2;
        if (n > 0 && drawn[n]) { pairs.push(parent[n], n); }
      }
      before[count] = pairs.length / 2;
      var uniform = {}, live = false;
      function shader(kind, source) {
        var made = gl.createShader(kind);
        gl.shaderSource(made, source); gl.compileShader(made);
        return gl.getShaderParameter(made, gl.COMPILE_STATUS) ? made : null;
      }
      function build() {
        var vertex = shader(gl.VERTEX_SHADER, VERTEX), fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
        if (!vertex || !fragment) { return false; }
        var program = gl.createProgram();
        gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { return false; }
        gl.useProgram(program);
        var place = gl.getAttribLocation(program, "place"), hue = gl.getAttribLocation(program, "hue");
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, points, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(place); gl.vertexAttribPointer(place, 3, gl.SHORT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(hue); gl.vertexAttribPointer(hue, 3, gl.UNSIGNED_BYTE, true, 4, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(pairs), gl.STATIC_DRAW);
        ["turn", "lean", "view", "lens", "dot", "ink"].forEach(function (name) { uniform[name] = gl.getUniformLocation(program, name); });
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);
        return true;
      }
      live = build();
      if (!live) { return null; }
      var painter = {
        sharp: 2,
        resize: function () { gl.viewport(0, 0, canvas.width, canvas.height); },
        draw: function () {
          if (!live) { return; }
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.uniform2f(uniform.turn, Math.cos(angle), Math.sin(angle));
          gl.uniform2f(uniform.lean, Math.cos(tilt), Math.sin(tilt));
          gl.uniform2f(uniform.view, 2 * scale / width, 2 * scale / height);
          gl.uniform2f(uniform.lens, camera, unit);
          gl.uniform2f(uniform.dot, ratio * (narrow ? 0.8 : 1), ratio * 1.5);
          gl.uniform3f(uniform.ink, 0.12, 0.56, 1);
          gl.drawElements(gl.LINES, 2 * before[shown], gl.UNSIGNED_SHORT, 0);
          gl.uniform3f(uniform.ink, 0.22, 0.72, 0);
          gl.drawArrays(gl.POINTS, 0, shown);
        }
      };
      canvas.addEventListener("webglcontextlost", function (event) { event.preventDefault(); live = false; });
      canvas.addEventListener("webglcontextrestored", function () {
        live = build();
        if (live) { painter.resize(); painter.draw(); }
      });
      return painter;
    }

    /* The 2D canvas: lines and points go down in batches by color and depth, because there are
       too many to style one at a time. */
    function flatPainter() {
      var context = canvas.getContext("2d");
      return {
        sharp: 1.5,
        resize: function () { context.setTransform(ratio, 0, 0, ratio, 0, 0); },
        draw: function () {
          project();
          var lines = [], dots = [], key, path;
          for (var n = 1; n < shown; n += 1) {
            key = level[n] * groups + cluster[n];
            var size = (narrow ? 0.7 : 0.9) + 0.32 * level[n];
            path = dots[key] || (dots[key] = new Path2D());
            path.rect(px[n] - size / 2, py[n] - size / 2, size, size);
            if (!drawn[n]) { continue; }
            path = lines[key] || (lines[key] = new Path2D());
            path.moveTo(px[parent[n]], py[parent[n]]); path.lineTo(px[n], py[n]);
          }
          context.clearRect(-1, -1, width + 2, height + 2);
          context.lineCap = "butt";
          /* Far layers first, so the near side of the cloud sits on top. */
          for (var depth = 0; depth < LEVELS; depth += 1) {
            var front = (depth + 0.5) / LEVELS;
            context.lineWidth = (narrow ? 0.4 : 0.5) + 0.5 * front;
            for (var c = 0; c < groups; c += 1) {
              key = depth * groups + c;
              if (lines[key]) { context.strokeStyle = rgba(palette[c], 0.1 + 0.5 * front * front); context.stroke(lines[key]); }
              if (dots[key]) { context.fillStyle = rgba(palette[c], 0.22 + 0.72 * front); context.fill(dots[key]); }
            }
          }
        }
      };
    }

    var painter = glPainter();
    if (!painter) {
      /* A canvas that has been asked for WebGL cannot give a 2D context, so the fallback starts from a fresh one. */
      var fresh = canvas.cloneNode(false);
      canvas.parentNode.replaceChild(fresh, canvas);
      canvas = fresh;
      painter = flatPainter();
    }
    function resize() {
      ratio = Math.min(window.devicePixelRatio || 1, painter.sharp);
      width = canvas.clientWidth; height = canvas.clientHeight; narrow = width < 520;
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      scale = Math.min((width - 8) / (2 * girth), (height - 8) / (2.09 * unit));
      painter.resize();
    }
    function draw() { painter.draw(); }

    /* Name the cluster under the pointer. */
    var tag = document.getElementById("cosmos-tag");
    function name(event) {
      if (!tag) { return; }
      project();
      var box = canvas.getBoundingClientRect(), mx = event.clientX - box.left, my = event.clientY - box.top;
      var best = -1, bestScore = 144;
      for (var i = 0; i < shown; i += 1) {
        var dx = px[i] - mx, dy = py[i] - my, score = dx * dx + dy * dy - 12 * level[i];
        if (score < bestScore) { bestScore = score; best = i; }
      }
      if (best < 0) { tag.hidden = true; return; }
      tag.hidden = false;
      tag.textContent = data.labels[cluster[best]];
      tag.style.color = rgba(palette[cluster[best]], 1);
      tag.style.left = Math.min(width - 12, Math.max(12, mx)) + "px";
      tag.style.top = (my - 18) + "px";
    }

    /* The turn is set in radians a second, so it looks the same at any frame rate. */
    var REVEAL = 4200, SPIN = 0.084;
    var running = false, visible = onScreen(canvas), dragging = false, lastX = 0, lastY = 0, began = 0, settle = 0, last = 0;
    function tick(now) {
      var step = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (!dragging) { angle += SPIN * step; }
      if (shown < count) {
        if (!began) { began = performance.now(); }
        var t = Math.min(1, (performance.now() - began) / REVEAL);
        shown = Math.ceil(count * t * t * (3 - 2 * t));
      }
      draw();
      if (visible && !document.hidden && !reducedMotion) { requestAnimationFrame(tick); } else { running = false; }
    }
    function start() {
      if (reducedMotion || document.hidden) { shown = count; draw(); return; }
      if (visible && !running) {
        running = true; last = performance.now(); requestAnimationFrame(tick);
        /* A throttled tab may never run a frame, so finish a drawing that is on screen on a timer too. */
        clearTimeout(settle);
        settle = setTimeout(function () { if (shown < count && onScreen(canvas)) { shown = count; draw(); } }, REVEAL + 1200);
      }
    }
    canvas.addEventListener("pointerdown", function (event) {
      dragging = true; lastX = event.clientX; lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      if (tag) { tag.hidden = true; }
    });
    canvas.addEventListener("pointermove", function (event) {
      if (!dragging) { if (event.pointerType === "mouse") { name(event); } return; }
      angle += (event.clientX - lastX) * 0.008;
      tilt = Math.max(-0.9, Math.min(0.9, tilt - (event.clientY - lastY) * 0.006));
      lastX = event.clientX; lastY = event.clientY;
      if (reducedMotion) { draw(); }
    });
    function release() { dragging = false; }
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("pointerleave", function () { if (tag) { tag.hidden = true; } });

    var resizeTimer = 0;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { resize(); draw(); }, 120);
    });
    document.addEventListener("visibilitychange", start);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) { start(); }
      }).observe(canvas);
    }
    resize();
    start();
  }

  /* Design thread: the C-alpha trace of PDB 1YY9, EGFR with the cetuximab Fab. */
  function initStructure(canvas) {
    var data = window.COMPLEX_1YY9;
    if (!data) { return; }
    var chainColor = { A: TEAL, C: AMBER, D: [253, 208, 150] };
    var model = { x: [], y: [], z: [], color: [], dot: [], links: [] };
    data.chains.forEach(function (chain) {
      var first = model.x.length;
      for (var k = 0; k < chain.ca.length; k += 3) {
        model.x.push(chain.ca[k] / 10); model.y.push(-chain.ca[k + 1] / 10); model.z.push(chain.ca[k + 2] / 10);
        model.color.push(chainColor[chain.id]); model.dot.push(1);
      }
      for (var i = first + 1; i < model.x.length; i += 1) {
        var dx = model.x[i] - model.x[i - 1], dy = model.y[i] - model.y[i - 1], dz = model.z[i] - model.z[i - 1];
        if (dx * dx + dy * dy + dz * dz < 4.3 * 4.3) { model.links.push(i - 1, i); }
      }
    });
    turntable(canvas, model, {
      halfWidth: 64, halfHeight: 93, depth: 62, camera: 520, unit: 3,
      angle: 0.9, tilt: 0.1, spin: 0.156, reveal: 2200,
      linkAlpha: 0.92, linkWidth: 1, dotAlpha: 0.95, dotFrom: 0.35
    });
  }

  /* Thread 01: embeddings that separate by species, which is the shortcut. */
  function drawClusters(svg) {
    var random = generator(7);
    var palette = [TEAL, AMBER, [169, 156, 245], [125, 211, 252]];
    var centers = [[72, 56], [208, 50], [118, 122], [232, 118]];
    centers.forEach(function (center, index) {
      var color = palette[index];
      svgNode("ellipse", { cx: center[0], cy: center[1], rx: 44, ry: 34, fill: rgba(color, 0.05), stroke: rgba(color, 0.3), "stroke-dasharray": "2 5" }, svg);
      for (var n = 0; n < 34; n += 1) {
        var radius = Math.sqrt(-2 * Math.log(1 - random() * 0.999)) * 15;
        var theta = random() * 6.2832;
        svgNode("circle", {
          cx: (center[0] + radius * Math.cos(theta) * 1.25).toFixed(1),
          cy: (center[1] + radius * Math.sin(theta)).toFixed(1),
          r: (1.3 + random() * 1.6).toFixed(1),
          fill: rgba(color, 0.45 + random() * 0.5)
        }, svg);
      }
    });
  }

  /* Thread 02: one attention head split into a past triangle and a future triangle. */
  function drawTriangles(svg) {
    var size = 12, cell = 13.5, gap = 3.5, pitch = cell + gap, left = (292 - size * pitch + gap) / 2;
    for (var i = 0; i < size; i += 1) {
      for (var j = 0; j < size; j += 1) {
        var distance = Math.abs(i - j);
        var fill = i === j ? "rgba(241,243,246,0.92)" : rgba(i > j ? TEAL : AMBER, Math.max(0.12, 0.85 - distance * 0.065));
        svgNode("rect", { x: (left + j * pitch).toFixed(1), y: (4 + i * pitch).toFixed(1), width: cell, height: cell, rx: 3, fill: fill }, svg);
      }
    }
  }

  /* Thread 03: masked diffusion on the first 72 residues of human HSP90-alpha (UniProt P07900). */
  var HSP90 = "MPEETQTQDQPMEEEEVETFAFQAEIAQLMSLIINTFYSNKEIFLRELISNSSDALDKIRYESLTDPSKLDS";
  function initSequence(holder) {
    if (!holder) { return; }
    var spans = HSP90.split("").map(function (letter) {
      var span = document.createElement("span");
      span.dataset.letter = letter;
      holder.appendChild(span);
      return span;
    });
    var random = generator(11);
    function mask(span) { span.textContent = "·"; span.className = "m"; }
    function show(span, fresh) { span.textContent = span.dataset.letter; span.className = fresh ? "new" : ""; }
    if (reducedMotion) {
      spans.forEach(function (span) { if (random() < 0.4) { mask(span); } else { show(span, false); } });
      return;
    }
    spans.forEach(mask);
    var hold = 0;
    setInterval(function () {
      if (document.hidden) { return; }
      if (hold > 0) { hold -= 1; if (hold === 0) { spans.forEach(mask); } return; }
      var masked = spans.filter(function (span) { return span.className === "m"; });
      spans.forEach(function (span) { if (span.className === "new") { span.className = ""; } });
      if (masked.length === 0) { hold = 22; return; }
      for (var n = 0; n < 3 && masked.length > 0; n += 1) {
        show(masked.splice(Math.floor(random() * masked.length), 1)[0], true);
      }
    }, 130);
  }

  /* Rule 30 from one cell, exact: the row is padded so no boundary reaches the window. */
  function drawRule30(canvas) {
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    var width = canvas.clientWidth, height = canvas.clientHeight, cell = 2;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    var context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = getComputedStyle(canvas).color;
    var columns = Math.ceil(width / cell), rows = Math.ceil(height / cell), pad = rows + 2, total = columns + 2 * pad;
    var row = new Uint8Array(total), next = new Uint8Array(total);
    row[pad + (columns >> 1)] = 1;
    for (var y = 0; y < rows; y += 1) {
      for (var x = 0; x < columns; x += 1) {
        if (row[pad + x]) { context.fillRect(x * cell, y * cell, cell - 0.4, cell - 0.4); }
      }
      for (var i = 1; i < total - 1; i += 1) { next[i] = row[i - 1] ^ (row[i] | row[i + 1]); }
      var swap = row; row = next; next = swap;
    }
  }

  /* Company: E. coli K-12 against the human cell, drawn from the data of Synthyra's public
     Atlas pages. Every point is a protein in its cell compartment. The membrane proteins that
     hold a top-scored contact across the two cells sit on the sides that face each other, so
     each contact crosses only the gap between the cells and covers nothing inside them. The
     contacts stay undrawn until the reader asks for them, and moving signals show the network. */
  function initInteractome(canvas) {
    var data = window.INTERACTOME;
    if (!data) { return; }
    var sides = [data.ecoli, data.human].map(function (organism, index) {
      return {
        points: new Int16Array(bytes(organism.points).buffer), terms: bytes(organism.terms),
        intra: new Uint16Array(bytes(organism.intra).buffer), gates: new Uint16Array(bytes(organism.gates).buffer),
        flow: new Uint16Array(bytes(organism.flow).buffer),
        count: organism.drawn, half: organism.half, membrane: organism.membrane,
        center: index === 0 ? 0.16 : 0.7, maxWidth: index === 0 ? 0.2 : 0.52, maxHeight: index === 0 ? 0.78 : 0.88
      };
    });
    var edges = new Uint16Array(bytes(data.edges).buffer), edgeCount = data.edgeCount;
    var warm = [[236, 160, 96], AMBER];
    var cool = [TEAL, [169, 156, 245], [125, 211, 252], [134, 239, 172], [94, 200, 234], [196, 181, 253], [240, 171, 252], [103, 232, 249]];
    var context = canvas.getContext("2d");
    var layer = document.createElement("canvas"), ink = layer.getContext("2d");
    var width = 0, height = 0, ratio = 1;
    /* Without motion there are no signals, so the still drawing shows the contacts instead. */
    var contacts = reducedMotion;

    function place(side) {
      side.scale = Math.min(width * side.maxWidth / (2 * side.half[0]), height * side.maxHeight / (2 * side.half[1]));
      side.cx = width * side.center; side.cy = height * 0.48;
    }
    function spot(side, i) {
      return [side.cx + side.points[2 * i] * side.scale, side.cy + side.points[2 * i + 1] * side.scale];
    }
    /* A contact leaves and arrives level, so the threads run side by side across the gap. */
    function curveOf(edge) {
      var a = spot(sides[0], edges[2 * edge]), b = spot(sides[1], edges[2 * edge + 1]);
      var reach = Math.max(1, b[0] - a[0]) * 0.46;
      return [a[0], a[1], a[0] + reach, a[1], b[0] - reach, b[1], b[0], b[1]];
    }
    function paint() {
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth; height = canvas.clientHeight;
      canvas.width = layer.width = Math.round(width * ratio); canvas.height = layer.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      ink.setTransform(ratio, 0, 0, ratio, 0, 0);
      ink.clearRect(-1, -1, width + 2, height + 2);
      sides.forEach(place);
      var narrow = width < 640;
      ink.lineCap = "round";

      /* Inside each cell: a share of its own strongest contacts, kept short so they read as a web. */
      sides.forEach(function (side, index) {
        if (!contacts) { return; }
        ink.strokeStyle = rgba(index === 0 ? AMBER : TEAL, 1);
        ink.globalAlpha = index === 0 ? 0.42 : 0.3;
        ink.lineWidth = narrow ? 0.4 : 0.6;
        ink.beginPath();
        for (var k = 0; k < side.intra.length; k += 2) {
          var a = spot(side, side.intra[k]), b = spot(side, side.intra[k + 1]);
          ink.moveTo(a[0], a[1]); ink.lineTo(b[0], b[1]);
        }
        ink.stroke();
      });

      /* Every protein, quiet, with the membrane a little brighter so each cell keeps its outline. */
      var dot = narrow ? 0.9 : 1.25;
      sides.forEach(function (side, index) {
        var palette = index === 0 ? warm : cool;
        for (var region = 0; region < palette.length; region += 1) {
          ink.fillStyle = rgba(palette[region], 1);
          ink.globalAlpha = region === side.membrane ? 0.5 : (index === 0 ? 0.34 : 0.26);
          for (var i = 0; i < side.count; i += 1) {
            if (side.terms[i] !== region) { continue; }
            var p = spot(side, i);
            ink.fillRect(p[0] - dot / 2, p[1] - dot / 2, dot, dot);
          }
        }
      });

      /* The contacts between the two membranes, and the proteins that hold them. */
      var blend = ink.createLinearGradient(sides[0].cx, 0, sides[1].cx - sides[1].half[0] * sides[1].scale, 0);
      blend.addColorStop(0, rgba(AMBER, 1)); blend.addColorStop(1, rgba(TEAL, 1));
      ink.strokeStyle = blend;
      ink.globalAlpha = narrow ? 0.2 : 0.26;
      ink.lineWidth = narrow ? 0.45 : 0.7;
      for (var n = 0; contacts && n < edgeCount; n += 1) {
        var c = curveOf(n);
        ink.beginPath(); ink.moveTo(c[0], c[1]); ink.bezierCurveTo(c[2], c[3], c[4], c[5], c[6], c[7]); ink.stroke();
      }
      ink.globalAlpha = 1;
      sides.forEach(function (side, index) {
        ink.fillStyle = rgba(index === 0 ? [255, 214, 150] : [170, 246, 232], 1);
        for (var g = 0; g < side.gates.length; g += 1) {
          var p = spot(side, side.gates[g]);
          ink.beginPath(); ink.arc(p[0], p[1], narrow ? 1.1 : 1.9, 0, 6.2832); ink.fill();
        }
      });
    }

    /* Signals. No contact is drawn until a signal runs along it. A signal starts at one protein
       inside the bacterium and spreads to that protein's partners, one contact at a time, until
       it reaches the membrane. There it crosses several contacts to the human membrane, and each
       landing fans out along contacts that lead into the cell. A contact stays lit for a moment
       after a signal has passed, so each signal leaves its tree behind it, and only a few signals
       run at once. */
    var random = generator(61);
    var GLOW = [196, 250, 238], WARM = [255, 214, 150];
    var flows = sides.map(function (side) {
      var up = {}, down = {}, depth = {};
      for (var k = 0; k < side.flow.length; k += 2) {
        var parent = side.flow[k], child = side.flow[k + 1];
        up[child] = parent; (down[parent] = down[parent] || []).push(child);
        depth[child] = (depth[parent] || 0) + 1;
      }
      return { up: up, down: down, depth: depth };
    });
    /* A signal starts two or more contacts away from the membrane, so it has somewhere to spread. */
    var crossings = {}, origins = [];
    for (var e = 0; e < edgeCount; e += 1) { (crossings[edges[2 * e]] = crossings[edges[2 * e]] || []).push(e); }
    Object.keys(flows[0].depth).forEach(function (key) { if (flows[0].depth[key] >= 2) { origins.push(+key); } });
    function pick(list) { return list[Math.floor(random() * list.length)]; }
    /* Up to `most` entries of a list, in random order. */
    function some(list, most) {
      var pool = list.slice(), out = [];
      while (pool.length && out.length < most) { out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]); }
      return out;
    }
    function along(c, t) {
      var u = 1 - t, a = u * u * u, b = 3 * u * u * t, g = 3 * u * t * t, h = t * t * t;
      return [a * c[0] + b * c[2] + g * c[4] + h * c[6], a * c[1] + b * c[3] + g * c[5] + h * c[7]];
    }
    /* A contact inside a cell is a shallow arc between its two proteins. */
    function arc(a, b) {
      var lean = (random() < 0.5 ? -0.16 : 0.16), mx = (a[0] + b[0]) / 2 - (b[1] - a[1]) * lean, my = (a[1] + b[1]) / 2 + (b[0] - a[0]) * lean;
      return function (t) {
        var u = 1 - t;
        return [u * u * a[0] + 2 * u * t * mx + t * t * b[0], u * u * a[1] + 2 * u * t * my + t * t * b[1]];
      };
    }
    var E_HOP = 620, CROSS = 1500, H_HOP = 640, FAN = [3, 2, 2, 1];
    function launch(now) {
      var legs = [], length = 0, narrow = width < 640;
      function leg(path, start, time, first, last, weight, ring) {
        legs.push({ path: path, start: start, time: time, first: first, last: last, weight: weight, ring: ring });
        length = Math.max(length, start + time);
      }
      /* Inside the bacterium the signal climbs toward its membrane protein and spills sideways on the way. */
      var flow = flows[0], origin = pick(origins), seen = {}, wave = [[origin, 0]], gate = -1, gateAt = 0;
      seen[origin] = true;
      for (var step = flow.depth[origin]; step > 0; step -= 1) {
        var next = [];
        wave.forEach(function (item) {
          var node = item[0], targets = some((flow.down[node] || []).filter(function (child) { return !seen[child]; }), 2);
          if (flow.up[node] !== undefined && !seen[flow.up[node]]) { targets.push(flow.up[node]); }
          targets.forEach(function (to) {
            var atGate = flow.depth[to] === undefined;
            seen[to] = true;
            leg(arc(spot(sides[0], node), spot(sides[0], to)), item[1], E_HOP, AMBER, atGate ? WARM : AMBER, 1, atGate);
            next.push([to, item[1] + E_HOP]);
            if (atGate) { gate = to; gateAt = item[1] + E_HOP; }
          });
        });
        wave = next;
      }
      /* Across the gap, then into the human cell along contacts that lead away from the membrane. */
      var human = flows[1];
      some(crossings[gate], narrow ? 2 : 3).forEach(function (edge, index) {
        var c = curveOf(edge), start = gateAt + 160 * index, front = [[edges[2 * edge + 1], start + CROSS]], level = 0;
        leg(function (t) { return along(c, t); }, start, CROSS, WARM, TEAL, 1.3, true);
        while (front.length && level < FAN.length) {
          var after = [];
          front.forEach(function (item) {
            some(human.down[item[0]] || [], FAN[level]).forEach(function (child) {
              leg(arc(spot(sides[1], item[0]), spot(sides[1], child)), item[1], H_HOP, level === 0 ? TEAL : GLOW, GLOW, Math.pow(0.85, level), !human.down[child] || level === FAN.length - 1);
              after.push([child, item[1] + H_HOP]);
            });
          });
          front = after; level += 1;
        }
      });
      return { born: now, legs: legs, length: length, from: spot(sides[0], origin) };
    }
    function ease(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }
    function shade(first, last, t) {
      return [Math.round(first[0] + (last[0] - first[0]) * t), Math.round(first[1] + (last[1] - first[1]) * t), Math.round(first[2] + (last[2] - first[2]) * t)];
    }
    var signals = [], nextAt = 0, TAIL = 0.6, AFTER = 1500, PIECES = 9;
    function frame(now) {
      now = now || performance.now();
      context.clearRect(-1, -1, width + 2, height + 2);
      context.drawImage(layer, 0, 0, canvas.width / ratio, canvas.height / ratio);
      if (reducedMotion) { return; }
      var narrow = width < 640, size = narrow ? 0.6 : 1;
      signals = signals.filter(function (signal) { return now - signal.born < signal.length + AFTER; });
      if (now >= nextAt && signals.length < (narrow ? 2 : 3)) {
        signals.push(launch(now));
        nextAt = now + 1500 + 1200 * random();
      }
      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";
      signals.forEach(function (signal) {
        var age = now - signal.born;
        /* The protein a signal starts from flashes once. */
        if (age < 900) {
          var born = age / 900;
          context.strokeStyle = rgba(WARM, 0.6 * (1 - born) * (1 - born));
          context.lineWidth = 1 * size;
          context.beginPath(); context.arc(signal.from[0], signal.from[1], (2 + 12 * ease(born)) * size, 0, 6.2832); context.stroke();
          context.fillStyle = rgba(WARM, 0.9 * (1 - born));
          context.beginPath(); context.arc(signal.from[0], signal.from[1], 2.4 * size, 0, 6.2832); context.fill();
        }
        signal.legs.forEach(function (leg) {
          var u = (age - leg.start) / leg.time;
          if (u <= 0) { return; }
          var since = age - leg.start - leg.time, fade = since <= 0 ? 1 : 1 - since / AFTER;
          if (fade <= 0) { return; }
          var head = ease(u), last = leg.path(0), i, at;
          /* The stretch already traveled stays lit and then fades. */
          context.strokeStyle = rgba(shade(leg.first, leg.last, 0.5), 0.36 * leg.weight * fade * fade);
          context.lineWidth = 0.9 * size;
          context.beginPath(); context.moveTo(last[0], last[1]);
          for (i = 1; i <= PIECES; i += 1) { at = leg.path(head * i / PIECES); context.lineTo(at[0], at[1]); }
          context.stroke();
          if (u < 1 + TAIL) {
            /* The light itself is a short stretch that brightens toward its head. */
            var tail = ease(u - TAIL);
            last = leg.path(tail);
            for (i = 1; i <= PIECES; i += 1) {
              var t = tail + (head - tail) * i / PIECES, share = i / PIECES;
              at = leg.path(t);
              context.strokeStyle = rgba(shade(leg.first, leg.last, t), Math.min(1, 0.9 * leg.weight) * share * share);
              context.lineWidth = (0.5 + 1.5 * share * leg.weight) * size;
              context.beginPath(); context.moveTo(last[0], last[1]); context.lineTo(at[0], at[1]); context.stroke();
              last = at;
            }
            if (u < 1) {
              var color = shade(leg.first, leg.last, head);
              context.fillStyle = rgba(color, Math.min(1, 0.95 * leg.weight));
              context.beginPath(); context.arc(last[0], last[1], (1.2 + 1.1 * leg.weight) * size, 0, 6.2832); context.fill();
              context.fillStyle = rgba(color, 0.14 * leg.weight);
              context.beginPath(); context.arc(last[0], last[1], 8 * leg.weight * size, 0, 6.2832); context.fill();
            }
          }
          /* The protein a signal reaches lights up, and a ring spreads where a path crosses or ends. */
          if (since > 0) {
            var end = leg.path(1), q = since / AFTER;
            context.fillStyle = rgba(leg.last, Math.min(1, 0.85 * leg.weight) * fade);
            context.beginPath(); context.arc(end[0], end[1], (1.3 + 1.2 * leg.weight) * size, 0, 6.2832); context.fill();
            if (leg.ring) {
              context.strokeStyle = rgba(leg.last, 0.4 * leg.weight * fade * fade);
              context.lineWidth = 0.9 * size;
              context.beginPath(); context.arc(end[0], end[1], (2 + 12 * ease(q)) * size, 0, 6.2832); context.stroke();
            }
          }
        });
      });
      context.globalCompositeOperation = "source-over";
    }

    var running = false, visible = false, ready = false;
    function tick() {
      frame();
      if (visible && !document.hidden && !reducedMotion) { requestAnimationFrame(tick); } else { running = false; }
    }
    function start() {
      if (!visible) { return; }
      if (!ready) { paint(); ready = true; frame(); }
      if (reducedMotion || document.hidden) { context.clearRect(-1, -1, width + 2, height + 2); context.drawImage(layer, 0, 0, canvas.width / ratio, canvas.height / ratio); return; }
      if (!running) { running = true; requestAnimationFrame(tick); }
    }
    var resizeTimer = 0;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (ready) { signals = []; paint(); frame(); } }, 160);
    });
    var toggle = document.getElementById("interactome-contacts");
    if (toggle) {
      var label = function () {
        toggle.setAttribute("aria-pressed", String(contacts));
        toggle.textContent = contacts ? "Hide contacts" : "Show contacts";
      };
      label();
      toggle.addEventListener("click", function () {
        contacts = !contacts;
        label();
        if (ready) { paint(); frame(); }
      });
    }
    document.addEventListener("visibilitychange", start);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        start();
      }, { rootMargin: "240px 0px" }).observe(canvas);
    }
    visible = onScreen(canvas);
    start();
  }

  /* Company: swap the drawing for Synthyra's live interactive map when the reader asks for it. */
  var LIVE_WIDTH = 1600, LIVE_STACKED = 880;
  function initLiveMap(button) {
    var stage = document.getElementById(button.getAttribute("aria-controls"));
    button.addEventListener("click", function () {
      var frame = document.createElement("iframe");
      frame.src = button.dataset.src;
      frame.title = button.dataset.title;
      frame.loading = "eager";
      frame.setAttribute("referrerpolicy", "no-referrer");
      var note = document.createElement("span");
      note.className = "loading";
      note.textContent = "Loading the live map from synthyra.com";
      frame.addEventListener("load", function () { frame.classList.add("in"); note.remove(); });
      stage.classList.add("live");
      stage.appendChild(note);
      stage.appendChild(frame);
      button.hidden = true;
      /* Synthyra's page is laid out for a full window, and at the width of this stage its panels
         crowd the plot. The frame is given the layout that suits the stage and scaled down to fit.
         A wide stage gets the page's side-by-side layout at a width that leaves the cell room, a
         middling one gets the page's stacked layout, and a phone gets the stacked layout a little
         reduced. */
      var fit = function () {
        var wide = stage.clientWidth, tall = stage.clientHeight;
        var layout = wide >= 1000 ? LIVE_WIDTH : wide >= 640 ? Math.max(wide, LIVE_STACKED) : wide / 0.78;
        var shrink = Math.min(1, wide / layout);
        frame.style.width = Math.ceil(wide / shrink) + "px";
        frame.style.height = Math.ceil(tall / shrink) + "px";
        frame.style.transform = "scale(" + shrink + ")";
      };
      fit();
      window.addEventListener("resize", fit);
    });
  }

  /* Writing: one sketch for each essay, shown beside the list. The sketch follows the essay under
     the pointer or the keyboard focus, and it moves on by itself while the reader is elsewhere.
     Every sketch is drawn from a seeded generator and a rule, and none of them is data. */
  function initEssayArt(canvas) {
    var essays = Array.prototype.slice.call(document.querySelectorAll(".essay[data-art]"));
    if (!essays.length) { return; }
    var context = canvas.getContext("2d"), width = 0, height = 0;
    var VIOLET = [169, 156, 245], random = generator(29);

    /* Streaks that leave one point and gain speed as they go. Each one dims over the last
       stretch of its run and ends where it would meet the frame, so nothing bright touches an edge. */
    function speed() {
      var streaks = [];
      for (var i = 0; i < 150; i += 1) { streaks.push({ angle: random() * 6.2832, at: random(), pace: 0.5 + random(), warm: random() < 0.42 }); }
      return function (time, step) {
        var cx = width / 2, cy = height * 0.52, reach = Math.sqrt(width * width + height * height) * 0.56;
        var surge = 1 + 0.55 * Math.sin(time * 0.45);
        context.lineCap = "round";
        streaks.forEach(function (streak) {
          var x = Math.cos(streak.angle), y = Math.sin(streak.angle);
          /* How far this streak runs before the frame, as a share of the reach. */
          var edge = Math.min((x > 0 ? width - cx : cx) / Math.max(0.000001, Math.abs(x)), (y > 0 ? height - cy : cy) / Math.max(0.000001, Math.abs(y))) / reach;
          var pace = streak.pace * surge * (0.05 + 1.5 * streak.at * streak.at);
          streak.at += step * pace;
          if (streak.at >= edge) { streak.at = 0.02 + 0.05 * random(); streak.angle = random() * 6.2832; return; }
          var tail = Math.max(0.012, streak.at - pace * 0.13), fade = Math.min(1, (edge - streak.at) / (0.3 * edge));
          context.strokeStyle = rgba(streak.warm ? AMBER : TEAL, 0.85 * Math.min(1, streak.at * 1.7) * fade);
          context.lineWidth = 0.6 + 1.7 * streak.at;
          context.beginPath();
          context.moveTo(cx + x * tail * reach, cy + y * tail * reach);
          context.lineTo(cx + x * streak.at * reach, cy + y * streak.at * reach);
          context.stroke();
        });
      };
    }

    /* The cube of four dimensions, turned in three planes and projected twice. */
    function tesseract() {
      var corners = [], links = [];
      for (var i = 0; i < 16; i += 1) {
        corners.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
        for (var bit = 1; bit < 16; bit *= 2) { if (!(i & bit)) { links.push([i, i | bit]); } }
      }
      function turn(p, a, b, angle) {
        var c = Math.cos(angle), s = Math.sin(angle), u = p[a], v = p[b];
        p[a] = u * c - v * s; p[b] = u * s + v * c;
      }
      return function (time) {
        var size = Math.min(width, height) * 0.27;
        var flat = corners.map(function (corner) {
          var p = corner.slice();
          turn(p, 0, 3, time * 0.31); turn(p, 1, 2, time * 0.22); turn(p, 2, 3, time * 0.17);
          var inner = 2.2 / (3.2 - p[3]), outer = 3.2 / (4.4 - p[2] * inner);
          return [width / 2 + p[0] * inner * outer * size, height / 2 + p[1] * inner * outer * size, (p[3] + 2) / 4];
        });
        context.lineCap = "round";
        links.forEach(function (link) {
          var a = flat[link[0]], b = flat[link[1]], near = Math.max(0, Math.min(1, (a[2] + b[2]) / 2));
          context.strokeStyle = rgba([Math.round(VIOLET[0] + (TEAL[0] - VIOLET[0]) * near), Math.round(VIOLET[1] + (TEAL[1] - VIOLET[1]) * near), Math.round(VIOLET[2] + (TEAL[2] - VIOLET[2]) * near)], 0.25 + 0.6 * near);
          context.lineWidth = 0.7 + 1.3 * near;
          context.beginPath(); context.moveTo(a[0], a[1]); context.lineTo(b[0], b[1]); context.stroke();
        });
        flat.forEach(function (p) {
          var near = Math.max(0, Math.min(1, p[2]));
          context.fillStyle = rgba([226, 250, 244], 0.35 + 0.6 * near);
          context.beginPath(); context.arc(p[0], p[1], 1.4 + 2 * near, 0, 6.2832); context.fill();
        });
      };
    }

    /* Three patterns on a grid that wraps around. A cell copies itself onto a neighbor it beats. */
    function selection() {
      var COLS = 40, cells = new Uint8Array(COLS * COLS), colors = [TEAL, AMBER, VIOLET];
      for (var i = 0; i < cells.length; i += 1) { cells[i] = Math.floor(random() * 3); }
      function mix(times) {
        for (var n = 0; n < times; n += 1) {
          var a = Math.floor(random() * cells.length), way = Math.floor(random() * 4), x = a % COLS, y = (a - x) / COLS;
          if (way === 0) { x = (x + 1) % COLS; } else if (way === 1) { x = (x + COLS - 1) % COLS; } else if (way === 2) { y = (y + 1) % COLS; } else { y = (y + COLS - 1) % COLS; }
          var b = y * COLS + x;
          if ((cells[a] + 1) % 3 === cells[b]) { cells[b] = cells[a]; }
        }
      }
      mix(cells.length * 400);
      return function (time, step) {
        mix(Math.round(cells.length * step * 9));
        var size = width / COLS, rows = Math.min(COLS, Math.ceil(height / size)), dot = size * 0.3;
        for (var kind = 0; kind < 3; kind += 1) {
          context.fillStyle = rgba(colors[kind], 0.82);
          context.beginPath();
          for (var y = 0; y < rows; y += 1) {
            for (var x = 0; x < COLS; x += 1) {
              if (cells[y * COLS + x] === kind) {
                context.moveTo((x + 0.5) * size + dot, (y + 0.5) * size);
                context.arc((x + 0.5) * size, (y + 0.5) * size, dot, 0, 6.2832);
              }
            }
          }
          context.fill();
        }
      };
    }

    /* Signals that wander a network, with a ring each time one runs back into its own path. */
    function loop() {
      var nodes = [], links = [], near = [], tries = 0, i, j;
      while (nodes.length < 52 && tries < 6000) {
        var angle = random() * 6.2832, far = Math.sqrt(random()), spot = [Math.cos(angle) * far, Math.sin(angle) * far], free = true;
        for (i = 0; i < nodes.length; i += 1) {
          if (Math.abs(nodes[i][0] - spot[0]) < 0.17 && Math.abs(nodes[i][1] - spot[1]) < 0.17) { free = false; }
        }
        if (free) { nodes.push(spot); near.push([]); }
        tries += 1;
      }
      for (i = 0; i < nodes.length; i += 1) {
        var others = [];
        for (j = 0; j < nodes.length; j += 1) {
          if (j !== i) { others.push([Math.pow(nodes[i][0] - nodes[j][0], 2) + Math.pow(nodes[i][1] - nodes[j][1], 2), j]); }
        }
        others.sort(function (a, b) { return a[0] - b[0]; });
        for (j = 0; j < 3; j += 1) {
          var other = others[j][1];
          if (near[i].indexOf(other) < 0) { near[i].push(other); near[other].push(i); links.push([i, other]); }
        }
      }
      var lit = nodes.map(function () { return -9; }), rings = [];
      var walkers = [TEAL, VIOLET, AMBER].map(function (color, index) {
        var from = Math.floor(random() * nodes.length);
        return { color: color, from: from, to: near[from][0], part: index / 3, path: [from], trail: [] };
      });
      return function (time, step) {
        var cx = width / 2, cy = height / 2, reach = Math.min(width, height) * 0.42;
        function at(node) { return [cx + nodes[node][0] * reach, cy + nodes[node][1] * reach]; }
        context.lineCap = "round";
        context.strokeStyle = rgba([150, 165, 190], 0.13);
        context.lineWidth = 0.8;
        context.beginPath();
        links.forEach(function (link) { var a = at(link[0]), b = at(link[1]); context.moveTo(a[0], a[1]); context.lineTo(b[0], b[1]); });
        context.stroke();
        walkers.forEach(function (walker) {
          walker.part += step * 1.7;
          if (walker.part >= 1) {
            walker.part -= 1;
            walker.trail.push([walker.from, walker.to, time]);
            if (walker.trail.length > 16) { walker.trail.shift(); }
            /* The signal has been at this node before, so its path has closed on itself. */
            if (walker.path.indexOf(walker.to) >= 0) { rings.push([walker.to, time, walker.color]); }
            walker.path.push(walker.to);
            if (walker.path.length > 12) { walker.path.shift(); }
            lit[walker.to] = time;
            var onward = near[walker.to].filter(function (node) { return node !== walker.from; });
            var next = onward.length ? onward[Math.floor(random() * onward.length)] : walker.from;
            walker.from = walker.to; walker.to = next;
          }
          walker.trail.forEach(function (edge) {
            var fade = 1 - (time - edge[2]) / 5.5;
            if (fade <= 0) { return; }
            var a = at(edge[0]), b = at(edge[1]);
            context.strokeStyle = rgba(walker.color, 0.6 * fade);
            context.lineWidth = 1.4;
            context.beginPath(); context.moveTo(a[0], a[1]); context.lineTo(b[0], b[1]); context.stroke();
          });
          var a = at(walker.from), b = at(walker.to), x = a[0] + (b[0] - a[0]) * walker.part, y = a[1] + (b[1] - a[1]) * walker.part;
          context.strokeStyle = rgba(walker.color, 0.75);
          context.lineWidth = 1.6;
          context.beginPath(); context.moveTo(a[0], a[1]); context.lineTo(x, y); context.stroke();
          context.fillStyle = rgba(walker.color, 0.95);
          context.beginPath(); context.arc(x, y, 3, 0, 6.2832); context.fill();
          context.fillStyle = rgba(walker.color, 0.16);
          context.beginPath(); context.arc(x, y, 10, 0, 6.2832); context.fill();
        });
        nodes.forEach(function (node, index) {
          var glow = Math.max(0, 1 - (time - lit[index]) / 1.6), p = at(index);
          context.fillStyle = rgba([226, 250, 244], 0.3 + 0.6 * glow);
          context.beginPath(); context.arc(p[0], p[1], 1.8 + 1.6 * glow, 0, 6.2832); context.fill();
        });
        rings = rings.filter(function (ring) { return time - ring[1] < 1.5; });
        rings.forEach(function (ring) {
          var age = (time - ring[1]) / 1.5, p = at(ring[0]);
          context.strokeStyle = rgba(ring[2], 0.7 * (1 - age) * (1 - age));
          context.lineWidth = 1.2;
          context.beginPath(); context.arc(p[0], p[1], 4 + 26 * age, 0, 6.2832); context.stroke();
        });
      };
    }

    /* A sketch is built the first time its essay comes into focus. */
    var makers = { speed: speed, tesseract: tesseract, selection: selection, loop: loop }, arts = {};

    var active = -1, drawing = null, held = false, since = 0, clock = 0, last = 0, swapTimer = 0;
    var running = false, visible = onScreen(canvas);
    function resize() {
      var ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth; height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    function render(step) {
      if (!drawing) { return; }
      clock += step;
      context.clearRect(-1, -1, width + 2, height + 2);
      context.globalCompositeOperation = "lighter";
      drawing(clock, step);
      context.globalCompositeOperation = "source-over";
    }
    function show(index) {
      var name = essays[index].dataset.art;
      drawing = arts[name] || (arts[name] = makers[name]());
      /* Sizing the canvas again hands the new sketch a bitmap with nothing of the last one on it. */
      resize();
      canvas.style.opacity = 1;
      if (!running) { render(0); }
    }
    function select(index) {
      since = performance.now();
      if (index === active) { return; }
      var first = active < 0;
      active = index;
      essays.forEach(function (essay, i) { essay.classList.toggle("lit", i === index); });
      clearTimeout(swapTimer);
      if (first) { show(index); return; }
      canvas.style.opacity = 0;
      swapTimer = setTimeout(function () { show(index); }, 220);
    }
    function tick(now) {
      var step = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (!held && now - since > 7000) { select((active + 1) % essays.length); }
      render(step);
      if (visible && !document.hidden) { requestAnimationFrame(tick); } else { running = false; }
    }
    function start() {
      if (reducedMotion || document.hidden || !visible || running) { return; }
      running = true; last = performance.now(); since = last;
      requestAnimationFrame(tick);
    }
    essays.forEach(function (essay, index) {
      essay.addEventListener("pointerenter", function (event) { if (event.pointerType === "mouse") { held = true; select(index); } });
      essay.addEventListener("pointerleave", function () { held = false; since = performance.now(); });
      essay.addEventListener("focus", function () { held = true; select(index); });
      essay.addEventListener("blur", function () { held = false; since = performance.now(); });
    });
    var resizeTimer = 0;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { resize(); if (!running) { render(0); } }, 140);
    });
    document.addEventListener("visibilitychange", start);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        start();
      }, { rootMargin: "120px 0px" }).observe(canvas);
    }
    resize();
    select(0);
    start();
  }

  /* Academic work: filter the list by kind, and keep it short until the reader asks for all of it. */
  function initAcademic(list) {
    var items = Array.prototype.slice.call(list.children);
    var filters = Array.prototype.slice.call(document.querySelectorAll(".filters button"));
    var more = document.getElementById("academic-more");
    var kind = "all", expanded = false, limit = 10;
    function apply() {
      var matched = 0, total = 0;
      items.forEach(function (item) {
        var match = kind === "all" || item.dataset.kind === kind;
        if (match) { total += 1; }
        var show = match && (expanded || matched < limit);
        if (show) { matched += 1; }
        item.hidden = !show;
      });
      more.hidden = expanded || total <= limit;
      more.textContent = "Show all " + total;
    }
    filters.forEach(function (button) {
      button.addEventListener("click", function () {
        kind = button.dataset.kind; expanded = false;
        filters.forEach(function (other) { other.setAttribute("aria-pressed", other === button ? "true" : "false"); });
        apply();
      });
    });
    more.addEventListener("click", function () { expanded = true; apply(); });
    apply();
  }

  /* Essay page: a field of unread points where a few light up one at a time. */
  function initUniverse(canvas) {
    var context = canvas.getContext("2d");
    var random = generator(41);
    var stars = [];
    for (var n = 0; n < 1500; n += 1) {
      stars.push({ x: random(), y: random(), r: 0.5 + random() * 0.9, a: 0.08 + random() * 0.22, lit: n % 37 === 0 ? 1 : 0, amber: random() < 0.3 });
    }
    var width = 0, height = 0;
    function paint() {
      var ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth; height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(-1, -1, width + 2, height + 2);
      stars.forEach(function (star) {
        var x = star.x * width, y = star.y * height;
        if (star.lit > 0) {
          var color = star.amber ? AMBER : TEAL;
          context.fillStyle = rgba(color, 0.12 * star.lit);
          context.beginPath(); context.arc(x, y, 7, 0, 6.2832); context.fill();
          context.fillStyle = rgba(color, 0.95 * star.lit);
          context.beginPath(); context.arc(x, y, star.r + 0.9, 0, 6.2832); context.fill();
        } else {
          context.fillStyle = "rgba(255,255,255," + star.a.toFixed(3) + ")";
          context.beginPath(); context.arc(x, y, star.r, 0, 6.2832); context.fill();
        }
      });
    }
    paint();
    window.addEventListener("resize", paint);
    if (reducedMotion) { return; }
    var budget = 90;
    setInterval(function () {
      if (document.hidden || budget <= 0) { return; }
      var star = stars[Math.floor(random() * stars.length)];
      if (star.lit === 0) { star.lit = 1; budget -= 1; paint(); }
    }, 420);
  }

  /* Essay page: how far the reader is through the article. */
  function initProgress(bar) {
    var article = document.querySelector("article.essay-body");
    if (!article) { return; }
    function update() {
      var box = article.getBoundingClientRect();
      var total = box.height - window.innerHeight * 0.6;
      var done = Math.min(1, Math.max(0, -box.top / total));
      bar.style.transform = "scaleX(" + done.toFixed(4) + ")";
    }
    window.addEventListener("scroll", update, { passive: true });
    update();
  }

  var cosmos = document.getElementById("cosmos");
  if (cosmos) { initProteome(cosmos); }
  var structure = document.getElementById("structure");
  if (structure) { initStructure(structure); }
  var clusters = document.getElementById("viz-clusters");
  if (clusters) { drawClusters(clusters); }
  var triangles = document.getElementById("viz-triangles");
  if (triangles) { drawTriangles(triangles); }
  initSequence(document.getElementById("viz-sequence"));
  var rule30 = document.getElementById("rule30");
  if (rule30) { drawRule30(rule30); }
  var interactome = document.getElementById("interactome");
  if (interactome) { initInteractome(interactome); }
  var live = document.getElementById("interactome-live");
  if (live) { initLiveMap(live); }
  var essayArt = document.getElementById("essay-canvas");
  if (essayArt) { initEssayArt(essayArt); }
  var academic = document.getElementById("academic-list");
  if (academic) { initAcademic(academic); }
  var universe = document.getElementById("universe");
  if (universe) { initUniverse(universe); }
  var progress = document.getElementById("progress");
  if (progress) { initProgress(progress); }

  /* Cards: a glow that follows the pointer. */
  document.querySelectorAll(".glow").forEach(function (card) {
    card.addEventListener("pointermove", function (event) {
      var box = card.getBoundingClientRect();
      card.style.setProperty("--mx", (event.clientX - box.left) + "px");
      card.style.setProperty("--my", (event.clientY - box.top) + "px");
    });
  });

  /* Navigation: a stronger border once scrolled, and the current section highlighted. */
  var nav = document.querySelector(".nav");
  function onScroll() { nav.classList.toggle("scrolled", window.scrollY > 8); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  var links = Array.prototype.slice.call(document.querySelectorAll(".nav-links a[href^='#']"));
  var byId = {};
  links.forEach(function (link) { byId[link.getAttribute("href").slice(1)] = link; });
  if ("IntersectionObserver" in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) { return; }
        links.forEach(function (link) { link.classList.remove("active"); });
        var link = byId[entry.target.dataset.nav || entry.target.id];
        if (link) { link.classList.add("active"); }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    document.querySelectorAll("main section[id]").forEach(function (section) { spy.observe(section); });

    var reveal = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("in"); reveal.unobserve(entry.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".reveal").forEach(function (element) { reveal.observe(element); });
  } else {
    document.querySelectorAll(".reveal").forEach(function (element) { element.classList.add("in"); });
  }
})();
