"""Real HTTP/ES-module regression. No app globals, inlining, routing or storage mocks.

Run: python3 tests/e2e_browser.py
Requires Playwright and system Chromium; application itself has no dependencies.
"""
import copy
from fractions import Fraction
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.parse import urljoin, urlsplit
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
KEY='representation-triangle-ru-v3'
ARTIFACTS=Path(tempfile.mkdtemp(prefix='triangle-e2e-'))

def identity(answers, traits):
    active=[t for t in traits if t['enabled'] and t['weight']>0]
    if not active:
        return None
    total=sum((Fraction(str(t['weight'])) for t in active),Fraction())
    value=sum((Fraction(str(t['weight']))*(2*answers[t['id']]-1) for t in active),Fraction())/total
    return value if value else None

def oracle(q):
    """Independent exact rational implementation of the task's equations."""
    x=identity(q['workspace']['own'],q['traits'])
    if x is None:
        return None
    unique={}
    for p in q['workspace']['ideals']:
        vector=tuple(p['answers'][t['id']] for t in q['traits'])
        if vector not in unique:
            unique[vector]=p
    partners=[p for p in unique.values() if p['weight']>0]
    total=sum((Fraction(str(p['weight'])) for p in partners),Fraction())
    if not total:
        return None
    mu=r=Fraction()
    for p in partners:
        y=identity(p['answers'],q['traits'])
        if y is None:
            return None
        probability=Fraction(str(p['weight']))/total
        mu+=probability*y
        r+=probability*abs(y)
    b=r-abs(mu)
    return x,(1-b-x*mu)/2,(1-b+x*mu)/2,b,mu

class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.mjs':'text/javascript'}
    def log_message(self,*args):
        pass
    def translate_path(self,path):
        path=urlsplit(path).path
        if path.startswith('/attraction-triangle/'):
            path=path[len('/attraction-triangle/'):]
        return super().translate_path(path)
    def do_GET(self):
        if self.path.endswith('/favicon.ico'):
            self.send_response(204);self.end_headers();return
        super().do_GET()

