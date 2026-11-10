// 分群套餐：K-means、階層式分群（Ward）、DBSCAN。演算法在 src/algos/cluster.js。
(function () {
  'use strict';
  var App = window.App, U = App.U, ML = window.ML;

  function xRole() {
    return { key: 'x', label: '用來分群的欄位（可複選）', type: 'num', multi: true, min: 2, max: 6, guess: ['最近購買天數', '購買次數', '平均客單'] };
  }
  function gcolor(g) { return App.colors[g % App.colors.length]; }
  function rawOf(ctx, xs) { return xs.map(function (c) { return ctx.col(c); }); }

  // 每群的人數、原始單位平均、標準化後平均（標準化後的平均，就是和全體平均差了幾個標準差）
  function groupStats(Z, raw, lab, K) {
    var n = Z.length, p = raw.length, i, j, g, size = [], sumR = [], sumZ = [], allR = [];
    for (g = 0; g < K; g++) { size.push(0); sumR.push(new Array(p).fill(0)); sumZ.push(new Array(p).fill(0)); }
    for (j = 0; j < p; j++) allR.push(ML.mean(raw[j]));
    for (i = 0; i < n; i++) {
      g = lab[i];
      if (g < 0) continue;   // 落單者（-1）不算進任何一群
      size[g]++;
      for (j = 0; j < p; j++) { sumR[g][j] += raw[j][i]; sumZ[g][j] += Z[i][j]; }
    }
    var meanR = [], meanZ = [];
    for (g = 0; g < K; g++) {
      meanR.push(sumR[g].map(function (v) { return v / size[g]; }));
      meanZ.push(sumZ[g].map(function (v) { return v / size[g]; }));
    }
    return { n: n, K: K, size: size, meanR: meanR, meanZ: meanZ, allR: allR };
  }

  function groupTable(xs, st, title) {
    var head = ['群', '人數', '占比'].concat(xs.map(function (c) { return c + ' 平均'; })), rows = [], g;
    for (g = 0; g < st.K; g++) {
      rows.push(['第 ' + (g + 1) + ' 群', U.fmt(st.size[g]), U.pct(st.size[g] / st.n)].concat(st.meanR[g].map(function (v) { return U.fmt(v, 2); })));
    }
    rows.push(['全體', U.fmt(st.n), U.pct(1)].concat(st.allR.map(function (v) { return U.fmt(v, 2); })));
    return { title: title, head: head, rows: rows };
  }

  // 挑出和全體平均差最多個標準差的欄位，寫成「高於／低於平均」
  function describeGroup(xs, st, g) {
    var best = 0, q;
    for (q = 1; q < xs.length; q++) if (Math.abs(st.meanZ[g][q]) > Math.abs(st.meanZ[g][best])) best = q;
    var z = st.meanZ[g][best];
    return '第 ' + (g + 1) + ' 群（' + U.fmt(st.size[g]) + ' 人）在「' + xs[best] + '」上' + (z >= 0 ? '高於' : '低於') + '平均（群平均 ' + U.fmt(st.meanR[g][best], 2) + '，全體 ' + U.fmt(st.allR[best], 2) + '）';
  }
  function readingOf(xs, st) {
    var s = '最大的' + describeGroup(xs, st, 0) + '。';
    if (st.K > 1) s += '最小的' + describeGroup(xs, st, st.K - 1) + '。';
    return s;
  }

  function groupLegend(K) {
    var out = [], g;
    for (g = 0; g < K; g++) out.push({ label: '第 ' + (g + 1) + ' 群', color: gcolor(g) });
    return out;
  }

  // 樹狀圖版面：只畫最上層 show 次合併；更底下的子樹畫成一個末端（末端高度＝子樹自己的合併距離）
  function layoutTree(merges, n, show) {
    var M = merges.length, top = Math.max(0, M - show), leaves = 0, segs = [];
    function build(id) {
      if (id < n) return { x: leaves++, y: 0 };
      var m = id - n;
      if (m < top) return { x: leaves++, y: merges[m].dist };
      var L = build(merges[m].a), R = build(merges[m].b), node = { x: (L.x + R.x) / 2, y: merges[m].dist };
      segs.push({ t: 'h', y: node.y, x0: L.x, x1: R.x });
      segs.push({ t: 'v', x: L.x, y0: L.y, y1: node.y });
      segs.push({ t: 'v', x: R.x, y0: R.y, y1: node.y });
      return node;
    }
    var root = build(n + M - 1);
    return { segs: segs, leaves: leaves, top: root.y };
  }

  // rev：目前畫到的高度（由下往上長出來）
  function drawTree(g, P, lay, rev, color, lw) {
    g.save(); g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round';
    g.beginPath();
    lay.segs.forEach(function (s) {
      if (s.t === 'h') {
        if (s.y > rev) return;
        g.moveTo(P.sx(s.x0), P.sy(s.y)); g.lineTo(P.sx(s.x1), P.sy(s.y));
      } else {
        if (s.y0 > rev) return;
        g.moveTo(P.sx(s.x), P.sy(s.y0)); g.lineTo(P.sx(s.x), P.sy(Math.min(s.y1, rev)));
      }
    });
    g.stroke(); g.restore();
  }

  function ring(g, x, y, r, color, alpha, lw) {
    if (alpha <= 0) return;
    g.save(); g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = lw || 2;
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.stroke(); g.restore();
  }

  // ---------- 套餐 A：K-means ----------
  App.register({
    id: 'kmeans', cat: 'cluster', needs: 'customer',
    zh: 'K-means 分群', en: 'k-means clustering',
    ask: '我的顧客有哪幾種？', starter: true,
    blurb: '指定要分幾群。會員分級',
    question: '想把客戶分成幾群，每一群各有什麼特徵？',
    demo: 'members',
    pipeline: ['把每欄換成同一把尺（標準化）', '隨機起點跑 10 次，取分得最緊的一次', '每位會員歸到最近的群中心，反覆調整', '比較分 2 到 8 群，哪一種分得最開'],
    roles: [xRole()],
    params: [{ key: 'k', label: '分成幾群', type: 'range', min: 2, max: 8, step: 1, value: 4 }],
    minRows: 20, maxRows: 2000,
    verified: 'K-means 的分群、慣性與輪廓係數，已用 scikit-learn 核對。',
    run: function (ctx) {
      var xs = ctx.cols.x, k = ctx.params.k, n = ctx.n;
      if (k > n) throw new Error('可用的資料只有 ' + n + ' 列，少於要分的 ' + k + ' 群。請把「分成幾群」調小。');
      var raw = rawOf(ctx, xs), Z = ML.standardize(ctx.X(xs)).Z;
      var km = ML.kmeans(Z, k, { seed: 42, nInit: 10, maxIter: 100 });
      var rl = ML.relabelBySize(km.labels), lab = rl.labels, K = rl.sizes.length;
      var st = groupStats(Z, raw, lab, K);
      var sil = ML.silhouette(Z, lab), curve = [], kk;
      for (kk = 2; kk <= 8; kk++) curve.push(ML.silhouette(Z, ML.kmeans(Z, kk, { seed: 42, nInit: 10, maxIter: 100 }).labels));

      var pa = xs[0], pb = xs[1], ca = raw[0], cb = raw[1];
      var ea = U.extent(ca), eb = U.extent(cb);
      var mx = st.allR[0], my = st.allR[1];
      var lo = Math.min(0, Math.min.apply(null, curve) - .05), hi = Math.max(.1, Math.max.apply(null, curve) + .05);
      var xk = [0, 1, 2, 3, 4, 5, 6];

      return {
        note: '標準化後分群，共 ' + n + ' 列參與分群。',
        metrics: [
          { label: '輪廓係數', value: U.fmt(sil, 2), hint: '越接近 1，群和群分得越開' },
          { label: '最大群', value: U.fmt(st.size[0]) + ' 人', hint: '第 1 群，占 ' + U.pct(st.size[0] / n) },
          { label: '最小群', value: U.fmt(st.size[K - 1]) + ' 人', hint: '第 ' + K + ' 群，人數太少時要留意' }
        ],
        charts: [{
          title: '分群結果：' + pa + ' 與 ' + pb, ratio: .62,
          draw: function (g, w, h, t) {
            var T = App.theme();
            var P = App.plot(g, w, h, { xmin: ea[0], xmax: ea[1], ymin: eb[0], ymax: eb[1], xlabel: pa, ylabel: pb });
            P.axes();
            var a = U.ease(U.seg(t, 0, .4)), b = U.ease(U.seg(t, .4, 1));
            P.dots(ca, cb, { color: T.muted, alpha: .8 * a * (1 - b), r: 3.4 });
            P.dots(ca, cb, { color: function (i) { return gcolor(lab[i]); }, alpha: .85 * b, r: 3.4 });
            if (t >= .4) {
              var fa = U.ease(U.seg(t, .4, .5)), q;
              for (q = 0; q < K; q++) {
                var cx = mx + (st.meanR[q][0] - mx) * b, cy = my + (st.meanR[q][1] - my) * b;
                g.save(); g.globalAlpha = fa;
                g.beginPath(); g.arc(P.sx(cx), P.sy(cy), 8.5, 0, 6.2832);
                g.fillStyle = gcolor(q); g.fill();
                g.lineWidth = 2.4; g.strokeStyle = T.ink; g.stroke();
                g.restore();
              }
              P.legend(groupLegend(K));
            }
          }
        }, {
          title: '分幾群比較好', ratio: .6,
          caption: '虛線是目前選的群數。越高代表群和群分得越開。',
          draw: function (g, w, h, t) {
            var T = App.theme();
            var P = App.plot(g, w, h, { xmin: 0, xmax: 6, ymin: lo, ymax: hi, xlabel: '分成幾群', ylabel: '輪廓係數', xcats: ['2', '3', '4', '5', '6', '7', '8'], yfmt: function (v) { return v.toFixed(2); } });
            P.axes();
            if (t > 0) P.line(xk, curve, { frac: Math.max(.02, U.ease(U.seg(t, 0, .8))), color: App.colors[0], width: 2.4 });
            P.dots(xk, curve, { color: App.colors[0], r: 4, alpha: U.seg(t, .5, .9) });
            P.vline(k - 2, { color: T.ink, width: 1.2 });
          }
        }],
        reading: readingOf(xs, st),
        caution: '群是電腦依數字相近程度分出來的，不是現成的客戶類型；換一個群數，分法就會跟著變，資料少時群的位置也不穩。',
        action: '本週挑最小的那一群，把名單拉出來看看他們有什麼共同點，再決定要不要單獨聯絡。',
        table: groupTable(xs, st, '各群摘要（人數、占比、各欄平均）')
      };
    },
    // 卡片縮圖：三群點由灰色轉成群色，中心點從中間移到群的位置
    thumb: function (g, w, h, t) {
      var T = App.theme(), r = ML.rng(21), P = App.plot(g, w, h, { bare: true, xmin: 0, xmax: 1, ymin: 0, ymax: 1 });
      var cs = [[.22, .3], [.74, .32], [.48, .76]], xs = [], ys = [], lb = [], sx3 = [0, 0, 0], sy3 = [0, 0, 0], cnt = [0, 0, 0], i, c;
      for (i = 0; i < 36; i++) {
        c = i % 3;
        var px = U.clamp(cs[c][0] + (r() - .5) * .34, .04, .96), py = U.clamp(cs[c][1] + (r() - .5) * .34, .04, .96);
        xs.push(px); ys.push(py); lb.push(c);
        sx3[c] += px; sy3[c] += py; cnt[c]++;
      }
      var rad = Math.max(1.8, w / 60), a = U.ease(U.seg(t, 0, .4)), b = U.ease(U.seg(t, .4, 1));
      P.dots(xs, ys, { color: T.muted, alpha: .8 * a * (1 - b), r: rad });
      P.dots(xs, ys, { color: function (j) { return gcolor(lb[j]); }, alpha: .85 * b, r: rad });
      if (t >= .4) {
        for (c = 0; c < 3; c++) {
          var cx = .5 + (sx3[c] / cnt[c] - .5) * b, cy = .5 + (sy3[c] / cnt[c] - .5) * b;
          g.save(); g.globalAlpha = U.seg(t, .4, .5);
          g.beginPath(); g.arc(P.sx(cx), P.sy(cy), Math.max(3.5, w / 28), 0, 6.2832);
          g.fillStyle = gcolor(c); g.fill(); g.lineWidth = 1.6; g.strokeStyle = T.ink; g.stroke(); g.restore();
        }
      }
    }
  });

  // ---------- 套餐 B：階層式分群 ----------
  App.register({
    id: 'hier', cat: 'cluster', needs: 'customer',
    zh: '階層式分群', en: 'hierarchical clustering',
    ask: '顧客該分成幾種？', advanced: true,
    blurb: '先看樹狀圖再決定幾群。不確定群數時',
    question: '不知道該分幾群的時候，怎麼從樹狀圖看出合適的群數？',
    demo: 'members',
    pipeline: ['把每欄換成同一把尺（標準化）', '每次把最相近的兩群併在一起，直到剩一群', '在你選的高度切一刀，得到幾群', '畫出樹狀圖，並算輪廓係數'],
    roles: [xRole()],
    params: [{ key: 'k', label: '在哪裡切（切成幾群）', type: 'range', min: 2, max: 8, step: 1, value: 4 }],
    minRows: 20, maxRows: 600,
    verified: '階層式分群的合併距離與切割結果，已用 scipy 核對。',
    run: function (ctx) {
      var xs = ctx.cols.x, k = ctx.params.k, n = ctx.n;
      if (k > n) throw new Error('可用的資料只有 ' + n + ' 列，少於要切成的 ' + k + ' 群。請把「在哪裡切」調小。');
      var raw = rawOf(ctx, xs), Z = ML.standardize(ctx.X(xs)).Z;
      var merges = ML.hclust(Z);
      var rl = ML.relabelBySize(ML.cutTree(merges, n, k)), lab = rl.labels, K = rl.sizes.length;
      var st = groupStats(Z, raw, lab, K);
      var sil = ML.silhouette(Z, lab);
      var sortedD = merges.map(function (m) { return m.dist; }).sort(function (x, y) { return x - y; });
      var cutY = (sortedD[n - k - 1] + sortedD[n - k]) / 2;
      var lay = layoutTree(merges, n, 30), maxY = lay.top * 1.05;

      var pa = xs[0], pb = xs[1], ca = raw[0], cb = raw[1];
      var ea = U.extent(ca), eb = U.extent(cb);

      return {
        note: '標準化後分群，共 ' + n + ' 列參與分群。樹狀圖只畫最上層 30 次合併。',
        metrics: [
          { label: '輪廓係數', value: U.fmt(sil, 2), hint: '越接近 1，群和群分得越開' },
          { label: '最大群', value: U.fmt(st.size[0]) + ' 人', hint: '第 1 群，占 ' + U.pct(st.size[0] / n) },
          { label: '最小群', value: U.fmt(st.size[K - 1]) + ' 人', hint: '第 ' + K + ' 群，人數太少時要留意' }
        ],
        charts: [{
          title: '樹狀圖（最上層 30 次合併）', ratio: .6,
          caption: '橫線往下切，切到哪裡就分成幾群。虛線是目前選的切點。',
          draw: function (g, w, h, t) {
            var T = App.theme();
            var P = App.plot(g, w, h, { xmin: -.5, xmax: lay.leaves - .5, ymin: 0, ymax: maxY, xlabel: '每個末端是一位會員或一小群', ylabel: '合併距離', xcats: [], yfmt: function (v) { return U.fmt(v, 1); } });
            P.axes();
            drawTree(g, P, lay, U.ease(t) * lay.top, T.ink, 1.6);
            var fa = U.seg(t, .7, 1);
            if (fa > 0) {
              g.save(); g.globalAlpha = fa;
              P.hline(cutY, { color: T.bad, width: 1.5, dash: [5, 4] });
              P.text(lay.leaves - .5, cutY, '切成 ' + k + ' 群', { align: 'right', base: 'bottom', dy: -3, size: 11, color: T.bad });
              g.restore();
            }
          }
        }, {
          title: '分群結果：' + pa + ' 與 ' + pb, ratio: .62,
          draw: function (g, w, h, t) {
            var P = App.plot(g, w, h, { xmin: ea[0], xmax: ea[1], ymin: eb[0], ymax: eb[1], xlabel: pa, ylabel: pb });
            P.axes();
            P.dots(ca, cb, { color: function (i) { return gcolor(lab[i]); }, alpha: .85 * U.ease(U.seg(t, 0, .5)), r: 3.4 });
            if (t >= .5) P.legend(groupLegend(K));
          }
        }],
        reading: readingOf(xs, st),
        caution: '切在哪裡是你自己選的，切在別處就會得到不同的群數；樹狀圖上兩次合併的距離差不多時，分法也不穩。',
        action: '本週把樹狀圖拿給同事看，請他們說說每一群的客戶像什麼，再決定要不要改切點。',
        table: groupTable(xs, st, '各群摘要（人數、占比、各欄平均）')
      };
    },
    // 卡片縮圖：十四個點的樹狀圖由下往上長出來
    thumb: function (g, w, h, t) {
      var T = App.theme(), r = ML.rng(9), pts = [], i;
      for (i = 0; i < 14; i++) pts.push([r() * 4 + (i < 7 ? 0 : 5), r() * 4]);
      var merges = ML.hclust(pts), lay = layoutTree(merges, pts.length, 30);
      var P = App.plot(g, w, h, { bare: true, xmin: -.5, xmax: lay.leaves - .5, ymin: 0, ymax: lay.top * 1.05 });
      drawTree(g, P, lay, U.ease(t) * lay.top, T.ink, Math.max(1.2, w / 120));
    }
  });

  // ---------- 套餐 C：DBSCAN ----------
  App.register({
    id: 'dbscan', cat: 'cluster', needs: 'customer',
    zh: '密度分群', en: 'DBSCAN',
    ask: '誰和大家都不一樣？', advanced: true,
    blurb: '自動找出落單的人。抓極端值',
    question: '哪些客戶和其他人都不一樣，需要人工留意？',
    demo: 'members',
    pipeline: ['把每欄換成同一把尺（標準化）', '數每位會員周圍有幾位鄰居（距離在範圍內）', '鄰居夠多的人連成一群，連不上的算落單', '列出落單者名單，逐一確認'],
    roles: [xRole(), { key: 'id', label: '名稱欄位（列出落單者用）', type: 'label', guess: ['會員編號'] }],
    params: [
      { key: 'eps', label: '多近算鄰居（距離）', type: 'range', min: .2, max: 1.5, step: .05, value: .5, fmt: function (v) { return Number(v).toFixed(2); } },
      { key: 'minPts', label: '至少幾個鄰居才算一群', type: 'range', min: 3, max: 15, step: 1, value: 5 }
    ],
    minRows: 20, maxRows: 2000,
    verified: 'DBSCAN 的群數、雜訊點與核心點分群，已用 scikit-learn 核對。',
    run: function (ctx) {
      var xs = ctx.cols.x, idc = ctx.cols.id, eps = ctx.params.eps, mp = ctx.params.minPts, n = ctx.n;
      if (xs.indexOf(idc) >= 0) throw new Error('名稱欄位不能同時拿來分群，請換一個名稱欄位（例如會員編號）。');
      var raw = rawOf(ctx, xs), Z = ML.standardize(ctx.X(xs)).Z;
      var rl = ML.relabelBySize(ML.dbscan(Z, eps, mp)), lab = rl.labels, K = rl.sizes.length;
      var names = ctx.col(idc), noiseIdx = [], i;
      for (i = 0; i < n; i++) if (lab[i] < 0) noiseIdx.push(i);
      var noise = noiseIdx.length, st = K > 0 ? groupStats(Z, raw, lab, K) : null;

      var pa = xs[0], pb = xs[1], ca = raw[0], cb = raw[1];
      var ea = U.extent(ca), eb = U.extent(cb);
      var gx = [], gy = [], gl = [], nx = [], ny = [];
      for (i = 0; i < n; i++) {
        if (lab[i] < 0) { nx.push(ca[i]); ny.push(cb[i]); }
        else { gx.push(ca[i]); gy.push(cb[i]); gl.push(lab[i]); }
      }

      var table;
      if (noise > 0) {
        table = {
          title: '落單者清單（共 ' + U.fmt(noise) + ' 位' + (noise > 50 ? '，只列前 50 位' : '') + '）',
          head: [idc].concat(xs),
          rows: noiseIdx.slice(0, 50).map(function (j) {
            return [names[j]].concat(raw.map(function (c) { return U.fmt(c[j]); }));
          })
        };
      } else {
        table = groupTable(xs, st, '各群摘要（沒有落單者）');
      }

      var reading;
      if (K === 0) reading = '在這組距離與鄰居數設定下，沒有找到任何一群，所有人都算落單。請把「多近算鄰居」調大，或把「至少幾個鄰居」調小。';
      else if (noise === 0) reading = '所有人都能歸到 ' + K + ' 群，沒有落單者。';
      else reading = '有 ' + U.fmt(noise) + ' 位（占 ' + U.pct(noise / n) + '）和任何一群都不像，名單在下方的表格。這些人可能是大戶，也可能是資料錯誤，要人工看。';

      return {
        note: '標準化後分群，共 ' + n + ' 列參與分群。',
        metrics: [
          { label: '找到幾群', value: U.fmt(K) + ' 群', hint: '不含落單的人' },
          { label: '落單人數', value: U.fmt(noise) + ' 人', hint: '和任何一群都不像' },
          { label: '落單占比', value: U.pct(noise / n), hint: '占納入分群的資料' }
        ],
        charts: [{
          title: '密度分群結果：' + pa + ' 與 ' + pb, ratio: .62,
          caption: '空心大圈是落單的人。',
          draw: function (g, w, h, t) {
            var T = App.theme();
            var P = App.plot(g, w, h, { xmin: ea[0], xmax: ea[1], ymin: eb[0], ymax: eb[1], xlabel: pa, ylabel: pb });
            P.axes();
            var a = U.ease(U.seg(t, 0, .5)), rb = U.seg(t, .5, .6), b = U.ease(U.seg(t, .5, 1)), j;
            P.dots(gx, gy, { color: function (q) { return gcolor(gl[q]); }, alpha: .85 * a, r: 3.4 });
            P.dots(nx, ny, { color: T.muted, alpha: .9 * a * (1 - rb), r: 3 });
            if (t > .5) {
              var rad = 16 + (7 - 16) * b;
              for (j = 0; j < nx.length; j++) {
                var x = P.sx(nx[j]), y = P.sy(ny[j]);
                ring(g, x, y, rad, T.muted, rb * (1 - b), 1.6);
                ring(g, x, y, rad, T.bad, rb * b, 2);
              }
            }
            if (t >= .5) P.legend(groupLegend(K).concat(noise > 0 ? [{ label: '落單者', color: T.bad }] : []));
          }
        }],
        reading: reading,
        caution: '群和落單的界線由「多近算鄰居」和「至少幾個鄰居」決定，調一點參數，落單的人數就會明顯變多或變少。',
        action: noise > 0
          ? '把落單名單交給熟悉這些會員的人逐一確認：是大客戶就另外經營，是資料錯誤就先修正。'
          : '試著把「多近算鄰居」慢慢調大或調小，找出最接近你對客戶理解的那一組設定。',
        table: table
      };
    },
    // 卡片縮圖：兩群點，兩個落單點的圈由大縮小
    thumb: function (g, w, h, t) {
      var T = App.theme(), r = ML.rng(13), P = App.plot(g, w, h, { bare: true, xmin: 0, xmax: 1, ymin: 0, ymax: 1 });
      var cs = [[.25, .35], [.72, .68]], xs = [], ys = [], lb = [], i, c;
      for (i = 0; i < 30; i++) {
        c = i % 2;
        xs.push(U.clamp(cs[c][0] + (r() - .5) * .26, .04, .96));
        ys.push(U.clamp(cs[c][1] + (r() - .5) * .26, .04, .96));
        lb.push(c);
      }
      var ox = [.9, .08], oy = [.12, .9];
      var rad = Math.max(1.8, w / 60), a = U.ease(U.seg(t, 0, .5)), b = U.ease(U.seg(t, .5, 1)), rb = U.seg(t, .5, .6);
      P.dots(xs, ys, { color: function (j) { return gcolor(lb[j]); }, alpha: .85 * a, r: rad });
      P.dots(ox, oy, { color: T.muted, alpha: .9 * a * (1 - rb), r: rad });
      var big = Math.max(7, w / 18), small = Math.max(3.5, w / 34), q;
      for (q = 0; q < 2; q++) {
        var x = P.sx(ox[q]), y = P.sy(oy[q]), rr = big + (small - big) * b;
        ring(g, x, y, rr, T.muted, rb * (1 - b), 1.4);
        ring(g, x, y, rr, T.bad, rb * b, 1.8);
      }
    }
  });
})();
