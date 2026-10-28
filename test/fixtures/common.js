// genera header/nav/footer "pesanti" in stile portale istituzionale (DOM equivalente a HTML statico)
(function(){
  const h = document.getElementById('hdr');
  if (h) {
    const slim = ['Ente di appartenenza','Amministrazione trasparente','Albo online','Contatti','URP'].map(t=>`<a href="#">${t}</a>`).join(' ');
    const lang = '<div class="lang"><button aria-expanded="false" aria-haspopup="true">ITA</button></div>';
    const social = ['Facebook','X','LinkedIn','YouTube','Instagram','Telegram'].map(t=>`<a href="#" aria-label="${t}"><svg width="16" height="16"></svg></a>`).join('');
    const menus = ['Il Fondo','Avvisi e bandi','Formazione','Imprese','Lavoratori','Enti attuatori','Rendicontazione','Monitoraggio','Normativa','Notizie'];
    const nav = menus.map((m,i)=>`<li class="nav-item dropdown"><a class="nav-link" href="#" role="button" aria-expanded="false" data-i="${i}">${m}</a><ul class="megamenu" hidden>${Array.from({length:8},(_,k)=>`<li><a href="#">${m} - voce ${k+1}</a></li>`).join('')}</ul></li>`).join('');
    h.innerHTML = `<header><div class="slim">${slim} ${lang} <a class="btn" href="login.html">Accedi all'area personale</a></div>
      <div class="center"><a href="index.html"><b>Portale Servizi Formazione (demo)</b></a> <span class="social">Seguici su ${social}</span>
      <form role="search" action="index.html"><input type="search" name="q" aria-label="Cerca nel sito" placeholder="Cerca"><button type="submit">Cerca</button></form></div>
      <nav aria-label="Menu principale"><ul>${nav}</ul></nav></header>
      <nav aria-label="Percorso"><a href="index.html">Home</a> / <span>${document.title}</span></nav>`;
    h.querySelectorAll('.nav-link').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();const u=a.nextElementSibling;u.hidden=!u.hidden;a.setAttribute('aria-expanded',String(!u.hidden));}));
  }
  const f = document.getElementById('ftr');
  if (f) {
    const cols = ['Il Portale','Servizi','Supporto','Trasparenza'].map(c=>`<div><h4>${c}</h4>${Array.from({length:8},(_,k)=>`<a href="#">${c} link ${k+1}</a><br>`).join('')}</div>`).join('');
    const legal = ['Privacy policy','Note legali','Dichiarazione di accessibilita\'','Mappa del sito','Cookie policy','Credits','Media policy','Statistiche'].map(t=>`<a href="#">${t}</a>`).join(' | ');
    f.innerHTML = `<footer><div class="cols">${cols}</div><div>${legal}</div><div>${['Facebook','X','LinkedIn','YouTube','Instagram','Telegram'].map(t=>`<a href="#" aria-label="${t}">●</a>`).join(' ')}</div></footer>`;
  }
  const c = document.getElementById('cookie');
  if (c && !sessionStorage.getItem('ck')) {
    c.innerHTML = `<div class="cookiebar" role="dialog" aria-label="Informativa cookie" style="position:fixed;bottom:0;left:0;right:0;background:#333;color:#fff;padding:20px">
      Questo sito utilizza cookie tecnici e, previo consenso, cookie di profilazione. <a href="#" style="color:#fff">Cookie policy</a>
      <button id="ck-acc">Accetta tutti</button> <button id="ck-rej">Rifiuta</button> <button>Personalizza</button></div>`;
    const close = (v)=>{ sessionStorage.setItem('ck',v); c.innerHTML=''; };
    c.querySelector('#ck-acc').onclick=()=>close('all'); c.querySelector('#ck-rej').onclick=()=>close('none');
  }
})();
