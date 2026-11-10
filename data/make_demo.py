# 產生內建示範資料（全為模擬）。固定 seed，重跑結果一致。
import numpy as np, json
r = np.random.default_rng(20261110)
out = {}
# 1) 每日營運 180 天
n=180
ad = np.round(r.uniform(0,5000,n),-2)
temp = np.round(r.uniform(12,34,n),1)
hol = (r.random(n)<0.28).astype(int)
disc = np.round(r.uniform(0,40,n))
rev = 18000 + 3.2*ad + 9000*hol - 250*(temp-24) + r.normal(0,2600,n)
profit = 6000 + 420*disc - 11.5*disc**2 + r.normal(0,650,n)
rows=[]
for i in range(n):
    rows.append({"日序":i+1,"廣告費":float(ad[i]),"氣溫":float(temp[i]),"假日":int(hol[i]),"折扣率":float(disc[i]),"營收":round(float(rev[i])),"毛利":round(float(profit[i]))})
for i,c in [(17,"廣告費"),(63,"營收"),(121,"氣溫")]: rows[i][c]=""
out["daily"]={"name":"每日營運 180 天（模擬）","cols":["日序","廣告費","氣溫","假日","折扣率","營收","毛利"],"rows":rows}
# 2) 會員 300 位：4 種人 + 8 位極端值
groups=[(70,(12,9,1500),(6,2.5,300)),(90,(45,4,900),(12,1.2,180)),(80,(120,2,600),(25,0.8,150)),(52,(25,14,420),(8,3,80))]
rows=[];k=0
for cnt,mu,sd in groups:
    for _ in range(cnt):
        R=max(1,r.normal(mu[0],sd[0]));F=max(1,round(r.normal(mu[1],sd[1])));A=max(120,r.normal(mu[2],sd[2]))
        k+=1;rows.append({"會員編號":f"M{k:04d}","最近購買天數":round(float(R)),"購買次數":int(F),"平均客單":round(float(A)),"累積金額":round(float(F*A))})
for _ in range(8):
    k+=1;F=int(r.integers(1,30));A=float(r.uniform(2800,5200));rows.append({"會員編號":f"M{k:04d}","最近購買天數":int(r.integers(1,300)),"購買次數":F,"平均客單":round(A),"累積金額":round(F*A)})
idx=r.permutation(len(rows));rows=[rows[i] for i in idx]
out["members"]={"name":"會員 300 位（模擬）","cols":["會員編號","最近購買天數","購買次數","平均客單","累積金額"],"rows":rows}
# 3) 回購 400 位
n=400
R=np.round(np.clip(r.gamma(2.2,28,n),1,300));F=np.clip(np.round(r.gamma(2.0,2.2,n))+1,1,30)
A=np.round(np.clip(r.normal(850,320,n),150,2600));C=(r.random(n)<0.4).astype(int)
z=1.1-0.028*R+0.33*F+0.0004*A+0.5*C-1.0
p=1/(1+np.exp(-z));y=(r.random(n)<p).astype(int)
rows=[{"會員編號":f"R{i+1:04d}","最近購買天數":int(R[i]),"購買次數":int(F[i]),"平均客單":int(A[i]),"用過折價券":int(C[i]),"之後回購":int(y[i])} for i in range(n)]
out["repurchase"]={"name":"回購紀錄 400 位（模擬）","cols":["會員編號","最近購買天數","購買次數","平均客單","用過折價券","之後回購"],"rows":rows}
# 4) 月營收 36 個月 2023-11..2026-10
season={1:1.18,2:1.12,3:0.95,4:0.93,5:1.0,6:0.97,7:0.92,8:0.94,9:0.98,10:1.2,11:0.96,12:1.06}
rows=[];y0,m0=2023,11
for i in range(36):
    m=(m0-1+i)%12+1;yy=y0+(m0-1+i)//12
    v=(820000+9500*i)*season[m]*(1+r.normal(0,0.03))
    rows.append({"月份":f"{yy}-{m:02d}","營收":round(float(v),-2)})
out["monthly"]={"name":"月營收 36 個月（模擬）","cols":["月份","營收"],"rows":rows}
json.dump(out,open("data/demo.json","w"),ensure_ascii=False,separators=(",",":"))
print({k:len(v["rows"]) for k,v in out.items()})
