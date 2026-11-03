"""Independent exhaustive discovery of optimizer counterexamples."""
import random,json,pathlib
rng=random.Random(19019);found={}
def bonus(n):return [0,0,0,1,3,6,10,15,20,25][n]
for trial in range(50000):
 n=7;values=[rng.randrange(1,8) for _ in range(n)];edges=[(i,j) for i in range(n) for j in range(i+1,n) if rng.random()<.35];adj=lambda i:[b if a==i else a for a,b in edges if i in (a,b)]
 paths=[]
 def walk(p):
  if len(p)>1:paths.append(p)
  for j in adj(p[-1]):
   if values[j]==values[p[-1]]+1:walk(p+[j])
 for i in range(n):walk([i])
 if len(paths)>22:continue
 sets=[];seen=set()
 for i in range(n):
  if i in seen:continue
  c=[i];seen.add(i)
  for j in c:
   for k in adj(j):
    if values[k]==values[i] and k not in seen:c.append(k);seen.add(k)
  if len(c)>1:sets.append(c)
 fixed=sum(values[c[0]]+len(c)-1 for c in sets)+bonus(max(map(len,sets),default=0));sc=set(sum(sets,[]))
 def evaluate(ps):
  covered=set(sum(ps,[]))|sc;sub=fixed+sum(values[p[-1]]+len(p)-1 for p in ps)+bonus(max(map(len,ps),default=0));return (sub-3*(n-len(covered)),sub)
 results=[]
 def collect(k,used,ps):
  if k==len(paths):results.append((evaluate(ps),ps));return
  collect(k+1,used,ps)
  if not used&set(paths[k]):collect(k+1,used|set(paths[k]),ps+[paths[k]])
 collect(0,set(),[]);best=max(r[0][0] for r in results)
 def greedy(key):
  selected=[];used=set()
  for p in sorted(paths,key=key,reverse=True):
   if not used&set(p):selected.append(p);used.update(p)
  return evaluate(selected)[0]
 checks={'longestFirst':greedy(len)<best,'highestPointsFirst':greedy(lambda p:values[p[-1]]+len(p)-1)<best}
 maxsub=max(r[0][1] for r in results);checks['subtotalOnly']=max(r[0][0] for r in results if r[0][1]==maxsub)<best
 maximal=[p for p in paths if not any(len(q)>len(p) and any(q[i:i+len(p)]==p for i in range(len(q)-len(p)+1)) for q in paths)]
 checks['maximalOnly']=max((r[0][0] for r in results if all(p in maximal for p in r[1])),default=-999)<best
 for key,yes in checks.items():
  if yes and key not in found:found[key]={'values':values,'edges':edges,'total':best}
 if len(found)==4:break
pathlib.Path('tests/regressions.json').write_text(json.dumps(found,indent=2)+'\n');print(list(found))
