"""Browser QA with inlined modules: headless environment blocks all navigation."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
import tempfile
root=Path(__file__).resolve().parents[1]
artifacts=Path(tempfile.mkdtemp(prefix='triangle-browser-'))

def inline_html():
    html=(root/'index.html').read_text()
    html=html.replace('<link rel="stylesheet" href="./styles.css" />',f'<style>{(root/"styles.css").read_text()}</style>')
    sections=[]
    for f in ['traits.mjs','model.mjs','questionnaires.mjs','app.js']:
        s=(root/f).read_text()
        s=re.sub(r'^import .*?;\s*$', '', s, flags=re.MULTILINE)
        s=re.sub(r'\bexport (const|function)\b',r'\1',s)
        if f=='questionnaires.mjs':
            s=re.sub(r'\bclone\b','qclone',s)
        sections.append(s)
    html=html.replace('<script type="module" src="./app.js"></script>','')
    html=html.replace('</body>', '<script>'+ '\n'.join(sections)+'</script></body>')
    return html

def load_app(page):
    # A routed origin exercises localStorage without making external requests.
    page.route('http://triangle.test/**',lambda route:route.fulfill(content_type='text/html',body=inline_html()))
    page.goto('http://triangle.test/')

def scroll_positions(page):
    return page.evaluate('({page:window.scrollY,list:document.getElementById("questionList").scrollTop})')

def check_answer_scrolling(page):
    questions=page.locator('#questionList')
    page.evaluate('''()=>{
      const list=document.getElementById('questionList');
      window.scrollTo({top:window.scrollY+list.getBoundingClientRect().top-100,behavior:'instant'});
    }''')
    for offset in [0,350,900]:
        questions.evaluate('(el,offset)=>el.scrollTop=offset',offset)
        for role in ['own','ideal']:
            trait=questions.evaluate('''(list,role)=>{
              const bounds=list.getBoundingClientRect();
              return [...list.querySelectorAll(`input[data-role="${role}"]`)].find(input=>{
                const r=input.parentElement.getBoundingClientRect();
                return r.top>bounds.top+5 && r.bottom<Math.min(bounds.bottom,window.innerHeight)-5;
              }).dataset.trait;
            }''',role)
            for value in ['0','1']:
                radio=page.locator(f'input[data-role="{role}"][data-trait="{trait}"][value="{value}"]')
                before=scroll_positions(page)
                radio.evaluate('(el)=>window.answerUnderTest=el')
                radio.locator('..').click()
                page.wait_for_timeout(350)
                assert radio.is_checked()
                assert radio.evaluate('(el)=>el===window.answerUnderTest && el===document.activeElement'), 'answer DOM and focus must survive updates'
                assert scroll_positions(page)==before, (role,offset,before,scroll_positions(page))
            before=scroll_positions(page)
            radio.press('ArrowLeft')
            page.wait_for_timeout(350)
            assert page.locator(f'input[data-role="{role}"][data-trait="{trait}"][value="0"]').is_checked()
            assert scroll_positions(page)==before, 'keyboard answer switching must not scroll'
    before=scroll_positions(page)
    questions.hover()
    page.mouse.wheel(0,180)
    page.wait_for_timeout(350)
    after=scroll_positions(page)
    assert after['list']>before['list'], 'wheel must scroll the questionnaire'
    assert after['page']==before['page'], 'internal wheel scrolling must not move the page'

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--headless=new'])
    page=browser.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1,accept_downloads=True)
    errors=[]
    page.on('pageerror',lambda exc:errors.append(str(exc)))
    load_app(page)
    assert page.locator('html').get_attribute('lang')=='ru'
    assert page.locator('#questionnaireStatus').inner_text().startswith('16 вопросов')
    assert page.locator('.question').count()==16
    assert page.locator('#bothValue').inner_text()=='100.0%'
    assert page.locator('.topbar').get_by_text('Документ Word').count()==0
    assert page.locator('.hero .quickstart li').count()==3
    assert page.locator('#identityLabel').inner_text() != '—'
    assert page.locator('#identityMeter').get_attribute('aria-valuenow') is not None
    assert page.locator('#questionList').evaluate('(el)=>el.scrollHeight>el.clientHeight'), 'questions must scroll within tile 05'
    assert page.locator('.site-footer a[href$=".docx"]').count()==1
    assert page.locator('.method-panel').count()==0
    assert page.locator('#preferences h2').inner_text()=='Партнеры'
    assert page.locator('#questions h2').inner_text()=='Мои характеристики и выбранного партнера'
    assert page.locator('.profile-select').all_text_contents()==['Партнер 1','Партнер 2']
    assert page.locator('#currentProfileName').inner_text()=='Партнер 2'
    before=page.locator('#identityNumber').inner_text()
    page.locator('input[data-role="own"]').first.locator('..').click()
    after=page.locator('#identityNumber').inner_text()
    assert before != after, 'identity gauge must respond to edited own traits'
    assert after.startswith('Мой индекс:')
    page.locator('#questionList').evaluate('(el)=>el.scrollTop=120')
    assert page.locator('#questionList').evaluate('(el)=>el.scrollTop')>0
    check_answer_scrolling(page)
    page.locator('.profile-select').first.click()
    assert page.locator('#currentProfileName').inner_text()=='Партнер 1'
    own=page.locator('input[data-role="own"][data-trait="genitals"][value="0"]')
    partner=page.locator('input[data-role="ideal"][data-trait="genitals"][value="1"]')
    own.locator('..').click()
    partner.locator('..').click()
    assert own.is_checked() and partner.is_checked(), 'own and selected partner answers are independent'
    page.once('dialog',lambda d:d.accept('Саша <3'))
    page.locator('[data-action="rename"]').first.click()
    page.reload()
    assert page.locator('#currentProfileName').inner_text()=='Саша <3'
    assert own.is_checked() and partner.is_checked(), 'saved answers must survive reload'
    page.locator('.profile-select').nth(1).click()
    assert page.locator('#currentProfileName').inner_text()=='Партнер 2'
    page.locator('.brand').click()
    page.wait_for_timeout(700)
    before=page.evaluate('window.scrollY')
    page.locator('.quickstart a[href="#questions"]').click()
    page.wait_for_timeout(700)
    assert page.evaluate('window.scrollY')>before, 'explicit tile navigation must still scroll'
    assert page.evaluate('location.hash')=='#questions'
    page.screenshot(path=str(artifacts/'desktop.png'),full_page=True)
    page.once('dialog',lambda d:d.accept('Моя анкетка'))
    page.locator('#copyQuestionnaireBtn').click()
    assert page.locator('#questionnaireSelect').input_value()!='default'
    page.locator('#traitEditor').evaluate('(e)=>e.open=true')
    weight=page.locator('[data-edit-field="weight"]').first
    weight.fill('4.25')
    weight.dispatch_event('change')
    assert page.locator('[data-edit-field="weight"]').first.input_value()=='4.25'
    page.locator('[name="question"]').fill('Дополнительный тестовый вопрос?')
    page.locator('[name="female"]').fill('Вариант А')
    page.locator('[name="male"]').fill('Вариант Б')
    page.locator('#addTraitForm button[type="submit"]').click()
    assert page.locator('.question').count()==17
    assert page.locator('#questionnaireStatus').inner_text().startswith('17 вопросов')
    page.locator('#questionnaireSelect').select_option('default')
    assert page.locator('.question').count()==16
    page.locator('#questionnaireSelect').select_option(label='Моя анкетка')
    assert page.locator('.question').count()==17
    page.once('dialog',lambda d:d.accept('Пустая'))
    page.locator('#blankQuestionnaireBtn').click()
    assert page.locator('.question').count()==0
    page.locator('#traitEditor').evaluate('(e)=>e.open=true')
    page.locator('[name="question"]').fill('Новый вопрос?')
    page.locator('[name="female"]').fill('А')
    page.locator('[name="male"]').fill('Б')
    page.locator('#addTraitForm button[type="submit"]').click()
    assert page.locator('.question').count()==1
    assert not page.locator('#errorMessage').is_visible()
    with page.expect_download() as dl:
        page.locator('#exportBtn').click()
    download=dl.value
    assert download.suggested_filename=='triangle-project-v3.json'
    export_path=artifacts/'smoke_export.json'
    download.save_as(str(export_path))
    saved=page.evaluate('JSON.parse(localStorage.getItem("representation-triangle-ru-v3")).project')
    page.once('dialog',lambda d:d.accept())
    page.locator('#resetBtn').click()
    assert page.locator('.profile-select').all_text_contents()==['Партнер 1','Партнер 2']
    page.locator('#importFile').set_input_files(str(export_path))
    page.wait_for_function('document.getElementById("questionnaireSelect").selectedOptions[0].textContent==="Пустая"')
    assert page.evaluate('JSON.parse(localStorage.getItem("representation-triangle-ru-v3")).project')==saved, 'JSON import must restore custom questionnaires and partner names'
    assert not errors,errors
    phone=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
    load_app(phone)
    check_answer_scrolling(phone)
    phone.screenshot(path=str(artifacts/'mobile.png'),full_page=True)
    assert phone.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2'), 'horizontal overflow on mobile'
    print('BROWSER SMOKE PASS: desktop/mobile answer and keyboard scrolling, wheel, navigation, partner switching/names, saved data, JSON round trip, questionnaire copy/edit/add/switch/blank, responsive layouts')
    print(f'Browser artifacts: {artifacts}')
    browser.close()
