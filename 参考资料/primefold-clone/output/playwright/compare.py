from pathlib import Path
from PIL import Image, ImageDraw

base = Path(__file__).parent
pairs = [
    ('source-desktop-menu.png','built-desktop-0.png','desktop-top'),
    ('source-mobile-fresh.png','built-mobile-0.png','mobile-top'),
    ('source-team-detail.png','built-team-detail.png','mobile-team-detail'),
]
for y in [1250,2250,3150,3950,4750,5550,6250,7000]:
    pairs.append((f'source-desktop-{y}.png',f'built-desktop-{y}.png',f'desktop-{y}'))
for y in [850,2200,3550,4600,5800,7100,8400]:
    pairs.append((f'source-mobile-{y}.png',f'built-mobile-{y}.png',f'mobile-{y}'))
for left,right,label in pairs:
    a,b = Image.open(base/left).convert('RGB'),Image.open(base/right).convert('RGB')
    result = Image.new('RGB',(a.width+b.width,max(a.height,b.height)+28),'#eeeeee')
    result.paste(a,(0,28));result.paste(b,(a.width,28))
    draw = ImageDraw.Draw(result)
    draw.text((12,8),'Original template',fill='black');draw.text((a.width+12,8),'Native HTML source',fill='black')
    result.save(base/f'compare-{label}.png')
print('Comparisons saved.')

# Inspect typography and control geometry at their native pixel resolution.
regions = [
    ('desktop-top', (580, 0, 870, 280)),
    ('desktop-2250', (480, 170, 950, 760)),
    ('desktop-5550', (585, 330, 1160, 760)),
    ('mobile-7100', (20, 125, 370, 570)),
]
for label, box in regions:
    pair = next(p for p in pairs if p[2] == label)
    a, b = [Image.open(base/name).convert('RGB').crop(box) for name in pair[:2]]
    result = Image.new('RGB', (a.width+b.width, a.height+28), '#eeeeee')
    result.paste(a, (0,28)); result.paste(b, (a.width,28))
    draw = ImageDraw.Draw(result)
    draw.text((8,8),'Original',fill='black');draw.text((a.width+8,8),'Native source',fill='black')
    result.save(base/f'focus-{label}.png')
