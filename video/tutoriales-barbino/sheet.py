import json,sys
from PIL import Image,ImageDraw
id=sys.argv[1]; d=f'out/{id}/'; j=json.load(open(d+'steps.json'))
W=240;H=520;n=len(j['steps']);cols=6;rows=(n+cols-1)//cols
im=Image.new('RGB',(W*cols,(H+18)*rows),'white');dr=ImageDraw.Draw(im)
for i,s in enumerate(j['steps']):
  a=Image.open(d+s['img']).convert('RGB');a=a.crop((0,0,780,min(a.height,1688))).resize((W,H))
  x=(i%cols)*W;y=(i//cols)*(H+18)
  im.paste(a,(x,y+18));dr.text((x+3,y+3),f"{i+1} {s['title'][:30]}",fill='black')
  if s['hl']:
    h=s['hl'];k=W/390;dr.rectangle([x+h['x']*k,y+18+h['y']*k,x+(h['x']+h['w'])*k,y+18+(h['y']+h['h'])*k],outline='red',width=3)
im.save(d+'sheet.jpg',quality=80)
