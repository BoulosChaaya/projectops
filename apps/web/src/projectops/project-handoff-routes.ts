import type { RouteDefinition } from '../../../api/src/http/path-matching.ts';
import type { KernelRouteHandler } from '../../../api/src/bootstrap/http-listener.ts';
import type { ProjectOpsApiService } from '../../../api/src/projectops/routes.ts';
import { ProjectOpsOperationError, ProjectOpsValidationError } from '../../../../packages/projectops/src/domain.ts';
import { createProjectExportArtifact, projectExportFilename, validateExportIdentifier } from '../../../../packages/projectops/src/project-export.ts';
import { renderDeliverySummary, renderHandoffUnavailable } from './project-handoff.ts';

export function createProjectHandoffRoutes(service: Pick<ProjectOpsApiService,'getProjectExportSnapshot'>,clock:()=>string): RouteDefinition<KernelRouteHandler>[] {
  return [false,true].map(summary=>({method:'GET',path:summary?'/projectops/projects/:id/delivery-summary':'/projectops/project-requests/:id/export',handler:async(request,context,params)=>{
    const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
    try {
      validateExportIdentifier(params.id);
      if(Object.keys(request.query).length)throw new ProjectOpsValidationError('INVALID_PROJECTOPS_EXPORT_QUERY','Export and summary do not accept query overrides.');
      const operator=context.get<{login:string;defaults:{timezone:string}}>('projectops.operator');
      if(!operator)return {status:401,headers,body:JSON.stringify({message:'Sign in required.'})};
      const artifact=createProjectExportArtifact(await service.getProjectExportSnapshot(params.id),operator.login,clock());
      if(summary)return renderDeliverySummary(artifact,operator.defaults.timezone);
      // Complete encoding before attaching download headers; failures never masquerade as files.
      const body=JSON.stringify(artifact,null,2);
      return {status:200,headers:{...headers,'content-disposition':`attachment; filename="${projectExportFilename(params.id)}"`},body};
    }catch(error){
      const status=error instanceof ProjectOpsValidationError?400:error instanceof ProjectOpsOperationError&&error.kind==='not_found'?404:500;
      const message=status===400?(error as Error).message:status===404?'Project not found.':'Project artifact unavailable. Retry the request.';
      if(summary)return renderHandoffUnavailable(status,message,status===500?'/projectops/projects/'+encodeURIComponent(params.id)+'/delivery-summary':undefined);
      return {status,headers,body:JSON.stringify({message})};
    }
  }}));
}
