import {randomBytes} from "node:crypto";
export async function prepareReviewCalibrationBrowser(admin,baseUrl,verifierEmail,requestedReference){
 const reference=requestedReference??"UI-REVIEW-"+randomBytes(6).toString("hex");
 await admin.goto(baseUrl+"/admin/frameworks");
 const creation=admin.locator("form").filter({has:admin.getByRole("button",{name:"Create framework",exact:true})});
 await creation.getByLabel("Reference",{exact:true}).fill(reference);await creation.getByLabel("Title",{exact:true}).fill("Observed review benchmark standard");await creation.getByRole("button",{name:"Create framework",exact:true}).click();await admin.getByText("Framework created.",{exact:true}).waitFor();
 const policy=admin.locator("form").filter({has:admin.getByRole("button",{name:"Publish immutable version",exact:true})});
 await policy.getByLabel("Framework reference",{exact:true}).fill(reference);await policy.getByLabel("Policy reference",{exact:true}).fill(reference);await policy.getByLabel("Title",{exact:true}).fill("Explicit review applicability policy");await policy.getByLabel("Effective from",{exact:true}).fill(new Date(Date.now()-60000).toISOString().slice(0,16));await policy.getByLabel("Policy values JSON").fill('{}');await policy.getByLabel("Override allowed fields JSON").fill('[]');await policy.getByLabel("Override directions JSON").fill('{}');await policy.getByRole("button",{name:"Publish immutable version",exact:true}).click();await admin.getByText("Immutable policy version published.",{exact:true}).waitFor();
 await admin.goto(baseUrl+"/admin/calibrations");const form=admin.locator("form").filter({has:admin.getByRole("button",{name:"Record calibration",exact:true})});
 const staff=await form.locator('select[name="accountId"] option').filter({hasText:verifierEmail}).getAttribute("value");
 const revision=await form.locator('select[name="frameworkVersionId"] option').filter({hasText:reference}).getAttribute("value");
 const started=new Date(Math.ceil(Date.now()/60000)*60000);
 await form.getByLabel("Staff member").selectOption(staff);await form.getByLabel("Framework reference").selectOption(reference);await form.getByLabel("Framework revision").selectOption(revision);await form.getByLabel("Status").selectOption("CURRENT");
 await form.getByLabel("Valid from",{exact:true}).fill(started.toISOString().slice(0,16));await form.getByLabel("Valid until",{exact:true}).fill(new Date(Date.now()+86400000).toISOString().slice(0,16));await form.getByLabel("Calibration evidence / note").fill("Observed authenticated Admin benchmark calibration for this complete browser journey.");await form.getByRole("button",{name:"Record calibration",exact:true}).click();await admin.getByText("Calibration recorded.",{exact:true}).waitFor();
 if(Date.now()<started.getTime())await new Promise(resolve=>setTimeout(resolve,started.getTime()-Date.now()+50));
 const bound=new Set(),calibrated=new Set([revision]);
 return async function bindTask(taskId){
  if(bound.has(taskId))return;
  await admin.goto(baseUrl+"/admin/review-frameworks");
  let binding=admin.locator("form").filter({has:admin.locator('input[name="taskId"][value="'+taskId+'"]')});
  const choices=binding.locator('select[name="frameworkVersionId"] option:not([disabled])');
  const values=await choices.evaluateAll(options=>options.map(option=>option.value));
  const selected=values.includes(revision)?revision:values.length===1?values[0]:null;
  if(!selected)throw new Error("The task's authoritative pinned framework must be resolved before review: "+JSON.stringify({taskId,revision,values,status:(await admin.locator("main").innerText()).slice(0,1800)}));
  if(!calibrated.has(selected)){
   await admin.goto(baseUrl+"/admin/calibrations");
   const calibration=admin.locator("form").filter({has:admin.getByRole("button",{name:"Record calibration",exact:true})});
   const option=calibration.locator('select[name="frameworkVersionId"] option[value="'+selected+'"]');
   const referenceText=(await option.innerText()).split(" · ")[0];
   await calibration.getByLabel("Staff member").selectOption(staff);await calibration.getByLabel("Framework reference").selectOption(referenceText);await calibration.getByLabel("Framework revision").selectOption(selected);await calibration.getByLabel("Status").selectOption("CURRENT");
   await calibration.getByLabel("Valid from",{exact:true}).fill(started.toISOString().slice(0,16));await calibration.getByLabel("Valid until",{exact:true}).fill(new Date(Date.now()+86400000).toISOString().slice(0,16));await calibration.getByLabel("Calibration evidence / note").fill("Observed authenticated Admin benchmark against the case's actual pinned authoritative framework revision.");await calibration.getByRole("button",{name:"Record calibration",exact:true}).click();await admin.getByText("Calibration recorded.",{exact:true}).waitFor();calibrated.add(selected);
   await admin.goto(baseUrl+"/admin/review-frameworks");binding=admin.locator("form").filter({has:admin.locator('input[name="taskId"][value="'+taskId+'"]')});
  }
  if(await binding.locator('select[name="policyReference"]').count())await binding.locator('select[name="policyReference"]').selectOption(reference);
  await binding.getByLabel("Review framework revision").selectOption(selected);await binding.getByLabel("Applicability reason").fill("Explicit approved applicability for this submitted evidence version.");const invalid=await binding.evaluate(form=>Array.from(form.elements).filter(control=>typeof control.checkValidity==="function"&&!control.checkValidity()).map(control=>({name:control.name,value:control.value,message:control.validationMessage})));if(invalid.length)throw new Error("Incomplete actual binding form: "+JSON.stringify(invalid));await Promise.all([admin.waitForResponse(response=>response.request().method()==="POST"&&response.url().includes("/admin/review-frameworks")),binding.getByRole("button",{name:"Bind review framework",exact:true}).click()]);await admin.waitForURL(url=>url.pathname==="/admin/review-frameworks"&&(url.searchParams.has("result")||url.searchParams.has("error")));await admin.locator('[role="status"],[role="alert"]').first().waitFor();if(await admin.getByText("Review framework binding recorded.",{exact:true}).count()!==1)throw new Error("Framework binding failed: "+await admin.locator("main").innerText());bound.add(taskId);
 };
}
