"""Minimal UI smoke test for environments blocking browser navigation.
Renders a fully inlined static page in about:blank, with in-memory localStorage.
Run: python tests/smoke_inline.py
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re

root=Path(__file__).resolve().parents[1]
html=(root/'index.html').read_text()
html=html.replace('<link rel="stylesheet" href="./styles.css" />','<style>'+ (root/'styles.css').read_text() +'</style>')
sections=[]
for file in ['traits.mjs','weight_validation.mjs','model.mjs','questionnaires.mjs','app.js']:
    js=(root/file).read_text()
    js=re.sub(r'^import .*?;\s*$', '', js, flags=re.MULTILINE)
    js=re.sub(r'\bexport (const|function)\b',r'\1',js)
    if file=='questionnaires.mjs':js=re.sub(r'\bclone\b','qclone',js)
    sections.append(js)
html=html.replace('<script type="module" src="./app.js"></script>','').replace('</body>','<script>\n'+'\n'.join(sections)+'</script></body>')

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--headless=new'])
    for width,height in [(1400,900),(390,844)]:
        page=browser.new_page(viewport={'width':width,'height':height})
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.evaluate('''() => {
          let stored=new Map();
          Object.defineProperty(window,'localStorage',{configurable:true,value:{
            getItem:k=>stored.get(k)??null,
            setItem:(k,v)=>stored.set(k,String(v)),
            removeItem:k=>stored.delete(k),clear:()=>stored.clear()
          }});
        }''')
        page.set_content(html,wait_until='load')
        assert not errors,errors
        assert page.locator('.question').count()==23
        assert not page.locator('#weightAxiomWarning').is_visible()
        assert page.locator('#groupSettings').count()==0
        assert page.locator('#bothValue').inner_text()=='100.0%'
        page.on('dialog',lambda dialog:dialog.accept('Мои веса'))
        page.locator('#copyQuestionnaireBtn').click()
        weight=page.locator('[data-edit-id="height"][data-edit-field="weight"]')
        weight.fill('0.8');weight.dispatch_event('change')
        assert page.locator('#weightAxiomWarning').is_visible()
        assert page.evaluate('current().traits.find(t=>t.id==="height").weight')==0.8
        assert page.evaluate('project.questionnaires[0].traits.find(t=>t.id==="height").weight')==0.85
        assert page.locator('#errorMessage').is_hidden(), 'potential invalid weights should not block a nonzero current profile'
        saved=page.evaluate('JSON.parse(localStorage.getItem("representation-triangle-ru-v3"))')
        assert saved['project']['questionnaires'][1]['traits'][16]['weight']==0.8
        weight=page.locator('[data-edit-id="height"][data-edit-field="weight"]')
        weight.fill('0.85');weight.dispatch_event('change')
        assert not page.locator('#weightAxiomWarning').is_visible()
        # A truly zero-valued current profile is not assigned a triangle position.
        page.evaluate("""() => {
          const q=current();q.traits=[
            {id:'p',question:'P?',female:'F',male:'M',weight:1,enabled:true,group:groupOrder[0],note:''},
            {id:'q',question:'Q?',female:'F',male:'M',weight:1,enabled:true,group:groupOrder[0],note:''}
          ];
          q.workspace.own={p:1,q:0};
          q.workspace.ideals=[{id:'test_partner',name:'Партнер 1',answers:{p:1,q:1},weight:50}];
          q.workspace.selected='test_partner';
          change();
        }""")
        assert page.locator('#weightAxiomWarning').is_visible()
        assert page.locator('#errorMessage').is_visible()
        assert 'I = 0' in page.locator('#errorMessage').inner_text()
        page.locator('input[data-role="own"][data-trait="q"][value="1"]').locator('..').click()
        assert page.locator('#errorMessage').is_hidden()
        assert page.locator('#weightAxiomWarning').is_visible(), 'invalid weights should remain warned'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+2')
        assert not errors,errors
        print(f'SMOKE PASS {width}×{height}, A0 warning, weight persistence, unchanged defaults')
        page.close()
    browser.close()
