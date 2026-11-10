// 回歸類的進階套餐：多元線性回歸、多項式回歸。結構照 10_regress_simple.js。
(function () {
  'use strict';
  var App = window.App, U = App.U, ML = window.ML;

  // 數值的正負號文字（+ 或 -），小數 2 位
  function sgn(v) { return (v >= 0 ? '+' : '-') + U.fmt(Math.abs(v), 2); }
  // 文字超過寬度就截掉，補「…」
  function fitText(g, s, maxW) {
    if (g.measureText(s).width <= maxW) return s;
    while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  App.register({
    id: 'multi', cat: 'regress', needs: 'wide',
    zh: '多元線性回歸', en: 'multiple linear regression',
    ask: '哪個原因影響最大？',
    blurb: '多個原因一起看。找出哪個影響最大',
    question: '好幾個原因一起變動時，每一個各自影響結果多少？哪一個最值得管？',
    demo: 'daily',
    pipeline: ['刪掉有空值的列', '每 5 列留 1 列當考題', '算出每個原因各自的係數', '把原因換成同一把尺，比誰影響大', '用考題算誤差'],
    roles: [
      { key: 'x', label: '原因（可複選）', type: 'num', multi: true, min: 2, max: 6, guess: ['廣告費', '氣溫', '假日'], tip: '至少選 2 個，最多 6 個。' },
      { key: 'y', label: '結果（Y）', type: 'num', guess: ['營收'], prefer: 'last', tip: '結果不能同時當成原因。' }
    ],
    params: [],
    minRows: 20,
    verified: '這個套餐的係數、標準化係數、考題 R² 與 RMSE 已用 scikit-learn 核對一致。',
    run: function (ctx) {
      var xs = ctx.cols.x, yn = ctx.cols.y;
      if (xs.indexOf(yn) >= 0) throw new Error('「結果（Y）」不能同時當成「原因」，請把「' + yn + '」從原因中拿掉。');
      if (xs.length < 2) throw new Error('原因至少要選 2 個。只有一個原因的話，請改用「簡單線性回歸」。');
      if (xs.length > 6) throw new Error('原因最多選 6 個，請拿掉一些。');
      var X = ctx.X(xs), y = ctx.col(yn), sp = ML.splitIdx(ctx.n);
      var Xtr = ML.take(X, sp.train), ytr = ML.take(y, sp.train), Xte = ML.take(X, sp.test), yte = ML.take(y, sp.test);
      if (sp.train.length < xs.length + 2) throw new Error('可用的資料太少，無法同時算 ' + xs.length + ' 個原因。請多放幾列資料。');

      var m = ML.multiFit(Xtr, ytr);                 // 原始單位係數 + 標準化係數
      var pte = ML.predictLinear(m, Xte);
      var r2te = ML.r2(yte, pte), rmse = ML.rmse(yte, pte);
      var items = xs.map(function (name, j) { return { name: name, coef: m.coef[j], s: m.stdCoef[j] }; });
      var byInfl = items.slice().sort(function (a, b) { return Math.abs(b.s) - Math.abs(a.s); });
      var top = byInfl[0];
      var maxAbs = Math.max.apply(null, byInfl.map(function (o) { return Math.abs(o.s); })) || 1;
      var others = xs.filter(function (c) { return c !== top.name; });
      var weak = r2te < 0.2;

      var reading = weak
        ? '這幾個原因合起來也說明不了「' + yn + '」的變化（考題 R² 只有 ' + U.fmt(r2te, 2) + '）。這組條件不適合拿來做決定。'
        : (others.length ? '把' + others.join('、') + '一起考慮後，' : '') + top.name + '每多 1，' + yn + '平均' + (top.coef >= 0 ? '增加 ' : '減少 ') + U.fmt(Math.abs(top.coef)) + '。這組原因能說明考題中約 ' + U.pct(Math.max(0, r2te), 0) + ' 的變化。';

      var names = byInfl.map(function (o) { return o.name; });
      var vals = byInfl.map(function (o) { return o.s; });
      var all = yte.concat(pte), ex = U.extent(all, .05);

      return {
        note: '訓練 ' + sp.train.length + ' 列、考題 ' + sp.test.length + ' 列（每 5 列的第 5 列）',
        metrics: [
          { label: '考題 R²', value: U.fmt(r2te, 3), hint: '1 是完全說得準，0 是跟猜平均一樣' },
          { label: '考題平均誤差', value: U.fmt(rmse), hint: '預測值通常會差這麼多（RMSE）' },
          { label: '影響最大的原因', value: top.name, hint: '其他原因都不變時，它的標準化係數最大' }
        ],
        charts: [{
          title: '誰的影響最大', ratio: .085 * xs.length + .2,
          caption: '藍色是正向（原因變多，結果跟著變多），橘色是負向（原因變多，結果變少）。長度比的是「每多一個標準差」的影響力，所以不同單位也能一起比。',
          draw: function (g, w, h, t) {
            var T = App.theme(), k = names.length;
            g.save(); g.font = '12px system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
            var labW = 0; names.forEach(function (s) { labW = Math.max(labW, g.measureText(s).width); });
            labW = Math.min(labW, w * .36);
            var x0 = 10 + labW + 10, barMax = Math.max(20, w - x0 - 62), rowH = (h - 16) / k, barH = Math.min(22, rowH * .6);
            g.strokeStyle = T.muted; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, 8); g.lineTo(x0, h - 8); g.stroke();
            for (var i = 0; i < k; i++) {
              var cy = 8 + rowH * (i + .5), f = U.ease(U.clamp((t - i * .06) / .6, 0, 1));
              var len = Math.abs(vals[i]) / maxAbs * barMax * f;
              g.fillStyle = vals[i] >= 0 ? App.colors[0] : App.colors[1];
              g.fillRect(x0, cy - barH / 2, len, barH);
              g.fillStyle = T.ink; g.fillText(fitText(g, names[i], labW), 10, cy);
              g.globalAlpha = f; g.fillText(sgn(vals[i]), x0 + len + 6, cy); g.globalAlpha = 1;
            }
            g.restore();
          }
        }, {
          title: '預測值對實際值（考題）', ratio: .8,
          caption: '每個藍點是一筆考題。點越靠近灰色虛線，代表預測越準。',
          draw: function (g, w, h, t) {
            var T = App.theme();
            var P = App.plot(g, w, h, { xmin: ex[0], xmax: ex[1], ymin: ex[0], ymax: ex[1], xlabel: '實際值（考題）', ylabel: '預測值' });
            P.axes();
            var a = U.ease(U.seg(t, 0, .5));
            P.dots(yte, pte, { color: App.colors[0], alpha: .85 * a, r: 3.6 });
            var b = U.ease(U.seg(t, .5, 1)), e = ex[0] + (ex[1] - ex[0]) * b;
            P.line([ex[0], e], [ex[0], e], { color: T.muted, width: 1.6, dash: [5, 4] });
          }
        }],
        reading: reading,
        caution: '這些只是關聯，不是因果。原因之間可能互相牽連，超出資料範圍的數字也不要拿來預估。',
        action: weak
          ? '先不要靠這組原因做預估；回頭檢查有沒有漏掉其他可能影響「' + yn + '」的欄位，再試一次。'
          : '挑一週只調整「' + top.name + '」，其他原因盡量維持不變，記下實際的「' + yn + '」，和模型預測對一對。',
        table: {
          title: '模型摘要', head: ['欄位', '係數（原始單位）', '標準化係數'],
          rows: xs.map(function (name, j) { return [name, U.fmt(m.coef[j], 4), U.fmt(m.stdCoef[j], 4)]; }).concat([['截距', U.fmt(m.intercept, 2), '無']])
        }
      };
    },
    // 卡片縮圖：幾條橘藍長條一起長出來，代表好幾個原因各自的力道
    thumb: function (g, w, h, t) {
      var T = App.theme(), r = ML.rng(31), i;
      var base = [.92, .66, .4, .22], sg = [1, 1, -1, 1], x0 = w * .14, lenMax = w * .78;
      for (i = 0; i < 4; i++) {
        var f = U.ease(U.seg(t, .1 + .08 * i, .6 + .08 * i));
        var len = base[i] * (.9 + .2 * r()) * lenMax * f, cy = h * (.18 + i * .21);
        g.fillStyle = sg[i] >= 0 ? App.colors[0] : App.colors[1];
        g.fillRect(x0, cy - h * .06, len, h * .12);
      }
      g.strokeStyle = T.muted; g.lineWidth = Math.max(1, w / 150); g.beginPath(); g.moveTo(x0, h * .08); g.lineTo(x0, h * .92); g.stroke();
    }
  });

  App.register({
    id: 'poly', cat: 'regress', needs: 'wide',
    zh: '多項式回歸', en: 'polynomial regression',
    ask: '做到多少剛剛好？', advanced: true,
    blurb: '畫出彎曲的關係。適合找最高點在哪',
    question: '兩件事的關係不是一直線時，怎麼描述？折扣加到多少，毛利最高？',
    demo: 'daily',
    pipeline: ['刪掉有空值的列', '每 5 列留 1 列當考題', '把原因換成標準單位', '依次方加上高次項，配出曲線', '用考題算誤差'],
    roles: [
      { key: 'x', label: '原因（X）', type: 'num', guess: ['折扣率'] },
      { key: 'y', label: '結果（Y）', type: 'num', guess: ['毛利'], prefer: 'last' }
    ],
    params: [
      { key: 'degree', label: '曲線彎幾次（次方）', type: 'range', min: 1, max: 6, step: 1, value: 2,
        fmt: function (v) { return v + ' 次'; },
        tip: '1 次是直線，2 次是一個彎，3 次以上可以有更多轉折。次數太高容易把雜訊也畫進去。' }
    ],
    minRows: 20,
    verified: '這個套餐的曲線預測值與考題 RMSE 已用 scikit-learn（StandardScaler、PolynomialFeatures、LinearRegression）核對一致。',
    run: function (ctx) {
      var xn = ctx.cols.x, yn = ctx.cols.y;
      if (xn === yn) throw new Error('原因和結果選到同一個欄位了，請換一個。');
      var deg = Math.round(Number(ctx.params.degree));
      if (!(deg >= 1 && deg <= 6)) throw new Error('曲線的次方要在 1 到 6 之間。');
      var x = ctx.col(xn), y = ctx.col(yn), sp = ML.splitIdx(ctx.n);
      var xtr = ML.take(x, sp.train), ytr = ML.take(y, sp.train), xte = ML.take(x, sp.test), yte = ML.take(y, sp.test);
      var uniq = {}; xtr.forEach(function (v) { uniq[v] = 1; });
      if (Object.keys(uniq).length < 7) throw new Error('「' + xn + '」在訓練資料裡不同的數值太少（至少要 7 種），畫不出曲線。請換一個欄位，或確認資料是不是重複太多。');

      var fit = ML.polyFit(xtr, ytr, deg);
      var pte = fit.predict(xte), rmseTr = ML.rmse(ytr, fit.predict(xtr));
      var r2te = ML.r2(yte, pte), rmseTe = ML.rmse(yte, pte);

      // 次方 1 到 6 的誤差（畫在圖 2）
      var sweepTr = [], sweepTe = [], d, fd;
      for (d = 1; d <= 6; d++) {
        fd = ML.polyFit(xtr, ytr, d);
        sweepTr.push(ML.rmse(ytr, fd.predict(xtr)));
        sweepTe.push(ML.rmse(yte, fd.predict(xte)));
      }

      // 曲線在資料範圍內取 100 點，找最高點
      var ex = U.extent(x, 0), gx = [], i, best = 0;
      for (i = 0; i < 100; i++) gx.push(ex[0] + (ex[1] - ex[0]) * i / 99);
      var gy = fit.predict(gx);
      for (i = 1; i < 100; i++) if (gy[i] > gy[best]) best = i;
      var peakX = gx[best], atEdge = best === 0 || best === 99;

      var metrics = [
        { label: '考題 R²', value: U.fmt(r2te, 3), hint: '1 是完全說得準，0 是跟猜平均一樣' },
        { label: '考題 RMSE', value: U.fmt(rmseTe), hint: '預測值通常會差這麼多（RMSE）' }
      ];
      if (deg >= 2) metrics.push({ label: '曲線最高點的' + xn, value: U.fmt(peakX, 2),
        hint: atEdge ? '最高點在資料邊界，代表範圍內沒有看到轉折' : yn + '在這個' + xn + '附近最高' });

      var reading;
      if (r2te < 0.2) reading = '這條曲線幾乎說明不了「' + yn + '」的變化（考題 R² 只有 ' + U.fmt(r2te, 2) + '）。這條線不適合拿來做決定。';
      else if (deg === 1) reading = xn + '和' + yn + '大致是直線關係，考題 R² 約 ' + U.fmt(r2te, 2) + '。';
      else if (atEdge) reading = '在目前的資料範圍內，' + yn + '還沒有看到轉折，最高點就落在範圍邊界上。';
      else reading = xn + '約 ' + U.fmt(peakX, 1) + ' 時，' + yn + '最高，再多反而下降。';
      if (deg >= 2 && rmseTe > sweepTe[deg - 2]) reading += '彎太多次了，考題誤差反而變大。';

      var ey = U.extent(y, .1);
      var allSweep = sweepTr.concat(sweepTe), eRmse = U.extent(allSweep, .15);
      var rowsT = [['原因平均（訓練）', U.fmt(fit.mean, 4)], ['原因標準差（訓練）', U.fmt(fit.std, 4)], ['截距（標準化後）', U.fmt(fit.intercept, 4)]];
      for (i = 0; i < deg; i++) rowsT.push(['第 ' + (i + 1) + ' 次項係數（標準化後）', U.fmt(fit.coef[i], 4)]);
      rowsT.push(['訓練 RMSE', U.fmt(rmseTr, 4)], ['考題 R²', U.fmt(r2te, 4)], ['考題 RMSE', U.fmt(rmseTe, 4)], ['訓練列數', sp.train.length], ['考題列數', sp.test.length]);

      return {
        note: '訓練 ' + sp.train.length + ' 列、考題 ' + sp.test.length + ' 列（每 5 列的第 5 列）',
        metrics: metrics,
        charts: [{
          title: xn + ' 與 ' + yn, ratio: .62,
          caption: '藍點是訓練資料，橘點是考題，黑線是曲線。',
          draw: function (g, w, h, t) {
            var T = App.theme();
            var P = App.plot(g, w, h, { xmin: ex[0], xmax: ex[1], ymin: ey[0], ymax: ey[1], xlabel: xn, ylabel: yn });
            P.axes();
            var a = U.ease(U.seg(t, 0, .35));
            P.dots(xtr, ytr, { color: App.colors[0], alpha: .6 * a });
            P.dots(xte, yte, { color: App.colors[1], alpha: .9 * a, r: 3.6 });
            var b = U.ease(U.seg(t, .35, 1));
            g.save(); g.beginPath(); g.rect(P.x0, P.y1, P.x1 - P.x0, P.y0 - P.y1); g.clip();
            P.line(gx, gy, { color: T.ink, width: 2.4, frac: b });
            g.restore();
          }
        }, {
          title: '彎越多次不一定越準', ratio: .62,
          caption: '藍線是訓練資料的誤差，橘線是考題的誤差，虛線是目前選的次數。訓練誤差一直變小，不代表真的準，要看橘線。',
          draw: function (g, w, h, t) {
            var T = App.theme(), xs = [0, 1, 2, 3, 4, 5];
            var P = App.plot(g, w, h, { xmin: -.5, xmax: 5.5, ymin: Math.max(0, eRmse[0]), ymax: eRmse[1], xcats: ['1', '2', '3', '4', '5', '6'], xlabel: '曲線彎幾次（次方）', ylabel: 'RMSE（誤差）' });
            P.axes();
            var b = U.ease(U.seg(t, 0, .8));
            P.line(xs, sweepTr, { color: App.colors[0], width: 2, frac: b });
            P.line(xs, sweepTe, { color: App.colors[1], width: 2, frac: b });
            var a = U.ease(U.seg(t, .6, 1));
            P.dots(xs, sweepTr, { color: App.colors[0], r: 3.4, alpha: a });
            P.dots(xs, sweepTe, { color: App.colors[1], r: 3.4, alpha: a });
            P.vline(deg - 1, { color: T.ink, width: 1.2, dash: [4, 4] });
          }
        }],
        reading: reading,
        caution: '這些只是關聯，不是因果。曲線只在目前的資料範圍內可信，超出範圍不要外推。',
        action: r2te < 0.2
          ? '先不要用「' + xn + '」來決定「' + yn + '」的目標；回頭確認有沒有漏掉其他影響因素。'
          : (atEdge || deg === 1
            ? '在「' + xn + '」的範圍內挑 2 個不同的數值，各試一週，記下實際的「' + yn + '」。'
            : '把「' + xn + '」調到接近 ' + U.fmt(peakX, 1) + ' 的水準試一週，記下實際的「' + yn + '」，和曲線的預測對一對。'),
        table: { title: '模型摘要', head: ['項目', '數值'], rows: rowsT }
      };
    },
    // 卡片縮圖：散點加上一條彎曲的線，由左慢慢畫到右
    thumb: function (g, w, h, t) {
      var T = App.theme(), r = ML.rng(9), P = App.plot(g, w, h, { bare: true, xmin: 0, xmax: 1, ymin: 0, ymax: 1 });
      var xs = [], ys = [], i;
      for (i = 0; i < 24; i++) {
        var x = .06 + r() * .88;
        xs.push(x); ys.push(U.clamp(.22 + .62 * 4 * x * (1 - x) + (r() - .5) * .18, .04, .96));
      }
      P.dots(xs, ys, { color: App.colors[0], r: Math.max(1.6, w / 70), alpha: .8 });
      var b = U.ease(U.seg(t, .1, .7)), cx = [], cy = [];
      for (i = 0; i <= 60; i++) { var u = i / 60; cx.push(u); cy.push(.22 + .62 * 4 * u * (1 - u)); }
      P.line(cx, cy, { color: T.ink, width: Math.max(1.5, w / 90), frac: b });
    }
  });
})();
