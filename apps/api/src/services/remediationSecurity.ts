import crypto from 'node:crypto';

type AuthConfig = { token?: unknown; callerId?: unknown };
const defaultConfig = (): AuthConfig => ({token:process.env.REMEDIATION_SHARED_TOKEN,callerId:process.env.REMEDIATION_CALLER_ID});
export function getSharedToken(req: any): string {
  const value=req?.headers?.authorization;
  return typeof value==='string' && /^Bearer [!-~]{32,512}$/.test(value) ? value.slice(7) : '';
}
export function authenticateRemediationCaller(req: any, config: () => AuthConfig = defaultConfig): Readonly<{identity:string}> | null {
  try {
    const {token,callerId}=config();
    if(typeof token!=='string' || !/^[!-~]{32,512}$/.test(token) || typeof callerId!=='string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(callerId)) return null;
    const supplied=getSharedToken(req);if(!supplied)return null;
    const a=Buffer.from(token),b=Buffer.from(supplied);
    return a.length===b.length && crypto.timingSafeEqual(a,b) ? Object.freeze({identity:callerId}) : null;
  } catch (_) { return null; }
}
export function hasValidSharedToken(req: any): boolean {return authenticateRemediationCaller(req)!==null;}
export function assertRemediationHeld(): void {
  throw Object.assign(new Error('P0_REMEDIATION_HELD: signed exact delegated scope required'),{status:423,code:'P0_REMEDIATION_HELD'});
}

export function holdLegacyResponse(res: any, error = 'P0_REMEDIATION_HELD'): boolean {
  res.status(423).json({ok:false,error});
  return true;
}

// Trusted composition injects the existing W1.4 workflow and P0 core. No real
// credentials/provider/signer is installed, and no legacy Graph client is used.
// Each public method authenticates independently of Express/mount ordering.
export function createDelegatedRemediationBoundary({identitySafety,createExecutor,createSafetyClient,store,auth,target,tenantId,executionTarget,callerId,config,now=Date.now,operationTimeoutMs=30000}: any) {
  if(typeof callerId!=='string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(callerId) || typeof config!=='function') throw new Error('P0_DELEGATION_CONFIGURATION_REQUIRED');
  const workflow=identitySafety.createRemediationWorkflow({createExecutor,createSafetyClient,store,auth,target,tenantId,executionTarget,generator:callerId,now,operationTimeoutMs});
  function caller(req: any) {
    const principal=authenticateRemediationCaller(req,config);
    if(!principal || principal.identity!==callerId) throw new Error('P0_CALLER_AUTHENTICATION_REQUIRED');
    return principal;
  }
  function scoped(req: any, request: any) {
    const principal=caller(req);
    if(!request || Object.keys(request).some(k=>!['artifactId','requestId'].includes(k)) || typeof request.artifactId!=='string' || typeof request.requestId!=='string') throw new Error('P0_INVALID_EXECUTION_REQUEST');
    const preview=workflow.operator.preview(request.artifactId),plan=preview.artifact.content;
    if(plan.tenantId!==tenantId || plan.executionTarget!==executionTarget || plan.delegation?.callerId!==principal.identity || plan.delegation?.requestId!==request.requestId) throw new Error('P0_DELEGATED_SCOPE_MISMATCH');
    return preview;
  }
  return Object.freeze({
    submit(req: any, request: any) {
      const principal=caller(req);
      const {requestId,...candidate}=request || {};
      if(typeof requestId!=='string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(requestId) || 'delegation' in candidate || !Number.isSafeInteger(candidate.notBefore) || !Number.isSafeInteger(candidate.expiresAt)) throw new Error('P0_INVALID_DELEGATION_REQUEST');
      // Stable caller request identity is an idempotency key, never approval.
      // Reusing it for a different artifact is rejected before creating work.
      const client=createSafetyClient({generator:principal.identity,destination:executionTarget,now,submit(artifact: any,generator: string) {
        return store.transaction(() => {
        const serialized=JSON.stringify(artifact);
        const prior=store.db.prepare('SELECT * FROM p0_artifacts WHERE generator=?').all(generator).find((row: any)=>JSON.parse(row.artifact).content.delegation?.requestId===requestId);
        if(prior) {
          const previous=JSON.parse(prior.artifact);
          // Canonical field order is reconstructed by the existing client.
          if(JSON.stringify(previous)!==serialized) throw new Error('P0_REQUEST_ID_REUSED');
          return prior.id;
        }
        return workflow.operator.submit(artifact,generator);
        });
      }});
      return identitySafety.createRemediationCandidateSubmitter(client)({...candidate,delegation:{callerId:principal.identity,requestId}});
    },
    execute(req: any, request: any) {scoped(req,request);return workflow.operator.execute(request.artifactId);},
    status(req: any, request: any) {scoped(req,request);return workflow.operator.status(request.artifactId);},
    reconcile(req: any, request: any, proof: any) {scoped(req,request);return workflow.operator.reconcile(request.artifactId,proof);},
    // Trusted reviewer/operator capability; never mounted as an HTTP handler.
    // Deliberately no raw execute/submit/target capability is returned here.
    review: Object.freeze({preview:workflow.operator.preview,review:workflow.operator.review,approve:workflow.operator.approve,revoke:workflow.operator.revoke})
  });
}
