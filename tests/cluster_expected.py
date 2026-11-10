# 分群套餐的期望值：用 scikit-learn / scipy 算，寫到 tests/cluster_expected.json。
# 資料：data/demo.json 的 members，取 最近購買天數、購買次數、平均客單，刪掉有空值的列，StandardScaler 標準化。
import json, pathlib
import numpy as np
from sklearn.cluster import KMeans, DBSCAN
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler
from scipy.cluster.hierarchy import linkage, fcluster

R = pathlib.Path(__file__).resolve().parent.parent
COLS = ['最近購買天數', '購買次數', '平均客單']
d = json.loads((R / 'data' / 'demo.json').read_text(encoding='utf-8'))['members']
rows = [r for r in d['rows'] if all(str(r[c]).strip() != '' for c in COLS)]
X = np.array([[float(r[c]) for c in COLS] for r in rows])
Z = StandardScaler().fit_transform(X)

out = {'n': int(len(Z)), 'kmeans': {}, 'silhouette': {}, 'hclust': {}, 'dbscan': {}}

for k in range(2, 7):
    km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(Z)
    out['kmeans'][str(k)] = {'inertia': float(km.inertia_), 'labels': km.labels_.tolist()}

km4 = KMeans(n_clusters=4, n_init=10, random_state=0).fit(Z)
out['silhouette'] = {'k': 4, 'labels': km4.labels_.tolist(), 'score': float(silhouette_score(Z, km4.labels_))}

L = linkage(Z, 'ward')
out['hclust']['dists_sorted'] = sorted(float(v) for v in L[:, 2])
for k in range(2, 7):
    out['hclust'][str(k)] = fcluster(L, k, criterion='maxclust').tolist()

for eps, ms in [(0.5, 5), (0.3, 8)]:
    db = DBSCAN(eps=eps, min_samples=ms).fit(Z)
    labels = db.labels_
    out['dbscan'][f'{eps}_{ms}'] = {
        'eps': eps, 'min_samples': ms,
        'labels': labels.tolist(),
        'n_clusters': int(len(set(labels.tolist()) - {-1})),
        'noise': [int(i) for i in np.where(labels == -1)[0]],
        'core_sample_indices': [int(i) for i in db.core_sample_indices_],
    }

(R / 'tests' / 'cluster_expected.json').write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
print('n =', len(Z))
for k in range(2, 7):
    print('kmeans k=%d inertia=%.6f' % (k, out['kmeans'][str(k)]['inertia']))
print('silhouette k=4 = %.10f' % out['silhouette']['score'])
print('hclust top dists:', [round(v, 4) for v in out['hclust']['dists_sorted'][-5:]])
for key, v in out['dbscan'].items():
    print('dbscan', key, 'clusters', v['n_clusters'], 'noise', len(v['noise']), 'core', len(v['core_sample_indices']))
