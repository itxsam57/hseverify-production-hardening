"use client";

import { useActionState } from "react";
import type { CompanyUnitRecord } from "@/lib/company/company-organization-domain";
import {
  updateWorkerPlacementAction,
  type UpdateWorkerPlacementState
} from "@/app/company/(portal)/workers/[linkId]/actions";

const INITIAL: UpdateWorkerPlacementState = { status:"idle",message:null };

export function WorkerPlacementForm({
  linkId,siteId,departmentId,sites,departments
}:{
  linkId:string;
  siteId:string|null;
  departmentId:string|null;
  sites:readonly CompanyUnitRecord[];
  departments:readonly CompanyUnitRecord[];
}):React.JSX.Element {
  const [state,action,pending]=useActionState(
    updateWorkerPlacementAction.bind(null,linkId),INITIAL
  );
  return (
    <section className="surface-card" aria-label="Change Worker placement">
      <h2>Change Worker placement</h2>
      <p>Choose the Worker&apos;s active Site and Department in this Company. Historical Company relationships and the permanent Worker ID are never transferred.</p>
      {state.message ? (
        <p role={state.status==="success"?"status":"alert"}>{state.message}</p>
      ):null}
      <form action={action} className="form-grid">
        <label>
          Site
          <select name="siteId" defaultValue={siteId??""} disabled={pending}>
            <option value="">No assigned Site</option>
            {sites.filter(unit=>unit.status==="active"||unit.unitId===siteId).map(unit=>(
              <option key={unit.unitId} value={unit.unitId}>{unit.name}{unit.status==="archived"?" (archived)":""}</option>
            ))}
          </select>
        </label>
        <label>
          Department
          <select name="departmentId" defaultValue={departmentId??""} disabled={pending}>
            <option value="">No assigned Department</option>
            {departments.filter(unit=>unit.status==="active"||unit.unitId===departmentId).map(unit=>(
              <option key={unit.unitId} value={unit.unitId}>{unit.name}{unit.status==="archived"?" (archived)":""}</option>
            ))}
          </select>
        </label>
        <button className="button button-secondary" type="submit" disabled={pending}>
          {pending?"Saving placement…":"Save placement"}
        </button>
      </form>
    </section>
  );
}
