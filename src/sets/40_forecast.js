// 預測套餐：移動平均與去年同期、指數平滑、趨勢加季節。三個套餐共用同一套回測流程。
(function () {
  'use strict';
  var App = window.App, U = App.U, ML = window.ML;

  // 考題長度：資料有 24 期以上取 6 期；不到 24 期取四分之一（至少 3 期）
  function horizon(n) { return n < 24 ? Math.max(3, Math.floor(n / 4)) : 6; }
  function range(a, b) { var r = [], i; for (i = a; i <= b; i++) r.push(i); return r; }

  // 準備資料：時間標籤、數字、考題長度、訓練與考題切點（不用 ML.splitIdx，考題是最後 H 期）
  function prepare(ctx) {
    var tn = ctx.cols.t, yn = ctx.cols.y;
    if (tn === yn) throw new Error('時間欄位和要預測的數字選到同一個欄位了，請換一個。');
    var tl = ctx.col(tn).map(String), y = ctx.col(yn), n = y.length, H = horizon(n);
    return { tl: tl, y: y, n: n, H: H, nTr: n - H, yTr: y.slice(0, n - H), yTe: y.slice(n - H), tLabel: tn, yLabel: yn };
  }
  function noteOf(S) { return '訓練 ' + S.nTr + ' 期、考題 ' + S.H + ' 期（最後 ' + S.H + ' 期）'; }
  function caution(S) {
    return '資料只有 ' + S.n + ' 期。促銷、新對手、調價都會讓預測失效；預測期越遠越不準，「+' + S.H + '」比「+1」更不可靠。';
  }
  // 上方留白給右上角的圖例，免得蓋住資料
  function yRange(lo, hi, Hp, nLegend, floor) {
    var span = (hi - lo) || Math.abs(hi) || 1, ymin = lo - span * .06;
    if (floor != null) ymin = Math.max(floor, ymin);
    var D = hi - ymin, rr = Math.min(.6, (16 * nLegend + 14) / Hp);
    return { ymin: ymin, ymax: hi + D * rr / (1 - rr) };
  }
  // 結果表：考題 H 期（實際、預測、誤差%），接著未來 H 期的預測
  function resultTable(S, title, bt, fut) {
    var rows = [], i;
    for (i = 0; i < S.H; i++) {
      var a = S.yTe[i], p = bt[i];
      rows.push([S.tl[S.nTr + i], U.fmt(a), U.fmt(p), a ? U.pct(Math.abs(a - p) / Math.abs(a), 1) : '—']);
    }
    for (i = 0; i < S.H; i++) rows.push(['未來 +' + (i + 1), '—', U.fmt(fut[i]), '—']);
    return { title: title, head: ['期', '實際', '預測', '誤差%'], rows: rows };
  }
  // 主圖：實際線、考題回測線（可多條）、未來虛線、兩條垂直虛線。x 軸標籤自己畫（時間標籤＋「+1」到「+H」）。
  function mainChart(S, bts, fut, title) {
    var legend = [{ label: '實際', color: App.colors[0] }]
      .concat(bts.map(function (b) { return { label: b.label, color: b.color, line: true }; }))
      .concat([{ label: '未來預測', color: App.colors[2], line: true, dash: [6, 4] }]);
    var pad = { l: 52, r: 14, t: 24, b: 66 };
    return {
      title: title, ratio: .85,
      caption: '細虛線：左邊是訓練與考題的交界，右邊是最後一筆實際值。',
      draw: function (g, w, h, t) {
        var all = S.y.concat(fut), lo = Infinity, hi = -Infinity, i, k;
        bts.forEach(function (b) { all = all.concat(b.vals); });
        all.forEach(function (v) { if (v < lo) lo = v; if (v > hi) hi = v; });
        var R = yRange(lo, hi, h - pad.t - pad.b, legend.length);
        var P = App.plot(g, w, h, { xmin: 0, xmax: S.n + S.H - 1, ymin: R.ymin, ymax: R.ymax, pad: pad, xcats: [], xlabel: S.tLabel, ylabel: S.yLabel });
        var T = App.theme();
        P.axes();
        g.save(); g.font = '11px system-ui, sans-serif'; g.fillStyle = T.muted; g.textAlign = 'center'; g.textBaseline = 'top';
        var step = Math.ceil(S.n / Math.max(2, Math.floor((P.x1 - P.x0) / 58)));
        for (i = 0; i < S.n; i += step) g.fillText(S.tl[i], P.sx(i), P.y0 + 4);
        g.font = '10px system-ui, sans-serif';
        for (k = 0; k < S.H; k++) g.fillText('+' + (k + 1), P.sx(S.n + k), P.y0 + (k % 2 ? 30 : 17));
        g.restore();
        P.vline(S.nTr - .5);
        P.vline(S.n - 1);
        P.line(range(0, S.n - 1), S.y, { color: App.colors[0], width: 2.2, frac: U.seg(t, 0, .5) });
        bts.forEach(function (b) { P.line(range(S.nTr, S.n - 1), b.vals, { color: b.color, width: 2, frac: U.seg(t, .5, .75) }); });
        P.line(range(S.n - 1, S.n + S.H - 1), [S.y[S.n - 1]].concat(fut), { color: App.colors[2], width: 2.2, dash: [6, 4], frac: U.seg(t, .75, 1) });
        P.legend(legend);
      }
    };
  }

  var ROLES = [
    { key: 't', label: '時間欄位（資料要由舊到新排好）', type: 'label', unique: true, guess: ['月份'], tip: '不解析日期，只看列的順序。' },
    { key: 'y', label: '要預測的數字', type: 'num', guess: ['營收'], prefer: 'last' }
  ];

  // ---------- 套餐 A：移動平均與去年同期 ----------
  App.register({
    id: 'baseline', cat: 'forecast', needs: 'series',
    zh: '移動平均與去年同期', en: 'moving average & seasonal naive',
    ask: '預測至少要多準才算數？',
    blurb: '最簡單的兩種估法。任何預測的及格線',
    question: '不做任何複雜的計算，只看過去的數字，預測能準到什麼程度？',
    demo: 'monthly',
    pipeline: ['刪掉有空值的列', '最後一段留下來當考題', '算移動平均與去年同期', '用較準的那個估未來'],
    roles: ROLES,
    params: [
      { key: 'w', label: '平均最近幾期', type: 'range', min: 2, max: 12, step: 1, value: 3 },
      { key: 'm', type: 'select', label: '一個循環有幾期', options: [
        { value: 12, label: '12（月資料看一年）' }, { value: 7, label: '7（日資料看一週）' }, { value: 4, label: '4（季資料看一年）' }
      ], value: '12' }
    ],
    minRows: 16,
    verified: '移動平均、去年同期（季節天真法）的考題預測值與 MAPE 已用 numpy 核對一致。',
    run: function (ctx) {
      var S = prepare(ctx), w = Number(ctx.params.w), m = Number(ctx.params.m);
      if (!(w >= 1)) throw new Error('「平均最近幾期」至少要 1 期。');
      if (w > S.nTr) throw new Error('「平均最近幾期」不能超過訓練資料的期數（目前訓練 ' + S.nTr + ' 期），請調小。');
      var maBt = ML.movingAverageForecast(S.yTr, S.H, w), snBt = ML.seasonalNaive(S.yTr, S.H, m);
      var maM = ML.mape(S.yTe, maBt), snM = ML.mape(S.yTe, snBt);
      var useMa = maM <= snM, bestName = useMa ? '移動平均' : '去年同期', bestM = Math.min(maM, snM);
      var fut = useMa ? ML.movingAverageForecast(S.y, S.H, w) : ML.seasonalNaive(S.y, S.H, m);
      var diff = Math.abs(maM - snM) * 100;
      return {
        note: noteOf(S) + (S.nTr < m ? '；訓練資料不到一個循環，去年同期改用最後一個值' : ''),
        metrics: [
          { label: '移動平均 考題 MAPE', value: U.pct(maM, 1), hint: '平均最近 ' + w + ' 期' },
          { label: '去年同期 考題 MAPE', value: U.pct(snM, 1), hint: '往前推 ' + m + ' 期的實際值（基準）' },
          { label: '較準的方法', value: bestName, hint: '考題誤差較小的那個' }
        ],
        charts: [mainChart(S, [
          { label: '回測：移動平均', color: App.colors[1], vals: maBt },
          { label: '回測：去年同期', color: App.colors[3], vals: snBt }
        ], fut, '實際、考題回測與未來預測（未來用' + bestName + '）')],
        reading: '移動平均的考題誤差是 ' + U.pct(maM, 1) + '，去年同期是 ' + U.pct(snM, 1) + '。' +
          (maM === snM ? '兩者一樣準。' : bestName + '比較準，少了 ' + U.fmt(diff, 1) + ' 個百分點。') +
          '之後任何更複雜的方法，都要先贏過 ' + U.pct(bestM, 1) + ' 這個數字，才值得用。',
        caution: caution(S),
        action: '下一期實際數字出來後，請負責記帳的人和「+1」的預測對一對，記下誤差。',
        table: resultTable(S, '未來 ' + S.H + ' 期預測（' + bestName + '）與考題回測', useMa ? maBt : snBt, fut)
      };
    },
    thumb: function (g, w, h, t) {
      var r = ML.rng(31), P = App.plot(g, w, h, { bare: true, xmin: 0, xmax: 1.2, ymin: 0, ymax: 1 });
      var lw = Math.max(1.5, w / 90), xs = [], ys = [], i;
      for (i = 0; i < 24; i++) { xs.push(.04 + i * .03); ys.push(U.clamp(.5 + .2 * Math.sin(Math.PI * i / 3) + (r() - .5) * .08, .05, .95)); }
      P.line(xs, ys, { color: App.colors[0], width: lw, frac: U.seg(t, 0, .6) });
      var avg = (ys[21] + ys[22] + ys[23]) / 3;
      P.line([.73, 1.16], [avg, avg], { color: App.colors[1], width: lw, dash: [4, 3], frac: U.seg(t, .6, .8) });
    }
  });

  // ---------- 套餐 B：指數平滑（霍爾特） ----------
  App.register({
    id: 'holt', cat: 'forecast', needs: 'series',
    zh: '指數平滑', en: "Holt's exponential smoothing",
    ask: '照最近的走勢會到哪裡？',
    blurb: '越近的資料看得越重。有趨勢的數字',
    question: '數字一路往上或往下走時，越近的資料要不要多看一點？',
    demo: 'monthly',
    pipeline: ['刪掉有空值的列', '最後一段留下來當考題', '逐期更新水準與趨勢', '用全部資料往後推'],
    roles: ROLES,
    params: [
      { key: 'alpha', label: '多重視最近的數字', type: 'range', min: .05, max: .95, step: .05, value: .3, fmt: function (v) { return Number(v).toFixed(2); } },
      { key: 'beta', label: '多快跟上趨勢變化', type: 'range', min: .05, max: .95, step: .05, value: .1, fmt: function (v) { return Number(v).toFixed(2); } }
    ],
    minRows: 12,
    verified: '指數平滑的預測值與擬合值已用 statsmodels（Holt，known 初始值）核對一致。',
    run: function (ctx) {
      var S = prepare(ctx), a = Number(ctx.params.alpha), b = Number(ctx.params.beta);
      var hb = ML.holt(S.yTr, a, b, S.H).forecast, mape = ML.mape(S.yTe, hb);
      var snBt = ML.seasonalNaive(S.yTr, S.H, 12), snM = ML.mape(S.yTe, snBt);
      var full = ML.holt(S.y, a, b, S.H), fut = full.forecast;
      // 掃過 α = 0.05 到 0.95 的回測誤差（β 固定）
      var sweepA = [], sweepM = [], k;
      for (k = 5; k <= 95; k += 5) { sweepA.push(k / 100); sweepM.push(ML.mape(S.yTe, ML.holt(S.yTr, k / 100, b, S.H).forecast)); }
      var beat = mape < snM;
      return {
        note: noteOf(S) + '；基準是去年同期（往前推 12 期）',
        metrics: [
          { label: '考題 MAPE', value: U.pct(mape, 1), hint: '指數平滑在考題的平均誤差' },
          { label: '基準 MAPE', value: U.pct(snM, 1), hint: '去年同期（往前推 12 期）' },
          { label: '每期趨勢', value: U.fmt(full.trend), hint: '全部資料估的，每期平均' + (full.trend >= 0 ? '增加' : '減少') + '這麼多' }
        ],
        charts: [
          mainChart(S, [{ label: '回測：指數平滑', color: App.colors[1], vals: hb }], fut, '實際、考題回測與未來預測'),
          {
            title: '調到哪裡最準（β 固定為 ' + b.toFixed(2) + '）', ratio: .6,
            caption: '曲線越低越準。直線是去年同期的誤差，目前的 α 用虛線標出。',
            draw: function (g, w, h, t) {
              var T = App.theme(), pad = { l: 52, r: 14, t: 24, b: 40 };
              var lo = Math.min.apply(null, sweepM.concat([snM])), hi = Math.max.apply(null, sweepM.concat([snM]));
              var R = yRange(lo, hi, h - pad.t - pad.b, 3, 0);
              var P = App.plot(g, w, h, { xmin: .05, xmax: .95, ymin: R.ymin, ymax: R.ymax, pad: pad, yfmt: function (v) { return U.pct(v, 0); }, xlabel: '多重視最近的數字（α）', ylabel: '考題 MAPE' });
              P.axes();
              P.hline(snM, { color: App.colors[3], width: 1.5, dash: [5, 4] });
              P.vline(a, { color: T.ink, width: 1.2, dash: [5, 4] });
              P.line(sweepA, sweepM, { color: App.colors[1], width: 2.4, frac: U.seg(t, 0, .8) });
              if (t >= .8) P.dots([a], [mape], { color: App.colors[1], r: 4.5 });
              P.legend([{ label: '回測 MAPE', color: App.colors[1], line: true }, { label: '去年同期', color: App.colors[3], line: true, dash: [5, 4] }, { label: '目前的 α', color: T.ink, line: true, dash: [5, 4] }]);
            }
          }
        ],
        reading: '指數平滑的考題誤差是 ' + U.pct(mape, 1) + '，去年同期是 ' + U.pct(snM, 1) + '，這次' + (beat ? '贏過' : '沒有贏過') + '基準。' +
          '不過這個方法不處理季節，資料有明顯季節時通常輸給基準，建議改用「趨勢加季節」套餐。',
        caution: caution(S),
        action: '請負責營收的人本週把這個套餐和「趨勢加季節」套餐的考題誤差放在一起比，再決定用哪一個。',
        table: resultTable(S, '未來 ' + S.H + ' 期預測（指數平滑）與考題回測', hb, fut)
      };
    },
    thumb: function (g, w, h, t) {
      var r = ML.rng(32), P = App.plot(g, w, h, { bare: true, xmin: 0, xmax: 1.2, ymin: 0, ymax: 1 });
      var lw = Math.max(1.5, w / 90), xs = [], ys = [], sm = [], i;
      for (i = 0; i < 24; i++) {
        var x = .04 + i * .03;
        xs.push(x); ys.push(U.clamp(.12 + .55 * x + (r() - .5) * .14, .04, .96));
        sm.push(U.clamp(.12 + .55 * x, .04, .96));
      }
      P.line(xs, ys, { color: App.colors[0], width: lw, frac: U.seg(t, 0, .5) });
      P.line(xs.slice(-6).concat([1.16]), sm.slice(-6).concat([.12 + .55 * 1.16]), { color: App.colors[2], width: lw, dash: [4, 3], frac: U.seg(t, .5, .8) });
      P.dots([xs[xs.length - 1]], [ys[ys.length - 1]], { color: App.colors[1], r: Math.max(2, w / 60), alpha: U.seg(t, .4, .6) });
    }
  });

  // ---------- 套餐 C：趨勢加季節 ----------
  App.register({
    id: 'season', cat: 'forecast', needs: 'series',
    zh: '趨勢加季節', en: 'trend + seasonal regression',
    ask: '下個月大概會賣多少？', starter: true,
    blurb: '拆成長期走勢和淡旺季。月營收預估',
    question: '營收的長期走勢是多少？每年的淡季和旺季分別在哪幾個月？',
    demo: 'monthly',
    pipeline: ['刪掉有空值的列', '最後一段留下來當考題', '用趨勢和每個位置的季節效果做回歸', '用全部資料往後推'],
    roles: ROLES,
    params: [
      { key: 'm', type: 'select', label: '一個循環有幾期', options: [
        { value: 12, label: '12（月資料看一年）' }, { value: 7, label: '7（日資料看一週）' }, { value: 4, label: '4（季資料看一年）' }
      ], value: '12' }
    ],
    minRows: 18,
    verified: '趨勢加季節的預測值與斜率已用 scikit-learn（LinearRegression，相同設計矩陣）核對一致。',
    run: function (ctx) {
      var S = prepare(ctx), m = Number(ctx.params.m);
      var bt = ML.trendSeason(S.yTr, m, S.H).forecast, mape = ML.mape(S.yTe, bt);
      var snBt = ML.seasonalNaive(S.yTr, S.H, m), snM = ML.mape(S.yTe, snBt);
      var full = ML.trendSeason(S.y, m, S.H), fut = full.forecast, seas = full.seasonal;
      var hiI = 0, loI = 0, i;
      for (i = 1; i < m; i++) { if (seas[i] > seas[hiI]) hiI = i; if (seas[i] < seas[loI]) loI = i; }
      var hiL = String(S.tl[hiI]).slice(-2), loL = String(S.tl[loI]).slice(-2);
      var beat = mape < snM;
      return {
        note: noteOf(S) + '；基準是去年同期（往前推 ' + m + ' 期）',
        metrics: [
          { label: '考題 MAPE', value: U.pct(mape, 1), hint: '趨勢加季節在考題的平均誤差' },
          { label: '基準 MAPE', value: U.pct(snM, 1), hint: '去年同期（往前推 ' + m + ' 期）' },
          { label: '每期趨勢', value: U.fmt(Math.abs(full.slope)), hint: '扣掉季節後，每期平均' + (full.slope >= 0 ? '成長' : '減少') + '這麼多' },
          { label: '最旺的位置', value: hiL, hint: '季節效果最高；最淡的是「' + loL + '」' }
        ],
        charts: [
          mainChart(S, [{ label: '回測：趨勢加季節', color: App.colors[1], vals: bt }], fut, '實際、考題回測與未來預測'),
          {
            title: '淡季和旺季（每個位置比平均多或少多少）', ratio: .6,
            caption: '柱子高度是這個位置比平均多或少的量，0 線就是平均。柱子依資料順序排列，不是從 1 月開始。',
            draw: function (g, w, h, t) {
              var T = App.theme(), pad = { l: 52, r: 14, t: 24, b: 40 }, j;
              var lo = Math.min(0, Math.min.apply(null, seas)), hi = Math.max(0, Math.max.apply(null, seas));
              var R = yRange(lo, hi, h - pad.t - pad.b, 2);
              var P = App.plot(g, w, h, { xmin: -.5, xmax: m - .5, ymin: R.ymin, ymax: R.ymax, pad: pad, xcats: [], xlabel: '循環中的位置（資料順序）', ylabel: '比平均多（＋）或少（－）' });
              P.axes();
              P.hline(0, { color: T.ink, width: 1, dash: [] });
              var bw = (P.x1 - P.x0) / m * .6, a = U.ease(U.seg(t, 0, .8));
              for (j = 0; j < m; j++) {
                var y0 = P.sy(0), y1 = P.sy(seas[j] * a);
                g.fillStyle = seas[j] >= 0 ? App.colors[0] : App.colors[1];
                g.fillRect(P.sx(j) - bw / 2, Math.min(y0, y1), bw, Math.abs(y1 - y0));
              }
              g.save(); g.font = '11px system-ui, sans-serif'; g.fillStyle = T.muted; g.textAlign = 'center'; g.textBaseline = 'top';
              for (j = 0; j < m; j++) g.fillText(String(S.tl[j]).slice(-2), P.sx(j), P.y0 + 4);
              g.restore();
              P.legend([{ label: '高於平均', color: App.colors[0] }, { label: '低於平均', color: App.colors[1] }]);
            }
          }
        ],
        reading: '扣掉季節後，每期平均' + (full.slope >= 0 ? '成長 ' : '減少 ') + U.fmt(Math.abs(full.slope)) + '。' +
          '季節效果最高的位置是「' + hiL + '」，最淡的是「' + loL + '」。' +
          '考題誤差是 ' + U.pct(mape, 1) + '，' + (beat ? '贏過' : '沒有贏過') + '去年同期（' + U.pct(snM, 1) + '）。',
        caution: caution(S),
        action: '請負責排班或備貨的人，本週把「' + loL + '」這個最淡的位置排進行事曆，當成降低進貨或安排促銷的時間。',
        table: resultTable(S, '未來 ' + S.H + ' 期預測（趨勢加季節）與考題回測', bt, fut)
      };
    },
    thumb: function (g, w, h, t) {
      var r = ML.rng(33), P = App.plot(g, w, h, { bare: true, xmin: 0, xmax: 1, ymin: 0, ymax: 1 });
      var a = U.ease(U.seg(t, 0, .8)), i;
      for (i = 0; i < 12; i++) {
        var v = .5 + .3 * Math.sin(2 * Math.PI * i / 12) + (r() - .5) * .05;
        var cx = (i + .5) / 12, x0 = P.sx(cx - .025), x1 = P.sx(cx + .025);
        var y0 = P.sy(.5), y1 = P.sy(.5 + (v - .5) * a);
        g.fillStyle = v >= .5 ? App.colors[0] : App.colors[1];
        g.fillRect(x0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0));
      }
    }
  });
})();
