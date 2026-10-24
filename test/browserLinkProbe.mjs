import puppeteer from 'puppeteer-core';

const chrome=await puppeteer.launch({
  executablePath:'/usr/bin/google-chrome',
  headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],
});
try {
  const page=await chrome.newPage();
  page.on('pageerror',e=>console.log('PUBLIC_BROWSER_ERROR',e.message));
  page.on('console',m=>{
    if(['error','warn','info','log'].includes(m.type()) &&
        (m.type()==='error' || m.text().includes('PDF_LINK')))
      console.log('PUBLIC_BROWSER_CONSOLE',m.type(),m.text().slice(0,1000));
  });
  await page.goto('http://127.0.0.1:4173/test/browserLinkProbe.html',{
    waitUntil:'domcontentloaded',timeout:20000,
  });
  await page.waitForFunction(
    ()=>document.querySelector('#pdf-link-probe')?.dataset.status!=='running',
    {timeout:60000},
  );
  const state=await page.$eval('#pdf-link-probe',el=>({
    status:el.dataset.status,details:el.textContent,
  }));
  console.log('PUBLIC_BROWSER_LINK_RESULT',JSON.stringify(state));
  if(state.status!=='pass')process.exitCode=1;
} finally {
  await chrome.close();
}
