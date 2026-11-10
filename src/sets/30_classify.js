// 分類套餐：邏輯迴歸、決策樹、K 近鄰。要預測的是「兩種值」（例如會或不會）。
(function () {
  'use strict';
  var App = window.App, U = App.U, ML = window.ML;

  // ---------- 共用 ----------
  function rolesXY() {
    return [
      { key: 'x', label: '拿來判斷的欄位（可複選）', type: 'num', multi: true, min: 1, max: 6, guess: ['最近購買天數', '購買次數', '平均客單', '用過折價券'] },
      { key: 'y', label: '要預測的結果（兩種值）', type: 'bin', guess: ['之後回購'] }
    ];
  }
  // 檢查訓練或考題是不是只有一種結果
  function oneClass(yv, what, yn, lab) {
    var p = 0;
    yv.forEach(function (v) { if (v === 1) p++; });
    if (p === 0 || p === yv.length) {
      throw new Error(what + '裡「' + yn + '」全部都是同一個值（' + yn + '＝' + lab[p ? 1 : 0] + '），模型沒辦法學出差別。請換一份資料，或確認「要預測的結果」選對了。');
    }
  }
  // 切訓練／考題，並準備共用的文字與資料
  function prepXY(ctx) {
    var yn = ctx.cols.y, lab = ctx.labels.y, xs = ctx.cols.x;
    if (xs.indexOf(yn) >= 0) throw new Error('「要預測的結果」不能同時當成「拿來判斷的欄位」，請把「' + yn + '」從判斷欄位裡拿掉。');
    var sp = ML.splitIdx(ctx.n), y = ctx.col(yn), XA = ctx.X(xs);
    var ytr = ML.take(y, sp.train), yte = ML.take(y, sp.test);
    oneClass(ytr, '訓練資料', yn, lab);
    oneClass(yte, '考題', yn, lab);
    return {
      sp: sp, yn: yn, lab: lab, names: xs,
      Y1: yn + '＝' + lab[1], Y0: yn + '＝' + lab[0],
      Xtr: ML.take(XA, sp.train), Xte: ML.take(XA, sp.test), ytr: ytr, yte: yte
    };
  }
  function accOf(pred, y) {
    var c = 0;
    for (var i = 0; i < y.length; i++) if (pred[i] === y[i]) c++;
    return c / y.length;
  }
  // 座標軸（給 0–1 的機率用）
  function probAxes(g, P, T, h, label) {
    g.save();
    g.strokeStyle = T.muted; g.lineWidth = 1;
    g.beginPath(); g.moveTo(P.x0, P.y1); g.lineTo(P.x0, P.y0); g.lineTo(P.x1, P.y0); g.stroke();
    g.fillStyle = T.muted; g.font = '11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
    for (var i = 0; i <= 5; i++) g.fillText(U.pct(i / 5, 0), P.sx(i / 5), P.y0 + 5);
    g.fillStyle = T.ink; g.font = '12px system-ui, sans-serif'; g.textBaseline = 'bottom';
    g.fillText(label, (P.x0 + P.x1) / 2, h - 4);
    g.restore();
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  // 文字放不下時截短，加「…」
  function fitText(g, s, maxW) {
    if (maxW <= 0) return '';
    if (g.measureText(s).width <= maxW) return s;
    var cut = s;
    while (cut.length > 0 && g.measureText(cut + '…').width > maxW) cut = cut.slice(0, -1);
    return cut ? cut + '…' : '';
  }

  // ---------- 決策樹的版面 ----------
  function treeLayout(root) {
    var nodes = [], leaves = 0, depth = 0;
    function place(nd, d, parent) {
      var rec = { nd: nd, d: d, parent: parent, x: 0 };
      nodes.push(rec);
      if (d > depth) depth = d;
      if (!nd.left) { rec.x = leaves + .5; leaves++; rec.span = 1; }
      else {
        var a = place(nd.left, d + 1, rec), b = place(nd.right, d + 1, rec);
        rec.x = (a.x + b.x) / 2; rec.span = a.span + b.span;
      }
      return rec;
    }
    place(root, 0, null);
    return { nodes: nodes, leaves: leaves, depth: depth };
  }
  function drawTree(g, w, h, t, root, T) {
    var lay = treeLayout(root), pad = 8, levels = lay.depth + 1;
    var slot = (w - 2 * pad) / lay.leaves, levelH = (h - 2 * pad) / levels;
    var bh = Math.max(18, Math.min(40, levelH * .62));
    var bw = Math.max(10, Math.min(120, slot * .88));
    function cx(rec) { return pad + rec.x * slot; }
    function cy(d) { return pad + (d + .5) * levelH; }
    function alpha(d) { return U.ease(U.seg(t, d * .8 / levels, d * .8 / levels + .2)); }   // 一層一層出現
    var fsOf = function (d) { return Math.max(8, Math.round(12 - d * 1.2)); };
    g.save();
    // 連線
    lay.nodes.forEach(function (rec) {
      if (!rec.parent) return;
      g.globalAlpha = alpha(rec.d);
      g.strokeStyle = T.muted; g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(cx(rec.parent), cy(rec.parent.d) + bh / 2);
      g.lineTo(cx(rec), cy(rec.d) - bh / 2);
      g.stroke();
    });
    // 方框與文字
    lay.nodes.forEach(function (rec) {
      var nd = rec.nd, a = alpha(rec.d), x = cx(rec) - bw / 2, y = cy(rec.d) - bh / 2, fs = fsOf(rec.d);
      g.font = fs + 'px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      if (!nd.left) {
        var ratio = nd.pos / nd.n, col = ratio >= .5 ? T.good : T.muted;
        g.globalAlpha = a * (.18 + .5 * Math.abs(ratio - .5) * 2);
        g.fillStyle = col;
        roundRect(g, x, y, bw, bh, 6); g.fill();
        g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = 1; roundRect(g, x, y, bw, bh, 6); g.stroke();
        g.fillStyle = T.ink;
        var pct = U.pct(ratio, 0);
        if (rec.d < 4 && bw >= 56 && bh >= 28) {
          g.fillText(fitText(g, U.fmt(nd.n) + ' 人', bw - 8), cx(rec), cy(rec.d) - fs * .65);
          g.font = 'bold ' + fs + 'px system-ui, sans-serif';
          g.fillText(fitText(g, pct, bw - 8), cx(rec), cy(rec.d) + fs * .7);
        } else {
          g.font = 'bold ' + fs + 'px system-ui, sans-serif';
          g.fillText(fitText(g, pct, bw - 8), cx(rec), cy(rec.d));
        }
      } else {
        g.globalAlpha = a;
        var bwI = Math.max(bw, Math.min(132, slot * rec.span * .92)); x = cx(rec) - bwI / 2;
        g.fillStyle = T.card; roundRect(g, x, y, bwI, bh, 6); g.fill();
        g.strokeStyle = T.line; g.lineWidth = 1; roundRect(g, x, y, bwI, bh, 6); g.stroke();
        // 內節點兩行：欄名（可能截短加「…」）、切點
        var thrTxt = '≤ ' + String(Math.round(nd.threshold * 100) / 100) + '？';
        g.fillStyle = T.ink;
        g.fillText(fitText(g, nd.feature_name || '', bwI - 8), cx(rec), cy(rec.d) - fs * .55);
        g.fillText(fitText(g, thrTxt, bwI - 8), cx(rec), cy(rec.d) + fs * .65);
      }
    });
    g.restore();
  }

  // ---------- 1. 邏輯迴歸 ----------
  App.register({
    id: 'logit', cat: 'classify', needs: 'labeled',
    zh: '邏輯迴歸', en: 'logistic regression',
    ask: '誰最可能再回來買？', starter: true,
    blurb: '算出每個人會回購的機率。名單排序',
    question: '每位會員之後會不會再回來？用手上已知的資料算出機率，排成名單。',
    demo: 'repurchase',
    pipeline: ['刪掉有空值的列', '每 5 列留 1 列當考題', '把判斷欄位標準化，算出每個人的機率', '用考題算準確率與 AUC'],
    roles: rolesXY(),
    params: [
      { key: 'threshold', label: '機率多高才算會', type: 'range', min: .1, max: .9, step: .05, value: .5, fmt: function (v) { return U.pct(v, 0); }, tip: '門檻越高，名單越短，但每一位都比較有把握。' }
    ],
    minRows: 30,
    verified: '邏輯迴歸的係數、考題機率與 AUC 已用 scikit-learn 核對一致。',
    run: function (ctx) {
      var P = prepXY(ctx), yn = P.yn, lab = P.lab, names = P.names, thr = ctx.params.threshold;
      var st = ML.standardize(P.Xtr), Zte = ML.standardize(P.Xte, st.mean, st.std).Z;
      var m = ML.logistic(st.Z, P.ytr, { maxIter: 50 });
      var pte = ML.logisticProba(m, Zte);
      var pred = pte.map(function (p) { return p >= thr ? 1 : 0; });
      var cm = ML.confusion(P.yte, pred), nT = P.yte.length;
      var nList = cm.tp + cm.fp, prec = nList ? cm.tp / nList : NaN, rec = cm.tp / (cm.tp + cm.fn);
      var acc = (cm.tp + cm.tn) / nT, auc = ML.auc(P.yte, pte);
      var order = names.map(function (_, j) { return j; }).sort(function (a, b) {
        return (Math.abs(m.coef[b]) - Math.abs(m.coef[a])) || (a - b);
      });
      var top = order[0];
      var rj = ML.rng(20261110), jit = P.yte.map(function () { return (rj() - .5) * .12; });
      var dirTxt = m.coef[top] >= 0 ? '數字越大，越容易是「' + P.Y1 + '」' : '數字越小，越容易是「' + P.Y1 + '」';
      return {
        note: '訓練 ' + P.sp.train.length + ' 列、考題 ' + P.sp.test.length + ' 列（每 5 列的第 5 列）',
        metrics: [
          { label: '考題準確率', value: U.pct(acc, 1), hint: '考題中猜對的比例' },
          { label: '精準率', value: isFinite(prec) ? U.pct(prec, 1) : '—', hint: nList ? '名單上的人裡，實際是「' + P.Y1 + '」的比例' : '門檻太高，沒有人被列進名單' },
          { label: '召回率', value: U.pct(rec, 1), hint: '實際是「' + P.Y1 + '」的人裡，被列進名單的比例' },
          { label: 'AUC', value: U.fmt(auc, 3), hint: '1 是完全排對，0.5 跟亂猜一樣' }
        ],
        charts: [{
          title: '考題的預測機率', ratio: .62,
          caption: '每個點是一位考題的人。上排是實際＝' + lab[1] + '，下排是實際＝' + lab[0] + '。虛線右邊是被列進名單的範圍。',
          draw: function (g, w, h, t) {
            var T = App.theme();
            var P2 = App.plot(g, w, h, { xmin: 0, xmax: 1, ymin: 0, ymax: 1, pad: { l: 66, r: 14, t: 30, b: 40 } });
            g.save();
            g.globalAlpha = .12 * U.seg(t, 0, .3); g.fillStyle = App.theme().accent;
            g.fillRect(P2.sx(thr), P2.y1, P2.x1 - P2.sx(thr), P2.y0 - P2.y1);
            g.restore();
            probAxes(g, P2, T, h, '預測的機率（模型覺得會的可能性）');
            P2.vline(thr, { color: T.ink, width: 1.4, dash: [5, 4] });
            P2.text(thr, 1, '門檻 ' + U.pct(thr, 0), { align: 'center', base: 'top', size: 11, dy: 2 });
            g.save();
            g.fillStyle = T.ink; g.font = '11.5px system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
            g.fillText('實際＝' + lab[1], P2.x0 - 6, P2.sy(.6));
            g.fillText('實際＝' + lab[0], P2.x0 - 6, P2.sy(.25));
            g.restore();
            var a = U.ease(U.seg(t, 0, .8));
            g.save();
            for (var i = 0; i < P.yte.length; i++) {
              var rowY = P.yte[i] === 1 ? .6 : .25;
              var px = P2.x0 + (P2.sx(pte[i]) - P2.x0) * a;
              var py = P2.sy(rowY + jit[i]);
              g.globalAlpha = .8 * U.seg(t, 0, .2);
              g.fillStyle = P.yte[i] === 1 ? App.colors[0] : App.colors[1];
              g.beginPath(); g.arc(px, py, 3.4, 0, 6.2832); g.fill();
            }
            g.restore();
          }
        }, {
          title: '猜對與猜錯', ratio: .7,
          caption: P.Y1 + ' 算作「會」，' + P.Y0 + ' 算作「不會」。綠色的格子是猜對，紅色的格子是猜錯。',
          draw: function (g, w, h, t) {
            var T = App.theme(), lx = 66, top = 30, cw = (w - lx - 8) / 2, ch = (h - top - 8) / 2;
            var a = U.ease(U.seg(t, 0, .6));
            var cells = [
              { r: 0, c: 0, n: cm.tp, good: true, t1: '猜會，實際也會' },
              { r: 0, c: 1, n: cm.fn, good: false, t1: '猜不會，實際卻會' },
              { r: 1, c: 0, n: cm.fp, good: false, t1: '猜會，實際卻不會' },
              { r: 1, c: 1, n: cm.tn, good: true, t1: '猜不會，實際也不會' }
            ];
            g.save();
            g.fillStyle = T.muted; g.font = '12px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
            g.fillText('猜會', lx + cw / 2, top - 6); g.fillText('猜不會', lx + cw * 1.5, top - 6);
            g.textAlign = 'right'; g.textBaseline = 'middle';
            g.fillText('實際會', lx - 6, top + ch / 2); g.fillText('實際不會', lx - 6, top + ch * 1.5);
            cells.forEach(function (c) {
              var x = lx + c.c * cw + 3, y = top + c.r * ch + 3, ww = cw - 6, hh = ch - 6, col = c.good ? T.good : T.bad;
              g.globalAlpha = a * .15; g.fillStyle = col; g.fillRect(x, y, ww, hh);
              g.globalAlpha = a; g.strokeStyle = T.line; g.lineWidth = 1; g.strokeRect(x, y, ww, hh);
              g.globalAlpha = a; g.fillStyle = T.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
              g.font = '700 18px system-ui, sans-serif';
              g.fillText(U.fmt(c.n), x + ww / 2, y + hh / 2 - 9);
              g.font = '11px system-ui, sans-serif';
              g.fillText(fitText(g, c.t1, ww - 6), x + ww / 2, y + hh / 2 + 11);
            });
            g.restore();
          }
        }],
        reading: nList
          ? '把門檻設在 ' + U.pct(thr, 0) + '，考題 ' + U.fmt(nT) + ' 人裡有 ' + U.fmt(nList) + ' 人被列進名單，其中 ' + U.fmt(cm.tp) + ' 人真的是「' + P.Y1 + '」（精準率 ' + U.pct(prec, 0) + '）。影響最大的是『' + names[top] + '』，' + dirTxt + '。'
          : '把門檻設在 ' + U.pct(thr, 0) + '，考題裡沒有人被列進名單。把門檻調低再看看。影響最大的是『' + names[top] + '』。',
        caution: '這是過去資料裡的規律，只代表它們一起出現，不代表是原因。考題只有 ' + U.fmt(nT) + ' 列，數字會上下起伏；名單外的人也可能回來。',
        action: '本週可以做的：用同一個模型替全部會員算出機率，把高於 ' + U.pct(thr, 0) + ' 的人排成名單，先聯絡其中一批，記下結果，之後和名單對一對。',
        table: {
          title: '各欄位的影響（勝算比＝每多 1 個標準差的倍數）',
          head: ['欄位', '係數（標準化後）', '勝算比'],
          rows: order.map(function (j) { return [names[j], U.fmt(m.coef[j], 3), U.fmt(Math.exp(m.coef[j]), 3)]; })
        }
      };
    },
    // 卡片縮圖：一堆點分成兩類，S 形的機率曲線慢慢畫出來
    thumb: function (g, w, h, t) {
      var T = App.theme(), r = ML.rng(11), P = App.plot(g, w, h, { bare: true, xmin: 0, xmax: 1, ymin: 0, ymax: 1 });
      var xs = [], ys = [], cs = [], i;
      for (i = 0; i < 40; i++) {
        var x = .04 + r() * .92, yv = (x + (r() - .5) * .5 > .5) ? 1 : 0;
        xs.push(x); ys.push(U.clamp((yv ? .72 : .28) + (r() - .5) * .18, .04, .96)); cs.push(yv);
      }
      P.dots(xs, ys, { color: function (k) { return cs[k] ? App.colors[0] : App.colors[1]; }, r: Math.max(1.6, w / 70), alpha: .85 });
      var cx = [], cy = [];
      for (i = 0; i <= 40; i++) { var u = i / 40; cx.push(u); cy.push(1 / (1 + Math.exp(-12 * (u - .5)))); }
      P.line(cx, cy, { color: T.ink, width: Math.max(1.5, w / 90), frac: U.ease(U.seg(t, .1, .7)) });
    }
  });

  // ---------- 2. 決策樹 ----------
  App.register({
    id: 'tree', cat: 'classify', needs: 'labeled',
    zh: '決策樹', en: 'decision tree',
    ask: '怎麼用幾條規則判斷？',
    blurb: '把判斷寫成幾條規則。給店員看的準則',
    question: '能不能把判斷寫成幾條簡單規則，讓店員一看就知道哪些人容易回來？',
    demo: 'repurchase',
    pipeline: ['刪掉有空值的列', '每 5 列留 1 列當考題', '每一步挑出最能分開兩種結果的切點', '把每條路徑寫成規則，用考題檢查'],
    roles: rolesXY(),
    params: [
      { key: 'depth', label: '最多問幾層', type: 'range', min: 1, max: 5, value: 3, tip: '層數越多，規則越細，也越容易背答案。' }
    ],
    minRows: 30,
    verified: '決策樹的根節點切點與各深度的準確率已用 scikit-learn 核對一致。',
    run: function (ctx) {
      var P = prepXY(ctx), names = P.names, depth = ctx.params.depth;
      var tr = ML.tree(P.Xtr, P.ytr, { maxDepth: depth, minLeaf: 5 });
      var ptr = ML.treePredict(tr, P.Xtr), pte = ML.treePredict(tr, P.Xte);
      var accTr = accOf(ptr, P.ytr), accTe = accOf(pte, P.yte);
      var rules = ML.treeRules(tr, names);
      var gap = accTr - accTe;
      var ruleTxt = function (r) { return r.conds.length ? r.conds.join(' 且 ') : '全部（不再切）'; };
      var best = rules.filter(function (r) { return r.n >= 10; })
        .sort(function (a, b) { return (b.ratio - a.ratio) || (b.n - a.n); })[0];
      // 把欄名塞進節點（畫圖用）
      (function tag(nd) {
        if (!nd.left) return;
        nd.feature_name = names[nd.feature];
        tag(nd.left); tag(nd.right);
      })(tr);
      return {
        note: '訓練 ' + P.sp.train.length + ' 列、考題 ' + P.sp.test.length + ' 列（每 5 列的第 5 列）',
        metrics: [
          { label: '考題準確率', value: U.pct(accTe, 1), hint: '考題中猜對的比例' },
          { label: '訓練準確率', value: U.pct(accTr, 1), hint: gap > .1 ? '訓練準確率明顯高於考題，要留意是不是「背答案了」' : '和考題差不多，沒有明顯背答案' },
          { label: '葉子數', value: U.fmt(rules.length), hint: '每一格結論就是一條規則；越多越細' }
        ],
        charts: [{
          title: '決策樹（每一層的判斷）', ratio: .8,
          caption: '方框是判斷，葉子格是結論。葉子格的百分比是「' + P.Y1 + '」的比例（綠色表示比例高，灰色表示比例低）。葉子格夠寬時會多寫人數。',
          draw: function (g, w, h, t) { drawTree(g, w, h, t, tr, App.theme()); }
        }],
        reading: best
          ? '符合「' + ruleTxt(best) + '」的 ' + U.fmt(best.n) + ' 人（訓練資料），有 ' + U.pct(best.ratio, 0) + ' 是「' + P.Y1 + '」。'
          : '沒有任何一條規則的人數達到 10 人。把「最多問幾層」調低，或放入更多資料。',
        caution: '決策樹很容易把樣本少的偶然規律當成真的。人數少的規則先不要當成準則，換一批資料再檢查。',
        action: best
          ? '把「' + ruleTxt(best) + '」當成店員的初步判斷準則，本週試用一次，記下實際結果，看看準不準。'
          : '先把「最多問幾層」調成 2 或 3 再看一次。',
        table: {
          title: '每條規則（以訓練資料計算）',
          head: ['規則（從上到下的條件）', '人數', '「' + P.Y1 + '」的比例'],
          rows: rules.slice().sort(function (a, b) { return (b.ratio - a.ratio) || (b.n - a.n); })
            .map(function (r) { return [ruleTxt(r), U.fmt(r.n), U.pct(r.ratio, 1)]; })
        }
      };
    },
    // 卡片縮圖：一棵小樹一層一層長出來
    thumb: function (g, w, h, t) {
      var T = App.theme();
      var nodes = [
        { x: .5, y: .16, d: 0 },
        { x: .27, y: .48, d: 1, p: 0 }, { x: .73, y: .48, d: 1, p: 0 },
        { x: .15, y: .8, d: 2, p: 1, c: App.colors[1] }, { x: .39, y: .8, d: 2, p: 1, c: App.colors[0] },
        { x: .61, y: .8, d: 2, p: 2, c: App.colors[0] }, { x: .85, y: .8, d: 2, p: 2, c: App.colors[1] }
      ];
      var bw = w * .17, bh = h * .11;
      function al(d) { return U.ease(U.seg(t, .05 + d * .22, .27 + d * .22)); }
      g.save();
      nodes.forEach(function (n) {
        if (n.p === undefined) return;
        var pa = nodes[n.p];
        g.globalAlpha = al(n.d); g.strokeStyle = T.muted; g.lineWidth = Math.max(1, w / 150);
        g.beginPath(); g.moveTo(pa.x * w, pa.y * h + bh / 2); g.lineTo(n.x * w, n.y * h - bh / 2); g.stroke();
      });
      nodes.forEach(function (n) {
        var a = al(n.d), x = n.x * w - bw / 2, y = n.y * h - bh / 2;
        g.globalAlpha = a;
        if (n.c) { g.fillStyle = n.c; g.globalAlpha = a * .3; roundRect(g, x, y, bw, bh, 3); g.fill(); g.globalAlpha = a; g.strokeStyle = n.c; }
        else { g.fillStyle = T.card; roundRect(g, x, y, bw, bh, 3); g.fill(); g.strokeStyle = T.muted; }
        g.lineWidth = Math.max(1, w / 150); roundRect(g, x, y, bw, bh, 3); g.stroke();
      });
      g.restore();
    }
  });

  // ---------- 3. K 近鄰 ----------
  App.register({
    id: 'knn', cat: 'classify', needs: 'labeled',
    zh: 'K 近鄰', en: 'k-nearest neighbors',
    ask: '和他相像的人後來怎麼做？', advanced: true,
    blurb: '看最像的幾個鄰居怎麼做。相似顧客推估',
    question: '和最像的幾位顧客做得一樣，就能猜出這位顧客的結果嗎？',
    demo: 'repurchase',
    pipeline: ['刪掉有空值的列', '每 5 列留 1 列當考題', '兩個欄位標準化，算出每位考題的最近鄰居', '看鄰居多數是哪一種，並和基準比較'],
    roles: [
      { key: 'x1', label: '欄位一（橫軸）', type: 'num', guess: ['最近購買天數'] },
      { key: 'x2', label: '欄位二（縱軸）', type: 'num', guess: ['購買次數'] },
      { key: 'y', label: '要預測的結果（兩種值）', type: 'bin', guess: ['之後回購'] }
    ],
    params: [
      { key: 'k', label: '看幾個鄰居', type: 'range', min: 1, max: 25, step: 2, value: 7, tip: '鄰居越多，判斷越平穩，但越不容易抓到細節。' }
    ],
    minRows: 30, maxRows: 3000,
    verified: 'K 近鄰已用獨立的 Python 暴力法核對一致（距離相同時取資料順序在前者）。與 scikit-learn 相比，80 筆考題中有 2 到 3 筆不同，都發生在距離並列的點。',
    run: function (ctx) {
      var x1 = ctx.cols.x1, x2 = ctx.cols.x2, yn = ctx.cols.y, lab = ctx.labels.y;
      if (x1 === x2) throw new Error('欄位一和欄位二選到同一個欄位了，請換一個。');
      if (x1 === yn || x2 === yn) throw new Error('「要預測的結果」不能同時當成判斷的欄位，請換掉其中一個。');
      var Y1 = yn + '＝' + lab[1], Y0 = yn + '＝' + lab[0];
      var sp = ML.splitIdx(ctx.n), XA = ctx.X([x1, x2]), y = ctx.col(yn);
      var Xtr = ML.take(XA, sp.train), Xte = ML.take(XA, sp.test);
      var ytr = ML.take(y, sp.train), yte = ML.take(y, sp.test);
      oneClass(ytr, '訓練資料', yn, lab);
      oneClass(yte, '考題', yn, lab);
      var k = ctx.params.k;
      if (k > Xtr.length) throw new Error('訓練資料只有 ' + Xtr.length + ' 列，「看幾個鄰居」不能超過這個數字。');
      var st = ML.standardize(Xtr), Ztr = st.Z, Zte = ML.standardize(Xte, st.mean, st.std).Z;
      var pte = ML.knnProba(Ztr, ytr, Zte, k);
      var acc = accOf(pte.map(function (p) { return p > .5 ? 1 : 0; }), yte);
      var majority = ytr.reduce(function (a, b) { return a + b; }, 0) * 2 >= ytr.length ? 1 : 0;
      var base = accOf(yte.map(function () { return majority; }), yte);
      // 不同 k 的考題準確率（奇數，且不超過訓練列數）
      var ks = [], accs = [];
      for (var kk = 1; kk <= 25; kk += 2) {
        if (kk > Xtr.length) break;
        ks.push(kk);
        accs.push(accOf(ML.knnProba(Ztr, ytr, Zte, kk).map(function (p) { return p > .5 ? 1 : 0; }), yte));
      }
      var idxK = ks.indexOf(k);
      // 地圖：每個格子的中心點用模型猜一次（只算一次，畫圖時不重算）
      var ex1 = U.extent(ctx.col(x1)), ex2 = U.extent(ctx.col(x2)), GW = 36, GH = 24, zq = [], j, i;
      for (j = 0; j < GH; j++) for (i = 0; i < GW; i++) {
        var rx = ex1[0] + (i + .5) / GW * (ex1[1] - ex1[0]), ry = ex2[0] + (j + .5) / GH * (ex2[1] - ex2[0]);
        zq.push([(rx - st.mean[0]) / st.std[0], (ry - st.mean[1]) / st.std[1]]);
      }
      var gp = ML.knnProba(Ztr, ytr, zq, k).map(function (p) { return p > .5 ? 1 : 0; });
      // 示範：第 1 筆考題的 k 個鄰居範圍
      var q0 = Zte[0], nb = ML.knnNeighbors(Ztr, q0, k), dk = Math.sqrt(ML.dist2(Ztr[nb[k - 1]], q0));
      var diff = acc - base;
      var useful = diff > .03;
      return {
        note: '訓練 ' + sp.train.length + ' 列、考題 ' + sp.test.length + ' 列（每 5 列的第 5 列）',
        metrics: [
          { label: '考題準確率', value: U.pct(acc, 1), hint: 'k 個鄰居投票，猜對的比例' },
          { label: '基準', value: U.pct(base, 1), hint: '全部猜多數那一類的準確率，要贏過這個才有用' }
        ],
        charts: [{
          title: '地圖：每個位置會猜什麼', ratio: .75,
          caption: '底色是模型在每個位置的猜法（藍＝猜 ' + Y1 + '，橘＝猜 ' + Y0 + '）。圓是第 1 筆考題的 ' + k + ' 個最近鄰居範圍（欄位在標準化後是正圓，畫面上會變成橢圓）。',
          draw: function (g, w, h, t) {
            var T = App.theme();
            var P = App.plot(g, w, h, { xmin: ex1[0], xmax: ex1[1], ymin: ex2[0], ymax: ex2[1], xlabel: x1, ylabel: x2 });
            var cw = (P.x1 - P.x0) / GW, ch = (P.y0 - P.y1) / GH;
            g.save();
            for (var jj = 0; jj < GH; jj++) for (var ii = 0; ii < GW; ii++) {
              g.globalAlpha = .18;
              g.fillStyle = gp[jj * GW + ii] ? App.colors[0] : App.colors[1];
              g.fillRect(P.x0 + ii * cw, P.y0 - (jj + 1) * ch, cw + .5, ch + .5);
            }
            g.restore();
            P.axes();
            P.dots(Xtr.map(function (r) { return r[0]; }), Xtr.map(function (r) { return r[1]; }), {
              color: function (q) { return ytr[q] ? App.colors[0] : App.colors[1]; }, r: 2.8, alpha: .95
            });
            var cxp = P.sx(Xte[0][0]), cyp = P.sy(Xte[0][1]);
            var rxPx = Math.abs(P.sx(Xte[0][0] + dk * st.std[0]) - cxp), ryPx = Math.abs(P.sy(Xte[0][1] + dk * st.std[1]) - cyp);
            var s = U.ease(U.seg(t, 0, .7));
            if (s > 0) {
              g.save();
              g.globalAlpha = .12; g.fillStyle = T.accent;
              g.beginPath(); g.ellipse(cxp, cyp, rxPx * s, ryPx * s, 0, 0, 6.2832); g.fill();
              g.globalAlpha = 1; g.strokeStyle = T.ink; g.lineWidth = 1.2;
              g.stroke();
              g.restore();
            }
            g.save();
            g.globalAlpha = U.seg(t, .6, 1); g.strokeStyle = T.ink; g.lineWidth = 1.6;
            nb.forEach(function (q) {
              g.beginPath(); g.arc(P.sx(Xtr[q][0]), P.sy(Xtr[q][1]), 4.6, 0, 6.2832); g.stroke();
            });
            g.restore();
            g.save();
            g.globalAlpha = U.seg(t, 0, .2); g.fillStyle = T.ink;
            g.beginPath(); g.arc(cxp, cyp, 4, 0, 6.2832); g.fill();
            g.restore();
          }
        }, {
          title: '看幾個鄰居比較準', ratio: .62,
          caption: '每個點是一種 k 的考題準確率。虛線是目前選的 k；灰色水平線是「全部猜多數」的準確率。',
          draw: function (g, w, h, t) {
            var T = App.theme();
            var lo = Math.min(base, Math.min.apply(null, accs)) - .03, hi = Math.max(base, Math.max.apply(null, accs)) + .03;
            lo = Math.max(0, lo); hi = Math.min(1, hi);
            if (hi - lo < .1) { lo = Math.max(0, lo - .05); hi = Math.min(1, hi + .05); }
            var xs = ks.map(function (_, q) { return q; });
            var P2 = App.plot(g, w, h, { xmin: -.5, xmax: ks.length - .5, ymin: lo, ymax: hi, xcats: ks.map(String), ylabel: '考題準確率', yfmt: function (v) { return U.pct(v, 0); } });
            P2.axes();
            P2.hline(base, { color: T.muted, dash: [4, 4] });
            if (idxK >= 0) P2.vline(idxK, { color: T.ink, width: 1.2, dash: [5, 4] });
            P2.line(xs, accs, { color: App.colors[0], width: 2.4, frac: U.ease(t) });
            P2.dots(xs, accs, { color: App.colors[0], r: 3.2, alpha: t >= .95 ? 1 : t });
          }
        }],
        reading: useful
          ? '考題準確率 ' + U.pct(acc, 1) + '，比「全部猜多數」的 ' + U.pct(base, 1) + ' 高出 ' + (diff * 100).toFixed(1) + ' 個百分點，有一點參考價值。'
          : diff >= 0
            ? '考題準確率 ' + U.pct(acc, 1) + '，只比「全部猜多數」的 ' + U.pct(base, 1) + ' 高一點點（不到 3 個百分點），這兩個欄位目前幫不上太多忙。'
            : '考題準確率 ' + U.pct(acc, 1) + '，比「全部猜多數」的 ' + U.pct(base, 1) + ' 還低，這時直接猜多數還比較準。',
        caution: '只用了兩個欄位，其他因素沒放進來。考題只有 ' + U.fmt(yte.length) + ' 列，換 k 或換一批資料，準確率可能明顯變動。鄰居相似，也不代表結果一定相同。',
        action: useful
          ? '把「' + x1 + '」和「' + x2 + '」相近的顧客歸成一組（例如同一批推播對象），本週對這組做一次行動，記下結果。'
          : '先換欄位或增加資料再試一次；如果都贏不過基準，就先不要用這個方法。',
        table: {
          title: '不同 k 的考題準確率',
          head: ['看幾個鄰居（k）', '考題準確率'],
          rows: ks.map(function (kv, q) { return [U.fmt(kv), U.pct(accs[q], 1)]; })
        }
      };
    },
    // 卡片縮圖：兩類的點，中間一個圓慢慢放大，包住最近的幾個點
    thumb: function (g, w, h, t) {
      var T = App.theme(), r = ML.rng(5), P = App.plot(g, w, h, { bare: true, xmin: 0, xmax: 1, ymin: 0, ymax: 1 });
      var xs = [], ys = [], cs = [], i;
      for (i = 0; i < 34; i++) {
        var x = r(), y = r(), c = (x + y > 1) ? 1 : 0;
        if (r() < .15) c = 1 - c;
        xs.push(x); ys.push(y); cs.push(c);
      }
      P.dots(xs, ys, { color: function (q) { return cs[q] ? App.colors[0] : App.colors[1]; }, r: Math.max(1.6, w / 70), alpha: .85 });
      var qx = .5, qy = .5, rad = .04 + .3 * U.ease(t), dd = [];
      for (i = 0; i < xs.length; i++) dd.push({ i: i, d: Math.hypot(xs[i] - qx, (ys[i] - qy) * (h / w)) });
      dd.sort(function (a, b) { return a.d - b.d; });
      var kth = dd[6].d * U.ease(U.clamp(t * 1.4, 0, 1));
      P.dots([qx], [qy], { color: T.ink, r: Math.max(2, w / 60) });
      g.save();
      g.strokeStyle = T.ink; g.lineWidth = Math.max(1, w / 150);
      g.beginPath(); g.arc(P.sx(qx), P.sy(qy), kth * w, 0, 6.2832); g.stroke();   // 距離已換成像素比例，畫正圓
      g.restore();
    }
  });
})();
