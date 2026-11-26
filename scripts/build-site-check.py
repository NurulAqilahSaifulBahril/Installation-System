"""Builds public/site-check/index.html from the SiteFlow snapshot in sitevisit-local/.

The snapshot stays untouched; this copy gets a style layer that matches the scheduling
dashboard (colours, font, corners, light/dark theme taken from the dashboard page).
Re-run after refreshing sitevisit-local/index.html:  python scripts/build-site-check.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "sitevisit-local" / "index.html"
OUT = ROOT / "public" / "site-check" / "index.html"

OVERRIDE = r"""
<style id="dashboard-theme">
/* Scheduling dashboard look (app/globals.css tokens). */
:root{
  --bg:#f7f7f5;--card:#fff;--soft:#f2f2ef;--ink:#252523;--muted:#6f6f69;--line:#deded9;
  --brand:#252523;--brand2:#252523;--lime:#252523;--on-primary:#fff;
  --green:#237a4b;--green-soft:#e9f5ed;--amber:#986b16;--amber-soft:#faf2dc;
  --red:#b33a32;--red-soft:#fae9e7;--shadow:0 1px 2px rgba(28,28,26,.04);--r:12px;
}
:root[data-theme="dark"]{
  color-scheme:dark;
  --bg:#171715;--card:#20201e;--soft:#292927;--ink:#f1f1ed;--muted:#aaa9a2;--line:#3a3a36;
  --brand:#f1f1ed;--brand2:#f1f1ed;--lime:#f1f1ed;--on-primary:#171715;
  --green:#6fc394;--green-soft:#20382a;--amber:#e3b85f;--amber-soft:#3a301c;
  --red:#ec827a;--red-soft:#402523;--shadow:0 1px 2px rgba(0,0,0,.24);
}
html,body{background:var(--bg);color:var(--ink);font-family:"Segoe UI Variable","Segoe UI",Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
.app{max-width:none;background:var(--bg)}
.screen{max-width:960px;margin:0 auto}

/* SiteFlow's own header (logo, Home, step bar) is hidden: the dashboard already has one,
   and each step shows "n / 6" and has Home / Back in the footer. */
.topbar{display:none!important}
.toast{top:16px}

/* Header: plain surface with a bottom rule, like the dashboard topbar. */
.topbar{background:var(--card);color:var(--ink);box-shadow:none;border-bottom:1px solid var(--line)}
.wordmark p{color:var(--muted)}
.header-action,.install-btn{background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:8px;font-weight:600}
.header-action:hover,.install-btn:hover{background:var(--soft)}
.stepbar span{background:var(--line)}.stepbar span.active{background:var(--ink)}
:root:not([data-theme="dark"]) .logo-wrap img{filter:brightness(0)}

/* Hero becomes a normal card. */
.hero{background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow)}
.hero:after{display:none}
.hero .eyebrow{display:none}
.hero h2{margin-top:0}
.hero .eyebrow{color:var(--muted);font-weight:600}.hero p{color:var(--muted)}
.primary-big,.btn-next,.pdf-btn{background:var(--brand);color:var(--on-primary);border-radius:8px;font-weight:600}
.btn-next:disabled{background:var(--line);color:var(--muted)}
.btn-back,.btn-soft{background:var(--soft);color:var(--ink);border-radius:8px;font-weight:600}
.btn-danger{background:var(--red-soft);color:var(--red)}
.btn,.record-actions button,.utility-btn{border-radius:8px;font-weight:600}
.utility-btn{background:var(--card);color:var(--ink);border-color:var(--line)}
.utility-btn:hover,.option:hover{background:var(--soft)}

