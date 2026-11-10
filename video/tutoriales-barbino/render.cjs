const { chromium } = require("playwright");
const { spawn } = require("child_process");
const [,, html, mode, out, ...times] = process.argv; const FPS=30;
(async()=>{
 const br=await chromium.launch();
 const p=await br.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
 await p.goto("file://"+require("path").resolve(html)); await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(1500);
 if(mode==="preview"){ for(const t of times.map(Number)){ await p.evaluate(t=>render(t),t); await p.screenshot({path:`${out}_${t}.jpg`,type:"jpeg",quality:80}); } await br.close(); return; }
 const END=await p.evaluate(()=>END); const N=Math.ceil(END*FPS);
 const ff=spawn("ffmpeg",["-y","-f","image2pipe","-framerate",String(FPS),"-c:v","mjpeg","-i","-","-c:v","libx264","-pix_fmt","yuv420p","-crf","18","-preset","medium",out],{stdio:["pipe","ignore","ignore"]});
 for(let i=0;i<N;i++){ await p.evaluate(t=>render(t),i/FPS); const b=await p.screenshot({type:"jpeg",quality:93}); if(!ff.stdin.write(b)) await new Promise(r=>ff.stdin.once("drain",r)); }
 ff.stdin.end(); await new Promise(r=>ff.on("close",r)); await br.close();
})();
