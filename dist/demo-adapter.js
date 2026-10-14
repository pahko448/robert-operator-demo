/* Public UI-only demo. No backend/network AI, real accounts or source library. */
(() => {
  const KEY='robert-public-synthetic-demo-v1';
  const USERS={member_demo:{username:'member_demo',display_name:'演示成员',role:'USER'},admin_demo:{username:'admin_demo',display_name:'演示管理员',role:'ADMIN'},other_demo:{username:'other_demo',display_name:'另一演示成员',role:'USER'}};
  let session=sessionStorage.getItem(KEY+'-session')||'';
  const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text).trim())))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const clone=x=>JSON.parse(JSON.stringify(x));
  const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(state));}catch{}};
  let state;
  const ready=(async()=>{
    try{state=JSON.parse(localStorage.getItem(KEY)||'null');}catch{}
    if(state?.schema==='synthetic-v1')return;
    state={schema:'synthetic-v1',library:[],personal:{},reviews:[],histories:[]};
    for(let i=1;i<=55;i++){
      const kind=i<=16?'traffic':'sales';
      const labels=['content_quality',...(i<=16?['traffic_effect']:i<=30?['sales_effect']:[])];
      const content=`这是第${i}篇合成界面样例，不来自真实文案库。主题是团队沟通与目标：先明确问题，再提出一个可以复盘的小行动。仅用于验证分类、标记与审核交互，不代表真实生成质量或发布效果。`;
      const digest=await hash(content);
      state.library.push({entry_id:'COPY-LIB-DEMO-'+String(i).padStart(3,'0'),title:`合成示例 ${String(i).padStart(2,'0')}：团队沟通与目标`,content,content_sha256:digest,source_sha256:digest,source_path:'synthetic/'+i,source_locator:'synthetic/'+i,video_type:kind,quality_labels:labels,scope:'team',active:true,rights_status:'synthetic_demo_only',classification_source:'合成分类演示数据'});
    }
    const content='这是合成历史成稿：先明确责任边界，再建立复盘机制，今天先确认下一步行动。不含真实成员记录。';
    state.histories.push({conversation_id:'demo-history',owner_username:'member_demo',owner_display_name:'演示成员',business_type:'copy',title:'合成历史：团队沟通与责任',business_output:{content,titles:['合成演示：把责任讲清楚'],video_type:'traffic'},creation_mode:'content_optimization',generation_mode:'standard',revision_count:1,updated_at:Math.floor(Date.now()/1000),liked:false,source_trace:[],reference_context:[],versions:[]});
    save();
  })();
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  const team=()=>[...state.library.filter(i=>i.active),...state.reviews.filter(r=>r.status==='approved').map(r=>({...r,entry_id:'COPY-LIB-DEMO-R-'+r.entry_id,approval_ids:[r.entry_id],active:true,scope:'team'}))];
  const items=()=>session==='admin_demo'?team():state.personal[session]||[];
  const record=(owner,id)=>state.histories.find(r=>r.owner_username===owner&&r.conversation_id===id);
  function annotated(r){const value=clone(r);const p=(state.personal[r.owner_username]||[]).find(i=>i.source_path==='history/'+r.conversation_id&&i.source_version===r.revision_count);value.library_labels=p?.quality_labels||[];value.liked=!!value.library_labels.length;value.video_type=r.business_output.video_type||'general';value.team_reviews=state.reviews.filter(i=>i.source_owner===r.owner_username&&i.source_path==='history/'+r.conversation_id).map(i=>({entry_id:i.entry_id,status:i.status,source_version:i.source_version,review_opinion:i.review_opinion}));return value;}
  window.fetch=async(input,options={})=>{
    await ready;
    const url=new URL(typeof input==='string'?input:input.url,location.origin);
    if(url.origin!==location.origin||!url.pathname.startsWith('/robert/'))return reply(403,{message:'公网演示不连接外部或正式接口'});
    const route=url.pathname.slice('/robert'.length),method=options.method||'GET';
    let body={};try{body=JSON.parse(options.body||'{}');}catch{return reply(400,{message:'演示请求格式错误'});}
    if(route==='/auth/login'){
      if(!USERS[body.username])return reply(401,{message:'仅支持合成演示账号'});
      session=body.username;sessionStorage.setItem(KEY+'-session',session);return reply(200,{status:'success',user:USERS[session]});
    }
    if(route==='/auth/logout'){session='';sessionStorage.removeItem(KEY+'-session');return reply(200,{status:'success'});}
    if(!USERS[session])return reply(401,{message:'请选择体验成员或管理员'});
    const admin=session==='admin_demo';
    if(route==='/auth/me')return reply(200,{user:USERS[session]});
    if(route==='/api/v1/history'&&method==='GET'){
      let rows=state.histories.filter(r=>admin||r.owner_username===session).map(annotated);
      const q=url.searchParams.get('q');if(q)rows=rows.filter(r=>(r.title+r.business_output.content).includes(q));
      const type=url.searchParams.get('business_type');if(type)rows=rows.filter(r=>r.business_type===type);
      const mode=url.searchParams.get('creation_mode');if(mode)rows=rows.filter(r=>r.creation_mode===mode);
      const video=url.searchParams.get('video_type');if(video)rows=rows.filter(r=>r.video_type===video);
      const label=url.searchParams.get('quality_label');if(label)rows=rows.filter(r=>r.library_labels.includes(label));
      if(url.searchParams.has('liked'))rows=rows.filter(r=>r.liked===(url.searchParams.get('liked')==='true'));
      const from=Number(url.searchParams.get('updated_from')||0),to=Number(url.searchParams.get('updated_to')||Infinity);rows=rows.filter(r=>r.updated_at>=from&&r.updated_at<=to);
      rows.sort((a,b)=>url.searchParams.get('sort')==='updated_asc'?a.updated_at-b.updated_at:b.updated_at-a.updated_at);
      return reply(200,{status:'success',items:rows,total:rows.length});
    }
    if(route==='/api/v1/library')return reply(200,{status:'success',items:clone(items())});
    if(route==='/api/v1/library/personal')return reply(200,{status:'success',items:clone(state.personal[session]||[])});
    if(route==='/api/v1/library/reviews'&&method==='GET')return reply(200,{status:'success',items:clone(state.reviews.filter(r=>admin||r.submitter_username===session))});
    if(route==='/api/v1/library/history'||route==='/api/v1/library/reviews'&&method==='POST'){
      const owner=body.owner_username||session;if(owner!==session&&!admin)return reply(403,{message:'演示中也只能提交本人记录'});
      const r=record(owner,body.conversation_id);if(!r)return reply(404,{message:'演示成稿不存在'});
      const digest=await hash(r.business_output.content);if(body.content_sha256!==digest)return reply(409,{message:'成稿版本已变化，请重新查看'});
      const snap={content:r.business_output.content,content_sha256:digest,title:r.title,source_path:'history/'+r.conversation_id,source_sha256:digest,source_version:r.revision_count,source_owner:owner,video_type:body.video_type,quality_labels:body.quality_labels||[],rights_status:'synthetic_demo_only'};
      if(body.destination==='team'||route.endsWith('/reviews')){
        if(!snap.quality_labels.length)return reply(400,{message:'至少选择一个标记'});
        const id='review-demo-'+owner+'-'+r.conversation_id+'-'+r.revision_count;
        const prior=state.reviews.find(x=>x.entry_id===id);if(prior)return reply(200,{status:'success',item:clone(prior),duplicate:true});
        const item={...snap,entry_id:id,status:'pending',submitter_username:session,submitter_display_name:USERS[session].display_name,submitted_at:Math.floor(Date.now()/1000),submission_note:String(body.submission_note||'')};state.reviews.unshift(item);save();return reply(200,{status:'success',item});
      }
      if(owner!==session)return reply(403,{message:'不能修改他人的个人标记'});
      const item={...snap,entry_id:'COPY-LIB-DEMO-P-'+digest.slice(0,16),scope:'personal:'+session,active:!!snap.quality_labels.length};
      const list=state.personal[session]||(state.personal[session]=[]);const i=list.findIndex(x=>x.entry_id===item.entry_id);if(i<0)list.push(item);else list[i]=item;save();return reply(200,{status:'success',item});
    }
    if(route.startsWith('/api/v1/library/review-')&&method==='PATCH'){
      if(!admin)return reply(403,{message:'需要管理员演示角色'});const r=state.reviews.find(i=>i.entry_id===route.split('/').pop());if(!r)return reply(404,{message:'审核记录不存在'});
      if(!(r.status==='pending'&&['approved','rejected'].includes(body.decision)||r.status==='approved'&&body.decision==='revoked'))return reply(409,{message:'审核状态已变化'});
      if(['rejected','revoked'].includes(body.decision)&&!String(body.review_opinion||'').trim())return reply(400,{message:'退回或撤销须填写原因'});
      if(body.decision==='approved'&&!body.quality_labels?.length)return reply(400,{message:'至少保留一个标记'});
      Object.assign(r,{status:body.decision,review_opinion:body.review_opinion||'',reviewed_by:session,reviewer_display_name:USERS[session].display_name,reviewed_at:Math.floor(Date.now()/1000)});
      if(body.decision==='approved')Object.assign(r,{quality_labels:body.quality_labels,video_type:body.video_type});save();return reply(200,{status:'success',item:clone(r)});
    }
    if(route==='/api/v1/library/classify'&&admin){const ids=new Set(body.traffic_ids||[]);state.library.forEach(i=>i.video_type=ids.has(i.entry_id)?'traffic':'sales');save();return reply(200,{status:'success',traffic:ids.size,sales:55-ids.size});}
    if(route==='/api/v1/library/import')return reply(422,{message:'公网演示不接收真实资料。请使用已提供的合成样例测试标记与审核。'});
    if(route.startsWith('/api/v1/library/COPY-LIB-')&&method==='PATCH'){
      const personal=body.destination==='personal'||!admin;const list=personal?state.personal[session]||[]:state.library;const item=list.find(i=>i.entry_id===route.split('/').pop());if(!item)return reply(404,{message:'请在内容审核中调整此记录'});
      Object.assign(item,{quality_labels:body.quality_labels||[],video_type:body.video_type,active:!!body.quality_labels?.length});save();return reply(200,{status:'success',item:clone(item)});
    }
    if(route.endsWith('/like')&&method==='PATCH'){
      const id=route.split('/').slice(-2)[0],r=record(session,id);if(!r)return reply(404,{message:'本人记录不存在'});r.liked=!!body.liked;save();return reply(200,{status:'success',item:annotated(r)});
    }
    if(['/api/v1/copy','/api/v1/clip','/api/v1/tasks'].includes(route)&&method==='POST'){
      await new Promise(resolve=>setTimeout(resolve,550));
      const clip=route!=='/api/v1/copy',id=body.conversation_id||crypto.randomUUID(),prior=record(session,id),version=(prior?.revision_count||0)+1;
      const content='【合成演示成稿，不是真实AI输出】先明确本次目标，再将问题分解为可执行的小动作。完成后检查哪些表达需要保留，哪些需要调整。此处不使用或复述输入的真实素材。';
      const output=clip?{content,clip_script:content,selected_segments:[],script:content,cut_list:[],fidelity_report:{selected_segment_count:0},alignment_report:{selected_cue_count:0},zh_srt:'1\n00:00:00,000 --> 00:00:03,000\n合成切片演示，不是真实课程\n',bilingual_srt:''}:{content,titles:['合成演示：先明确目标再开始行动','合成演示：让修改要求更具体'],video_type:body.video_type||'general',change_summary:'仅验证界面流程，未调用AI'};
      const value={conversation_id:id,owner_username:session,owner_display_name:USERS[session].display_name,business_type:clip?'clip':'copy',title:output.titles?.[0]||'合成切片演示',business_output:output,revision_count:version,updated_at:Math.floor(Date.now()/1000),creation_mode:body.creation_mode||'content_optimization',generation_mode:body.generation_mode||'standard',source_format:body.source?.asset_type||'text',source_trace:[],reference_context:[],versions:[],liked:false};
      if(prior)state.histories.splice(state.histories.indexOf(prior),1,value);else state.histories.unshift(value);save();return reply(200,{status:'success',...clone(value),execution_meta:{total_ms:550},request_id:'synthetic-demo'});
    }
    return reply(404,{message:'演示未实现此操作，不会调用正式接口'});
  };
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('[data-demo-role]').forEach(button=>button.addEventListener('click',async()=>{
      await ready;const r=await fetch('/robert/auth/login',{method:'POST',body:JSON.stringify({username:button.dataset.demoRole})});const b=await r.json();setAuthenticated(true,b.user);showToast('已切换合成演示角色，非真实账号登录');
    }));
    document.querySelector('#demo-reset').addEventListener('click',()=>{if(confirm('清空此浏览器中的演示操作并恢复合成样例？')){localStorage.removeItem(KEY);sessionStorage.removeItem(KEY+'-session');location.reload();}});
  });
})();
