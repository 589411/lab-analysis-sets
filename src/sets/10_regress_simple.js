// 範例套餐：簡單線性回歸。其他套餐請照這個檔案的寫法。
(function () {
  'use strict';
  var App = window.App, U = App.U, ML = window.ML;
  App.register({
    id: 'linear', cat: 'regress', needs: 'wide',
    zh: '簡單線性回歸', en: 'simple linear regression',
    ask: '多投入一點，成果多多少？', starter: true,
    blurb: '一個原因對一個結果。廣告費多一元，營收多幾元',
    question: '這個數字每增加 1，結果平均會增加多少？這個關係可靠嗎？',
    demo: 'daily',
    pipeline: ['刪掉有空值的列', '每 5 列留 1 列當考題', '用其餘資料畫出最貼近的直線', '用考題算誤差'],
    roles: [
      { key: 'x', label: '原因（X）', type: 'num', guess: ['廣告費'] },
      { key: 'y', label: '結果（Y）', type: 'num', guess: ['營收'], prefer: 'last' }
    ],
    params: [],
    minRows: 15,
    verified: '這個套餐的斜率、截距、R² 已用 scikit-learn 核對一致。',
    run: function (ctx) {
      var xn = ctx.cols.x, yn = ctx.cols.y;
      if (xn === yn) throw new Error('原因和結果選到同一個欄位了，請換一個。');
      var x = ctx.col(xn), y = ctx.col(yn), sp = ML.splitIdx(ctx.n);
      var xtr = ML.take(x, sp.train), ytr = ML.take(y, sp.train), xte = ML.take(x, sp.test), yte = ML.take(y, sp.test);
      var m = ML.simpleLinear(xtr, ytr);
      var pred = function (v) { return m.intercept + m.slope * v; };
      var r2tr = ML.r2(ytr, xtr.map(pred)), r2te = ML.r2(yte, xte.map(pred)), rmse = ML.rmse(yte, xte.map(pred));
      // 考題那一段的結果欄全都一樣時，R² 算不出來，直接說明而不是顯示「—」
      if (!isFinite(r2te)) throw new Error('考題那一段的「' + yn + '」全都一樣（都是 ' + U.fmt(yte[0]) + '），算不出 R²，也就無法判斷這條線準不準。請換一個欄位，或放更多資料進來。');
      var ex = U.extent(x), ey = U.extent(y), T;
      var weak = r2te < 0.2;
      return {
        note: '訓練 ' + sp.train.length + ' 列、考題 ' + sp.test.length + ' 列（每 5 列的第 5 列）',
        metrics: [
          { label: '斜率', value: U.fmt(m.slope), hint: xn + ' 每多 1，' + yn + ' 平均變動這麼多' },
          { label: '考題 R²', value: U.fmt(r2te, 3), hint: '1 是完全說得準，0 是跟猜平均一樣' },
          { label: '考題平均誤差', value: U.fmt(rmse), hint: '預測值通常會差這麼多（RMSE）' }
        ],
        charts: [{
          title: xn + ' 與 ' + yn, ratio: .62,
          draw: function (g, w, h, t) {
            T = App.theme();
            var P = App.plot(g, w, h, { xmin: ex[0], xmax: ex[1], ymin: ey[0], ymax: ey[1], xlabel: xn, ylabel: yn });
            P.axes();
            var a = U.ease(U.seg(t, 0, .35));       // 點先出現
            P.dots(xtr, ytr, { color: App.colors[0], alpha: .65 * a });
            P.dots(xte, yte, { color: App.colors[1], alpha: .9 * a, r: 3.6 });
            var b = U.ease(U.seg(t, .35, .8));      // 再畫出直線
            P.line([ex[0], ex[0] + (ex[1] - ex[0]) * b], [pred(ex[0]), pred(ex[0] + (ex[1] - ex[0]) * b)], { color: T.ink, width: 2.4 });
            if (t >= .8) {                            // 最後標出考題的誤差
              g.save(); g.globalAlpha = U.seg(t, .8, 1) * .5; g.strokeStyle = App.colors[1]; g.lineWidth = 1;
              for (var i = 0; i < xte.length; i++) { g.beginPath(); g.moveTo(P.sx(xte[i]), P.sy(yte[i])); g.lineTo(P.sx(xte[i]), P.sy(pred(xte[i]))); g.stroke(); }
              g.restore();
            }
            P.legend([{ label: '訓練資料', color: App.colors[0] }, { label: '考題', color: App.colors[1] }, { label: '回歸線', color: T.ink, line: true }]);
          }
        }],
        reading: weak
          ? xn + ' 幾乎說明不了 ' + yn + ' 的變化（考題 R² 只有 ' + U.fmt(r2te, 2) + '）。這條線不適合拿來做決定。'
          : xn + ' 每增加 1，' + yn + ' 平均' + (m.slope >= 0 ? '增加 ' : '減少 ') + U.fmt(Math.abs(m.slope)) + '。這條線能說明考題中約 ' + U.pct(Math.max(0, r2te), 0) + ' 的變化。',
        caution: '兩件事一起變動，不代表是前者造成後者。假日同時讓廣告和營收都變多，也會畫出這樣的線。資料範圍以外（比如 ' + xn + ' 超過 ' + U.fmt(Math.max.apply(null, x)) + '）不要用這條線外推。',
        action: weak ? '先不要用「' + xn + '」來預估「' + yn + '」；改試「多元線性回歸」套餐，把其他原因一起放進來。' : '挑一週把「' + xn + '」調高一級，記下實際的「' + yn + '」，和這條線的預測對一對。',
        table: {
          title: '模型摘要', head: ['項目', '數值'],
          rows: [['斜率', U.fmt(m.slope, 4)], ['截距', U.fmt(m.intercept, 2)], ['訓練 R²', U.fmt(r2tr, 4)], ['考題 R²', U.fmt(r2te, 4)], ['考題 RMSE', U.fmt(rmse, 2)], ['訓練列數', sp.train.length], ['考題列數', sp.test.length]]
        }
      };
    },
    // 卡片縮圖：t 在 0→1 之間循環。只用 App.theme() 與 App.colors 的顏色。
    thumb: function (g, w, h, t) {
      var T = App.theme(), r = ML.rng(7), P = App.plot(g, w, h, { bare: true, xmin: 0, xmax: 1, ymin: 0, ymax: 1 });
      var xs = [], ys = [], i;
      for (i = 0; i < 26; i++) { var x = .06 + r() * .88; xs.push(x); ys.push(U.clamp(.15 + .65 * x + (r() - .5) * .28, .04, .96)); }
      P.dots(xs, ys, { color: App.colors[0], r: Math.max(1.6, w / 70), alpha: .8 });
      var b = U.ease(U.seg(t, .1, .6));
      P.line([.04, .04 + .92 * b], [.15 + .65 * .04, .15 + .65 * (.04 + .92 * b)], { color: T.ink, width: Math.max(1.5, w / 90) });
    }
  });
})();
