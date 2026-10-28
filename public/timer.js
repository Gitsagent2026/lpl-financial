(function(){
 const duration=120000;
 const overlay=document.getElementById('refresh-overlay');
 const fill=document.getElementById('timer-fill');
 let started=performance.now();
 function tick(now){
  const elapsed=Math.min(1,Math.max(0,(now-started)/duration));
  fill.style.width=(elapsed*100)+'%';
  if(elapsed===1){overlay.hidden=false;return;}
  requestAnimationFrame(tick);
 }
 document.getElementById('refresh-qr').addEventListener('click',function(){
  overlay.hidden=true;fill.style.width='0%';started=performance.now();requestAnimationFrame(tick);
 });
 requestAnimationFrame(tick);
})();
