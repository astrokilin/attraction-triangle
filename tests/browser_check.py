"""Browser QA with inlined modules: headless environment blocks all navigation."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
root=Path(__file__).resolve().parents[1]

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

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1,accept_downloads=True)
    errors=[]
    page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(inline_html(),wait_until='load')
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
    before=page.locator('#identityNumber').inner_text()
    page.locator('input[data-role="own"]').first.locator('..').click()
    after=page.locator('#identityNumber').inner_text()
    assert before != after, 'identity gauge must respond to edited own traits'
    assert after.startswith('I(x):')
    page.locator('#questionList').evaluate('(el)=>el.scrollTop=120')
    assert page.locator('#questionList').evaluate('(el)=>el.scrollTop')>0
    assert page.locator('body').evaluate('(el)=>el.scrollTop')==0
    page.screenshot(path=str(root/'preview-desktop.png'),full_page=True)
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
    download.save_as(str(root/'tests'/'smoke_export.json'))
    assert not errors,errors
    phone=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
    phone.set_content(inline_html(),wait_until='load')
    phone.screenshot(path=str(root/'preview-mobile.png'),full_page=True)
    assert phone.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2'), 'horizontal overflow on mobile'
    print('BROWSER SMOKE PASS: new guidance, live identity gauge, internal scrolling, DOCX link, 16 questions, copy/edit, add question, switch, blank, export, responsive mobile')
    browser.close()
