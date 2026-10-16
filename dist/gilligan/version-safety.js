(function(root){'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function snapshot(r){return clone({version:r.version,title:r.title,content:r.content,stage:r.stage,assessment:r.assessment||null,assessmentVersion:r.assessmentVersion??null,assessmentStatus:r.assessmentStatus||'unknown',sources:r.sources||[],issues:r.issues||[],requirements:r.requirements||'',retain:r.retain||'',inputType:r.inputType,outputType:r.outputType,original:r.original,operation:r.operation,liked:!!r.liked});}
function commit(r,content,title){if(content===r.content&&title===r.title)return false;r.versions=r.versions||[];r.versions.push(snapshot(r));r.version++;r.modifications=(r.modifications||0)+1;r.title=title;r.content=content;r.sources=(r.sources||[]).map(s=>({...s,used:false,referenceStatus:'needs_recheck'}));r.assessmentStatus=r.assessment?'stale':'not_assessed';r.updatedAt=new Date().toISOString();r.lastChange='手动编辑';return true;}
function assessmentCurrent(r){return r.assessmentStatus==='current'&&r.assessmentVersion===r.version;}
function validateReferences(selected,active){const map=new Map(active.map(s=>[s.id,s]));return {accepted:selected.filter(s=>map.has(s.id)).map(s=>({...map.get(s.id)})),unavailable:selected.filter(s=>!map.has(s.id))};}
function supersede(reviews,newReview){if(newReview.status!=='approved'||!newReview.supersedes)return;const old=reviews.find(r=>r.id===newReview.supersedes);if(old&&['approved','pending'].includes(old.status)){old.events=old.events||[];old.events.push({action:'superseded',by:newReview.id,previousStatus:old.status,at:new Date().toISOString()});old.status='superseded';old.supersededBy=newReview.id;}}
function sameEffects(a,b){if(!a||!b)return false;return ['quality','viral','platform','confirmed','sales','note'].every(k=>(a[k]??'')===(b[k]??''));}
const api={clone,snapshot,commit,assessmentCurrent,validateReferences,supersede,sameEffects};root.VersionSafety=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
