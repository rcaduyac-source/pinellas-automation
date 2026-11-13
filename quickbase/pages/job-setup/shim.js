/* QB-SESSION-SHIM v2 — reroutes REST api.quickbase.com calls through the same-origin
   XML API using the signed-in session + app token. Injected 2026-07-08 because Chrome
   blocks the QB session cookie on cross-site REST calls (root cause of token-paste UX).
   Remove when Quickbase pages migrate natively. */
(function(){
  var APPTOKEN="__QB_APP_TOKEN__";
  var SEED_KEYS=["byrdson_qb_finance_token"];
  try{ SEED_KEYS.forEach(function(k){ if(!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({token:"SESSION"})); }); }catch(e){}
  var realFetch=window.fetch.bind(window);
  var repCache={};
  function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function jresp(obj,status){ return new Response(JSON.stringify(obj),{status:status||200,headers:{"Content-Type":"application/json"}}); }
  function xml(dbid,action,inner){
    return realFetch("/db/"+dbid,{method:"POST",credentials:"same-origin",
      headers:{"Content-Type":"application/xml","QUICKBASE-ACTION":action},
      body:"<qdbapi><apptoken>"+APPTOKEN+"</apptoken>"+inner+"</qdbapi>"})
    .then(function(r){return r.text();}).then(function(t){
      var doc=new DOMParser().parseFromString(t,"text/xml");
      var ec=(doc.querySelector("errcode")||{}).textContent;
      if(ec!=="0") throw new Error("QB "+ec+": "+((doc.querySelector("errtext")||{}).textContent||""));
      return doc;
    });
  }
  function fieldsOf(doc){
    var out=[];
    doc.querySelectorAll("fields > field").forEach(function(f){
      out.push({id:Number(f.getAttribute("id")),
        label:(f.querySelector("label")||{}).textContent||("Field "+f.getAttribute("id")),
        type:f.getAttribute("field_type")||"text"});
    });
    return out;
  }
  function conv(v,type){
    if(type==="checkbox") return v==="1";
    if(type==="numeric"||type==="currency"||type==="percent"||type==="rating"||type==="duration"){ var n=parseFloat(v); return isNaN(n)? null:n; }
    if(type==="date"){ var n=parseInt(v,10); if(!isNaN(n)&&String(n)===String(v).trim()&&n>10000){ return new Date(n).toISOString().slice(0,10); } return v; }
    if(type==="timestamp"){ var n2=parseInt(v,10); if(!isNaN(n2)&&String(n2)===String(v).trim()&&n2>10000){ return new Date(n2).toISOString(); } return v; }
    if(type==="recordid") return Number(v);
    return v;
  }
  function dataOf(doc){
    var fields=fieldsOf(doc), tmap={};
    fields.forEach(function(f){ tmap[f.id]=f.type; });
    var data=[];
    doc.querySelectorAll("record").forEach(function(rec){
      var row={};
      rec.querySelectorAll("f").forEach(function(f){
        var id=f.getAttribute("id");
        row[id]={value:conv(f.textContent,tmap[id]||"text")};
      });
      data.push(row);
    });
    return {fields:fields,data:data};
  }
  function doQuery(b){
    var clist=(b.select&&b.select.length? b.select:[3]).join(".");
    var inner=(b.where? "<query>"+esc(b.where)+"</query>":"")+"<clist>"+clist+"</clist><fmt>structured</fmt>";
    var opts=[];
    if(b.options&&b.options.skip) opts.push("skp-"+b.options.skip);
    opts.push("num-"+((b.options&&b.options.top)||2000));
    if(b.sortBy&&b.sortBy.length){
      inner+="<slist>"+b.sortBy.map(function(s){return s.fieldId;}).join(".")+"</slist>";
      opts.push("sortorder-"+b.sortBy.map(function(s){return (s.order||"ASC").toUpperCase()==="DESC"?"D":"A";}).join(""));
    }
    inner+="<options>"+opts.join(".")+"</options>";
    return xml(b.from,"API_DoQuery",inner).then(function(doc){
      var r=dataOf(doc);
      var p;
      if(b.options&&(b.options.top||b.options.skip)){
        p=xml(b.from,"API_DoQueryCount", b.where? "<query>"+esc(b.where)+"</query>":"").then(function(cd){
          return parseInt((cd.querySelector("numMatches")||{}).textContent||r.data.length,10);
        }).catch(function(){return r.data.length;});
      } else p=Promise.resolve(r.data.length);
      return p.then(function(total){
        return {data:r.data,fields:r.fields,metadata:{totalRecords:total,numRecords:r.data.length,numFields:r.fields.length,skip:(b.options&&b.options.skip)||0}};
      });
    });
  }
  function qidRun(tableId,qid){
    var key=tableId+"#"+qid;
    if(repCache[key]) return Promise.resolve(repCache[key]);
    return xml(tableId,"API_DoQuery","<qid>"+qid+"</qid><fmt>structured</fmt><options>num-5000</options>").then(function(doc){
      var r=dataOf(doc); repCache[key]=r; return r;
    });
  }
  function writes(b){
    var created=[],n=0,chain=Promise.resolve();
    (b.data||[]).forEach(function(row){
      chain=chain.then(function(){
        var rid=null,fields="";
        for(var fid in row){
          var v=row[fid]&&row[fid].value;
          if(fid==="3"){rid=v;continue;}
          if(v&&typeof v==="object"&&v.fileName&&v.data){
            fields+='<field fid="'+fid+'" filename="'+esc(v.fileName)+'">'+v.data+"</field>"; continue;
          }
          if(v===true)v="1"; else if(v===false)v="0"; else if(v==null)v="";
          fields+='<field fid="'+fid+'">'+esc(v)+"</field>";
        }
        if(rid!=null) return xml(b.to,"API_EditRecord","<rid>"+rid+"</rid>"+fields).then(function(){n++;});
        return xml(b.to,"API_AddRecord",fields).then(function(doc){ created.push(parseInt((doc.querySelector("rid")||{}).textContent||"0",10)); n++; });
      });
    });
    return chain.then(function(){ return {metadata:{createdRecordIds:created,totalNumberOfRecordsProcessed:n,unchangedRecordIds:[],updatedRecordIds:[],lineErrors:{}}}; });
  }
  window.fetch=function(input,init){
    var url=(typeof input==="string")? input : (input&&input.url)||"";
    if(url.indexOf("https://api.quickbase.com/v1")!==0 && url.indexOf("/v1/")!==0) return realFetch(input,init);
    var path=url.replace("https://api.quickbase.com/v1","").split("#")[0];
    var method=((init&&init.method)||"GET").toUpperCase();
    var body=null;
    try{ body=init&&init.body? JSON.parse(init.body):null; }catch(e){}
    try{
      if(path.indexOf("/auth/temporary/")===0) return Promise.resolve(jresp({temporaryAuthorization:"SESSION"}));
      if(path.indexOf("/records/query")===0&&method==="POST") return doQuery(body).then(jresp);
      if(path.indexOf("/records")===0&&method==="POST") return writes(body).then(jresp);
      if(path.indexOf("/records")===0&&method==="DELETE"){
        return xml(body.from,"API_PurgeRecords","<query>"+esc(body.where||"")+"</query>").then(function(doc){
          return jresp({numberDeleted:parseInt((doc.querySelector("num_records_deleted")||{}).textContent||"0",10)});
        });
      }
      var mrep=path.match(/^\/reports\/(\d+)\/run/);
      if(mrep&&method==="POST"){
        var q1=url.indexOf("tableId=")>-1? url.split("tableId=")[1].split("&")[0]:null;
        return qidRun(q1,mrep[1]).then(function(r){ return jresp({data:r.data,fields:r.fields,metadata:{totalRecords:r.data.length,numRecords:r.data.length,skip:0}}); });
      }
      var mdef=path.match(/^\/reports\/(\d+)/);
      if(mdef&&method==="GET"){
        var q2=url.indexOf("tableId=")>-1? url.split("tableId=")[1].split("&")[0]:null;
        return qidRun(q2,mdef[1]).then(function(r){ return jresp({id:mdef[1],properties:{columnProperties:[]},query:{tableId:q2,fields:r.fields.map(function(f){return f.id;}),formulas:[]}}); });
      }
      var mfile=path.match(/^\/files\/([a-z0-9]+)\/(\d+)\/(\d+)\/(\d+)/i);
      if(mfile&&method==="GET"){
        return realFetch("/up/"+mfile[1]+"/a/r"+mfile[2]+"/e"+mfile[3]+"/v"+mfile[4],{credentials:"same-origin"})
        .then(function(r){ if(!r.ok) throw new Error("file download "+r.status); return r.arrayBuffer(); })
        .then(function(buf){
          var bytes=new Uint8Array(buf),bin="",CH=0x8000;
          for(var i=0;i<bytes.length;i+=CH) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+CH));
          return new Response(btoa(bin),{status:200,headers:{"Content-Type":"text/plain"}});
        });
      }
      var mf=path.match(/^\/fields\?tableId=([a-z0-9]+)/i);
      if(mf&&method==="GET"){
        return xml(mf[1],"API_GetSchema","").then(function(doc){
          var out=[];
          doc.querySelectorAll("field").forEach(function(f){
            out.push({id:Number(f.getAttribute("id")),label:(f.querySelector("label")||{}).textContent||"",fieldType:f.getAttribute("field_type")||"text"});
          });
          return jresp(out);
        });
      }
      return realFetch(input,init);
    }catch(e){ return Promise.resolve(jresp({message:"Shim error",description:String(e)},500)); }
  };
})();
