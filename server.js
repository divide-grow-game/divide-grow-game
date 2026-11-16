const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();
app.use(express.json({limit:'100kb'}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.use(express.static(__dirname));
const dbFile=path.join(__dirname,'players.json');
let players={}, waiting=[], matches={};
try{players=JSON.parse(fs.readFileSync(dbFile,'utf8'))}catch{}
function save(){fs.writeFileSync(dbFile,JSON.stringify(players,null,2))}
function clean(s){return String(s||'모험가').trim().slice(0,16).replace(/[<>]/g,'')}
function safePower(v){const s=String(v??'0').replace(/[^\d]/g,'').slice(0,60)||'0';return s.replace(/^0+(?=\d)/,'')}
function updatePlayer(req){
 const id=String(req.body.id||'').slice(0,80);
 if(!players[id])return null;
 players[id].heroName=clean(req.body.heroName||players[id].heroName);
 players[id].rank=Math.max(1,Math.min(15,Number(req.body.rank)||players[id].rank||15));
 players[id].power=safePower(req.body.power??players[id].power);
 players[id].lastSeen=Date.now();
 return players[id];
}
function duel(id,opponentId){
 const a=players[id],b=players[opponentId];
 const aPower=BigInt(a.power||'0'),bPower=BigInt(b.power||'0');
 const aScore=aPower*BigInt(90+Math.floor(Math.random()*21));
 const bScore=bPower*BigInt(90+Math.floor(Math.random()*21));
 const aWin=aScore>=bScore,reward=50;
 const summary=`${a.heroName} (전투력 ${a.power}) vs ${b.heroName} (전투력 ${b.power})`;
 matches[id]={result:aWin?'win':'loss',opponent:{name:b.name,heroName:b.heroName,rank:b.rank,power:b.power},summary,reward:aWin?reward:0};
 matches[opponentId]={result:aWin?'loss':'win',opponent:{name:a.name,heroName:a.heroName,rank:a.rank,power:a.power},summary,reward:aWin?0:reward};
 if(aWin){a.wins=(a.wins||0)+1;b.losses=(b.losses||0)+1}
 else{b.wins=(b.wins||0)+1;a.losses=(a.losses||0)+1}
 save();
}
app.post('/api/register',(req,res)=>{
 const id=String(req.body.id||crypto.randomUUID()).slice(0,80);
 const old=players[id]||{wins:0,losses:0};
 players[id]={...old,id,name:clean(req.body.name),heroName:clean(req.body.heroName),
   rank:Math.max(1,Math.min(15,Number(req.body.rank)||15)),
   power:safePower(req.body.power),updated:Date.now(),lastSeen:Date.now()};
 save();res.json({id});
});
app.post('/api/queue',(req,res)=>{
 const id=String(req.body.id||'');if(!players[id])return res.status(400).json({error:'먼저 서버에 접속해 주세요.'});
 updatePlayer(req);
 waiting=waiting.filter(x=>x!==id);
 const opponentId=waiting.find(x=>x!==id&&players[x]&&Date.now()-(players[x].lastSeen||0)<60000);
 if(opponentId){waiting=waiting.filter(x=>x!==opponentId);duel(id,opponentId)}
 else waiting.push(id);
 res.json({queued:true});
});
app.post('/api/challenge',(req,res)=>{
 const id=String(req.body.id||'');
 if(!players[id])return res.status(400).json({error:'먼저 서버에 접속해 주세요.'});
 updatePlayer(req);
 const target=clean(req.body.targetName);
 if(!target)return res.status(400).json({error:'상대방 닉네임을 입력해 주세요.'});
 const opponentId=Object.keys(players).find(pid=>pid!==id&&players[pid].name.toLowerCase()===target.toLowerCase()&&Date.now()-(players[pid].lastSeen||0)<60000);
 if(!opponentId)return res.status(404).json({error:'해당 닉네임의 접속 중인 플레이어를 찾지 못했습니다. 상대방이 서버에 접속해 있는지 확인해 주세요.'});
 waiting=waiting.filter(x=>x!==id);
 duel(id,opponentId);
 res.json({ok:true,opponent:{name:players[opponentId].name}});
});
app.post('/api/cancel',(req,res)=>{waiting=waiting.filter(x=>x!==String(req.body.id||''));res.json({ok:true})});
app.get('/api/match/:id',(req,res)=>{
 const id=req.params.id;if(players[id])players[id].lastSeen=Date.now();
 const m=matches[id];if(m){delete matches[id];return res.json({match:m})}
 res.json({match:null});
});
app.get('/api/rankings',(req,res)=>{
 const list=Object.values(players).sort((a,b)=>{
   const ap=BigInt(a.power||'0'),bp=BigInt(b.power||'0');
   return ap===bp?(b.wins||0)-(a.wins||0):(ap>bp?-1:1);
 }).slice(0,100);
 res.json({players:list.map(p=>({name:p.name,heroName:p.heroName,rank:p.rank,power:p.power,wins:p.wins}))});
});
app.get('/api/health',(req,res)=>res.json({ok:true}));
const port=process.env.PORT||3000;
app.listen(port,'0.0.0.0',()=>console.log(`분신 키우기 server: http://localhost:${port}`));