class BrowserCases:
    def setUp(self):
        self.context=BROWSER.new_context(viewport=self.viewport,is_mobile=self.mobile,has_touch=self.mobile,accept_downloads=True)
        self.page=self.context.new_page()
        self.page.set_default_timeout(10000)
        self.errors=[];self.http_errors=[];self.resources=set()
        self.page.on('pageerror',lambda e:self.errors.append(str(e)))
        self.page.on('console',lambda m:self.errors.append(m.text) if m.type=='error' else None)
        def request(r):
            if r.url.startswith('blob:'):
                return
            if r.method not in ['GET','HEAD'] or urlsplit(r.url).netloc!=urlsplit(BASE).netloc:
                self.errors.append('Unexpected network transmission: '+r.method+' '+r.url)
        self.page.on('request',request)
        def response(r):
            self.resources.add(r.url)
            if r.status>=400:self.http_errors.append((r.status,r.url))
        self.page.on('response',response)
        self.page.goto(BASE,wait_until='networkidle')
        expect(self.page.locator('.question')).to_have_count(23)

    def tearDown(self):
        try:
            self.page.screenshot(path=str(ARTIFACTS/f'{self.id()}.png'),full_page=True)
            self.assertFalse(self.errors,'browser errors: '+str(self.errors))
            self.assertFalse(self.http_errors,'HTTP errors: '+str(self.http_errors))
        finally:
            self.context.close()

    def state(self):
        return self.page.evaluate('(key)=>JSON.parse(localStorage.getItem(key)).project',KEY)

    def questionnaire(self):
        p=self.state()
        return next(q for q in p['questionnaires'] if q['id']==p['activeQuestionnaireId'])

    def preset(self,name):
        self.page.locator(f'[data-preset="{name}"]').click()

    def check_result(self):
        expected=oracle(self.questionnaire())
        if expected is None:
            expect(self.page.locator('#errorMessage')).to_be_visible()
            for field in ['heteroValue','homoValue','bothValue']:
                expect(self.page.locator('#'+field)).to_have_text('—')
            return
        expect(self.page.locator('#errorMessage')).to_be_hidden()
        x,e,h,b,mu=expected
        self.assertLessEqual(abs(float(self.page.locator('#identityMeter').get_attribute('aria-valuenow'))-float(x)),1e-12)
        for field,value in [('heteroValue',e),('homoValue',h),('bothValue',b)]:
            shown=float(self.page.locator('#'+field).inner_text().rstrip('%'))
            self.assertLessEqual(abs(shown-100*float(value)),.051)
        self.assertLessEqual(abs(float(self.page.locator('#positionDot').get_attribute('cx'))-float(44*e+376*h+210*b)),.000051)
        self.assertLessEqual(abs(float(self.page.locator('#positionDot').get_attribute('cy'))-float(286*(e+h)+28*b)),.000051)
        self.assertEqual(e+h+b,1)
        self.assertEqual(h-e,x*mu)
        displayed_projection=(float(self.page.locator('#positionDot').get_attribute('cx'))-210)/166
        self.assertLessEqual(abs(displayed_projection-float(x*mu)),.00000031)
        self.assertTrue(all(0<=v<=1 for v in [e,h,b]))

    def scroll_positions(self):
        return self.page.evaluate('({page:scrollY,list:document.getElementById("questionList").scrollTop})')

    def place_questions(self):
        self.page.evaluate('''()=>{const l=document.getElementById('questionList');
          scrollTo({top:scrollY+l.getBoundingClientRect().top-100,behavior:'instant'});
        }''')

    def answer(self,trait,role,value,check_scroll=True):
        radio=self.page.locator(f'input[data-trait="{trait}"][data-role="{role}"][value="{value}"]')
        self.place_questions()
        radio.locator('..').evaluate('''label=>{const l=document.getElementById('questionList');
          const a=label.getBoundingClientRect(),b=l.getBoundingClientRect();
          l.scrollTop+=a.top+a.height/2-b.top-l.clientHeight/2;
        }''')
        before=self.scroll_positions()
        state=self.state();q=next(q for q in state['questionnaires'] if q['id']==state['activeQuestionnaireId'])
        target=q['workspace']['own'] if role=='own' else next(p for p in q['workspace']['ideals'] if p['id']==q['workspace']['selected'])['answers']
        target[trait]=value
        radio.locator('..').click()
        self.page.wait_for_timeout(80)
        expect(radio).to_be_checked()
        self.assertTrue(radio.evaluate('(el)=>el===document.activeElement'),'answer focus must survive rendering')
        if check_scroll:self.assertEqual(self.scroll_positions(),before,'answer unexpectedly scrolled')
        self.assertEqual(self.state(),state,'answer modified unrelated data')
        self.check_result()

    def create_copy(self,action='edit'):
        count=self.page.locator('.profile-card').count()
        self.page.locator('#addProfileBtn').click()
        dialog=self.page.locator('#duplicatePartnerDialog')
        expect(dialog).to_be_visible()
        dialog.locator(f'[value="{action}"]').click()
        expect(dialog).to_be_hidden()
        expect(self.page.locator('.profile-card')).to_have_count(count+(action=='edit'))
        self.page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')

    def blank(self,name):
        self.page.once('dialog',lambda d:d.accept(name))
        self.page.locator('#blankQuestionnaireBtn').click()
        expect(self.page.locator('.question')).to_have_count(0)

    def add_trait(self,name,weight):
        self.page.locator('#addTraitForm [name="question"]').fill(name)
        self.page.locator('#addTraitForm [name="female"]').fill('Вариант А')
        self.page.locator('#addTraitForm [name="male"]').fill('Вариант Б')
        self.page.locator('#addTraitForm [name="weight"]').fill(str(weight))
        count=len(self.questionnaire()['traits'])
        self.page.locator('#addTraitForm button').click()
        expect(self.page.locator('.question')).to_have_count(count+1)
        return self.questionnaire()['traits'][-1]['id']

    def import_data(self,data,name='project.json'):
        with self.page.expect_file_chooser() as chooser:
            self.page.locator('#importBtn').click()
        chooser.value.set_files({'name':name,'mimeType':'application/json','buffer':json.dumps(data,ensure_ascii=False).encode()})
        self.page.wait_for_function('(expected)=>JSON.stringify(JSON.parse(localStorage.getItem("representation-triangle-ru-v3")).project)===JSON.stringify(expected)',arg=data['project'])

    def export_data(self):
        with self.page.expect_download() as download:
            self.page.locator('#exportBtn').click()
        path=ARTIFACTS/f'{self.id()}.json'
        download.value.save_as(str(path))
        return json.loads(path.read_text())

    def test_01_static_resources_and_presets(self):
        for resource in ['app.js','styles.css','traits.mjs','model.mjs','questionnaires.mjs','weight_validation.mjs']:
            self.assertIn(BASE+resource,self.resources)
        doc=self.page.locator('.site-footer a').get_attribute('href')
        response=self.context.request.get(urljoin(BASE,doc))
        self.assertEqual(response.status,200);self.assertTrue(response.body().startswith(b'PK'))
        expected={'feminine':1,'masculine':1,'androgynous':1,'poles':2}
        own=None
        for name,count in expected.items():
            button=self.page.locator(f'[data-preset="{name}"]')
            button.scroll_into_view_if_needed();self.page.wait_for_timeout(300)
            before=self.page.evaluate('scrollY')
            button.click();self.page.wait_for_timeout(100)
            expect(self.page.locator('.profile-card')).to_have_count(count)
            self.assertEqual(self.page.evaluate('scrollY'),before)
            self.assertTrue(button.evaluate('(el)=>el===document.activeElement'))
            q=self.questionnaire()
            if own is None:own=q['workspace']['own']
            self.assertEqual(q['workspace']['own'],own)
            self.assertEqual(q['workspace']['selected'],q['workspace']['ideals'][0]['id'])
            self.check_result()
            if name=='androgynous':self.assertAlmostEqual(float(identity(q['workspace']['ideals'][0]['answers'],q['traits'])),1/421)
            if name=='poles':
                self.assertEqual([identity(p['answers'],q['traits']) for p in q['workspace']['ideals']],[-1,1])
                expect(self.page.locator('#bothValue')).to_have_text('100.0%')
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))

    def test_02_all_23_answers_and_keyboard(self):
        self.preset('masculine')
        ids=[t['id'] for t in self.questionnaire()['traits']]
        for role in ['own','ideal']:
            for trait in ids:self.answer(trait,role,0)
            radio=self.page.locator(f'input[data-role="{role}"][data-trait="{ids[-1]}"][value="0"]')
            before=self.scroll_positions();radio.press('ArrowRight');self.page.wait_for_timeout(80)
            expect(self.page.locator(f'input[data-role="{role}"][data-trait="{ids[-1]}"][value="1"]')).to_be_checked()
            self.assertEqual(self.scroll_positions(),before);self.check_result()
        self.place_questions()
        self.page.locator('#questionList').evaluate('(el)=>el.scrollTop=100')
        before=self.scroll_positions();self.page.locator('#questionList').hover();self.page.mouse.wheel(0,200)
        self.page.wait_for_timeout(250)
        after=self.scroll_positions();self.assertEqual(after['page'],before['page']);self.assertGreater(after['list'],before['list'])
        saved=self.state();self.page.reload(wait_until='networkidle');self.assertEqual(self.state(),saved);self.check_result()

    def test_03_duplicates_and_partner_weights(self):
        self.preset('poles');before=oracle(self.questionnaire())
        self.create_copy('cancel');self.create_copy('select')
        self.create_copy();self.create_copy()
        self.assertEqual(oracle(self.questionnaire()),before);self.check_result()
        self.page.locator('#partnerSettings summary').click()
        expect(self.page.locator('input[data-weight-id]').nth(2)).to_be_disabled()
        expect(self.page.locator('input[data-weight-id]').nth(3)).to_be_disabled()
        self.page.locator('#partnerSettings summary').click()
        trait=self.questionnaire()['traits'][0]['id']
        self.answer(trait,'ideal',1)
        self.assertNotEqual(oracle(self.questionnaire()),before)
        self.page.locator('#partnerSettings summary').click()
        expect(self.page.locator('input[data-weight-id]').nth(3)).to_be_enabled()
        before=oracle(self.questionnaire())
        self.page.locator('input[data-weight-id]').first.press('End')
        self.assertNotEqual(oracle(self.questionnaire()),before);self.check_result()
        saved=self.state();self.page.locator('#partnerSettings summary').click();self.assertEqual(self.state(),saved)
        self.page.locator('[data-action="remove"]').last.click()
        expect(self.page.locator('.profile-card')).to_have_count(3);self.check_result()
        for index,partner in enumerate(self.questionnaire()['workspace']['ideals']):
            self.page.locator('.profile-select').nth(index).click()
            expect(self.page.locator('#currentProfileName')).to_have_text(partner['name'])
            actual=self.page.locator('input[data-role="ideal"]:checked').evaluate_all('els=>Object.fromEntries(els.map(e=>[e.dataset.trait,Number(e.value)]))')
            self.assertEqual(actual,partner['answers'])
            own=self.page.locator('input[data-role="own"]:checked').evaluate_all('els=>Object.fromEntries(els.map(e=>[e.dataset.trait,Number(e.value)]))')
            self.assertEqual(own,self.questionnaire()['workspace']['own'])

    def test_04_equal_scores_are_distinct_vectors(self):
        self.blank('Разные векторы с одинаковым индексом')
        ids=[self.add_trait(f'Признак {i}?',1) for i in range(3)]
        self.preset('feminine');self.create_copy()
        self.answer(ids[0],'ideal',1);self.answer(ids[1],'ideal',1)
        self.create_copy();self.answer(ids[1],'ideal',0);self.answer(ids[2],'ideal',1)
        q=self.questionnaire();profiles=q['workspace']['ideals']
        self.assertEqual([identity(p['answers'],q['traits']) for p in profiles],[-1,Fraction(1,3),Fraction(1,3)])
        self.assertEqual(oracle(q)[3],Fraction(4,9));self.check_result()
        self.page.locator('#partnerSettings summary').click()
        self.assertEqual(self.page.locator('input[data-weight-id]:enabled').count(),3)
        self.page.locator('input[data-weight-id]').first.press('End');self.check_result()
        self.assertEqual(oracle(self.questionnaire())[3],Fraction(1,3))

    def test_05_editor_validation_precision_and_focus(self):
        self.blank('Редактор весов')
        warning=self.page.locator('#weightAxiomWarning')
        expect(warning).to_be_visible()
        ids=[self.add_trait(f'Вопрос {i}?',w) for i,w in enumerate([.1,.2,.3])]
        expect(warning).to_be_visible();self.check_result()
        self.answer(ids[2],'own',0);expect(self.page.locator('#errorMessage')).to_be_visible()
        self.answer(ids[2],'own',1)
        field=self.page.locator(f'[data-edit-id="{ids[2]}"][data-edit-field="weight"]')
        field.fill('0.35');field.press('Tab')
        expect(warning).to_be_hidden()
        self.assertEqual(self.questionnaire()['traits'][2]['weight'],.35)
        wording=self.page.locator(f'[data-edit-id="{ids[0]}"][data-edit-field="question"]')
        wording.fill('Моя формулировка <без HTML>?');wording.press('Tab')
        expected_next=self.page.locator(f'[data-edit-id="{ids[0]}"][data-edit-field="female"]')
        self.assertTrue(expected_next.evaluate('(el)=>el===document.activeElement'),'editing must not discard keyboard focus')
        expect(self.page.locator('.question-head strong').first).to_have_text('Моя формулировка <без HTML>?')
        field=self.page.locator(f'[data-edit-id="{ids[2]}"][data-edit-field="weight"]')
        field.fill('0.5000000001');field.press('Tab')
        self.assertEqual(self.questionnaire()['traits'][2]['weight'],.5000000001)
        saved=self.state();self.page.reload(wait_until='networkidle');self.assertEqual(self.state(),saved)
        self.page.locator('#traitEditor summary').click()
        self.page.once('dialog',lambda d:d.accept())
        self.page.locator(f'[data-remove-trait="{ids[2]}"]').click()
        expect(self.page.locator('.question')).to_have_count(2);expect(warning).to_be_hidden();self.check_result()

    def test_06_json_and_legacy_persistence(self):
        self.preset('poles')
        self.page.once('dialog',lambda d:d.accept('Моя точная копия'))
        self.page.locator('#copyQuestionnaireBtn').click()
        self.create_copy()
        saved=self.state();exported=self.export_data();self.assertEqual(exported['project'],saved)
        current=next(q for q in exported['project']['questionnaires'] if q['id']==exported['project']['activeQuestionnaireId'])
        current['workspace']['ideals'][-1]['weight']=99
        duplicate=copy.deepcopy(current['workspace']['ideals'][-1]);duplicate.update(id='second_saved_duplicate',weight=0)
        current['workspace']['ideals'].append(duplicate)
        self.page.once('dialog',lambda d:d.accept());self.page.locator('#resetBtn').click()
        self.import_data(exported);self.assertEqual(self.state(),exported['project']);self.check_result()
        self.assertEqual(self.export_data()['project'],exported['project'])
        old=json.loads((ROOT/'tests/fixtures/legacy-v3.json').read_text())
        custom=copy.deepcopy(old['project']['questionnaires'][0]);custom.update(id='old_custom',builtin=False,name='Старая пользовательская копия',behaviorContribution=.3)
        custom['traits'][0]['weight']=7.123456789;old['project']['questionnaires'].append(custom)
        self.page.locator('#importFile').set_input_files({'name':'old-v3.json','mimeType':'application/json','buffer':json.dumps(old).encode()})
        expect(self.page.locator('#questionnaireSelect')).to_have_value('default')
        expect(self.page.locator('#migrationNotice')).to_have_count(0)
        q=self.questionnaire();self.assertEqual(len(q['traits']),23)
        for key,value in old['project']['questionnaires'][0]['workspace']['own'].items():self.assertEqual(q['workspace']['own'][key],value)
        self.assertEqual(self.state()['questionnaires'][1],custom)
        self.page.locator('#questionnaireSelect').select_option('old_custom')
        expect(self.page.locator('.question')).to_have_count(16);self.check_result()
        saved=self.state();self.page.reload(wait_until='networkidle');self.assertEqual(self.state(),saved)
        self.assertEqual(self.export_data()['project'],saved)

    def test_07_tiny_valid_values_and_preference_scaling(self):
        self.preset('masculine')
        data=self.export_data();q=copy.deepcopy(data['project']['questionnaires'][0])
        q.update(id='tiny',name='Точные малые значения',builtin=False)
        q['traits']=[{'id':f't{i}','question':f'Вопрос {i}?','female':'А','male':'Б','note':'','group':'Пользовательские гипотезы','weight':w,'enabled':True} for i,w in enumerate([.5,.5000000001])]
        q['workspace']={'own':{'t0':1,'t1':1},'ideals':[{'id':'tiny_f','name':'Партнер 1','weight':1e-15,'answers':{'t0':0,'t1':0}},{'id':'tiny_m','name':'Партнер 2','weight':2e-15,'answers':{'t0':1,'t1':1}}],'selected':'tiny_f'}
        data['project']['questionnaires'].append(q);data['project']['activeQuestionnaireId']='tiny'
        self.import_data(data);self.check_result()
        self.preset('androgynous');self.check_result()
        value=identity(self.questionnaire()['workspace']['ideals'][0]['answers'],q['traits'])
        self.assertLess(abs(float(value)),1e-9)
        self.answer('t0','own',0)
        self.assertNotIn('+0.000',self.page.locator('#identityNumber').inner_text(),'a nonzero identity must not be labelled as zero')

    def test_08_narrow_layout_and_controls(self):
        for width,height in [(320,740),(768,1024)]:
            self.page.set_viewport_size({'width':width,'height':height})
            self.preset('poles')
            self.page.locator('#partnerSettings summary').click()
            self.page.once('dialog',lambda d:d.accept('Копия для узкого экрана'))
            self.page.locator('#copyQuestionnaireBtn').click()
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
            controls=self.page.locator('button:visible').evaluate_all('''els=>els.map(el=>{
              const r=el.getBoundingClientRect();return {name:el.getAttribute('aria-label')||el.textContent.trim(),left:r.left,right:r.right,width:r.width,height:r.height};
            })''')
            for control in controls:
                self.assertTrue(control['name']);self.assertGreater(control['width'],0);self.assertGreater(control['height'],0)
                self.assertGreaterEqual(control['left'],-1);self.assertLessEqual(control['right'],width+1)
            self.assertTrue(self.page.locator('.pair').evaluate_all('''pairs=>pairs.every(pair=>{
              const [a,b]=[...pair.children].map(el=>el.getBoundingClientRect());return a.right<=b.left+1;
            })'''))

    def test_09_unknown_validation_and_invalid_import_preserve_data(self):
        self.preset('masculine');data=self.export_data()
        q=copy.deepcopy(data['project']['questionnaires'][0]);q.update(id='precise_38',name='Высокая точность, 38 вопросов',builtin=False)
        q['traits']=[{'id':f't{i}','question':f'Вопрос {i}?','female':'А','male':'Б','note':'','group':'Пользовательские гипотезы','weight':.3333333333333333 if i<2 else 1,'enabled':True} for i in range(38)]
        answers={t['id']:1 for t in q['traits']}
        q['workspace']={'own':answers,'ideals':[{'id':'precise_partner','name':'Партнер','answers':copy.deepcopy(answers),'weight':50}],'selected':'precise_partner'}
        data['project']['questionnaires'].append(q);data['project']['activeQuestionnaireId']=q['id']
        self.import_data(data)
        expect(self.page.locator('#weightAxiomWarning')).to_contain_text('не завершена')
        self.check_result()
        saved=self.state();self.page.reload(wait_until='networkidle');self.assertEqual(self.state(),saved)
        invalid=copy.deepcopy(data);invalid['project']['questionnaires'][-1]['traits'][0]['weight']=-1
        for payload in [b'{',json.dumps(invalid).encode()]:
            messages=[]
            self.page.once('dialog',lambda d:(messages.append(d.message),d.accept()))
            with self.page.expect_file_chooser() as chooser:
                self.page.locator('#importBtn').click()
            chooser.value.set_files({'name':'invalid.json','mimeType':'application/json','buffer':payload})
            self.page.wait_for_function('document.getElementById("importFile").value===""')
            self.assertTrue(messages and 'Ошибка импорта' in messages[0])
            self.assertEqual(self.state(),saved,'rejected JSON must not overwrite existing data')

    def test_10_keyboard_focus_does_not_frame_the_questionnaire(self):
        self.preset('masculine')
        self.page.locator('#partnerSettings summary').press('Tab')
        self.page.wait_for_timeout(600)
        focus=self.page.evaluate('''()=>{const a=document.activeElement,l=document.getElementById('questionList');
          return {role:a.dataset.role,trait:a.dataset.trait,container:l.matches(':focus-visible'),outline:getComputedStyle(l).outlineWidth,
            answer:a.closest('.choice')?getComputedStyle(a.closest('.choice')).outlineWidth:null};}''')
        self.assertEqual(focus['role'],'own');self.assertEqual(focus['trait'],'genitals')
        self.assertFalse(focus['container']);self.assertEqual(focus['outline'],'0px')
        self.assertEqual(focus['answer'],'2px','keyboard users need a visible answer focus indicator')
        self.place_questions()
        self.page.locator('#questionList').evaluate('(el)=>el.scrollTop=0')
        self.page.wait_for_timeout(150)
        before=self.scroll_positions()
        self.page.keyboard.press('PageDown');self.page.wait_for_timeout(350)
        after=self.scroll_positions()
        self.assertEqual(after['page'],before['page']);self.assertGreater(after['list'],before['list'])
        self.page.keyboard.press('Tab')
        self.page.wait_for_timeout(150)
        focus=self.page.evaluate('({role:document.activeElement.dataset.role,trait:document.activeElement.dataset.trait})')
        self.assertEqual(focus,{'role':'ideal','trait':'genitals'})
        self.assertEqual(self.scroll_positions()['page'],before['page'])
        before=self.scroll_positions()
        self.page.keyboard.press('ArrowLeft');self.page.wait_for_timeout(150)
        expect(self.page.locator('input[data-role="ideal"][data-trait="genitals"][value="0"]')).to_be_checked()
        self.assertEqual(self.scroll_positions(),before);self.check_result()

class DesktopTests(BrowserCases,unittest.TestCase):
    viewport={'width':1440,'height':1000}
    mobile=False

class MobileTests(BrowserCases,unittest.TestCase):
    viewport={'width':390,'height':844}
    mobile=True

if __name__=='__main__':
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    BASE=f'http://127.0.0.1:{server.server_port}/attraction-triangle/'
    print('Actual application:',BASE,flush=True)
    print('Artifacts:',ARTIFACTS,flush=True)
    try:
        with sync_playwright() as p:
            BROWSER=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--headless=new'])
            print('Chromium:',BROWSER.version,flush=True)
            result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(__import__('__main__')))
            BROWSER.close()
    finally:
        server.shutdown();server.server_close()
    raise SystemExit(not result.wasSuccessful())