/* Cards, records, fields. */
.dash-card,.card,.record,.summary-card,.riskbox,.task{background:var(--card);border-color:var(--line);border-radius:12px;box-shadow:var(--shadow)}
/* Records list: the customer name only (phone, visit date, address, updated time hidden). */
.record h4~p{display:none}
.record h4{margin-bottom:0}
/* One row: name and status on the left, Open and Delete on the right. */
.record:has(h4){display:flex;align-items:center;gap:12px;padding:10px 14px}
.record:has(h4) h4{flex:1;min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.record:has(h4) .record-actions{flex:none;margin-top:0;gap:6px}
.record:has(h4) .record-actions button{flex:none;min-width:76px;padding:7px 14px}
.dash-card span,.record p,.page-title p,.task span,.riskbox p{color:var(--muted)}
.section-title{color:var(--muted);font-weight:700}
.step-count{color:var(--muted);font-weight:700}
.summary-card h3{color:var(--ink)}
.summary-row{border-bottom-color:var(--line)}
label.field{color:var(--ink);font-weight:600}
input,textarea,select{background:var(--card);color:var(--ink);border-color:var(--line);border-radius:8px}
input:focus,textarea:focus,select:focus{border-color:var(--ink);box-shadow:0 0 0 3px rgba(37,37,35,.08)}
.option{background:var(--card);color:var(--ink);border-color:var(--line);border-radius:8px;font-weight:600}
.option.selected{background:var(--soft);color:var(--ink);border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}

/* Notes and status colours from the dashboard palette. */
.note{background:var(--amber-soft);border-color:var(--line);color:var(--amber);border-radius:8px}
.goodnote,.ready.complete,.task.done{background:var(--green-soft);border-color:var(--line);color:var(--green)}
.ready{background:var(--amber-soft);color:var(--amber);border-color:var(--line);border-radius:8px}
.riskpill{background:var(--green-soft);color:var(--green)}
.task.done .tick{background:var(--green);border-color:var(--green)}
.tick{border-color:var(--line)}
.footer-nav{background:var(--card);border-top-color:var(--line)}
.toast{background:var(--ink);color:var(--bg);border-radius:8px}
.photo-uploader{background:var(--soft);border-color:var(--line)}
.photo-tile{background:var(--card);border-color:var(--line)}
.photo-tile button{background:var(--soft);color:var(--ink)}
.sample-reference,.local-photo-message{background:var(--soft);border-color:var(--line);color:var(--ink)}
.sample-reference strong{color:var(--ink)}
.card.missing{border-color:var(--red);box-shadow:0 0 0 3px rgba(179,58,50,.15)}
</style>
<script>
/* English only: the original is bilingual ("Customer Name / 客户姓名", "Roof Tile<br>瓦片屋顶").
   The Chinese is stripped from what is shown, never from the app's code, because some of those
   strings are also saved as answers and compared by the app ("Yes / 有"). Covers page text, input
   hints, pop-ups and confirm boxes, the PDF and photo stamps (drawn on a canvas), copied text and
   the WhatsApp message. */
(function(){
  // Full-width plus (\uff0b) is left out: it is the "+" on New Site Visit.
  var C="\u3000-\u303f\u3400-\u9fff\uff00-\uff0a\uff0c-\uffef";
  var HAS=new RegExp("["+C+"]");
  // " / 中文", " / String 逆变器…": the slash, any English lead-in, through the last Chinese
  // character before a line break, slash or colon (so "…评估: Parking" keeps ": Parking").
  var SLASH=new RegExp("[ \t]*/[ \t]*[A-Za-z0-9 .,+&()-]*["+C+"](?:[^\n/:]*["+C+"])?","g");
  var RUN=new RegExp("["+C+"](?:[^\n/:]*["+C+"])?","g");
  function strip(t){
    if(typeof t!=="string"||!HAS.test(t))return t;
    return t.replace(SLASH,"").replace(RUN,"").replace(/[ \t]{2,}/g," ").replace(/[ \t]+$/gm,"");
  }
  window.__stripChinese=strip;

  function fixText(n){
    var v=n.nodeValue;
    if(!HAS.test(v))return;
    // Never the app's own code or styles (their text arrives here as the page is read in),
    // nor what someone typed into a text box.
    var p=n.parentNode;
    if(p&&(p.nodeName==="SCRIPT"||p.nodeName==="STYLE"||p.nodeName==="TEXTAREA"))return;
    var prev=n.previousSibling;
    // A Chinese line after <br> is the translation of the line above: drop it and its <br>.
    if(prev&&prev.nodeName==="BR"){prev.remove();n.nodeValue="";return}
    var out=strip(v);
    if(out!==v)n.nodeValue=out;
  }
  var ATTRS=["placeholder","title","aria-label","alt"];
  function fixEl(el){
    for(var i=0;i<ATTRS.length;i++){
      var a=el.getAttribute&&el.getAttribute(ATTRS[i]);
      if(a&&HAS.test(a))el.setAttribute(ATTRS[i],strip(a));
    }
    if(el.tagName==="INPUT"&&(el.type==="button"||el.type==="submit")&&HAS.test(el.value))el.value=strip(el.value);
  }
  function walk(root){
    if(root.nodeType===3){fixText(root);return}
    if(root.nodeType!==1&&root.nodeType!==9)return;
    if(root.nodeType===1){if(root.tagName==="SCRIPT"||root.tagName==="STYLE")return;fixEl(root)}
    var w=document.createTreeWalker(root,5,null),n;
    while((n=w.nextNode())){
      if(n.nodeType===3){var p=n.parentNode;if(p&&(p.nodeName==="SCRIPT"||p.nodeName==="STYLE"||p.nodeName==="TEXTAREA"))continue;fixText(n)}
      else fixEl(n);
    }
  }
  new MutationObserver(function(list){
    for(var i=0;i<list.length;i++){
      var m=list[i];
      if(m.type==="characterData")fixText(m.target);
      else if(m.type==="attributes")fixEl(m.target);
      else for(var j=0;j<m.addedNodes.length;j++)walk(m.addedNodes[j]);
    }
  }).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRS});
  document.addEventListener("DOMContentLoaded",function(){walk(document.documentElement);document.title=strip(document.title)});

  // Pop-ups and confirm boxes.
  ["alert","confirm","prompt"].forEach(function(k){var f=window[k];window[k]=function(msg){var a=[].slice.call(arguments);a[0]=strip(String(msg==null?"":msg));return f.apply(window,a)}});
  // PDF pages and photo stamps are drawn with canvas text.
  var P=CanvasRenderingContext2D.prototype;
  ["fillText","strokeText","measureText"].forEach(function(k){var f=P[k];P[k]=function(t){var a=[].slice.call(arguments);a[0]=strip(String(t));return f.apply(this,a)}});
  // Copy buttons.
  if(navigator.clipboard&&navigator.clipboard.writeText){var wt=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=function(t){return wt(strip(String(t)))}}
  // WhatsApp message to the customer.
  var open=window.open;
  window.open=function(url){
    var a=[].slice.call(arguments);
    if(typeof url==="string"&&url.indexOf("https://wa.me/")===0){
      var q=url.indexOf("?text=");
      if(q>0)a[0]=url.slice(0,q+6)+encodeURIComponent(strip(decodeURIComponent(url.slice(q+6))));
    }
    return open.apply(window,a);
  };
})();
</script>
<script>
/* Follow the dashboard's light/dark theme when shown inside it. */
(function(){
  if(!window.parent||window.parent===window)return;
  function sync(){
    try{
      var t=window.parent.document.documentElement.getAttribute("data-theme");
      if(t)document.documentElement.setAttribute("data-theme",t);else document.documentElement.removeAttribute("data-theme");
    }catch(e){}
  }
  sync();
  try{new MutationObserver(sync).observe(window.parent.document.documentElement,{attributes:true,attributeFilter:["data-theme"]});}catch(e){}
})();
</script>
"""

# Runs after SiteFlow's own script. Lets the listed dashboard accounts press Next / Summary
# without filling in the step or taking the required photos (for trying the flow out).
# The PDF buttons still check everything. Everyone else keeps the normal checks.
SKIP_CHECKS_USERNAMES = ["IT Admin"]  # Aqilah ("Aqila") in public.app_users
SKIP_CHECKS = r"""
<script>
(async function(){
  var allowed=%s, ok=false;
  try{
    var r=await fetch("/api/auth/me",{credentials:"same-origin",cache:"no-store"});
    if(r.ok){var j=await r.json();ok=!!(j.user&&allowed.indexOf(j.user.username)>=0)}
  }catch(e){}
  if(!ok)return;
  window.__siteCheckSkip=true;
  var btn=document.getElementById("nextBtn");
  btn.onclick=function(){
    if(currentStep===6){saveDraft(true);return}
    document.querySelectorAll(".missing").forEach(function(x){x.classList.remove("missing")});
    showStep(currentStep+1);
  };
  // The photo step disables Next until every photo is in; keep it pressable.
  btn.disabled=false;
  new MutationObserver(function(){if(btn.disabled)btn.disabled=false}).observe(btn,{attributes:true,attributeFilter:["disabled"]});
})();
</script>
""" % __import__("json").dumps(SKIP_CHECKS_USERNAMES)

# Runs after SiteFlow's own script. Shows the survey steps in a pop-up like the dashboard's
# "Add Project Summary": title, close button, one tab per step, scrolling body, Back/Next below.
# The home screen stays behind it. Tabs go back freely; going forward checks the steps in
# between like Next does (skipped for the accounts in SKIP_CHECKS_USERNAMES).
STEP_TABS = ["Customer", "Roof", "Site Assessment", "Electrical", "Photo Checklist", "Summary"]
MODAL = r"""
<style id="site-check-modal">
body.sc-open{overflow:hidden}
/* On its own the home screen stays behind the pop-up. Inside the dashboard the frame covers
   the whole window while the pop-up is open, so the page goes see-through instead. */
