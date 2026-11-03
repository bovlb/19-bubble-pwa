"""Independent Python v1 reference. Run deliberately, never from tests."""
import hashlib,json,pathlib
from functools import lru_cache
root=pathlib.Path(__file__).resolve().parents[1]
adj=(root/'src/dictionaries/adjectives.txt').read_text().splitlines()
nouns=(root/'src/dictionaries/nouns.txt').read_text().splitlines()
offsets=[(1,0),(0,1),(-1,1),(-1,0),(0,-1),(1,-1)]
def stream(domain,key):
 i=0
 while True:
  digest=hashlib.sha256(f'bubble19:{domain}:{key}:{i}'.encode()).digest();i+=1
  for j in range(0,32,4):yield int.from_bytes(digest[j:j+4],'big')
def draw(s,m):
 while True:
  x=next(s)
  if x<(2**32//m)*m:return x%m
def make(a,n):
 key=f'v1:{a}:{n}';code=f'v1-{a}-{n}-{int.from_bytes(hashlib.sha256(("bubble19:check:"+key).encode()).digest(),"big")%100:02d}'
 gs,ds=stream('graph',key),stream('dice',key);cells={(0,0)}
 while len(cells)<19:
  frontier=sorted({(q+dq,r+dr) for q,r in cells for dq,dr in offsets}-cells)
  weights=[sum((q+dq,r+dr) in cells for dq,dr in offsets)**2 for q,r in frontier];x=draw(gs,sum(weights))
  for p,w in zip(frontier,weights):
   if x<w:cells.add(p);break
   x-=w
 mq,mr=min(q for q,r in cells),min(r for q,r in cells);coords=sorted((q-mq,r-mr) for q,r in cells)
 edges=[(i,j) for i,(q,r) in enumerate(coords) for j,(s,t) in enumerate(coords) if i<j and (s-q,t-r) in offsets]
 dice=[(draw(ds,6),1+draw(ds,6)) for _ in range(19)];moves=[];occupied=set();values=[None]*19
 ops=['add','subtract','multiply','min','max']
 for turn,(a,b) in enumerate(dice):
  node=next(i for i in range(19) if i not in occupied and (not occupied or any((x==i and y in occupied) or (y==i and x in occupied) for x,y in edges)))
  operation=ops[turn%5];values[node]=[a+b,abs(a-b),a*b,min(a,b),max(a,b)][turn%5];moves.append({'nodeId':node,'operation':operation});occupied.add(node)
 return dict(code=code,coordinates=coords,edges=edges,dice=dice,moves=moves,total=exact(edges,values))
def exact(edges,values):
 # Independent exhaustive collection enumeration for the sparse generated histories.
 neighbors=lambda i:[b if a==i else a for a,b in edges if i in (a,b)]
 groups=[];seen=set()
 for i in range(len(values)):
  if i in seen:continue
  component={i};todo=[i];seen.add(i)
  while todo:
   for j in neighbors(todo.pop()):
    if values[j]==values[i] and j not in seen:seen.add(j);component.add(j);todo.append(j)
  if len(component)>1:groups.append(component)
 b=lambda n: [0,0,0,1,3,6,10,15,20,25][n] if n<10 else 25+5*(n-9)
 fixed=sum(values[next(iter(g))]+len(g)-1 for g in groups)+b(max(map(len,groups),default=0));covered=set().union(*groups) if groups else set();paths=[]
 def visit(p):
  if len(p)>1:paths.append((set(p),values[p[-1]]+len(p)-1))
  for j in neighbors(p[-1]):
   if values[j]==values[p[-1]]+1:visit(p+[j])
 for i in range(len(values)):visit([i])
 def choose(k,used,points,longest):
  if k==len(paths):return fixed+points+b(longest)-3*(len(values)-len(used|covered))
  nodes,points_here=paths[k];best=choose(k+1,used,points,longest)
  if not nodes&used:best=max(best,choose(k+1,used|nodes,points+points_here,max(longest,len(nodes))))
  return best
 return choose(0,set(),0,0)
if __name__=='__main__':
 data={'edition':'v1','digests':{p:hashlib.sha256((root/'src/dictionaries'/p).read_bytes()).hexdigest() for p in ['adjectives.txt','nouns.txt']},'vectors':[make(adj[i],nouns[i]) for i in range(10)]}
 (root/'tests/golden.json').write_text(json.dumps(data,indent=2)+'\n')