html:not(.sc-embedded) body.sc-open #homeScreen.hidden{display:block!important}
html.sc-embedded.sc-open,html.sc-embedded.sc-open body,html.sc-embedded.sc-open .app{background:transparent}
.sc-backdrop{position:fixed;inset:0;z-index:2000;display:none;place-items:center;padding:24px;background:rgba(20,20,18,.48);backdrop-filter:blur(3px)}
.sc-backdrop.open{display:grid}
/* Fixed size on every step, as Add Project Summary; the step scrolls inside if it is longer. */
.sc-modal{width:min(1140px,calc(100vw - 48px));height:min(780px,calc(100vh - 48px));max-height:calc(100vh - 48px);display:flex;flex-direction:column;overflow:hidden;padding:20px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:14px;box-shadow:0 24px 70px rgba(20,20,18,.24)}
.sc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:12px;flex-shrink:0}
.sc-eyebrow{margin:0;color:var(--muted);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.sc-title{margin:2px 0 0;font-size:19px;font-weight:650;letter-spacing:0}
.sc-close{width:34px;height:34px;border:0;border-radius:9px;display:grid;place-items:center;color:var(--muted);background:transparent}
.sc-close:hover{background:var(--soft)}
/* Timeline of the six steps across the top; the step's form and Back/Next below it. */
.sc-main{flex:1;min-height:0;display:flex;flex-direction:column;gap:14px;border-top:1px solid var(--line);padding-top:16px}
.sc-content{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.sc-tabs{flex:none;display:flex;padding:0 0 14px;border-bottom:1px solid var(--line)}
.sc-tab{position:relative;flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:6px;padding:0 4px;border:0;background:none;color:var(--muted);font-size:13px;font-weight:600;line-height:1.25;text-align:center;cursor:pointer}
.sc-tab:not(:last-child)::before{content:"";position:absolute;left:calc(50% + 20px);right:calc(-50% + 20px);top:13px;height:2px;border-radius:2px;background:var(--line)}
.sc-tab.done:not(:last-child)::before{background:var(--ink)}
.sc-dot{flex:0 0 28px;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;border:2px solid var(--line);background:var(--card);color:var(--muted);font-size:12px;font-weight:700}
.sc-tab.done .sc-dot{background:var(--ink);border-color:var(--ink);color:var(--on-primary)}
.sc-tab.current{color:var(--ink)}
.sc-tab.current .sc-dot{border-color:var(--ink);color:var(--ink);box-shadow:0 0 0 4px var(--soft)}
.sc-tab:hover .sc-label{color:var(--ink)}
.sc-text{display:flex;flex-direction:column;gap:1px}
.sc-text small{font-size:11px;font-weight:500;color:var(--muted)}
.sc-body{flex:1;min-height:0;overflow-y:auto;padding-right:4px}
.sc-body .screen{padding:0;max-width:none;margin:0}
.sc-body .page-title{margin-bottom:12px}
.sc-body .page-title h2{font-size:.95rem;font-weight:700;letter-spacing:.01em}

/* Each step's boxes are stacked one under another, full width; tighter spacing than
   SiteFlow's phone layout. */
.sc-body .step>*{margin:0 0 12px}
.sc-body .card{padding:12px 14px;margin-bottom:12px}
.sc-body .card h3{font-size:13.5px;margin:0 0 8px}
.sc-body .grid{gap:9px}
.sc-body input,.sc-body select,.sc-body textarea{margin-top:4px;padding:7px 10px}
.sc-body textarea{min-height:54px}
.sc-body label.field{font-size:12px}
.sc-body .options{gap:6px}
.sc-body .option{min-height:36px;padding:7px 10px}
.sc-body .note{padding:8px 10px;margin-top:8px;line-height:1.45}
.sc-body .riskbox{padding:10px 12px}
.sc-body .task{padding:8px 10px;margin-bottom:6px}
.sc-body .ready{padding:9px 11px;margin-bottom:10px}
.sc-body .sample-reference{margin:6px 0;padding:6px}
.sc-body .sample-reference img{width:84px;height:66px}
.sc-body .photo-uploader{margin:6px 0 10px;padding:8px}
/* Customer: one card of fields, so the fields go three across instead. */
@media(min-width:900px){.sc-body #step1 .grid.two{grid-template-columns:repeat(3,1fr)}}
.sc-body .summary-card{margin:0 0 12px;padding:12px 14px}
.sc-foot{flex-shrink:0;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.sc-foot .footer-nav{position:static;background:none;border:0;padding:0;backdrop-filter:none;-webkit-backdrop-filter:none}
.sc-foot .footer-inner{max-width:none;margin:0;display:flex;justify-content:flex-end;gap:8px}
.sc-foot .btn{min-width:120px;padding:10px 16px}
.toast{z-index:3000}
@media(max-width:640px){
  .sc-backdrop{padding:0}
  .sc-modal{width:100vw;height:100vh;max-height:none;border-radius:0;border:0;padding:16px}
  /* Phone: smaller labels, no status line. */
  .sc-main{gap:12px;padding-top:12px}
  .sc-tabs{padding-bottom:10px}
  .sc-tab{gap:5px;padding:0 2px;font-size:10.5px}
  .sc-tab:not(:last-child)::before{left:calc(50% + 17px);right:calc(-50% + 17px)}
  .sc-text small{display:none}
  .sc-foot .btn{flex:1;min-width:0}
}
</style>
<script>
(function(){
  var TABS=__TABS__;
  var form=document.getElementById("surveyForm"),foot=document.getElementById("footerNav");
  var back=document.createElement("div");
  back.className="sc-backdrop";back.setAttribute("role","presentation");
  back.innerHTML='<div class="sc-modal" role="dialog" aria-modal="true" aria-label="Site visit">'
    +'<div class="sc-head"><div><p class="sc-eyebrow">Site Check</p><h2 class="sc-title">New Site Visit</h2></div>'
    +'<button type="button" class="sc-close" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>'
    +'<div class="sc-main"><nav class="sc-tabs" aria-label="Site visit steps"></nav>'
    +'<div class="sc-content"><div class="sc-body"></div><div class="sc-foot"></div></div></div></div>';
  document.body.appendChild(back);
  var modal=back.firstChild,tabs=modal.querySelector(".sc-tabs"),body=modal.querySelector(".sc-body"),title=modal.querySelector(".sc-title");
  body.appendChild(form);modal.querySelector(".sc-foot").appendChild(foot);

  TABS.forEach(function(label,i){
    var b=document.createElement("button");
    b.type="button";b.className="sc-tab";
    b.innerHTML='<span class="sc-dot"></span><span class="sc-text"><span class="sc-label"></span><small></small></span>';
    b.querySelector(".sc-label").textContent=label;
    b.onclick=function(){goTo(i+1)};
    tabs.appendChild(b);
  });

  // Forward jumps check every step in between, as pressing Next would.
  function goTo(n){
    if(n===currentStep)return;
    if(n<currentStep||window.__siteCheckSkip){showStep(n);return}
    for(var k=currentStep;k<n;k++){
      if(!validateStep(k)){if(k!==currentStep){showStep(k);validateStep(k)}return}
      if(k===5&&!canPassPhotos()){if(currentStep!==5)showStep(5);updatePhotoReady();toast("Complete all required photos");return}
    }
    showStep(n);
  }
  function close(){saveDraft(false);showHome()}
  modal.querySelector(".sc-close").onclick=close;
  back.addEventListener("click",function(e){if(e.target===back)close()});
  document.addEventListener("keydown",function(e){
    if(e.key==="Escape"&&back.classList.contains("open")&&!document.querySelector(".annotation-modal.open"))close();
  });

  var embedded=window.parent&&window.parent!==window;
  if(embedded)document.documentElement.classList.add("sc-embedded");
  var lastStep=0,lastOpen=null,furthest=0;
  function sync(){
    var open=!form.classList.contains("hidden");
    back.classList.toggle("open",open);document.body.classList.toggle("sc-open",open);
    document.documentElement.classList.toggle("sc-open",open);
    if(embedded&&open!==lastOpen){
      try{window.parent.postMessage({type:"site-check-modal",open:open},location.origin)}catch(e){}
    }
    lastOpen=open;
    if(!open){lastStep=0;furthest=0;return}
    // Done = a step already passed on this visit (an opened record counts from where it opens).
    furthest=Math.max(furthest,currentStep);
    [].forEach.call(tabs.children,function(b,i){
      var n=i+1,cur=n===currentStep,done=!cur&&n<furthest;
      b.classList.toggle("current",cur);b.classList.toggle("done",done);
      if(cur)b.setAttribute("aria-current","step");else b.removeAttribute("aria-current");
      b.querySelector(".sc-dot").innerHTML=done?'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>':String(n);
      b.querySelector("small").textContent=cur?"In progress":done?"Completed":"Pending";
    });
    // On step 1 SiteFlow's Back button reads "Home"; the pop-up's X closes it instead.
    document.getElementById("backBtn").style.display=currentStep===1?"none":"";
    var name=form.elements.customerName&&form.elements.customerName.value.trim();
    title.textContent=name||"New Site Visit";
    if(currentStep!==lastStep){body.scrollTop=0;lastStep=currentStep}
  }
  var show=showStep,home=showHome;
  showStep=function(n){show(n);sync()};
  showHome=function(){home();sync()};
  new MutationObserver(sync).observe(form,{attributes:true,attributeFilter:["class"]});
  if(form.elements.customerName)form.elements.customerName.addEventListener("input",sync);
  sync();
})();
</script>
""".replace("__TABS__", __import__("json").dumps(STEP_TABS))

# Runs after SiteFlow's own script. "Search customer" on the Customer step: looks up prod_main
# invoices through the dashboard (/api/site-check/customers, signed-in only), one row per
# invoice, and fills Customer Name, Phone Number, Salesperson and Installation Address.
# The fields stay editable; typing by hand still works for anyone not in prod_main.
# Shown only inside the dashboard, where that route exists.
CUSTOMER_SEARCH = r"""
<style id="site-check-customer-search">
.sc-search{position:relative;margin-bottom:12px}
.sc-search-input{position:relative}
.sc-search-input svg{position:absolute;left:11px;top:50%;margin-top:2px;transform:translateY(-50%);color:var(--muted);pointer-events:none}
.sc-search-input input{padding-left:32px}
.sc-search-hint{margin:4px 0 0;font-size:11.5px;color:var(--muted)}
.sc-search-hint.linked{color:var(--green)}
.sc-results{display:none;position:absolute;left:0;right:0;top:100%;z-index:30;margin-top:4px;max-height:340px;overflow-y:auto;background:var(--card);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 30px rgba(20,20,18,.16)}
.sc-results.open{display:block}
.sc-result{display:block;width:100%;padding:9px 12px;border:0;border-bottom:1px solid var(--line);background:none;color:var(--ink);font-size:13px;text-align:left;cursor:pointer}
.sc-result:last-child{border-bottom:0}
.sc-result:hover,.sc-result.active{background:var(--soft)}
.sc-result .sc-r-top{display:flex;justify-content:space-between;gap:10px}
.sc-result .sc-r-inv{flex-shrink:0;color:var(--muted);font-size:12px;font-weight:600}
.sc-result small{display:block;margin-top:2px;color:var(--muted);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc-results .sc-empty{padding:10px 12px;color:var(--muted);font-size:12px}
</style>
<script>
(function(){
  if(!window.parent||window.parent===window)return;
  var form=document.getElementById("surveyForm");
  var card=document.querySelector("#step1 .card");
  if(!form||!card)return;
  var wrap=document.createElement("div");
  wrap.className="sc-search";
  wrap.innerHTML='<label class="field">Search customer'
    +'<span class="sc-search-input"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>'
    +'<input type="search" autocomplete="off" placeholder="Customer name, phone or invoice no."></span></label>'
    +'<p class="sc-search-hint">Fills Customer Name, Phone Number, Salesperson and Installation Address from prod_main.</p>'
    +'<div class="sc-results" role="listbox"></div>';
  card.insertBefore(wrap,card.firstChild);
  var input=wrap.querySelector("input"),list=wrap.querySelector(".sc-results"),hint=wrap.querySelector(".sc-search-hint");
  var HINT=hint.textContent,timer=null,ctrl=null,items=[],active=-1;

  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
  function close(){list.classList.remove("open");active=-1}
  function message(text){list.innerHTML="";list.appendChild(el("div","sc-empty",text));list.classList.add("open")}
  function setActive(i){
    var rows=list.querySelectorAll(".sc-result");
    [].forEach.call(rows,function(r,k){r.classList.toggle("active",k===i)});
    active=i;if(rows[i])rows[i].scrollIntoView({block:"nearest"});
  }
  function render(){
    list.innerHTML="";
    if(!items.length){message("No matching invoices in prod_main.");return}
    items.forEach(function(it,i){
      var b=el("button","sc-result");b.type="button";b.setAttribute("role","option");
      var top=el("span","sc-r-top");top.appendChild(el("strong",null,it.customerName||"(no name)"));
      top.appendChild(el("span","sc-r-inv",it.invoiceNumber+(it.invoiceDate?" · "+it.invoiceDate:"")));
      b.appendChild(top);
      b.appendChild(el("small",null,[it.phone||"No phone",it.salesperson||"No salesperson"].join(" · ")));
      b.appendChild(el("small",null,it.address||"No address"));
      b.addEventListener("mousedown",function(e){e.preventDefault()});
      b.onclick=function(){pick(i)};
      list.appendChild(b);
    });
    list.classList.add("open");active=-1;
  }
  function setField(name,value){
    var f=form.elements[name];if(!f||!value)return;
    f.value=value;
    f.dispatchEvent(new Event("input",{bubbles:true}));f.dispatchEvent(new Event("change",{bubbles:true}));
    var box=f.closest(".missing");if(box)box.classList.remove("missing");
  }
  function pick(i){
    var it=items[i];if(!it)return;
    setField("customerName",it.customerName);setField("phone",it.phone);
    setField("salesperson",it.salesperson);setField("address",it.address);
    input.value="";close();
    hint.textContent="Filled from "+it.invoiceNumber+". You can still edit the fields.";hint.classList.add("linked");
  }
  function search(q){
    if(ctrl)ctrl.abort();ctrl=new AbortController();
    message("Searching…");
    fetch("/api/site-check/customers?q="+encodeURIComponent(q),{credentials:"same-origin",cache:"no-store",signal:ctrl.signal})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})
      .then(function(res){
        if(input.value.trim()!==q)return;
        if(!res.ok){message(res.j&&res.j.error?res.j.error:"Could not search customers.");return}
        items=res.j.invoices||[];render();
      })
      .catch(function(e){if(e&&e.name==="AbortError")return;message("Could not reach prod_main. Try again.")});
  }
  input.addEventListener("input",function(){
    clearTimeout(timer);var q=input.value.trim();
    if(q.length<2){if(ctrl)ctrl.abort();items=[];close();return}
    timer=setTimeout(function(){search(q)},300);
  });
  input.addEventListener("keydown",function(e){
    if(!list.classList.contains("open")||!items.length){if(e.key==="Escape")close();return}
    if(e.key==="ArrowDown"){e.preventDefault();setActive(Math.min(active+1,items.length-1))}
    else if(e.key==="ArrowUp"){e.preventDefault();setActive(Math.max(active-1,0))}
    else if(e.key==="Enter"){e.preventDefault();pick(active<0?0:active)}
    else if(e.key==="Escape"){e.stopPropagation();close()}
  });
  input.addEventListener("blur",function(){setTimeout(close,150)});
  // A new visit starts with the plain hint again.
  var newBtn=document.getElementById("newVisitBtn");
  if(newBtn)newBtn.addEventListener("click",function(){input.value="";close();hint.textContent=HINT;hint.classList.remove("linked")});
})();
</script>
"""

html = SRC.read_text(encoding="utf-8")
# The live site has no manifest, icons or service worker (they 404), so drop the links to them.
html = html.replace('<link rel="manifest" href="manifest.webmanifest">', "")
html = html.replace('<link rel="apple-touch-icon" href="icon-192.png">', "")
assert html.count("</head>") == 1
html = html.replace("</head>", OVERRIDE + "</head>")
assert html.count("</body>") == 1
html = html.replace("</body>", MODAL + CUSTOMER_SEARCH + SKIP_CHECKS + "</body>")
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8", newline="")
print("wrote", OUT, len(html))
